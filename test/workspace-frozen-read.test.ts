import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  realpath,
  rm,
  readdir,
  lstat,
  readFile,
  writeFile,
  chmod,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { ChildProcess } from 'node:child_process';
import { channel } from 'node:diagnostics_channel';
import { DatabaseSync } from 'node:sqlite';
import { digest } from '../src/domain.ts';
import {
  WorkspaceStore,
  caseId,
  repositoryId,
  requestId,
  virtualPath,
  gitRevision,
  sha256,
} from '../src/workspace.ts';
import type { BaselineFile, WorkspaceFaultPoint } from '../src/workspace.ts';

const path = virtualPath('src/main.ts');
const regressionDirectory = virtualPath('test/regression');
const baseline: BaselineFile[] = [
  { virtualPath: path, bytes: Buffer.from('A\r\n$literal\0bytes') },
  { virtualPath: virtualPath('test/baseline.test.ts'), bytes: Buffer.from('protected\n') },
];

async function fixture(
  t: TestContext,
  fault?: (point: WorkspaceFaultPoint) => void | Promise<void>,
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'eitri-frozen-read-')));
  const store = await WorkspaceStore.open({ directory: root, regressionDirectory, fault });
  t.after(async () => {
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  const id = caseId(randomUUID());
  const repo = repositoryId(randomUUID());
  const workspace = await store.provision({ caseId: id, repositoryId: repo, baseline });
  assert.equal(workspace.state, 'ready');
  if (workspace.state !== 'ready') throw new Error('not ready');
  return {
    root,
    store,
    id,
    workspace,
    repository: join(root, 'repositories', `${repo}.git`),
  };
}

async function inventory(root: string, prefix = ''): Promise<unknown[]> {
  const nodes: unknown[] = [];
  for (const name of (await readdir(join(root, prefix))).sort()) {
    const relative = prefix ? `${prefix}/${name}` : name;
    const node = join(root, relative);
    const stat = await lstat(node);
    nodes.push({
      path: relative,
      mode: stat.mode,
      ino: stat.ino,
      dev: stat.dev,
      hash: stat.isDirectory()
        ? null
        : createHash('sha256')
            .update(await readFile(node))
            .digest('hex'),
    });
    if (stat.isDirectory()) nodes.push(...(await inventory(root, relative)));
  }
  return nodes;
}

const contents = (files: readonly BaselineFile[]) =>
  files.map((f) => ({ virtualPath: f.virtualPath, bytes: Buffer.from(f.bytes).toString() }));
const expected = [
  { virtualPath: 'src/main.ts', bytes: 'A\r\n$literal\0bytes' },
  { virtualPath: 'test/baseline.test.ts', bytes: 'protected\n' },
];
const signal = () => new AbortController().signal;

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function observeReads(t: TestContext, observe: (child: ChildProcess) => void) {
  const reads = channel('child_process');
  const listener = (message: unknown) => {
    if (
      !message ||
      typeof message !== 'object' ||
      !('process' in message) ||
      !(message.process instanceof ChildProcess)
    )
      throw new Error('invalid child process diagnostic');
    const child = message.process;
    child.once('spawn', () => {
      if (child.spawnfile === '/usr/bin/git' && child.spawnargs.includes('cat-file'))
        observe(child);
    });
  };
  reads.subscribe(listener);
  t.after(() => reads.unsubscribe(listener));
}

test('readFrozen returns literal A after B with fresh buffers and no store writes or exports', async (t) => {
  const f = await fixture(t);
  const frozen = await f.store.freeze(f.id, f.workspace.checkpoint.revision);
  const initial = await f.store.read(f.id, path);
  const saved = await f.store.edit(f.id, f.workspace.checkpoint.revision, {
    requestId: requestId(randomUUID()),
    virtualPath: path,
    expectedHash: initial.sha256,
    bytes: Buffer.from('B\n'),
  });
  const before = await inventory(f.root);
  const files = await f.store.readFrozen(frozen, signal());
  assert.deepEqual(contents(files), expected);
  files[0]!.bytes.fill(0);
  Reflect.apply(Array.prototype.splice, files, [0, files.length]);
  assert.deepEqual(contents(await f.store.readFrozen(frozen, signal())), expected);
  assert.equal(await readFile(join(f.root, 'cases', f.id, path), 'utf8'), 'B\n');
  assert.equal(
    await readFile(join(f.repository, 'refs/heads/cases', f.id), 'utf8'),
    `${saved.checkpoint.revision}\n`,
  );
  assert.deepEqual(await readdir(join(f.root, 'exports')), []);
  assert.deepEqual(await inventory(f.root), before);
  await f.store.close();
  const reopened = await WorkspaceStore.open({ directory: f.root, regressionDirectory });
  t.after(() => reopened.close());
  const reopenedBefore = await inventory(f.root);
  assert.deepEqual(contents(await reopened.readFrozen(frozen, signal())), expected);
  assert.deepEqual(await inventory(f.root), reopenedBefore);
});

test('readFrozen rejects unrecorded, foreign, forged and extra frozen fields without writes', async (t) => {
  const f = await fixture(t);
  const neverFrozen = {
    caseId: f.id,
    revision: f.workspace.checkpoint.revision,
    manifestDigest: f.workspace.checkpoint.manifestDigest,
  };
  const before = await inventory(f.root);
  await assert.rejects(f.store.readFrozen(neverFrozen, signal()), /workspace-revision-not-frozen/);
  assert.deepEqual(await inventory(f.root), before);
  const frozen = await f.store.freeze(f.id, f.workspace.checkpoint.revision);
  const foreign = await fixture(t);
  const foreignFrozen = await foreign.store.freeze(
    foreign.id,
    foreign.workspace.checkpoint.revision,
  );
  const recorded = await inventory(f.root);
  for (const input of [
    foreignFrozen,
    { ...frozen, caseId: caseId(randomUUID()) },
    { ...frozen, revision: gitRevision('1'.repeat(40)) },
    { ...frozen, manifestDigest: sha256('1'.repeat(64)) },
  ])
    await assert.rejects(f.store.readFrozen(input, signal()), /workspace-revision-not-frozen/);
  const extra = { ...frozen, extra: 'not permitted' };
  await assert.rejects(f.store.readFrozen(extra, signal()), /invalid-workspace-fields/);
  for (const malformed of [
    null,
    [],
    { ...frozen, caseId: '../case' },
    { ...frozen, revision: 'HEAD' },
    { ...frozen, manifestDigest: 'bad digest' },
    { caseId: frozen.caseId, revision: frozen.revision },
  ])
    await assert.rejects(Reflect.apply(f.store.readFrozen, f.store, [malformed, signal()]));
  assert.deepEqual(contents(await f.store.readFrozen(frozen, signal())), expected);
  assert.deepEqual(await inventory(f.root), recorded);
});

test(
  'readFrozen already-aborted and queued cancellation reject before the owner is released',
  { timeout: 10000 },
  async (t) => {
    const entered = gate();
    const release = gate();
    t.after(() => release.release());
    const f = await fixture(t, async (point) => {
      if (point === 'after-checkpoint') {
        entered.release();
        await release.promise;
      }
    });
    const frozen = await f.store.freeze(f.id, f.workspace.checkpoint.revision);
    const initial = await f.store.read(f.id, path);
    const edit = f.store.edit(f.id, f.workspace.checkpoint.revision, {
      requestId: requestId(randomUUID()),
      virtualPath: path,
      expectedHash: initial.sha256,
      bytes: Buffer.from('B'),
    });
    await entered.promise;
    const before = await inventory(f.root);
    const aborted = new AbortController();
    const reason = new Error('cancel queued frozen read');
    aborted.abort(reason);
    await assert.rejects(f.store.readFrozen(frozen, aborted.signal), (e) => e === reason);
    const queued = new AbortController();
    const read = f.store.readFrozen(frozen, queued.signal);
    queued.abort(reason);
    await assert.rejects(read, (e) => e === reason);
    assert.deepEqual(await inventory(f.root), before);
    release.release();
    await edit;
    assert.deepEqual(contents(await f.store.readFrozen(frozen, signal())), expected);
    assert.deepEqual(await inventory(f.root), before);
  },
);

test(
  'readFrozen kills a spawned real Git read and waits for close before cancellation settles',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    const frozen = await f.store.freeze(f.id, f.workspace.checkpoint.revision);
    const before = await inventory(f.root);
    const controller = new AbortController();
    const reason = new Error('cancel running frozen read');
    let spawned = 0;
    let closed = false;
    let pid: number | undefined;
    observeReads(t, (child) => {
      spawned++;
      pid = child.pid;
      assert.equal(child.exitCode, null);
      assert.equal(child.kill('SIGSTOP'), true);
      child.once('close', (_code, killedBy) => {
        assert.equal(killedBy, 'SIGKILL');
        closed = true;
      });
      controller.abort(reason);
    });
    await assert.rejects(f.store.readFrozen(frozen, controller.signal), (e) => e === reason);
    assert.equal(spawned, 1);
    assert.equal(closed, true);
    assert.equal(typeof pid, 'number');
    const exitedPid = pid;
    if (exitedPid === undefined) throw new Error('no spawned Git process');
    assert.throws(() => process.kill(exitedPid, 0), { code: 'ESRCH' });
    assert.deepEqual(await inventory(f.root), before);
  },
);

test('readFrozen cancellation between Git stages returns no partial files and leaves the owner usable', async (t) => {
  const f = await fixture(t);
  const frozen = await f.store.freeze(f.id, f.workspace.checkpoint.revision);
  const before = await inventory(f.root);
  const controller = new AbortController();
  const reason = new Error('cancel between frozen read stages');
  let reads = 0;
  observeReads(t, (child) => {
    reads++;
    if (!controller.signal.aborted) child.once('close', () => controller.abort(reason));
  });
  await assert.rejects(f.store.readFrozen(frozen, controller.signal), (e) => e === reason);
  assert.equal(reads, 1);
  assert.deepEqual(contents(await f.store.readFrozen(frozen, signal())), expected);
  assert.deepEqual(await inventory(f.root), before);
});

for (const damage of ['config', 'object', 'mode', 'pointer'] as const)
  test(`readFrozen rejects corrupt ${damage} without changing source, refs, journal or exports`, async (t) => {
    const f = await fixture(t);
    const frozen = await f.store.freeze(f.id, f.workspace.checkpoint.revision);
    if (damage === 'config')
      await writeFile(join(f.repository, 'config'), '[include]\npath=/unowned\n');
    if (damage === 'object') {
      const oid = createHash('sha1')
        .update(`blob ${baseline[0]!.bytes.length}\0`)
        .update(baseline[0]!.bytes)
        .digest('hex');
      await writeFile(
        join(f.repository, 'objects', oid.slice(0, 2), oid.slice(2)),
        'corrupt object',
      );
    }
    if (damage === 'mode') await chmod(join(f.repository, 'config'), 0o644);
    if (damage === 'pointer')
      await writeFile(join(f.root, 'cases', f.id, '.git'), 'gitdir: /unowned\n');
    const before = await inventory(f.root);
    await assert.rejects(
      f.store.readFrozen(frozen, signal()),
      /workspace-(?:metadata-changed|pointer-changed)|unsafe-workspace-mode/,
    );
    assert.deepEqual(await inventory(f.root), before);
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function record(value: unknown) {
  assert.ok(isRecord(value));
  return value;
}

for (const damage of ['hash', 'size', 'file-limit', 'count-limit', 'aggregate-limit'] as const)
  test(`readFrozen fails closed on recorded ${damage} corruption in real SQLite`, async (t) => {
    const f = await fixture(t);
    let frozen = await f.store.freeze(f.id, f.workspace.checkpoint.revision);
    await f.store.close();
    const db = new DatabaseSync(join(f.root, 'journal.sqlite'));
    try {
      const body = db.prepare('SELECT body FROM journal WHERE id=1').get()?.body;
      assert.equal(typeof body, 'string');
      if (typeof body !== 'string') throw new Error('missing journal');
      const parsed: unknown = JSON.parse(body);
      const journal = record(parsed);
      assert.ok(Array.isArray(journal.frozen));
      const entry = record(journal.frozen[0]);
      assert.ok(Array.isArray(entry.files));
      const first = record(entry.files[0]);
      if (damage === 'hash') first.hash = '1'.repeat(64);
      if (damage === 'size') first.size = 1;
      if (damage === 'file-limit') first.size = 1024 * 1024 + 1;
      if (damage === 'count-limit')
        entry.files = Array.from({ length: 1025 }, (_, i) => ({ ...first, path: `src/${i}` }));
      if (damage === 'aggregate-limit')
        entry.files = Array.from({ length: 33 }, (_, i) => ({
          ...first,
          path: `src/${i}`,
          size: 1024 * 1024,
        }));
      assert.ok(Array.isArray(entry.files));
      const manifestDigest = digest(
        entry.files.map((file: unknown) => {
          const r = record(file);
          return { path: r.path, size: r.size, hash: r.hash, object: r.object, mode: '100644' };
        }),
      );
      frozen = { ...frozen, manifestDigest: sha256(manifestDigest) };
      record(entry.frozen).manifestDigest = manifestDigest;
      record(entry.checkpoint).manifestDigest = manifestDigest;
      db.prepare('UPDATE journal SET body=?, digest=? WHERE id=1').run(
        JSON.stringify(parsed),
        digest(parsed),
      );
    } finally {
      db.close();
    }
    if (damage.endsWith('limit')) {
      const before = await inventory(f.root);
      await assert.rejects(WorkspaceStore.open({ directory: f.root, regressionDirectory }));
      assert.deepEqual(await inventory(f.root), before);
    } else {
      const reopened = await WorkspaceStore.open({ directory: f.root, regressionDirectory });
      t.after(() => reopened.close());
      const before = await inventory(f.root);
      await assert.rejects(reopened.readFrozen(frozen, signal()), /workspace-blob-mismatch/);
      assert.deepEqual(await inventory(f.root), before);
    }
  });
