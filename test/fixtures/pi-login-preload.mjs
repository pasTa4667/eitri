import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { writeSync } from 'node:fs';
import http from 'node:http';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const scenario = new URL(import.meta.url).searchParams.get('scenario');
const record = (value) => writeSync(3, `${JSON.stringify(value)}\n`);
Object.defineProperty(process, 'platform', { value: 'darwin' });
Object.defineProperty(process.stdin, 'isTTY', { value: true });
Object.defineProperty(process.stdout, 'isTTY', { value: true });
let callback;
http.createServer = (handler) => {
  callback = handler;
  const server = new EventEmitter();
  server.listen = (port, host, ready) => {
    assert.equal(port, 1455);
    assert.equal(host, '127.0.0.1');
    record({ kind: 'listen' });
    ready();
  };
  server.address = () => ({ port: 1455 });
  server.close = () => record({ kind: 'close' });
  server.closeAllConnections = () => {};
  return server;
};
childProcess.execFile = (file, args, options, done) => {
  assert.equal(file, '/usr/bin/open');
  assert.equal(args.length, 1);
  assert.deepEqual(options.env, { PATH: '/usr/bin:/bin' });
  const url = new URL(args[0]);
  assert.equal(url.origin, 'https://auth.openai.com');
  assert.equal(url.pathname, '/oauth/authorize');
  record({ kind: 'browser' });
  queueMicrotask(() => {
    if (scenario === 'browser-error') {
      done(new Error('private-browser'));
      return;
    }
    done(null, '', '');
    if (scenario === 'cancel') {
      process.emit('SIGINT');
      return;
    }
    if (scenario === 'deadline') {
      expire();
      return;
    }
    callback(
      {
        method: 'GET',
        url: `/auth/callback?${new URLSearchParams({ code: 'private-code', state: url.searchParams.get('state') })}`,
      },
      { writeHead() {}, end() {} },
    );
  });
  return new EventEmitter();
};
if (scenario === 'launcher') {
  childProcess.spawn = (file, args, options) => {
    assert.equal(file, process.execPath);
    assert.deepEqual(args.slice(1), ['--run']);
    assert.equal(options.stdio, 'inherit');
    assert.deepEqual(Object.keys(options.env).sort(), [
      'EITRI_PI_LOGIN_CHILD',
      'EITRI_PI_LOGIN_HOME',
      'HOME',
      'PATH',
      'PI_CODING_AGENT_DIR',
      'PI_OFFLINE',
      'PI_SKIP_VERSION_CHECK',
      'PI_TELEMETRY',
    ]);
    assert.equal(options.cwd, options.env.HOME);
    assert.notEqual(options.env.HOME, process.env.HOME);
    assert.equal(options.env.EITRI_PI_LOGIN_CHILD, '1');
    record({ kind: 'clean-launch' });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('close', 0));
    return child;
  };
}
let expire;
const originalTimer = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => {
  if (ms === 300_000 && ['deadline', 'hung-fetch'].includes(scenario)) {
    expire = fn;
    return originalTimer(() => {}, 10_000);
  }
  return originalTimer(fn, ms, ...args);
};
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://auth.openai.com/oauth/token');
  assert.equal(options.body.get('grant_type'), 'authorization_code');
  assert.equal(options.body.get('code'), 'private-code');
  record({ kind: 'exchange' });
  if (scenario === 'hold') return new Promise(() => {});
  if (scenario === 'hung-fetch') {
    expire();
    return new Promise(() => {});
  }
  if (scenario === 'denied') return new Response('private-provider-error', { status: 403 });
  if (scenario === 'malformed') return Response.json({ access_token: 'private-token' });
  const payload = Buffer.from(
    JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account' } }),
  ).toString('base64url');
  return Response.json({
    access_token: `synthetic.${payload}.signature`,
    refresh_token: 'private-refresh',
    expires_in: 3600,
  });
};
syncBuiltinESMExports();
