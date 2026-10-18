import { chromium } from 'playwright';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { spawnSync } from 'node:child_process';

const lifetime = setTimeout(() => process.exit(124), 120000);
const observations = {
  node: process.version,
  architecture: process.arch,
  uid: process.getuid(),
  checks: {},
  diagnostics: { snapshots: [], events: [] },
};
let browser;
let page;
let teardown = false;
const startedAt = Date.now();

async function diagnostic(action, timeout = 1500) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => action(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Diagnostic deadline exceeded'));
        }, timeout);
      }),
    ]);
  } catch (error) {
    return { error: String(error.message).slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}

async function census(stage) {
  const result = await diagnostic(async (signal) => {
    const snapshot = {
      stage,
      cgroups: {},
      processCount: 0,
      processesTruncated: false,
      processes: [],
    };
    for (const resource of ['pids.current', 'pids.events', 'memory.events']) {
      try {
        snapshot.cgroups[resource] = (
          await readFile(`/sys/fs/cgroup/${resource}`, { encoding: 'utf8', signal })
        )
          .trim()
          .slice(0, 512);
      } catch (error) {
        snapshot.cgroups[resource] = { error: String(error.code ?? error.message).slice(0, 80) };
      }
    }
    const pids = (await readdir('/proc'))
      .filter((pid) => /^\d+$/.test(pid))
      .sort((a, b) => +a - +b);
    snapshot.processCount = pids.length;
    snapshot.processesTruncated = pids.length > 128;
    for (const pid of pids.slice(0, 128)) {
      signal.throwIfAborted();
      let entry;
      try {
        const status = await readFile(`/proc/${pid}/status`, { encoding: 'utf8', signal });
        const command = await readFile(`/proc/${pid}/cmdline`, { encoding: 'utf8', signal });
        entry = {
          pid,
          name: status.match(/^Name:\s*(.*)$/m)?.[1].slice(0, 32),
          role: command.match(/(?:^|\0)--type=([^\0]*)/)?.[1].slice(0, 48) ?? 'untyped',
          threads: status.match(/^Threads:\s*(.*)$/m)?.[1].slice(0, 8),
          uid: status.match(/^Uid:\s*(.*)$/m)?.[1].slice(0, 48),
          noNewPrivileges: status.match(/^NoNewPrivs:\s*(.*)$/m)?.[1].slice(0, 4),
          seccomp: status.match(/^Seccomp:\s*(.*)$/m)?.[1].slice(0, 4),
        };
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        entry = { pid, error: String(error.code ?? error.message).slice(0, 80) };
      }
      snapshot.processes.push(entry);
      if (Buffer.byteLength(JSON.stringify(snapshot, null, 2).replace(/^/gm, '      ')) > 6000) {
        snapshot.processes.pop();
        snapshot.processesTruncated = true;
        break;
      }
    }
    return snapshot;
  });
  observations.diagnostics.snapshots.push({ stage, ...result });
}

function browserEvent(event) {
  if (observations.diagnostics.events.length < 16)
    observations.diagnostics.events.push({ event, elapsedMs: Date.now() - startedAt, teardown });
}

try {
  if (process.version !== 'v26.5.0' || process.arch !== 'arm64' || process.getuid() !== 1001)
    throw new Error('Unexpected runtime identity');
  await readFile('/.dockerenv');
  const status = await readFile('/proc/self/status', 'utf8');
  observations.processSecurity = status
    .split('\n')
    .filter((line) => /^(Uid|CapEff|NoNewPrivs|Seccomp):/.test(line));
  if (
    !/^CapEff:\s+0+$/m.test(status) ||
    !/^NoNewPrivs:\s+1$/m.test(status) ||
    !/^Seccomp:\s+2$/m.test(status)
  )
    throw new Error('Expected effective security restrictions are missing');
  observations.cgroups = {};
  for (const resource of ['memory.max', 'cpu.max', 'pids.max'])
    observations.cgroups[resource] = (await readFile(`/sys/fs/cgroup/${resource}`, 'utf8')).trim();
  try {
    await writeFile('/opt/eitri/forbidden-write', 'probe');
    throw new Error('Read-only root unexpectedly writable');
  } catch (error) {
    if (error.code !== 'EROFS') throw error;
    observations.checks.readOnlyRoot = 'enforced';
  }
  await writeFile('/tmp/scratch-probe.txt', 'bounded private scratch');
  for (const [name, path] of Object.entries({
    socket: '/var/run/docker.sock',
    hostHomeSentinel: process.env.EITRI_HOST_SENTINEL,
    hostSource: process.env.EITRI_HOST_SOURCE,
  })) {
    try {
      await readFile(path);
      throw new Error(`${name} unexpectedly readable`);
    } catch (error) {
      if (!['ENOENT', 'EACCES'].includes(error.code)) throw error;
      observations.checks[name] = 'unavailable';
    }
  }
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host: '1.1.1.1', port: 443 });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error('External network unexpectedly reachable'));
    });
    socket.once('error', () => {
      observations.checks.egress = 'denied';
      resolve();
    });
    socket.once('timeout', () => {
      socket.destroy();
      observations.checks.egress = 'denied-timeout';
      resolve();
    });
  });
  const namespaces = spawnSync('python3', ['/opt/eitri/namespace_probe.py'], {
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 16000,
  });
  observations.namespaceProbe = namespaces.stdout
    ? JSON.parse(namespaces.stdout)
    : { error: namespaces.error?.message, stderr: namespaces.stderr };
  if (namespaces.status !== 0) throw new Error('Namespace syscall controls failed');
  if (
    ['namespaces', 'namespaces-chroot'].includes(process.env.EITRI_POLICY_MODE) &&
    !observations.namespaceProbe.userNamespacesUsable
  )
    throw new Error('User namespaces remain unavailable under the reviewed policy');
  await census('beforeLaunch');
  browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    chromiumSandbox: true,
    timeout: 20000,
  });
  browser.on('disconnected', () => browserEvent('browserDisconnected'));
  observations.browserChannel = 'chromium';
  observations.browserVersion = browser.version();
  await census('afterLaunch');
  page = await browser.newPage();
  page.on('crash', () => browserEvent('pageCrash'));
  await census('afterNewPage');
  await page.goto('chrome://sandbox');
  observations.sandboxPage = await page.locator('body').innerText();
  if (
    !/Namespace Sandbox\s+Yes/i.test(observations.sandboxPage) ||
    !/Seccomp-BPF sandbox\s+Yes/i.test(observations.sandboxPage)
  )
    throw new Error('Sandbox status is not positively verified');
  const processes = [];
  for (const pid of (await readdir('/proc')).filter((p) => /^\d+$/.test(p))) {
    const command = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '');
    if (/chrome|chromium/.test(command)) {
      if (command.split('\0').includes('--no-sandbox'))
        throw new Error('A Chromium process disabled its sandbox');
      const status = await readFile(`/proc/${pid}/status`, 'utf8');
      processes.push({
        pid,
        uid: status.match(/^Uid:.*$/m)?.[0],
        seccomp: status.match(/^Seccomp:.*$/m)?.[0],
        noNewPrivileges: status.match(/^NoNewPrivs:.*$/m)?.[0],
      });
    }
  }
  observations.processes = processes;
  await page.setContent(
    '<button id="run">Run</button><output id="result"></output><script>run.onclick=()=>result.textContent="verified"</script>',
  );
  await page.click('#run');
  if ((await page.locator('#result').innerText()) !== 'verified')
    throw new Error('Actual browser action/assertion failed');
  observations.checks.browserAction = 'passed';
  observations.verdict = 'supported';
} catch (error) {
  observations.verdict = 'blocked';
  observations.error = String(error.message).slice(0, 12000);
  process.exitCode = 1;
  observations.diagnostics.failureState = await diagnostic(() => ({
    url: page?.url().slice(0, 1024) ?? null,
    isClosed: page?.isClosed() ?? null,
    isConnected: browser?.isConnected() ?? null,
  }));
  await census('failure');
} finally {
  teardown = true;
  const closeResult = await diagnostic(() => browser?.close(), 2000);
  if (closeResult?.error) {
    observations.diagnostics.teardownError = closeResult.error;
    observations.verdict = 'blocked';
    process.exitCode = 1;
  }
  clearTimeout(lifetime);
  const output = `${JSON.stringify(observations, null, 2)}\n`;
  if (closeResult?.error) process.stdout.write(output, () => process.exit(process.exitCode ?? 0));
  else process.stdout.write(output);
}
