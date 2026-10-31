import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, rm, readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { syntheticProfile } from './helpers/pi-profile.mjs';
import { nativeFixtureProvider, openNativeFixtureController } from './helpers/pi-native.mjs';

const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
async function until(read, accept) {
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await delay(10);
  }
  assert.fail('profile checkpoint timed out');
}
async function fixture(t, profile, hooks = {}, overrides = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-profile-native-')));
  const requests = [],
    helpers = [];
  let effects = 0,
    controller;
  const options = {
    directory,
    policy,
    clock: () => 1000,
    providerForCase: (id) =>
      nativeFixtureProvider(directory, id, requests, {
        profileHome: profile.home,
        ...hooks,
        onSpawn: (helper) => {
          helpers.push(helper);
          hooks.onSpawn?.(helper);
        },
      }),
    probe: async () => {
      effects++;
      return 'Profile native result café ✓';
    },
    ...overrides,
  };
  controller = await openNativeFixtureController(options);
  t.after(async () => {
    await controller.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    requests,
    helpers,
    get effects() {
      return effects;
    },
    get controller() {
      return controller;
    },
    view: async (id) => (await controller.snapshot({ selected: id })).selected,
    async parked(id) {
      return until(
        () => this.view(id),
        (v) => ['needs-attention', 'paused'].includes(v.case.status),
      );
    },
    async add(id = 'profile') {
      return (
        await controller.command({
          requestId: randomUUID(),
          intent: {
            type: 'investigate',
            issue: {
              ...policy,
              id,
              title: 'Offline profile',
              priority: 'high',
              status: 'unresolved',
              regressed: false,
              escalating: false,
            },
          },
        })
      ).caseId;
    },
    async restart() {
      await controller.close();
      controller = await openNativeFixtureController(options);
    },
  };
}

for (const invalid of ['malformed', 'api-key', 'missing-oauth', 'expired'])
  test(
    `native ${invalid} profile parks sign-in required without tool use/fallback; reopen never retries`,
    { timeout: 20000 },
    async (t) => {
      const profile = await syntheticProfile(t);
      await writeFile(
        profile.authPath,
        invalid === 'malformed'
          ? '{'
          : JSON.stringify(
              invalid === 'missing-oauth'
                ? {}
                : {
                    'eitri-offline':
                      invalid === 'api-key'
                        ? { type: 'api_key', key: 'synthetic-forbidden-key' }
                        : {
                            type: 'oauth',
                            access: 'synthetic-only',
                            refresh: 'synthetic-only',
                            expires: 0,
                          },
                  },
            ),
      );
      const bytes = await readFile(profile.authPath);
      const f = await fixture(t, profile);
      const id = await f.add();
      const view = await f.parked(id);
      assert.equal(view.case.reason, 'sign-in-required');
      assert.equal(f.effects, 0);
      assert.equal(f.helpers.length, 1);
      assert.equal(view.case.attempt, 1);
      assert.equal(view.case.repairs, 0);
      await f.restart();
      assert.equal(f.helpers.length, 1);
      assert.equal(f.requests.length, 1);
      assert.deepEqual((await f.view(id)).messages, view.messages);
      assert.equal((await f.view(id)).case.remainingMs, view.case.remainingMs);
      assert.deepEqual(await readFile(profile.authPath), bytes);
      for (const helper of f.helpers) {
        assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
        await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
      }
      assert.ok(!JSON.stringify(view).includes('synthetic-forbidden-key'));
    },
  );

test(
  'unselected command-valued credentials cannot execute during SDK background availability checks',
  { timeout: 20000 },
  async (t) => {
    const profile = await syntheticProfile(t);
    const sentinel = join(profile.home, 'forbidden-key-command');
    const auth = JSON.parse(await readFile(profile.authPath, 'utf8'));
    auth.anthropic = { type: 'api_key', key: `!touch '${sentinel}'` };
    await writeFile(profile.authPath, JSON.stringify(auth));
    const f = await fixture(t, profile);
    const id = await f.add();
    const view = await f.parked(id);
    await assert.rejects(lstat(sentinel), { code: 'ENOENT' });
    assert.equal(view.case.reason, 'sign-in-required');
    assert.equal(f.effects, 0);
  },
);

test(
  'built-in Pi file profile survives native work and case expiry; normal profile and transcript stay credential-free',
  { timeout: 20000 },
  async (t) => {
    const profile = await syntheticProfile(t);
    const normal = join(profile.home, '.pi', 'agent');
    await mkdir(normal, { recursive: true, mode: 0o700 });
    await writeFile(join(normal, 'auth.json'), 'normal-profile-do-not-read', { mode: 0o600 });
    const bytes = await readFile(profile.authPath);
    const f = await fixture(t, profile);
    const id = await f.add();
    const view = await f.parked(id);
    assert.equal(view.case.reason, 'assessment-required');
    assert.equal(f.effects, 1);
    assert.equal(f.requests.length, 2);
    assert.ok(!JSON.stringify(view).includes('synthetic-only'));
    assert.ok(!JSON.stringify(f.requests).includes(profile.authPath));
    await f.controller.command({
      requestId: randomUUID(),
      expectedControlVersion: view.case.version,
      intent: { type: 'dismiss', caseId: id, note: 'End synthetic profile work' },
    });
    const current = await f.view(id);
    await f.controller.command({
      requestId: randomUUID(),
      expectedControlVersion: current.case.version,
      intent: { type: 'details-cleanup', caseId: id, confirmed: true },
    });
    assert.equal((await f.view(id)).case.native, 'expired');
    await f.restart();
    assert.equal(f.requests.length, 2);
    assert.deepEqual(await readFile(profile.authPath), bytes);
    assert.equal(await readFile(join(normal, 'auth.json'), 'utf8'), 'normal-profile-do-not-read');
  },
);

test(
  'Pi owns synthetic rotation in its built-in file store; next native action reuses the saved login',
  { timeout: 20000 },
  async (t) => {
    const profile = await syntheticProfile(t);
    const auth = JSON.parse(await readFile(profile.authPath, 'utf8'));
    auth['eitri-offline'].expires = 0;
    await writeFile(profile.authPath, JSON.stringify(auth));
    const f = await fixture(t, profile, { fixture: 'profile-refresh' });
    const id = await f.add();
    assert.equal((await f.parked(id)).case.reason, 'assessment-required');
    assert.equal(f.effects, 1);
    assert.equal(f.requests.length, 2);
    const rotated = JSON.parse(await readFile(profile.authPath, 'utf8'));
    assert.equal(rotated['eitri-offline'].refresh, 'synthetic-rotated');
    assert.equal((await lstat(profile.authPath)).mode & 0o777, 0o600);
    await f.restart();
    assert.equal(f.requests.length, 2);
    assert.deepEqual(JSON.parse(await readFile(profile.authPath, 'utf8')), rotated);
  },
);

test(
  'pause at a successful model boundary keeps profile usable and Continue retains the allowance',
  { timeout: 20000 },
  async (t) => {
    const profile = await syntheticProfile(t);
    let f,
      paused = false,
      now = 1000;
    f = await fixture(
      t,
      profile,
      {
        before: async (request) => {
          if (paused) return;
          paused = true;
          now += 25;
          await f.controller.command({
            requestId: randomUUID(),
            intent: { type: 'pause', caseId: request.caseId },
          });
        },
      },
      { clock: () => now },
    );
    const id = await f.add();
    const view = await f.parked(id);
    assert.equal(view.case.status, 'paused');
    assert.equal(view.case.usedMs, 25);
    assert.equal(f.effects, 0);
    await f.restart();
    now += 100000;
    const current = await f.view(id);
    await f.controller.command({
      requestId: randomUUID(),
      expectedControlVersion: current.case.version,
      intent: { type: 'continue', caseId: id },
    });
    const stopped = await f.parked(id);
    assert.equal(stopped.case.reason, 'assessment-required');
    assert.equal(stopped.case.usedMs, 25);
    assert.equal(stopped.case.attempt, 1);
    assert.equal(f.requests.length, 2);
  },
);

test(
  'active deadline reaps the profile helper and blocks uncertain credentials without renewing budget',
  { timeout: 20000 },
  async (t) => {
    const profile = await syntheticProfile(t);
    const bytes = await readFile(profile.authPath);
    let now = 1000;
    const f = await fixture(
      t,
      profile,
      {
        onSpawn: (helper) => {
          process.kill(helper.pid, 'SIGSTOP');
          now += 100;
        },
      },
      { clock: () => now, allowanceMs: 100 },
    );
    const id = await f.add();
    const view = await f.parked(id);
    assert.equal(view.case.reason, 'model-action-timed-out');
    assert.equal(view.case.usedMs, 100);
    assert.equal(view.case.remainingMs, 0);
    assert.equal(f.effects, 0);
    assert.equal(f.helpers.length, 1);
    const [helper] = f.helpers;
    assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
    await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
    await f.restart();
    assert.equal(f.requests.length, 1);
    assert.equal((await f.view(id)).case.remainingMs, 0);
    assert.deepEqual(await readFile(profile.authPath), bytes);
    const other = await f.add('blocked-other-case');
    assert.equal((await f.parked(other)).case.reason, 'sign-in-required');
    assert.equal(f.helpers.length, 1);
  },
);

for (const mode of ['orphan', 'orphan-paused'])
  test(
    `profile parent SIGKILL ${mode} preserves charge/pause and refuses uncertain login after orphan reconciliation`,
    { timeout: 25000 },
    async (t) => {
      const profile = await syntheticProfile(t);
      const bytes = await readFile(profile.authPath);
      const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-profile-crash-')));
      const child = fork(
        new URL('./helpers/pi-native-crash.mjs', import.meta.url),
        [directory, mode, profile.home],
        {
          env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR },
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
      );
      let controller, helper;
      t.after(async () => {
        const exited =
          child.exitCode === null && child.signalCode === null ? once(child, 'exit') : null;
        child.kill('SIGKILL');
        if (exited) await exited;
        if (helper) {
          try {
            process.kill(helper.pid, 'SIGCONT');
          } catch {}
        }
        await controller?.close();
        await rm(directory, { recursive: true, force: true });
      });
      const [message] = await Promise.race([
        once(child, 'message'),
        once(child, 'exit').then(() => assert.fail('crash fixture exited early')),
      ]);
      helper = message.helper;
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
      const requests = [],
        spawned = [];
      let effects = 0;
      const options = {
        directory,
        policy,
        clock: () => 1000,
        providerForCase: (id) =>
          nativeFixtureProvider(directory, id, requests, {
            profileHome: profile.home,
            onSpawn: (v) => spawned.push(v),
          }),
        probe: async () => {
          effects++;
          return 'Forbidden';
        },
      };
      await assert.rejects(
        openNativeFixtureController(options, { timeoutMs: 25 }),
        /resource-reconciliation-failed/,
      );
      assert.equal(requests.length, 0);
      process.kill(helper.pid, 'SIGCONT');
      controller = await openNativeFixtureController(options);
      const read = async () => (await controller.snapshot({ selected: message.id })).selected;
      const view = await until(read, (v) => ['paused', 'needs-attention'].includes(v.case.status));
      assert.equal(view.case.status, mode === 'orphan-paused' ? 'paused' : 'needs-attention');
      if (mode === 'orphan') assert.equal(view.case.reason, 'sign-in-required');
      assert.equal(view.case.usedMs, 120000);
      assert.equal(view.case.remainingMs, 480000);
      assert.equal(view.case.attempt, 1);
      assert.equal(view.case.repairs, 0);
      assert.equal(effects, 0);
      assert.deepEqual(spawned, []);
      await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
      assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
      const count = requests.length;
      await controller.close();
      controller = await openNativeFixtureController(options);
      assert.equal((await read()).case.usedMs, 120000);
      assert.equal(requests.length, count);
      assert.deepEqual(await readFile(profile.authPath), bytes);
    },
  );
