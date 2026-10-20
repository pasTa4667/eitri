import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rename, rm, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { Controller } from '../src/controller.ts';
import { FrozenBrowserValidator, frozenBrowserRequest } from '../src/frozen-browser.ts';
import { digest } from '../src/domain.ts';
import type { AdmittedCheckRequest } from '../src/domain.ts';
import type { OfflineActionWorkspace } from '../src/controller.ts';
import { sha256, virtualPath } from '../src/workspace.ts';
import {
  fixture,
  sources,
  journalRows,
  seedRun,
  gate,
  until,
  command,
  receipt,
  forbiddenWorkspace,
} from './controller-worker-association-fixture.ts';

for (const kind of ['baseline', 'browser'] as const)
  test(`${kind} retains the original allowance and derives detached history without changing either owner`, async (t) => {
    let now = 1000;
    let admitted!: AdmittedCheckRequest;
    const f = await fixture(
      t,
      {
        clock: () => now,
        fault: (point) => {
          if (point === 'after-source-selection-receipt') now += 1234;
        },
        check: async (request) => {
          admitted = request;
          return receipt(request.kind);
        },
      },
      kind,
    );
    const id = await f.add();
    await f.parked(id);
    const initial = await f.controller.inspectWorkerAssociation(id, admitted.actionId);
    assert.equal(initial.state, 'absent');
    if (initial.state !== 'absent') return assert.fail('missing intent');
    const expectedRequest = {
      frozen: sources(f.directory)[0].frozen,
      action: { caseId: id, actionId: admitted.actionId, epoch: admitted.epoch },
      scenarioId: 'synthetic-click-v1',
      role: kind === 'baseline' ? 'baseline' : 'candidate',
      allowanceMs: 58766,
    };
    assert.equal(admitted.remainingMs, 58766);
    assert.deepEqual(initial.intent, {
      request: expectedRequest,
      requestDigest: digest(expectedRequest),
    });
    assert.equal(sources(f.directory)[0].state, 'settled');
    const run = seedRun(f.journalDirectory, initial.intent.request);
    const beforeJournal = journalRows(f.journalDirectory);
    const before = await f.controller.snapshot({ selected: id });
    const matched = await f.controller.inspectWorkerAssociation(id, admitted.actionId);
    assert.deepEqual(matched, {
      state: 'matched',
      intent: initial.intent,
      run: {
        runId: run.intent.runId,
        request: expectedRequest,
        requestDigest: digest(expectedRequest),
        configurationDigest: f.options.offlineWorkerJournal!.configurationDigest,
        admittedAt: 1000,
        deadline: 59766,
        ...run.ledger,
        state: 'recorded',
        outcome: { kind: 'uncertain', code: 'fixture-uncertain' },
        cleanup: 'unresolved',
      },
    });
    const expected = structuredClone(matched);
    if (matched.state !== 'matched') return assert.fail('missing match');
    Object.assign(matched.intent.request.action, { epoch: 99 });
    Object.assign(matched.run.request.frozen, { revision: 'f'.repeat(40) });
    Object.assign(matched.run.outcome, { code: 'forged' });
    Object.assign(matched.run.image, { kind: 'intent' });
    assert.deepEqual(await f.controller.inspectWorkerAssociation(id, admitted.actionId), expected);
    assert.deepEqual(await f.controller.snapshot({ selected: id }), before);
    assert.deepEqual(journalRows(f.journalDirectory), beforeJournal);
    await f.close();
    await f.reopen();
    assert.deepEqual(await f.controller.inspectWorkerAssociation(id, admitted.actionId), expected);
    assert.deepEqual(journalRows(f.journalDirectory), beforeJournal);
  });

test('selected A remains the candidate intent after an edit to B and Retry cannot revive the old action', async (t) => {
  const entered = gate();
  const finish = gate();
  t.after(() => finish.resolve());
  let candidate!: { request: AdmittedCheckRequest; source: OfflineActionWorkspace };
  let attempts = 0;
  const f = await fixture(
    t,
    {
      check: async (request, source) => {
        if (request.kind === 'baseline') return receipt(request.kind);
        if (++attempts > 1) return { type: 'infrastructure' };
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
  const observed = await f.controller.inspectWorkerAssociation(id, candidate.request.actionId);
  if (observed.state !== 'absent') return assert.fail('missing candidate intent');
  assert.equal(observed.intent.request.role, 'candidate');
  assert.deepEqual(observed.intent.request.frozen, candidate.source.selection);
  assert.equal(
    Buffer.from((await candidate.source.readSelected())[0].bytes).toString(),
    'literal A\n',
  );
  seedRun(f.journalDirectory, observed.intent.request);
  finish.resolve();
  const parked = await f.parked(id);
  assert.equal(sources(f.directory).at(-1).state, 'interrupted');
  assert.equal(sources(f.directory).at(-1).reason, 'source-action-interrupted');
  const expected = await f.controller.inspectWorkerAssociation(id, candidate.request.actionId);
  await assert.rejects(candidate.source.readSelected(), { code: 'action-source-revoked' });
  await f.controller.command(
    command({ type: 'retry', caseId: id, note: 'Explicit bounded retry' }, parked.version),
  );
  await f.parked(id);
  assert.deepEqual(
    await f.controller.inspectWorkerAssociation(id, candidate.request.actionId),
    expected,
  );
  assert.notEqual(sources(f.directory).at(-1).frozen.revision, candidate.source.selection.revision);
  await assert.rejects(candidate.source.readSelected(), { code: 'action-source-revoked' });
  await f.close();
  await f.reopen();
  assert.deepEqual(
    await f.controller.inspectWorkerAssociation(id, candidate.request.actionId),
    expected,
  );
});

test('same-key request mismatches conflict while another action key is absent', async (t) => {
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
  const observed = await f.controller.inspectWorkerAssociation(id, action);
  if (observed.state !== 'absent') return assert.fail('missing intent');
  const original = observed.intent.request;
  const mismatches = [
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
  ] as const;
  for (const [name, request] of mismatches) {
    const run = seedRun(f.journalDirectory, frozenBrowserRequest(request));
    const result = await f.controller.inspectWorkerAssociation(id, action);
    assert.equal(
      result.state,
      ['epoch', 'action', 'case'].includes(name) ? 'absent' : 'conflict',
      name,
    );
    if (result.state === 'conflict') {
      assert.deepEqual(result.intent, observed.intent);
      assert.equal(result.runs[0].runId, run.intent.runId);
      assert.deepEqual(result.runs[0].request, request);
    }
  }
  for (const [name, change] of [
    [
      'request digest',
      (run: ReturnType<typeof seedRun>) => {
        run.intent.requestDigest = 'f'.repeat(64);
      },
    ],
    [
      'configuration digest',
      (run: ReturnType<typeof seedRun>) => {
        run.intent.configurationDigest = 'f'.repeat(64);
      },
    ],
    [
      'scenario',
      (run: ReturnType<typeof seedRun>) => {
        Reflect.set(run.intent.request, 'scenarioId', 'other');
      },
    ],
  ] as const) {
    const run = seedRun(f.journalDirectory, original);
    change(run);
    const db = new DatabaseSync(join(f.journalDirectory, 'journal.sqlite'));
    db.prepare('UPDATE runs SET body=?,digest=?').run(JSON.stringify(run), digest(run));
    db.close();
    await assert.rejects(
      f.controller.inspectWorkerAssociation(id, action),
      /invalid-frozen-browser-request|corrupt-validator-intent/,
      name,
    );
  }
  seedRun(f.journalDirectory, original);
  assert.equal((await f.controller.inspectWorkerAssociation(id, action)).state, 'matched');
});

test('pre-await configuration snapshot and immutable binding reject changed or omitted reopen options', async (t) => {
  const f = await fixture(t);
  await f.close();
  const binding = { ...f.options.offlineWorkerJournal! };
  const offline = f.options.offlineWorkspace!;
  const options = {
    ...f.options,
    offlineWorkerJournal: { ...binding },
    offlineWorkspace: {
      ...offline,
      baseline: offline.baseline.map((file) => ({ ...file, bytes: Buffer.from(file.bytes) })),
    },
  };
  const opening = Controller.open(options);
  options.offlineWorkerJournal.ownerId = randomUUID();
  options.offlineWorkerJournal.directory = '/missing';
  options.offlineWorkspace.baseline[0].bytes.fill(0);
  const controller = await opening;
  await controller.close();
  for (const change of [
    { offlineWorkerJournal: undefined },
    { offlineWorkerJournal: { ...binding, ownerId: randomUUID() } },
    { offlineWorkerJournal: { ...binding, configurationDigest: 'f'.repeat(64) } },
    { offlineWorkerJournal: { ...binding, directory: join(f.root, 'other') } },
    { offlineWorkspace: undefined },
  ])
    await assert.rejects(Controller.open({ ...f.options, ...change }));
  await f.reopen();
  const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'), { readOnly: true });
  assert.deepEqual(
    JSON.parse(
      String(
        db.prepare("SELECT value FROM metadata WHERE key='offline_worker_journal'").get()?.value,
      ),
    ),
    { version: 1, ...binding },
  );
  db.close();
});

test('new bindings require independent verified ownership before persistence or startup recovery', async (t) => {
  const f = await fixture(t, { offlineWorkerJournal: undefined });
  await f.close();
  const { meta } = journalRows(f.journalDirectory);
  const binding = {
    directory: f.journalDirectory,
    ownerId: meta.owner,
    configurationDigest: meta.configurationDigest,
  };
  for (const bad of [
    { ...binding, ownerId: randomUUID() },
    { ...binding, configurationDigest: 'f'.repeat(64) },
  ]) {
    await assert.rejects(Controller.open({ ...f.options, offlineWorkerJournal: bad }), {
      code: 'worker-journal-identity-mismatch',
    });
    const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'), { readOnly: true });
    assert.equal(
      db.prepare("SELECT value FROM metadata WHERE key='offline_worker_journal'").get(),
      undefined,
    );
    db.close();
    const journal = await FrozenBrowserValidator.open({
      directory: f.journalDirectory,
      workspace: forbiddenWorkspace,
      mode: 'journal-only',
    });
    await journal.close();
  }
  await assert.rejects(
    Controller.open({ ...f.options, offlineWorkspace: undefined, offlineWorkerJournal: binding }),
    { code: 'invalid-offline-worker-journal' },
  );
  await f.reopen();
});

test('legacy and unsupported selections stay unrecorded without backfill', async (t) => {
  let action = '';
  const f = await fixture(t, {
    offlineWorkerJournal: undefined,
    check: async (r) => {
      action = r.actionId;
      return { type: 'infrastructure' };
    },
  });
  const id = await f.add();
  await f.parked(id);
  await f.close();
  const { meta } = journalRows(f.journalDirectory);
  f.options.offlineWorkerJournal = {
    directory: f.journalDirectory,
    ownerId: meta.owner,
    configurationDigest: meta.configurationDigest,
  };
  await f.reopen();
  assert.deepEqual(await f.controller.inspectWorkerAssociation(id, action), {
    state: 'unrecorded',
  });
  assert.equal(sources(f.directory)[0].workerIntent, undefined);
});

test('unsupported check has no intent and final authority loss cannot record one', async (t) => {
  for (const mode of ['unit', 'exhausted', 'paused'] as const)
    await t.test(mode, async (t) => {
      let now = 1000;
      let calls = 0;
      let pausing: Promise<unknown> | undefined;
      const f = await fixture(
        t,
        {
          clock: () => now,
          fault: (point, id) => {
            if (point !== 'after-source-selection-receipt' || mode === 'unit') return;
            if (mode === 'exhausted') now += 60000;
            else pausing = f.controller.command(command({ type: 'pause', caseId: id }));
          },
          check: async () => {
            calls++;
            return { type: 'infrastructure' };
          },
        },
        mode === 'unit' ? 'unit' : 'browser',
      );
      const id = await f.add();
      await until(
        async () => (await f.controller.snapshot()).cases[0],
        (c) => ['needs-attention', 'paused'].includes(c.status),
      );
      await pausing;
      const source = sources(f.directory)[0];
      assert.equal(calls, mode === 'unit' ? 1 : 0);
      assert.deepEqual(await f.controller.inspectWorkerAssociation(id, source.action.id), {
        state: 'unrecorded',
      });
    });
});

test('inspection reports missing, corrupt, busy and foreign journals as errors and always releases ownership', async (t) => {
  let action = '';
  const f = await fixture(t, {
    check: async (r) => {
      action = r.actionId;
      return { type: 'infrastructure' };
    },
  });
  const id = await f.add();
  await f.parked(id);
  const initial = await f.controller.inspectWorkerAssociation(id, action);
  if (initial.state !== 'absent') return assert.fail('missing intent');
  const before = await f.controller.snapshot({ selected: id });
  const busy = await FrozenBrowserValidator.open({
    directory: f.journalDirectory,
    workspace: forbiddenWorkspace,
    mode: 'journal-only',
  });
  await assert.rejects(f.controller.inspectWorkerAssociation(id, action), /validator-already-open/);
  await busy.close();
  const saved = join(f.root, 'saved');
  await rename(f.journalDirectory, saved);
  await assert.rejects(f.controller.inspectWorkerAssociation(id, action), { code: 'ENOENT' });
  await mkdir(f.journalDirectory, { mode: 0o700 });
  await assert.rejects(
    f.controller.inspectWorkerAssociation(id, action),
    /unowned-validator-directory/,
  );
  await rm(f.journalDirectory, { recursive: true });
  await symlink(saved, f.journalDirectory);
  await assert.rejects(f.controller.inspectWorkerAssociation(id, action), /unsafe-validator-root/);
  await rm(f.journalDirectory);
  await rename(saved, f.journalDirectory);
  const markerPath = join(f.journalDirectory, 'owner.json');
  const marker = await readFile(markerPath);
  const foreign = JSON.parse(marker.toString());
  foreign.owner = randomUUID();
  const { meta } = journalRows(f.journalDirectory);
  const db = new DatabaseSync(join(f.journalDirectory, 'journal.sqlite'));
  await writeFile(markerPath, JSON.stringify(foreign));
  db.prepare('UPDATE meta SET body=?,digest=?').run(
    JSON.stringify({ ...meta, owner: foreign.owner }),
    digest({ ...meta, owner: foreign.owner }),
  );
  await assert.rejects(
    f.controller.inspectWorkerAssociation(id, action),
    /worker-journal-identity-mismatch/,
  );
  await writeFile(markerPath, marker);
  db.prepare('UPDATE meta SET body=?,digest=?').run(JSON.stringify(meta), digest(meta));
  const run = seedRun(f.journalDirectory, initial.intent.request);
  db.prepare('UPDATE runs SET digest=?').run('f'.repeat(64));
  await assert.rejects(
    f.controller.inspectWorkerAssociation(id, action),
    /corrupt-validator-journal/,
  );
  db.prepare('UPDATE runs SET digest=?').run(digest(run));
  db.close();
  assert.equal((await f.controller.inspectWorkerAssociation(id, action)).state, 'matched');
  assert.deepEqual(await f.controller.snapshot({ selected: id }), before);
  await assert.rejects(
    f.controller.inspectWorkerAssociation('invalid', action),
    /invalid-worker-association-id/,
  );
  await assert.rejects(
    f.controller.inspectWorkerAssociation(id, randomUUID()),
    /action-source-missing/,
  );
  assert.equal((await f.controller.inspectWorkerAssociation(id, action)).state, 'matched');
});

test('accepted inspections serialize and close drains them before releasing storage', async (t) => {
  let action = '';
  const f = await fixture(t, {
    check: async (r) => {
      action = r.actionId;
      return { type: 'infrastructure' };
    },
  });
  const id = await f.add();
  await f.parked(id);
  const observed = await f.controller.inspectWorkerAssociation(id, action);
  if (observed.state !== 'absent') return assert.fail('missing intent');
  seedRun(f.journalDirectory, observed.intent.request, true);
  const before = journalRows(f.journalDirectory);
  const reads = [
    f.controller.inspectWorkerAssociation(id, action),
    f.controller.inspectWorkerAssociation(id, action),
  ];
  const closing = f.close();
  await assert.rejects(f.controller.inspectWorkerAssociation(id, action), /controller-closed/);
  const results = await Promise.all(reads);
  await closing;
  assert.equal(results[0].state, 'matched');
  assert.deepEqual(results[0], results[1]);
  const after = journalRows(f.journalDirectory);
  assert.deepEqual(after.meta, before.meta);
  assert.deepEqual(after.runs[0].intent, before.runs[0].intent);
  assert.deepEqual(after.runs[0].result, {
    kind: 'recorded',
    outcome: { kind: 'uncertain', code: 'interrupted-run-no-replay' },
    evidence: null,
  });
  await f.reopen();
  assert.deepEqual(await f.controller.inspectWorkerAssociation(id, action), results[0]);
});

for (const point of ['after-worker-intent', 'after-source-selection-receipt'] as const)
  test(
    `SIGKILL ${point} retains exact history without callback replay`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t);
      await f.close();
      const child = fork(
        new URL('./controller-worker-association-crash-worker.ts', import.meta.url),
        [f.directory, JSON.stringify(f.options.offlineWorkerJournal), point],
        { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
      );
      let errors = '';
      child.stderr!.on('data', (chunk) => {
        errors += chunk.toString();
      });
      t.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      });
      const message = await Promise.race([
        once(child, 'message').then(([m]) => m as { id: string; callbacks: number }),
        once(child, 'exit').then(() => {
          throw Error(`Child exited early ${errors}`);
        }),
      ]);
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      assert.deepEqual(await exited, [null, 'SIGKILL']);
      assert.equal(message.callbacks, 0);
      const source = sources(f.directory)[0];
      assert.equal(source.state, 'selected');
      let calls = 0;
      f.options.check = async () => {
        calls++;
        return { type: 'infrastructure' };
      };
      let beforeJournal = journalRows(f.journalDirectory);
      if (point === 'after-worker-intent') {
        seedRun(f.journalDirectory, source.workerIntent.request);
        beforeJournal = journalRows(f.journalDirectory);
      }
      await f.reopen();
      const c = await f.parked(message.id);
      assert.equal(calls, 0);
      assert.equal(c.native, 'ready');
      assert.equal(c.epoch, source.action.epoch + 2);
      const recovered = sources(f.directory)[0];
      assert.deepEqual(recovered, {
        action: source.action,
        kind: source.kind,
        ...(source.workerIntent ? { workerIntent: source.workerIntent } : {}),
        state: 'interrupted',
        reason: 'interrupted-source-selection',
        frozen: source.frozen,
      });
      const observed = await f.controller.inspectWorkerAssociation(message.id, source.action.id);
      assert.equal(observed.state, point === 'after-worker-intent' ? 'matched' : 'unrecorded');
      if (observed.state === 'matched') assert.deepEqual(observed.intent, source.workerIntent);
      assert.deepEqual(journalRows(f.journalDirectory), beforeJournal);
      const view = (await f.controller.snapshot({ selected: message.id })).selected!;
      assert.deepEqual(view.checks, []);
      assert.deepEqual(view.artifacts, []);
      await f.close();
      await f.reopen();
      assert.deepEqual(
        await f.controller.inspectWorkerAssociation(message.id, source.action.id),
        observed,
      );
      assert.equal(calls, 0);
    },
  );

test('malformed binding options reject before any directory is created', async (t) => {
  const f = await fixture(t);
  for (const [index, value] of [
    null,
    false,
    1,
    [],
    {},
    { ...f.options.offlineWorkerJournal, ownerId: 'not-a-uuid' },
    { ...f.options.offlineWorkerJournal, configurationDigest: 'not-a-digest' },
    { ...f.options.offlineWorkerJournal, extra: true },
  ].entries()) {
    const directory = join(f.root, `invalid-${index}`);
    const options = { ...f.options, directory };
    Reflect.set(options, 'offlineWorkerJournal', value);
    await assert.rejects(
      Controller.open(options),
      /invalid-offline-worker-journal|invalid-workspace-hash/,
    );
    await assert.rejects(readFile(join(directory, 'catalogue.sqlite')), { code: 'ENOENT' });
  }
});

test('retained intent parsing rejects source and digest mutations without changing history', async (t) => {
  let action = '';
  const f = await fixture(t, {
    check: async (r) => {
      action = r.actionId;
      return { type: 'infrastructure' };
    },
  });
  const id = await f.add();
  await f.parked(id);
  const original = sources(f.directory)[0];
  const expected = await f.controller.inspectWorkerAssociation(id, action);
  const mutations = [
    (s: typeof original) => {
      s.workerIntent.requestDigest = 'f'.repeat(64);
    },
    (s: typeof original) => {
      s.workerIntent.extra = true;
    },
    (s: typeof original) => {
      s.workerIntent = null;
    },
    (s: typeof original) => {
      s.frozen = null;
    },
    (s: typeof original) => {
      s.kind = 'unit';
    },
    (s: typeof original) => {
      s.workerIntent.request.action.actionId = randomUUID();
      s.workerIntent.requestDigest = digest(s.workerIntent.request);
    },
    (s: typeof original) => {
      s.workerIntent.request.role = 'baseline';
      s.workerIntent.requestDigest = digest(s.workerIntent.request);
    },
    (s: typeof original) => {
      s.workerIntent.request.frozen.revision = 'f'.repeat(40);
      s.workerIntent.requestDigest = digest(s.workerIntent.request);
    },
    (s: typeof original) => {
      s.workerIntent.request.scenarioId = 'other';
    },
  ];
  const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
  try {
    for (const mutate of mutations) {
      const corrupt = structuredClone(original);
      mutate(corrupt);
      db.prepare('UPDATE action_sources SET value=? WHERE action_id=?').run(
        JSON.stringify(corrupt),
        action,
      );
      await assert.rejects(
        f.controller.inspectWorkerAssociation(id, action),
        /invalid-worker-intent|invalid-frozen-browser-request/,
      );
    }
  } finally {
    db.prepare('UPDATE action_sources SET value=? WHERE action_id=?').run(
      JSON.stringify(original),
      action,
    );
    db.close();
  }
  assert.deepEqual(await f.controller.inspectWorkerAssociation(id, action), expected);
});

test('settled historical cleanup is detached and startup journal failure precedes case recovery', async (t) => {
  let action = '';
  const f = await fixture(t, {
    check: async (r) => {
      action = r.actionId;
      return { type: 'infrastructure' };
    },
  });
  const id = await f.add();
  await f.parked(id);
  const initial = await f.controller.inspectWorkerAssociation(id, action);
  if (initial.state !== 'absent') return assert.fail('missing intent');
  const run = seedRun(f.journalDirectory, initial.intent.request);
  Reflect.set(run, 'result', {
    kind: 'settled',
    report: {
      runId: run.intent.runId,
      request: run.intent.request,
      outcome: { kind: 'uncertain', code: 'historical-uncertain' },
      cleanup: { kind: 'incomplete', cache: 'retained', code: 'historical-unconfirmed' },
      evidence: null,
    },
  });
  const db = new DatabaseSync(join(f.journalDirectory, 'journal.sqlite'));
  db.prepare('UPDATE runs SET body=?,digest=?').run(JSON.stringify(run), digest(run));
  db.close();
  const matched = await f.controller.inspectWorkerAssociation(id, action);
  assert.equal(matched.state, 'matched');
  if (matched.state !== 'matched') return assert.fail('missing settled match');
  assert.equal(matched.run.state, 'settled');
  assert.deepEqual(matched.run.cleanup, {
    kind: 'incomplete',
    cache: 'retained',
    code: 'historical-unconfirmed',
  });
  const expected = structuredClone(matched);
  Object.assign(matched.run.cleanup, { code: 'forged' });
  assert.deepEqual(await f.controller.inspectWorkerAssociation(id, action), expected);
  const before = await f.controller.snapshot({ selected: id });
  const beforeSources = sources(f.directory);
  await f.close();
  const saved = join(f.root, 'saved-journal');
  await rename(f.journalDirectory, saved);
  await assert.rejects(Controller.open(f.options), { code: 'ENOENT' });
  assert.deepEqual(sources(f.directory), beforeSources);
  const catalogue = new DatabaseSync(join(f.directory, 'catalogue.sqlite'), { readOnly: true });
  assert.deepEqual(
    JSON.parse(String(catalogue.prepare('SELECT value FROM cases WHERE id=?').get(id)?.value)),
    before.selected!.case,
  );
  catalogue.close();
  await rename(saved, f.journalDirectory);
  await f.reopen();
  assert.deepEqual(await f.controller.inspectWorkerAssociation(id, action), expected);
});
