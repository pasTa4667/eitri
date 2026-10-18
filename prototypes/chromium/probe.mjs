import { chromium } from 'playwright';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import net from 'node:net';

const lifetime = setTimeout(() => process.exit(124), 120000);
const observations = { node: process.version, architecture: process.arch, uid: process.getuid(), checks: {} };
let browser;
try {
  if (process.version !== 'v26.5.0' || process.arch !== 'arm64' || process.getuid() !== 1001) throw new Error('Unexpected runtime identity');
  await readFile('/.dockerenv');
  const status = await readFile('/proc/self/status', 'utf8');
  observations.processSecurity = status.split('\n').filter(line => /^(Uid|CapEff|NoNewPrivs|Seccomp):/.test(line));
  if (!/^CapEff:\s+0+$/m.test(status) || !/^NoNewPrivs:\s+1$/m.test(status) || !/^Seccomp:\s+2$/m.test(status)) throw new Error('Expected effective security restrictions are missing');
  observations.cgroups = {};
  for (const resource of ['memory.max', 'cpu.max', 'pids.max']) observations.cgroups[resource] = (await readFile(`/sys/fs/cgroup/${resource}`, 'utf8')).trim();
  try { await writeFile('/opt/eitri/forbidden-write', 'probe'); throw new Error('Read-only root unexpectedly writable'); }
  catch (error) { if (error.code !== 'EROFS') throw error; observations.checks.readOnlyRoot = 'enforced'; }
  await writeFile('/tmp/scratch-probe.txt', 'bounded private scratch');
  for (const [name, path] of Object.entries({ socket: '/var/run/docker.sock', hostHomeSentinel: process.env.EITRI_HOST_SENTINEL, hostSource: process.env.EITRI_HOST_SOURCE })) {
    try { await readFile(path); throw new Error(`${name} unexpectedly readable`); }
    catch (error) { if (!['ENOENT', 'EACCES'].includes(error.code)) throw error; observations.checks[name] = 'unavailable'; }
  }
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host: '1.1.1.1', port: 443 });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); reject(new Error('External network unexpectedly reachable')); });
    socket.once('error', () => { observations.checks.egress = 'denied'; resolve(); });
    socket.once('timeout', () => { socket.destroy(); observations.checks.egress = 'denied-timeout'; resolve(); });
  });
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, timeout: 20000 });
  const page = await browser.newPage();
  await page.goto('chrome://sandbox');
  observations.sandboxPage = await page.locator('body').innerText();
  if (!/Namespace Sandbox\s+Yes/i.test(observations.sandboxPage) || !/Seccomp-BPF sandbox\s+Yes/i.test(observations.sandboxPage)) throw new Error('Sandbox status is not positively verified');
  const processes = [];
  for (const pid of (await readdir('/proc')).filter(p => /^\d+$/.test(p))) {
    const command = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '');
    if (/chrome|chromium/.test(command)) {
      if (command.split('\0').includes('--no-sandbox')) throw new Error('A Chromium process disabled its sandbox');
      const status = await readFile(`/proc/${pid}/status`, 'utf8');
      processes.push({ pid, uid: status.match(/^Uid:.*$/m)?.[0], seccomp: status.match(/^Seccomp:.*$/m)?.[0], noNewPrivileges: status.match(/^NoNewPrivs:.*$/m)?.[0] });
    }
  }
  observations.processes = processes;
  await page.setContent('<button id="run">Run</button><output id="result"></output><script>run.onclick=()=>result.textContent="verified"</script>');
  await page.click('#run');
  if (await page.locator('#result').innerText() !== 'verified') throw new Error('Actual browser action/assertion failed');
  observations.checks.browserAction = 'passed';
  observations.browserVersion = browser.version();
  observations.verdict = 'supported';
} catch (error) {
  observations.verdict = 'blocked'; observations.error = String(error.message).slice(0, 12000); process.exitCode = 1;
} finally {
  await browser?.close(); clearTimeout(lifetime);
  console.log(JSON.stringify(observations, null, 2));
}
