import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { lstat, readdir, readFile, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  OfflineActionWorkspace,
  WorkerConsumedAdmissionObservation,
} from '../src/controller.ts';
import { FrozenBrowserValidator, frozenBrowserRequest } from '../src/frozen-browser.ts';
import type {
  FrozenBrowserAcceptance,
  FrozenBrowserReport,
  HistoricalWorkerSelection,
} from '../src/frozen-browser.ts';
import { ArtifactStore } from '../src/artifacts.ts';
import { NativeCase } from '../src/native.ts';
import { digest } from '../src/domain.ts';
import { sha256, virtualPath, WorkspaceStore } from '../src/workspace.ts';
import {
  fixture,
  sources,
  journalRows,
  gate,
  until,
  receipt,
  command,
} from './controller-worker-association-fixture.ts';
import { consumedRecord, selector, writeRows } from './frozen-browser-cleanup-fixture.ts';

const png = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c6360000200000500017a5eab3f0000000049454e44ae426082',
  'hex',
);
const unavailable = { state: 'unavailable', reason: 'not-retained-by-controller' };

function updateSource(directory: string, source: ReturnType<typeof sources>[number]) {
  const db = new DatabaseSync(join(directory, 'catalogue.sqlite'));
  try {
    db.prepare('UPDATE action_sources SET value=? WHERE action_id=?').run(
      JSON.stringify(source),
      source.action.id,
    );
  } finally {
    db.close();
  }
}
function seed(directory: string, runs: ReturnType<typeof journalRows>['runs']) {
  const rows = journalRows(directory);
  rows.meta.version = 3;
  rows.meta.attempts = runs.filter((r) => r.kind !== 'offline-acceptance').length;
  rows.meta.contribution = rows.meta.attempts * 41943040;
  rows.runs = runs;
  writeRows(directory, rows);
}
function records(f: Awaited<ReturnType<typeof fixture>>, source = sources(f.directory).at(-1)) {
  const { request } = source.workerIntent;
  const accepted: FrozenBrowserAcceptance = {
    acceptanceId: '44444444-4444-4444-8444-444444444444',
    request: structuredClone(request),
    requestDigest: sha256(digest(request)),
    configurationDigest: sha256(f.options.offlineWorkerJournal.configurationDigest),
    ownerId: f.options.offlineWorkerJournal.ownerId,
    acceptedAt: 500,
    deadline: 500 + request.allowanceMs,
  };
  const record = consumedRecord(accepted);
  const report: FrozenBrowserReport = {
    runId: record.execution.run.intent.runId,
    request: structuredClone(request),
    outcome: { kind: 'uncertain', code: 'scripted-diagnostic' },
    cleanup: { kind: 'owned-removed', cache: 'retained' },
    evidence: null,
  };
  Reflect.set(record.execution.run, 'result', { kind: 'settled', report });
  const facts = { consumedRun: selector(record), admittedAt: 1000, deadline: 13345 };
  const history = { ...facts, state: 'settled' as const, report };
  return { accepted, record, report, facts, history, source };
}
function retain(f: Awaited<ReturnType<typeof fixture>>, r: ReturnType<typeof records>) {
  updateSource(f.directory, { ...r.source, workerExecutionFacts: r.facts });
}
function behavioralReport(r: ReturnType<typeof records>, literal: 'A' | 'B') {
  const { request } = r.report;
  const manifest = [{ path: 'src/value.ts', size: 10, sha256: 'e'.repeat(64) }];
  Object.assign(r.report, {
    outcome: {
      kind:
        request.role === 'baseline'
          ? literal === 'A'
            ? 'baseline-reproduced'
            : 'baseline-not-reproduced'
          : literal === 'B'
            ? 'candidate-passed'
            : 'candidate-failed',
    },
    evidence: {
      provenance: {
        requestDigest: digest(request),
        configurationDigest: r.accepted.configurationDigest,
        frozen: structuredClone(request.frozen),
        transfer: manifest,
        contextBytes: 1024,
        contextSha256: 'b'.repeat(64),
        assets: {},
        policy: {},
        engine: {},
        baseBefore: {},
        baseAfter: {},
        imageId: `sha256:${'d'.repeat(64)}`,
        containerId: 'c'.repeat(64),
        applied: {},
        admittedAt: 1000,
        deadline: 13345,
        finishedAt: 12000,
        exitCode: 0,
        oomKilled: false,
        stdoutSha256: 'b'.repeat(64),
        stderrSha256: 'b'.repeat(64),
        buildStdoutSha256: 'b'.repeat(64),
        buildStderrSha256: 'b'.repeat(64),
      },
      observations: { stage: 'complete', literal, events: [], manifest: structuredClone(manifest) },
      png: {
        mime: 'image/png',
        size: 68,
        sha256: '43739c566e26fd7cb88f69d3864ea34740372f5ee99acac169e090beffbce5c6',
        base64:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
      },
    },
  });
}
function selection(r: ReturnType<typeof records>): HistoricalWorkerSelection {
  return { kind: 'consumed', acceptance: r.accepted, history: r.history };
}
function converted(observed: WorkerConsumedAdmissionObservation) {
  assert.equal(observed.state, 'consumed');
  if (observed.state !== 'consumed') assert.fail('missing consumption');
  assert.equal(observed.conversion.state, 'converted');
  if (observed.conversion.state !== 'converted') assert.fail('missing conversion');
  return observed.conversion.admission;
}
async function files(directory: string): Promise<unknown[]> {
  return Promise.all(
    (await readdir(directory)).sort().map(async (name) => {
      const path = join(directory, name);
      const stat = await lstat(path, { bigint: true });
      return {
        name,
        mode: stat.mode,
        ino: stat.ino,
        mtime: stat.mtimeNs,
        value: stat.isDirectory() ? await files(path) : await readFile(path),
      };
    }),
  );
}

for (const [kind, literal, outcome, passed] of [
  ['baseline', 'A', 'baseline-reproduced', true],
  ['baseline', 'B', 'baseline-not-reproduced', false],
  ['browser', 'B', 'candidate-passed', true],
  ['browser', 'A', 'candidate-failed', false],
] as const)
  test(`inspectWorkerConsumedAdmission converts shortened ${outcome} and detaches PNG without effects`, async (t) => {
    let now = 1000;
    let callbacks = 0;
    const f = await fixture(
      t,
      {
        clock: () => now,
        fault: (point) => {
          if (point === 'after-source-selection-receipt') now += 1234;
        },
        check: async () => {
          callbacks++;
          return { type: 'infrastructure' };
        },
      },
      kind,
    );
    const id = await f.add();
    await f.parked(id);
    const r = records(f);
    retain(f, r);
    behavioralReport(r, literal);
    const original = structuredClone(r);
    let reads = 0;
    t.mock.method(FrozenBrowserValidator, 'readHistoricalSelection', () => {
      reads++;
      return Promise.resolve(structuredClone(selection(r)));
    });
    const snapshot = await f.controller.snapshot({ selected: id });
    const before = await files(f.directory);
    const journalBefore = await files(f.journalDirectory);
    for (const target of [
      FrozenBrowserValidator.prototype,
      ArtifactStore.prototype,
      NativeCase.prototype,
    ])
      for (const method of Object.getOwnPropertyNames(target)) {
        if (
          method === 'constructor' ||
          typeof Object.getOwnPropertyDescriptor(target, method)?.value !== 'function'
        )
          continue;
        t.mock.method(target, method as never, () => {
          throw Error(`unexpected-effect-${method}`);
        });
      }
    t.mock.method(FrozenBrowserValidator, 'open', () => {
      throw Error('writable-open');
    });
    t.mock.method(Date, 'now', () => {
      throw Error('wall-clock-read');
    });
    t.mock.method(performance, 'now', () => {
      throw Error('performance-clock-read');
    });
    const clock = Reflect.get(f.controller, 'clock');
    t.mock.method(f.controller, 'clock' as never, () => {
      throw Error('controller-clock-read');
    });
    const read = () => f.controller.inspectWorkerConsumedAdmission(id, r.source.action.id);
    const first = await read();
    const expected = {
      state: 'consumed',
      intent: r.source.workerIntent,
      acceptance: { provenance: 'worker-journal', value: r.accepted },
      history: { provenance: 'worker-journal', value: r.history },
      independentExecutionPins: {
        state: 'retained',
        provenance: 'controller-live-consumption',
        intent: r.source.workerIntent,
        binding: { version: 1, ...f.options.offlineWorkerJournal },
        facts: r.facts,
      },
      conversion: {
        state: 'converted',
        admission: {
          type: 'behavioral',
          report: r.report,
          passed,
          outputs: [{ label: 'Frozen browser screenshot', mime: 'image/png', bytes: png }],
        },
      },
    };
    assert.deepEqual(first, expected);
    const admission = converted(first);
    if (admission.type !== 'behavioral' || first.state !== 'consumed')
      assert.fail('not behavioral');
    assert.equal(admission.report.request.allowanceMs, 58766);
    assert.deepEqual(admission.report.outcome, { kind: outcome });
    admission.outputs[0].bytes.fill(0);
    Object.assign(admission.report.request.action, { epoch: 99 });
    Object.assign(admission.report.evidence.observations, { literal: 'forged' });
    Object.assign(first.intent.request, { allowanceMs: 1 });
    Object.assign(first.history.value.consumedRun, { runId: randomUUID() });
    Object.assign(first.acceptance.value, { acceptedAt: 99, deadline: 100 });
    Object.assign(first.acceptance.value.request.action, { epoch: 99 });
    if (first.history.value.state !== 'settled') assert.fail('not settled');
    assert.notEqual(admission.report, first.history.value.report);
    Object.assign(first.history.value.report.request, { allowanceMs: 2 });
    Object.assign(first.history.value.report.evidence!.png, { base64: '' });
    if (first.independentExecutionPins.state !== 'retained') assert.fail('no pins');
    Object.assign(first.independentExecutionPins.facts, { deadline: 1001 });
    Object.assign(first.independentExecutionPins.intent.request, { role: 'forged' });
    Object.assign(first.independentExecutionPins.binding, { configurationDigest: 'f'.repeat(64) });
    assert.deepEqual(await read(), expected);
    assert.deepEqual(r, original);
    assert.equal(reads, 2);
    assert.equal(callbacks, 1);
    assert.deepEqual(await files(f.directory), before);
    assert.deepEqual(await files(f.journalDirectory), journalBefore);
    t.mock.restoreAll();
    assert.equal(Reflect.get(f.controller, 'clock'), clock);
    assert.deepEqual(await f.controller.snapshot({ selected: id }), snapshot);
  });

test('inspectWorkerConsumedAdmission preserves the state matrix and never backfills missing independent pins', async (t) => {
  const f = await fixture(t, {
    clock: () => 1000,
    check: async () => ({ type: 'infrastructure' }),
  });
  const id = await f.add();
  await f.parked(id);
  const r = records(f);
  const read = () => f.controller.inspectWorkerConsumedAdmission(id, r.source.action.id);
  const { workerIntent: _intent, ...withoutIntent } = r.source;
  updateSource(f.directory, withoutIntent);
  const forbiddenRead = t.mock.method(FrozenBrowserValidator, 'readHistoricalSelection', () => {
    throw Error('unrecorded-history-acquisition');
  });
  assert.deepEqual(await read(), { state: 'unrecorded' });
  forbiddenRead.mock.restore();
  updateSource(f.directory, r.source);
  for (const retained of [false, true]) {
    if (retained) retain(f, r);
    for (const state of [
      'absent',
      'legacy-execution',
      'request-mismatch',
      'accepted-unconsumed',
      'pending',
      'recorded',
      'settled',
    ] as const) {
      const record = structuredClone(r.record);
      if (state === 'pending') Reflect.set(record.execution.run, 'result', { kind: 'pending' });
      if (state === 'recorded')
        Reflect.set(record.execution.run, 'result', {
          kind: 'recorded',
          outcome: { kind: 'uncertain', code: 'recorded-diagnostic' },
          evidence: null,
        });
      if (state === 'legacy-execution')
        record.execution.run.intent.deadline = 1000 + r.accepted.request.allowanceMs;
      if (state === 'request-mismatch') {
        const request = frozenBrowserRequest({ ...r.accepted.request, role: 'baseline' });
        Object.assign(record.acceptance, { request, requestDigest: digest(request) });
        Object.assign(record.execution.run.intent, { request, requestDigest: digest(request) });
        Reflect.set(record.execution.run, 'result', { kind: 'pending' });
      }
      seed(
        f.journalDirectory,
        state === 'absent'
          ? []
          : state === 'accepted-unconsumed'
            ? [{ kind: 'offline-acceptance', ...r.accepted }]
            : state === 'legacy-execution'
              ? [{ kind: 'execution', run: record.execution.run }]
              : [record],
      );
      const before = sources(f.directory);
      const raw = await f.controller.inspectWorkerConsumedHistory(id, r.source.action.id);
      const observed = await read();
      if (raw.state !== 'consumed') {
        assert.deepEqual(observed, raw);
        assert.equal(
          observed.state,
          state === 'legacy-execution' || state === 'request-mismatch' ? 'conflict' : state,
        );
        if (observed.state === 'conflict') assert.equal(observed.reason, state);
      } else {
        assert.equal(observed.state, 'consumed');
        if (observed.state !== 'consumed') assert.fail('missing history');
        const { conversion, ...history } = observed;
        assert.deepEqual(history, raw);
        if (state !== 'settled') assert.deepEqual(conversion, { state: 'not-settled' });
        else if (!retained) assert.deepEqual(conversion, { state: 'independent-pins-unavailable' });
        else
          assert.deepEqual(converted(observed), {
            type: 'blocked',
            reason: 'uncertain',
            report: r.report,
          });
        if (!retained) assert.deepEqual(observed.independentExecutionPins, unavailable);
      }
      assert.deepEqual(sources(f.directory), before);
    }
  }
  updateSource(f.directory, r.source);
  await f.close();
  await f.reopen();
  const observed = await read();
  assert.equal(observed.state, 'consumed');
  if (observed.state !== 'consumed') assert.fail('missing history');
  assert.deepEqual(observed.conversion, { state: 'independent-pins-unavailable' });
  assert.equal(Object.hasOwn(sources(f.directory)[0], 'workerExecutionFacts'), false);
});

for (const field of ['acceptanceId', 'runId', 'admittedAt', 'deadline'] as const)
  test(`inspectWorkerConsumedAdmission rejects independently pinned ${field} mismatch and leaves queue usable`, async (t) => {
    const f = await fixture(t, { check: async () => ({ type: 'infrastructure' }) });
    const id = await f.add();
    await f.parked(id);
    const r = records(f);
    seed(f.journalDirectory, [r.record]);
    const facts = structuredClone(r.facts);
    if (field === 'acceptanceId' || field === 'runId')
      Object.assign(facts.consumedRun, { [field]: randomUUID() });
    else facts[field]++;
    updateSource(f.directory, { ...r.source, workerExecutionFacts: facts });
    await assert.rejects(
      f.controller.inspectWorkerConsumedAdmission(id, r.source.action.id),
      /invalid-frozen-browser-admission/,
    );
    retain(f, r);
    const raw = f.controller.inspectWorkerConsumedHistory(id, r.source.action.id);
    const admitted = f.controller.inspectWorkerConsumedAdmission(id, r.source.action.id);
    assert.equal((await raw).state, 'consumed');
    assert.deepEqual(converted(await admitted), {
      type: 'blocked',
      reason: 'uncertain',
      report: r.report,
    });
  });

for (const mismatch of ['request-digest', 'configuration', 'report-request'] as const)
  test(`inspectWorkerConsumedAdmission propagates ${mismatch} validation instead of using historical expectations`, async (t) => {
    const f = await fixture(t, { check: async () => ({ type: 'infrastructure' }) });
    const id = await f.add();
    await f.parked(id);
    const r = records(f);
    retain(f, r);
    behavioralReport(r, 'B');
    if (mismatch === 'request-digest')
      Object.assign(r.history.consumedRun, { requestDigest: 'f'.repeat(64) });
    if (mismatch === 'configuration')
      Object.assign(r.report.evidence!.provenance, { configurationDigest: 'f'.repeat(64) });
    if (mismatch === 'report-request') Object.assign(r.report.request, { allowanceMs: 59999 });
    t.mock.method(FrozenBrowserValidator, 'readHistoricalSelection', async () =>
      structuredClone(selection(r)),
    );
    await assert.rejects(
      f.controller.inspectWorkerConsumedAdmission(id, r.source.action.id),
      /invalid-frozen-browser-admission/,
    );
    Object.assign(r.report, {
      outcome: { kind: 'uncertain', code: 'scripted' },
      cleanup: { kind: 'incomplete', cache: 'retained', code: 'unconfirmed' },
    });
    await assert.rejects(
      f.controller.inspectWorkerConsumedAdmission(id, r.source.action.id),
      /invalid-frozen-browser-admission/,
    );
  });

for (const [outcome, reason] of [
  [{ kind: 'infrastructure-failed', code: 'scripted' }, 'infrastructure'],
  [{ kind: 'cancelled', code: 'scripted' }, 'cancelled'],
  [{ kind: 'uncertain', code: 'scripted' }, 'uncertain'],
] as const)
  test(`inspectWorkerConsumedAdmission returns converted blocked ${reason} and cleanup precedence normally`, async (t) => {
    const f = await fixture(t, { check: async () => ({ type: 'infrastructure' }) });
    const id = await f.add();
    await f.parked(id);
    const r = records(f);
    retain(f, r);
    Object.assign(r.report, { outcome });
    for (const incomplete of [false, true]) {
      if (incomplete)
        Object.assign(r.report, {
          cleanup: { kind: 'incomplete', cache: 'retained', code: 'unconfirmed' },
        });
      seed(f.journalDirectory, [r.record]);
      const before = await files(f.journalDirectory);
      const observed = await f.controller.inspectWorkerConsumedAdmission(id, r.source.action.id);
      assert.deepEqual(converted(observed), {
        type: 'blocked',
        reason: incomplete ? 'cleanup-incomplete' : reason,
        report: r.report,
      });
      Object.assign(converted(observed).report.request, { allowanceMs: 1 });
      assert.deepEqual(
        converted(await f.controller.inspectWorkerConsumedAdmission(id, r.source.action.id)).report,
        r.report,
      );
      assert.deepEqual(await files(f.journalDirectory), before);
    }
  });

test('inspectWorkerConsumedAdmission keeps original attribution after edit, interruption, Retry and reopen', async (t) => {
  const entered = gate();
  const finish = gate();
  t.after(() => finish.resolve());
  let originalAction = '';
  let originalSource!: OfflineActionWorkspace;
  let callbacks = 0;
  const f = await fixture(
    t,
    {
      clock: () => 1000,
      check: async (request, source) => {
        if (request.kind === 'baseline') return receipt(request.kind);
        if (++callbacks > 1) return { type: 'infrastructure' };
        originalAction = request.actionId;
        originalSource = source!;
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
  const r = records(f);
  retain(f, r);
  seed(f.journalDirectory, [r.record]);
  const read = () => f.controller.inspectWorkerConsumedAdmission(id, originalAction);
  const original = await read();
  assert.deepEqual(converted(original), { type: 'blocked', reason: 'uncertain', report: r.report });
  assert.deepEqual(r.accepted.request.frozen, originalSource.selection);
  finish.resolve();
  const parked = await f.parked(id);
  assert.equal(sources(f.directory).at(-1).state, 'interrupted');
  assert.deepEqual(await read(), original);
  await f.controller.command(
    command({ type: 'retry', caseId: id, note: 'Explicit retry' }, parked.version),
  );
  const retried = await f.parked(id);
  assert.notEqual(retried.epoch, r.accepted.request.action.epoch);
  assert.notEqual(sources(f.directory).at(-1).frozen.revision, originalSource.selection.revision);
  assert.deepEqual(await read(), original);
  const rows = journalRows(f.journalDirectory);
  await f.close();
  await f.reopen();
  assert.deepEqual(await read(), original);
  assert.deepEqual(journalRows(f.journalDirectory), rows);
});

test('inspectWorkerConsumedAdmission captures intent and independent pins before queued acquisition', async (t) => {
  const f = await fixture(t, { check: async () => ({ type: 'infrastructure' }) });
  const id = await f.add();
  await f.parked(id);
  const r = records(f);
  retain(f, r);
  seed(f.journalDirectory, [r.record]);
  const entered = gate();
  const release = gate();
  t.after(() => release.resolve());
  let reads = 0;
  const original = FrozenBrowserValidator.readHistoricalSelection;
  t.mock.method(
    FrozenBrowserValidator,
    'readHistoricalSelection',
    async (options: Parameters<typeof original>[0]) => {
      if (++reads === 1) {
        entered.resolve();
        await release.promise;
      }
      return original(options);
    },
  );
  const raw = f.controller.inspectWorkerConsumedHistory(id, r.source.action.id);
  await entered.promise;
  const reading = f.controller.inspectWorkerConsumedAdmission(id, r.source.action.id);
  const request = frozenBrowserRequest({ ...r.accepted.request, role: 'baseline' });
  updateSource(f.directory, {
    ...r.source,
    kind: 'baseline',
    workerIntent: { request, requestDigest: digest(request) },
    workerExecutionFacts: {
      ...r.facts,
      consumedRun: { ...r.facts.consumedRun, requestDigest: digest(request), runId: randomUUID() },
    },
  });
  release.resolve();
  assert.equal((await raw).state, 'consumed');
  const observed = await reading;
  assert.deepEqual(converted(observed), { type: 'blocked', reason: 'uncertain', report: r.report });
  if (observed.state !== 'consumed') assert.fail('missing consumption');
  assert.deepEqual(observed.intent, r.source.workerIntent);
  assert.equal(observed.independentExecutionPins.state, 'retained');
  assert.equal(reads, 2);
  updateSource(f.directory, { ...r.source, workerExecutionFacts: r.facts });
});

for (const stage of ['lazy', 'acquiring', 'held', 'revoked-draining'] as const)
  test(`inspectWorkerConsumedAdmission rejects ${stage} scopes without history acquisition`, async (t) => {
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
    let action = '';
    let accepting: Promise<unknown> | undefined;
    const f = await fixture(t, {
      clock: () => 1000,
      offlineWorkerAcceptance: true,
      offlineWorkerConsumption: true,
      check: async (request, source) => {
        action = request.actionId;
        entered.resolve();
        if (stage !== 'lazy') {
          accepting = source!.workerAcceptance!.accept();
          await accepting;
        }
        await finish.promise;
        return { type: 'infrastructure' };
      },
    });
    const originalOpen = FrozenBrowserValidator.open;
    t.mock.method(
      FrozenBrowserValidator,
      'open',
      async (options: Parameters<typeof originalOpen>[0] & { mode?: string }) => {
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
      },
    );
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
    }
    const denied = assert.rejects(
      f.controller.inspectWorkerConsumedAdmission(id, action),
      /worker-history-busy/,
    );
    releaseOpen.resolve();
    await denied;
    assert.equal(reads, 0);
    finish.resolve();
    releaseClose.resolve();
    await f.parked(id);
    const observed = await until(
      async () => {
        try {
          return await f.controller.inspectWorkerConsumedAdmission(id, action);
        } catch (error) {
          if (error instanceof Error && error.message === 'worker-history-busy') return null;
          throw error;
        }
      },
      (r) => r !== null,
    );
    assert.equal(observed?.state, stage === 'lazy' ? 'absent' : 'accepted-unconsumed');
    assert.equal(reads, 1);
    assert.equal(journalRows(f.journalDirectory).meta.attempts, 0);
  });

test('inspectWorkerConsumedAdmission validates sources and facts before history and propagates binding errors', async (t) => {
  const f = await fixture(t, { check: async () => ({ type: 'infrastructure' }) });
  const id = await f.add();
  await f.parked(id);
  const r = records(f);
  t.mock.method(FrozenBrowserValidator, 'readHistoricalSelection', () => {
    throw Error('unexpected-acquisition');
  });
  for (const [caseId, action, code] of [
    ['invalid', r.source.action.id, 'invalid-worker-association-id'],
    [id, 'invalid', 'invalid-worker-association-id'],
    [id, randomUUID(), 'action-source-missing'],
    [randomUUID(), r.source.action.id, 'invalid-action-source'],
  ])
    await assert.rejects(f.controller.inspectWorkerConsumedAdmission(caseId, action), { code });
  for (const facts of [
    null,
    { ...r.facts, deadline: 1000 },
    { ...r.facts, consumedRun: { ...r.facts.consumedRun, requestDigest: 'f'.repeat(64) } },
  ]) {
    updateSource(f.directory, { ...r.source, workerExecutionFacts: facts });
    await assert.rejects(
      f.controller.inspectWorkerConsumedAdmission(id, r.source.action.id),
      /invalid-worker-execution-facts/,
    );
  }
  updateSource(f.directory, { ...r.source, unexpected: true });
  await assert.rejects(
    f.controller.inspectWorkerConsumedAdmission(id, r.source.action.id),
    /invalid-action-source/,
  );
  updateSource(f.directory, r.source);
  const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
  db.prepare("UPDATE metadata SET value=? WHERE key='offline_worker_journal'").run(
    JSON.stringify({ version: 1, ...f.options.offlineWorkerJournal, ownerId: randomUUID() }),
  );
  await assert.rejects(
    f.controller.inspectWorkerConsumedAdmission(id, r.source.action.id),
    /invalid-worker-journal-binding/,
  );
  db.prepare("UPDATE metadata SET value=? WHERE key='offline_worker_journal'").run(
    JSON.stringify({ version: 1, ...f.options.offlineWorkerJournal }),
  );
  db.close();
});

for (const immediate of [false, true])
  test(`inspectWorkerConsumedAdmission drains mixed queries through closure and conversion with ${immediate ? 'immediate' : 'gated'} close`, async (t) => {
    const f = await fixture(t, { check: async () => ({ type: 'infrastructure' }) });
    const id = await f.add();
    await f.parked(id);
    const r = records(f);
    retain(f, r);
    seed(f.journalDirectory, [r.record]);
    const entered = gate();
    const release = gate();
    t.after(() => release.resolve());
    const events: string[] = [];
    const acquisition = FrozenBrowserValidator as unknown as {
      acquireJournal(options: {
        historical?: true;
      }): Promise<{ guard(): Promise<void>; close(): void }>;
    };
    const acquire = acquisition.acquireJournal;
    let reads = 0;
    t.mock.method(acquisition, 'acquireJournal', async (options: { historical?: true }) => {
      const journal = await Reflect.apply(acquire, FrozenBrowserValidator, [options]);
      if (!options.historical) return journal;
      const index = ++reads;
      events.push(`acquired-${index}`);
      return {
        ...journal,
        guard: async () => {
          if (index === 1 && !immediate) {
            entered.resolve();
            await release.promise;
          }
          await journal.guard();
        },
        close: () => {
          journal.close();
          events.push(`closed-${index}`);
        },
      };
    });
    const workspaceClose = WorkspaceStore.prototype.close;
    t.mock.method(WorkspaceStore.prototype, 'close', async function (this: WorkspaceStore) {
      assert.ok(events.includes('converted'));
      events.push('workspace-close');
      await Reflect.apply(workspaceClose, this, []);
    });
    const reading = f.controller.inspectWorkerConsumedAdmission(id, r.source.action.id);
    void reading.then(() => events.push('converted'));
    if (!immediate) await entered.promise;
    const raw = f.controller.inspectWorkerConsumedHistory(id, r.source.action.id);
    const closing = f.controller.close();
    assert.equal(f.controller.close(), closing);
    await assert.rejects(
      f.controller.inspectWorkerConsumedAdmission(id, r.source.action.id),
      /controller-closed/,
    );
    if (!immediate) {
      let closed = false;
      void closing.then(() => {
        closed = true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(closed, false);
      assert.deepEqual(events, ['acquired-1']);
      release.resolve();
    }
    assert.deepEqual(converted(await reading), {
      type: 'blocked',
      reason: 'uncertain',
      report: r.report,
    });
    assert.equal((await raw).state, 'consumed');
    await closing;
    assert.equal(reads, 2);
    assert.ok(events.indexOf('closed-1') < events.indexOf('converted'));
    assert.ok(events.indexOf('closed-1') < events.indexOf('acquired-2'));
    assert.equal(events.at(-1), 'workspace-close');
    await f.close();
  });

for (const failure of ['acquisition', 'guard', 'close'] as const)
  test(`inspectWorkerConsumedAdmission propagates historical ${failure} failure before conversion and drains`, async (t) => {
    const f = await fixture(t, { check: async () => ({ type: 'infrastructure' }) });
    const id = await f.add();
    await f.parked(id);
    const r = records(f);
    seed(f.journalDirectory, [r.record]);
    updateSource(f.directory, {
      ...r.source,
      workerExecutionFacts: {
        ...r.facts,
        consumedRun: { ...r.facts.consumedRun, runId: randomUUID() },
      },
    });
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
    await assert.rejects(
      f.controller.inspectWorkerConsumedAdmission(id, r.source.action.id),
      failure === 'guard' ? /validator-rollback-sidecar/ : /injected-/,
    );
    t.mock.restoreAll();
    if (failure === 'guard') await rm(join(f.journalDirectory, 'journal.sqlite-journal'));
    await f.close();
    await f.reopen();
    await assert.rejects(
      f.controller.inspectWorkerConsumedAdmission(id, r.source.action.id),
      /invalid-frozen-browser-admission/,
    );
    retain(f, r);
    assert.equal(
      converted(await f.controller.inspectWorkerConsumedAdmission(id, r.source.action.id)).type,
      'blocked',
    );
  });

test('inspectWorkerConsumedAdmission conversion rejection does not poison immediate close', async (t) => {
  const f = await fixture(t, { check: async () => ({ type: 'infrastructure' }) });
  const id = await f.add();
  await f.parked(id);
  const r = records(f);
  seed(f.journalDirectory, [r.record]);
  updateSource(f.directory, { ...r.source, workerExecutionFacts: { ...r.facts, deadline: 13346 } });
  const reading = f.controller.inspectWorkerConsumedAdmission(id, r.source.action.id);
  const closing = f.controller.close();
  await assert.rejects(reading, /invalid-frozen-browser-admission/);
  await closing;
  await f.close();
});
