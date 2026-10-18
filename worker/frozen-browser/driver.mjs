import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, readdir, readlink, lstat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const scenario = JSON.parse(await readFile(new URL('scenario.json', import.meta.url), 'utf8'));
const nonce = process.env.EITRI_NONCE;
const requestDigest = process.env.EITRI_REQUEST;
if (!/^[a-f0-9]{64}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(requestDigest)) process.exit(126);
const mime = new Map([
  ['html', 'text/html; charset=utf-8'],
  ['js', 'text/javascript; charset=utf-8'],
  ['css', 'text/css; charset=utf-8'],
  ['png', 'image/png'],
  ['svg', 'image/svg+xml'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
  ['ico', 'image/x-icon'],
]);
const files = new Map();
const manifest = [];
async function inventory(relative = '') {
  for (const name of (await readdir(`/snapshot/${relative}`)).sort()) {
    const path = relative ? `${relative}/${name}` : name;
    const stat = await lstat(`/snapshot/${path}`);
    if (stat.isDirectory()) {
      if ((stat.mode & 0o7777) !== 0o555 || stat.uid !== 1001)
        throw new Error('snapshot-directory');
      await inventory(path);
    } else {
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.size > 1024 * 1024 ||
        (stat.mode & 0o7777) !== 0o444 ||
        stat.uid !== 1001
      )
        throw new Error('snapshot-file');
      const bytes = await readFile(`/snapshot/${path}`);
      manifest.push({ path, size: bytes.length, sha256: hash(bytes) });
      const type = mime.get(path.split('.').at(-1));
      if (type) files.set(`/${path}`, { bytes, type });
    }
  }
}
async function boundedRead(path, max) {
  const bytes = await readFile(path);
  if (bytes.length > max) throw new Error('witness-overflow');
  return bytes.toString('utf8').trim();
}
async function security(pid, role, args) {
  const status = await boundedRead(`/proc/${pid}/status`, 16384);
  const field = (name) => {
    const rows = status.split('\n').filter((line) => line.startsWith(`${name}:`));
    if (rows.length !== 1) throw new Error('missing-status');
    return rows[0].slice(name.length + 1).trim();
  };
  return {
    pid: String(pid),
    role,
    args,
    uid: field('Uid').split(/\s+/).map(Number),
    capEff: field('CapEff'),
    capPrm: field('CapPrm'),
    capBnd: field('CapBnd'),
    nnp: field('NoNewPrivs'),
    seccomp: field('Seccomp'),
    nspid: field('NSpid'),
    userNamespace: await readlink(`/proc/${pid}/ns/user`),
    uidMap: await boundedRead(`/proc/${pid}/uid_map`, 256),
    gidMap: await boundedRead(`/proc/${pid}/gid_map`, 256),
  };
}
async function census() {
  const result = [];
  for (const pid of (await readdir('/proc')).filter((p) => /^[1-9]\d*$/.test(p))) {
    let command;
    try {
      command = await boundedRead(`/proc/${pid}/cmdline`, 16384);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const args = command.split('\0').filter(Boolean);
    if (!/\/(?:chrome|chromium|chrome_crashpad_handler)$/.test(args[0] ?? '')) continue;
    const role =
      args.find((arg) => arg.startsWith('--type='))?.slice(7) ??
      (args[0].endsWith('chrome_crashpad_handler') ? 'crashpad-handler' : 'browser');
    try {
      result.push(await security(pid, role, args));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (result.length > 64) throw new Error('process-limit');
  }
  return result;
}
async function deniedWrite(path, allowed) {
  try {
    await writeFile(path, 'synthetic-probe', { flag: 'wx' });
  } catch (error) {
    if (allowed.includes(error.code)) return error.code;
    throw error;
  }
  throw new Error('writable-protected-path');
}
async function absent(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return 'ENOENT';
    throw error;
  }
  throw new Error('unexpected-host-file');
}
async function egress() {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '192.0.2.1', port: 443 });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error('egress-connected'));
    });
    socket.once('error', (error) => {
      if (['ENETUNREACH', 'EHOSTUNREACH', 'EACCES', 'EPERM'].includes(error.code))
        resolve(error.code);
      else reject(new Error('egress-unwitnessed'));
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('egress-unwitnessed'));
    });
  });
}

let browser;
let server;
const events = [];
let eventBytes = 0;
const event = (kind, value) => {
  const text = String(value);
  eventBytes += Buffer.byteLength(text);
  if (events.length >= 32 || eventBytes > 8192 || Buffer.byteLength(text) > 1024)
    throw new Error('page-event-overflow');
  events.push({ kind, text });
};
let eventFailure;
const record = (kind, value) => {
  try {
    event(kind, value);
  } catch {
    eventFailure = 'page-event-overflow';
  }
};
try {
  if (
    process.version !== 'v26.5.0' ||
    process.arch !== 'arm64' ||
    process.getuid() !== 1001 ||
    process.execArgv.length
  )
    throw new Error('runtime-identity');
  const outer = await security(process.pid, 'driver', []);
  const watchdog = await security(1, 'watchdog', []);
  const budgets = {};
  for (const name of ['memory.max', 'memory.swap.max', 'pids.max', 'cpu.max'])
    budgets[name] = await boundedRead(`/sys/fs/cgroup/${name}`, 128);
  const restrictions = {
    root: await deniedWrite('/opt/eitri/forbidden-write', ['EROFS']),
    snapshot: await deniedWrite('/snapshot/forbidden-write', ['EROFS', 'EACCES']),
    socket: await absent('/var/run/docker.sock'),
    hostPath: await absent('/host'),
    canary: await absent('/tmp/project-node-executed'),
    egress: await egress(),
  };
  await inventory();
  if (manifest.length > 1024 || manifest.reduce((n, f) => n + f.size, 0) > 32 * 1024 * 1024)
    throw new Error('snapshot-limit');
  server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    const file = request.method === 'GET' && files.get(request.url);
    if (!file) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      'content-type': file.type,
      'content-length': file.bytes.length,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
      'content-security-policy': "worker-src 'none'",
    });
    response.end(file.bytes);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    chromiumSandbox: true,
    timeout: 15000,
  });
  const context = await browser.newContext({
    viewport: { width: 640, height: 480 },
    serviceWorkers: 'block',
  });
  context.on('console', (message) =>
    record(message.type() === 'error' ? 'console-error' : 'console', message.text()),
  );
  context.on('weberror', (error) => record('page-error', error.error().message));
  context.on('page', (page) => {
    page.on('crash', () => record('page-error', 'page-crash'));
    page.on('worker', () => {
      eventFailure = 'unexpected-worker';
    });
  });
  const sandbox = await context.newPage();
  await sandbox.goto('chrome://sandbox');
  const sandboxText = await sandbox.locator('body').innerText();
  await sandbox.close();
  await context.route('**/*', (route) => {
    if (route.request().url().startsWith(`${origin}/`)) return route.continue();
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  let stage = 'startup-failed';
  let literal = null;
  try {
    const response = await page.goto(`${origin}/${scenario.entry}`, {
      waitUntil: 'load',
      timeout: 10000,
    });
    if (
      response?.status() !== 200 ||
      (await page.locator(scenario.button).count()) !== 1 ||
      (await page.locator(scenario.output).count()) !== 1 ||
      (await page.locator(scenario.output).innerText()) !== scenario.initial ||
      events.some((e) => e.kind !== 'console')
    )
      throw new Error('startup-failed');
    stage = 'action-failed';
    await page.locator(scenario.button).click({ timeout: 5000 });
    literal = await page.locator(scenario.output).innerText({ timeout: 5000 });
    if (events.some((e) => e.kind !== 'console')) throw new Error('action-failed');
    stage = 'complete';
  } catch {
    literal = null;
  }
  if (eventFailure) throw new Error(eventFailure);
  const png = await page.screenshot({ type: 'png', timeout: 5000 });
  if (png.length > 4 * 1024 * 1024) throw new Error('png-limit');
  const observations = {
    runtime: { node: process.version, arch: process.arch, uid: process.getuid() },
    driverSha256: hash(await readFile(new URL('driver.mjs', import.meta.url))),
    watchdogSha256: hash(await readFile(new URL('watchdog.mjs', import.meta.url))),
    scenarioSha256: hash(await readFile(new URL('scenario.json', import.meta.url))),
    outer,
    watchdog,
    processes: await census(),
    sandboxText,
    budgets,
    restrictions,
    manifest: manifest.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    stage,
    literal,
    events,
    canaryAfter: await absent('/tmp/project-node-executed'),
  };
  await browser.close();
  browser = undefined;
  await new Promise((resolve) => server.close(resolve));
  server = undefined;
  if (eventFailure) throw new Error(eventFailure);
  const frame = (kind, data) => JSON.stringify({ version: 1, kind, nonce, requestDigest, data });
  const control = frame('observations', observations);
  if (Buffer.byteLength(control) > 256 * 1024) throw new Error('control-limit');
  const screenshot = frame('png', { mime: 'image/png', base64: png.toString('base64') });
  const end = frame('end', { observationsSha256: hash(control), pngSha256: hash(png) });
  const output = `${control}\n${screenshot}\n${end}\n`;
  if (Buffer.byteLength(output) > 6 * 1024 * 1024) throw new Error('wire-limit');
  process.stdout.write(output);
} catch {
  process.stderr.write('frozen-driver-failed\n');
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
}
