import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerExecutionScope } from '../src/worker-execution-scope.ts';
import type { FrozenBrowserAdmissionObserver } from '../src/frozen-browser.ts';
import { consumptionFixture, deferred } from './frozen-browser-consumption-fixture.ts';
import { journalRows } from './controller-worker-association-fixture.ts';
import { traceAdmissionEffects } from './worker-admission-fixture.ts';

for (const mode of ['throw-undefined', 'async', 'thenable', 'detach'] as const)
  test(`scope remembers ${mode} observer failure through cached consumption and released drainage`, async (t) => {
    const f = await consumptionFixture(t);
    const effects = traceAdmissionEffects(t);
    let retentions = 0;
    let closes = 0;
    let thenReads = 0;
    const retain = (() => {
      retentions++;
      if (mode === 'throw-undefined') throw undefined;
      if (mode === 'async') return Promise.reject(Error('async-retain'));
      return new Proxy(
        {},
        {
          get(_target, key) {
            if (key === 'then') {
              thenReads++;
              throw Error('then-read');
            }
            return undefined;
          },
        },
      );
    }) as unknown as FrozenBrowserAdmissionObserver;
    const scope = new WorkerExecutionScope(
      f.request,
      async () => ({
        ...f.journal,
        consume: (a, sample, signal, observer) =>
          f.journal.consume(a, sample, signal, (value) => {
            if (mode === 'detach') Object.assign(value, { extra: () => {} });
            return observer!(value);
          }),
        close: async () => {
          closes++;
          await f.journal.close();
        },
      }),
      () => 60000,
      retain,
    );
    await scope.accept();
    const rejected = (error: unknown) => {
      if (mode === 'throw-undefined') assert.equal(error, undefined);
      else
        assert.match(
          String(error),
          mode === 'detach' ? /could not be cloned/ : /invalid-worker-admission-observer/,
        );
      return true;
    };
    await Promise.all([
      assert.rejects(scope.consume(), rejected),
      assert.rejects(scope.consume(), rejected),
    ]);
    await assert.rejects(scope.consume(), rejected);
    const closing = scope.close();
    assert.equal(scope.close(), closing);
    await assert.rejects(closing, rejected);
    assert.equal(closes, 1);
    assert.equal(retentions, mode === 'detach' ? 0 : 1);
    assert.equal(thenReads, 0);
    assert.deepEqual(journalRows(f.directory).runs[0].execution.run.result, { kind: 'pending' });
    assert.deepEqual(effects.counts, {
      executions: 0,
      reads: 0,
      commands: 0,
      saves: 0,
      cleanups: 0,
    });
    const reopened = await f.open();
    assert.equal((await reopened.inventory()).attempts, 1);
  });

test('scope retains synchronously before a journal can return its consumption', async (t) => {
  const f = await consumptionFixture(t);
  const entered = deferred();
  const release = deferred();
  t.after(() => release.resolve());
  let observed: unknown;
  const scope = new WorkerExecutionScope(
    f.request,
    async () => f.journal,
    () => 60000,
    (value) => {
      observed = structuredClone(value);
      return undefined;
    },
  );
  const effects = traceAdmissionEffects(t, async () => {
    entered.resolve();
    await release.promise;
  });
  await scope.accept();
  const pending = scope.consume();
  await entered.promise;
  const stored = journalRows(f.directory).runs[0];
  assert.deepEqual(observed, {
    acceptance: f.accepted,
    consumedRun: {
      acceptanceId: f.accepted.acceptanceId,
      runId: stored.execution.run.intent.runId,
      requestDigest: f.accepted.requestDigest,
    },
    admittedAt: stored.execution.run.intent.admittedAt,
    deadline: stored.execution.run.intent.deadline,
  });
  assert.equal(effects.counts.reads, 0);
  release.resolve();
  assert.equal((await pending).run.state, 'settled');
  await scope.close();
});
