import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { FrozenBrowserValidator } from '../src/frozen-browser.ts';
import type { FrozenBrowserConsumption } from '../src/frozen-browser.ts';
import type { OfflineActionWorkspace } from '../src/controller.ts';
import { consumptionController, gateClient } from './controller-worker-consumption-fixture.ts';
import {
  gate,
  journalRows,
  sources,
  until,
  forbiddenWorkspace,
} from './controller-worker-association-fixture.ts';
import { traceAdmissionEffects } from './worker-admission-fixture.ts';
import { sha256 } from '../src/workspace.ts';

for (const kind of ['baseline', 'browser'] as const)
  test(`controller ${kind} facts are committed before executeAdmitted and frozen reads`, async (t) => {
    let identity!: { caseId: string; actionId: string };
    let inspected = false;
    const f = await consumptionController(
      t,
      {
        clock: () => 1000,
        check: async (request, source) => {
          identity = request;
          await source!.workerAcceptance!.accept();
          await source!.workerConsumption!.consume();
          return { type: 'infrastructure' };
        },
      },
      kind,
    );
    const effects = traceAdmissionEffects(t, async () => {
      inspected = true;
      const stored = journalRows(f.journalDirectory);
      const run = stored.runs[0].execution.run;
      const facts = {
        consumedRun: {
          acceptanceId: stored.runs[0].acceptance.acceptanceId,
          runId: run.intent.runId,
          requestDigest: run.intent.requestDigest,
        },
        admittedAt: run.intent.admittedAt,
        deadline: run.intent.deadline,
      };
      const source = sources(f.directory)[0];
      assert.deepEqual(source.workerExecutionFacts, facts);
      assert.deepEqual(
        f.controller.inspectWorkerExecutionFacts(identity.caseId, identity.actionId),
        {
          state: 'retained',
          provenance: 'controller-live-consumption',
          intent: source.workerIntent,
          binding: { version: 1, ...f.options.offlineWorkerJournal },
          facts,
        },
      );
      assert.deepEqual(run.result, { kind: 'pending' });
      assert.equal(stored.meta.attempts, 1);
      assert.equal(stored.meta.contribution, 41943040);
      assert.equal(source.workerIntent.request.allowanceMs, 60000);
      assert.deepEqual(effects.counts, {
        executions: 1,
        reads: 0,
        commands: 0,
        saves: 0,
        cleanups: 0,
      });
      assert.deepEqual((await f.state()).calls, []);
    });
    const id = await f.add();
    await f.parked(id);
    assert.equal(inspected, true);
    assert.equal(effects.counts.reads, 1);
    assert.equal((await f.state()).calls.filter((words) => words[0] === 'build').length, 1);
  });

for (const timing of ['completed-drain', 'during-close', 'abandoned'] as const)
  test(`real SQL retention failure ${timing} leaves pending charge, caches rejection and releases resources before failed closure`, async (t) => {
    const ready = gate();
    const finish = gate();
    t.after(() => finish.resolve());
    let scope!: OfflineActionWorkspace;
    let pending!: Promise<PromiseSettledResult<FrozenBrowserConsumption>[]>;
    let closing: Promise<void> | undefined;
    const f = await consumptionController(t, {
      clock: () => 1000,
      check: async (_request, source) => {
        scope = source!;
        await scope.workerAcceptance!.accept();
        pending = Promise.allSettled([
          scope.workerConsumption!.consume(),
          scope.workerConsumption!.consume(),
        ]);
        if (timing !== 'abandoned') await pending;
        await finish.promise;
        return { type: 'infrastructure' };
      },
    });
    const effects = traceAdmissionEffects(t);
    const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
    t.after(() => db.close());
    db.exec(
      "CREATE TRIGGER fail_retention BEFORE UPDATE ON action_sources WHEN json_type(NEW.value,'$.workerExecutionFacts') IS NOT NULL BEGIN SELECT RAISE(ABORT, 'sql-retention-failed'); END",
    );
    const retain = Reflect.get(f.controller, 'retainWorkerExecutionFacts');
    let retentions = 0;
    Reflect.set(f.controller, 'retainWorkerExecutionFacts', (...args: unknown[]) => {
      retentions++;
      try {
        return Reflect.apply(retain, f.controller, args);
      } catch (error) {
        ready.resolve();
        if (timing === 'during-close')
          closing = assert.rejects(f.controller.close(), /worker-close-failed/);
        throw error;
      }
    });
    const id = await f.add();
    await ready.promise;
    const results = await pending;
    for (const result of results) {
      assert.equal(result.status, 'rejected');
      if (result.status === 'rejected') assert.match(String(result.reason), /sql-retention-failed/);
    }
    const committed = journalRows(f.journalDirectory);
    assert.equal(committed.meta.attempts, 1);
    assert.equal(committed.meta.contribution, 41943040);
    assert.deepEqual(committed.runs[0].execution.run.result, { kind: 'pending' });
    assert.deepEqual(committed.runs[0].execution.run.ledger, {
      build: 'not-started',
      image: { kind: 'none' },
      container: { kind: 'none' },
    });
    assert.equal(Object.hasOwn(sources(f.directory)[0], 'workerExecutionFacts'), false);
    db.exec('DROP TRIGGER fail_retention');
    if (timing !== 'during-close')
      await assert.rejects(scope.workerConsumption!.consume(), /sql-retention-failed/);
    assert.equal(retentions, 1);
    assert.deepEqual(journalRows(f.journalDirectory), committed);
    assert.deepEqual(effects.counts, {
      executions: 0,
      reads: 0,
      commands: 0,
      saves: 0,
      cleanups: 0,
    });
    assert.deepEqual((await f.state()).calls, []);
    finish.resolve();
    if (!closing) {
      await f.parked(id);
      await until(
        async () => Reflect.get(f.controller, 'workerDrains').size,
        (size) => size === 0,
      );
      const selected = (await f.controller.snapshot({ selected: id })).selected!;
      assert.deepEqual(selected.checks, []);
      assert.deepEqual(selected.artifacts, []);
      closing = assert.rejects(f.controller.close(), /worker-close-failed/);
    }
    await closing;
    assert.deepEqual(journalRows(f.journalDirectory), committed);
    const journal = await FrozenBrowserValidator.open({
      directory: f.journalDirectory,
      workspace: forbiddenWorkspace,
      mode: 'consumption-only',
      expectedIdentity: {
        ownerId: f.options.offlineWorkerJournal!.ownerId,
        configurationDigest: sha256(f.options.offlineWorkerJournal!.configurationDigest),
      },
    });
    const { kind: _kind, ...accepted } = committed.runs[0].acceptance;
    const historical = await journal.consume(
      accepted,
      () => 60000,
      new AbortController().signal,
      () => {
        throw Error('historical-retention');
      },
    );
    assert.equal(historical.run.state, 'recorded');
    assert.deepEqual(historical.run.outcome, {
      kind: 'uncertain',
      code: 'interrupted-run-no-replay',
    });
    await journal.close();
    await f.reopen();
    const original = sources(f.directory)[0];
    assert.deepEqual(f.controller.inspectWorkerExecutionFacts(id, original.action.id), {
      state: 'unavailable',
      reason: 'not-retained-by-controller',
    });
    assert.equal(
      (await f.controller.inspectWorkerConsumedHistory(id, original.action.id)).state,
      'consumed',
    );
    assert.equal(Object.hasOwn(sources(f.directory)[0], 'workerExecutionFacts'), false);
    await f.close();
  });

for (const race of ['commit-revoked', 'commit-expired', 'execution-revoked'] as const)
  test(`real ${race} retains original admission without restoring delivery authority`, async (t) => {
    let now = 1000;
    const callbackDone = gate();
    let rejection: unknown;
    const f = await consumptionController(t, {
      clock: () => now,
      actionWakeup: () => () => {},
      check: async (_request, source) => {
        await source!.workerAcceptance!.accept();
        try {
          await source!.workerConsumption!.consume();
        } catch (error) {
          rejection = error;
        } finally {
          callbackDone.resolve();
        }
        return { type: 'infrastructure' };
      },
    });
    const revoke = () => {
      const scopes = Reflect.get(f.controller, 'workerScopes') as Map<unknown, { revoke(): void }>;
      assert.equal(scopes.size, 1);
      for (const scope of scopes.values()) scope.revoke();
    };
    if (race !== 'execution-revoked') {
      const exec = DatabaseSync.prototype.exec;
      t.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
        const result = Reflect.apply(exec, this, [sql]);
        if (sql === 'COMMIT') {
          const tables = this.prepare("SELECT name FROM sqlite_master WHERE name='meta'").all();
          if (
            tables.length &&
            JSON.parse(String(this.prepare('SELECT body FROM meta').get()!.body)).attempts === 1
          ) {
            if (race === 'commit-revoked') revoke();
            else {
              const original = sources(f.directory)[0];
              now = original.action.startedAt + original.action.limitMs;
            }
          }
        }
        return result;
      });
    }
    const client = race === 'execution-revoked' ? gateClient(t) : undefined;
    const id = await f.add();
    if (client) {
      await client.entered;
      revoke();
      client.release();
    }
    await f.parked(id);
    await callbackDone.promise;
    assert.match(
      String(rejection),
      /revoked|allowance-exhausted|action-cancelled|worker-authority-denied/,
    );
    const original = sources(f.directory)[0];
    const committed = journalRows(f.journalDirectory).runs[0];
    assert.deepEqual(original.workerExecutionFacts, {
      consumedRun: {
        acceptanceId: committed.acceptance.acceptanceId,
        runId: committed.execution.run.intent.runId,
        requestDigest: original.workerIntent.requestDigest,
      },
      admittedAt: committed.execution.run.intent.admittedAt,
      deadline: committed.execution.run.intent.deadline,
    });
    assert.deepEqual(original.workerIntent.request, committed.acceptance.request);
    const selected = (await f.controller.snapshot({ selected: id })).selected!;
    assert.deepEqual(selected.checks, []);
    assert.deepEqual(selected.artifacts, []);
    await f.close();
    await f.reopen();
    assert.deepEqual(sources(f.directory)[0].workerExecutionFacts, original.workerExecutionFacts);
  });
