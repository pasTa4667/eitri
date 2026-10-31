import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { readdir } from 'node:fs/promises';
import { nativeFixtureProvider, openNativeFixtureController } from './helpers/pi-native.mjs';

const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
const issue = {
  ...policy,
  id: 'offline-repair-budget',
  title: 'Synthetic repair budget',
  priority: 'high',
  status: 'unresolved',
  regressed: false,
  escalating: false,
};
const revision = (n) => String(n).repeat(40);
const history = (c) => ({
  phase: c.phase,
  base: c.base,
  candidate: c.candidate,
  failedCandidate: c.failedCandidate,
  repairs: c.repairs,
  attempt: c.attempt,
  usedMs: c.usedMs,
  remainingMs: c.remainingMs,
});

async function parked(controller, id) {
  const end = Date.now() + 15_000;
  while (true) {
    const view = (await controller.snapshot({ selected: id })).selected;
    if (['paused', 'needs-attention'].includes(view.case.status)) return view;
    assert.ok(Date.now() < end, `Native repair run did not settle: ${JSON.stringify(view.case)}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

for (const stop of ['initial-failure', 'first-repair-failure', 'infrastructure'])
  test(
    `installed native repair budget survives ${stop} and restart`,
    { timeout: 45_000 },
    async (t) => {
      const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-repairs-')));
      let controller,
        now = 1000,
        checkpoints = 0,
        stopped = false;
      const requests = [],
        checks = [],
        states = [];
      const options = {
        directory,
        policy,
        clock: () => now,
        providerForCase: (id) =>
          nativeFixtureProvider(directory, id, requests, {
            fixture: 'repair-budget',
            before: async () => {
              states.push(history((await controller.snapshot({ selected: id })).selected.case));
              now += 3;
            },
          }),
        check: async ({ caseId, kind }) => {
          now += 7;
          const c = (await controller.snapshot({ selected: caseId })).selected.case;
          checks.push({ kind, repairs: c.repairs, candidate: c.candidate });
          // Rechecking the unchanged failed candidate must not spend a repair cycle.
          if (kind === 'checkpoint') checkpoints++;
          const candidate =
            kind === 'baseline' ? 'a'.repeat(40) : revision(Math.max(1, checkpoints - 1));
          if (
            !stopped &&
            kind === 'regression' &&
            (stop === 'initial-failure' ? checkpoints === 1 : checkpoints === 3)
          ) {
            stopped = true;
            if (stop === 'infrastructure') return { type: 'infrastructure' };
            await controller.command({
              requestId: randomUUID(),
              intent: { type: 'pause', caseId },
            });
          }
          return {
            type: 'completed',
            check: {
              kind,
              candidate,
              configuration: 'c'.repeat(64),
              passed: kind !== 'regression',
              simulated: true,
              outputs: [],
            },
          };
        },
      };
      controller = await openNativeFixtureController(options);
      t.after(async () => {
        try {
          await controller.close();
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      });
      const investigate = () =>
        controller.command({
          requestId: randomUUID(),
          intent: { type: 'investigate', issue },
        });
      const { caseId } = await investigate();
      let selected = await parked(controller, caseId);
      assert.equal(selected.case.status, stop === 'infrastructure' ? 'needs-attention' : 'paused');
      assert.equal(selected.case.repairs, stop === 'initial-failure' ? 0 : 1);
      assert.equal(selected.case.attempt, 1);
      assert.equal(selected.case.candidate, revision(stop === 'initial-failure' ? 1 : 2));
      assert.equal(
        selected.case.failedCandidate,
        stop === 'infrastructure' ? null : selected.case.candidate,
      );
      assert.equal(
        selected.checks.length,
        stop === 'initial-failure' ? 3 : stop === 'infrastructure' ? 6 : 7,
      );
      if (stop === 'infrastructure') assert.equal(selected.case.reason, 'check-infrastructure');
      assert.equal(selected.case.usedMs, requests.length * 3 + checks.length * 7);
      assert.equal(selected.case.remainingMs, 600_000 - selected.case.usedMs);
      const saved = history(selected.case),
        messages = selected.messages;
      let count = requests.length;
      await controller.close();
      now += 3_600_000;
      controller = await openNativeFixtureController(options);
      selected = (await controller.snapshot({ selected: caseId })).selected;
      assert.deepEqual(history(selected.case), saved);
      assert.deepEqual(selected.messages, messages);
      assert.equal(requests.length, count);
      assert.equal((await investigate()).caseId, caseId);
      assert.equal(requests.length, count);
      if (stop !== 'infrastructure') {
        await controller.command({
          requestId: randomUUID(),
          expectedControlVersion: selected.case.version,
          intent: { type: 'continue', caseId },
        });
        selected = await parked(controller, caseId);
        assert.equal(selected.case.reason, 'repair-budget-exhausted');
        assert.equal(selected.case.repairs, 2);
        assert.equal(selected.case.attempt, 1);
        assert.equal(selected.case.candidate, revision(3));
        assert.equal(selected.case.failedCandidate, revision(3));
        assert.equal(checkpoints, 4);
        assert.deepEqual(
          checks.map((c) => c.kind),
          [
            'baseline',
            'checkpoint',
            'regression',
            'checkpoint',
            'regression',
            'checkpoint',
            'regression',
            'checkpoint',
            'regression',
          ],
        );
        assert.deepEqual(
          checks.filter((c) => c.kind === 'regression').map((c) => c.repairs),
          [0, 0, 1, 2],
        );
        assert.equal(selected.checks.filter((c) => c.kind === 'regression' && !c.passed).length, 4);
        assert.ok(states.some((c) => c.repairs === 0 && c.failedCandidate === revision(1)));
        assert.ok(states.some((c) => c.repairs === 1 && c.failedCandidate === revision(2)));
      }
      assert.equal(selected.case.usedMs, requests.length * 3 + checks.length * 7);
      assert.equal(selected.case.remainingMs, 600_000 - selected.case.usedMs);
      const final = history(selected.case),
        finalMessages = selected.messages;
      count = requests.length;
      await assert.rejects(
        controller.command({
          requestId: randomUUID(),
          expectedControlVersion: selected.case.version,
          intent: { type: 'continue', caseId },
        }),
        { code: 'cannot-continue' },
      );
      for (let i = 0; i < 2; i++) {
        await controller.close();
        controller = await openNativeFixtureController(options);
        selected = (await controller.snapshot({ selected: caseId })).selected;
        assert.deepEqual(history(selected.case), final);
        assert.deepEqual(selected.messages, finalMessages);
        assert.equal(selected.case.status, 'needs-attention');
        const duplicate = await investigate();
        assert.equal(duplicate.caseId, caseId);
        assert.equal(duplicate.disposition, 'existing');
        assert.equal(requests.length, count, 'parked/exhausted work dispatched');
      }
      // Every actual model request traversed the installed SDK and retained its own action identity.
      assert.ok(requests.length > checks.length);
      assert.equal(new Set(requests.map((r) => r.actionId)).size, requests.length);
      assert.ok(requests.every((r) => r.caseId === caseId));
      const results = requests.flatMap((r) =>
        r.context.messages.filter((m) => m.role === 'toolResult'),
      );
      assert.ok(results.some((r) => r.toolName === 'run_check'));
      assert.ok(results.some((r) => r.toolName === 'complete_assessment'));
    },
  );

test(
  'SIGKILL during the second repair preserves its charge and refuses a third cycle',
  { timeout: 30_000 },
  async (t) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-repair-crash-')));
    const child = fork(
      new URL('./helpers/pi-native-repair-crash.mjs', import.meta.url),
      [directory],
      {
        env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    );
    let controller;
    t.after(async () => {
      const exited =
        child.exitCode !== null || child.signalCode !== null ? null : once(child, 'exit');
      child.kill('SIGKILL');
      if (exited) await exited;
      await controller?.close();
      await rm(directory, { recursive: true, force: true });
    });
    const [boundary] = await Promise.race([
      once(child, 'message'),
      once(child, 'exit').then(() => assert.fail('Repair fixture exited before admission')),
    ]);
    // Earlier helpers are disposed; the interrupted model has not spawned one.
    assert.deepEqual(await readdir(join(directory, 'pi-offline-resources')), []);
    const db = new DatabaseSync(join(directory, 'catalogue.sqlite'), { readOnly: true });
    try {
      const action = JSON.parse(db.prepare('SELECT value FROM actions').get().value);
      assert.equal(action.id, boundary.actionId);
      assert.equal(action.kind, 'model');
      const c = JSON.parse(db.prepare('SELECT value FROM cases').get().value);
      assert.equal(c.status, 'pause-requested');
      assert.equal(c.repairs, 2);
      assert.equal(c.usedMs, 0);
    } finally {
      db.close();
    }
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    assert.deepEqual(await exited, [null, 'SIGKILL']);
    const requests = [],
      checks = [];
    const options = {
      directory,
      policy,
      clock: () => 1000,
      providerForCase: (id) =>
        nativeFixtureProvider(directory, id, requests, { fixture: 'repair-budget' }),
      check: async ({ kind }) => {
        checks.push(kind);
        assert.equal(kind, 'regression', 'exhausted work created another candidate');
        return {
          type: 'completed',
          check: {
            kind,
            candidate: revision(3),
            configuration: 'c'.repeat(64),
            passed: false,
            simulated: true,
            outputs: [],
          },
        };
      },
    };
    controller = await openNativeFixtureController(options);
    let selected = (await controller.snapshot({ selected: boundary.id })).selected;
    assert.equal(selected.case.status, 'paused');
    assert.equal(selected.case.repairs, 2);
    assert.equal(selected.case.attempt, 1);
    assert.equal(selected.case.usedMs, 120_000);
    assert.equal(selected.case.remainingMs, 480_000);
    assert.equal(selected.case.candidate, revision(3));
    assert.equal(selected.case.failedCandidate, null);
    assert.equal(selected.checks.length, 6);
    assert.ok(selected.case.epoch > boundary.epoch);
    assert.equal(requests.length, 0);
    await controller.command({
      requestId: randomUUID(),
      expectedControlVersion: selected.case.version,
      intent: { type: 'continue', caseId: boundary.id },
    });
    selected = await parked(controller, boundary.id);
    assert.equal(selected.case.reason, 'repair-budget-exhausted');
    assert.equal(selected.case.repairs, 2);
    assert.equal(selected.case.failedCandidate, revision(3));
    assert.equal(selected.case.usedMs, 120_000);
    assert.equal(selected.case.remainingMs, 480_000);
    assert.deepEqual(checks, ['regression']);
    assert.equal(requests.length, 1);
    assert.notEqual(requests[0].actionId, boundary.actionId);
    assert.ok(requests[0].epoch > boundary.epoch);
    const saved = history(selected.case),
      messages = selected.messages;
    await controller.close();
    controller = await openNativeFixtureController(options);
    selected = (await controller.snapshot({ selected: boundary.id })).selected;
    assert.deepEqual(history(selected.case), saved);
    assert.deepEqual(selected.messages, messages);
    assert.equal(requests.length, 1);
    assert.deepEqual(checks, ['regression']);
  },
);
