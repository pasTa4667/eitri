import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureProfileNameFixture } from '../src/fixture-profile-name.ts';
import { ControlError } from '../src/domain.ts';
import {
  caseId,
  repositoryId,
  virtualPath,
  WorkspaceStore,
  workspaceLimits,
} from '../src/workspace.ts';

const execute = promisify(execFile);
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const leaf = (root: string) => join(root, 'src/lib/errors.js');
async function temporary(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'eitri-fixture-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function fixture(t: TestContext, bytes: Uint8Array | string = 'abcdefgh') {
  const root = await temporary(t);
  await mkdir(join(root, 'src/lib'), { recursive: true });
  await writeFile(leaf(root), bytes, { mode: 0o644 });
  return root;
}
const rejects = (root: string, code: string) =>
  assert.rejects(captureProfileNameFixture(root), (error: unknown) => {
    assert.ok(error instanceof ControlError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  });

test('profile-name capture has the exact shape and pinned canonical digest', async (t) => {
  const root = await fixture(t, 'abc');
  const capture = await captureProfileNameFixture(root);
  assert.deepEqual(capture, {
    version: 1,
    scenarioId: 'profile-name-v1',
    provenance: { kind: 'uncommitted-copy' },
    source: {
      virtualPath: 'src/lib/errors.js',
      size: 3,
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      bytes: Buffer.from('abc'),
    },
    captureDigest: '9f71a3307089670ae83cfce26ccb5c379ad332c6335be892d8da579ab9ae3484',
  });
  const canonical =
    '{"provenance":{"kind":"uncommitted-copy"},"scenarioId":"profile-name-v1","source":{"sha256":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad","size":3,"virtualPath":"src/lib/errors.js"},"version":1}';
  assert.equal(hash(canonical), capture.captureDigest);
  await writeFile(leaf(root), 'abd');
  const changed = await captureProfileNameFixture(root);
  assert.equal(changed.source.sha256, hash('abd'));
  assert.notEqual(changed.captureDigest, capture.captureDigest);
});

test('profile-name capture preserves raw bytes, zero, one and exact-limit lengths', async (t) => {
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from([0]),
    Buffer.from([0xef, 0xbb, 0xbf, 13, 10, 0, 0xff, 32, 9, 10]),
    Buffer.alloc(workspaceLimits.fileBytes, 0xff),
  ]) {
    const root = await fixture(t, bytes);
    const capture = await captureProfileNameFixture(root);
    assert.ok(Buffer.isBuffer(capture.source.bytes));
    assert.deepEqual(capture.source.bytes, bytes);
    assert.equal(capture.source.size, bytes.length);
    assert.equal(capture.source.sha256, hash(bytes));
  }
  const root = await fixture(t);
  for (const size of [workspaceLimits.fileBytes + 1, 1024 * 1024 * 1024]) {
    await truncate(leaf(root), size);
    await rejects(root, 'fixture-size-limit');
  }
});

test('profile-name capture is detached, host-independent and never executes source', async (t) => {
  const root = await fixture(t);
  const sentinel = join(root, 'executed');
  const bytes = Buffer.from(
    `throw new Error('do not execute');\nrequire('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'bad');\n`,
  );
  await writeFile(leaf(root), bytes);
  const other = await fixture(t, bytes);
  await writeFile(join(other, 'unrelated'), 'unrelated');
  const a = await captureProfileNameFixture(root);
  const b = await captureProfileNameFixture(other);
  assert.deepEqual(a, b);
  await assert.rejects(stat(sentinel), { code: 'ENOENT' });
  await writeFile(leaf(root), 'replacement');
  assert.deepEqual(a.source.bytes, bytes);
  a.source.bytes.fill(0);
  assert.deepEqual(b.source.bytes, bytes);
  assert.deepEqual((await captureProfileNameFixture(other)).source.bytes, bytes);
});

test('profile-name capture rejects invalid and noncanonical selections', async () => {
  for (const root of [
    '',
    '.',
    'relative',
    '/tmp/../tmp',
    '//tmp',
    '/tmp/',
    '/a\0b',
    '/a\nb',
    '/\ud800',
    `/${'a'.repeat(4096)}`,
  ])
    await rejects(root, 'invalid-fixture-directory');
});

test('profile-name capture reports missing routes without leaking paths', async (t) => {
  const root = await temporary(t);
  await rejects(join(root, 'missing'), 'fixture-source-unavailable');
  await rejects(root, 'fixture-source-unavailable');
  await mkdir(join(root, 'src'));
  await rejects(root, 'fixture-source-unavailable');
  await mkdir(join(root, 'src/lib'));
  await rejects(root, 'fixture-source-unavailable');
});

test('profile-name capture rejects symlinks anywhere on the directory route', async (t) => {
  for (const component of ['', 'src', 'src/lib']) {
    const root = await fixture(t);
    const selected = component ? join(root, component) : root;
    await rename(selected, `${selected}-target`);
    t.after(() => rm(`${selected}-target`, { recursive: true, force: true }));
    await symlink(`${selected}-target`, selected);
    await rejects(root, 'unsafe-fixture-directory');
  }
  const outer = await temporary(t);
  const actual = await fixture(t);
  await symlink(dirname(actual), join(outer, 'ancestor'));
  await rejects(join(outer, 'ancestor', basename(actual)), 'unsafe-fixture-directory');
});

test('profile-name capture rejects nondirectory parents and nonregular or linked leaves', async (t) => {
  for (const component of ['', 'src', 'src/lib']) {
    const root = await fixture(t);
    const selected = component ? join(root, component) : root;
    await rm(selected, { recursive: true });
    await writeFile(selected, 'not a directory');
    await rejects(root, 'unsafe-fixture-directory');
  }
  for (const kind of ['symlink', 'hardlink', 'directory', 'fifo']) {
    const root = await fixture(t);
    await rename(leaf(root), join(root, 'original'));
    if (kind === 'symlink') await symlink(join(root, 'original'), leaf(root));
    if (kind === 'hardlink') await link(join(root, 'original'), leaf(root));
    if (kind === 'directory') await mkdir(leaf(root));
    if (kind === 'fifo') {
      await execute('mkfifo', [leaf(root)], { timeout: 5000 });
      const result = await instrument('trace', root);
      assert.equal(result.code, 'unsafe-fixture-source');
      assert.deepEqual(result.trace.opens, []);
    } else await rejects(root, 'unsafe-fixture-source');
  }
});

type TraceResult = {
  code?: string;
  message?: string;
  bytes?: string;
  trace: {
    opens: string[];
    metadata: string[];
    reads: { position: number; requested: number; returned: number }[];
    largestBuffer: number;
    closes: number;
    stats: number;
    hooks: number;
  };
};
async function instrument(mode: string, root: string): Promise<TraceResult> {
  const { stdout, stderr } = await execute(
    process.execPath,
    [fileURLToPath(new URL('./fixture-profile-name-worker.ts', import.meta.url)), mode, root],
    { timeout: 10000, maxBuffer: 4 * workspaceLimits.fileBytes },
  );
  assert.equal(stderr, '');
  return JSON.parse(stdout) as TraceResult;
}

test('profile-name capture opens only the allowlisted source and uses bounded positional reads', async (t) => {
  const root = await fixture(t, Buffer.alloc(workspaceLimits.fileBytes, 0x61));
  for (const trap of ['.env', 'dist', 'package.json', '.git'])
    await symlink(join(root, 'missing-trap'), join(root, trap));
  const result = await instrument('trace', root);
  assert.equal(result.bytes, Buffer.alloc(workspaceLimits.fileBytes, 0x61).toString('hex'));
  assert.deepEqual(result.trace.opens, [leaf(root)]);
  assert.equal(result.trace.closes, 1);
  assert.equal(result.trace.stats, 2);
  assert.equal(result.trace.largestBuffer, workspaceLimits.fileBytes);
  assert.deepEqual(result.trace.reads, [
    { position: 0, requested: workspaceLimits.fileBytes, returned: workspaceLimits.fileBytes },
    { position: workspaceLimits.fileBytes, requested: 1, returned: 0 },
  ]);
  const allowed = new Set<string>([root, join(root, 'src'), join(root, 'src/lib'), leaf(root)]);
  let ancestor = dirname(root);
  while (!allowed.has(ancestor)) {
    allowed.add(ancestor);
    ancestor = dirname(ancestor);
  }
  for (const path of result.trace.metadata) assert.ok(allowed.has(path), path);
});

test('profile-name capture completes actual short reads and closes the descriptor', async (t) => {
  const root = await fixture(t);
  const result = await instrument('short', root);
  assert.equal(result.trace.hooks, 1);
  assert.equal(result.bytes, Buffer.from('abcdefgh').toString('hex'));
  assert.equal(result.trace.largestBuffer, 8);
  assert.equal(result.trace.closes, 1);
  assert.deepEqual(result.trace.reads, [
    { position: 0, requested: 8, returned: 2 },
    { position: 2, requested: 6, returned: 2 },
    { position: 4, requested: 4, returned: 2 },
    { position: 6, requested: 2, returned: 2 },
    { position: 8, requested: 1, returned: 0 },
  ]);
});

test('profile-name capture detects deterministic mutations and EOF, with hooks and closure proved', async (t) => {
  for (const mode of [
    'grow',
    'shrink',
    'rewrite',
    'replace',
    'parent',
    'disappear',
    'mode',
    'eof',
  ]) {
    const root = await fixture(t);
    await chmod(leaf(root), 0o644);
    const result = await instrument(mode, root);
    assert.equal(result.trace.hooks, 1, mode);
    assert.equal(result.code, 'fixture-source-changed', mode);
    assert.equal(result.message, 'fixture-source-changed', mode);
    assert.equal(result.bytes, undefined, mode);
    assert.equal(result.trace.closes, 1, mode);
    assert.deepEqual(result.trace.opens, [leaf(root)], mode);
  }
});

test('profile-name capture sanitizes injected I/O errors and closes after read or stat failures', async (t) => {
  for (const mode of ['read-error', 'stat-error']) {
    const root = await fixture(t);
    const result = await instrument(mode, root);
    assert.equal(result.trace.hooks, 1);
    assert.equal(result.code, 'fixture-source-unavailable');
    assert.equal(result.message, 'fixture-source-unavailable');
    assert.equal(result.trace.closes, 1);
  }
});

test('profile-name capture projects into a real WorkspaceStore and survives reopen', async (t) => {
  const root = await fixture(t, 'export const name = "fixture";\n');
  const capture = await captureProfileNameFixture(root);
  const directory = await temporary(t);
  const options = { directory, regressionDirectory: virtualPath('test/regression') };
  const id = caseId(randomUUID());
  let store = await WorkspaceStore.open(options);
  t.after(() => store.close());
  const workspace = await store.provision({
    caseId: id,
    repositoryId: repositoryId(randomUUID()),
    baseline: [{ virtualPath: capture.source.virtualPath, bytes: capture.source.bytes }],
  });
  assert.equal(workspace.state, 'ready');
  if (workspace.state !== 'ready') throw new Error('workspace not ready');
  assert.match(workspace.checkpoint.revision, /^[0-9a-f]{40}$/);
  const expected = { bytes: capture.source.bytes, sha256: capture.source.sha256 };
  assert.deepEqual(await store.read(id, capture.source.virtualPath), expected);
  await store.close();
  store = await WorkspaceStore.open(options);
  assert.deepEqual(await store.read(id, capture.source.virtualPath), expected);
});
