import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import net from 'node:net';
import { chromium } from 'playwright';
import { isSandboxStatusVerified } from '/opt/eitri/sandbox-status.mjs';

const observations = { protocol: 1, snapshot: [], unavailable: {}, processes: [] };
const lifetime = setTimeout(() => process.exit(124), 60000);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let browser;
let server;

async function absent(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return error.code;
    throw error;
  }
  throw new Error('Unexpected path present');
}

async function rejectedWrite(path) {
  try {
    await writeFile(path, 'forbidden', { flag: 'wx' });
  } catch (error) {
    if (['EROFS', 'EACCES'].includes(error.code)) return error.code;
    throw error;
  }
  throw new Error('Unexpected writable path');
}

function security(status) {
  return {
    uid: status
      .match(/^Uid:\s*(.+)$/m)?.[1]
      .trim()
      .split(/\s+/)
      .map(Number),
    capEff: status.match(/^CapEff:\s*(.+)$/m)?.[1].trim(),
    noNewPrivileges: status.match(/^NoNewPrivs:\s*(.+)$/m)?.[1].trim(),
    seccomp: status.match(/^Seccomp:\s*(.+)$/m)?.[1].trim(),
  };
}

function restricted(status) {
  assert.deepEqual(status.uid, [1001, 1001, 1001, 1001]);
  assert.match(status.capEff, /^0+$/);
  assert.equal(status.noNewPrivileges, '1');
  assert.equal(status.seccomp, '2');
}

try {
  observations.runtime = { node: process.version, arch: process.arch, uid: process.getuid() };
  assert.deepEqual(observations.runtime, { node: 'v26.5.0', arch: 'arm64', uid: 1001 });
  observations.nodeExecArgv = process.execArgv;
  assert.deepEqual(observations.nodeExecArgv, []);
  observations.driverSha256 = hash(await readFile('/opt/eitri/frozen-driver.mjs'));
  observations.security = security(await readFile('/proc/self/status', 'utf8'));
  restricted(observations.security);
  observations.budgets = {};
  for (const resource of ['memory.max', 'memory.swap.max', 'cpu.max', 'pids.max'])
    observations.budgets[resource] = (await readFile(`/sys/fs/cgroup/${resource}`, 'utf8')).trim();
  assert.equal(observations.budgets['memory.max'], String(4 * 1024 ** 3));
  assert.equal(observations.budgets['memory.swap.max'], '0');
  assert.equal(observations.budgets['pids.max'], '256');
  const [quota, period] = observations.budgets['cpu.max'].split(/\s+/).map(Number);
  assert.ok(quota > 0 && period > 0 && quota / period === 2);
  observations.readOnly = {
    root: await rejectedWrite('/opt/eitri/frozen-forbidden-write'),
    snapshot: await rejectedWrite('/snapshot/forbidden-write'),
  };
  assert.equal(observations.readOnly.root, 'EROFS');
  for (const [name, path] of Object.entries({
    dockerSocket: '/var/run/docker.sock',
    hostSentinel: process.env.EITRI_HOST_SENTINEL,
    hostController: process.env.EITRI_HOST_CONTROLLER,
    projectNodeCanary: '/tmp/project-node-executed',
  })) {
    assert.ok(typeof path === 'string' && path.startsWith('/'));
    observations.unavailable[name] = await absent(path);
  }
  observations.egress = await new Promise((resolve, reject) => {
    const socket = net.connect({ host: '1.1.1.1', port: 443 });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error('External network reachable'));
    });
    socket.once('error', (error) => {
      socket.destroy();
      if (!['ENETUNREACH', 'EHOSTUNREACH', 'EACCES', 'EPERM'].includes(error.code))
        reject(new Error('Uncertain egress failure'));
      else resolve(error.code);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('Uncertain egress timeout'));
    });
  });
  assert.deepEqual((await readdir('/snapshot')).sort(), ['package.json', 'poison.cjs', 'src']);
  assert.deepEqual(await readdir('/snapshot/src'), ['index.html']);
  observations.directories = [];
  for (const path of ['/snapshot', '/snapshot/src']) {
    const stat = await lstat(path);
    assert.ok(stat.isDirectory());
    assert.equal(stat.mode & 0o7777, 0o555);
    assert.equal(stat.uid, 1001);
    observations.directories.push({ path, mode: stat.mode & 0o7777, uid: stat.uid });
  }
  let html;
  for (const path of ['src/index.html', 'package.json', 'poison.cjs']) {
    const stat = await lstat(`/snapshot/${path}`);
    assert.ok(stat.isFile() && stat.nlink === 1 && stat.size <= 4096);
    assert.equal(stat.mode & 0o7777, 0o444);
    assert.equal(stat.uid, 1001);
    const bytes = await readFile(`/snapshot/${path}`);
    observations.snapshot.push({
      path,
      sha256: hash(bytes),
      size: bytes.length,
      mode: 0o444,
      uid: stat.uid,
    });
    if (path === 'src/index.html') html = bytes;
  }
  server = createServer(
    { maxHeaderSize: 4096, requestTimeout: 2000, headersTimeout: 2000 },
    (request, response) => {
      if (request.method !== 'GET' || request.url !== '/') {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': html.length,
      });
      response.end(html);
    },
  );
  server.maxConnections = 8;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  observations.staticServer = { address: server.address().address, port: server.address().port };
  browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    chromiumSandbox: true,
    timeout: 20000,
  });
  observations.browserVersion = browser.version();
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(10000);
  await page.goto('chrome://sandbox');
  const sandboxText = await page.locator('body').innerText();
  assert.ok(Buffer.byteLength(sandboxText) <= 8192);
  observations.sandboxText = sandboxText;
  assert.ok(isSandboxStatusVerified(sandboxText));
  for (const pid of (await readdir('/proc')).filter((value) => /^\d+$/.test(value))) {
    let command;
    try {
      command = await readFile(`/proc/${pid}/cmdline`, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (!/chrome|chromium/.test(command)) continue;
    const flags = command.split('\0').filter((value) => value.startsWith('--'));
    assert.ok(!flags.some((flag) => /^(--no-sandbox|--disable-.*sandbox)(=|$)/.test(flag)));
    assert.ok(!flags.some((flag) => flag.startsWith('--remote-debugging-port')));
    const status = security(await readFile(`/proc/${pid}/status`, 'utf8'));
    restricted(status);
    const sandboxAndDebuggingFlags = flags.filter((flag) => /sandbox|remote-debugging/.test(flag));
    assert.ok(
      sandboxAndDebuggingFlags.length <= 16 &&
        sandboxAndDebuggingFlags.every((flag) => flag.length <= 256),
    );
    observations.processes.push({ pid, ...status, sandboxAndDebuggingFlags });
    assert.ok(observations.processes.length <= 64);
  }
  assert.ok(
    observations.processes.length > 0 &&
      observations.processes.some((entry) =>
        entry.sandboxAndDebuggingFlags.includes('--remote-debugging-pipe'),
      ),
  );
  const response = await page.goto(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(response.status(), 200);
  const served = await response.body();
  assert.ok(served.equals(html));
  observations.served = { literal: served.toString('utf8'), sha256: hash(served) };
  await page.click('#run');
  const literalOutput = await page.locator('#result').innerText();
  assert.ok(Buffer.byteLength(literalOutput) <= 64);
  observations.literalOutput = literalOutput;
  observations.canaryAfter = await absent('/tmp/project-node-executed');
} catch (error) {
  observations.error = String(error.message).slice(0, 1024);
  process.exitCode = 1;
} finally {
  try {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  } catch (error) {
    observations.teardownError = String(error.message).slice(0, 512);
    process.exitCode = 1;
  }
  const output = `${JSON.stringify(observations)}\n`;
  if (Buffer.byteLength(output) > 24000) process.exit(125);
  process.stdout.write(output, () => {
    clearTimeout(lifetime);
    process.exit(process.exitCode ?? 0);
  });
}
