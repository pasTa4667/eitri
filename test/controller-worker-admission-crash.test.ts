import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { FrozenBrowserValidator } from '../src/frozen-browser.ts';
import { sha256 } from '../src/workspace.ts';
import { consumptionController } from './controller-worker-consumption-fixture.ts';
import {
  forbiddenWorkspace,
  journalRows,
  sources,
} from './controller-worker-association-fixture.ts';

for (const point of ['before-facts', 'after-facts', 'execution'] as const)
  test(
    `SIGKILL at ${point} preserves separate admission and facts commits without historical backfill`,
    { timeout: 30000 },
    async (t) => {
      const f = await consumptionController(t);
      await f.close();
      const child = fork(
        new URL('./controller-worker-admission-crash-worker.ts', import.meta.url),
        [f.directory, JSON.stringify(f.options.offlineWorkerJournal), point],
        { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
      );
      let errors = '';
      child.stderr!.on('data', (bytes) => {
        errors += bytes;
      });
      t.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      });
      const message = await Promise.race([
        once(child, 'message').then(([value]) => value as { id: string; actionId: string }),
        once(child, 'exit').then(() => {
          throw Error(errors);
        }),
      ]);
      const retained = point === 'after-facts' || point === 'execution';
      const beforeKill = journalRows(f.journalDirectory);
      const original = sources(f.directory)[0];
      assert.equal(original.action.id, message.actionId);
      assert.equal(beforeKill.meta.attempts, 1);
      assert.equal(beforeKill.meta.contribution, 41943040);
      assert.equal(Object.hasOwn(original, 'workerExecutionFacts'), retained);
      const record = beforeKill.runs[0];
      assert.deepEqual(record.execution.run.result, { kind: 'pending' });
      assert.deepEqual(record.execution.run.ledger, {
        build: 'not-started',
        image: { kind: 'none' },
        container: { kind: 'none' },
      });
      assert.deepEqual(record.acceptance.request, original.workerIntent.request);
      if (retained)
        assert.deepEqual(original.workerExecutionFacts, {
          consumedRun: {
            acceptanceId: record.acceptance.acceptanceId,
            runId: record.execution.run.intent.runId,
            requestDigest: original.workerIntent.requestDigest,
          },
          admittedAt: record.execution.run.intent.admittedAt,
          deadline: record.execution.run.intent.deadline,
        });
      assert.deepEqual((await f.state()).calls, []);
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      assert.deepEqual(await exited, [null, 'SIGKILL']);
      assert.deepEqual(journalRows(f.journalDirectory), beforeKill);
      const binding = f.options.offlineWorkerJournal!;
      const expectedIdentity = {
        ownerId: binding.ownerId,
        configurationDigest: sha256(binding.configurationDigest),
      };
      const historical = await FrozenBrowserValidator.readHistoricalSelection({
        directory: f.journalDirectory,
        expectedIdentity,
        action: original.workerIntent.request.action,
      });
      assert.equal(historical?.kind, 'consumed');
      if (historical?.kind === 'consumed') assert.equal(historical.history.state, 'pending');
      assert.deepEqual(journalRows(f.journalDirectory), beforeKill);
      let callbacks = 0;
      f.options.check = async () => {
        callbacks++;
        return { type: 'infrastructure' };
      };
      await f.reopen();
      await f.parked(message.id);
      assert.equal(callbacks, 0);
      const readFacts = () =>
        f.controller.inspectWorkerExecutionFacts(message.id, message.actionId);
      assert.deepEqual(
        readFacts(),
        retained
          ? {
              state: 'retained',
              provenance: 'controller-live-consumption',
              intent: original.workerIntent,
              binding: { version: 1, ...f.options.offlineWorkerJournal },
              facts: original.workerExecutionFacts,
            }
          : { state: 'unavailable', reason: 'not-retained-by-controller' },
      );
      const history = await f.controller.inspectWorkerConsumedHistory(message.id, message.actionId);
      assert.equal(history.state, 'consumed');
      if (history.state === 'consumed') {
        assert.equal(history.history.value.state, 'recorded');
        assert.deepEqual(history.independentExecutionPins, readFacts());
        const admission = await f.controller.inspectWorkerConsumedAdmission(
          message.id,
          message.actionId,
        );
        assert.equal(admission.state, 'consumed');
        if (admission.state === 'consumed')
          assert.deepEqual(admission.conversion, { state: 'not-settled' });
      }
      const normalized = journalRows(f.journalDirectory);
      assert.deepEqual(normalized.meta, beforeKill.meta);
      assert.deepEqual(normalized.runs[0].acceptance, beforeKill.runs[0].acceptance);
      assert.deepEqual(
        normalized.runs[0].execution.run.intent,
        beforeKill.runs[0].execution.run.intent,
      );
      assert.deepEqual(
        normalized.runs[0].execution.run.ledger,
        beforeKill.runs[0].execution.run.ledger,
      );
      const journal = await FrozenBrowserValidator.open({
        directory: f.journalDirectory,
        workspace: forbiddenWorkspace,
        mode: 'consumption-only',
        expectedIdentity,
      });
      const { kind: _kind, ...accepted } = beforeKill.runs[0].acceptance;
      const result = await journal.consume(
        accepted,
        () => 60000,
        new AbortController().signal,
        () => {
          throw Error('historical-backfill');
        },
      );
      assert.equal(result.run.state, 'recorded');
      assert.deepEqual(result.run.outcome, {
        kind: 'uncertain',
        code: 'interrupted-run-no-replay',
      });
      await journal.close();
      assert.deepEqual(sources(f.directory)[0].workerExecutionFacts, original.workerExecutionFacts);
      const selected = (await f.controller.snapshot({ selected: message.id })).selected!;
      assert.deepEqual(selected.checks, []);
      assert.deepEqual(selected.artifacts, []);
      assert.deepEqual((await f.state()).calls, []);
    },
  );
