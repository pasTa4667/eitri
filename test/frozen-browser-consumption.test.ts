import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdir, readdir } from 'node:fs/promises';
import {
  FrozenBrowserValidator,
  frozenBrowserRequest,
  admitFrozenBrowserReport,
} from '../src/frozen-browser.ts';
import type { FrozenBrowserAcceptance } from '../src/frozen-browser.ts';
import { digest } from '../src/domain.ts';
import { journalRows } from './controller-worker-association-fixture.ts';
import { consumptionFixture, deferred } from './frozen-browser-consumption-fixture.ts';

const signal = () => new AbortController().signal;
const allowance = () => 60000;
const prototype = FrozenBrowserValidator.prototype;

function gateClient(t: test.TestContext, command = 'version') {
  const entered = deferred(),
    release = deferred();
  const original = Reflect.get(prototype, 'client');
  Reflect.set(
    prototype,
    'client',
    async function (this: FrozenBrowserValidator, ...args: unknown[]) {
      const words = args[0] as string[];
      if (
        command === 'cleanup' ? words[0] === 'container' && words[1] === 'rm' : words[0] === command
      ) {
        entered.resolve();
        await release.promise;
      }
      return Reflect.apply(original, this, args);
    },
  );
  t.after(() => Reflect.set(prototype, 'client', original));
  return { entered: entered.promise, release: () => release.resolve() };
}

function writeRows(directory: string, rows: ReturnType<typeof journalRows>) {
  const db = new DatabaseSync(join(directory, 'journal.sqlite'));
  try {
    db.exec('DELETE FROM runs');
    db.prepare('UPDATE meta SET body=?,digest=?').run(JSON.stringify(rows.meta), digest(rows.meta));
    rows.runs.forEach((r: unknown, i: number) =>
      db.prepare('INSERT INTO runs VALUES(?,?,?)').run(i + 1, JSON.stringify(r), digest(r)),
    );
  } finally {
    db.close();
  }
}

test('consumption runs the existing pipeline once with detached pending inventory and shortened timing', async (t) => {
  const f = await consumptionFixture(t);
  assert.deepEqual(Object.keys(f.journal).sort(), ['accept', 'close', 'consume', 'inventory']);
  const gate = gateClient(t);
  const originalNow = Date.now;
  const now = originalNow() + 900000;
  Date.now = () => now;
  t.after(() => {
    Date.now = originalNow;
  });
  const input = structuredClone(f.accepted);
  const running = f.journal.consume(input, () => 12345, signal());
  Object.assign(input.request.action, { epoch: 99 });
  await gate.entered;
  const retries = Array.from({ length: 6 }, () =>
    f.journal.consume(f.accepted, () => 12345, signal()),
  );
  const pending = await f.journal.inventory();
  assert.equal(pending.attempts, 1);
  assert.equal(pending.contribution, 41943040);
  assert.equal(pending.runs.length, 1);
  const record = pending.runs[0];
  assert.equal(record.state, 'accepted');
  if (record.state !== 'accepted') throw Error('not-accepted');
  assert.deepEqual(
    { ...record, consumption: undefined },
    { kind: 'offline-acceptance', state: 'accepted', ...f.accepted, consumption: undefined },
  );
  assert.equal(record.consumption?.state, 'pending');
  assert.equal(record.consumption?.admittedAt, now);
  assert.equal(record.consumption?.deadline, now + 12345);
  Object.assign(record.consumption!, { deadline: 0 });
  const stored = journalRows(f.directory);
  assert.equal(stored.meta.version, 3);
  assert.equal(stored.runs[0].execution.run.result.kind, 'pending');
  gate.release();
  const result = await running;
  assert.deepEqual(await Promise.all(retries), Array(6).fill(result));
  assert.deepEqual(Object.keys(result).sort(), ['acceptanceId', 'run']);
  assert.equal(result.acceptanceId, f.accepted.acceptanceId);
  assert.equal(result.run.state, 'settled');
  assert.deepEqual(result.run.outcome, { kind: 'baseline-reproduced' });
  assert.deepEqual(result.run.cleanup, { kind: 'owned-removed', cache: 'retained' });
  assert.equal('evidence' in result.run, false);
  assert.equal(result.run.deadline, now + 12345);
  assert.deepEqual(await f.journal.accept(f.request, () => true), f.accepted);
  assert.deepEqual(await f.journal.consume(f.accepted, allowance, signal()), result);
  const state = await f.state();
  assert.equal(state.calls.filter((c) => c[0] === 'build').length, 1);
  assert.equal(state.calls.filter((c) => c[0] === 'start').length, 1);
  assert.equal(state.image, false);
  assert.equal(state.container, null);
  const saved = journalRows(f.directory);
  assert.deepEqual(saved.runs[0].acceptance, { kind: 'offline-acceptance', ...f.accepted });
  assert.equal(saved.runs[0].execution.run.result.report.evidence.provenance.deadline, now + 12345);
  assert.throws(
    () =>
      admitFrozenBrowserReport(
        {
          kind: 'baseline',
          configurationDigest: f.accepted.configurationDigest,
          request: { ...f.request, role: 'baseline' },
        },
        saved.runs[0].execution.run.result.report,
      ),
    /invalid-frozen-browser-admission/,
  );
  const expected = await f.journal.inventory();
  await f.journal.close();
  for (const mode of ['consumption-only', 'acceptance-only', 'journal-only', undefined] as const) {
    const handle =
      mode === undefined
        ? await FrozenBrowserValidator.open({ directory: f.directory, workspace: f.workspace })
        : mode === 'consumption-only'
          ? await f.open()
          : mode === 'acceptance-only'
            ? await FrozenBrowserValidator.open({ ...f.options, mode })
            : await FrozenBrowserValidator.open({ ...f.options, mode });
    if (mode !== undefined) assert.deepEqual(await Reflect.get(handle, 'inventory')(), expected);
    if (mode === 'consumption-only' || mode === 'acceptance-only')
      assert.deepEqual(await Reflect.get(handle, 'accept')(f.request, () => true), f.accepted);
    if ('validate' in handle)
      await assert.rejects(
        handle.validate(f.request, signal()),
        /validator-acceptance-not-executable/,
      );
    await handle.close();
  }
  assert.deepEqual(journalRows(f.directory), saved);
});

test('complete captured identity and synchronous allowance denials preserve acceptance and accounting', async (t) => {
  const f = await consumptionFixture(t);
  const before = journalRows(f.directory);
  const variants: FrozenBrowserAcceptance[] = [
    { ...f.accepted, acceptanceId: randomUUID() },
    { ...f.accepted, ownerId: randomUUID() },
    {
      ...f.accepted,
      configurationDigest: 'f'.repeat(64) as FrozenBrowserAcceptance['configurationDigest'],
    },
    { ...f.accepted, requestDigest: 'f'.repeat(64) as FrozenBrowserAcceptance['requestDigest'] },
    { ...f.accepted, acceptedAt: f.accepted.acceptedAt + 1, deadline: f.accepted.deadline + 1 },
    ...[
      { role: 'candidate' },
      { allowanceMs: 59999 },
      { action: { ...f.request.action, epoch: 2 } },
      { action: { ...f.request.action, actionId: randomUUID() } },
      { frozen: { ...f.request.frozen, revision: 'e'.repeat(40) } },
      { frozen: { ...f.request.frozen, manifestDigest: 'e'.repeat(64) } },
    ].map((change) => {
      const request = frozenBrowserRequest({ ...f.request, ...change });
      return {
        ...f.accepted,
        request,
        requestDigest: digest(request) as FrozenBrowserAcceptance['requestDigest'],
      };
    }),
  ];
  for (const accepted of variants)
    await assert.rejects(f.journal.consume(accepted, allowance, signal()));
  for (const value of [
    0,
    -1,
    NaN,
    Infinity,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    true,
    undefined,
    Promise.resolve(10),
    new Proxy({}, { get: (_target, key) => (key === 'then' ? () => {} : undefined) }),
  ])
    await assert.rejects(
      f.journal.consume(f.accepted, (() => value) as () => number, signal()),
      /worker-authority-denied/,
    );
  await assert.rejects(
    f.journal.consume(
      f.accepted,
      () => {
        throw Error('revoked');
      },
      signal(),
    ),
    /revoked/,
  );
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(f.journal.consume(f.accepted, allowance, aborted.signal));
  assert.deepEqual(journalRows(f.directory), before);
  assert.deepEqual((await f.state()).calls, []);
});

for (const guardKind of ['async', 'promise'] as const)
  test(`rejecting ${guardKind} consumption sampler is observed at entry and after staging`, () => {
    const child = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('./frozen-browser-consumption-authority-worker.ts', import.meta.url)),
        guardKind,
      ],
      {
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, NODE_TEST_CONTEXT: undefined },
      },
    );
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, 0, child.stdout + child.stderr);
  });

for (const delta of [-1, 0, 1])
  test(`final staging at D${delta < 0 ? '' : '+'}${delta} cannot renew admission`, async (t) => {
    const f = await consumptionFixture(t);
    const before = journalRows(f.directory);
    const originalNow = Date.now,
      originalExec = DatabaseSync.prototype.exec;
    let worker = 8000000,
      controller = 2000;
    const endpoint = 2010;
    let staged = false;
    t.mock.timers.enable({ apis: ['setTimeout'] });
    Date.now = () => worker;
    DatabaseSync.prototype.exec = function (sql) {
      const value = Reflect.apply(originalExec, this, [sql]);
      if (sql === 'BEGIN IMMEDIATE' && !staged) {
        staged = true;
        worker += 10 + delta;
        controller += 10 + delta;
      }
      return value;
    };
    try {
      if (delta < 0) {
        const pending = f.journal.consume(f.accepted, () => endpoint - controller, signal());
        const gate = gateClient(t);
        await gate.entered;
        assert.equal(journalRows(f.directory).runs[0].execution.run.intent.deadline, 8000010);
        assert.equal((await f.journal.inventory()).attempts, 1);
        gate.release();
        await pending;
      } else {
        await assert.rejects(
          f.journal.consume(f.accepted, () => endpoint - controller, signal()),
          /worker-authority-denied/,
        );
        assert.deepEqual(journalRows(f.directory), before);
        assert.deepEqual((await f.state()).calls, []);
      }
    } finally {
      Date.now = originalNow;
      DatabaseSync.prototype.exec = originalExec;
    }
  });

test('post-staging budget shrink, unsafe and backward clocks roll back without poisoning', async (t) => {
  const f = await consumptionFixture(t);
  const before = journalRows(f.directory);
  const originalNow = Date.now,
    originalExec = DatabaseSync.prototype.exec;
  for (const kind of ['budget', 'backward', 'invalid', 'overflow'] as const) {
    let now = kind === 'overflow' ? Number.MAX_SAFE_INTEGER : 1000;
    let remaining = 100;
    Date.now = () => now;
    DatabaseSync.prototype.exec = function (sql) {
      const value = Reflect.apply(originalExec, this, [sql]);
      if (sql === 'BEGIN IMMEDIATE') {
        if (kind === 'budget') remaining = 99;
        if (kind === 'backward') now--;
        if (kind === 'invalid') now = NaN;
      }
      return value;
    };
    try {
      await assert.rejects(f.journal.consume(f.accepted, () => remaining, signal()));
    } finally {
      Date.now = originalNow;
      DatabaseSync.prototype.exec = originalExec;
    }
    assert.deepEqual(journalRows(f.directory), before);
  }
  assert.deepEqual(await f.journal.accept(f.request, () => true), f.accepted);
});

test('asynchronous preparation consumes authority before the initial translated endpoint', async (t) => {
  const f = await consumptionFixture(t);
  const entered = deferred(),
    release = deferred();
  const original = Reflect.get(prototype, 'guard');
  Reflect.set(prototype, 'guard', async function (this: FrozenBrowserValidator) {
    entered.resolve();
    await release.promise;
    return Reflect.apply(original, this, []);
  });
  let remaining = 10;
  const running = f.journal.consume(f.accepted, () => remaining, signal());
  await entered.promise;
  remaining = 0;
  release.resolve();
  await assert.rejects(running, /worker-authority-denied/);
  Reflect.set(prototype, 'guard', original);
  assert.equal((await f.journal.inventory()).attempts, 0);
  assert.equal(journalRows(f.directory).meta.version, 2);
});

for (const point of ['preparation', 'execution'] as const)
  test(`close owns ${point} registered before awaits and retains the lease until drainage`, async (t) => {
    const f = await consumptionFixture(t);
    const entered = deferred(),
      release = deferred();
    const method = point === 'preparation' ? 'guard' : 'client';
    const original = Reflect.get(prototype, method);
    let gated = false;
    Reflect.set(
      prototype,
      method,
      async function (this: FrozenBrowserValidator, ...args: unknown[]) {
        if (!gated) {
          gated = true;
          entered.resolve();
          await release.promise;
        }
        return Reflect.apply(original, this, args);
      },
    );
    t.after(() => Reflect.set(prototype, method, original));
    const running = f.journal.consume(f.accepted, allowance, signal());
    const rejected = assert.rejects(running);
    await entered.promise;
    const closing = f.journal.close();
    assert.equal(f.journal.close(), closing);
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await assert.rejects(f.open(), /validator-already-open/);
    await assert.rejects(f.journal.consume(f.accepted, allowance, signal()), /validator-closed/);
    await new Promise((r) => setImmediate(r));
    assert.equal(closed, false);
    release.resolve();
    await rejected;
    await closing;
    Reflect.set(prototype, method, original);
    const reopened = await f.open();
    assert.equal((await reopened.inventory()).attempts, point === 'execution' ? 1 : 0);
    if (point === 'execution') {
      const row = journalRows(f.directory).runs[0];
      assert.equal(row.execution.run.result.kind, 'settled');
      assert.equal(row.execution.run.result.report.outcome.kind, 'cancelled');
    }
  });

for (const after of [false, true])
  test(`ambiguous consumption COMMIT ${after ? 'after' : 'before'} storage confirmation poisons without replay`, async (t) => {
    const f = await consumptionFixture(t);
    const before = journalRows(f.directory);
    const original = DatabaseSync.prototype.exec;
    DatabaseSync.prototype.exec = function (sql) {
      if (sql === 'COMMIT') {
        if (after) Reflect.apply(original, this, [sql]);
        throw Error('ambiguous-consumption');
      }
      return Reflect.apply(original, this, [sql]);
    };
    try {
      await assert.rejects(
        f.journal.consume(f.accepted, allowance, signal()),
        /ambiguous-consumption/,
      );
    } finally {
      DatabaseSync.prototype.exec = original;
    }
    await assert.rejects(f.journal.consume(f.accepted, allowance, signal()), /validator-closed/);
    await f.journal.close();
    const reopened = await f.open();
    const inventory = await reopened.inventory();
    assert.equal(inventory.attempts, after ? 1 : 0);
    if (!after) assert.deepEqual(journalRows(f.directory), before);
    else {
      const result = await reopened.consume(f.accepted, allowance, signal());
      assert.equal(result.run.state, 'recorded');
      assert.deepEqual(result.run.outcome, {
        kind: 'uncertain',
        code: 'interrupted-run-no-replay',
      });
      assert.equal(result.run.cleanup, 'unresolved');
      assert.deepEqual((await f.state()).calls, []);
    }
  });

for (const point of ['before', 'after'] as const)
  test(
    `actual SIGKILL ${point} consumption COMMIT preserves one atomic charge and no replay`,
    { timeout: 30000 },
    async (t) => {
      const f = await consumptionFixture(t);
      await f.journal.close();
      const before = journalRows(f.directory);
      const child = fork(
        new URL('./frozen-browser-consumption-crash-worker.ts', import.meta.url),
        [
          f.directory,
          JSON.stringify(f.options.expectedIdentity),
          JSON.stringify(f.accepted),
          point,
        ],
        { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
      );
      let errors = '';
      child.stderr!.on('data', (b) => {
        errors += b;
      });
      t.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      });
      await Promise.race([
        once(child, 'message'),
        once(child, 'exit').then(() => {
          throw Error(errors);
        }),
      ]);
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      assert.deepEqual(await exited, [null, 'SIGKILL']);
      const journal = await f.open();
      const inventory = await journal.inventory();
      assert.equal(inventory.attempts, point === 'after' ? 1 : 0);
      assert.equal(inventory.contribution, point === 'after' ? 41943040 : 0);
      if (point === 'before') assert.deepEqual(journalRows(f.directory), before);
      else {
        const result = await journal.consume(f.accepted, allowance, signal());
        assert.equal(result.run.state, 'recorded');
        assert.deepEqual(result.run.outcome, {
          kind: 'uncertain',
          code: 'interrupted-run-no-replay',
        });
        assert.deepEqual(journalRows(f.directory).runs[0].acceptance, before.runs[0]);
        assert.equal(journalRows(f.directory).runs[0].execution.run.result.evidence, null);
      }
      assert.deepEqual((await f.state()).calls, []);
    },
  );

for (const point of ['execution', 'recorded'] as const)
  test(
    `actual SIGKILL after ${point} preserves nested recovery without cleanup or replay`,
    { timeout: 30000 },
    async (t) => {
      const f = await consumptionFixture(t);
      await f.journal.close();
      await f.workspace.close();
      const child = fork(
        new URL('./frozen-browser-consumption-crash-worker.ts', import.meta.url),
        [
          f.directory,
          JSON.stringify(f.options.expectedIdentity),
          JSON.stringify(f.accepted),
          point,
        ],
        { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
      );
      let errors = '';
      child.stderr!.on('data', (b) => {
        errors += b;
      });
      t.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      });
      await Promise.race([
        once(child, 'message'),
        once(child, 'exit').then(() => {
          throw Error(errors);
        }),
      ]);
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      assert.deepEqual(await exited, [null, 'SIGKILL']);
      const calls = (await f.state()).calls;
      assert.equal(calls.filter((c) => c[0] === 'start').length, 1);
      assert.equal(
        calls.some((c) => c[0] === 'container' && c[1] === 'rm'),
        false,
      );
      const inspection = await FrozenBrowserValidator.open({ ...f.options, mode: 'journal-only' });
      const inventory = await inspection.inventory();
      assert.equal(inventory.attempts, 1);
      assert.equal(inventory.contribution, 41943040);
      await inspection.close();
      const journal = await f.open();
      assert.deepEqual(await journal.inventory(), inventory);
      const result = await journal.consume(f.accepted, allowance, signal());
      assert.equal(result.run.state, 'recorded');
      assert.equal(result.run.cleanup, 'unresolved');
      assert.equal(result.run.image.kind, 'acquired');
      assert.equal(result.run.container.kind, 'acquired');
      assert.deepEqual(
        result.run.outcome,
        point === 'recorded'
          ? { kind: 'baseline-reproduced' }
          : { kind: 'uncertain', code: 'interrupted-run-no-replay' },
      );
      assert.deepEqual((await f.state()).calls, calls);
    },
  );

test('consumption-only requires independently pinned complete storage and snapshots mode before opening', async (t) => {
  const f = await consumptionFixture(t);
  await f.journal.close();
  const options = { ...f.options, expectedIdentity: { ...f.options.expectedIdentity } };
  const opening = FrozenBrowserValidator.open(options);
  Reflect.set(options, 'mode', undefined);
  options.expectedIdentity.ownerId = randomUUID();
  const journal = await opening;
  assert.deepEqual(Object.keys(journal).sort(), ['accept', 'close', 'consume', 'inventory']);
  await journal.close();
  await assert.rejects(
    FrozenBrowserValidator.open({
      ...f.options,
      expectedIdentity: undefined as unknown as typeof f.options.expectedIdentity,
    }),
    /worker-journal-identity-required/,
  );
  await assert.rejects(
    FrozenBrowserValidator.open({
      ...f.options,
      expectedIdentity: { ...f.options.expectedIdentity, ownerId: randomUUID() },
    }),
    /worker-journal-identity-mismatch/,
  );
  const empty = join(f.root, 'empty');
  await mkdir(empty, { mode: 0o700 });
  await assert.rejects(
    FrozenBrowserValidator.open({ ...f.options, directory: empty }),
    /unowned-validator-directory/,
  );
  assert.deepEqual(await readdir(empty), []);
});

test('nested format rejects malformed bindings, timing, evidence, UUIDs and accounting while keeping legacy timing strict', async (t) => {
  const f = await consumptionFixture(t);
  await f.journal.consume(f.accepted, allowance, signal());
  await f.journal.close();
  const original = journalRows(f.directory);
  const mutations: ((r: typeof original) => void)[] = [
    (r) => {
      r.meta.version = 2;
    },
    (r) => {
      r.meta.attempts = 0;
      r.meta.contribution = 0;
    },
    (r) => {
      r.runs[0].extra = true;
    },
    (r) => {
      r.runs[0].acceptance.requestDigest = 'f'.repeat(64);
    },
    (r) => {
      r.runs[0].acceptance.ownerId = randomUUID();
    },
    (r) => {
      r.runs[0].execution.extra = true;
    },
    (r) => {
      r.runs[0].execution.admission.extra = true;
    },
    (r) => {
      r.runs[0].execution.admission.translatedAt++;
    },
    (r) => {
      r.runs[0].execution.admission.translatedAllowanceMs = 0;
    },
    (r) => {
      r.runs[0].execution.admission.translatedAllowanceMs = 60001;
    },
    (r) => {
      r.runs[0].execution.run.intent.deadline--;
    },
    (r) => {
      r.runs[0].execution.run.intent.owner = randomUUID();
    },
    (r) => {
      r.runs[0].execution.run.intent.runId = f.accepted.acceptanceId;
    },
    (r) => {
      r.runs[0].execution.run.result.report.evidence.provenance.deadline--;
    },
    (r) => {
      const run = r.runs[0].execution.run;
      run.intent.request.role = 'candidate';
      run.intent.requestDigest = digest(run.intent.request);
    },
    (r) => {
      const run = r.runs[0].execution.run;
      run.intent.deadline--;
      r.runs = [{ kind: 'execution', run }];
    },
    (r) => {
      r.runs.push(structuredClone(r.runs[0]));
      r.meta.attempts++;
      r.meta.contribution *= 2;
    },
  ];
  for (const mutate of mutations) {
    const rows = structuredClone(original);
    mutate(rows);
    writeRows(f.directory, rows);
    await assert.rejects(f.open());
  }
  writeRows(f.directory, original);
  const reopened = await f.open();
  assert.equal((await reopened.inventory()).attempts, 1);
});

test('unknown build and unresolved cleanup remain durable and block a different acceptance', async (t) => {
  const f = await consumptionFixture(t);
  const original = Reflect.get(prototype, 'client');
  Reflect.set(prototype, 'client', function (this: FrozenBrowserValidator, ...args: unknown[]) {
    if ((args[0] as string[])[0] === 'build')
      return Promise.resolve({ kind: 'lost', code: 'client-error' });
    if ((args[0] as string[])[0] === 'image' && (args[0] as string[])[1] === 'ls')
      return Promise.resolve({
        kind: 'exited',
        status: 0,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
      });
    return Reflect.apply(original, this, args);
  });
  t.after(() => Reflect.set(prototype, 'client', original));
  const consumed = await f.journal.consume(f.accepted, allowance, signal());
  assert.equal(consumed.run.build, 'unknown');
  assert.deepEqual(consumed.run.outcome, { kind: 'uncertain', code: 'daemon-build-unresolved' });
  assert.deepEqual(consumed.run.cleanup, {
    kind: 'incomplete',
    cache: 'retained',
    code: 'daemon-build-unresolved',
  });
  const second = await f.journal.accept(
    frozenBrowserRequest({ ...f.request, action: { ...f.request.action, actionId: randomUUID() } }),
    () => true,
  );
  await assert.rejects(
    f.journal.consume(second, allowance, signal()),
    /validator-daemon-build-unresolved/,
  );
  const expected = await f.journal.inventory();
  await f.journal.close();
  const reopened = await f.open();
  assert.deepEqual(await reopened.inventory(), expected);
  await assert.rejects(
    reopened.consume(second, allowance, signal()),
    /validator-daemon-build-unresolved/,
  );
  assert.equal((await f.state()).calls.filter((c) => c[0] === 'build').length, 0);
});

for (const revocation of ['signal', 'sampler'] as const)
  test(`${revocation} revocation after awaited preparation suppresses forward work but drains owned settlement`, async (t) => {
    const f = await consumptionFixture(t);
    const gate = gateClient(t);
    const controller = new AbortController();
    let remaining = 60000;
    const running = f.journal.consume(f.accepted, () => remaining, controller.signal);
    const rejected = assert.rejects(running);
    await gate.entered;
    if (revocation === 'signal') controller.abort();
    else remaining = 0;
    const during = await f.journal.inventory();
    assert.equal(during.attempts, 1);
    await assert.rejects(f.open(), /validator-already-open/);
    gate.release();
    await rejected;
    const saved = journalRows(f.directory).runs[0].execution.run.result;
    assert.equal(saved.kind, 'settled');
    assert.deepEqual(saved.report.outcome, {
      kind: 'cancelled',
      code: 'cancelled-or-allowance-exhausted',
    });
    assert.deepEqual(saved.report.cleanup, { kind: 'not-needed', cache: 'retained' });
    assert.equal(
      (await f.state()).calls.some((c) => c[0] === 'build'),
      false,
    );
    const historical = await f.journal.consume(f.accepted, allowance, signal());
    assert.equal(historical.run.runId, saved.report.runId);
    assert.equal((await f.journal.inventory()).attempts, 1);
  });

test('failed settlement writes poison the handle and reopening never replays committed consumption', async (t) => {
  const f = await consumptionFixture(t);
  const original = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function (sql) {
    if (sql === 'COMMIT') {
      const row = this.prepare('SELECT body FROM runs WHERE id=1').get();
      if (JSON.parse(String(row?.body)).execution.run.result.kind === 'settled')
        throw Error('settlement-storage-failed');
    }
    return Reflect.apply(original, this, [sql]);
  };
  try {
    await assert.rejects(
      f.journal.consume(f.accepted, allowance, signal()),
      /settlement-storage-failed/,
    );
  } finally {
    DatabaseSync.prototype.exec = original;
  }
  await assert.rejects(f.journal.inventory(), /validator-closed/);
  const calls = (await f.state()).calls;
  await f.journal.close();
  const reopened = await f.open();
  const recovered = await reopened.consume(f.accepted, allowance, signal());
  assert.equal(recovered.run.state, 'recorded');
  assert.deepEqual(recovered.run.outcome, { kind: 'baseline-reproduced' });
  assert.equal(recovered.run.cleanup, 'unresolved');
  assert.equal((await reopened.inventory()).attempts, 1);
  assert.deepEqual((await f.state()).calls, calls);
});

test('incomplete cleanup is retained without re-finalization and blocks fresh consumption', async (t) => {
  const f = await consumptionFixture(t, 'cleanup-fail');
  const result = await f.journal.consume(f.accepted, allowance, signal());
  assert.deepEqual(result.run.cleanup, {
    kind: 'incomplete',
    cache: 'retained',
    code: 'owned-cleanup-unconfirmed',
  });
  const second = await f.journal.accept(
    frozenBrowserRequest({ ...f.request, action: { ...f.request.action, actionId: randomUUID() } }),
    () => true,
  );
  await assert.rejects(f.journal.consume(second, allowance, signal()), /validator-unsettled/);
  const before = journalRows(f.directory),
    calls = (await f.state()).calls;
  await f.journal.close();
  const reopened = await f.open();
  assert.deepEqual(await reopened.consume(f.accepted, allowance, signal()), result);
  await assert.rejects(reopened.consume(second, allowance, signal()), /validator-unsettled/);
  assert.deepEqual(journalRows(f.directory), before);
  assert.deepEqual((await f.state()).calls, calls);
});

test('preparation delays shorten admission and request allowance remains an upper bound', async (t) => {
  const f = await consumptionFixture(t);
  const originalNow = Date.now;
  const originalGuard = Reflect.get(prototype, 'guard');
  let worker = 9000000,
    controller = 3000;
  const entered = deferred(),
    release = deferred();
  let gated = false;
  Date.now = () => worker;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  Reflect.set(prototype, 'guard', async function (this: FrozenBrowserValidator) {
    if (!gated) {
      gated = true;
      entered.resolve();
      await release.promise;
    }
    return Reflect.apply(originalGuard, this, []);
  });
  try {
    const running = f.journal.consume(f.accepted, () => 3010 - controller, signal());
    await entered.promise;
    controller += 6;
    worker += 6;
    release.resolve();
    const result = await running;
    assert.equal(result.run.admittedAt, 9000006);
    assert.equal(result.run.deadline, 9000010);
    assert.equal(f.accepted.deadline - f.accepted.acceptedAt, 60000);
  } finally {
    Date.now = originalNow;
    Reflect.set(prototype, 'guard', originalGuard);
  }
  const second = await f.journal.accept(
    frozenBrowserRequest({ ...f.request, action: { ...f.request.action, actionId: randomUUID() } }),
    () => true,
  );
  const result = await f.journal.consume(second, () => Number.MAX_SAFE_INTEGER, signal());
  assert.equal(result.run.deadline - result.run.admittedAt, 60000);
});

test('close drains cleanup without requiring forward authority or arbitrary caller completion', async (t) => {
  const f = await consumptionFixture(t);
  const gate = gateClient(t, 'cleanup');
  const controller = new AbortController();
  const running = f.journal.consume(f.accepted, allowance, controller.signal);
  const rejected = assert.rejects(running);
  await gate.entered;
  const inventory = await f.journal.inventory();
  const accepted = inventory.runs[0];
  assert.equal(accepted.state, 'accepted');
  if (accepted.state !== 'accepted') throw Error('not-accepted');
  assert.equal(accepted.consumption?.state, 'recorded');
  controller.abort();
  const closing = f.journal.close();
  let closed = false;
  void closing.then(() => {
    closed = true;
  });
  await assert.rejects(f.open(), /validator-already-open/);
  await new Promise((r) => setImmediate(r));
  assert.equal(closed, false);
  gate.release();
  await rejected;
  await closing;
  const result = journalRows(f.directory).runs[0].execution.run.result;
  assert.equal(result.kind, 'settled');
  assert.deepEqual(result.report.cleanup, { kind: 'owned-removed', cache: 'retained' });
  assert.equal((await f.state()).image, false);
  assert.equal((await f.state()).container, null);
});

test('failed rollback poisons admission and reopening remains the only recovery path', async (t) => {
  const f = await consumptionFixture(t);
  const before = journalRows(f.directory);
  const original = DatabaseSync.prototype.exec;
  let staged = false;
  DatabaseSync.prototype.exec = function (sql) {
    const result = Reflect.apply(original, this, [sql]);
    if (sql === 'BEGIN IMMEDIATE') staged = true;
    if (sql === 'ROLLBACK') throw Error('ambiguous-rollback');
    return result;
  };
  try {
    await assert.rejects(
      f.journal.consume(f.accepted, () => (staged ? 0 : 10), signal()),
      /ambiguous-rollback/,
    );
  } finally {
    DatabaseSync.prototype.exec = original;
  }
  await assert.rejects(f.journal.inventory(), /validator-closed/);
  await f.journal.close();
  const reopened = await f.open();
  assert.equal((await reopened.inventory()).attempts, 0);
  assert.deepEqual(journalRows(f.directory), before);
});

test('consumption charges the ordinary lifetime limits once and preserves exact history at capacity', async (t) => {
  const f = await consumptionFixture(t);
  t.mock.method(f.workspace, 'readFrozen', async () => {
    throw Error('scripted-input-unavailable');
  });
  let first;
  for (let i = 0; i < 16; i++) {
    const accepted =
      i === 0
        ? f.accepted
        : await f.journal.accept(
            frozenBrowserRequest({
              ...f.request,
              action: { ...f.request.action, actionId: randomUUID() },
            }),
            () => true,
          );
    const consumed = await f.journal.consume(accepted, allowance, signal());
    first ??= consumed;
  }
  const inventory = await f.journal.inventory();
  assert.equal(inventory.attempts, 16);
  assert.equal(inventory.contribution, 640 * 1024 ** 2);
  assert.deepEqual(await f.journal.consume(f.accepted, allowance, signal()), first);
  const seventeenth = await f.journal.accept(
    frozenBrowserRequest({ ...f.request, action: { ...f.request.action, actionId: randomUUID() } }),
    () => true,
  );
  await assert.rejects(
    f.journal.consume(seventeenth, allowance, signal()),
    /validator-lifetime-limit/,
  );
  assert.equal((await f.journal.inventory()).attempts, 16);
  assert.deepEqual((await f.state()).calls, []);
});
