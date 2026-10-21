import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { FrozenBrowserValidator } from '../src/frozen-browser.ts';
import type {
  FrozenBrowserAcceptance,
  FrozenBrowserConsumption,
  FrozenBrowserConsumptionJournal,
} from '../src/frozen-browser.ts';
import type { OfflineActionWorkspace, WorkerExecutionFactsObservation } from '../src/controller.ts';
import { digest } from '../src/domain.ts';
import { consumptionController } from './controller-worker-consumption-fixture.ts';
import { fixture, sources, gate, until, receipt } from './controller-worker-association-fixture.ts';

const retainedFacts = (
  requestDigest: string,
  acceptanceId = '44444444-4444-4444-8444-444444444444',
) => ({
  consumedRun: {
    acceptanceId,
    runId: '55555555-5555-4555-8555-555555555555',
    requestDigest,
  },
  admittedAt: 1000,
  deadline: 2000,
});
function updateSource(directory: string, value: object) {
  const db = new DatabaseSync(join(directory, 'catalogue.sqlite'));
  try {
    db.prepare('UPDATE action_sources SET value=?').run(JSON.stringify(value));
  } finally {
    db.close();
  }
}

test('inspectWorkerExecutionFacts reads detached controller data without journal access', async (t) => {
  const f = await fixture(t, { check: async () => ({ type: 'infrastructure' }) });
  const id = await f.add();
  await f.parked(id);
  const source = sources(f.directory)[0];
  const read = () => f.controller.inspectWorkerExecutionFacts(id, source.action.id);
  assert.deepEqual(read(), { state: 'unavailable', reason: 'not-retained-by-controller' });
  const facts = retainedFacts(source.workerIntent.requestDigest);
  updateSource(f.directory, { ...source, workerExecutionFacts: facts });
  for (const method of ['open', 'readHistoricalSelection', 'readConsumedReport'] as const)
    t.mock.method(FrozenBrowserValidator, method, () => {
      throw Error('unexpected-journal-access');
    });
  const expected = {
    state: 'retained',
    provenance: 'controller-live-consumption',
    intent: source.workerIntent,
    binding: { version: 1, ...f.options.offlineWorkerJournal },
    facts,
  };
  const result = read();
  assert.deepEqual(result, expected);
  if (result.state !== 'retained') return assert.fail('missing facts');
  Object.assign(result.facts.consumedRun, { runId: 'forged' });
  Object.assign(result.intent.request, { allowanceMs: 1 });
  Object.assign(result.binding, { directory: 'forged' });
  assert.deepEqual(read(), expected);
  t.mock.restoreAll();
  await f.close();
  await f.reopen();
  assert.deepEqual(read(), expected);
  await f.close();
  assert.throws(read, /controller-closed/);
});

test('legacy sources without intent are unavailable and malformed facts never hide behind historical absence', async (t) => {
  const f = await fixture(t, { check: async () => ({ type: 'infrastructure' }) });
  const id = await f.add();
  await f.parked(id);
  const source = sources(f.directory)[0];
  const facts = retainedFacts(source.workerIntent.requestDigest);
  const read = () => f.controller.inspectWorkerExecutionFacts(id, source.action.id);
  for (const invalid of [
    null,
    {},
    { ...facts, extra: 1 },
    { ...facts, consumedRun: { ...facts.consumedRun, extra: 1 } },
    { ...facts, consumedRun: { ...facts.consumedRun, runId: 'not-a-uuid' } },
    { ...facts, consumedRun: { ...facts.consumedRun, requestDigest: 'f'.repeat(64) } },
    { ...facts, admittedAt: -1 },
    { ...facts, admittedAt: 1.5 },
    { ...facts, deadline: facts.admittedAt },
    { ...facts, deadline: Number.MAX_SAFE_INTEGER + 1 },
    { ...facts, deadline: facts.admittedAt + source.workerIntent.request.allowanceMs + 1 },
  ]) {
    updateSource(f.directory, { ...source, workerExecutionFacts: invalid });
    assert.throws(read, /invalid-worker-execution-facts/);
    await assert.rejects(
      f.controller.inspectWorkerConsumedHistory(id, source.action.id),
      /invalid-worker-execution-facts/,
    );
  }
  const { workerIntent: _intent, ...withoutIntent } = source;
  updateSource(f.directory, { ...withoutIntent, workerExecutionFacts: facts });
  assert.throws(read, /invalid-worker-execution-facts/);
  updateSource(f.directory, withoutIntent);
  assert.deepEqual(read(), { state: 'unavailable', reason: 'no-worker-intent' });
  assert.deepEqual(await f.controller.inspectWorkerConsumedHistory(id, source.action.id), {
    state: 'unrecorded',
  });
  updateSource(f.directory, { ...source, unexpected: 1 });
  assert.throws(read, /invalid-action-source/);
  updateSource(f.directory, source);
  assert.throws(
    () => f.controller.inspectWorkerExecutionFacts('bad', source.action.id),
    /invalid-worker-association-id/,
  );
});

function liveResult(accepted: FrozenBrowserAcceptance): FrozenBrowserConsumption {
  return {
    acceptanceId: accepted.acceptanceId,
    run: {
      runId: '55555555-5555-4555-8555-555555555555',
      request: structuredClone(accepted.request),
      requestDigest: accepted.requestDigest,
      configurationDigest: accepted.configurationDigest,
      admittedAt: 1000,
      deadline: 2000,
      build: 'not-started',
      image: { kind: 'none' },
      container: { kind: 'none' },
      state: 'settled',
      outcome: { kind: 'uncertain', code: 'scripted-diagnostic' },
      cleanup: { kind: 'incomplete', cache: 'retained', code: 'scripted-cleanup' },
    },
  };
}
function scriptedConsumption(
  t: test.TestContext,
  consume: (accepted: FrozenBrowserAcceptance) => Promise<FrozenBrowserConsumption>,
) {
  const open = FrozenBrowserValidator.open;
  const state = { consumes: 0, closes: 0 };
  t.mock.method(
    FrozenBrowserValidator,
    'open',
    async (options: Parameters<typeof open>[0] & { mode?: string }) => {
      const journal = await Reflect.apply(open, FrozenBrowserValidator, [options]);
      if (options.mode !== 'consumption-only') return journal;
      const held = journal as unknown as FrozenBrowserConsumptionJournal;
      return Object.freeze({
        ...held,
        consume: async (accepted: FrozenBrowserAcceptance) => {
          state.consumes++;
          return consume(accepted);
        },
        close: async () => {
          state.closes++;
          await held.close();
        },
      });
    },
  );
  return state;
}

for (const kind of ['baseline', 'browser'] as const)
  test(
    `live ${kind} facts commit before delivery and survive interrupted finish and reopening`,
    { timeout: 30000 },
    async (t) => {
      let delivered = false;
      let expected!: WorkerExecutionFactsObservation;
      let actionId = '';
      const f = await consumptionController(
        t,
        {
          clock: () => 1000,
          check: async (request, source) => {
            actionId = request.actionId;
            const accepted = await source!.workerAcceptance!.accept();
            const original = structuredClone(accepted);
            Object.assign(accepted.request, { allowanceMs: 1 });
            const results = await Promise.all(
              Array.from({ length: 4 }, () => source!.workerConsumption!.consume()),
            );
            const result = results[0];
            expected = {
              state: 'retained',
              provenance: 'controller-live-consumption',
              intent: { request: original.request, requestDigest: original.requestDigest },
              binding: { version: 1, ...f.options.offlineWorkerJournal },
              facts: {
                consumedRun: {
                  acceptanceId: original.acceptanceId,
                  runId: result.run.runId,
                  requestDigest: original.requestDigest,
                },
                admittedAt: result.run.admittedAt,
                deadline: result.run.deadline,
              },
            };
            assert.deepEqual(
              f.controller.inspectWorkerExecutionFacts(request.caseId, request.actionId),
              expected,
            );
            assert.equal(sources(f.directory)[0].workerIntent.request.allowanceMs, 60000);
            Object.assign(result.run, { deadline: 0 });
            assert.deepEqual(
              f.controller.inspectWorkerExecutionFacts(request.caseId, request.actionId),
              expected,
            );
            const repeated = await source!.workerConsumption!.consume();
            assert.notEqual(repeated.run.deadline, 0);
            assert.deepEqual(await source!.workerAcceptance!.accept(), original);
            delivered = true;
            return { type: 'infrastructure' };
          },
        },
        kind,
      );
      const id = await f.add();
      await f.parked(id);
      assert.equal(delivered, true);
      assert.equal(sources(f.directory)[0].state, 'interrupted');
      assert.deepEqual(f.controller.inspectWorkerExecutionFacts(id, actionId), expected);
      await f.close();
      await f.reopen();
      assert.deepEqual(f.controller.inspectWorkerExecutionFacts(id, actionId), expected);
      const history = await f.controller.inspectWorkerConsumedHistory(id, actionId);
      if (history.state !== 'consumed') return assert.fail('missing consumed history');
      assert.deepEqual(history.independentExecutionPins, expected);
      assert.equal(history.history.provenance, 'worker-journal');
      assert.equal((await f.state()).calls.filter((c) => c[0] === 'build').length, 1);
      const selected = (await f.controller.snapshot({ selected: id })).selected!;
      assert.deepEqual(selected.checks, []);
      assert.deepEqual(selected.artifacts, []);
      const { workerExecutionFacts: facts, ...withoutFacts } = sources(f.directory)[0];
      updateSource(f.directory, withoutFacts);
      const absentPins = await f.controller.inspectWorkerConsumedHistory(id, actionId);
      if (absentPins.state !== 'consumed') return assert.fail('lost journal history');
      assert.deepEqual(absentPins.independentExecutionPins, {
        state: 'unavailable',
        reason: 'not-retained-by-controller',
      });
      assert.deepEqual(f.controller.inspectWorkerExecutionFacts(id, actionId), {
        state: 'unavailable',
        reason: 'not-retained-by-controller',
      });
      const conflictingFacts = {
        ...facts,
        consumedRun: { ...facts.consumedRun, runId: '66666666-6666-4666-8666-666666666666' },
      };
      updateSource(f.directory, { ...withoutFacts, workerExecutionFacts: conflictingFacts });
      const conflictingPins = await f.controller.inspectWorkerConsumedHistory(id, actionId);
      if (conflictingPins.state !== 'consumed')
        return assert.fail('lost history after facts change');
      if (conflictingPins.independentExecutionPins.state !== 'retained')
        return assert.fail('lost independent facts');
      assert.deepEqual(conflictingPins.independentExecutionPins.facts, conflictingFacts);
      assert.notEqual(
        conflictingPins.history.value.consumedRun.runId,
        conflictingFacts.consumedRun.runId,
      );
      assert.deepEqual(sources(f.directory)[0].workerExecutionFacts, conflictingFacts);
    },
  );

test('transactional append validates live identity and timing, accepts exact repeats and never overwrites conflicts', async (t) => {
  const ready = gate();
  const finish = gate();
  t.after(() => finish.resolve());
  let accepted!: FrozenBrowserAcceptance;
  const f = await fixture(t, {
    clock: () => 1000,
    offlineWorkerAcceptance: true,
    check: async (_request, source) => {
      accepted = await source!.workerAcceptance!.accept();
      ready.resolve();
      await finish.promise;
      return { type: 'infrastructure' };
    },
  });
  const id = await f.add();
  await ready.promise;
  const source = sources(f.directory)[0];
  const capture = { source, binding: { version: 1, ...f.options.offlineWorkerJournal } };
  const result = liveResult(accepted);
  const append = (a = accepted, r = result) =>
    Reflect.apply(Reflect.get(f.controller, 'retainWorkerExecutionFacts'), f.controller, [
      capture,
      a,
      r,
    ]);
  const changes: Array<
    [string, (a: FrozenBrowserAcceptance, r: FrozenBrowserConsumption) => void]
  > = [
    ['acceptance selector', (a) => Object.assign(a, { acceptanceId: 'BAD' })],
    [
      'acceptance uppercase ID',
      (a) => Object.assign(a, { acceptanceId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }),
    ],
    ['acceptance request', (a) => Object.assign(a.request, { allowanceMs: 59999 })],
    ['acceptance request digest', (a) => Object.assign(a, { requestDigest: 'f'.repeat(64) })],
    [
      'acceptance owner',
      (a) => Object.assign(a, { ownerId: '66666666-6666-4666-8666-666666666666' }),
    ],
    ['acceptance configuration', (a) => Object.assign(a, { configurationDigest: 'f'.repeat(64) })],
    ['acceptance negative time', (a) => Object.assign(a, { acceptedAt: -1 })],
    ['acceptance unsafe time', (a) => Object.assign(a, { deadline: Number.MAX_SAFE_INTEGER + 1 })],
    ['acceptance interval', (a) => Object.assign(a, { deadline: a.deadline - 1 })],
    ['acceptance extra key', (a) => Object.assign(a, { extra: 1 })],
    [
      'returned acceptance',
      (_a, r) => Object.assign(r, { acceptanceId: '66666666-6666-4666-8666-666666666666' }),
    ],
    ['result extra key', (_a, r) => Object.assign(r, { extra: 1 })],
    ['pending return', (_a, r) => Object.assign(r.run, { state: 'pending' })],
    ['run extra key', (_a, r) => Object.assign(r.run, { extra: 1 })],
    ['run selector', (_a, r) => Object.assign(r.run, { runId: 'bad' })],
    ['run request', (_a, r) => Object.assign(r.run.request, { allowanceMs: 59999 })],
    ['run digest', (_a, r) => Object.assign(r.run, { requestDigest: 'f'.repeat(64) })],
    ['run configuration', (_a, r) => Object.assign(r.run, { configurationDigest: 'f'.repeat(64) })],
    ['negative actual start', (_a, r) => Object.assign(r.run, { admittedAt: -1 })],
    ['fractional actual start', (_a, r) => Object.assign(r.run, { admittedAt: 1.5 })],
    ['zero interval', (_a, r) => Object.assign(r.run, { deadline: r.run.admittedAt })],
    [
      'excess actual interval',
      (_a, r) => Object.assign(r.run, { deadline: r.run.admittedAt + 60001 }),
    ],
    ['unsafe endpoint', (_a, r) => Object.assign(r.run, { deadline: Number.MAX_SAFE_INTEGER + 1 })],
  ];
  for (const [name, change] of changes) {
    const a = structuredClone(accepted);
    const r = structuredClone(result);
    change(a, r);
    assert.throws(() => append(a, r), /invalid-worker-execution-facts/, name);
    assert.deepEqual(sources(f.directory)[0], source, name);
  }
  const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
  t.after(() => db.close());
  const binding = capture.binding;
  db.prepare("UPDATE metadata SET value=? WHERE key='offline_worker_journal'").run(
    JSON.stringify({ ...binding, ownerId: '66666666-6666-4666-8666-666666666666' }),
  );
  assert.throws(() => append(), /invalid-worker-journal-binding/);
  db.prepare("UPDATE metadata SET value=? WHERE key='offline_worker_journal'").run(
    JSON.stringify(binding),
  );
  const { workerIntent: _intent, ...noIntent } = source;
  updateSource(f.directory, noIntent);
  assert.throws(() => append(), /worker-execution-facts-conflict/);
  updateSource(f.directory, source);
  db.prepare('DELETE FROM action_sources').run();
  assert.throws(() => append(), /action-source-missing/);
  assert.deepEqual(sources(f.directory), []);
  db.prepare('INSERT INTO action_sources VALUES(?,?,?)').run(
    source.action.id,
    id,
    JSON.stringify(source),
  );
  append();
  const retained = f.controller.inspectWorkerExecutionFacts(id, source.action.id);
  assert.equal(retained.state, 'retained');
  db.exec(
    "CREATE TRIGGER reject_rewrite BEFORE UPDATE ON action_sources BEGIN SELECT RAISE(ABORT, 'unexpected-rewrite'); END",
  );
  append();
  const conflicting = structuredClone(result);
  Object.assign(conflicting.run, { runId: '66666666-6666-4666-8666-666666666666' });
  assert.throws(() => append(accepted, conflicting), /worker-execution-facts-conflict/);
  assert.deepEqual(f.controller.inspectWorkerExecutionFacts(id, source.action.id), retained);
  db.exec('DROP TRIGGER reject_rewrite');
  finish.resolve();
  await f.parked(id);
});

for (const mode of ['full', 'short-near-max', 'recorded'] as const)
  test(`actual ${mode} execution timing retains diagnostic facts without rewriting original intent`, async (t) => {
    let acceptanceId = '';
    const state = scriptedConsumption(t, async (accepted) => {
      acceptanceId = accepted.acceptanceId;
      const result = liveResult(accepted);
      if (mode === 'full')
        Object.assign(result.run, { deadline: 1000 + accepted.request.allowanceMs });
      if (mode === 'short-near-max')
        Object.assign(result.run, {
          admittedAt: Number.MAX_SAFE_INTEGER - 1000,
          deadline: Number.MAX_SAFE_INTEGER,
        });
      if (mode === 'recorded')
        Object.assign(result.run, { state: 'recorded', cleanup: 'unresolved' });
      Object.assign(accepted.request, { allowanceMs: 1 });
      return result;
    });
    let observed: unknown;
    let actionId = '';
    const f = await fixture(t, {
      clock: () => 1000,
      offlineWorkerAcceptance: true,
      offlineWorkerConsumption: true,
      check: async (request, source) => {
        actionId = request.actionId;
        const accepted = await source!.workerAcceptance!.accept();
        const result = await source!.workerConsumption!.consume();
        observed = f.controller.inspectWorkerExecutionFacts(request.caseId, request.actionId);
        assert.deepEqual(await source!.workerAcceptance!.accept(), accepted);
        assert.deepEqual(result.run.outcome, { kind: 'uncertain', code: 'scripted-diagnostic' });
        return receipt(request.kind);
      },
    });
    const id = await f.add();
    await f.parked(id);
    const source = sources(f.directory)[0];
    assert.equal(source.state, 'settled');
    assert.deepEqual(observed, {
      state: 'retained',
      provenance: 'controller-live-consumption',
      intent: source.workerIntent,
      binding: { version: 1, ...f.options.offlineWorkerJournal },
      facts: {
        consumedRun: {
          acceptanceId,
          runId: '55555555-5555-4555-8555-555555555555',
          requestDigest: source.workerIntent.requestDigest,
        },
        admittedAt: mode === 'short-near-max' ? Number.MAX_SAFE_INTEGER - 1000 : 1000,
        deadline:
          mode === 'full' ? 61000 : mode === 'short-near-max' ? Number.MAX_SAFE_INTEGER : 2000,
      },
    });
    assert.equal(source.workerIntent.request.allowanceMs, 60000);
    assert.deepEqual(state, { consumes: 1, closes: 1 });
    await f.close();
    await f.reopen();
    assert.deepEqual(f.controller.inspectWorkerExecutionFacts(id, actionId), observed);
  });

test('adding parsed facts preserves authority but every original source component remains protected', async (t) => {
  const ready = gate();
  const finish = gate();
  t.after(() => finish.resolve());
  let scope!: OfflineActionWorkspace;
  const f = await fixture(t, {
    clock: () => 1000,
    offlineWorkerAcceptance: true,
    check: async (_request, source) => {
      scope = source!;
      ready.resolve();
      await finish.promise;
      return { type: 'infrastructure' };
    },
  });
  const id = await f.add();
  await ready.promise;
  const original = sources(f.directory)[0];
  const accepted = await scope.workerAcceptance!.accept();
  const withFacts = {
    ...original,
    workerExecutionFacts: retainedFacts(original.workerIntent.requestDigest, accepted.acceptanceId),
  };
  updateSource(f.directory, withFacts);
  assert.deepEqual(await scope.workerAcceptance!.accept(), accepted);
  const changes: Array<(s: typeof original) => void> = [
    (s) => {
      s.action.startedAt++;
    },
    (s) => {
      s.action.usedAtStart++;
    },
    (s) => {
      s.action.limitMs--;
    },
    (s) => {
      s.action.epoch++;
    },
    (s) => {
      s.kind = 'baseline';
      s.workerIntent.request.role = 'baseline';
      s.workerIntent.requestDigest = digest(s.workerIntent.request);
    },
    (s) => {
      s.state = 'settled';
    },
    (s) => {
      s.state = 'interrupted';
      s.reason = 'changed';
    },
    (s) => {
      s.frozen.revision = 'f'.repeat(40);
      s.workerIntent.request.frozen.revision = s.frozen.revision;
      s.workerIntent.requestDigest = digest(s.workerIntent.request);
    },
    (s) => {
      s.workerIntent.request.allowanceMs--;
      s.workerIntent.requestDigest = digest(s.workerIntent.request);
    },
    (s) => {
      s.unexpected = 1;
    },
  ];
  for (const change of changes) {
    const changed = structuredClone(original);
    change(changed);
    updateSource(f.directory, changed);
    await assert.rejects(
      scope.workerAcceptance!.accept(),
      /worker-acceptance-source-changed|invalid-action-source|invalid-worker-intent/,
    );
    updateSource(f.directory, withFacts);
    assert.deepEqual(await scope.workerAcceptance!.accept(), accepted);
  }
  finish.resolve();
  await f.parked(id);
});

for (const timing of ['before-close', 'during-close', 'abandoned'] as const)
  test(`retention failure ${timing} rejects joined consumers once, closes the journal and survives completed-drain removal`, async (t) => {
    const ready = gate();
    const release = gate();
    t.after(() => release.resolve());
    const state = scriptedConsumption(t, async (accepted) => {
      ready.resolve();
      await release.promise;
      return liveResult(accepted);
    });
    let pending!: Promise<PromiseSettledResult<FrozenBrowserConsumption>[]>;
    let scope!: OfflineActionWorkspace;
    const f = await fixture(t, {
      clock: () => 1000,
      offlineWorkerAcceptance: true,
      offlineWorkerConsumption: true,
      check: async (_request, source) => {
        scope = source!;
        await source!.workerAcceptance!.accept();
        pending = Promise.allSettled([
          source!.workerConsumption!.consume(),
          source!.workerConsumption!.consume(),
        ]);
        if (timing !== 'abandoned') await pending;
        return { type: 'infrastructure' };
      },
    });
    const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
    db.exec(
      "CREATE TRIGGER fail_retention BEFORE UPDATE ON action_sources WHEN json_type(NEW.value,'$.workerExecutionFacts') IS NOT NULL BEGIN SELECT RAISE(ABORT, 'scripted-retention-failure'); END",
    );
    const id = await f.add();
    await ready.promise;
    let closing: Promise<void> | undefined;
    if (timing === 'during-close') {
      closing = assert.rejects(f.controller.close(), /worker-close-failed/);
      assert.equal(state.closes, 0);
    } else if (timing === 'abandoned') await f.parked(id);
    release.resolve();
    const results = await pending;
    assert.equal(results.length, 2);
    for (const result of results) {
      assert.equal(result.status, 'rejected');
      if (result.status === 'rejected')
        assert.match(String(result.reason), /scripted-retention-failure/);
    }
    if (!closing) {
      await f.parked(id);
      await until(
        async () => Reflect.get(f.controller, 'workerDrains').size,
        (n) => n === 0,
      );
      closing = assert.rejects(f.controller.close(), /worker-close-failed/);
    }
    await closing;
    await assert.rejects(scope.workerConsumption!.consume(), /action-source-revoked/);
    assert.deepEqual(state, { consumes: 1, closes: 1 });
    assert.equal(Object.hasOwn(sources(f.directory)[0], 'workerExecutionFacts'), false);
    db.exec('DROP TRIGGER fail_retention');
    db.close();
    await f.reopen();
    const source = sources(f.directory)[0];
    assert.deepEqual(f.controller.inspectWorkerExecutionFacts(id, source.action.id), {
      state: 'unavailable',
      reason: 'not-retained-by-controller',
    });
    await f.close();
  });

for (const transition of ['interrupted', 'settled', 'closing', 'expired'] as const)
  test(`late successful worker return after ${transition} retains observations without restoring authority`, async (t) => {
    const ready = gate();
    const release = gate();
    t.after(() => release.resolve());
    let acceptanceId = '';
    const state = scriptedConsumption(t, async (accepted) => {
      acceptanceId = accepted.acceptanceId;
      ready.resolve();
      await release.promise;
      return liveResult(accepted);
    });
    let now = 1000;
    let pending!: Promise<PromiseSettledResult<FrozenBrowserConsumption>[]>;
    const finish = gate();
    t.after(() => finish.resolve());
    const f = await fixture(t, {
      clock: () => now,
      actionWakeup: () => () => {},
      offlineWorkerAcceptance: true,
      offlineWorkerConsumption: true,
      check: async (request, source) => {
        await source!.workerAcceptance!.accept();
        pending = Promise.allSettled([source!.workerConsumption!.consume()]);
        if (transition !== 'interrupted' && transition !== 'settled') await finish.promise;
        return transition === 'settled' ? receipt(request.kind) : { type: 'infrastructure' };
      },
    });
    const id = await f.add();
    await ready.promise;
    const original = sources(f.directory)[0];
    let closing: Promise<void> | undefined;
    if (transition === 'interrupted' || transition === 'settled') {
      await f.parked(id);
      assert.equal(sources(f.directory)[0].state, transition);
      const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'), { readOnly: true });
      assert.equal(db.prepare('SELECT count(*) AS n FROM actions').get()!.n, 0);
      db.close();
    } else if (transition === 'closing') closing = f.close();
    else {
      const retain = Reflect.get(f.controller, 'retainWorkerExecutionFacts');
      Reflect.set(f.controller, 'retainWorkerExecutionFacts', (...args: unknown[]) => {
        Reflect.apply(retain, f.controller, args);
        now = original.action.startedAt + original.action.limitMs;
      });
    }
    release.resolve();
    const results = await pending;
    assert.equal(results[0].status, 'rejected');
    if (results[0].status === 'rejected')
      assert.match(String(results[0].reason), /revoked|allowance-exhausted/);
    await closing;
    const retained = sources(f.directory)[0];
    assert.deepEqual(
      retained.workerExecutionFacts,
      retainedFacts(original.workerIntent.requestDigest, acceptanceId),
    );
    assert.deepEqual(retained.workerIntent, original.workerIntent);
    if (transition !== 'closing') await f.close();
    assert.deepEqual(state, { consumes: 1, closes: 1 });
    await f.reopen();
    const recovered = sources(f.directory)[0];
    assert.equal(recovered.state, transition === 'settled' ? 'settled' : 'interrupted');
    assert.deepEqual(recovered.workerExecutionFacts, retained.workerExecutionFacts);
    assert.deepEqual(f.controller.inspectWorkerExecutionFacts(id, original.action.id), {
      state: 'retained',
      provenance: 'controller-live-consumption',
      intent: original.workerIntent,
      binding: { version: 1, ...f.options.offlineWorkerJournal },
      facts: retained.workerExecutionFacts,
    });
    await f.close();
  });
