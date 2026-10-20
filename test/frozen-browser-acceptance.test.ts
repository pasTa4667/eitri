import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { FrozenBrowserValidator, frozenBrowserRequest } from '../src/frozen-browser.ts';
import { digest } from '../src/domain.ts';
import { sha256 } from '../src/workspace.ts';
import { acceptanceFixture } from './frozen-browser-acceptance-fixture.ts';
import { journalRows, seedRun } from './controller-worker-association-fixture.ts';

const authority = (): true => true;

test('acceptance retries detach requests and preserve identity, timestamps and execution accounting in every mode', async (t) => {
  const f = await acceptanceFixture(t);
  const before = journalRows(f.directory);
  const journal = await f.open();
  assert.deepEqual(Object.keys(journal).sort(), ['accept', 'close', 'inventory']);
  const input = structuredClone(f.request);
  const originalNow = Date.now;
  Date.now = () => 1000;
  const accepting = journal.accept(input, authority);
  Object.assign(input.action, { epoch: 99 });
  let first;
  try {
    first = await accepting;
  } finally {
    Date.now = originalNow;
  }
  const expected = structuredClone(first);
  assert.match(first.acceptanceId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(first.request, f.request);
  assert.equal(first.acceptedAt, 1000);
  assert.equal(first.deadline, 61000);
  assert.equal(first.requestDigest, digest(f.request));
  assert.equal(first.configurationDigest, f.options.expectedIdentity.configurationDigest);
  assert.equal(first.ownerId, f.options.expectedIdentity.ownerId);
  const retries = await Promise.all(
    Array.from({ length: 8 }, () => journal.accept(f.request, authority)),
  );
  assert.deepEqual(retries, Array(8).fill(expected));
  Object.assign(first.request.frozen, { revision: 'f'.repeat(40) });
  Object.assign(retries[0], { acceptedAt: 0 });
  assert.deepEqual(await journal.accept(f.request, authority), expected);
  assert.deepEqual(journalRows(f.directory).meta, { ...before.meta, version: 2 });
  const inventory = {
    ownerId: first.ownerId,
    configurationDigest: first.configurationDigest,
    attempts: 0,
    contribution: 0,
    runs: [{ kind: 'offline-acceptance', state: 'accepted', ...expected }],
  };
  assert.deepEqual(await journal.inventory(), inventory);
  await journal.close();
  for (const mode of ['journal-only', 'acceptance-only', undefined] as const) {
    const handle =
      mode === 'acceptance-only'
        ? await f.open()
        : mode === 'journal-only'
          ? await FrozenBrowserValidator.open({ ...f.options, mode })
          : await FrozenBrowserValidator.open({
              directory: f.directory,
              workspace: f.options.workspace,
            });
    if (mode !== undefined) assert.deepEqual(await Reflect.get(handle, 'inventory')(), inventory);
    if (mode === undefined && 'validate' in handle)
      await assert.rejects(
        handle.validate(f.request, new AbortController().signal),
        /validator-acceptance-not-executable/,
      );
    await handle.close();
    assert.deepEqual(journalRows(f.directory).meta, { ...before.meta, version: 2 });
  }
});

test('ordinary authority denials roll back staged memory and lazy format upgrade without poisoning the handle', async (t) => {
  const f = await acceptanceFixture(t);
  const journal = await f.open();
  const before = journalRows(f.directory);
  const thenable = new Proxy(
    {},
    { get: (_target, key) => (key === 'then' ? () => {} : undefined) },
  );
  for (const value of [false, undefined, Promise.resolve(true), thenable]) {
    await assert.rejects(
      journal.accept(f.request, (() => value) as () => true),
      /worker-authority-denied/,
    );
    assert.deepEqual(journalRows(f.directory), before);
    assert.deepEqual((await journal.inventory()).runs, []);
  }
  await assert.rejects(
    journal.accept(f.request, () => {
      throw Error('revoked');
    }),
    /revoked/,
  );
  const accepted = await journal.accept(f.request, authority);
  await assert.rejects(
    journal.accept(f.request, (() => false) as unknown as () => true),
    /worker-authority-denied/,
  );
  assert.deepEqual(await journal.accept(f.request, authority), accepted);
});

for (const guardKind of ['async', 'promise'] as const)
  for (const keyState of ['new', 'existing'] as const)
    test(`rejecting ${guardKind} authority for ${keyState} acceptance does not leak a rejection`, () => {
      const child = spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL('./frozen-browser-acceptance-authority-worker.ts', import.meta.url),
          ),
          guardKind,
          keyState,
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

test('complete same-key conflicts and execution keys reject without worker effects or quota changes', async (t) => {
  const f = await acceptanceFixture(t);
  const journal = await f.open();
  await journal.accept(f.request, authority);
  const before = journalRows(f.directory);
  for (const change of [
    { role: 'candidate' },
    { allowanceMs: 59999 },
    { frozen: { ...f.request.frozen, revision: 'c'.repeat(40) } },
    { frozen: { ...f.request.frozen, manifestDigest: 'c'.repeat(64) } },
  ])
    await assert.rejects(
      journal.accept(frozenBrowserRequest({ ...f.request, ...change }), authority),
      /validator-identity-conflict/,
    );
  await assert.rejects(
    journal.accept({ ...f.request, extra: true } as typeof f.request, authority),
    /invalid-frozen-browser-fields/,
  );
  assert.deepEqual(journalRows(f.directory), before);
  await journal.close();
  const legacy = { ...before.meta, version: 1 };
  const db = new DatabaseSync(join(f.directory, 'journal.sqlite'));
  db.prepare('UPDATE meta SET body=?,digest=?').run(JSON.stringify(legacy), digest(legacy));
  db.close();
  const run = seedRun(f.directory, f.request);
  const reopened = await f.open();
  await assert.rejects(reopened.accept(f.request, authority), /validator-identity-conflict/);
  assert.deepEqual(journalRows(f.directory).runs, [run]);
  assert.equal(journalRows(f.directory).meta.version, 1);
});

test('metadata capacity is 256 independent of execution quota and exact retries remain available at capacity', async (t) => {
  const f = await acceptanceFixture(t);
  const journal = await f.open();
  let first;
  for (let i = 0; i < 256; i++) {
    const accepted = await journal.accept(
      frozenBrowserRequest({ ...f.request, action: { ...f.request.action, epoch: i } }),
      authority,
    );
    first ??= accepted;
  }
  assert.equal((await journal.inventory()).runs.length, 256);
  await assert.rejects(
    journal.accept(
      frozenBrowserRequest({ ...f.request, action: { ...f.request.action, epoch: 256 } }),
      authority,
    ),
    /validator-acceptance-limit/,
  );
  assert.deepEqual(await journal.accept(first!.request, authority), first);
  assert.deepEqual(journalRows(f.directory).meta, {
    version: 2,
    owner: f.options.expectedIdentity.ownerId,
    configurationDigest: f.options.expectedIdentity.configurationDigest,
    attempts: 0,
    contribution: 0,
  });
});

test('acceptance mode and identity snapshot before awaits, refuse provisioning and precede pending recovery writes', async (t) => {
  const f = await acceptanceFixture(t);
  const options = { ...f.options, expectedIdentity: { ...f.options.expectedIdentity } };
  const opening = FrozenBrowserValidator.open(options);
  Reflect.set(options, 'mode', undefined);
  options.expectedIdentity.ownerId = randomUUID();
  options.directory = '/missing';
  const handle = await opening;
  assert.deepEqual(Object.keys(handle).sort(), ['accept', 'close', 'inventory']);
  await handle.close();
  assert.equal(journalRows(f.directory).meta.version, 1);
  seedRun(f.directory, f.request, true);
  const before = journalRows(f.directory);
  for (const change of [{ ownerId: randomUUID() }, { configurationDigest: sha256('f'.repeat(64)) }])
    await assert.rejects(
      FrozenBrowserValidator.open({
        ...f.options,
        expectedIdentity: { ...f.options.expectedIdentity, ...change },
      }),
      /worker-journal-identity-mismatch/,
    );
  assert.deepEqual(journalRows(f.directory), before);
  const empty = join(f.root, 'empty');
  await mkdir(empty, { mode: 0o700 });
  await assert.rejects(
    FrozenBrowserValidator.open({ ...f.options, directory: empty }),
    /unowned-validator-directory/,
  );
  assert.deepEqual(await readdir(empty), []);
  await assert.rejects(
    FrozenBrowserValidator.open({ ...f.options, mode: 'other' as 'acceptance-only' }),
    /invalid-validator-mode/,
  );
});

test('persistence failures fail closed even when COMMIT succeeded, and close shares completion and drains accepted operations', async (t) => {
  for (const after of [false, true])
    await t.test(after ? 'after COMMIT' : 'before COMMIT', async (t) => {
      const f = await acceptanceFixture(t);
      const journal = await f.open();
      const original = DatabaseSync.prototype.exec;
      DatabaseSync.prototype.exec = function (sql) {
        if (sql === 'COMMIT') {
          if (after) Reflect.apply(original, this, [sql]);
          throw Error('ambiguous-persistence');
        }
        return Reflect.apply(original, this, [sql]);
      };
      try {
        await assert.rejects(journal.accept(f.request, authority), /ambiguous-persistence/);
      } finally {
        DatabaseSync.prototype.exec = original;
      }
      await assert.rejects(journal.accept(f.request, authority), /validator-closed/);
      await journal.close();
      const reopened = await f.open();
      assert.equal((await reopened.inventory()).runs.length, after ? 1 : 0);
      const pending = reopened.accept(f.request, authority);
      const reading = reopened.inventory();
      const closing = reopened.close();
      assert.equal(reopened.close(), closing);
      await assert.rejects(reopened.accept(f.request, authority), /validator-closed/);
      const accepted = await pending;
      assert.deepEqual((await reading).runs, [
        { kind: 'offline-acceptance', state: 'accepted', ...accepted },
      ]);
      await closing;
      const last = await f.open();
      assert.deepEqual(await last.accept(f.request, authority), accepted);
    });
});

test('version 2 strictly validates the union, accounting, identities and bounded metadata', async (t) => {
  const f = await acceptanceFixture(t);
  const journal = await f.open();
  await journal.accept(f.request, authority);
  await journal.close();
  const original = journalRows(f.directory);
  const mutations = [
    (r: typeof original) => {
      r.runs[0].extra = true;
    },
    (r: typeof original) => {
      r.runs[0].requestDigest = 'f'.repeat(64);
    },
    (r: typeof original) => {
      r.runs[0].configurationDigest = 'f'.repeat(64);
    },
    (r: typeof original) => {
      r.runs[0].ownerId = randomUUID();
    },
    (r: typeof original) => {
      r.runs[0].deadline++;
    },
    (r: typeof original) => {
      r.runs[0].acceptedAt = Number.MAX_SAFE_INTEGER;
      r.runs[0].deadline = Number.MAX_SAFE_INTEGER;
    },
    (r: typeof original) => {
      r.runs[0].kind = 'pending';
    },
    (r: typeof original) => {
      r.runs.push(r.runs[0]);
    },
    (r: typeof original) => {
      r.meta.attempts = 1;
      r.meta.contribution = 41943040;
    },
    (r: typeof original) => {
      r.meta.version = 1;
    },
    (r: typeof original) => {
      r.runs = Array.from({ length: 257 }, (_, epoch) => ({
        ...r.runs[0],
        acceptanceId: randomUUID(),
        request: { ...f.request, action: { ...f.request.action, epoch } },
        requestDigest: digest({ ...f.request, action: { ...f.request.action, epoch } }),
      }));
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(original);
    mutate(changed);
    const db = new DatabaseSync(join(f.directory, 'journal.sqlite'));
    db.exec('DELETE FROM runs');
    db.prepare('UPDATE meta SET body=?,digest=?').run(
      JSON.stringify(changed.meta),
      digest(changed.meta),
    );
    changed.runs.forEach((r: unknown, i: number) =>
      db.prepare('INSERT INTO runs VALUES(?,?,?)').run(i + 1, JSON.stringify(r), digest(r)),
    );
    db.close();
    await assert.rejects(f.open(), /invalid-frozen-browser|corrupt-validator|missing-validator/);
  }
});

for (const point of ['before', 'after'] as const)
  test(
    `SIGKILL ${point} acceptance COMMIT preserves atomic lazy migration and lost-result recovery`,
    { timeout: 30000 },
    async (t) => {
      const f = await acceptanceFixture(t);
      const run = seedRun(
        f.directory,
        frozenBrowserRequest({
          ...f.request,
          action: { ...f.request.action, actionId: randomUUID() },
        }),
      );
      const before = journalRows(f.directory);
      const child = fork(
        new URL('./frozen-browser-acceptance-crash-worker.ts', import.meta.url),
        [f.directory, JSON.stringify(f.options.expectedIdentity), JSON.stringify(f.request), point],
        { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
      );
      let errors = '';
      child.stderr!.on('data', (b) => {
        errors += b;
      });
      t.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      });
      const message = await Promise.race([
        once(child, 'message').then(([m]) => m as { record: Record<string, unknown> }),
        once(child, 'exit').then(() => {
          throw Error(errors);
        }),
      ]);
      const exit = once(child, 'exit');
      child.kill('SIGKILL');
      assert.deepEqual(await exit, [null, 'SIGKILL']);
      const journal = await f.open();
      const inventory = await journal.inventory();
      assert.equal(inventory.attempts, 1);
      assert.equal(inventory.contribution, 41943040);
      assert.deepEqual(journalRows(f.directory).meta, {
        ...before.meta,
        version: point === 'after' ? 2 : 1,
      });
      assert.equal(inventory.runs.length, point === 'after' ? 2 : 1);
      if (point === 'before') assert.deepEqual(journalRows(f.directory), before);
      else {
        assert.deepEqual(journalRows(f.directory).runs[0], { kind: 'execution', run });
        const { kind: _kind, ...ack } = message.record;
        assert.deepEqual(await journal.accept(f.request, authority), ack);
        await journal.close();
        const reopened = await f.open();
        assert.deepEqual(await reopened.accept(f.request, authority), ack);
      }
    },
  );

test('mixed version 2 history preserves execution accounting, recovery updates and cross-kind uniqueness', async (t) => {
  const f = await acceptanceFixture(t);
  const executionRequest = frozenBrowserRequest({
    ...f.request,
    action: { ...f.request.action, actionId: randomUUID() },
  });
  seedRun(f.directory, executionRequest, true);
  const journal = await f.open();
  const accepted = await journal.accept(f.request, authority);
  const inventory = await journal.inventory();
  assert.equal(inventory.attempts, 1);
  assert.equal(inventory.contribution, 41943040);
  assert.equal(inventory.runs[0].state, 'recorded');
  await journal.close();
  const original = journalRows(f.directory);
  assert.equal(original.runs[0].kind, 'execution');
  const db = new DatabaseSync(join(f.directory, 'journal.sqlite'));
  original.runs[0].run.result = { kind: 'pending' };
  db.prepare('UPDATE runs SET body=?,digest=? WHERE id=1').run(
    JSON.stringify(original.runs[0]),
    digest(original.runs[0]),
  );
  db.close();
  const recovered = await f.open();
  assert.deepEqual(await recovered.inventory(), inventory);
  await recovered.close();
  const baseline = journalRows(f.directory);
  for (const corruption of ['row-id', 'uuid', 'action-key'] as const) {
    const changed = structuredClone(baseline);
    if (corruption === 'uuid') changed.runs[1].acceptanceId = changed.runs[0].run.intent.runId;
    if (corruption === 'action-key') {
      changed.runs[1].request = executionRequest;
      changed.runs[1].requestDigest = digest(executionRequest);
    }
    const db = new DatabaseSync(join(f.directory, 'journal.sqlite'));
    db.exec('DELETE FROM runs');
    changed.runs.forEach((r: unknown, i: number) =>
      db
        .prepare('INSERT INTO runs VALUES(?,?,?)')
        .run(i + (corruption === 'row-id' ? 2 : 1), JSON.stringify(r), digest(r)),
    );
    db.close();
    await assert.rejects(f.open(), /corrupt-validator-accounting|corrupt-validator-identities/);
  }
  assert.equal(accepted.deadline - accepted.acceptedAt, 60000);
});

test('unsafe timestamp arithmetic rejects without upgrade and leaves the handle reusable', async (t) => {
  const f = await acceptanceFixture(t);
  const journal = await f.open();
  const originalNow = Date.now;
  Date.now = () => Number.MAX_SAFE_INTEGER;
  try {
    await assert.rejects(journal.accept(f.request, authority), /invalid-frozen-browser-number/);
  } finally {
    Date.now = originalNow;
  }
  assert.equal(journalRows(f.directory).meta.version, 1);
  assert.deepEqual(journalRows(f.directory).runs, []);
  const result = await journal.accept(f.request, authority);
  assert.deepEqual(await journal.accept(f.request, authority), result);
});
