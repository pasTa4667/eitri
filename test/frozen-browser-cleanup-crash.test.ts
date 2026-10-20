import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { FrozenBrowserValidator } from '../src/frozen-browser.ts';
import { forbiddenWorkspace, journalRows } from './controller-worker-association-fixture.ts';
import { consumptionFixture } from './frozen-browser-consumption-fixture.ts';
import { cleanupFixture, selector, writeRows } from './frozen-browser-cleanup-fixture.ts';

async function killAtCheckpoint(t: test.TestContext, worker: string, args: string[]) {
  const child = fork(new URL(worker, import.meta.url), args, {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let errors = '';
  child.stderr!.on('data', (bytes) => {
    errors += bytes;
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
  const [message] = await Promise.race([
    once(child, 'message'),
    once(child, 'exit').then(() => {
      throw Error(errors || 'child-exited-before-checkpoint');
    }),
  ]);
  assert.equal(typeof message, 'string');
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  assert.deepEqual(await exited, [null, 'SIGKILL']);
  return message;
}

for (const point of ['execution', 'recorded'] as const)
  test(
    `actual SIGKILL after consumption ${point} is reconciled without execution replay`,
    { timeout: 30000 },
    async (t) => {
      const f = await consumptionFixture(t);
      await f.journal.close();
      await f.workspace.close();
      const message = await killAtCheckpoint(t, './frozen-browser-consumption-crash-worker.ts', [
        f.directory,
        JSON.stringify(f.options.expectedIdentity),
        JSON.stringify(f.accepted),
        point,
      ]);
      assert.equal(message, point === 'execution' ? 'consumption-executed' : 'consumption-staged');
      const before = journalRows(f.directory);
      const run = before.runs[0].execution.run;
      assert.equal(run.result.kind, point === 'execution' ? 'pending' : 'recorded');
      const calls = (await f.state()).calls;
      assert.equal(calls.filter((c) => c[0] === 'start').length, 1);
      assert.equal(
        calls.some((c) => c[1] === 'rm'),
        false,
      );
      const options = {
        ...f.options,
        workspace: forbiddenWorkspace,
        consumedRun: selector(before.runs[0]),
      };
      const result = await FrozenBrowserValidator.reconcileConsumed(options);
      assert.equal(result.run.state, 'settled');
      assert.deepEqual(
        result.run.outcome,
        point === 'recorded'
          ? { kind: 'baseline-reproduced' }
          : { kind: 'uncertain', code: 'interrupted-run-no-replay' },
      );
      assert.deepEqual(result.run.cleanup, { kind: 'owned-removed', cache: 'retained' });
      const after = journalRows(f.directory);
      assert.deepEqual(after.meta, before.meta);
      assert.equal(after.meta.attempts, 1);
      assert.equal(after.meta.contribution, 41943040);
      assert.deepEqual(after.runs[0].acceptance, before.runs[0].acceptance);
      assert.deepEqual(after.runs[0].execution.run.intent, run.intent);
      assert.deepEqual(
        after.runs[0].execution.run.result.report.evidence,
        point === 'recorded' ? run.result.evidence : null,
      );
      const extraCalls = (await f.state()).calls.slice(calls.length);
      assert.equal(
        extraCalls.some((c) => c[0] === 'container' && c[1] === 'rm'),
        true,
      );
      assert.equal(
        extraCalls.some((c) => c[0] === 'image' && c[1] === 'rm'),
        true,
      );
      assert.equal(
        extraCalls.every(
          (c) => ['image', 'container'].includes(c[0]) && ['ls', 'inspect', 'rm'].includes(c[1]),
        ),
        true,
      );
      assert.equal('evidence' in result.run, false);
    },
  );

for (const point of [
  'normalized',
  'acquired',
  'removed',
  'settlement-before',
  'settlement-after',
] as const)
  test(
    `actual SIGKILL at cleanup ${point} permits exact durable retry with one charge`,
    { timeout: 30000 },
    async (t) => {
      const f = await cleanupFixture(t, point === 'normalized');
      f.rows.runs[0].execution.run.ledger.container = { kind: 'intent' };
      writeRows(f.directory, f.rows);
      const { workspace: _workspace, ...wire } = f.cleanupOptions;
      const message = await killAtCheckpoint(t, './frozen-browser-cleanup-crash-worker.ts', [
        JSON.stringify(wire),
        point,
      ]);
      assert.equal(message, 'cleanup-checkpoint');
      const calls = (await f.state()).calls;
      const result = await f.reconcile();
      assert.deepEqual(result.run.cleanup, { kind: 'owned-removed', cache: 'retained' });
      assert.deepEqual(
        result.run.outcome,
        point === 'normalized'
          ? { kind: 'uncertain', code: 'interrupted-run-no-replay' }
          : { kind: 'uncertain', code: 'fixture-uncertain' },
      );
      const after = journalRows(f.directory);
      assert.deepEqual(after.meta, f.rows.meta);
      assert.deepEqual(after.runs[0].acceptance, f.record.acceptance);
      assert.deepEqual(after.runs[0].execution.admission, f.record.execution.admission);
      assert.deepEqual(after.runs[0].execution.run.intent, f.record.execution.run.intent);
      assert.deepEqual(after.runs[0].execution.run.ledger.container, {
        kind: 'acquired',
        id: 'c'.repeat(64),
      });
      assert.equal(after.runs[0].execution.run.result.report.evidence, null);
      const allCalls = (await f.state()).calls;
      assert.equal(allCalls.filter((c) => c[0] === 'container' && c[1] === 'rm').length, 1);
      assert.equal(allCalls.filter((c) => c[0] === 'image' && c[1] === 'rm').length, 1);
      if (point === 'settlement-after') assert.deepEqual(allCalls, calls);
      assert.equal(
        allCalls.every(
          (c) => ['image', 'container'].includes(c[0]) && ['ls', 'inspect', 'rm'].includes(c[1]),
        ),
        true,
      );
      assert.deepEqual(await f.reconcile(), result);
      assert.deepEqual((await f.state()).calls, allCalls);
      const journal = await FrozenBrowserValidator.open({ ...f.options, mode: 'journal-only' });
      assert.equal((await journal.inventory()).attempts, 1);
      await journal.close();
    },
  );
