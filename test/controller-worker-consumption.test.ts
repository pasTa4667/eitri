import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Controller } from '../src/controller.ts';
import type { OfflineActionWorkspace } from '../src/controller.ts';
import { FrozenBrowserValidator } from '../src/frozen-browser.ts';
import type { FrozenBrowserAcceptance, FrozenBrowserConsumption } from '../src/frozen-browser.ts';
import {
  fixture,
  gate,
  journalRows,
  sources,
  until,
  providerFor,
  investigate,
} from './controller-worker-association-fixture.ts';
import { consumptionController, gateClient } from './controller-worker-consumption-fixture.ts';

async function noNativeEvidence(controller: Controller, id: string) {
  const selected = (await controller.snapshot({ selected: id })).selected!;
  assert.deepEqual(selected.checks, []);
  assert.deepEqual(selected.artifacts, []);
  assert.equal(selected.case.simulated, true);
}

for (const kind of ['baseline', 'browser'] as const)
  test(
    `${kind} callback consumes captured acceptance once and inspection observes pending without waiting for execution`,
    { timeout: 30000 },
    async (t) => {
      const client = gateClient(t);
      const finish = gate();
      const consumed = gate();
      t.after(() => finish.resolve());
      let scope!: OfflineActionWorkspace;
      let accepted!: FrozenBrowserAcceptance;
      let result!: FrozenBrowserConsumption;
      let actionId = '';
      const f = await consumptionController(
        t,
        {
          clock: () => 1000,
          check: async (request, source) => {
            actionId = request.actionId;
            scope = source!;
            assert.equal(Object.isFrozen(source), true);
            assert.equal(Object.isFrozen(source!.workerConsumption), true);
            accepted = await source!.workerAcceptance!.accept();
            const original = structuredClone(accepted);
            Object.assign(accepted.request.action, { epoch: 999 });
            const pendingInspection = f.controller.inspectWorkerAssociation(
              request.caseId,
              request.actionId,
            );
            const runs = Array.from({ length: 6 }, () => source!.workerConsumption!.consume());
            assert.equal((await pendingInspection).state, 'matched');
            const results = await Promise.all(runs);
            result = structuredClone(results[0]);
            assert.deepEqual(results, Array(6).fill(result));
            Object.assign(results[0].run, { deadline: 0 });
            assert.deepEqual(await source!.workerConsumption!.consume(), result);
            assert.deepEqual(await source!.workerAcceptance!.accept(), original);
            accepted = original;
            consumed.resolve();
            await finish.promise;
            return { type: 'infrastructure' };
          },
        },
        kind,
      );
      const id = await f.add();
      await client.entered;
      const association = await f.controller.inspectWorkerAssociation(id, actionId);
      assert.equal(association.state, 'matched');
      if (association.state !== 'matched' || association.run.state !== 'accepted')
        return assert.fail('missing acceptance');
      assert.equal(association.run.consumption?.state, 'pending');
      assert.equal(association.run.request.action.epoch, sources(f.directory)[0].action.epoch);
      assert.equal(journalRows(f.journalDirectory).meta.attempts, 1);
      assert.equal(journalRows(f.journalDirectory).meta.contribution, 41943040);
      Object.assign(association.run.consumption!, { deadline: 0 });
      const again = await f.controller.inspectWorkerAssociation(id, actionId);
      if (again.state !== 'matched' || again.run.state !== 'accepted')
        return assert.fail('lost acceptance');
      assert.notEqual(again.run.consumption!.deadline, 0);
      await noNativeEvidence(f.controller, id);
      client.release();
      await consumed.promise;
      assert.equal(result.acceptanceId, accepted.acceptanceId);
      assert.equal(result.run.state, 'settled');
      assert.deepEqual(result.run.outcome, {
        kind: kind === 'baseline' ? 'baseline-reproduced' : 'candidate-failed',
      });
      assert.deepEqual(result.run.cleanup, { kind: 'owned-removed', cache: 'retained' });
      assert.equal('evidence' in result.run, false);
      finish.resolve();
      await f.parked(id);
      await assert.rejects(scope.workerConsumption!.consume(), /action-source-revoked/);
      await noNativeEvidence(f.controller, id);
      const state = await f.state();
      assert.equal(state.calls.filter((c) => c[0] === 'build').length, 1);
      assert.equal(state.calls.filter((c) => c[0] === 'start').length, 1);
      await f.close();
      await f.reopen();
      const recovered = await f.controller.inspectWorkerAssociation(id, actionId);
      assert.equal(recovered.state, 'matched');
      if (recovered.state !== 'matched' || recovered.run.state !== 'accepted')
        return assert.fail('missing recovered acceptance');
      assert.deepEqual(recovered.run.consumption, result.run);
      assert.deepEqual(await f.state(), state);
      await assert.rejects(scope.workerConsumption!.consume(), /action-source-revoked/);
    },
  );

test('consumption requires explicit completed acceptance and never opens implicitly', async (t) => {
  const opened = gate();
  const release = gate();
  t.after(() => release.resolve());
  const original = FrozenBrowserValidator.open;
  let opens = 0;
  FrozenBrowserValidator.open = (async (
    options: Parameters<typeof original>[0] & { mode?: string },
  ) => {
    const journal = await Reflect.apply(original, FrozenBrowserValidator, [options]);
    if (options.mode === 'consumption-only') {
      opens++;
      opened.resolve();
      await release.promise;
    }
    return journal;
  }) as typeof original;
  t.after(() => {
    FrozenBrowserValidator.open = original;
  });
  let denied = 0;
  const f = await consumptionController(t, {
    check: async (request, source) => {
      await assert.rejects(source!.workerConsumption!.consume(), /worker-acceptance-required/);
      assert.equal(opens, 0);
      denied++;
      const inspecting = f.controller.inspectWorkerAssociation(request.caseId, request.actionId);
      const accepting = source!.workerAcceptance!.accept();
      await opened.promise;
      await assert.rejects(source!.workerConsumption!.consume(), /worker-acceptance-required/);
      denied++;
      release.resolve();
      await accepting;
      const association = await inspecting;
      assert.equal(association.state === 'matched' || association.state === 'absent', true);
      if (association.state === 'matched' || association.state === 'absent')
        assert.deepEqual(association.intent.request.action, {
          caseId: request.caseId,
          actionId: request.actionId,
          epoch: request.epoch,
        });
      return { type: 'infrastructure' };
    },
  });
  const id = await f.add();
  await f.parked(id);
  assert.equal(denied, 2);
  assert.equal(opens, 1);
  assert.equal(journalRows(f.journalDirectory).meta.version, 2);
  assert.equal(journalRows(f.journalDirectory).meta.attempts, 0);
  assert.deepEqual((await f.state()).calls, []);
  await noNativeEvidence(f.controller, id);
});

test('literal consumption opt-in requires all prerequisites and is captured before awaits', async (t) => {
  const f = await fixture(t);
  await f.close();
  for (const value of [false, null, 0, 1, 'true', {}, Promise.resolve(true)]) {
    const options = { ...f.options };
    Reflect.set(options, 'offlineWorkerConsumption', value);
    await assert.rejects(Controller.open(options), /invalid-offline-worker-consumption/);
  }
  for (const change of [
    { offlineWorkspace: undefined },
    { offlineWorkerJournal: undefined },
    { offlineWorkerAcceptance: undefined },
  ])
    await assert.rejects(
      Controller.open({
        ...f.options,
        offlineWorkerAcceptance: true,
        offlineWorkerConsumption: true,
        ...change,
      }),
      /offline-worker-consumption-configuration-required/,
    );
  let controller!: Controller;
  let enabled = false;
  const options = {
    ...f.options,
    offlineWorkerAcceptance: true as const,
    offlineWorkerConsumption: true as const,
    providerForCase: providerFor(() => controller),
    check: async (_request: unknown, source?: OfflineActionWorkspace) => {
      enabled = source?.workerConsumption !== undefined;
      return { type: 'infrastructure' as const };
    },
  };
  const opening = Controller.open(options);
  Reflect.set(options, 'offlineWorkerConsumption', false);
  controller = await opening;
  try {
    const id = (await controller.command(investigate())).caseId!;
    await until(
      async () => (await controller.snapshot()).cases.find((c) => c.id === id)!,
      (c) => c.status === 'needs-attention',
    );
    assert.equal(enabled, true);
    assert.equal(journalRows(f.journalDirectory).meta.version, 1);
  } finally {
    await controller.close();
  }
});

for (const [acceptance, consumption, kind] of [
  [false, false, 'browser'],
  [true, false, 'browser'],
  [true, true, 'unit'],
] as const)
  test(`disabled capability remains compatible for ${acceptance} ${consumption} ${kind}`, async (t) => {
    let keys: string[] = [];
    const f = await fixture(
      t,
      {
        offlineWorkerAcceptance: acceptance ? true : undefined,
        offlineWorkerConsumption: consumption ? true : undefined,
        check: async (_request, source) => {
          keys = Object.keys(source!);
          if (source!.workerAcceptance) await source!.workerAcceptance.accept();
          return { type: 'infrastructure' };
        },
      },
      kind,
    );
    const id = await f.add();
    await f.parked(id);
    assert.equal(keys.includes('workerConsumption'), false);
    assert.equal(keys.includes('workerAcceptance'), acceptance && kind === 'browser');
    assert.equal(
      journalRows(f.journalDirectory).meta.version,
      acceptance && kind === 'browser' ? 2 : 1,
    );
    assert.equal(journalRows(f.journalDirectory).meta.attempts, 0);
  });

for (const delta of [-1, 0, 1])
  test(
    `current controller D${delta < 0 ? '' : '+'}${delta} with withheld wakeups uses distinct worker time`,
    { timeout: 30000 },
    async (t) => {
      let now = 1000;
      const originalNow = Date.now;
      const workerNow = originalNow() + 900000;
      Date.now = () => workerNow;
      t.after(() => {
        Date.now = originalNow;
      });
      let admitted = false;
      const f = await consumptionController(t, {
        clock: () => now,
        actionWakeup: () => () => {},
        check: async (request, source) => {
          await source!.workerAcceptance!.accept();
          now = request.deadlineAt + delta;
          if (delta < 0) {
            await source!.workerConsumption!.consume().catch(() => {});
            admitted = true;
          } else
            await assert.rejects(
              source!.workerConsumption!.consume(),
              /check-allowance-exhausted|action-source-revoked/,
            );
          return { type: 'infrastructure' };
        },
      });
      const id = await f.add();
      await f.parked(id);
      assert.equal(admitted, delta < 0);
      const rows = journalRows(f.journalDirectory);
      assert.equal(rows.meta.attempts, delta < 0 ? 1 : 0);
      assert.equal(rows.meta.version, delta < 0 ? 3 : 2);
      if (delta < 0) {
        assert.equal(rows.runs[0].execution.run.intent.admittedAt, workerNow);
        assert.equal(rows.runs[0].execution.run.intent.deadline, workerNow + 1);
      } else assert.deepEqual((await f.state()).calls, []);
      await noNativeEvidence(f.controller, id);
    },
  );

for (const elapsed of [12345, 60000])
  test(
    `delayed pinned opening consumes only D-now after ${elapsed}ms preparation`,
    { timeout: 30000 },
    async (t) => {
      const opened = gate();
      const release = gate();
      t.after(() => release.resolve());
      let now = 1000;
      const original = FrozenBrowserValidator.open;
      FrozenBrowserValidator.open = (async (
        options: Parameters<typeof original>[0] & { mode?: string },
      ) => {
        const journal = await Reflect.apply(original, FrozenBrowserValidator, [options]);
        if (options.mode === 'consumption-only') {
          opened.resolve();
          await release.promise;
        }
        return journal;
      }) as typeof original;
      t.after(() => {
        FrozenBrowserValidator.open = original;
      });
      let result: FrozenBrowserConsumption | undefined;
      let denied = false;
      const f = await consumptionController(t, {
        clock: () => now,
        actionWakeup: () => () => {},
        check: async (_request, source) => {
          const accepting = source!.workerAcceptance!.accept();
          if (elapsed === 60000) {
            await assert.rejects(accepting, /check-allowance-exhausted|action-source-revoked/);
            denied = true;
          } else {
            const accepted = await accepting;
            assert.equal(accepted.request.allowanceMs, 60000);
            result = await source!.workerConsumption!.consume();
          }
          return { type: 'infrastructure' };
        },
      });
      const id = await f.add();
      await opened.promise;
      now += elapsed;
      release.resolve();
      await f.parked(id);
      if (result) assert.equal(result.run.deadline - result.run.admittedAt, 60000 - elapsed);
      assert.equal(denied, elapsed === 60000);
      assert.equal(journalRows(f.journalDirectory).meta.attempts, elapsed === 60000 ? 0 : 1);
      assert.equal(journalRows(f.journalDirectory).meta.version, elapsed === 60000 ? 1 : 3);
    },
  );

test('authority loss after worker staging rolls back consumption without charge or upgrade', async (t) => {
  let now = 1000;
  let denied = false;
  const original = DatabaseSync.prototype.exec;
  t.after(() => {
    DatabaseSync.prototype.exec = original;
  });
  const f = await consumptionController(t, {
    clock: () => now,
    actionWakeup: () => () => {},
    check: async (_request, source) => {
      await source!.workerAcceptance!.accept();
      DatabaseSync.prototype.exec = function (sql) {
        const result = Reflect.apply(original, this, [sql]);
        if (sql === 'BEGIN IMMEDIATE') now += 60000;
        return result;
      };
      try {
        await assert.rejects(
          source!.workerConsumption!.consume(),
          /check-allowance-exhausted|action-source-revoked/,
        );
        denied = true;
      } finally {
        DatabaseSync.prototype.exec = original;
      }
      return { type: 'infrastructure' };
    },
  });
  const id = await f.add();
  await f.parked(id);
  await until(async () => denied, Boolean);
  const rows = journalRows(f.journalDirectory);
  assert.equal(rows.meta.version, 2);
  assert.equal(rows.meta.attempts, 0);
  assert.equal(rows.meta.contribution, 0);
  assert.equal(rows.runs[0].kind, 'offline-acceptance');
  assert.deepEqual((await f.state()).calls, []);
  await noNativeEvidence(f.controller, id);
});
