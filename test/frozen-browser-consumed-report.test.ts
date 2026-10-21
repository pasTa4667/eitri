import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readdir, readFile, rename, chmod, writeFile, rm, lstat } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FrozenBrowserValidator,
  admitFrozenBrowserReport,
  admitFrozenBrowserConsumedReport,
} from '../src/frozen-browser.ts';
import type {
  FrozenBrowserConsumedRunKey,
  FrozenBrowserConsumedExpectation,
  FrozenBrowserJournalIdentity,
  HistoricalWorkerSelection,
} from '../src/frozen-browser.ts';
import { sha256 } from '../src/workspace.ts';
import { digest } from '../src/domain.ts';
import { journalRows } from './controller-worker-association-fixture.ts';
import { consumptionFixture } from './frozen-browser-consumption-fixture.ts';
import {
  cleanupFixture,
  consumedRecord,
  otherAcceptance,
  selector,
  writeRows,
} from './frozen-browser-cleanup-fixture.ts';

const read = FrozenBrowserValidator.readConsumedReport;
const png = {
  mime: 'image/png',
  size: 68,
  sha256: '43739c566e26fd7cb88f69d3864ea34740372f5ee99acac169e090beffbce5c6',
  base64:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
};

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

function forbidEffects(t: test.TestContext) {
  for (const method of ['client', 'save', 'saveNow', 'finalize']) {
    t.mock.method(FrozenBrowserValidator.prototype, method as never, () => {
      throw Error(`historical-read-called-${method}`);
    });
  }
}

function pendingObservation(consumedRun: FrozenBrowserConsumedRunKey, state = 'pending') {
  return { consumedRun, admittedAt: 1000, deadline: 13345, state };
}

for (const mode of ['normal', 'cleanup-fail'])
  test(`readConsumedReport exports and converts shortened ${mode} history without changing any exhausted history or file`, async (t) => {
    const f = await consumptionFixture(t, mode);
    let consumed;
    const originalNow = Date.now;
    Date.now = () => 1000000;
    try {
      consumed = await f.journal.consume(f.accepted, () => 12345, new AbortController().signal);
    } finally {
      Date.now = originalNow;
    }
    const expected: FrozenBrowserConsumedExpectation = {
      kind: 'baseline',
      configurationDigest: f.accepted.configurationDigest,
      request: { ...f.request, role: 'baseline' },
      consumedRun: {
        acceptanceId: f.accepted.acceptanceId,
        runId: consumed.run.runId,
        requestDigest: sha256(digest(f.request)),
      },
      admittedAt: 1000000,
      deadline: 1012345,
    };
    await f.journal.close();
    const rows = journalRows(f.directory);
    const consumedRun = selector(rows.runs[0]);
    for (let i = 1; i < 16; i++) {
      const record = consumedRecord(otherAcceptance(f.accepted), true);
      if (i === 2) {
        record.execution.run.intent.deadline = 61000;
        rows.runs.push({ kind: 'execution', run: record.execution.run });
      } else rows.runs.push(record);
    }
    rows.runs.push({ kind: 'offline-acceptance', ...otherAcceptance(f.accepted) });
    rows.meta.attempts = 16;
    rows.meta.contribution = 671088640;
    writeRows(f.directory, rows);
    const before = await files(f.directory);
    const calls = (await f.state()).calls;
    const options = {
      directory: f.directory,
      expectedIdentity: f.options.expectedIdentity,
      consumedRun,
    };
    forbidEffects(t);
    const statements: string[] = [];
    const exec = DatabaseSync.prototype.exec;
    t.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
      statements.push(sql);
      assert.throws(() => Reflect.apply(exec, this, ['DELETE FROM runs']), /readonly|read-only/);
      return Reflect.apply(exec, this, [sql]);
    });
    const result = await read(options);
    assert.equal(result.state, 'settled');
    if (result.state !== 'settled') throw Error('not-settled');
    const { evidence, ...report } = result.report;
    assert.deepEqual(
      { ...result, report },
      {
        consumedRun,
        admittedAt: 1000000,
        deadline: 1012345,
        state: 'settled',
        report: {
          runId: consumedRun.runId,
          request: f.request,
          outcome: { kind: 'baseline-reproduced' },
          cleanup:
            mode === 'cleanup-fail'
              ? { kind: 'incomplete', cache: 'retained', code: 'owned-cleanup-unconfirmed' }
              : { kind: 'owned-removed', cache: 'retained' },
        },
      },
    );
    assert.deepEqual(evidence?.png, png);
    assert.deepEqual(
      Buffer.from(evidence!.png.base64, 'base64'),
      Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c6360000200000500017a5eab3f0000000049454e44ae426082',
        'hex',
      ),
    );
    assert.deepEqual(
      {
        allowanceMs: result.report.request.allowanceMs,
        admittedAt: evidence?.provenance.admittedAt,
        deadline: evidence?.provenance.deadline,
        finishedAt: evidence?.provenance.finishedAt,
        literal: evidence?.observations.literal,
        stage: evidence?.observations.stage,
      },
      {
        allowanceMs: 60000,
        admittedAt: 1000000,
        deadline: 1012345,
        finishedAt: 1000000,
        literal: 'A',
        stage: 'complete',
      },
    );
    assert.deepEqual(result.report, rows.runs[0].execution.run.result.report);
    assert.throws(
      () =>
        admitFrozenBrowserReport(
          {
            kind: 'baseline',
            configurationDigest: f.accepted.configurationDigest,
            request: { ...f.request, role: 'baseline' },
          },
          result.report,
        ),
      /invalid-frozen-browser-admission/,
    );
    assert.deepEqual(result.consumedRun, expected.consumedRun);
    assert.equal(
      result.report.evidence!.provenance.requestDigest,
      expected.consumedRun.requestDigest,
    );
    const admission = admitFrozenBrowserConsumedReport(expected, result);
    assert.deepEqual(
      admission,
      mode === 'cleanup-fail'
        ? { type: 'blocked', report: result.report, reason: 'cleanup-incomplete' }
        : {
            type: 'behavioral',
            report: result.report,
            passed: true,
            outputs: [
              {
                label: 'Frozen browser screenshot',
                mime: 'image/png',
                bytes: Buffer.from(
                  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c6360000200000500017a5eab3f0000000049454e44ae426082',
                  'hex',
                ),
              },
            ],
          },
    );
    Object.assign(result.consumedRun, { runId: randomUUID() });
    Object.assign(result.report.request.action, { epoch: 99 });
    Object.assign(evidence!.provenance, { deadline: 0 });
    Object.assign(evidence!.png, { base64: '' });
    const again = await read(options);
    assert.equal(again.state, 'settled');
    if (again.state !== 'settled') throw Error('not-settled');
    assert.deepEqual(again.report, rows.runs[0].execution.run.result.report);
    assert.deepEqual(again.consumedRun, consumedRun);
    assert.deepEqual(statements, [
      'PRAGMA trusted_schema=OFF;',
      'BEGIN',
      'PRAGMA trusted_schema=OFF;',
      'BEGIN',
    ]);
    assert.deepEqual(journalRows(f.directory), rows);
    assert.deepEqual(await files(f.directory), before);
    assert.deepEqual((await f.state()).calls, calls);
  });

for (const state of ['pending', 'recorded', 'settled'] as const)
  test(`readConsumedReport preserves selected ${state} history with no normalization or worker effects`, async (t) => {
    const f = await cleanupFixture(t, state === 'pending');
    if (state === 'settled') {
      const run = f.rows.runs[0].execution.run;
      run.result = {
        kind: 'settled',
        report: {
          runId: run.intent.runId,
          request: f.request,
          outcome: { kind: 'uncertain', code: 'fixture-uncertain' },
          cleanup: { kind: 'not-needed', cache: 'retained' },
          evidence: null,
        },
      };
      writeRows(f.directory, f.rows);
    }
    const before = await files(f.directory);
    forbidEffects(t);
    const expected = pendingObservation(f.cleanupOptions.consumedRun, state);
    assert.deepEqual(
      await read(f.cleanupOptions),
      state === 'settled'
        ? {
            ...expected,
            report: {
              runId: f.cleanupOptions.consumedRun.runId,
              request: f.request,
              outcome: { kind: 'uncertain', code: 'fixture-uncertain' },
              cleanup: { kind: 'not-needed', cache: 'retained' },
              evidence: null,
            },
          }
        : expected,
    );
    assert.deepEqual(journalRows(f.directory), f.rows);
    assert.deepEqual(await files(f.directory), before);
    assert.deepEqual((await f.state()).calls, []);
  });

test('readConsumedReport snapshots directory, identity and exact selector before awaiting', async (t) => {
  const f = await cleanupFixture(t, true);
  const options = {
    directory: f.directory,
    expectedIdentity: { ...f.options.expectedIdentity },
    consumedRun: { ...f.cleanupOptions.consumedRun },
  };
  const running = read(options);
  options.directory = join(f.root, 'missing');
  options.expectedIdentity.ownerId = randomUUID();
  options.expectedIdentity.configurationDigest = sha256('f'.repeat(64));
  options.consumedRun.acceptanceId = randomUUID();
  options.consumedRun.runId = randomUUID();
  options.consumedRun.requestDigest = sha256('f'.repeat(64));
  assert.deepEqual(await running, pendingObservation(f.cleanupOptions.consumedRun));
  assert.deepEqual(await read(f.cleanupOptions), pendingObservation(f.cleanupOptions.consumedRun));
  assert.deepEqual(journalRows(f.directory), f.rows);
  assert.deepEqual((await f.state()).calls, []);
});

test('readConsumedReport requires independent identity and exact nested consumed selection', async (t) => {
  const f = await cleanupFixture(t, true);
  const other = consumedRecord(otherAcceptance(f.accepted), true);
  const ordinary = consumedRecord(otherAcceptance(f.accepted), true);
  ordinary.execution.run.intent.deadline = 61000;
  const unconsumed = { kind: 'offline-acceptance', ...otherAcceptance(f.accepted) };
  f.rows.runs.push(other, { kind: 'execution', run: ordinary.execution.run }, unconsumed);
  f.rows.meta.attempts = 3;
  f.rows.meta.contribution = 125829120;
  writeRows(f.directory, f.rows);
  const before = await files(f.directory);
  const options = f.cleanupOptions;
  forbidEffects(t);
  for (const consumedRun of [
    { ...options.consumedRun, acceptanceId: randomUUID() },
    { ...options.consumedRun, runId: randomUUID() },
    { ...options.consumedRun, requestDigest: sha256('f'.repeat(64)) },
    { ...options.consumedRun, acceptanceId: unconsumed.acceptanceId },
    { ...options.consumedRun, runId: selector(other).runId },
    { ...selector(other), requestDigest: options.consumedRun.requestDigest },
    selector(ordinary),
  ])
    await assert.rejects(read({ ...options, consumedRun }), /validator-identity-conflict/);
  for (const expectedIdentity of [
    undefined,
    { ...options.expectedIdentity, ownerId: randomUUID() },
    { ...options.expectedIdentity, configurationDigest: sha256('f'.repeat(64)) },
  ]) {
    await assert.rejects(
      read({ ...options, expectedIdentity: expectedIdentity! }),
      /worker-journal-identity-(required|mismatch)/,
    );
    await assert.rejects(
      FrozenBrowserValidator.readHistoricalSelection({
        ...options,
        expectedIdentity: expectedIdentity!,
        action: f.request.action,
      }),
      /worker-journal-identity-(required|mismatch)/,
    );
  }
  assert.deepEqual(await read(options), pendingObservation(options.consumedRun));
  assert.deepEqual(journalRows(f.directory), f.rows);
  assert.deepEqual(await files(f.directory), before);
  assert.deepEqual((await f.state()).calls, []);
});

test('readConsumedReport rejects exotic selectors and identity pins without invoking accessors', async (t) => {
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
    ownKeys: () => {
      accessed++;
      return [];
    },
  });
  const hidden = { ...key };
  Object.defineProperty(hidden, 'extra', { value: true });
  for (const consumedRun of [
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
    { ...key, runId: 'not-a-uuid' },
    { ...key, requestDigest: 'F'.repeat(64) },
    Object.assign(Object.create({ inherited: true }), key),
  ])
    await assert.rejects(
      read({ ...f.cleanupOptions, consumedRun: consumedRun as FrozenBrowserConsumedRunKey }),
    );
  for (const expectedIdentity of [
    null,
    new Proxy(f.options.expectedIdentity, {}),
    { ...f.options.expectedIdentity, ownerId: 'invalid' },
    { ...f.options.expectedIdentity, extra: true },
  ])
    await assert.rejects(
      read({
        ...f.cleanupOptions,
        expectedIdentity: expectedIdentity as FrozenBrowserJournalIdentity,
      }),
    );
  assert.equal(accessed, 0);
  assert.deepEqual(await read(f.cleanupOptions), pendingObservation(key));
  assert.deepEqual(journalRows(f.directory), f.rows);
  assert.deepEqual((await f.state()).calls, []);
});

for (const version of [1, 2])
  test(`readConsumedReport validates but never upgrades legacy v${version} journals`, async (t) => {
    const f = await cleanupFixture(t, true);
    const run = f.record.execution.run;
    run.intent.deadline = 61000;
    f.rows.meta.version = version;
    f.rows.runs = [version === 1 ? run : { kind: 'execution', run }];
    writeRows(f.directory, f.rows);
    const before = await files(f.directory);
    forbidEffects(t);
    await assert.rejects(read(f.cleanupOptions), /validator-identity-conflict/);
    assert.deepEqual(journalRows(f.directory), f.rows);
    assert.deepEqual(await files(f.directory), before);
    assert.deepEqual((await f.state()).calls, []);
  });

test('readConsumedReport validates committed evidence and unrelated rows before returning history', async (t) => {
  const f = await consumptionFixture(t);
  await f.journal.consume(f.accepted, () => 12345, new AbortController().signal);
  await f.journal.close();
  const baseline = journalRows(f.directory);
  const options = {
    directory: f.directory,
    expectedIdentity: f.options.expectedIdentity,
    consumedRun: selector(baseline.runs[0]),
  };
  const unrelated = consumedRecord(otherAcceptance(f.accepted), true);
  baseline.runs.push(unrelated);
  baseline.meta.attempts = 2;
  baseline.meta.contribution = 83886080;
  const mutations: ((rows: typeof baseline) => void)[] = [
    (rows) => {
      rows.runs[0].execution.run.result.report.evidence.png.base64 = '';
    },
    (rows) => {
      rows.runs[0].execution.run.result.report.evidence.provenance.deadline++;
    },
    (rows) => {
      rows.runs[0].execution.run.result.report.evidence.observations.literal = 'B';
    },
    (rows) => {
      rows.runs[0].execution.run.result.report.evidence.provenance.containerId = 'a'.repeat(64);
    },
    (rows) => {
      rows.runs[0].execution.admission.translatedAllowanceMs++;
    },
    (rows) => {
      rows.runs[1].execution.run.intent.deadline++;
    },
    (rows) => {
      rows.runs[1].execution.run.result = {
        kind: 'settled',
        report: { ...rows.runs[0].execution.run.result.report },
      };
    },
    (rows) => {
      rows.meta.contribution = 0;
    },
    (rows) => {
      rows.runs[1] = structuredClone(rows.runs[0]);
    },
    (rows) => {
      rows.runs[1].acceptance.acceptanceId = rows.runs[0].acceptance.acceptanceId;
    },
    (rows) => {
      rows.runs[1].execution.run = structuredClone(rows.runs[0].execution.run);
    },
    (rows) => {
      rows.runs[1].acceptance.configurationDigest = 'f'.repeat(64);
    },
  ];
  forbidEffects(t);
  for (const mutate of mutations) {
    const rows = structuredClone(baseline);
    mutate(rows);
    writeRows(f.directory, rows);
    const before = await files(f.directory);
    for (const reading of [
      () => read(options),
      () =>
        FrozenBrowserValidator.readHistoricalSelection({ ...options, action: f.request.action }),
    ])
      await assert.rejects(
        reading(),
        /frozen-browser|corrupt-validator|corrupt-committed|artifact-/,
      );
    assert.deepEqual(journalRows(f.directory), rows);
    assert.deepEqual(await files(f.directory), before);
  }
  writeRows(f.directory, baseline);
  const db = new DatabaseSync(join(f.directory, 'journal.sqlite'));
  db.exec("UPDATE runs SET digest='bad' WHERE id=2");
  db.close();
  const before = await files(f.directory);
  await assert.rejects(read(options), /corrupt-validator-journal/);
  assert.deepEqual(await files(f.directory), before);
  writeRows(f.directory, baseline);
  const result = await read(options);
  assert.equal(result.state, 'settled');
  if (result.state !== 'settled') throw Error('not-settled');
  assert.deepEqual(result.report.evidence?.png, png);
  assert.deepEqual(result.report.cleanup, { kind: 'owned-removed', cache: 'retained' });
  assert.deepEqual(journalRows(f.directory), baseline);
});

test('readConsumedReport rejects absent, empty, unsafe and replaced storage without provisioning', async (t) => {
  const f = await cleanupFixture(t, true);
  const empty = join(f.root, 'empty');
  await mkdir(empty, { mode: 0o700 });
  await assert.rejects(read({ ...f.cleanupOptions, directory: join(f.root, 'missing') }), /ENOENT/);
  await assert.rejects(
    read({ ...f.cleanupOptions, directory: empty }),
    /unowned-validator-directory/,
  );
  assert.deepEqual(await readdir(empty), []);
  for (const name of ['owner.json', 'journal.sqlite', 'seccomp.json']) {
    const path = join(f.directory, name),
      saved = join(f.root, `${name}.saved`);
    await rename(path, saved);
    await assert.rejects(read(f.cleanupOptions), /unowned-validator-directory/);
    await rename(saved, path);
  }
  await chmod(f.directory, 0o755);
  await assert.rejects(read(f.cleanupOptions), /unsafe-validator-root/);
  await chmod(f.directory, 0o700);
  const path = join(f.directory, 'journal.sqlite'),
    saved = join(f.root, 'journal.saved');
  await rename(path, saved);
  await writeFile(path, await readFile(saved), { mode: 0o600 });
  await assert.rejects(read(f.cleanupOptions), /validator-owner-mismatch/);
  await rename(saved, path);
  assert.deepEqual(await read(f.cleanupOptions), pendingObservation(f.cleanupOptions.consumedRun));
  assert.deepEqual(journalRows(f.directory), f.rows);
  assert.deepEqual((await f.state()).calls, []);
});

for (const hot of [false, true])
  test(`readConsumedReport refuses ${hot ? 'hot' : 'cold'} rollback sidecars without SQLite recovery`, async (t) => {
    const f = await cleanupFixture(t, true);
    const sidecar = join(f.directory, 'journal.sqlite-journal');
    if (hot) {
      const script = join(f.root, 'transaction.mjs');
      await writeFile(
        script,
        `import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(${JSON.stringify(join(f.directory, 'journal.sqlite'))}); db.exec("PRAGMA cache_size=1; BEGIN IMMEDIATE; UPDATE meta SET body=printf('%100000s','x');"); process.stdout.write('ready'); setInterval(()=>{},1000);`,
      );
      const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] });
      t.after(() => child.kill('SIGKILL'));
      await once(child.stdout, 'data');
      child.kill('SIGKILL');
      await once(child, 'close');
    } else await writeFile(sidecar, Buffer.alloc(0), { mode: 0o600 });
    const before = await files(f.directory);
    t.mock.method(DatabaseSync.prototype, 'exec', () => {
      throw Error('sqlite-opened-with-sidecar');
    });
    await assert.rejects(read(f.cleanupOptions), /validator-rollback-sidecar/);
    await assert.rejects(
      FrozenBrowserValidator.readHistoricalSelection({
        ...f.cleanupOptions,
        action: f.request.action,
      }),
      /validator-rollback-sidecar/,
    );
    assert.deepEqual(await files(f.directory), before);
    assert.deepEqual((await f.state()).calls, []);
    t.mock.restoreAll();
    if (hot) {
      const writer = await f.open();
      const inventory = await writer.inventory();
      assert.equal(inventory.attempts, 1);
      assert.equal(inventory.runs[0].state, 'accepted');
      await writer.close();
    } else {
      await rm(sidecar);
      assert.deepEqual(
        await read(f.cleanupOptions),
        pendingObservation(f.cleanupOptions.consumedRun),
      );
    }
  });

test('readConsumedReport holds exclusive ownership until private closure and releases it afterward', async (t) => {
  const f = await cleanupFixture(t, true);
  const running = read(f.cleanupOptions);
  await assert.rejects(read(f.cleanupOptions), /validator-already-open/);
  await assert.rejects(
    read({
      ...f.cleanupOptions,
      consumedRun: { ...f.cleanupOptions.consumedRun, runId: randomUUID() },
    }),
    /validator-already-open/,
  );
  for (const mode of ['consumption-only', 'acceptance-only', 'journal-only', undefined] as const)
    await assert.rejects(
      mode === undefined
        ? FrozenBrowserValidator.open({ directory: f.directory, workspace: f.workspace })
        : mode === 'consumption-only'
          ? FrozenBrowserValidator.open({ ...f.options, mode })
          : mode === 'acceptance-only'
            ? FrozenBrowserValidator.open({ ...f.options, mode })
            : FrozenBrowserValidator.open({ ...f.options, mode }),
      /validator-already-open/,
    );
  await assert.rejects(
    FrozenBrowserValidator.reconcileConsumed(f.cleanupOptions),
    /validator-already-open/,
  );
  assert.deepEqual(await running, pendingObservation(f.cleanupOptions.consumedRun));
  const writer = await f.open();
  await assert.rejects(read(f.cleanupOptions), /validator-already-open/);
  await writer.close();
  assert.deepEqual(
    await read(f.cleanupOptions),
    pendingObservation(f.cleanupOptions.consumedRun, 'recorded'),
  );
  assert.deepEqual((await f.state()).calls, []);
});

for (const failure of ['parse', 'guard', 'close', 'acquisition-close'] as const)
  test(`readConsumedReport releases ownership after ${failure} failure`, async (t) => {
    const f = await cleanupFixture(t, true);
    const before = await files(f.directory);
    const exec = DatabaseSync.prototype.exec;
    const close = DatabaseSync.prototype.close;
    const databases = new Set<DatabaseSync>();
    t.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
      databases.add(this);
      if (failure === 'parse' || failure === 'acquisition-close') throw Error('injected-parse');
      const result = Reflect.apply(exec, this, [sql]);
      if (failure === 'guard')
        writeFileSync(join(f.directory, 'journal.sqlite-journal'), '', { mode: 0o600 });
      return result;
    });
    if (failure === 'close' || failure === 'acquisition-close')
      t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
        databases.add(this);
        throw Error('injected-close');
      });
    await assert.rejects(
      read(f.cleanupOptions),
      failure === 'guard' ? /validator-rollback-sidecar/ : /injected-/,
    );
    t.mock.restoreAll();
    if (failure === 'close' || failure === 'acquisition-close')
      for (const database of databases) Reflect.apply(close, database, []);
    if (failure === 'guard') await rm(join(f.directory, 'journal.sqlite-journal'));
    assert.deepEqual(
      await read(f.cleanupOptions),
      pendingObservation(f.cleanupOptions.consumedRun),
    );
    assert.deepEqual(journalRows(f.directory), f.rows);
    assert.deepEqual(await files(f.directory), before);
    assert.deepEqual((await f.state()).calls, []);
  });

for (const kind of [
  'absent',
  'legacy-execution',
  'accepted-unconsumed',
  'pending',
  'recorded',
  'settled',
] as const)
  test(`readHistoricalSelection selects ${kind} from one guarded read-only snapshot`, async (t) => {
    const f = await cleanupFixture(t, true);
    const acceptance = {
      acceptanceId: f.accepted.acceptanceId,
      request: f.request,
      requestDigest: f.accepted.requestDigest,
      configurationDigest: f.accepted.configurationDigest,
      ownerId: f.accepted.ownerId,
      acceptedAt: f.accepted.acceptedAt,
      deadline: f.accepted.deadline,
    };
    const record = f.record;
    const run = record.execution.run;
    if (kind === 'settled')
      Reflect.set(run, 'result', {
        kind: 'settled',
        report: {
          runId: run.intent.runId,
          request: f.request,
          outcome: { kind: 'uncertain', code: 'historical-uncertain' },
          cleanup: { kind: 'incomplete', cache: 'retained', code: 'historical-unconfirmed' },
          evidence: null,
        },
      });
    if (kind === 'recorded')
      Reflect.set(run, 'result', {
        kind: 'recorded',
        outcome: { kind: 'uncertain', code: 'fixture-uncertain' },
        evidence: null,
      });
    if (kind === 'legacy-execution') run.intent.deadline = 1000 + f.request.allowanceMs;
    const decoy = consumedRecord(otherAcceptance(f.accepted), true);
    decoy.execution.admission.translatedAt = 2000;
    decoy.execution.admission.translatedAllowanceMs = 23456;
    decoy.execution.run.intent.admittedAt = 2000;
    decoy.execution.run.intent.deadline = 25456;
    f.rows.runs = [
      decoy,
      ...(kind === 'absent'
        ? []
        : kind === 'legacy-execution'
          ? [{ kind: 'execution', run }]
          : kind === 'accepted-unconsumed'
            ? [{ kind: 'offline-acceptance', ...acceptance }]
            : [record]),
    ];
    f.rows.meta.attempts = kind === 'absent' || kind === 'accepted-unconsumed' ? 1 : 2;
    f.rows.meta.contribution = f.rows.meta.attempts * 41943040;
    writeRows(f.directory, f.rows);
    const before = await files(f.directory);
    forbidEffects(t);
    const statements: string[] = [];
    const exec = DatabaseSync.prototype.exec;
    const prepare = DatabaseSync.prototype.prepare;
    const close = DatabaseSync.prototype.close;
    let closes = 0;
    t.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
      statements.push(sql);
      assert.throws(() => Reflect.apply(exec, this, ['DELETE FROM runs']), /readonly|read-only/);
      return Reflect.apply(exec, this, [sql]);
    });
    t.mock.method(DatabaseSync.prototype, 'prepare', function (this: DatabaseSync, sql: string) {
      statements.push(sql);
      assert.equal(this.isTransaction, true, sql);
      assert.equal(statements[0], 'PRAGMA trusted_schema=OFF;');
      assert.equal(statements[1], 'BEGIN');
      return Reflect.apply(prepare, this, [sql]);
    });
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      assert.equal(this.isTransaction, true);
      closes++;
      return Reflect.apply(close, this, []);
    });
    const options = {
      directory: f.directory,
      expectedIdentity: { ...f.options.expectedIdentity },
      action: { ...f.request.action },
    };
    const reading = FrozenBrowserValidator.readHistoricalSelection(options);
    options.directory = join(f.root, 'missing');
    options.expectedIdentity.ownerId = randomUUID();
    options.expectedIdentity.configurationDigest = sha256('f'.repeat(64));
    Object.assign(options.action, { caseId: randomUUID(), actionId: randomUUID(), epoch: 999 });
    const result = await reading;
    assert.equal(closes, 1);
    assert.deepEqual(statements, [
      'PRAGMA trusted_schema=OFF;',
      'BEGIN',
      'PRAGMA integrity_check',
      'PRAGMA page_size',
      'SELECT name, type, sql FROM sqlite_master ORDER BY name',
      'SELECT body, digest FROM meta',
      'SELECT id, body, digest FROM runs ORDER BY id',
    ]);
    const expected =
      kind === 'absent'
        ? null
        : kind === 'legacy-execution'
          ? {
              kind,
              request: f.request,
              requestDigest: acceptance.requestDigest,
              configurationDigest: acceptance.configurationDigest,
              runId: run.intent.runId,
            }
          : kind === 'accepted-unconsumed'
            ? { kind, acceptance }
            : {
                kind: 'consumed',
                acceptance,
                history: {
                  consumedRun: selector(record),
                  admittedAt: 1000,
                  deadline: 13345,
                  state: kind,
                  ...(kind === 'settled' ? { report: Reflect.get(run.result, 'report') } : {}),
                },
              };
    const mutate = (result: HistoricalWorkerSelection | null) => {
      if (result) {
        if (result.kind === 'legacy-execution') Object.assign(result.request.action, { epoch: 99 });
        else {
          Object.assign(result.acceptance.request.action, { epoch: 99 });
          if (result.kind === 'consumed')
            Object.assign(result.history.consumedRun, { runId: randomUUID() });
        }
      }
    };
    assert.deepEqual(result, expected);
    t.mock.restoreAll();
    mutate(result);
    assert.deepEqual(
      await FrozenBrowserValidator.readHistoricalSelection({
        directory: f.directory,
        expectedIdentity: f.options.expectedIdentity,
        action: f.request.action,
      }),
      expected,
    );
    assert.deepEqual(await files(f.directory), before);
    assert.deepEqual(journalRows(f.directory), f.rows);
    assert.deepEqual((await f.state()).calls, []);
  });

for (const kind of ['absent', 'legacy-execution', 'accepted-unconsumed', 'consumed'] as const)
  test(`readHistoricalSelection guards ${kind} before closing its snapshot`, async (t) => {
    const f = await cleanupFixture(t, true);
    const run = f.record.execution.run;
    if (kind === 'legacy-execution') run.intent.deadline = 1000 + f.request.allowanceMs;
    f.rows.runs =
      kind === 'absent'
        ? []
        : kind === 'legacy-execution'
          ? [{ kind: 'execution', run }]
          : kind === 'accepted-unconsumed'
            ? [{ kind: 'offline-acceptance', ...f.accepted }]
            : [f.record];
    f.rows.meta.attempts = kind === 'absent' || kind === 'accepted-unconsumed' ? 0 : 1;
    f.rows.meta.contribution = f.rows.meta.attempts * 41943040;
    writeRows(f.directory, f.rows);
    const exec = DatabaseSync.prototype.exec;
    const databases = new Set<DatabaseSync>();
    t.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
      const result = Reflect.apply(exec, this, [sql]);
      if (sql === 'BEGIN') {
        databases.add(this);
        writeFileSync(join(f.directory, 'journal.sqlite-journal'), '', { mode: 0o600 });
      }
      return result;
    });
    const close = DatabaseSync.prototype.close;
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      assert.equal(databases.size, 1);
      assert.equal(databases.has(this), true);
      assert.equal(this.isTransaction, true);
      return Reflect.apply(close, this, []);
    });
    await assert.rejects(
      FrozenBrowserValidator.readHistoricalSelection({
        directory: f.directory,
        expectedIdentity: f.options.expectedIdentity,
        action: f.request.action,
      }),
      /validator-rollback-sidecar/,
    );
    t.mock.restoreAll();
    await rm(join(f.directory, 'journal.sqlite-journal'));
    assert.equal(
      (
        await FrozenBrowserValidator.readHistoricalSelection({
          directory: f.directory,
          expectedIdentity: f.options.expectedIdentity,
          action: f.request.action,
        })
      )?.kind ?? 'absent',
      kind,
    );
  });

test('readHistoricalSelection validates action and identity before acquisition without invoking accessors', async (t) => {
  const f = await cleanupFixture(t, true);
  const options = {
    directory: f.directory,
    expectedIdentity: f.options.expectedIdentity,
    action: f.request.action,
  };
  let accessed = 0;
  const accessor = { ...f.request.action };
  Object.defineProperty(accessor, 'epoch', {
    enumerable: true,
    get: () => {
      accessed++;
      return f.request.action.epoch;
    },
  });
  t.mock.method(FrozenBrowserValidator, 'acquireJournal' as never, () => {
    throw Error('acquired-before-validation');
  });
  for (const action of [
    { ...f.request.action, caseId: 'invalid' },
    { ...f.request.action, actionId: 'invalid' },
    { ...f.request.action, epoch: -1 },
    { ...f.request.action, epoch: 1.5 },
    { ...f.request.action, extra: true },
    accessor,
    new Proxy(f.request.action, {
      ownKeys: () => {
        accessed++;
        return [];
      },
    }),
  ])
    await assert.rejects(
      FrozenBrowserValidator.readHistoricalSelection({ ...options, action }),
      /invalid-workspace-id|invalid-frozen-browser-(id|number|fields|object|admission)/,
    );
  assert.equal(accessed, 0);
  t.mock.restoreAll();
  assert.deepEqual(await FrozenBrowserValidator.readHistoricalSelection(options), {
    kind: 'consumed',
    acceptance: f.accepted,
    history: pendingObservation(f.cleanupOptions.consumedRun),
  });
});
