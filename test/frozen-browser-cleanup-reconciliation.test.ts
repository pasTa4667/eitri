import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FrozenBrowserValidator } from '../src/frozen-browser.ts';
import type { FrozenBrowserConsumedRunKey } from '../src/frozen-browser.ts';
import { sha256 } from '../src/workspace.ts';
import { forbiddenWorkspace, journalRows } from './controller-worker-association-fixture.ts';
import { consumptionFixture, deferred } from './frozen-browser-consumption-fixture.ts';
import {
  cleanupFixture,
  consumedRecord,
  otherAcceptance,
  selector,
  writeRows,
} from './frozen-browser-cleanup-fixture.ts';

const prototype = FrozenBrowserValidator.prototype;
const removed = { kind: 'owned-removed', cache: 'retained' };
const incomplete = { kind: 'incomplete', cache: 'retained', code: 'owned-cleanup-unconfirmed' };

function replace(t: test.TestContext, name: string, value: unknown) {
  const original = Reflect.get(prototype, name);
  Reflect.set(prototype, name, value);
  t.after(() => Reflect.set(prototype, name, original));
  return original;
}

async function assertReleased(
  options: Parameters<typeof FrozenBrowserValidator.reconcileConsumed>[0],
) {
  const journal = await FrozenBrowserValidator.open({ ...options, mode: 'journal-only' });
  await journal.close();
}

function cleanupCommands(calls: string[][]) {
  assert.equal(calls.length > 0, true);
  for (const call of calls)
    assert.equal(
      ['image', 'container'].includes(call[0]) && ['ls', 'inspect', 'rm'].includes(call[1]),
      true,
      JSON.stringify(call),
    );
}

test('reconcileConsumed repairs one nested record with evidence, exhausted quota and unrelated pending rows intact', async (t) => {
  const f = await consumptionFixture(t, 'cleanup-fail');
  const consumed = await f.journal.consume(f.accepted, () => 12345, new AbortController().signal);
  assert.deepEqual(consumed.run.cleanup, incomplete);
  await f.journal.close();
  const rows = journalRows(f.directory);
  for (let i = 1; i < 16; i++) {
    const record = consumedRecord(otherAcceptance(f.accepted), i % 2 === 0);
    if (i === 2) {
      const run = record.execution.run;
      run.intent.deadline = run.intent.admittedAt + run.intent.request.allowanceMs;
      rows.runs.push({ kind: 'execution', run });
    } else rows.runs.push(record);
  }
  const unrelated = rows.runs[1].execution.run;
  unrelated.result = {
    kind: 'settled',
    report: {
      runId: unrelated.intent.runId,
      request: unrelated.intent.request,
      outcome: unrelated.result.outcome,
      evidence: null,
      cleanup: incomplete,
    },
  };
  rows.runs.push({ kind: 'offline-acceptance', ...otherAcceptance(f.accepted) });
  rows.meta.attempts = 16;
  rows.meta.contribution = 671088640;
  writeRows(f.directory, rows);
  const before = journalRows(f.directory);
  const statePath = join(f.root, 'transcript.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  await writeFile(statePath, JSON.stringify({ ...state, calls: [], mode: 'normal' }));
  const options = {
    ...f.options,
    workspace: forbiddenWorkspace,
    consumedRun: selector(rows.runs[0]),
  };
  const result = await FrozenBrowserValidator.reconcileConsumed(options);
  assert.deepEqual(result, { ...consumed, run: { ...consumed.run, cleanup: removed } });
  assert.deepEqual(Object.keys(result).sort(), ['acceptanceId', 'run']);
  assert.equal('evidence' in result.run, false);
  const after = journalRows(f.directory);
  assert.deepEqual(after.meta, before.meta);
  assert.deepEqual(after.runs.slice(1), before.runs.slice(1));
  assert.deepEqual(after.runs[0].acceptance, before.runs[0].acceptance);
  assert.deepEqual(after.runs[0].execution.admission, before.runs[0].execution.admission);
  assert.deepEqual(after.runs[0].execution.run.intent, before.runs[0].execution.run.intent);
  assert.deepEqual(after.runs[0].execution.run.result.report, {
    ...before.runs[0].execution.run.result.report,
    cleanup: removed,
  });
  cleanupCommands((await f.state()).calls);
  const calls = (await f.state()).calls;
  const originalExec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function (sql) {
    if (sql === 'BEGIN IMMEDIATE') throw Error('historical-retry-wrote');
    return Reflect.apply(originalExec, this, [sql]);
  };
  try {
    assert.deepEqual(await FrozenBrowserValidator.reconcileConsumed(options), result);
  } finally {
    DatabaseSync.prototype.exec = originalExec;
  }
  Object.assign(result.run.request.action, { epoch: 99 });
  Object.assign(result.run.image, { id: 'sha256:' + 'a'.repeat(64) });
  assert.deepEqual(journalRows(f.directory), after);
  assert.deepEqual((await f.state()).calls, calls);
});

test('pending selection normalizes only its own run and never replays or spends allowance', async (t) => {
  const f = await cleanupFixture(t, true);
  const other = consumedRecord(otherAcceptance(f.accepted), true);
  f.rows.runs.push(other);
  f.rows.meta.attempts = 2;
  f.rows.meta.contribution = 83886080;
  writeRows(f.directory, f.rows);
  const result = await f.reconcile();
  assert.deepEqual(result.run.outcome, { kind: 'uncertain', code: 'interrupted-run-no-replay' });
  assert.deepEqual(result.run.cleanup, removed);
  assert.equal(result.run.state, 'settled');
  assert.equal(result.run.admittedAt, 1000);
  assert.equal(result.run.deadline, 13345);
  const after = journalRows(f.directory);
  assert.deepEqual(after.meta, f.rows.meta);
  assert.deepEqual(after.runs[1], other);
  assert.equal(after.runs[0].execution.run.result.report.evidence, null);
  cleanupCommands((await f.state()).calls);
});

test('independent identity pins and exact consumed selectors reject before any recovery write or workspace access', async (t) => {
  const f = await cleanupFixture(t, true);
  const unconsumed = { kind: 'offline-acceptance', ...otherAcceptance(f.accepted) };
  const other = consumedRecord(otherAcceptance(f.accepted), true);
  const ordinary = consumedRecord(otherAcceptance(f.accepted));
  ordinary.execution.run.intent.deadline = 61000;
  f.rows.runs.push(unconsumed, other, { kind: 'execution', run: ordinary.execution.run });
  f.rows.meta.attempts = 3;
  f.rows.meta.contribution = 125829120;
  writeRows(f.directory, f.rows);
  const before = journalRows(f.directory);
  const options = f.cleanupOptions;
  const wrongSelectors = [
    { ...options.consumedRun, acceptanceId: randomUUID() },
    { ...options.consumedRun, runId: randomUUID() },
    { ...options.consumedRun, requestDigest: sha256('f'.repeat(64)) },
    { ...options.consumedRun, acceptanceId: unconsumed.acceptanceId },
    { ...options.consumedRun, runId: other.execution.run.intent.runId },
    { ...selector(other), requestDigest: options.consumedRun.requestDigest },
    selector(ordinary),
  ];
  for (const consumedRun of wrongSelectors)
    await assert.rejects(
      FrozenBrowserValidator.reconcileConsumed({ ...options, consumedRun }),
      /validator-identity-conflict/,
    );
  for (const expectedIdentity of [
    undefined,
    { ...options.expectedIdentity, ownerId: randomUUID() },
    { ...options.expectedIdentity, configurationDigest: sha256('f'.repeat(64)) },
  ])
    await assert.rejects(
      FrozenBrowserValidator.reconcileConsumed({ ...options, expectedIdentity: expectedIdentity! }),
      /worker-journal-identity-(required|mismatch)/,
    );
  assert.deepEqual(journalRows(f.directory), before);
  assert.deepEqual((await f.state()).calls, []);
  const result = await f.reconcile();
  assert.deepEqual(result.run.cleanup, removed);
});

test('strict selectors and identity snapshots reject exotic inputs without invoking accessors or proxies', async (t) => {
  const f = await cleanupFixture(t, true);
  const key = f.cleanupOptions.consumedRun;
  let accessed = 0;
  const accessor = { ...key };
  Object.defineProperty(accessor, 'runId', {
    enumerable: true,
    get: () => {
      accessed++;
      return key.runId;
    },
  });
  const proxy = new Proxy(key, {
    ownKeys() {
      accessed++;
      return [];
    },
  });
  const hidden = { ...key };
  Object.defineProperty(hidden, 'extra', { value: 1 });
  const invalid: unknown[] = [
    undefined,
    null,
    [],
    new Date(),
    new Map(),
    proxy,
    accessor,
    hidden,
    { ...key, extra: true },
    { ...key, [Symbol('extra')]: true },
    { acceptanceId: key.acceptanceId, runId: key.runId },
    { ...key, runId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' },
    { ...key, runId: 'not-a-uuid' },
    { ...key, requestDigest: 'F'.repeat(64) },
    { ...key, requestDigest: 'f'.repeat(63) },
    Object.assign(Object.create({ inherited: true }), key),
  ];
  const before = journalRows(f.directory);
  for (const consumedRun of invalid)
    await assert.rejects(
      FrozenBrowserValidator.reconcileConsumed({
        ...f.cleanupOptions,
        consumedRun: consumedRun as FrozenBrowserConsumedRunKey,
      }),
    );
  for (const expectedIdentity of [
    { ...f.cleanupOptions.expectedIdentity, extra: true },
    new Proxy(f.cleanupOptions.expectedIdentity, {}),
    { ...f.cleanupOptions.expectedIdentity, ownerId: 'invalid' },
  ])
    await assert.rejects(
      FrozenBrowserValidator.reconcileConsumed({ ...f.cleanupOptions, expectedIdentity }),
    );
  assert.equal(accessed, 0);
  assert.deepEqual(journalRows(f.directory), before);
  assert.deepEqual((await f.state()).calls, []);
  assert.deepEqual((await f.reconcile()).run.cleanup, removed);
});

test('all selected inputs are snapshotted before the first await', async (t) => {
  const f = await cleanupFixture(t);
  const options = {
    ...f.cleanupOptions,
    expectedIdentity: { ...f.cleanupOptions.expectedIdentity },
    consumedRun: { ...f.cleanupOptions.consumedRun },
  };
  const running = FrozenBrowserValidator.reconcileConsumed(options);
  options.directory = join(f.root, 'missing');
  options.workspace = new Proxy(forbiddenWorkspace, {
    get: () => {
      throw Error('mutated-workspace-used');
    },
  });
  options.expectedIdentity.ownerId = randomUUID();
  options.expectedIdentity.configurationDigest = sha256('f'.repeat(64));
  options.consumedRun.acceptanceId = randomUUID();
  options.consumedRun.runId = randomUUID();
  options.consumedRun.requestDigest = sha256('f'.repeat(64));
  const result = await running;
  assert.equal(result.acceptanceId, f.accepted.acceptanceId);
  assert.equal(result.run.runId, f.record.execution.run.intent.runId);
  assert.deepEqual(result.run.cleanup, removed);
});

test('existing-only acquisition rejects missing, unsafe and replaced storage without provisioning or cleanup', async (t) => {
  const f = await cleanupFixture(t, true);
  const empty = join(f.root, 'empty');
  await mkdir(empty, { mode: 0o700 });
  await assert.rejects(
    FrozenBrowserValidator.reconcileConsumed({ ...f.cleanupOptions, directory: empty }),
    /unowned-validator-directory/,
  );
  assert.deepEqual(await readdir(empty), []);
  for (const name of ['owner.json', 'journal.sqlite', 'seccomp.json']) {
    const path = join(f.directory, name),
      saved = join(f.root, name + '.saved');
    await rename(path, saved);
    await assert.rejects(f.reconcile(), /unowned-validator-directory/);
    await rename(saved, path);
  }
  await chmod(f.directory, 0o755);
  await assert.rejects(f.reconcile(), /unsafe-validator-root/);
  await chmod(f.directory, 0o700);
  const policy = join(f.directory, 'seccomp.json');
  await chmod(policy, 0o644);
  await assert.rejects(f.reconcile());
  await chmod(policy, 0o600);
  const journal = join(f.directory, 'journal.sqlite');
  const saved = join(f.root, 'journal.saved');
  await rename(journal, saved);
  await writeFile(journal, await readFile(saved), { mode: 0o600 });
  await assert.rejects(f.reconcile(), /validator-owner-mismatch/);
  await rename(saved, journal);
  assert.deepEqual(journalRows(f.directory), f.rows);
  assert.deepEqual((await f.state()).calls, []);
  assert.deepEqual((await f.reconcile()).run.cleanup, removed);
});

for (const point of ['guard', 'removal', 'settlement', 'close'] as const)
  test(`directory ownership covers ${point} and rejects duplicates, other selectors and every opening mode`, async (t) => {
    const f = await cleanupFixture(t);
    const entered = deferred(),
      release = deferred();
    let gated = false;
    const method = point === 'removal' ? 'client' : point === 'settlement' ? 'saveNow' : point;
    const original = Reflect.get(prototype, method);
    replace(t, method, async function (this: FrozenBrowserValidator, ...args: unknown[]) {
      const match =
        point === 'removal'
          ? (args[0] as string[])[0] === 'container' && (args[0] as string[])[1] === 'rm'
          : point === 'settlement'
            ? Reflect.get(args[0] as object, 'result').kind === 'settled'
            : true;
      if (!gated && match) {
        gated = true;
        entered.resolve();
        await release.promise;
      }
      return Reflect.apply(original, this, args);
    });
    t.after(() => release.resolve());
    let finished = false;
    const running = f.reconcile().finally(() => {
      finished = true;
    });
    await assert.rejects(f.reconcile(), /validator-already-open/);
    await entered.promise;
    await assert.rejects(f.reconcile(), /validator-already-open/);
    await assert.rejects(
      FrozenBrowserValidator.reconcileConsumed({
        ...f.cleanupOptions,
        consumedRun: { ...f.cleanupOptions.consumedRun, acceptanceId: randomUUID() },
      }),
      /validator-already-open/,
    );
    await assert.rejects(f.open(), /validator-already-open/);
    await assert.rejects(
      FrozenBrowserValidator.open({ ...f.options, mode: 'acceptance-only' }),
      /validator-already-open/,
    );
    await assert.rejects(
      FrozenBrowserValidator.open({ ...f.options, mode: 'journal-only' }),
      /validator-already-open/,
    );
    await assert.rejects(
      FrozenBrowserValidator.open({ directory: f.directory, workspace: forbiddenWorkspace }),
      /validator-already-open/,
    );
    assert.equal(finished, false);
    release.resolve();
    assert.deepEqual((await running).run.cleanup, removed);
    assert.equal(finished, true);
    await assertReleased(f.cleanupOptions);
  });

test('held owners prevent reconciliation until explicitly closed', async (t) => {
  const f = await cleanupFixture(t);
  for (const mode of ['journal-only', 'acceptance-only', 'consumption-only'] as const) {
    const owner =
      mode === 'consumption-only'
        ? await f.open()
        : mode === 'acceptance-only'
          ? await FrozenBrowserValidator.open({ ...f.options, mode })
          : await FrozenBrowserValidator.open({ ...f.options, mode });
    await assert.rejects(f.reconcile(), /validator-already-open/);
    await owner.close();
  }
  assert.deepEqual(journalRows(f.directory), f.rows);
  assert.deepEqual((await f.reconcile()).run.cleanup, removed);
});

for (const state of ['recorded', 'incomplete', 'pending'] as const)
  test(`restricted modes retain ${state} history and ordinary opening still finalizes`, async (t) => {
    const f = await cleanupFixture(t, state === 'pending');
    if (state === 'incomplete') {
      const run = f.rows.runs[0].execution.run;
      run.result = {
        kind: 'settled',
        report: {
          runId: run.intent.runId,
          request: run.intent.request,
          outcome: run.result.outcome,
          evidence: null,
          cleanup: incomplete,
        },
      };
      writeRows(f.directory, f.rows);
    }
    for (const mode of ['journal-only', 'acceptance-only', 'consumption-only'] as const) {
      const journal =
        mode === 'consumption-only'
          ? await f.open()
          : mode === 'acceptance-only'
            ? await FrozenBrowserValidator.open({ ...f.options, mode })
            : await FrozenBrowserValidator.open({ ...f.options, mode });
      assert.deepEqual(
        Object.keys(journal).sort(),
        mode === 'journal-only'
          ? ['close', 'inventory']
          : mode === 'acceptance-only'
            ? ['accept', 'close', 'inventory']
            : ['accept', 'close', 'consume', 'inventory'],
      );
      const inventory = await journal.inventory();
      assert.equal(inventory.attempts, 1);
      assert.equal(inventory.runs[0].state, 'accepted');
      const persisted = journalRows(f.directory).runs[0].execution.run.result;
      assert.equal(persisted.kind, state === 'incomplete' ? 'settled' : 'recorded');
      if (state === 'pending')
        assert.deepEqual(persisted, {
          kind: 'recorded',
          outcome: { kind: 'uncertain', code: 'interrupted-run-no-replay' },
          evidence: null,
        });
      await journal.close();
    }
    assert.deepEqual((await f.state()).calls, []);
    const ordinary = await FrozenBrowserValidator.open({
      directory: f.directory,
      workspace: forbiddenWorkspace,
    });
    await ordinary.close();
    assert.deepEqual(journalRows(f.directory).runs[0].execution.run.result.report.cleanup, removed);
    cleanupCommands((await f.state()).calls);
  });

for (const problem of [
  'owner-label',
  'run-label',
  'container-name',
  'extra-tags',
  'base-image',
  'multiple',
  'absent-intent',
  'unknown-build',
  'timeout',
  'client-failure',
] as const)
  test(`cleanup preserves fail-closed ${problem} and explicit retries remain bounded`, async (t) => {
    const f = await cleanupFixture(t);
    if (problem === 'absent-intent' || problem === 'multiple')
      f.rows.runs[0].execution.run.ledger.container = { kind: 'intent' };
    if (problem === 'unknown-build') f.rows.runs[0].execution.run.ledger.build = 'unknown';
    if (problem === 'base-image') {
      f.rows.runs[0].execution.run.ledger.image = { kind: 'intent' };
      f.rows.runs[0].execution.run.ledger.container = { kind: 'none' };
    }
    writeRows(f.directory, f.rows);
    const calls: string[][] = [];
    const deadlines: number[] = [];
    let bad = true;
    const original = Reflect.get(prototype, 'client');
    replace(t, 'client', async function (this: FrozenBrowserValidator, ...args: unknown[]) {
      const words = args[0] as string[];
      calls.push(words);
      deadlines.push(args[1] as number);
      const reply = (value: string) => ({
        kind: 'exited',
        status: 0,
        stdout: Buffer.from(value),
        stderr: Buffer.alloc(0),
      });
      if (bad && words[0] === 'container' && words[1] === 'ls') {
        if (problem === 'absent-intent') return reply('');
        if (problem === 'multiple') return reply('c'.repeat(64) + '\n' + 'e'.repeat(64) + '\n');
        if (problem === 'timeout') return { kind: 'lost', code: 'client-timeout' };
        if (problem === 'client-failure') return { kind: 'lost', code: 'client-error' };
      }
      const result = (await Reflect.apply(original, this, args)) as { stdout: Buffer };
      if (bad && words[1] === 'inspect') {
        const parsed = JSON.parse(result.stdout.toString());
        if (words[0] === 'container') {
          if (problem === 'owner-label')
            parsed[0].Config.Labels['eitri.frozen-browser.owner'] = randomUUID();
          if (problem === 'run-label')
            parsed[0].Config.Labels['eitri.frozen-browser.run'] = randomUUID();
          if (problem === 'container-name') parsed[0].Name = '/not-owned';
        } else if (words[0] === 'image') {
          if (problem === 'extra-tags') parsed[0].RepoTags.push('not-owned:latest');
          if (problem === 'base-image')
            parsed[0].Id =
              'sha256:57911b2d47725e1d19e25203b82d7c90a3160da1815f78a9c66b42a89dd1ddff';
        }
        result.stdout = Buffer.from(JSON.stringify(parsed));
      }
      return result;
    });
    const started = Date.now();
    const result = await f.reconcile();
    assert.deepEqual(
      result.run.cleanup,
      problem === 'unknown-build' ? { ...incomplete, code: 'daemon-build-unresolved' } : incomplete,
    );
    assert.deepEqual(result.run.outcome, { kind: 'uncertain', code: 'fixture-uncertain' });
    assert.deepEqual(journalRows(f.directory).meta, f.rows.meta);
    const suspect = ['extra-tags', 'base-image', 'unknown-build'].includes(problem)
      ? 'image'
      : 'container';
    assert.equal(
      calls.some((c) => c[0] === suspect && c[1] === 'rm'),
      false,
    );
    assert.equal(
      deadlines.every((d) => d >= started + 10000 && d <= Date.now() + 10000),
      true,
    );
    assert.equal(new Set(deadlines).size, 1);
    cleanupCommands(calls);
    const previousDeadline = deadlines[0];
    calls.length = 0;
    deadlines.length = 0;
    bad = problem === 'absent-intent';
    const retried = await f.reconcile();
    assert.deepEqual(
      retried.run.cleanup,
      ['unknown-build', 'absent-intent'].includes(problem) ? result.run.cleanup : removed,
    );
    assert.deepEqual(retried.run.outcome, result.run.outcome);
    assert.equal(
      deadlines.every((deadline) => deadline > previousDeadline),
      true,
    );
    assert.deepEqual(journalRows(f.directory).meta, f.rows.meta);
    assert.equal(new Set(deadlines).size, 1);
    cleanupCommands(calls);
  });

test('not-needed history has no persistence or Docker effects on retry', async (t) => {
  const f = await cleanupFixture(t);
  f.rows.runs[0].execution.run.ledger = {
    build: 'not-started',
    image: { kind: 'none' },
    container: { kind: 'none' },
  };
  writeRows(f.directory, f.rows);
  const result = await f.reconcile();
  assert.deepEqual(result.run.cleanup, { kind: 'not-needed', cache: 'retained' });
  assert.deepEqual(result.run.outcome, { kind: 'uncertain', code: 'fixture-uncertain' });
  const saved = journalRows(f.directory);
  assert.deepEqual(await f.reconcile(), result);
  assert.deepEqual(journalRows(f.directory), saved);
  assert.deepEqual((await f.state()).calls, []);
});

for (const point of ['normalization', 'acquisition', 'settlement'] as const)
  for (const timing of ['before', 'after'] as const)
    test(`persistence failure ${timing} ${point} COMMIT rejects, closes and permits exact repair`, async (t) => {
      const f = await cleanupFixture(t, point === 'normalization');
      if (point === 'acquisition') {
        f.rows.runs[0].execution.run.ledger.container = { kind: 'intent' };
        writeRows(f.directory, f.rows);
      }
      const original = DatabaseSync.prototype.exec;
      let failed = false;
      DatabaseSync.prototype.exec = function (sql) {
        if (sql === 'COMMIT' && !failed) {
          const run = JSON.parse(
            String(this.prepare('SELECT body FROM runs WHERE id=1').get()?.body),
          ).execution.run;
          const matches =
            point === 'settlement'
              ? run.result.kind === 'settled'
              : point === 'normalization'
                ? run.result.kind === 'recorded'
                : run.result.kind === 'recorded' && run.ledger.container.kind === 'acquired';
          if (matches) {
            failed = true;
            if (timing === 'after') Reflect.apply(original, this, [sql]);
            throw Error('injected-persistence-uncertainty');
          }
        }
        return Reflect.apply(original, this, [sql]);
      };
      try {
        await assert.rejects(
          f.reconcile(),
          /injected-persistence-uncertainty|validator-journal-failed/,
        );
      } finally {
        DatabaseSync.prototype.exec = original;
      }
      assert.equal(failed, true);
      const saved = journalRows(f.directory);
      assert.deepEqual(saved.meta, f.rows.meta);
      assert.deepEqual(saved.runs[0].acceptance, f.record.acceptance);
      const durable = saved.runs[0].execution.run;
      assert.equal(
        durable.result.kind,
        point === 'normalization' && timing === 'before'
          ? 'pending'
          : point === 'settlement' && timing === 'after'
            ? 'settled'
            : 'recorded',
      );
      if (point === 'acquisition')
        assert.equal(durable.ledger.container.kind, timing === 'after' ? 'acquired' : 'intent');
      if (point !== 'settlement')
        assert.equal(
          (await f.state()).calls.some((c) => c[1] === 'rm'),
          false,
        );
      const calls = (await f.state()).calls;
      const result = await f.reconcile();
      assert.deepEqual(result.run.cleanup, removed);
      assert.deepEqual(
        result.run.outcome,
        point === 'normalization'
          ? { kind: 'uncertain', code: 'interrupted-run-no-replay' }
          : { kind: 'uncertain', code: 'fixture-uncertain' },
      );
      assert.deepEqual(journalRows(f.directory).meta, f.rows.meta);
      if (point === 'settlement' && timing === 'after')
        assert.deepEqual((await f.state()).calls, calls);
      await assertReleased(f.cleanupOptions);
    });

test('failed reconciliation retains ownership until private close drains', async (t) => {
  const f = await cleanupFixture(t);
  const entered = deferred(),
    release = deferred();
  const original = Reflect.get(prototype, 'close');
  replace(t, 'close', async function (this: FrozenBrowserValidator) {
    entered.resolve();
    await release.promise;
    return Reflect.apply(original, this, []);
  });
  t.after(() => release.resolve());
  const running = assert.rejects(
    FrozenBrowserValidator.reconcileConsumed({
      ...f.cleanupOptions,
      consumedRun: { ...f.cleanupOptions.consumedRun, runId: randomUUID() },
    }),
    /validator-identity-conflict/,
  );
  await entered.promise;
  await assert.rejects(f.reconcile(), /validator-already-open/);
  release.resolve();
  await running;
  assert.deepEqual(journalRows(f.directory), f.rows);
  assert.deepEqual((await f.reconcile()).run.cleanup, removed);
});

test('ownership replacement after acquisition rejects before selected normalization and cleanup', async (t) => {
  const f = await cleanupFixture(t, true);
  const original = Reflect.get(prototype, 'guard');
  const path = join(f.directory, 'owner.json');
  const marker = await readFile(path);
  let replaced = false;
  replace(t, 'guard', async function (this: FrozenBrowserValidator) {
    if (!replaced) {
      replaced = true;
      await writeFile(path, Buffer.from('{}'));
    }
    return Reflect.apply(original, this, []);
  });
  await assert.rejects(f.reconcile(), /validator-ownership-changed/);
  assert.deepEqual(journalRows(f.directory), f.rows);
  assert.deepEqual((await f.state()).calls, []);
  await writeFile(path, marker);
  assert.deepEqual((await f.reconcile()).run.cleanup, removed);
});

test('persistence rejection is not observed until private close releases ownership', async (t) => {
  const f = await cleanupFixture(t);
  const entered = deferred(),
    release = deferred();
  const originalClose = Reflect.get(prototype, 'close');
  replace(t, 'close', async function (this: FrozenBrowserValidator) {
    entered.resolve();
    await release.promise;
    return Reflect.apply(originalClose, this, []);
  });
  t.after(() => release.resolve());
  const originalExec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function (sql) {
    if (sql === 'COMMIT') throw Error('cleanup-persistence-failed');
    return Reflect.apply(originalExec, this, [sql]);
  };
  let rejected = false;
  const running = assert.rejects(f.reconcile(), /validator-journal-failed/).then(() => {
    rejected = true;
  });
  try {
    await entered.promise;
    assert.equal(rejected, false);
    await assert.rejects(f.reconcile(), /validator-already-open/);
    await assert.rejects(f.open(), /validator-already-open/);
    release.resolve();
    await running;
  } finally {
    release.resolve();
    DatabaseSync.prototype.exec = originalExec;
  }
  assert.equal(rejected, true);
  assert.deepEqual(journalRows(f.directory), f.rows);
  assert.equal(
    (await f.state()).calls.some((c) => c[1] === 'rm'),
    false,
  );
  assert.deepEqual((await f.reconcile()).run.cleanup, removed);
});

for (const version of [1, 2] as const)
  test(`legacy version ${version} storage cannot become a consumed cleanup target`, async (t) => {
    const f = await cleanupFixture(t, true);
    const rows = journalRows(f.directory);
    rows.meta.version = version;
    if (version === 1) {
      const run = rows.runs[0].execution.run;
      run.intent.deadline = run.intent.admittedAt + run.intent.request.allowanceMs;
      rows.runs = [run];
    } else {
      rows.runs = [{ kind: 'offline-acceptance', ...f.accepted }];
      rows.meta.attempts = 0;
      rows.meta.contribution = 0;
    }
    writeRows(f.directory, rows);
    await assert.rejects(f.reconcile(), /validator-identity-conflict/);
    assert.deepEqual(journalRows(f.directory), rows);
    assert.deepEqual((await f.state()).calls, []);
    const open = FrozenBrowserValidator.open;
    const journal = await open({ ...f.options, mode: 'journal-only' });
    const inventory = await journal.inventory();
    assert.equal(inventory.attempts, version === 1 ? 1 : 0);
    assert.equal(inventory.runs[0].state, version === 1 ? 'recorded' : 'accepted');
    if (version === 1)
      assert.deepEqual(journalRows(f.directory).runs[0].result, {
        kind: 'recorded',
        outcome: { kind: 'uncertain', code: 'interrupted-run-no-replay' },
        evidence: null,
      });
    else assert.deepEqual(journalRows(f.directory), rows);
    await journal.close();
    assert.deepEqual((await f.state()).calls, []);
  });
