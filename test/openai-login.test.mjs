import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAICredentialStore } from '../src/openai-credentials.ts';

async function command(t, args = ['--run'], scenario = 'success', home) {
  home ??= await mkdtemp(join(tmpdir(), 'eitri-login-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const preload = new URL('./fixtures/openai-login-preload.mjs', import.meta.url);
  preload.searchParams.set('scenario', scenario);
  const result = spawnSync(
    process.execPath,
    ['--import', preload.href, 'scripts/test-openai-login.mjs', ...args],
    {
      cwd: new URL('../', import.meta.url),
      env: {
        HOME: home,
        PATH: process.env.PATH,
        OPENAI_API_KEY: 'private-ambient-key',
        OP_SERVICE_ACCOUNT_TOKEN: 'private-vault-token',
        ...(scenario === 'unsafe-host' ? { PI_OAUTH_CALLBACK_HOST: '0.0.0.0' } : {}),
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /private-|code_verifier|code_challenge|authorize\?|oaiapp_/,
  );
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    calls: result.output[3]
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
    home,
  };
}

test('login test defaults to help without touching storage, browser, listener or network', async (t) => {
  const result = await command(t, []);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /--run/);
  assert.match(result.stdout, /identity.*not validated/i);
  assert.deepEqual(result.calls, []);
  assert.deepEqual(await readdir(result.home), []);
});

test('login test completes only the pinned SDK exchange and never saves returned tokens', async (t) => {
  const result = await command(t);
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    scope: 'login-only',
    verdict: 'token-exchange-succeeded',
    identityValidation: 'not-performed',
    credentialsPersisted: false,
    inference: 'not-performed',
    remoteRevocation: 'not-attempted',
  });
  assert.match(result.stderr, /authorization.*ChatGPT/i);
  assert.deepEqual(
    result.calls.map((call) => call.kind),
    [
      'listener-created',
      'listen',
      'browser',
      'authorization',
      'exchange',
      'close',
      'close-connections',
    ],
  );
  assert.deepEqual(result.calls[1], { kind: 'listen', port: 1455, host: '127.0.0.1' });
  const browser = result.calls[2];
  assert.equal(browser.file, '/usr/bin/open');
  assert.equal(browser.argumentCount, 1);
  assert.equal(browser.shell, false);
  assert.equal(browser.timeout, 10_000);
  assert.equal(browser.env.OPENAI_API_KEY, undefined);
  assert.equal(browser.env.OP_SERVICE_ACCOUNT_TOKEN, undefined);
  const authorization = result.calls[3];
  assert.equal(authorization.app, 'Eitri');
  assert.match(authorization.host, /^urn:uuid:[0-9a-f-]{36}$/);
  assert.equal(authorization.client, 'dynamic_agent_client');
  assert.equal(authorization.redirect, 'http://127.0.0.1:1455/auth/callback');
  assert.equal(authorization.hasState, true);
  assert.equal(authorization.hasNonce, true);
  assert.equal(authorization.pkce, 'S256');
  const bytes = await readFile(join(result.home, '.eitri-oauth', 'credentials.sqlite'));
  assert.doesNotMatch(bytes.toString(), /private-|oaiapp_synthetic/);
});

for (const args of [
  ['--help'],
  ['--run=1'],
  ['--run', '--run'],
  ['--run', 'private-argument'],
  ['--unknown'],
]) {
  test(`login test handles ${JSON.stringify(args)} without effects`, async (t) => {
    const result = await command(t, args);
    assert.equal(result.code, args[0] === '--help' ? 0 : 1);
    assert.deepEqual(result.calls, []);
    assert.deepEqual(await readdir(result.home), []);
  });
}

for (const scenario of ['nonterminal', 'platform', 'unsafe-host']) {
  test(`login test rejects ${scenario} before storage or SDK login`, async (t) => {
    const result = await command(t, ['--run'], scenario);
    assert.equal(result.code, 1);
    assert.deepEqual(result.calls, []);
    assert.deepEqual(await readdir(result.home), []);
    assert.match(result.stderr, /macOS terminal.*loopback/);
  });
}

for (const [scenario, verdict, exchanged] of [
  ['cancel', 'cancelled', false],
  ['term', 'cancelled', false],
  ['deadline', 'timed-out', false],
  ['hung-fetch', 'timed-out', true],
  ['browser-error', 'failed', false],
  ['wrong-state', 'cancelled', false],
  ['denied', 'failed', false],
  ['network', 'failed', true],
  ['rejected', 'failed', true],
  ['malformed', 'failed', true],
  ['missing-scope', 'failed', true],
]) {
  test(`login test sanitizes ${scenario} and cleans up without activating credentials`, async (t) => {
    const result = await command(t, ['--run'], scenario);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stdout).verdict, verdict);
    assert.equal(
      result.calls.some((call) => call.kind === 'exchange'),
      exchanged,
    );
    // An intentionally uncooperative fetch cannot reach SDK finally; bounded process exit is its fallback.
    const closed = scenario === 'hung-fetch' ? 0 : 1;
    assert.equal(result.calls.filter((call) => call.kind === 'close').length, closed);
    assert.equal(result.calls.filter((call) => call.kind === 'close-connections').length, closed);
    const store = await OpenAICredentialStore.open(join(result.home, '.eitri-oauth'));
    try {
      assert.equal(await store.read('openai'), undefined);
    } finally {
      await store.close();
    }
  });
}

test('login test fails a busy port before opening the browser or exchanging a code', async (t) => {
  const result = await command(t, ['--run'], 'port-busy');
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).verdict, 'failed');
  assert.deepEqual(
    result.calls.map((call) => call.kind),
    ['listener-created', 'listen'],
  );
});

test('login test preserves Eitri installation identity and previously stored credentials byte-for-byte', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'eitri-login-existing-'));
  const file = join(home, '.eitri-oauth', 'credentials.sqlite');
  const store = await OpenAICredentialStore.open(join(home, '.eitri-oauth'));
  const identity = await store.identity();
  await store.modify('openai', async () => ({
    type: 'oauth',
    access: 'private-existing-access',
    refresh: 'private-existing-refresh',
    clientId: 'oaiapp_existing',
    scopes: ['chatgpt.tokens.use.direct'],
    expires: 0,
  }));
  await store.close();
  const before = await readFile(file);
  for (const scenario of ['success', 'rejected']) {
    const result = await command(t, ['--run'], scenario, home);
    assert.equal(result.code, scenario === 'success' ? 0 : 1);
    assert.equal(
      result.calls.find((call) => call.kind === 'authorization').host,
      `urn:uuid:${identity.installationId}`,
    );
    assert.deepEqual(await readFile(file), before);
  }
});

test('unsafe Eitri storage fails before browser, callback listener or network', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'eitri-login-unsafe-'));
  await mkdir(join(home, '.eitri-oauth'), { mode: 0o755 });
  const result = await command(t, ['--run'], 'success', home);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).verdict, 'failed');
  assert.deepEqual(result.calls, []);
});
