import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, lstat, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import type { FauxResponseStep } from '@earendil-works/pi-ai/providers/faux';
import { Controller } from '../src/controller.ts';
import type { OfflineActionWorkspace } from '../src/controller.ts';
import { NativeCase } from '../src/native.ts';
import {
  WorkspaceStore,
  caseId,
  repositoryId,
  virtualPath,
  sha256,
  gitRevision,
} from '../src/workspace.ts';
import type { FrozenRevision } from '../src/workspace.ts';
import type { AdmittedCheckRequest, Case, Check, CheckExecution, Intent } from '../src/domain.ts';

const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
const issue = (id = 'offline') =>
  ({
    ...policy,
    id,
    title: id,
    priority: 'high',
    status: 'unresolved',
    regressed: false,
    escalating: false,
  }) as const;
const command = (intent: Intent, expectedControlVersion?: number) => ({
  requestId: randomUUID(),
  intent,
  expectedControlVersion,
});
const path = virtualPath('src/value.ts');
const hash = (value: string) => sha256(createHash('sha256').update(value).digest('hex'));
const offline = () => ({
  repositoryId: repositoryId('11111111-1111-4111-8111-111111111111'),
  regressionDirectory: virtualPath('regression'),
  baseline: [{ virtualPath: path, bytes: Buffer.from('literal A\n') }],
});
const call = (kind: Check['kind'] = 'browser') =>
  fauxAssistantMessage(fauxToolCall('run_check', { kind }), { stopReason: 'toolUse' });
const receipt = (kind: Check['kind']): CheckExecution => ({
  type: 'completed',
  check: {
    kind,
    candidate: 'a'.repeat(40),
    configuration: 'b'.repeat(64),
    passed: true,
    simulated: true,
    outputs: [],
  },
});
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10000;
  while (true) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline) assert.fail(`Timed out ${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
function rows(directory: string, table: 'workspace_bindings' | 'action_sources') {
  const db = new DatabaseSync(join(directory, 'catalogue.sqlite'), { readOnly: true });
  try {
    return db
      .prepare(`SELECT * FROM ${table}`)
      .all()
      .map((r) => ({
        action_id: String(r.action_id),
        case_id: String(r.case_id),
        value: JSON.parse(String(r.value)),
      }));
  } finally {
    db.close();
  }
}
async function fixture(
  t: test.TestContext,
  extra: Partial<Parameters<typeof Controller.open>[0]> = {},
  implementation = false,
) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-controller-workspace-')));
  let controller: Controller;
  let closed = false;
  const providers = new Map<string, ReturnType<typeof fauxProvider>>();
  const options = {
    directory,
    policy,
    offlineWorkspace: offline(),
    providerForCase: (id: string) => {
      const faux = fauxProvider({ tokensPerSecond: 100000 });
      const respond: FauxResponseStep = async () => {
        const view = (await controller.snapshot({ selected: id })).selected!;
        const c = view.case;
        if (!implementation) return call();
        if (c.phase === 'triage' || (c.phase === 'investigation' && c.base))
          return fauxAssistantMessage(
            fauxToolCall('complete_assessment', {
              phase: c.phase,
              expectedControlVersion: c.version,
              conclusion: 'progress',
              reason: 'Synthetic offline progression',
              evidenceIds: view.checks.map((c) => c.id),
              proposal: 'Change synthetic value',
              paths: ['src/value.ts'],
            }),
            { stopReason: 'toolUse' },
          );
        return call(c.phase === 'investigation' ? 'baseline' : 'browser');
      };
      faux.setResponses(Array.from({ length: 30 }, () => respond));
      providers.set(id, faux);
      return { provider: faux.provider, modelId: faux.getModel().id };
    },
    ...extra,
  };
  controller = await Controller.open(options);
  t.after(async () => {
    if (!closed) await controller.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    get controller() {
      return controller;
    },
    directory,
    options,
    providers,
    async close() {
      closed = true;
      await controller.close();
    },
    async reopen() {
      controller = await Controller.open(options);
      closed = false;
    },
    async add(id = 'offline') {
      return (await controller.command(command({ type: 'investigate', issue: issue(id) }))).caseId!;
    },
    async current(id: string) {
      return (await controller.snapshot()).cases.find((c) => c.id === id)!;
    },
    async parked(id: string, status: Case['status'] = 'needs-attention') {
      return until(
        async () => (await controller.snapshot()).cases.find((c) => c.id === id)!,
        (c) => c.status === status,
      );
    },
  };
}

test('unconfigured callbacks still receive exactly one argument and simulated receipts', async (t) => {
  let arity = 0;
  const f = await fixture(t, {
    offlineWorkspace: undefined,
    check: async function (request) {
      arity = arguments.length;
      return receipt(request.kind);
    },
    providerForCase: () => {
      const faux = fauxProvider({ tokensPerSecond: 100000 });
      faux.setResponses([call(), fauxAssistantMessage('Done')]);
      return { provider: faux.provider, modelId: faux.getModel().id };
    },
  });
  const id = await f.add();
  await f.parked(id);
  assert.equal(arity, 1);
  assert.equal((await f.controller.snapshot({ selected: id })).selected!.checks[0].simulated, true);
  assert.equal(rows(f.directory, 'workspace_bindings').length, 0);
});

test('public implementation selects A, edits isolated B, reads A, and Retry selects B under fresh authority', async (t) => {
  const selected: { request: AdmittedCheckRequest; source: OfflineActionWorkspace }[] = [];
  let editCase = '';
  const finish = gate();
  const entered = gate();
  t.after(() => finish.resolve());
  const observations: string[] = [];
  const f = await fixture(
    t,
    {
      capacity: 2,
      check: async (request, source) => {
        assert(source);
        const phase = (await f.controller.snapshot()).cases.find(
          (c) => c.id === request.caseId,
        )!.phase;
        if (phase === 'investigation') {
          await assert.rejects(
            source.edit(source.selection.revision, {
              virtualPath: path,
              expectedHash: hash('literal A\n'),
              bytes: Buffer.from('forbidden'),
            }),
            { code: 'workspace-edit-phase-denied' },
          );
          return receipt(request.kind);
        }
        selected.push({ request, source });
        if (!editCase) editCase = request.caseId;
        const bytes = (await source.readSelected())[0].bytes;
        observations.push(Buffer.from(bytes).toString());
        assert.equal(Object.isFrozen(source), true);
        assert.equal(Object.isFrozen(source.selection), true);
        assert.equal(Reflect.set(source.selection, 'revision', '0'.repeat(40)), false);
        if (
          request.caseId === editCase &&
          observations.filter((s) => s === 'literal B\n').length === 0
        ) {
          await assert.rejects(
            source.edit(gitRevision('0'.repeat(40)), {
              virtualPath: path,
              expectedHash: hash('literal A\n'),
              bytes: Buffer.from('wrong'),
            }),
            { code: 'workspace-stale-checkpoint' },
          );
          await assert.rejects(
            source.edit(source.selection.revision, {
              virtualPath: path,
              expectedHash: hash('wrong'),
              bytes: Buffer.from('wrong'),
            }),
            { code: 'workspace-stale-hash' },
          );
          await assert.rejects(
            source.edit(source.selection.revision, {
              virtualPath: virtualPath('package.json'),
              expectedHash: null,
              bytes: Buffer.from('{}'),
            }),
            { code: 'workspace-protected-path' },
          );
          const input = {
            virtualPath: path,
            expectedHash: hash('literal A\n'),
            bytes: Buffer.from('literal B\n'),
          };
          const editing = source.edit(source.selection.revision, input);
          input.bytes.fill(120);
          const saved = await editing;
          assert.notEqual(saved.checkpoint.revision, source.selection.revision);
          assert.equal(
            Buffer.from((await source.readSelected())[0].bytes).toString(),
            'literal A\n',
          );
        }
        if (selected.length === 2) entered.resolve();
        if (selected.length <= 2) await finish.promise;
        return { type: 'infrastructure' };
      },
    },
    true,
  );
  const a = await f.add('A');
  const b = await f.add('B');
  await entered.promise;
  assert.deepEqual(observations, ['literal A\n', 'literal A\n']);
  assert.equal(await f.add('A'), a);
  assert.equal(rows(f.directory, 'workspace_bindings').length, 2);
  finish.resolve();
  await f.parked(a);
  await f.parked(b);
  for (const { source } of selected)
    await assert.rejects(source.readSelected(), { code: 'action-source-revoked' });
  const old = selected.find((s) => s.request.caseId === editCase)!;
  const state = await f.current(editCase!);
  await f.controller.command(
    command({ type: 'retry', caseId: editCase!, note: 'Fresh bounded check' }, state.version),
  );
  await f.parked(editCase!);
  assert.equal(observations.at(-1), 'literal B\n');
  const fresh = selected.at(-1)!;
  assert.notEqual(fresh.request.actionId, old.request.actionId);
  assert.ok(fresh.request.epoch > old.request.epoch);
  await assert.rejects(
    old.source.edit(old.source.selection.revision, {
      virtualPath: path,
      expectedHash: hash('literal A\n'),
      bytes: Buffer.from('late'),
    }),
    { code: 'action-source-revoked' },
  );
  const history = rows(f.directory, 'action_sources').find(
    (r) => r.action_id === old.request.actionId,
  )!;
  assert.deepEqual(history.value.action, {
    ...history.value.action,
    id: old.request.actionId,
    caseId: editCase,
    epoch: old.request.epoch,
  });
  assert.deepEqual(history.value.frozen, old.source.selection);
  assert.equal(history.value.state, 'interrupted');
  const calls = selected.length;
  await f.close();
  await f.reopen();
  assert.equal((await f.current(editCase!)).status, 'needs-attention');
  assert.equal((await f.current(editCase!)).native, 'ready');
  assert.equal(selected.length, calls);
  assert.deepEqual(
    rows(f.directory, 'action_sources').find((r) => r.action_id === old.request.actionId)!.value
      .frozen,
    old.source.selection,
  );
  await f.close();
  const store = await WorkspaceStore.open({
    directory: join(f.directory, 'workspaces'),
    regressionDirectory: offline().regressionDirectory,
  });
  try {
    assert.equal(
      Buffer.from(
        (await store.readFrozen(old.source.selection, new AbortController().signal))[0].bytes,
      ).toString(),
      'literal A\n',
    );
    assert.equal(
      Buffer.from((await store.read(caseId(editCase!), path)).bytes).toString(),
      'literal B\n',
    );
    assert.equal(
      Buffer.from((await store.read(caseId(editCase === a ? b : a), path)).bytes).toString(),
      'literal A\n',
    );
  } finally {
    await store.close();
  }
});

test('callback completion revokes handles before native settlement, and frozen metadata is detached', async (t) => {
  let captured: OfflineActionWorkspace;
  let revokedAtReceipt: Promise<void>;
  const f = await fixture(t, {
    check: async (_request, source) => {
      captured = source!;
      const files = await source!.readSelected();
      files[0].bytes.fill(120);
      assert.equal(Buffer.from((await source!.readSelected())[0].bytes).toString(), 'literal A\n');
      return receipt('browser');
    },
    fault: (point) => {
      if (point === 'after-check-receipt') {
        revokedAtReceipt = assert.rejects(captured.readSelected(), {
          code: 'action-source-revoked',
        });
      }
    },
    providerForCase: () => {
      const faux = fauxProvider({ tokensPerSecond: 100000 });
      faux.setResponses([call(), fauxAssistantMessage('Done')]);
      return { provider: faux.provider, modelId: faux.getModel().id };
    },
  });
  const id = await f.add();
  await f.parked(id);
  await revokedAtReceipt!;
  assert.equal(rows(f.directory, 'action_sources')[0].value.state, 'settled');
  await assert.rejects(captured!.readSelected(), { code: 'action-source-revoked' });
  await f.close();
  await assert.rejects(captured!.readSelected(), { code: 'controller-closed' });
});

for (const mode of ['pause', 'cancel'] as const)
  test(`live source handles reject after ${mode} and cannot revive on Continue or Retry`, async (t) => {
    const entered = gate(),
      release = gate();
    t.after(() => release.resolve());
    let captured: OfflineActionWorkspace;
    let now = 1000;
    const f = await fixture(t, {
      clock: () => now,
      check: async (request, source) => {
        captured = source!;
        entered.resolve();
        await release.promise;
        return receipt(request.kind);
      },
      providerForCase: () => {
        const faux = fauxProvider({ tokensPerSecond: 100000 });
        faux.setResponses([call(), fauxAssistantMessage('Stopped')]);
        return { provider: faux.provider, modelId: faux.getModel().id };
      },
    });
    const id = await f.add();
    await entered.promise;
    if (mode === 'pause') {
      await f.controller.command(command({ type: 'pause', caseId: id }));
      await assert.rejects(captured!.readSelected(), { code: 'check-dispatch-denied' });
    } else {
      now += 60001;
      await assert.rejects(captured!.readSelected(), { code: 'check-allowance-exhausted' });
    }
    release.resolve();
    const c = await f.parked(id, mode === 'pause' ? 'paused' : 'needs-attention');
    await f.controller.command(
      command(
        mode === 'pause'
          ? { type: 'continue', caseId: id }
          : { type: 'retry', caseId: id, note: 'New bounded attempt' },
        c.version,
      ),
    );
    await f.parked(id);
    await assert.rejects(captured!.readSelected(), { code: 'action-source-revoked' });
    assert.equal(
      (await f.controller.snapshot({ selected: id })).selected!.checks.length,
      mode === 'pause' ? 1 : 0,
    );
  });

test('pause and close drain an admitted edit without authorizing a late operation', async (t) => {
  const entered = gate(),
    release = gate(),
    observed = gate();
  t.after(() => release.resolve());
  let captured: OfflineActionWorkspace;
  let editError: unknown;
  const f = await fixture(
    t,
    {
      fault: async (point) => {
        if (point === 'workspace-after-intent') {
          entered.resolve();
          await release.promise;
        }
      },
      check: async (request, source) => {
        if (request.kind === 'baseline') return receipt(request.kind);
        captured = source!;
        try {
          await source!.edit(source!.selection.revision, {
            virtualPath: path,
            expectedHash: hash('literal A\n'),
            bytes: Buffer.from('literal B\n'),
          });
        } catch (error) {
          editError = error;
        }
        observed.resolve();
        return receipt(request.kind);
      },
    },
    true,
  );
  const id = await f.add();
  await entered.promise;
  const pausing = f.controller.command(command({ type: 'pause', caseId: id }));
  await until(
    () => f.current(id),
    (c) => c.status === 'pause-requested',
  );
  let closed = false;
  const closing = f.close().then(() => {
    closed = true;
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(closed, false);
  await assert.rejects(captured!.readSelected(), { code: 'controller-closed' });
  release.resolve();
  await closing;
  await pausing;
  await observed.promise;
  assert.equal((editError as { code: string }).code, 'check-dispatch-denied');
  await f.reopen();
  assert.equal((await f.current(id)).status, 'paused');
  assert.equal((await f.current(id)).native, 'ready');
  await f.close();
  const store = await WorkspaceStore.open({
    directory: join(f.directory, 'workspaces'),
    regressionDirectory: offline().regressionDirectory,
  });
  try {
    assert.equal(Buffer.from((await store.read(caseId(id), path)).bytes).toString(), 'literal B\n');
  } finally {
    await store.close();
  }
});

test('post-native-close injected failure still releases real workspace and controller ownership', async (t) => {
  const f = await fixture(t, { check: async () => ({ type: 'infrastructure' }) });
  const id = await f.add();
  await f.parked(id);
  const original = NativeCase.prototype.close;
  const mock = t.mock.method(NativeCase.prototype, 'close', async function (this: NativeCase) {
    await original.call(this);
    throw new Error('Injected post-native-close failure');
  });
  try {
    await assert.rejects(f.close(), { code: 'native-close-failed' });
  } finally {
    mock.mock.restore();
  }
  await f.reopen();
  assert.equal((await f.current(id)).native, 'ready');
  assert.equal((await f.current(id)).status, 'needs-attention');
});

test('duplicate admission retains its binding and terminal Requeue creates a distinct workspace', async (t) => {
  const f = await fixture(t, { check: async () => ({ type: 'infrastructure' }) });
  const first = await f.add();
  await f.parked(first);
  const original = rows(f.directory, 'workspace_bindings')[0];
  assert.equal(await f.add(), first);
  assert.deepEqual(rows(f.directory, 'workspace_bindings'), [original]);
  const c = await f.current(first);
  await f.controller.command(
    command({ type: 'dismiss', caseId: first, note: 'End synthetic attempt' }, c.version),
  );
  const terminal = await f.current(first);
  const next = await f.controller.command(
    command({ type: 'requeue', caseId: first, note: 'New synthetic attempt' }, terminal.version),
  );
  await f.parked(next.caseId!);
  assert.notEqual(next.caseId, first);
  assert.equal((await f.current(next.caseId!)).previousId, first);
  assert.deepEqual(
    rows(f.directory, 'workspace_bindings').map((r) => [r.case_id, r.value.state]),
    [
      [first, 'ready'],
      [next.caseId, 'ready'],
    ],
  );
});

test('offline mode cannot silently downgrade, migrate scripted cases, or change configuration', async (t) => {
  const f = await fixture(t, { check: async () => ({ type: 'infrastructure' }) });
  const id = await f.add();
  await f.parked(id);
  await f.close();
  await assert.rejects(Controller.open({ ...f.options, offlineWorkspace: undefined }), {
    code: 'offline-workspace-required',
  });
  await assert.rejects(
    Controller.open({
      ...f.options,
      offlineWorkspace: {
        ...offline(),
        baseline: [{ virtualPath: path, bytes: Buffer.from('different') }],
      },
    }),
    { code: 'offline-workspace-configuration-mismatch' },
  );
  await f.reopen();
  assert.equal((await f.current(id)).native, 'ready');
  const scripted = await fixture(t, {
    offlineWorkspace: undefined,
    check: async () => ({ type: 'infrastructure' }),
  });
  const sid = await scripted.add();
  await scripted.parked(sid);
  await scripted.close();
  await assert.rejects(Controller.open({ ...scripted.options, offlineWorkspace: offline() }), {
    code: 'offline-workspace-migration-required',
  });
});

for (const mode of ['missing', 'empty', 'tampered'] as const)
  test(`established ${mode} workspace store is never recreated and failed open releases ownership`, async (t) => {
    const f = await fixture(t, { check: async () => ({ type: 'infrastructure' }) });
    const id = await f.add();
    await f.parked(id);
    await f.close();
    const root = join(f.directory, 'workspaces');
    if (mode === 'missing') await rm(root, { recursive: true });
    else if (mode === 'empty')
      for (const name of await readdir(root)) await rm(join(root, name), { recursive: true });
    else await writeFile(join(root, 'workspace-owner'), '{}');
    await assert.rejects(Controller.open(f.options));
    await assert.rejects(Controller.open(f.options));
    if (mode === 'missing') await assert.rejects(lstat(root), { code: 'ENOENT' });
    else if (mode === 'empty') assert.deepEqual(await readdir(root), []);
    else assert.equal(await readFile(join(root, 'workspace-owner'), 'utf8'), '{}');
  });

for (const mode of [
  'foreign-frozen',
  'foreign-binding',
  'invalid-epoch',
  'unrecorded-frozen',
] as const)
  test(`${mode} association parks without marking healthy native storage missing`, async (t) => {
    let count = 0;
    const f = await fixture(t, {
      check: async () => {
        count++;
        return { type: 'infrastructure' };
      },
    });
    const id = await f.add();
    await f.parked(id);
    await f.close();
    const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
    try {
      const table = mode === 'foreign-binding' ? 'workspace_bindings' : 'action_sources';
      const row = db.prepare(`SELECT value FROM ${table}`).get()!;
      const value = JSON.parse(String(row.value));
      if (mode === 'foreign-frozen') value.frozen.caseId = randomUUID();
      if (mode === 'foreign-binding') value.repositoryId = randomUUID();
      if (mode === 'invalid-epoch') value.action.epoch += 100;
      if (mode === 'unrecorded-frozen') value.frozen.revision = '0'.repeat(40);
      db.prepare(`UPDATE ${table} SET value=?`).run(JSON.stringify(value));
    } finally {
      db.close();
    }
    await f.reopen();
    const c = await f.current(id);
    assert.equal(c.native, 'ready');
    assert.equal(c.status, 'needs-attention');
    assert.equal(rows(f.directory, 'workspace_bindings')[0].value.state, 'uncertain');
    await assert.rejects(
      f.controller.command(
        command({ type: 'retry', caseId: id, note: 'Must not repair storage' }, c.version),
      ),
      { code: 'cannot-retry' },
    );
    assert.equal(count, 1);
  });

test('real allowance cancellation revokes a callback that has not returned', async (t) => {
  const entered = gate(),
    release = gate();
  t.after(() => release.resolve());
  let captured: OfflineActionWorkspace;
  let request: AdmittedCheckRequest;
  const f = await fixture(t, {
    allowanceMs: 2000,
    clock: () => 1000,
    check: async (input, source) => {
      captured = source!;
      request = input;
      entered.resolve();
      await release.promise;
      return receipt(input.kind);
    },
  });
  const id = await f.add();
  await entered.promise;
  const c = await f.parked(id);
  assert.equal(request!.signal.aborted, true);
  assert.equal(c.reason, 'check-allowance-exhausted');
  await assert.rejects(captured!.readSelected(), { code: 'action-source-revoked' });
  assert.equal((await f.controller.snapshot({ selected: id })).selected!.checks.length, 0);
  release.resolve();
});

for (const mode of ['foreign', 'stale'] as const)
  test(`${mode} persisted action cannot select offline source or enter callback`, async (t) => {
    let callbacks = 0;
    const f = await fixture(t, {
      check: async () => {
        callbacks++;
        return { type: 'infrastructure' };
      },
      fault: (point) => {
        if (point !== 'before-check-dispatch') return;
        const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
        try {
          const row = db.prepare('SELECT value FROM actions').get()!;
          const action = JSON.parse(String(row.value));
          if (mode === 'foreign') action.caseId = randomUUID();
          else action.epoch++;
          db.prepare('UPDATE actions SET value=?').run(JSON.stringify(action));
        } finally {
          db.close();
        }
      },
    });
    const id = await f.add();
    const c = await f.parked(id);
    assert.equal(c.reason, 'check-dispatch-denied');
    assert.equal(c.native, 'ready');
    assert.equal(callbacks, 0);
    assert.equal(rows(f.directory, 'action_sources').length, 0);
    assert.equal(rows(f.directory, 'workspace_bindings')[0].value.state, 'ready');
  });

test('baseline is copied before Controller.open first awaits', async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-baseline-copy-')));
  const config = offline();
  const faux = fauxProvider({ tokensPerSecond: 100000 });
  faux.setResponses([call()]);
  let bytes = '';
  const options = {
    directory,
    policy,
    offlineWorkspace: config,
    providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
    check: async (
      _request: AdmittedCheckRequest,
      source?: OfflineActionWorkspace,
    ): Promise<CheckExecution> => {
      bytes = Buffer.from((await source!.readSelected())[0].bytes).toString();
      return { type: 'infrastructure' };
    },
  };
  const opening = Controller.open(options);
  config.baseline[0].bytes.fill(120);
  const controller = await opening;
  t.after(async () => {
    await controller.close();
    await rm(directory, { recursive: true, force: true });
  });
  const result = await controller.command(command({ type: 'investigate', issue: issue() }));
  await until(
    async () => (await controller.snapshot()).cases[0],
    (c) => c.status === 'needs-attention',
  );
  assert.equal(bytes, 'literal A\n');
  assert.equal(result.caseId, (await controller.snapshot()).cases[0].id);
});

const crashPoints = [
  'after-command-commit',
  'after-workspace-provision-intent',
  'workspace-after-provision-intent',
  'workspace-after-provision-worktree',
  'after-workspace-provision-effect',
  'before-check-dispatch',
  'after-source-selection-intent',
  'after-source-freeze',
  'after-source-selection-receipt',
  'workspace-after-intent',
  'workspace-after-commit',
  'workspace-after-checkpoint',
  'after-source-edit-effect',
  'after-check-receipt',
  'after-tool-action-receipt',
];
for (const point of crashPoints)
  test(
    `SIGKILL ${point} preserves intent/effect/receipt without source or edit replay`,
    { timeout: 20000 },
    async (t) => {
      const directory = await realpath(
        await mkdtemp(join(tmpdir(), 'eitri-controller-workspace-kill-')),
      );
      const child = fork(
        new URL('./controller-workspace-crash-worker.ts', import.meta.url),
        [directory, point],
        {
          env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        },
      );
      let errors = '';
      child.stderr!.on('data', (chunk) => {
        errors += chunk.toString();
      });
      let controller: Controller | undefined;
      t.after(async () => {
        child.kill('SIGKILL');
        await controller?.close();
        await rm(directory, { recursive: true, force: true });
      });
      const message = await Promise.race([
        once(child, 'message').then(([m]) => m as { id: string; point: string; callbacks: number }),
        once(child, 'exit').then(() => {
          throw new Error(`Child exited early ${errors}`);
        }),
      ]);
      assert.equal(message.point, point);
      const exit = once(child, 'exit');
      child.kill('SIGKILL');
      await exit;
      const before = rows(directory, 'action_sources');
      const faux = fauxProvider({ tokensPerSecond: 100000 });
      faux.setResponses([fauxAssistantMessage('No replay')]);
      let callbacks = 0;
      controller = await Controller.open({
        directory,
        policy,
        offlineWorkspace: offline(),
        providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
        check: async () => {
          callbacks++;
          return { type: 'infrastructure' };
        },
      });
      const c = await until(
        async () => (await controller!.snapshot()).cases[0],
        (c) => c.status === 'needs-attention',
      );
      assert.equal(c.id, message.id);
      assert.equal(c.native, 'ready');
      assert.equal(callbacks, 0);
      const binding = rows(directory, 'workspace_bindings')[0].value;
      const uncertain = [
        'after-workspace-provision-intent',
        'workspace-after-provision-intent',
        'workspace-after-provision-worktree',
        'workspace-after-intent',
        'workspace-after-commit',
      ].includes(point);
      assert.equal(binding.state, uncertain ? 'uncertain' : 'ready');
      const after = rows(directory, 'action_sources');
      for (const row of before) {
        const recovered = after.find((r) => r.action_id === row.action_id)!.value;
        assert.deepEqual(recovered.action, row.value.action);
        if (row.value.frozen) assert.deepEqual(recovered.frozen, row.value.frozen);
        if (row.value.state === 'selected' || row.value.state === 'selecting')
          assert.equal(recovered.state, 'interrupted');
      }
      if (['after-source-selection-intent', 'after-source-freeze'].includes(point))
        assert.equal(after.at(-1)!.value.frozen, null);
      if (
        [
          'after-source-selection-receipt',
          'after-source-freeze',
          'after-source-selection-intent',
          'before-check-dispatch',
        ].includes(point)
      )
        assert.equal(message.callbacks, 0);
      if (point.startsWith('workspace-after-') && !point.includes('provision'))
        assert.equal(message.callbacks, 2);
      if (point === 'after-tool-action-receipt')
        assert.equal(c.reason, 'incomplete-native-tool-checkpoint');
      if (point === 'after-source-edit-effect' || point === 'workspace-after-checkpoint') {
        await controller.close();
        controller = undefined;
        const store = await WorkspaceStore.open({
          directory: join(directory, 'workspaces'),
          regressionDirectory: offline().regressionDirectory,
        });
        try {
          const frozen = after.at(-1)!.value.frozen as FrozenRevision;
          assert.equal(
            Buffer.from(
              (await store.readFrozen(frozen, new AbortController().signal))[0].bytes,
            ).toString(),
            'literal A\n',
          );
          assert.equal(
            Buffer.from((await store.read(caseId(c.id), path)).bytes).toString(),
            'literal B\n',
          );
          assert.equal((await store.inspect(caseId(c.id))).state, 'ready');
        } finally {
          await store.close();
        }
      }
    },
  );
