import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { writeSync } from 'node:fs';
import http from 'node:http';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const scenario = new URL(import.meta.url).searchParams.get('scenario') ?? 'success';
const record = (value) => writeSync(3, `${JSON.stringify(value)}\n`);
Object.defineProperty(process, 'platform', { value: scenario === 'platform' ? 'linux' : 'darwin' });
Object.defineProperty(process.stdin, 'isTTY', { value: scenario !== 'nonterminal' });
Object.defineProperty(process.stdout, 'isTTY', { value: scenario !== 'nonterminal' });

// Disposable subprocess instrumentation; no browser, socket or hosted request is allowed.
let callback;
let expire;
http.createServer = (handler) => {
  record({ kind: 'listener-created' });
  callback = handler;
  const server = new EventEmitter();
  server.listen = (port, host, ready) => {
    record({ kind: 'listen', port, host });
    if (scenario === 'port-busy') {
      queueMicrotask(() =>
        server.emit('error', Object.assign(new Error('private-error'), { code: 'EADDRINUSE' })),
      );
    } else ready();
  };
  server.close = () => record({ kind: 'close' });
  server.closeAllConnections = () => record({ kind: 'close-connections' });
  return server;
};
childProcess.execFile = (file, args, options, done) => {
  record({
    kind: 'browser',
    file,
    argumentCount: args.length,
    env: options.env,
    timeout: options.timeout,
    shell: options.shell ?? false,
  });
  const url = new URL(args[0]);
  assert.equal(url.origin, 'https://auth.openai.com');
  assert.equal(url.pathname, '/api/accounts/authorize');
  record({
    kind: 'authorization',
    app: url.searchParams.get('agent_name_hint'),
    host: url.searchParams.get('ext_agent_host_id'),
    client: url.searchParams.get('client_id'),
    redirect: url.searchParams.get('redirect_uri'),
    hasNonce: Boolean(url.searchParams.get('nonce')),
    hasState: Boolean(url.searchParams.get('state')),
    pkce: url.searchParams.get('code_challenge_method'),
  });
  queueMicrotask(() => {
    if (scenario === 'browser-error') {
      done(new Error('private-browser-error'));
      return;
    }
    done(null, '', '');
    if (scenario === 'cancel') {
      process.emit('SIGINT');
      return;
    }
    if (scenario === 'term') {
      process.emit('SIGTERM');
      return;
    }
    if (scenario === 'deadline') {
      expire();
      return;
    }
    const returned = new URL(url.searchParams.get('redirect_uri'));
    returned.search = new URLSearchParams({
      code: 'private-code-canary',
      state: scenario === 'wrong-state' ? 'wrong-state' : url.searchParams.get('state'),
      client_id: 'oaiapp_synthetic',
      ...(scenario === 'denied' ? { error: 'access_denied' } : {}),
    }).toString();
    callback(
      { url: returned.pathname + returned.search },
      {
        writeHead() {},
        end() {},
      },
    );
    if (scenario === 'wrong-state') process.emit('SIGINT');
  });
  return new EventEmitter();
};
const originalSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, delay, ...args) => {
  if (['deadline', 'hung-fetch'].includes(scenario) && delay === 300_000) {
    expire = fn;
    return originalSetTimeout(() => {}, 10_000);
  }
  return originalSetTimeout(fn, delay, ...args);
};

globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://auth.openai.com/api/accounts/oauth/token');
  assert.equal(options.method, 'POST');
  assert.ok(options.body instanceof URLSearchParams);
  assert.equal(options.body.get('grant_type'), 'authorization_code');
  assert.equal(options.body.get('code'), 'private-code-canary');
  assert.equal(options.body.get('client_id'), 'oaiapp_synthetic');
  assert.ok(options.body.get('code_verifier'));
  record({ kind: 'exchange', hasSignal: options.signal instanceof AbortSignal });
  if (scenario === 'hung-fetch') {
    expire();
    return new Promise(() => {});
  }
  if (scenario === 'network') throw new Error('private-network-error');
  if (scenario === 'rejected') return new Response('private-provider-body', { status: 400 });
  if (scenario === 'malformed') return Response.json({ access_token: 'private-access-canary' });
  return Response.json({
    access_token: 'private-access-canary',
    refresh_token: 'private-refresh-canary',
    id_token: 'private-unvalidated-id-token',
    expires_in: 3600,
    scope:
      scenario === 'missing-scope'
        ? 'openid'
        : 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
  });
};
syncBuiltinESMExports();
