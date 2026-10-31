import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function fixture(t, expires = Date.now() + 3_600_000) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-tool-cli-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const profile = join(home, 'Library', 'Application Support', 'eitri', 'pi');
  await mkdir(profile, { recursive: true, mode: 0o700 });
  const authPath = join(profile, 'auth.json');
  const payload = Buffer.from(
    JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account' } }),
  ).toString('base64url');
  await writeFile(
    authPath,
    JSON.stringify({
      'openai-codex': {
        type: 'oauth',
        access: `synthetic.${payload}.signature`,
        refresh: 'private-refresh',
        expires,
        accountId: 'synthetic-account',
      },
    }),
    { mode: 0o600 },
  );
  return { home, profile, authPath };
}
function options(p, scenario) {
  const preload = new URL('./fixtures/pi-tool-preload.mjs', import.meta.url);
  preload.searchParams.set('scenario', scenario);
  return {
    args: ['--import', preload.href, 'scripts/test-pi-tool.mjs', '--run'],
    env: {
      PATH: process.env.PATH,
      HOME: p.home,
      ...(scenario.startsWith('launcher')
        ? {
            OPENAI_API_KEY: 'private-ambient',
            NODE_OPTIONS: '',
            OP_SERVICE_ACCOUNT_TOKEN: 'private-op',
          }
        : {
            EITRI_PI_TOOL_HOME: p.home,
            EITRI_PI_TOOL_CHILD: '1',
            PI_CODING_AGENT_DIR: p.profile,
            PI_OFFLINE: '1',
            PI_SKIP_VERSION_CHECK: '1',
            PI_TELEMETRY: '0',
          }),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
  };
}
function command(p, scenario = 'success') {
  const { args, ...opts } = options(p, scenario);
  const result = spawnSync(process.execPath, args, {
    ...opts,
    encoding: 'utf8',
    timeout: 15_000,
    killSignal: 'SIGKILL',
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /private-|synthetic-account|access_token|refresh_token/,
  );
  return {
    code: result.status,
    frames: result.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
    calls: result.output[3]
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  };
}

test('installed Pi built-in OAuth and SSE streams round-trip a real tool result with synthetic transport only', async (t) => {
  const p = await fixture(t, 0);
  const result = command(p);
  assert.equal(result.code, 0);
  assert.equal(result.frames.at(-1).verdict, 'tool-turn-pass');
  assert.deepEqual(result.calls, [
    { kind: 'refresh' },
    { kind: 'request', number: 1 },
    { kind: 'request', number: 2 },
  ]);
  assert.equal(
    JSON.parse(await readFile(p.authPath, 'utf8'))['openai-codex'].refresh,
    'private-rotated',
  );
  assert.deepEqual(await readdir(p.profile), ['auth.json']);
});

for (const scenario of ['denied', 'refresh-denied', 'bad-tool', 'deadline', 'hung', 'cancel']) {
  test(`installed tool probe blocks ${scenario} without retry or raw diagnostics; a later probe reclaims its dead owner`, async (t) => {
    const p = await fixture(t, scenario === 'refresh-denied' ? 0 : undefined);
    const result = command(p, scenario);
    assert.equal(result.code, 1);
    assert.notEqual(result.frames.at(-1)?.verdict, 'tool-turn-pass');
    assert.deepEqual(result.calls, [
      scenario === 'refresh-denied' ? { kind: 'refresh' } : { kind: 'request', number: 1 },
    ]);
    const lease = JSON.parse(await readFile(join(p.profile, 'eitri-use', 'owner.json'), 'utf8'));
    assert.equal(lease.kind, 'probe');
    // The failed process has exited, so a separately started probe needs no browser sign-in.
    assert.throws(() => process.kill(lease.pid, 0), { code: 'ESRCH' });
    const later = command(p);
    assert.equal(later.code, 0);
    assert.equal(later.frames.at(-1)?.verdict, 'tool-turn-pass');
    assert.deepEqual(await readdir(p.profile), ['auth.json']);
  });
}

test('launcher strips ambient credentials and accepts only the finite report after child closure', async (t) => {
  const p = await fixture(t);
  const before = await readFile(p.authPath, 'utf8');
  const result = command(p, 'launcher');
  assert.equal(result.code, 0);
  assert.deepEqual(result.calls, [{ kind: 'clean-launch' }]);
  assert.equal(await readFile(p.authPath, 'utf8'), before);
});

for (const scenario of ['launcher-private', 'launcher-late', 'launcher-nonzero']) {
  test(`launcher rejects ${scenario} without forwarding raw output or claiming success`, async (t) => {
    const p = await fixture(t);
    const result = command(p, scenario);
    assert.equal(result.code, 1);
    assert.deepEqual(result.frames, [{ scope: 'dedicated-pi-tool', verdict: 'sign-in-required' }]);
  });
}

for (const value of [
  '{bad-json',
  JSON.stringify({ 'openai-codex': { type: 'api_key', key: '!touch private-canary' } }),
  JSON.stringify({ other: { type: 'api_key', key: '!touch private-canary' } }),
]) {
  test('malformed or nonselected credentials are refused before auth, provider dispatch or command execution', async (t) => {
    const p = await fixture(t);
    await writeFile(p.authPath, value);
    const result = command(p);
    assert.equal(result.code, 1);
    assert.deepEqual(result.calls, []);
    assert.equal(await readFile(p.authPath, 'utf8'), value);
  });
}

for (const reclaimer of ['probe', 'login'])
  test(`SIGKILL leaves a sole-process probe lease blocked while it lives; afterwards ${reclaimer} reclaims it`, async (t) => {
    const p = await fixture(t);
    const { args, ...opts } = options(p, 'hold');
    const child = spawn(process.execPath, args, opts);
    const closed = new Promise((resolve) =>
      child.once('close', (code, signal) => resolve({ code, signal })),
    );
    t.after(async () => {
      child.kill('SIGKILL');
      await closed;
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('probe never entered transport')), 10_000);
      child.stdio[3].once('data', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    const preload = new URL('./fixtures/pi-login-preload.mjs?scenario=success', import.meta.url);
    const login = () =>
      spawnSync(
        process.execPath,
        ['--import', preload.href, 'scripts/test-pi-login.mjs', '--run', '--recover'],
        {
          env: {
            HOME: p.home,
            EITRI_PI_LOGIN_HOME: p.home,
            EITRI_PI_LOGIN_CHILD: '1',
            PI_OFFLINE: '1',
          },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
          timeout: 15_000,
        },
      );
    // A live owner blocks both an ordinary probe and explicit fresh-login recovery.
    assert.equal(command(p).code, 1);
    assert.equal(login().status, 1);
    child.kill('SIGKILL');
    assert.equal((await closed).signal, 'SIGKILL');
    if (reclaimer === 'probe') {
      const later = command(p);
      assert.equal(later.code, 0);
      assert.equal(later.frames.at(-1)?.verdict, 'tool-turn-pass');
    } else {
      const recovered = login();
      assert.equal(recovered.error, undefined);
      assert.equal(recovered.status, 0);
      assert.equal(JSON.parse(recovered.stdout).verdict, 'oauth-saved');
    }
    assert.deepEqual(await readdir(p.profile), ['auth.json']);
  });
