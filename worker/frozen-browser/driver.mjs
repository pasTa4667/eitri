import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, readdir, readlink, lstat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const scenario = JSON.parse(await readFile(new URL('scenario.json', import.meta.url), 'utf8'));
const scenarioId = process.env.EITRI_SCENARIO;
const profile = scenario.profile;
const isProfile = scenarioId === profile?.id;
if (!isProfile && scenarioId !== scenario.id) process.exit(126);
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
async function identity(pid) {
  const text = await boundedRead(`/proc/${pid}/stat`, 4096);
  const match = text.match(/^([1-9]\d*) \(.*\) ([RSDZTtXxIKWP]) (0|[1-9]\d*) (.*)$/s);
  if (!match || match[1] !== String(pid)) throw new Error('invalid-stat');
  const startTicks = match[4].split(/\s+/)[17];
  if (!/^[1-9]\d{0,19}$/.test(startTicks)) throw new Error('invalid-stat');
  if (['X', 'x'].includes(match[2])) throw new Error('process-churn');
  return {
    pid: String(pid),
    startTicks,
    ppid: match[3],
    state: match[2] === 'Z' ? 'zombie' : 'live',
  };
}
async function security(pid) {
  const before = await identity(pid);
  const status = await boundedRead(`/proc/${pid}/status`, 16384);
  const field = (name) => {
    const rows = status.split('\n').filter((line) => line.startsWith(`${name}:`));
    if (rows.length !== 1) throw new Error('missing-status');
    return rows[0].slice(name.length + 1).trim();
  };
  const witness = {
    ...before,
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
  const state = field('State').split(/\s+/)[0];
  if (!/^[RSDZTtIKWP]$/.test(state)) throw new Error('invalid-status-state');
  if (
    field('PPid') !== before.ppid ||
    (state === 'Z' ? 'zombie' : 'live') !== before.state ||
    JSON.stringify(before) !== JSON.stringify(await identity(pid))
  )
    throw new Error('process-churn');
  return witness;
}
async function scan() {
  const pids = (await readdir('/proc'))
    .filter((p) => /^[1-9]\d*$/.test(p))
    .sort((a, b) => Number(a) - Number(b));
  if (!pids.length || pids.length > 256) throw new Error('process-limit');
  const records = [];
  for (const pid of pids) records.push(await security(pid));
  return records;
}
async function cdpLabels(session) {
  const { processInfo } = await session.send('SystemInfo.getProcessInfo');
  if (!Array.isArray(processInfo) || processInfo.length > 256) throw new Error('cdp-limit');
  const seen = new Set();
  const labels = [];
  for (const entry of processInfo) {
    if (
      !Number.isSafeInteger(entry.id) ||
      entry.id <= 0 ||
      typeof entry.type !== 'string' ||
      entry.type.length > 64 ||
      seen.has(entry.id)
    )
      throw new Error('invalid-cdp-process');
    seen.add(entry.id);
    if (entry.type === 'browser' || entry.type === 'renderer')
      labels.push({ pid: String(entry.id), role: entry.type });
  }
  return labels.sort((a, b) => Number(a.pid) - Number(b.pid));
}
async function census(session) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const before = await scan();
      const labels = await cdpLabels(session);
      const processes = await scan();
      const afterLabels = await cdpLabels(session);
      if (
        JSON.stringify(before) !== JSON.stringify(processes) ||
        JSON.stringify(labels) !== JSON.stringify(afterLabels)
      )
        throw new Error('process-churn');
      const joined = labels.map((label) => {
        const p = processes.find((p) => p.pid === label.pid);
        if (!p || p.state !== 'live') throw new Error('process-churn');
        return { ...label, startTicks: p.startTicks };
      });
      if (
        joined.filter((p) => p.role === 'browser').length !== 1 ||
        !joined.some((p) => p.role === 'renderer')
      )
        throw new Error('missing-cdp-process');
      const outer = processes.find((p) => p.pid === String(process.pid));
      const watchdog = processes.find((p) => p.pid === '1');
      if (!outer || !watchdog) throw new Error('missing-outer');
      return { processes, labels: joined, outer, watchdog };
    } catch (error) {
      if (error.code !== 'ENOENT' && error.message !== 'process-churn') throw error;
    }
  }
  throw new Error('unstable-process-census');
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

async function probeProfile(page, origin) {
  const observation = {
    definitionSha256: hash(JSON.stringify(profile)),
    actuals: [],
    diagnostic: null,
  };
  let stage = 'startup-failed';
  let session;
  try {
    const response = await page.goto(`${origin}${profile.document}`, {
      waitUntil: 'load',
      timeout: 10000,
    });
    if (response?.status() !== 200) throw new Error('profile-document');
    page.on('framenavigated', () => record('page-error', 'unexpected-profile-navigation'));
    session = await page.context().newCDPSession(page);
    await session.send('Runtime.enable');
    const imported = await session.send('Runtime.evaluate', {
      expression: `import(${JSON.stringify(origin + profile.wrapper)})`,
      awaitPromise: true,
      returnByValue: false,
    });
    if (imported.exceptionDetails || !imported.result.objectId) throw new Error('profile-import');
    const properties = await session.send('Runtime.getProperties', {
      objectId: imported.result.objectId,
      ownProperties: true,
    });
    const exported = properties.result.find((property) => property.name === 'probe');
    if (!exported?.isOwn || exported.value?.type !== 'function' || !exported.value.objectId)
      throw new Error('profile-export');
    const objectId = exported.value.objectId;
    const source = profile.reviewedCapture.source;
    const reviewedHelperMatches = manifest.some(
      (file) =>
        file.path === source.virtualPath &&
        file.size === source.size &&
        file.sha256 === source.sha256,
    );
    stage = 'action-failed';
    for (const test of profile.cases) {
      const args = [test.input.kind === 'undefined' ? {} : { value: test.input.value }];
      if (reviewedHelperMatches && test.id === profile.diagnostic.caseId) {
        const raw = await session.send('Runtime.callFunctionOn', {
          objectId,
          functionDeclaration: 'function(input) { return (0,this)(input); }',
          arguments: args,
          awaitPromise: false,
          returnByValue: false,
        });
        if (raw.exceptionDetails?.exception?.objectId) {
          const exceptionId = raw.exceptionDetails.exception.objectId;
          const primitive = async (functionDeclaration) => {
            const result = await session.send('Runtime.callFunctionOn', {
              objectId: exceptionId,
              functionDeclaration,
              awaitPromise: false,
              returnByValue: true,
            });
            if (result.exceptionDetails) throw new Error('profile-diagnostic');
            return result.result.value;
          };
          const nativeTypeError = await primitive(
            'function() { return this instanceof TypeError; }',
          );
          const name = await primitive('function() { return this.name; }');
          const message = await primitive('function() { return this.message; }');
          const stack = await primitive('function() { return this.stack; }');
          if (typeof stack !== 'string' || Buffer.byteLength(stack) > 8192)
            throw new Error('profile-diagnostic');
          const firstFrame = stack.split('\n')[1]?.trim().replace(`(${origin}/`, '(/');
          const diagnostic = { caseId: test.id, nativeTypeError, name, message, firstFrame };
          if (JSON.stringify(diagnostic) === JSON.stringify(profile.diagnostic))
            observation.diagnostic = diagnostic;
          observation.actuals.push({ caseId: test.id, kind: 'threw' });
          continue;
        }
        throw new Error('profile-baseline-diagnostic');
      }
      // Language operations avoid candidate-replaced intrinsics and never inspect a thrown value.
      const result = await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function(input) {
          try {
            const value = (0,this)(input);
            if (typeof value !== 'string' || value.length > 1024) return null;
            for (let i = 0; i < value.length; i++) {
              const char = value[i];
              if (char >= '\\ud800' && char <= '\\udbff') {
                const next = value[++i];
                if (!(next >= '\\udc00' && next <= '\\udfff')) return null;
              } else if (char >= '\\udc00' && char <= '\\udfff') return null;
            }
            return value;
          } catch { return false; }
        }`,
        arguments: args,
        awaitPromise: false,
        returnByValue: true,
      });
      if (result.exceptionDetails) throw new Error('profile-invocation-protocol');
      const value = result.result.value;
      if (typeof value === 'string')
        observation.actuals.push({ caseId: test.id, kind: 'returned', value });
      else if (value === false) observation.actuals.push({ caseId: test.id, kind: 'threw' });
      else if (value === null)
        observation.actuals.push({ caseId: test.id, kind: 'invalid-return' });
      else throw new Error('profile-result');
    }
    stage = 'complete';
  } catch {
    observation.diagnostic = null;
  } finally {
    await session?.detach().catch(() => {});
    await page.close();
  }
  return { stage, scenarioId, profile: observation };
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
    let file;
    if (request.method === 'GET') {
      if (isProfile && request.url === profile.document)
        file = {
          bytes: Buffer.from('<!doctype html><title>Protected profile probe</title>'),
          type: mime.get('html'),
        };
      else if (isProfile && request.url === profile.wrapper)
        file = {
          bytes: Buffer.from(
            `import { ${profile.exportName} } from '/${profile.helper}'; export { ${profile.exportName} as probe };`,
          ),
          type: mime.get('js'),
        };
      else if (!isProfile || request.url === `/${profile.helper}`) file = files.get(request.url);
    }
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
  let measured;
  let screenshotPage = page;
  if (isProfile) {
    measured = await probeProfile(page, origin);
    screenshotPage = await context.newPage();
    await screenshotPage.setContent(
      '<!doctype html><title>Profile observations</title><pre>' +
        JSON.stringify(measured, null, 2).replaceAll('&', '&amp;').replaceAll('<', '&lt;') +
        '</pre>',
    );
  } else {
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
    measured = { stage, literal };
  }
  if (eventFailure) throw new Error(eventFailure);
  const png = await screenshotPage.screenshot({ type: 'png', timeout: 5000 });
  if (png.length > 4 * 1024 * 1024) throw new Error('png-limit');
  const session = await browser.newBrowserCDPSession();
  const discovery = await census(session);
  await session.detach();
  const observations = {
    runtime: { node: process.version, arch: process.arch, uid: process.getuid() },
    driverSha256: hash(await readFile(new URL('driver.mjs', import.meta.url))),
    watchdogSha256: hash(await readFile(new URL('watchdog.mjs', import.meta.url))),
    scenarioSha256: hash(await readFile(new URL('scenario.json', import.meta.url))),
    ...discovery,
    sandboxText,
    budgets,
    restrictions,
    manifest: manifest.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    ...measured,
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
