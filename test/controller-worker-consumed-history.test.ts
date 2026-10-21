import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { lstat, readdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Controller } from '../src/controller.ts';
import type {
  OfflineActionWorkspace,
  WorkerConsumedHistoryObservation,
} from '../src/controller.ts';
import { FrozenBrowserValidator, frozenBrowserRequest } from '../src/frozen-browser.ts';
import type { FrozenBrowserAcceptance, FrozenBrowserRequest } from '../src/frozen-browser.ts';
import { digest } from '../src/domain.ts';
import type { AdmittedCheckRequest } from '../src/domain.ts';
import { sha256, virtualPath, WorkspaceStore } from '../src/workspace.ts';
import {
  fixture,
  sources,
  journalRows,
  gate,
  until,
  receipt,
  command,
  forbiddenWorkspace,
} from './controller-worker-association-fixture.ts';
import {
  consumedRecord,
  otherAcceptance,
  selector,
  writeRows,
} from './frozen-browser-cleanup-fixture.ts';

const pins = { state: 'unavailable', reason: 'not-retained-by-controller' };
const historical = <T>(value: T) => ({ provenance: 'worker-journal', value });

async function files(directory: string) {
  return Promise.all(
    (await readdir(directory)).sort().map(async (name) => {
      const path = join(directory, name);
      const stat = await lstat(path, { bigint: true });
      return {
        name,
        mode: stat.mode,
        ino: stat.ino,
        mtime: stat.mtimeNs,
        bytes: await readFile(path),
      };
    }),
  );
}
function acceptanceFor(directory: string, request: FrozenBrowserRequest): FrozenBrowserAcceptance {
  const { meta } = journalRows(directory);
  return {
    acceptanceId: '44444444-4444-4444-8444-444444444444',
    request: structuredClone(request),
    requestDigest: sha256(digest(request)),
    configurationDigest: sha256(meta.configurationDigest),
    ownerId: meta.owner,
    acceptedAt: 500,
    deadline: 500 + request.allowanceMs,
  };
}
function settledRecord(acceptance: FrozenBrowserAcceptance) {
  const record = consumedRecord(acceptance);
  const report = {
    runId: record.execution.run.intent.runId,
    request: structuredClone(acceptance.request),
    outcome: { kind: 'uncertain', code: 'historical-uncertain' },
    cleanup: { kind: 'incomplete', cache: 'retained', code: 'historical-unconfirmed' },
    evidence: null,
  };
  Reflect.set(record.execution.run, 'result', { kind: 'settled', report });
  return { record, report };
}
function seed(directory: string, runs: ReturnType<typeof journalRows>['runs']) {
  const rows = journalRows(directory);
  rows.meta.version = 3;
  rows.meta.attempts = runs.filter((r) => r.kind !== 'offline-acceptance').length;
  rows.meta.contribution = rows.meta.attempts * 41943040;
  rows.runs = runs;
  writeRows(directory, rows);
}
function forbidEffects(t: test.TestContext) {
  for (const method of ['client', 'save', 'saveNow', 'finalize', 'inventory', 'validate'])
    t.mock.method(FrozenBrowserValidator.prototype, method as never, () => {
      throw Error(`historical-query-called-${method}`);
    });
  t.mock.method(FrozenBrowserValidator, 'open', () => {
    throw Error('historical-query-opened-recovery');
  });
}
function mutate(result: WorkerConsumedHistoryObservation) {
  if (result.state === 'unrecorded') return;
  Object.assign(result.intent.request.action, { epoch: 99 });
  Object.assign(result.intent.request.frozen, { revision: 'f'.repeat(40) });
  if (result.state === 'accepted-unconsumed' || result.state === 'consumed') {
    Object.assign(result.acceptance.value.request.action, { epoch: 99 });
    Object.assign(result.acceptance.value, { acceptedAt: 99, deadline: 999 });
  }
  if (result.state === 'consumed') {
    Object.assign(result.history.value.consumedRun, { runId: randomUUID() });
    Object.assign(result.history.value, { admittedAt: 99, deadline: 999 });
    if (result.history.value.state === 'settled') {
      Object.assign(result.history.value.report.request.action, { epoch: 99 });
      Object.assign(result.history.value.report.outcome, { code: 'forged' });
      Object.assign(result.history.value.report.cleanup, { code: 'forged' });
    }
  }
}

for (const kind of ['baseline', 'browser'] as const)
  test(`inspectWorkerConsumedHistory returns detached literal ${kind} states with original intent and no effects`, async (t) => {
    let now = 1000;
    let admitted!: AdmittedCheckRequest;
    let callbacks = 0;
    const f = await fixture(
      t,
      {
        clock: () => now,
        fault: (point) => {
          if (point === 'after-source-selection-receipt') now += 1234;
        },
        check: async (r) => {
          callbacks++;
          admitted = r;
          return receipt(r.kind);
        },
      },
      kind,
    );
    const id = await f.add();
    await f.parked(id);
    const request = frozenBrowserRequest({
      frozen: sources(f.directory)[0].frozen,
      action: { caseId: id, actionId: admitted.actionId, epoch: admitted.epoch },
      scenarioId: 'synthetic-click-v1',
      role: kind === 'baseline' ? 'baseline' : 'candidate',
      allowanceMs: 58766,
    });
    const intent = { request, requestDigest: digest(request) };
    assert.equal(admitted.remainingMs, 58766);
    const before = await f.controller.snapshot({ selected: id });
    const beforeSources = sources(f.directory);
    const accepted = acceptanceFor(f.journalDirectory, request);
    const decoy = consumedRecord(otherAcceptance(accepted), true);
    decoy.execution.admission.translatedAt = 2000;
    decoy.execution.admission.translatedAllowanceMs = 23456;
    decoy.execution.run.intent.admittedAt = 2000;
    decoy.execution.run.intent.deadline = 25456;
    const read = () => f.controller.inspectWorkerConsumedHistory(id, admitted.actionId);
    for (const state of [
      'absent',
      'legacy-execution',
      'accepted-unconsumed',
      'pending',
      'recorded',
      'settled',
    ] as const) {
      const { record, report } = settledRecord(accepted);
      if (state === 'pending' || state === 'legacy-execution')
        Reflect.set(record.execution.run, 'result', { kind: 'pending' });
      if (state === 'recorded')
        Reflect.set(record.execution.run, 'result', {
          kind: 'recorded',
          outcome: { kind: 'uncertain', code: 'fixture-uncertain' },
          evidence: null,
        });
      if (state === 'legacy-execution')
        record.execution.run.intent.deadline = 1000 + request.allowanceMs;
      seed(f.journalDirectory, [
        decoy,
        ...(state === 'absent'
          ? []
          : state === 'legacy-execution'
            ? [{ kind: 'execution', run: record.execution.run }]
            : state === 'accepted-unconsumed'
              ? [{ kind: 'offline-acceptance', ...accepted }]
              : [record]),
        { kind: 'offline-acceptance', ...otherAcceptance(accepted) },
      ]);
      const beforeFiles = await files(f.journalDirectory);
      forbidEffects(t);
      const expected =
        state === 'absent'
          ? { state, intent }
          : state === 'legacy-execution'
            ? {
                state: 'conflict',
                intent,
                reason: 'legacy-execution',
                observed: historical({
                  kind: state,
                  request,
                  requestDigest: intent.requestDigest,
                  configurationDigest: accepted.configurationDigest,
                  runId: record.execution.run.intent.runId,
                }),
              }
            : state === 'accepted-unconsumed'
              ? {
                  state,
                  intent,
                  acceptance: historical(accepted),
                  independentExecutionPins: pins,
                }
              : {
                  state: 'consumed',
                  intent,
                  acceptance: historical(accepted),
                  independentExecutionPins: pins,
                  history: historical({
                    consumedRun: selector(record),
                    admittedAt: 1000,
                    deadline: 13345,
                    state,
                    ...(state === 'settled' ? { report } : {}),
                  }),
                };
      const result = await read();
      assert.deepEqual(result, expected);
      mutate(result);
      assert.deepEqual(await read(), expected);
      assert.deepEqual(await files(f.journalDirectory), beforeFiles);
      assert.deepEqual(await f.controller.snapshot({ selected: id }), before);
      assert.deepEqual(sources(f.directory), beforeSources);
      assert.equal(callbacks, 1);
      t.mock.restoreAll();
    }
    await f.close();
    await f.reopen();
    const reopened = await read();
    assert.equal(reopened.state, 'consumed');
    if (reopened.state !== 'consumed') return assert.fail('missing history');
    assert.deepEqual(reopened.intent, intent);
    assert.deepEqual(reopened.history.value.state, 'settled');
    assert.deepEqual(
      (await f.controller.snapshot({ selected: id })).selected?.checks,
      before.selected?.checks,
    );
  });

test('inspectWorkerConsumedHistory preserves source validation and never acquires for unrecorded intent', async (t) => {
  let action = '';
  const f = await fixture(
    t,
    {
      check: async (r) => {
        action = r.actionId;
        return { type: 'infrastructure' };
      },
    },
    'unit',
  );
  const id = await f.add();
  await f.parked(id);
  t.mock.method(FrozenBrowserValidator, 'readHistoricalSelection', () => {
    throw Error('unexpected-history-acquisition');
  });
  assert.deepEqual(await f.controller.inspectWorkerConsumedHistory(id, action), {
    state: 'unrecorded',
  });
  for (const [caseId, actionId, code] of [
    [id, randomUUID(), 'action-source-missing'],
    [randomUUID(), randomUUID(), 'action-source-missing'],
    [randomUUID(), action, 'invalid-action-source'],
    ['invalid', action, 'invalid-worker-association-id'],
    [id, 'invalid', 'invalid-worker-association-id'],
  ])
    await assert.rejects(f.controller.inspectWorkerConsumedHistory(caseId, actionId), { code });
  const original = sources(f.directory)[0];
  const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
  db.prepare('UPDATE action_sources SET value=? WHERE action_id=?').run(
    JSON.stringify({ ...original, state: 'invalid' }),
    action,
  );
  await assert.rejects(
    f.controller.inspectWorkerConsumedHistory(id, action),
    /invalid-action-source/,
  );
  db.prepare('UPDATE action_sources SET value=? WHERE action_id=?').run(
    JSON.stringify(original),
    action,
  );
  db.close();
  assert.deepEqual(await f.controller.inspectWorkerConsumedHistory(id, action), {
    state: 'unrecorded',
  });
});

test('inspectWorkerConsumedHistory matches the complete request before legacy classification and selects the exact tuple', async (t) => {
  let action = '';
  const f = await fixture(t, {
    clock: () => 1000,
    check: async (r) => {
      action = r.actionId;
      return { type: 'infrastructure' };
    },
  });
  const id = await f.add();
  await f.parked(id);
  const intent = sources(f.directory)[0].workerIntent;
  const original = intent.request;
  for (const [name, request] of [
    ['revision', { ...original, frozen: { ...original.frozen, revision: 'f'.repeat(40) } }],
    ['manifest', { ...original, frozen: { ...original.frozen, manifestDigest: 'f'.repeat(64) } }],
    ['role', { ...original, role: 'baseline' }],
    ['allowance', { ...original, allowanceMs: 59999 }],
    ['epoch', { ...original, action: { ...original.action, epoch: original.action.epoch + 1 } }],
    ['action', { ...original, action: { ...original.action, actionId: randomUUID() } }],
    [
      'case',
      {
        ...original,
        frozen: { ...original.frozen, caseId: '33333333-3333-4333-8333-333333333333' },
        action: { ...original.action, caseId: '33333333-3333-4333-8333-333333333333' },
      },
    ],
  ] as const) {
    const accepted = acceptanceFor(f.journalDirectory, frozenBrowserRequest(request));
    const record = consumedRecord(accepted, true);
    for (const legacy of [false, true]) {
      if (legacy) record.execution.run.intent.deadline = 1000 + request.allowanceMs;
      seed(f.journalDirectory, [
        legacy ? { kind: 'execution', run: record.execution.run } : record,
      ]);
      const result = await f.controller.inspectWorkerConsumedHistory(id, action);
      assert.deepEqual(
        result,
        ['epoch', 'action', 'case'].includes(name)
          ? { state: 'absent', intent }
          : {
              state: 'conflict',
              intent,
              reason: 'request-mismatch',
              observed: historical(
                legacy
                  ? {
                      kind: 'legacy-execution',
                      request,
                      requestDigest: digest(request),
                      configurationDigest: accepted.configurationDigest,
                      runId: record.execution.run.intent.runId,
                    }
                  : {
                      kind: 'consumed',
                      acceptance: accepted,
                      history: {
                        consumedRun: selector(record),
                        admittedAt: 1000,
                        deadline: 13345,
                        state: 'pending',
                      },
                    },
              ),
            },
        `${name} legacy=${legacy}`,
      );
    }
  }
  const originalSource = sources(f.directory)[0];
  const bad = structuredClone(originalSource);
  bad.workerIntent.requestDigest = 'f'.repeat(64);
  const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
  db.prepare('UPDATE action_sources SET value=? WHERE action_id=?').run(
    JSON.stringify(bad),
    action,
  );
  t.mock.method(FrozenBrowserValidator, 'readHistoricalSelection', () => {
    throw Error('read-before-source-validation');
  });
  await assert.rejects(
    f.controller.inspectWorkerConsumedHistory(id, action),
    /invalid-worker-intent/,
  );
  db.prepare('UPDATE action_sources SET value=? WHERE action_id=?').run(
    JSON.stringify(originalSource),
    action,
  );
  db.close();
});

test('inspectWorkerConsumedHistory keeps original attribution after edits, interruption, Retry, epoch advancement and reopen', async (t) => {
  const entered = gate();
  const finish = gate();
  t.after(() => finish.resolve());
  let candidate!: { request: AdmittedCheckRequest; source: OfflineActionWorkspace };
  let callbacks = 0;
  const f = await fixture(
    t,
    {
      check: async (request, source) => {
        if (request.kind === 'baseline') return receipt(request.kind);
        if (++callbacks > 1) return { type: 'infrastructure' };
        candidate = { request, source: source! };
        await source!.edit(source!.selection.revision, {
          virtualPath: virtualPath('src/value.ts'),
          expectedHash: sha256(createHash('sha256').update('literal A\n').digest('hex')),
          bytes: Buffer.from('literal B\n'),
        });
        entered.resolve();
        await finish.promise;
        return { type: 'infrastructure' };
      },
    },
    'browser',
    true,
  );
  const id = await f.add();
  await entered.promise;
  const intent = sources(f.directory).at(-1).workerIntent;
  const accepted = acceptanceFor(f.journalDirectory, intent.request);
  const { record, report } = settledRecord(accepted);
  seed(f.journalDirectory, [record]);
  const expected = {
    state: 'consumed',
    intent,
    acceptance: historical(accepted),
    independentExecutionPins: pins,
    history: historical({
      consumedRun: selector(record),
      admittedAt: 1000,
      deadline: 13345,
      state: 'settled',
      report,
    }),
  };
  const read = () => f.controller.inspectWorkerConsumedHistory(id, candidate.request.actionId);
  assert.deepEqual(await read(), expected);
  assert.deepEqual(intent.request.frozen, candidate.source.selection);
  finish.resolve();
  const parked = await f.parked(id);
  assert.equal(sources(f.directory).at(-1).state, 'interrupted');
  assert.deepEqual(await read(), expected);
  await f.controller.command(
    command({ type: 'retry', caseId: id, note: 'Explicit retry' }, parked.version),
  );
  const retried = await f.parked(id);
  assert.notEqual(retried.epoch, intent.request.action.epoch);
  assert.notEqual(sources(f.directory).at(-1).frozen.revision, candidate.source.selection.revision);
  assert.deepEqual(await read(), expected);
  const rows = journalRows(f.journalDirectory);
  await f.close();
  await f.reopen();
  assert.deepEqual(await read(), expected);
  assert.deepEqual(journalRows(f.journalDirectory), rows);
});

for (const stage of ['lazy', 'acquiring', 'held', 'revoked-draining'] as const)
  test(`inspectWorkerConsumedHistory rejects ${stage} worker scopes without historical acquisition`, async (t) => {
    const entered = gate();
    const finish = gate();
    const openEntered = gate();
    const releaseOpen = gate();
    const closeEntered = gate();
    const releaseClose = gate();
    t.after(() => {
      finish.resolve();
      releaseOpen.resolve();
      releaseClose.resolve();
    });
    let admitted!: AdmittedCheckRequest;
    let scope!: OfflineActionWorkspace;
    let accepting: Promise<unknown> | undefined;
    const f = await fixture(t, {
      clock: () => 1000,
      offlineWorkerAcceptance: true,
      offlineWorkerConsumption: true,
      check: async (r, source) => {
        admitted = r;
        scope = source!;
        entered.resolve();
        if (stage !== 'lazy') {
          accepting = scope.workerAcceptance!.accept();
          await accepting;
        }
        await finish.promise;
        return { type: 'infrastructure' };
      },
    });
    const originalOpen = FrozenBrowserValidator.open;
    t.mock.method(FrozenBrowserValidator, 'open', (async (
      options: Parameters<typeof originalOpen>[0] & { mode?: string },
    ) => {
      const journal = await Reflect.apply(originalOpen, FrozenBrowserValidator, [options]);
      if (options.mode !== 'consumption-only') return journal;
      openEntered.resolve();
      if (stage === 'acquiring') await releaseOpen.promise;
      if (stage !== 'revoked-draining') return journal;
      return {
        ...journal,
        close: async () => {
          closeEntered.resolve();
          await releaseClose.promise;
          await journal.close();
        },
      };
    }) as typeof originalOpen);
    let reads = 0;
    const originalRead = FrozenBrowserValidator.readHistoricalSelection;
    t.mock.method(
      FrozenBrowserValidator,
      'readHistoricalSelection',
      (options: Parameters<typeof originalRead>[0]) => {
        reads++;
        return originalRead(options);
      },
    );
    const id = await f.add();
    await entered.promise;
    if (stage !== 'lazy') await openEntered.promise;
    if (stage === 'held' || stage === 'revoked-draining') await accepting;
    if (stage === 'revoked-draining') {
      finish.resolve();
      await closeEntered.promise;
      await f.parked(id);
      await assert.rejects(scope.workerAcceptance!.accept(), /action-source-revoked/);
    }
    const denied = assert.rejects(
      f.controller.inspectWorkerConsumedHistory(id, admitted.actionId),
      /worker-history-busy/,
    );
    releaseOpen.resolve();
    await denied;
    assert.equal(reads, 0);
    finish.resolve();
    releaseClose.resolve();
    await f.parked(id);
    const result = await until(
      async () => {
        try {
          return await f.controller.inspectWorkerConsumedHistory(id, admitted.actionId);
        } catch (error) {
          if (error instanceof Error && error.message === 'worker-history-busy') return null;
          throw error;
        }
      },
      (r) => r !== null,
    );
    assert.equal(result?.state, stage === 'lazy' ? 'absent' : 'accepted-unconsumed');
    assert.equal(reads, 1);
    assert.equal(journalRows(f.journalDirectory).meta.attempts, 0);
  });

type HistoricalHandle = { records: unknown[]; guard(): Promise<void>; close(): void };
const acquisition = FrozenBrowserValidator as unknown as {
  acquireJournal(options: { historical?: true }): Promise<HistoricalHandle>;
};

function gateHistorical(
  t: test.TestContext,
  events: string[],
  stage: 'acquisition' | 'guard' = 'guard',
) {
  const entered = gate();
  const release = gate();
  t.after(() => release.resolve());
  const original = acquisition.acquireJournal;
  let reads = 0;
  t.mock.method(acquisition, 'acquireJournal', async (options: { historical?: true }) => {
    const journal = await Reflect.apply(original, FrozenBrowserValidator, [options]);
    if (!options.historical) return journal;
    const index = ++reads;
    events.push(`acquired-${index}`);
    if (index === 1 && stage === 'acquisition') {
      entered.resolve();
      await release.promise;
    }
    return {
      ...journal,
      guard: async () => {
        events.push(`guard-${index}`);
        if (index === 1 && stage === 'guard') {
          entered.resolve();
          await release.promise;
        }
        await journal.guard();
        events.push(`guarded-${index}`);
      },
      close: () => {
        journal.close();
        events.push(`closed-${index}`);
      },
    };
  });
  return { entered, release };
}

for (const stage of ['acquisition', 'guard'] as const)
  test(`inspectWorkerConsumedHistory holds the queue through ${stage} and closure while close drains both admitted reads`, async (t) => {
    let action = '';
    const f = await fixture(t, {
      check: async (r) => {
        action = r.actionId;
        return { type: 'infrastructure' };
      },
    });
    const id = await f.add();
    await f.parked(id);
    const intent = sources(f.directory)[0].workerIntent;
    const accepted = acceptanceFor(f.journalDirectory, intent.request);
    const record = consumedRecord(accepted, true);
    seed(f.journalDirectory, [record]);
    const before = await files(f.journalDirectory);
    const events: string[] = [];
    const gated = gateHistorical(t, events, stage);
    const workspaceClose = WorkspaceStore.prototype.close;
    t.mock.method(WorkspaceStore.prototype, 'close', async function (this: WorkspaceStore) {
      events.push('workspace-close');
      await Reflect.apply(workspaceClose, this, []);
    });
    const first = f.controller.inspectWorkerConsumedHistory(id, action);
    await gated.entered.promise;
    const second = f.controller.inspectWorkerConsumedHistory(id, action);
    const closing = f.controller.close();
    assert.equal(f.controller.close(), closing);
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await assert.rejects(
      f.controller.inspectWorkerConsumedHistory(id, action),
      /controller-closed/,
    );
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(closed, false);
    assert.deepEqual(events, stage === 'acquisition' ? ['acquired-1'] : ['acquired-1', 'guard-1']);
    const catalogue = new DatabaseSync(join(f.directory, 'catalogue.sqlite'), { readOnly: true });
    assert.equal(catalogue.prepare('SELECT id FROM cases WHERE id=?').get(id)?.id, id);
    catalogue.close();
    await assert.rejects(Controller.open(f.options), /controller-already-open/);
    await assert.rejects(
      FrozenBrowserValidator.readHistoricalSelection({
        directory: f.journalDirectory,
        expectedIdentity: {
          ownerId: accepted.ownerId,
          configurationDigest: accepted.configurationDigest,
        },
        action: intent.request.action,
      }),
      /validator-already-open/,
    );
    gated.release.resolve();
    const expected = {
      state: 'consumed',
      intent,
      acceptance: historical(accepted),
      independentExecutionPins: pins,
      history: historical({
        consumedRun: selector(record),
        admittedAt: 1000,
        deadline: 13345,
        state: 'pending',
      }),
    };
    assert.deepEqual(await first, expected);
    assert.deepEqual(await second, expected);
    await closing;
    assert.equal(closed, true);
    assert.deepEqual(events, [
      'acquired-1',
      'guard-1',
      'guarded-1',
      'closed-1',
      'acquired-2',
      'guard-2',
      'guarded-2',
      'closed-2',
      'workspace-close',
    ]);
    assert.deepEqual(await files(f.journalDirectory), before);
    t.mock.restoreAll();
    assert.equal(
      (
        await FrozenBrowserValidator.readHistoricalSelection({
          directory: f.journalDirectory,
          expectedIdentity: {
            ownerId: accepted.ownerId,
            configurationDigest: accepted.configurationDigest,
          },
          action: intent.request.action,
        })
      )?.kind,
      'consumed',
    );
    await f.close();
  });

test(
  'historical closure precedes queued acceptance-only opening',
  { timeout: 30000 },
  async (t) => {
    const callbackEntered = gate();
    const finish = gate();
    t.after(() => finish.resolve());
    let scope!: OfflineActionWorkspace;
    let action = '';
    const f = await fixture(t, {
      clock: () => 1000,
      offlineWorkerAcceptance: true,
      check: async (r, source) => {
        action = r.actionId;
        scope = source!;
        callbackEntered.resolve();
        await finish.promise;
        return { type: 'infrastructure' };
      },
    });
    const id = await f.add();
    await callbackEntered.promise;
    const events: string[] = [];
    const gated = gateHistorical(t, events);
    const originalOpen = FrozenBrowserValidator.open;
    t.mock.method(FrozenBrowserValidator, 'open', (async (
      options: Parameters<typeof originalOpen>[0] & { mode?: string },
    ) => {
      events.push(`open-${options.mode}`);
      return Reflect.apply(originalOpen, FrozenBrowserValidator, [options]);
    }) as typeof originalOpen);
    const reading = f.controller.inspectWorkerConsumedHistory(id, action);
    await gated.entered.promise;
    const accepting = scope.workerAcceptance!.accept();
    assert.deepEqual(events, ['acquired-1', 'guard-1']);
    gated.release.resolve();
    assert.deepEqual(await reading, {
      state: 'absent',
      intent: sources(f.directory)[0].workerIntent,
    });
    const accepted = await accepting;
    assert.deepEqual(accepted.request, sources(f.directory)[0].workerIntent.request);
    assert.deepEqual(events, [
      'acquired-1',
      'guard-1',
      'guarded-1',
      'closed-1',
      'open-acceptance-only',
    ]);
    finish.resolve();
    await f.parked(id);
  },
);

test(
  'a scope registered after the busy check opens only after historical closure',
  { timeout: 30000 },
  async (t) => {
    const selected = gate();
    const dispatch = gate();
    const callbackEntered = gate();
    const finish = gate();
    t.after(() => {
      dispatch.resolve();
      finish.resolve();
    });
    let callbacks = 0;
    let action = '';
    let accepting!: Promise<FrozenBrowserAcceptance>;
    const f = await fixture(
      t,
      {
        clock: () => 1000,
        offlineWorkerAcceptance: true,
        offlineWorkerConsumption: true,
        check: async (r, source) => {
          if (r.kind === 'baseline') return receipt(r.kind);
          if (++callbacks === 1) {
            action = r.actionId;
            return { type: 'infrastructure' };
          }
          accepting = source!.workerAcceptance!.accept();
          callbackEntered.resolve();
          await accepting;
          await finish.promise;
          return { type: 'infrastructure' };
        },
      },
      'browser',
      true,
    );
    const id = await f.add();
    const parked = await f.parked(id);
    const intent = sources(f.directory).at(-1).workerIntent;
    const selector = Controller.prototype as unknown as {
      selectActionSource(...args: unknown[]): Promise<OfflineActionWorkspace>;
    };
    const originalSelection = selector.selectActionSource;
    t.mock.method(
      selector,
      'selectActionSource',
      async function (this: Controller, ...args: unknown[]) {
        const source = await Reflect.apply(originalSelection, this, args);
        selected.resolve();
        await dispatch.promise;
        return source;
      },
    );
    const retrying = f.controller.command(
      command({ type: 'retry', caseId: id, note: 'Explicit retry' }, parked.version),
    );
    await selected.promise;
    const events: string[] = [];
    const gated = gateHistorical(t, events);
    const originalOpen = FrozenBrowserValidator.open;
    t.mock.method(FrozenBrowserValidator, 'open', (async (
      options: Parameters<typeof originalOpen>[0] & { mode?: string },
    ) => {
      events.push(`open-${options.mode}`);
      return Reflect.apply(originalOpen, FrozenBrowserValidator, [options]);
    }) as typeof originalOpen);
    const reading = f.controller.inspectWorkerConsumedHistory(id, action);
    await gated.entered.promise;
    dispatch.resolve();
    await callbackEntered.promise;
    assert.deepEqual(events, ['acquired-1', 'guard-1']);
    gated.release.resolve();
    assert.deepEqual(await reading, { state: 'absent', intent });
    const accepted = await accepting;
    assert.equal(accepted.request.action.epoch, sources(f.directory).at(-1).action.epoch);
    assert.notEqual(accepted.request.action.actionId, action);
    assert.deepEqual(events, [
      'acquired-1',
      'guard-1',
      'guarded-1',
      'closed-1',
      'open-consumption-only',
    ]);
    finish.resolve();
    await retrying;
    await f.parked(id);
  },
);

for (const failure of ['acquisition', 'guard', 'close'] as const)
  test(`historical ${failure} failure rejects the query, drains close and releases ownership`, async (t) => {
    let action = '';
    const f = await fixture(t, {
      check: async (r) => {
        action = r.actionId;
        return { type: 'infrastructure' };
      },
    });
    const id = await f.add();
    await f.parked(id);
    const intent = sources(f.directory)[0].workerIntent;
    const accepted = acceptanceFor(f.journalDirectory, intent.request);
    seed(f.journalDirectory, [consumedRecord(accepted, true)]);
    const before = await files(f.journalDirectory);
    const exec = DatabaseSync.prototype.exec;
    const close = DatabaseSync.prototype.close;
    let injected = false;
    t.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
      if (failure === 'acquisition' && !injected) {
        injected = true;
        throw Error('injected-acquisition');
      }
      const result = Reflect.apply(exec, this, [sql]);
      if (failure === 'guard' && !injected) {
        injected = true;
        writeFileSync(join(f.journalDirectory, 'journal.sqlite-journal'), '', { mode: 0o600 });
      }
      return result;
    });
    if (failure === 'close')
      t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
        const result = Reflect.apply(close, this, []);
        if (!injected) {
          injected = true;
          throw Error('injected-close');
        }
        return result;
      });
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => {
      unhandled.push(error);
    };
    process.on('unhandledRejection', onUnhandled);
    t.after(() => process.off('unhandledRejection', onUnhandled));
    await assert.rejects(
      f.controller.inspectWorkerConsumedHistory(id, action),
      failure === 'guard' ? /validator-rollback-sidecar/ : /injected-/,
    );
    t.mock.restoreAll();
    if (failure === 'guard') await rm(join(f.journalDirectory, 'journal.sqlite-journal'));
    await f.close();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(unhandled, []);
    assert.deepEqual(await files(f.journalDirectory), before);
    const selected = await FrozenBrowserValidator.readHistoricalSelection({
      directory: f.journalDirectory,
      expectedIdentity: {
        ownerId: accepted.ownerId,
        configurationDigest: accepted.configurationDigest,
      },
      action: intent.request.action,
    });
    assert.equal(selected?.kind, 'consumed');
    await f.reopen();
    const reopened = await f.controller.inspectWorkerConsumedHistory(id, action);
    assert.equal(reopened.state, 'consumed');
  });

test('historical storage absence, foreign identity and external ownership reject rather than claim absence', async (t) => {
  let action = '';
  const f = await fixture(t, {
    check: async (r) => {
      action = r.actionId;
      return { type: 'infrastructure' };
    },
  });
  const id = await f.add();
  await f.parked(id);
  const intent = sources(f.directory)[0].workerIntent;
  const saved = join(f.root, 'saved');
  await rename(f.journalDirectory, saved);
  await assert.rejects(f.controller.inspectWorkerConsumedHistory(id, action), { code: 'ENOENT' });
  await rename(saved, f.journalDirectory);
  const held = await FrozenBrowserValidator.open({
    directory: f.journalDirectory,
    workspace: forbiddenWorkspace,
    mode: 'journal-only',
  });
  await assert.rejects(
    f.controller.inspectWorkerConsumedHistory(id, action),
    /validator-already-open/,
  );
  await held.close();
  const markerPath = join(f.journalDirectory, 'owner.json');
  const marker = await readFile(markerPath);
  const foreign = JSON.parse(marker.toString());
  foreign.owner = randomUUID();
  const rows = journalRows(f.journalDirectory);
  await writeFile(markerPath, JSON.stringify(foreign));
  writeRows(f.journalDirectory, { ...rows, meta: { ...rows.meta, owner: foreign.owner } });
  await assert.rejects(
    f.controller.inspectWorkerConsumedHistory(id, action),
    /worker-journal-identity-mismatch/,
  );
  await writeFile(markerPath, marker);
  writeRows(f.journalDirectory, rows);
  assert.deepEqual(await f.controller.inspectWorkerConsumedHistory(id, action), {
    state: 'absent',
    intent,
  });
});
