import test from 'node:test';
import assert from 'node:assert/strict';
import type { OfflineActionWorkspace } from '../src/controller.ts';
import type { FrozenBrowserAcceptance, FrozenBrowserConsumption } from '../src/frozen-browser.ts';
import { journalRows } from './controller-worker-association-fixture.ts';
import { consumptionController } from './controller-worker-consumption-fixture.ts';

for (const kind of ['baseline', 'browser'] as const)
  test(
    `default-clock ${kind} consumption settles once and preserves immutable history`,
    { timeout: 30000 },
    async (t) => {
      let observed: unknown = 'callback-not-entered';
      let accepted!: FrozenBrowserAcceptance;
      let result!: FrozenBrowserConsumption;
      let scope!: OfflineActionWorkspace;
      let actionId = '';
      const f = await consumptionController(
        t,
        {
          check: async (request, source) => {
            scope = source!;
            actionId = request.actionId;
            try {
              accepted = await source!.workerAcceptance!.accept();
              const history = structuredClone(accepted);
              Object.assign(accepted.request.action, { epoch: 999 });
              const results = await Promise.all(
                Array.from({ length: 4 }, () => source!.workerConsumption!.consume()),
              );
              result = structuredClone(results[0]);
              assert.deepEqual(results, Array(4).fill(result));
              Object.assign(results[0].run, { deadline: 0 });
              assert.deepEqual(await source!.workerConsumption!.consume(), result);
              assert.deepEqual(await source!.workerAcceptance!.accept(), history);
              accepted = history;
              observed = result.run.state === 'settled' ? result.run.outcome : result.run;
            } catch (error) {
              observed = { error: String(error) };
            }
            return { type: 'infrastructure' };
          },
        },
        kind,
      );
      const id = await f.add();
      await f.parked(id);
      assert.deepEqual(
        observed,
        kind === 'baseline' ? { kind: 'baseline-reproduced' } : { kind: 'candidate-failed' },
      );
      assert.equal(result.run.state, 'settled');
      assert.deepEqual(result.run.cleanup, { kind: 'owned-removed', cache: 'retained' });
      assert.equal('evidence' in result.run, false);
      const rows = journalRows(f.journalDirectory);
      assert.equal(rows.meta.version, 3);
      assert.equal(rows.meta.attempts, 1);
      assert.equal(rows.meta.contribution, 41943040);
      assert.deepEqual(rows.runs[0].acceptance, { kind: 'offline-acceptance', ...accepted });
      assert.equal(rows.runs[0].execution.run.intent.deadline, result.run.deadline);
      const selected = (await f.controller.snapshot({ selected: id })).selected!;
      assert.deepEqual(selected.checks, []);
      assert.deepEqual(selected.artifacts, []);
      assert.equal(selected.case.simulated, true);
      const state = await f.state();
      assert.equal(state.calls.filter((c) => c[0] === 'build').length, 1);
      assert.equal(state.calls.filter((c) => c[0] === 'start').length, 1);
      assert.equal(state.image, false);
      assert.equal(state.container, null);
      await assert.rejects(scope.workerConsumption!.consume(), /action-source-revoked/);
      await f.close();
      await f.reopen();
      const recovered = await f.controller.inspectWorkerAssociation(id, actionId);
      assert.equal(recovered.state, 'matched');
      if (recovered.state !== 'matched' || recovered.run.state !== 'accepted')
        assert.fail('missing recovered acceptance');
      assert.deepEqual(recovered.run.consumption, result.run);
      assert.deepEqual(journalRows(f.journalDirectory), rows);
      assert.deepEqual(await f.state(), state);
    },
  );
