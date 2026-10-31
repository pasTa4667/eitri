import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtemp,
  realpath,
  rm,
  readFile,
  writeFile,
  lstat,
  readdir,
  mkdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { syntheticProfile } from './helpers/pi-profile.mjs';
import { nativeFixtureProvider, openNativeFixtureController } from './helpers/pi-native.mjs';
import { withDedicatedProfile } from '../prototypes/pi-profile.mjs';
import { streamNativeFixture } from '../prototypes/pi-native-stream.mjs';
import { context } from '../prototypes/pi-stream-fixtures.ts';
import { makeRequest } from '../prototypes/pi-stream-protocol.mjs';

const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
const resultText = 'File Codex result café 🛠️ ✓';
for (const profileHome of [undefined, '/nonexistent-eitri-profile-must-not-be-opened'])
  test(`synthetic Codex file fixture refuses non-generated profile ${profileHome ?? 'missing'}`, async () => {
    await assert.rejects(
      streamNativeFixture(makeRequest(0, context), {
        fixture: 'codex-profile',
        profileHome,
      }),
      { message: 'pi-native-stream-offline-failed' },
    );
  });
async function until(read, accept) {
  const deadline = performance.now() + 8000;
  while (performance.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await delay(10);
  }
  assert.fail('offline Codex profile checkpoint timed out');
}
async function fixture(t, hooks = {}, overrides = {}) {
  const profile = await syntheticProfile(t);
  const initial = {
    'openai-codex': {
      type: 'oauth',
      access: 'synthetic-expired',
      refresh: 'synthetic-refresh',
      expires: 0,
      accountId: 'synthetic-private-account',
    },
  };
  await writeFile(profile.authPath, JSON.stringify(initial));
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-codex-profile-native-')));
  const requests = [],
    helpers = [],
    checkpoints = [];
  let controller,
    effects = 0,
    now = 1000,
    wake,
    receipts = 0;
  const options = {
    directory,
    policy,
    clock: () => now,
    allowanceMs: 1000,
    actionWakeup: (_ms, callback) => {
      wake = callback;
      return () => {};
    },
    providerForCase: (id) =>
      nativeFixtureProvider(directory, id, requests, {
        fixture: 'codex-profile',
        profileHome: profile.home,
        ...hooks,
        onSpawn: (value) => helpers.push(value),
        onCheckpoint: async (point) => {
          checkpoints.push(point);
          await hooks.onCheckpoint?.(point);
        },
      }),
    probe: async () => {
      effects++;
      return resultText;
    },
    fault: (point) => {
      if (point === 'after-model-action-receipt') receipts++;
    },
    ...overrides,
  };
  controller = await openNativeFixtureController(options);
  t.after(async () => {
    await controller.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    profile,
    initial,
    directory,
    requests,
    helpers,
    checkpoints,
    get controller() {
      return controller;
    },
    get effects() {
      return effects;
    },
    get receipts() {
      return receipts;
    },
    advance(ms) {
      now += ms;
    },
    expire() {
      now += 1000;
      wake();
    },
    async add(issueId = 'codex-profile') {
      return (
        await controller.command({
          requestId: randomUUID(),
          intent: {
            type: 'investigate',
            issue: {
              ...policy,
              id: issueId,
              title: 'Synthetic profile',
              priority: 'high',
              status: 'unresolved',
              regressed: false,
              escalating: false,
            },
          },
        })
      ).caseId;
    },
    async view(id) {
      return (await controller.snapshot({ selected: id })).selected;
    },
    async parked(id) {
      return until(
        () => this.view(id),
        (v) => ['paused', 'needs-attention'].includes(v.case.status),
      );
    },
    async restart(elapsedMs = 100000) {
      await controller.close();
      now += elapsedMs;
      controller = await openNativeFixtureController(options);
    },
    async disposed() {
      for (const helper of helpers) {
        assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
        await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
      }
    },
  };
}

for (const pause of [false, true])
  test(
    `built-in file rotation joins native SQLite and reuses saved auth, pause=${pause}`,
    { timeout: 20000 },
    async (t) => {
      let f,
        paused = false;
      f = await fixture(t, {
        onCheckpoint: async (point) => {
          if (pause && !paused && point === 'refresh-response') {
            paused = true;
            await f.controller.command({
              requestId: randomUUID(),
              intent: { type: 'pause', caseId: f.requests[0].caseId },
            });
          }
        },
      });
      const id = await f.add();
      let view = await f.parked(id);
      assert.deepEqual(f.checkpoints, [
        'refresh-response',
        'provider-request',
        ...(pause ? [] : ['provider-request']),
      ]);
      const saved = JSON.parse(await readFile(f.profile.authPath, 'utf8'));
      assert.equal(saved['openai-codex'].refresh, 'synthetic-rotated');
      assert.ok(saved['openai-codex'].expires > Date.now());
      assert.equal((await lstat(f.profile.authPath)).mode & 0o777, 0o600);
      await f.disposed();
      await assert.rejects(lstat(join(f.profile.profile, 'eitri-use')), { code: 'ENOENT' });
      if (pause) {
        assert.equal(view.case.status, 'paused');
        assert.equal(f.effects, 0);
        await f.restart();
        view = await f.view(id);
        assert.equal(view.case.status, 'paused');
        assert.equal(f.requests.length, 1);
        await f.controller.command({
          requestId: randomUUID(),
          expectedControlVersion: view.case.version,
          intent: { type: 'continue', caseId: id },
        });
        view = await f.parked(id);
      }
      assert.equal(view.case.reason, 'assessment-required');
      // At a model-boundary pause the denied tool is recorded, never replayed on Continue.
      assert.equal(f.effects, pause ? 0 : 1);
      assert.equal(f.requests.length, 2);
      const result = f.requests[1].context.messages.find((m) => m.role === 'toolResult');
      assert.equal(result.isError, pause);
      if (!pause) assert.deepEqual(result.content, [{ type: 'text', text: resultText }]);
      assert.equal(view.case.usedMs, 0);
      assert.equal(view.case.remainingMs, 1000);
      assert.equal(view.case.attempt, 1);
      assert.equal(view.case.repairs, 0);
      assert.ok(!JSON.stringify(view).includes('synthetic-private'));
      assert.ok(!JSON.stringify(f.requests).includes(f.profile.authPath));
      await f.disposed();
      await f.restart();
      assert.deepEqual((await f.view(id)).messages, view.messages);
      assert.equal(f.requests.length, 2);
      assert.deepEqual(JSON.parse(await readFile(f.profile.authPath, 'utf8')), saved);
    },
  );

for (const boundary of ['refresh-response', 'provider-request'])
  for (const mode of ['deadline', 'close'])
    test(
      `native ${mode} at ${boundary} reaps before receipt and blocks uncertain profile`,
      { timeout: 20000 },
      async (t) => {
        const reached = Promise.withResolvers(),
          releaseCheckpoint = Promise.withResolvers();
        const cleaning = Promise.withResolvers(),
          releaseCleanup = Promise.withResolvers();
        let held = false;
        t.after(() => {
          releaseCheckpoint.resolve();
          releaseCleanup.resolve();
        });
        const f = await fixture(t, {
          onCheckpoint: async (point) => {
            if (point === boundary) {
              reached.resolve();
              await releaseCheckpoint.promise;
            }
          },
          beforeCleanup: async () => {
            if (!held) {
              held = true;
              cleaning.resolve();
              await releaseCleanup.promise;
            }
          },
        });
        const id = await f.add();
        await reached.promise;
        assert.equal(f.effects, 0);
        assert.equal(f.receipts, 0);
        const saved = JSON.parse(await readFile(f.profile.authPath, 'utf8'));
        assert.equal(
          saved['openai-codex'].refresh,
          boundary === 'refresh-response' ? 'synthetic-refresh' : 'synthetic-rotated',
        );
        await assert.rejects(
          withDedicatedProfile(f.profile.home, () => assert.fail('concurrent profile use')),
          { message: 'profile-in-use' },
        );
        let closed = false;
        const closing =
          mode === 'close'
            ? f.controller.close().then(() => {
                closed = true;
              })
            : undefined;
        if (mode === 'deadline') f.expire();
        await cleaning.promise;
        assert.throws(() => process.kill(f.helpers[0].pid, 0), { code: 'ESRCH' });
        assert.ok((await lstat(f.helpers[0].home)).isDirectory());
        const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'), { readOnly: true });
        try {
          assert.equal(
            db.prepare('SELECT count(*) AS n FROM actions WHERE case_id=?').get(id).n,
            1,
          );
        } finally {
          db.close();
        }
        // Let asynchronous filesystem disposal/SQLite callbacks run too, not just microtasks.
        // A deliberate non-awaited-cleanup mutation must retire the action and fail this oracle.
        await delay(100);
        assert.ok((await lstat(f.helpers[0].home)).isDirectory());
        assert.equal(closed, false);
        assert.equal(f.receipts, 0);
        assert.equal(f.requests.length, 1);
        releaseCleanup.resolve();
        if (closing) await closing;
        else assert.equal((await f.parked(id)).case.reason, 'model-action-timed-out');
        await f.disposed();
        await assert.rejects(
          withDedicatedProfile(f.profile.home, () => assert.fail('uncertain profile reuse')),
          { message: 'sign-in-required' },
        );
        const count = f.requests.length;
        await f.restart();
        const view = await f.parked(id);
        assert.equal(f.effects, 0);
        assert.equal(view.case.attempt, 1);
        assert.equal(view.case.repairs, 0);
        if (mode === 'deadline') {
          assert.equal(view.case.remainingMs, 0);
          assert.equal(view.case.usedMs, 1000);
        } else {
          assert.equal(view.case.reason, 'sign-in-required');
          assert.equal(view.case.usedMs, 0);
          assert.equal(view.case.remainingMs, 1000);
        }
        const messages = view.messages;
        releaseCheckpoint.resolve(); // Late hook completion cannot revive a dead helper/action.
        await f.restart();
        assert.equal(
          f.requests.length,
          count,
          'cooperative failure is already parked, not replayed',
        );
        assert.deepEqual((await f.view(id)).messages, messages);
        assert.deepEqual(JSON.parse(await readFile(f.profile.authPath, 'utf8')), saved);
        assert.ok(!JSON.stringify(view).includes('synthetic-private'));
      },
    );

test(
  'throwing trusted refresh checkpoint still reaps and blocks uncertain auth',
  { timeout: 20000 },
  async (t) => {
    const f = await fixture(t, {
      onCheckpoint: () => {
        throw new Error('synthetic-private-hook-failure');
      },
    });
    const id = await f.add();
    const view = await f.parked(id);
    assert.equal(view.case.reason, 'sign-in-required');
    assert.deepEqual(f.checkpoints, ['refresh-response']);
    assert.equal(f.effects, 0);
    await f.disposed();
    await f.restart();
    assert.equal(f.requests.length, 1);
    assert.deepEqual(JSON.parse(await readFile(f.profile.authPath, 'utf8')), f.initial);
    assert.ok(!JSON.stringify(view).includes('synthetic-private'));
  },
);

test(
  'built-in file refresh rejection blocks sign-in without tool effects or automatic retry',
  { timeout: 20000 },
  async (t) => {
    const f = await fixture(t, { fixture: 'codex-profile-denied' });
    const id = await f.add();
    const view = await f.parked(id);
    assert.equal(view.case.reason, 'sign-in-required');
    assert.deepEqual(f.checkpoints, ['refresh-response']);
    assert.equal(f.effects, 0);
    assert.deepEqual(JSON.parse(await readFile(f.profile.authPath, 'utf8')), f.initial);
    await f.disposed();
    await f.restart();
    assert.equal(f.requests.length, 1);
    assert.equal((await f.view(id)).case.remainingMs, view.case.remainingMs);
    assert.ok(!JSON.stringify(view).includes('synthetic-private'));
  },
);

test(
  'offline file composition rejects command-valued extra credentials before SDK construction',
  { timeout: 20000 },
  async (t) => {
    const f = await fixture(t);
    const sentinel = join(f.profile.home, 'forbidden-command');
    await writeFile(
      f.profile.authPath,
      JSON.stringify({ ...f.initial, anthropic: { type: 'api_key', key: `!touch '${sentinel}'` } }),
    );
    const id = await f.add();
    assert.equal((await f.parked(id)).case.reason, 'sign-in-required');
    assert.deepEqual(f.checkpoints, []);
    assert.equal(f.effects, 0);
    await assert.rejects(lstat(sentinel), { code: 'ENOENT' });
    await f.disposed();
    assert.deepEqual((await readdir(f.profile.profile)).sort(), ['auth.json', 'eitri-use']);
  },
);

for (const expiry of ['maintain', 'reopen', 'explicit'])
  test(
    `built-in Codex rotated profile survives ${expiry} expiry of only the terminal case`,
    { timeout: 20000 },
    async (t) => {
      const f = await fixture(t);
      const normal = join(f.profile.home, '.pi', 'agent');
      await mkdir(normal, { recursive: true, mode: 0o700 });
      const normalPath = join(normal, 'auth.json');
      await writeFile(normalPath, 'normal-profile-do-not-use', { mode: 0o600 });
      const normalInode = (await lstat(normalPath)).ino;
      const ids = [];
      const views = [];
      for (const issue of ['expiry-terminal', 'expiry-unfinished']) {
        const id = await f.add(issue);
        ids.push(id);
        views.push(await f.parked(id));
      }
      const [a, b] = ids;
      const casePath = (id) => join(f.directory, 'cases', id);
      const bInode = (await lstat(join(casePath(b), 'session.sqlite'))).ino;
      const authBytes = await readFile(f.profile.authPath);
      assert.equal(JSON.parse(authBytes)['openai-codex'].refresh, 'synthetic-rotated');
      assert.deepEqual(f.checkpoints, [
        'refresh-response',
        'provider-request',
        'provider-request',
        'provider-request',
        'provider-request',
      ]);
      assert.equal(f.effects, 2);
      assert.equal(f.requests.length, 4);
      await f.disposed();
      await assert.rejects(
        f.controller.command({
          requestId: randomUUID(),
          expectedControlVersion: views[1].case.version,
          intent: { type: 'details-cleanup', caseId: b, confirmed: true },
        }),
        { code: 'unfinished-case-protected' },
      );
      await f.controller.command({
        requestId: randomUUID(),
        expectedControlVersion: views[0].case.version,
        intent: { type: 'dismiss', caseId: a, note: 'End synthetic Codex case' },
      });
      if (expiry === 'explicit') {
        const current = await f.view(a);
        await f.controller.command({
          requestId: randomUUID(),
          expectedControlVersion: current.case.version,
          intent: { type: 'details-cleanup', caseId: a, confirmed: true },
        });
      } else {
        f.advance(30 * 86400000 - 1);
        await f.controller.maintain();
        assert.equal((await f.view(a)).case.native, 'ready');
        assert.ok((await lstat(join(casePath(a), 'session.sqlite'))).isFile());
        f.advance(1);
        if (expiry === 'maintain') await f.controller.maintain();
        else await f.restart(0);
      }
      const assertPreserved = async () => {
        const expired = await f.view(a),
          preserved = await f.view(b);
        assert.equal(expired.case.native, 'expired');
        assert.equal(expired.case.outcome, 'dismissed');
        assert.deepEqual(expired.messages, []);
        await assert.rejects(lstat(casePath(a)), { code: 'ENOENT' });
        assert.equal(preserved.case.native, 'ready');
        assert.deepEqual(preserved.messages, views[1].messages);
        for (const key of ['status', 'reason', 'usedMs', 'remainingMs', 'attempt', 'repairs'])
          assert.equal(preserved.case[key], views[1].case[key]);
        assert.equal((await lstat(join(casePath(b), 'session.sqlite'))).ino, bInode);
        assert.deepEqual(await readdir(join(f.directory, 'cases')), [b]);
        assert.deepEqual(await readFile(f.profile.authPath), authBytes);
        assert.equal((await lstat(f.profile.authPath)).mode & 0o777, 0o600);
        assert.equal(await readFile(normalPath, 'utf8'), 'normal-profile-do-not-use');
        assert.equal((await lstat(normalPath)).ino, normalInode);
        assert.deepEqual(await readdir(f.profile.profile), ['auth.json']);
        assert.deepEqual(await readdir(join(f.directory, 'pi-offline-resources')), []);
        assert.equal(f.requests.length, 4);
        assert.equal(f.helpers.length, 4);
        assert.equal(f.effects, 2);
        assert.ok(!JSON.stringify(preserved).includes('synthetic-private'));
        assert.ok(!JSON.stringify(f.requests).includes(f.profile.authPath));
        await f.disposed();
      };
      await assertPreserved();
      assert.equal(await f.add('expiry-terminal'), a, 'duplicate intake retains expired owner');
      await assert.rejects(
        f.controller.command({
          requestId: randomUUID(),
          intent: { type: 'post-message', caseId: a, text: 'Must not recreate native details' },
        }),
        { code: 'details-unavailable' },
      );
      await f.restart();
      await assertPreserved();
    },
  );
