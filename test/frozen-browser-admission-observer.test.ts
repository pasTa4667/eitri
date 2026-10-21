import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  FrozenBrowserAdmissionObserver,
  FrozenBrowserAdmissionObservation,
} from '../src/frozen-browser.ts';
import { consumptionFixture, deferred } from './frozen-browser-consumption-fixture.ts';
import { journalRows } from './controller-worker-association-fixture.ts';
import { traceAdmissionEffects } from './worker-admission-fixture.ts';

const signal = () => new AbortController().signal;
const allowance = () => 60000;

test('new admission publishes detached committed facts before execution, frozen reads and raw joins', async (t) => {
  const f = await consumptionFixture(t);
  const entered = deferred();
  const release = deferred();
  t.after(() => release.resolve());
  const effects = traceAdmissionEffects(t, async () => {
    entered.resolve();
    await release.promise;
  });
  let observed!: FrozenBrowserAdmissionObservation;
  let notifications = 0;
  const pending = f.journal.consume(f.accepted, allowance, signal(), (value) => {
    notifications++;
    const stored = journalRows(f.directory);
    assert.equal(stored.meta.attempts, 1);
    assert.equal(stored.meta.contribution, 41943040);
    assert.equal(stored.runs[0].execution.run.result.kind, 'pending');
    assert.deepEqual(effects.counts, {
      executions: 0,
      reads: 0,
      commands: 0,
      saves: 0,
      cleanups: 0,
    });
    observed = structuredClone(value);
    assert.deepEqual(value, {
      acceptance: f.accepted,
      consumedRun: {
        acceptanceId: f.accepted.acceptanceId,
        runId: stored.runs[0].execution.run.intent.runId,
        requestDigest: f.accepted.requestDigest,
      },
      admittedAt: stored.runs[0].execution.run.intent.admittedAt,
      deadline: stored.runs[0].execution.run.intent.deadline,
    });
    Object.assign(value.acceptance.request, { allowanceMs: 1 });
    Object.assign(value.consumedRun, { runId: 'mutated' });
    Object.assign(value, { deadline: 0 });
    return undefined;
  });
  await entered.promise;
  const unexpected = () => {
    throw Error('historical-observation');
  };
  const joined = f.journal.consume(f.accepted, allowance, signal(), unexpected);
  const revoked = new AbortController();
  const deniedJoin = f.journal.consume(f.accepted, allowance, revoked.signal, unexpected);
  const denied = assert.rejects(deniedJoin, /join-revoked/);
  revoked.abort(Error('join-revoked'));
  release.resolve();
  const [result, second] = await Promise.all([pending, joined]);
  await denied;
  assert.deepEqual(second, result);
  assert.equal(result.run.runId, observed.consumedRun.runId);
  assert.equal(result.run.deadline, observed.deadline);
  assert.equal(result.run.request.allowanceMs, 60000);
  assert.equal(notifications, 1);
  Object.assign(second.run, { deadline: 0 });
  assert.deepEqual(await f.journal.consume(f.accepted, allowance, signal(), unexpected), result);
  await f.journal.close();
  const reopened = await f.open();
  assert.deepEqual(await reopened.consume(f.accepted, allowance, signal(), unexpected), result);
  assert.equal(effects.counts.executions, 1);
  assert.equal((await f.state()).calls.filter((words) => words[0] === 'build').length, 1);
});

for (const failure of ['throw', 'undefined', 'async', 'promise', 'thenable', 'value'] as const)
  test(`admission observer ${failure} failure leaves charged pending history without execution or replay`, async (t) => {
    const f = await consumptionFixture(t);
    const effects = traceAdmissionEffects(t);
    const sentinel = Error('retention-failed');
    let thenReads = 0;
    const thenable = new Proxy(
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
    const observer = (failure === 'async'
      ? async () => {
          throw Error('async-observer-failed');
        }
      : () => {
          if (failure === 'throw') throw sentinel;
          if (failure === 'undefined') throw undefined;
          if (failure === 'promise') return Promise.reject(Error('async-retention-failed'));
          if (failure === 'thenable') return thenable;
          return 1;
        }) as unknown as FrozenBrowserAdmissionObserver;
    const pending = f.journal.consume(f.accepted, allowance, signal(), observer);
    const joined = f.journal.consume(f.accepted, allowance, signal(), () => {
      throw Error('joined-observation');
    });
    const rejected = (error: unknown) => {
      if (failure === 'throw') assert.equal(error, sentinel);
      else if (failure === 'undefined') assert.equal(error, undefined);
      else assert.match(String(error), /invalid-worker-admission-observer/);
      return true;
    };
    await Promise.all([assert.rejects(pending, rejected), assert.rejects(joined, rejected)]);
    await new Promise((resolve) => setImmediate(resolve));
    const committed = journalRows(f.directory);
    assert.equal(committed.meta.attempts, 1);
    assert.equal(committed.meta.contribution, 41943040);
    assert.deepEqual(committed.runs[0].execution.run.result, { kind: 'pending' });
    assert.deepEqual(committed.runs[0].execution.run.ledger, {
      build: 'not-started',
      image: { kind: 'none' },
      container: { kind: 'none' },
    });
    const unexpected = () => {
      throw Error('repeated-observation');
    };
    await assert.rejects(
      f.journal.consume(f.accepted, allowance, signal(), unexpected),
      /validator-unsettled/,
    );
    assert.deepEqual(journalRows(f.directory), committed);
    await f.journal.close();
    const reopened = await f.open();
    const result = await reopened.consume(f.accepted, allowance, signal(), unexpected);
    assert.equal(result.run.state, 'recorded');
    assert.deepEqual(result.run.outcome, { kind: 'uncertain', code: 'interrupted-run-no-replay' });
    assert.deepEqual(effects.counts, {
      executions: 0,
      reads: 0,
      commands: 0,
      saves: 1,
      cleanups: 0,
    });
    assert.equal(thenReads, 0);
    assert.deepEqual((await f.state()).calls, []);
  });

test('malformed supplied observer rejects before admission while omitted worker-only observer remains valid', async (t) => {
  const f = await consumptionFixture(t);
  const before = journalRows(f.directory);
  for (const value of [null, false, {}, 1]) {
    await assert.rejects(
      f.journal.consume(
        f.accepted,
        allowance,
        signal(),
        value as unknown as FrozenBrowserAdmissionObserver,
      ),
      /invalid-worker-admission-observer/,
    );
    assert.deepEqual(journalRows(f.directory), before);
  }
  const result = await f.journal.consume(f.accepted, allowance, signal());
  assert.equal(result.run.state, 'settled');
});

const asyncObserver = async () => {};
const asyncObserverIsSupported: typeof asyncObserver extends FrozenBrowserAdmissionObserver
  ? true
  : false = false;
assert.equal(asyncObserverIsSupported, false);
