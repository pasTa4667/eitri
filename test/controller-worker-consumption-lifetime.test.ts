import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { Controller } from '../src/controller.ts';
import type { OfflineActionWorkspace } from '../src/controller.ts';
import type { AdmittedCheckRequest } from '../src/domain.ts';
import { FrozenBrowserValidator } from '../src/frozen-browser.ts';
import type { FrozenBrowserConsumptionJournal } from '../src/frozen-browser.ts';
import { WorkspaceStore } from '../src/workspace.ts';
import { gate, journalRows, command, until } from './controller-worker-association-fixture.ts';
import { consumptionController, gateClient } from './controller-worker-consumption-fixture.ts';

for (const exit of ['return', 'throw', 'pause', 'interrupt'] as const)
  test(
    `${exit} explicitly revokes unawaited consumption and Retry cannot restore old authority`,
    { timeout: 30000 },
    async (t) => {
      const client = gateClient(t);
      const finish = gate();
      t.after(() => finish.resolve());
      let now = 1000;
      let wake!: () => void;
      let request!: AdmittedCheckRequest;
      let scope!: OfflineActionWorkspace;
      let pending!: Promise<unknown>;
      let callbacks = 0;
      const f = await consumptionController(t, {
        clock: () => now,
        actionWakeup: (_delay, callback) => {
          wake = callback;
          return () => {};
        },
        check: async (r, source) => {
          callbacks++;
          if (callbacks > 1) {
            await assert.rejects(scope.workerConsumption!.consume(), /action-source-revoked/);
            return { type: 'infrastructure' };
          }
          request = r;
          scope = source!;
          await source!.workerAcceptance!.accept();
          pending = source!.workerConsumption!.consume();
          await finish.promise;
          if (exit === 'throw') throw Error('Synthetic callback failure');
          return { type: 'infrastructure' };
        },
      });
      const id = await f.add();
      await client.entered;
      let pausing: Promise<unknown> | undefined;
      if (exit === 'pause') {
        pausing = f.controller.command(command({ type: 'pause', caseId: id }));
        await until(
          async () => (await f.controller.snapshot()).cases[0],
          (c) => c.status === 'pause-requested' || c.status === 'paused',
        );
      } else if (exit === 'interrupt') {
        now = request.deadlineAt;
        wake();
      } else finish.resolve();
      await until(
        async () => (await f.controller.snapshot()).cases[0],
        (c) => ['needs-attention', 'paused'].includes(c.status),
      );
      await assert.rejects(scope.workerConsumption!.consume(), /action-source-revoked/);
      const pendingView = await f.controller.inspectWorkerAssociation(id, request.actionId);
      assert.equal(pendingView.state, 'matched');
      if (pendingView.state !== 'matched' || pendingView.run.state !== 'accepted')
        return assert.fail('missing acceptance');
      assert.equal(pendingView.run.consumption?.state, 'pending');
      await assert.rejects(
        FrozenBrowserValidator.open({
          directory: f.journalDirectory,
          workspace: {} as never,
          mode: 'journal-only',
        }),
        /validator-already-open/,
      );
      client.release();
      await assert.rejects(pending, /aborted|cancelled|revoked|allowance|dispatch/i);
      await pausing;
      await until(
        async () => journalRows(f.journalDirectory).runs[0].execution.run.result.kind,
        (kind) => kind === 'settled',
      );
      const rows = journalRows(f.journalDirectory);
      assert.equal(rows.meta.attempts, 1);
      assert.equal(rows.meta.contribution, 41943040);
      assert.equal(rows.runs[0].execution.run.result.report.outcome.kind, 'cancelled');
      assert.deepEqual(rows.runs[0].execution.run.result.report.cleanup, {
        kind: 'not-needed',
        cache: 'retained',
      });
      assert.deepEqual((await f.state()).calls, []);
      const selected = (await f.controller.snapshot({ selected: id })).selected!;
      assert.deepEqual(selected.checks, []);
      assert.deepEqual(selected.artifacts, []);
      if (exit !== 'pause') {
        const parked = await f.parked(id);
        await f.controller.command(
          command({ type: 'retry', caseId: id, note: 'Explicit retry' }, parked.version),
        );
        await f.parked(id);
        assert.equal(callbacks, 1);
        assert.equal((await f.controller.snapshot()).cases[0].attempt, 2);
        await assert.rejects(scope.workerConsumption!.consume(), /action-source-revoked/);
      }
      await f.close();
      await f.reopen();
      assert.deepEqual(journalRows(f.journalDirectory), rows);
      assert.deepEqual((await f.state()).calls, []);
      await assert.rejects(scope.workerConsumption!.consume(), /action-source-revoked/);
    },
  );

for (const stage of ['open', 'client', 'cleanup'] as const)
  test(
    `controller close drains gated ${stage} and releases worker and workspace leases after settlement, not callback completion`,
    { timeout: 30000 },
    async (t) => {
      const opened = gate();
      const releaseOpen = gate();
      t.after(() => releaseOpen.resolve());
      const client = gateClient(t, stage === 'cleanup' ? 'cleanup' : 'version');
      const original = FrozenBrowserValidator.open;
      FrozenBrowserValidator.open = (async (
        options: Parameters<typeof original>[0] & { mode?: string },
      ) => {
        const journal = await Reflect.apply(original, FrozenBrowserValidator, [options]);
        if (options.mode === 'consumption-only' && stage === 'open') {
          opened.resolve();
          await releaseOpen.promise;
        }
        return journal;
      }) as typeof original;
      t.after(() => {
        FrozenBrowserValidator.open = original;
      });
      const callback = gate();
      t.after(() => callback.resolve());
      let scope!: OfflineActionWorkspace;
      let pending!: Promise<unknown>;
      let callbackFinished = false;
      const f = await consumptionController(t, {
        clock: () => 1000,
        check: async (_request, source) => {
          scope = source!;
          if (stage === 'open') pending = source!.workerAcceptance!.accept();
          else {
            await source!.workerAcceptance!.accept();
            pending = source!.workerConsumption!.consume();
          }
          await callback.promise;
          callbackFinished = true;
          return { type: 'infrastructure' };
        },
      });
      const id = await f.add();
      if (stage === 'open') await opened.promise;
      else await client.entered;
      let workspaceCloses = 0;
      const workspaceClose = WorkspaceStore.prototype.close;
      WorkspaceStore.prototype.close = async function () {
        workspaceCloses++;
        return Reflect.apply(workspaceClose, this, []);
      };
      t.after(() => {
        WorkspaceStore.prototype.close = workspaceClose;
      });
      const closing = f.controller.close();
      assert.equal(f.controller.close(), closing);
      let closed = false;
      void closing.then(() => {
        closed = true;
      });
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(closed, false);
      assert.equal(workspaceCloses, 0);
      assert.equal(callbackFinished, false);
      await assert.rejects(scope.workerConsumption!.consume(), /action-source-revoked/);
      await assert.rejects(
        FrozenBrowserValidator.open({
          directory: f.journalDirectory,
          workspace: {} as never,
          mode: 'journal-only',
        }),
        /validator-already-open/,
      );
      await assert.rejects(Controller.open(f.options), /controller-already-open/);
      releaseOpen.resolve();
      client.release();
      await assert.rejects(pending, /aborted|cancelled|revoked|dispatch/i);
      await closing;
      assert.equal(workspaceCloses, 1);
      assert.equal(callbackFinished, false);
      const rows = journalRows(f.journalDirectory);
      assert.equal(rows.meta.version, stage === 'open' ? 1 : 3);
      assert.equal(rows.meta.attempts, stage === 'open' ? 0 : 1);
      if (stage !== 'open') {
        assert.equal(rows.runs[0].execution.run.result.kind, 'settled');
        assert.deepEqual(rows.runs[0].execution.run.result.report.cleanup, {
          kind: stage === 'client' ? 'not-needed' : 'owned-removed',
          cache: 'retained',
        });
      }
      const reader = await FrozenBrowserValidator.open({
        directory: f.journalDirectory,
        workspace: {} as never,
        mode: 'journal-only',
      });
      assert.equal((await reader.inventory()).attempts, stage === 'open' ? 0 : 1);
      await reader.close();
      await f.close();
      await f.reopen();
      await f.parked(id);
      assert.equal(callbackFinished, false);
      assert.deepEqual(journalRows(f.journalDirectory), rows);
      assert.equal((await f.controller.snapshot({ selected: id })).selected!.checks.length, 0);
      assert.equal((await f.controller.snapshot({ selected: id })).selected!.artifacts.length, 0);
    },
  );

test(
  'delivery rechecks complete current authority after terminal worker result',
  { timeout: 30000 },
  async (t) => {
    const original = FrozenBrowserValidator.open;
    const ready = gate();
    const release = gate();
    t.after(() => release.resolve());
    FrozenBrowserValidator.open = (async (
      options: Parameters<typeof original>[0] & { mode?: string },
    ) => {
      const journal = await Reflect.apply(original, FrozenBrowserValidator, [options]);
      if (options.mode !== 'consumption-only') return journal;
      const held = journal as unknown as FrozenBrowserConsumptionJournal;
      return Object.freeze({
        ...held,
        consume: async (...args: Parameters<typeof held.consume>) => {
          const result = await held.consume(...args);
          ready.resolve();
          await release.promise;
          return result;
        },
      });
    }) as typeof original;
    t.after(() => {
      FrozenBrowserValidator.open = original;
    });
    let denied = false;
    let actionId = '';
    const f = await consumptionController(t, {
      clock: () => 1000,
      check: async (r, source) => {
        actionId = r.actionId;
        await source!.workerAcceptance!.accept();
        await assert.rejects(
          source!.workerConsumption!.consume(),
          /check-dispatch-denied|action-source-revoked/,
        );
        denied = true;
        return { type: 'infrastructure' };
      },
    });
    await f.add();
    await ready.promise;
    const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
    const row = db.prepare('SELECT value FROM actions WHERE id=?').get(actionId)!;
    const action = JSON.parse(String(row.value));
    db.prepare('UPDATE actions SET value=? WHERE id=?').run(
      JSON.stringify({ ...action, limitMs: action.limitMs - 1 }),
      actionId,
    );
    release.resolve();
    await until(async () => denied, Boolean);
    db.prepare('UPDATE actions SET value=? WHERE id=?').run(JSON.stringify(action), actionId);
    db.close();
    await f.close();
    const rows = journalRows(f.journalDirectory);
    assert.equal(rows.meta.attempts, 1);
    assert.equal(rows.runs[0].execution.run.result.kind, 'settled');
    assert.deepEqual(rows.runs[0].execution.run.result.report.outcome, {
      kind: 'baseline-reproduced',
    });
  },
);
