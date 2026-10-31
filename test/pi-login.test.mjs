import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function fixture(t) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-login-cli-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const profile = join(home, 'Library', 'Application Support', 'eitri', 'pi');
  return { home, profile, authPath: join(profile, 'auth.json') };
}
function command(p, scenario = 'success', recover = false) {
  const preload = new URL('./fixtures/pi-login-preload.mjs', import.meta.url);
  preload.searchParams.set('scenario', scenario);
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      preload.href,
      'scripts/test-pi-login.mjs',
      '--run',
      ...(recover ? ['--recover'] : []),
    ],
    {
      cwd: new URL('../', import.meta.url),
      env: {
        PATH: process.env.PATH,
        HOME: p.home,
        EITRI_PI_LOGIN_HOME: p.home,
        ...(scenario === 'launcher'
          ? { OPENAI_API_KEY: 'private-ambient', OP_SERVICE_ACCOUNT_TOKEN: 'private-op' }
          : {
              EITRI_PI_LOGIN_CHILD: '1',
              PI_CODING_AGENT_DIR: p.profile,
              PI_OFFLINE: '1',
              PI_SKIP_VERSION_CHECK: '1',
              PI_TELEMETRY: '0',
            }),
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
      timeout: 15_000,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /private-|synthetic-account|authorize\?|refresh_token|access_token/,
  );
  return {
    code: result.status,
    stdout: result.stdout,
    calls: result.output[3]
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  };
}

test('dedicated Pi login saves OAuth through the installed supported runtime, reopens and supports re-login', async (t) => {
  const p = await fixture(t);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = command(p);
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout), {
      scope: 'dedicated-pi-login',
      verdict: 'oauth-saved',
      inference: 'not-performed',
    });
    const auth = JSON.parse(await readFile(p.authPath, 'utf8'));
    assert.deepEqual(Object.keys(auth), ['openai-codex']);
    assert.equal(auth['openai-codex'].type, 'oauth');
    assert.equal(auth['openai-codex'].refresh, 'private-refresh');
    assert.deepEqual(await readdir(p.profile), ['auth.json']);
    assert.equal(result.calls.filter((call) => call.kind === 'exchange').length, 1);
    assert.equal(result.calls.filter((call) => call.kind === 'close').length, 1);
  }
});

for (const scenario of [
  'denied',
  'malformed',
  'cancel',
  'browser-error',
  'deadline',
  'hung-fetch',
]) {
  test(`dedicated Pi login parks ${scenario}; explicit dead-login recovery performs a fresh sign-in`, async (t) => {
    const p = await fixture(t);
    const result = command(p, scenario);
    assert.equal(result.code, 1);
    assert.notEqual(JSON.parse(result.stdout).verdict, 'oauth-saved');
    assert.ok((await readdir(p.profile)).includes('eitri-use'));
    const blocked = command(p);
    assert.equal(blocked.code, 1);
    assert.deepEqual(blocked.calls, []);
    const recovered = command(p, 'success', true);
    assert.equal(recovered.code, 0);
    assert.deepEqual(await readdir(p.profile), ['auth.json']);
  });
}

for (const value of [
  '{bad-json',
  JSON.stringify({ other: { type: 'api_key', key: '!touch private-canary' } }),
  JSON.stringify({ 'openai-codex': { type: 'api_key', key: 'private-key' } }),
]) {
  test('unsafe/non-OAuth credentials fail before browser, token exchange or command-valued key resolution', async (t) => {
    const p = await fixture(t);
    await mkdir(p.profile, { recursive: true, mode: 0o700 });
    await writeFile(p.authPath, value, { mode: 0o600 });
    const result = command(p);
    assert.equal(result.code, 1);
    assert.deepEqual(result.calls, []);
    assert.equal(await readFile(p.authPath, 'utf8'), value);
  });
}

test('live login excludes another process; SIGKILL permits explicit re-login without touching normal Pi or case state', async (t) => {
  const p = await fixture(t);
  const normal = join(p.home, '.pi', 'agent');
  await mkdir(normal, { recursive: true, mode: 0o700 });
  await writeFile(join(normal, 'auth.json'), 'private-normal-profile');
  const caseState = join(p.home, 'case-sentinel');
  await writeFile(caseState, '{"remainingMs":480000,"repairCount":2,"paused":true}');
  const preload = new URL('./fixtures/pi-login-preload.mjs?scenario=hold', import.meta.url);
  const child = spawn(
    process.execPath,
    ['--import', preload.href, 'scripts/test-pi-login.mjs', '--run'],
    {
      cwd: new URL('../', import.meta.url),
      env: {
        PATH: process.env.PATH,
        HOME: p.home,
        EITRI_PI_LOGIN_CHILD: '1',
        EITRI_PI_LOGIN_HOME: p.home,
        PI_OFFLINE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    },
  );
  const closed = new Promise((resolveExit) =>
    child.once('close', (code, signal) => resolveExit({ code, signal })),
  );
  t.after(async () => {
    child.kill('SIGKILL');
    await closed;
  });
  await new Promise((ready, reject) => {
    let data = '';
    const timer = setTimeout(
      () => reject(new Error('synthetic login did not reach exchange')),
      10_000,
    );
    child.stdio[3].on('data', (chunk) => {
      data += chunk;
      if (data.includes('"kind":"exchange"')) {
        clearTimeout(timer);
        ready();
      }
    });
    child.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('login exited before hold'));
    });
  });
  const refused = command(p, 'success', true);
  assert.equal(refused.code, 1);
  assert.deepEqual(refused.calls, []);
  child.kill('SIGKILL');
  assert.deepEqual(await closed, { code: null, signal: 'SIGKILL' });
  const blocked = command(p);
  assert.equal(blocked.code, 1);
  assert.deepEqual(blocked.calls, []);
  const recovered = command(p, 'success', true);
  assert.equal(recovered.code, 0);
  assert.equal(await readFile(join(normal, 'auth.json'), 'utf8'), 'private-normal-profile');
  assert.equal(
    await readFile(caseState, 'utf8'),
    '{"remainingMs":480000,"repairCount":2,"paused":true}',
  );
});

test('launcher passes only fixed clean environment to the disposable login process', async (t) => {
  const p = await fixture(t);
  const result = command(p, 'launcher');
  assert.equal(result.code, 0);
  assert.deepEqual(result.calls, [{ kind: 'clean-launch' }]);
  assert.deepEqual(await readdir(p.home), []);
});
