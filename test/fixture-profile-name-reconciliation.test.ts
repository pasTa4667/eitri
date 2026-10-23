import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
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
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureProfileNameReconciliationInput } from '../src/fixture-profile-name.ts';
import { ControlError } from '../src/domain.ts';
import { workspaceLimits } from '../src/workspace.ts';
import type { VirtualPath } from '../src/workspace.ts';

const paths = ['src/lib/errors.js', 'src/lib/errors.test.js', 'src/App.test.jsx'];
const execute = promisify(execFile);
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
async function fixture(t: TestContext, bytes = paths.map(() => Buffer.from('abcdefgh'))) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'eitri-reconciliation-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src/lib'), { recursive: true });
  for (const [i, path] of paths.entries()) await writeFile(join(root, path), bytes[i]);
  return root;
}
async function rejects(root: string, code: string) {
  await assert.rejects(captureProfileNameReconciliationInput(root), (error: unknown) => {
    assert.ok(error instanceof ControlError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  });
}

test('reconciliation capture has a literal full result and independent canonical digest', async (t) => {
  const root = await fixture(t, [Buffer.from('abc'), Buffer.alloc(0), Buffer.from([0, 255])]);
  const capture = await captureProfileNameReconciliationInput(root);
  assert.deepEqual(capture, {
    version: 1,
    kind: 'profile-name-reconciliation-input',
    provenance: { kind: 'uncommitted-copy' },
    files: [
      {
        virtualPath: 'src/lib/errors.js',
        size: 3,
        sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        bytes: Buffer.from('abc'),
      },
      {
        virtualPath: 'src/lib/errors.test.js',
        size: 0,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        bytes: Buffer.alloc(0),
      },
      {
        virtualPath: 'src/App.test.jsx',
        size: 2,
        sha256: '06eb7d6a69ee19e5fbdf749018d3d2abfa04bcbd1365db312eb86dc7169389b8',
        bytes: Buffer.from([0, 255]),
      },
    ],
    captureDigest: '0213abb3f3538f26fe73a55333ffe76c7266115157208d34491d29c794278dc6',
  });
  const canonical =
    '{"files":[{"sha256":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad","size":3,"virtualPath":"src/lib/errors.js"},{"sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","size":0,"virtualPath":"src/lib/errors.test.js"},{"sha256":"06eb7d6a69ee19e5fbdf749018d3d2abfa04bcbd1365db312eb86dc7169389b8","size":2,"virtualPath":"src/App.test.jsx"}],"kind":"profile-name-reconciliation-input","provenance":{"kind":"uncommitted-copy"},"version":1}';
  assert.equal(hash(canonical), capture.captureDigest);
  const typedPaths: readonly [
    VirtualPath & 'src/lib/errors.js',
    VirtualPath & 'src/lib/errors.test.js',
    VirtualPath & 'src/App.test.jsx',
  ] = [capture.files[0].virtualPath, capture.files[1].virtualPath, capture.files[2].virtualPath];
  assert.deepEqual(typedPaths, paths);
});

test('every selected input affects the digest; roots and caller mutations do not', async (t) => {
  const root = await fixture(t);
  const other = await fixture(t);
  const original = await captureProfileNameReconciliationInput(root);
  assert.deepEqual(await captureProfileNameReconciliationInput(other), original);
  for (const [i, path] of paths.entries()) {
    await writeFile(join(root, path), 'ABCDEFGH');
    const changed = await captureProfileNameReconciliationInput(root);
    assert.notEqual(changed.captureDigest, original.captureDigest);
    assert.equal(changed.files[i].sha256, hash('ABCDEFGH'));
    await writeFile(join(root, path), 'abcdefgh');
    original.files[i].bytes.fill(0);
  }
  const fresh = await captureProfileNameReconciliationInput(root);
  assert.deepEqual(
    fresh.files.map((file) => file.bytes.toString()),
    ['abcdefgh', 'abcdefgh', 'abcdefgh'],
  );
  assert.equal(fresh.captureDigest, original.captureDigest);
  await writeFile(join(root, paths[0]), 'replacement');
  assert.equal(fresh.files[0].bytes.toString(), 'abcdefgh');
});

test('raw binary, empty and exact-limit files stay byte-exact', async (t) => {
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from([0]),
    Buffer.from([0xef, 0xbb, 0xbf, 13, 10, 0, 255]),
    Buffer.alloc(workspaceLimits.fileBytes, 255),
  ]) {
    const root = await fixture(
      t,
      paths.map(() => bytes),
    );
    const result = await captureProfileNameReconciliationInput(root);
    for (const file of result.files) {
      assert.deepEqual(file.bytes, bytes);
      assert.equal(file.size, bytes.length);
      assert.equal(file.sha256, hash(bytes));
    }
  }
});

test('all positions reject missing, unsafe and oversized selections before opening', async (t) => {
  for (const path of paths) {
    for (const kind of ['missing', 'symlink', 'hardlink', 'directory', 'fifo', 'oversize']) {
      const root = await fixture(t);
      const selected = join(root, path);
      await rename(selected, join(root, 'original'));
      if (kind === 'symlink') await symlink(join(root, 'original'), selected);
      if (kind === 'hardlink') await link(join(root, 'original'), selected);
      if (kind === 'directory') await mkdir(selected);
      if (kind === 'fifo') await execute('mkfifo', [selected], { timeout: 5000 });
      if (kind === 'oversize') {
        await writeFile(selected, '');
        await truncate(selected, workspaceLimits.fileBytes + 1);
      }
      const result = await instrument('trace', root);
      const code =
        kind === 'missing'
          ? 'fixture-source-unavailable'
          : kind === 'oversize'
            ? 'fixture-size-limit'
            : 'unsafe-fixture-source';
      assert.equal(result.code, code, `${path} ${kind}`);
      assert.equal(result.message, code);
      assert.equal(result.bytes, undefined);
      assert.deepEqual(result.trace.opens, []);
      assert.deepEqual(result.trace.closes, []);
    }
  }
});

test('invalid roots and unsafe routes reject with sanitized errors', async (t) => {
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
  for (const component of ['', 'src', 'src/lib']) {
    for (const kind of ['symlink', 'file']) {
      const root = await fixture(t);
      const path = join(root, component);
      await rename(path, `${path}-old`);
      t.after(() => rm(`${path}-old`, { recursive: true, force: true }));
      if (kind === 'symlink') await symlink(`${path}-old`, path);
      else await writeFile(path, 'not a directory');
      await rejects(root, 'unsafe-fixture-directory');
    }
  }
});

test('captured source and tests never execute and unrelated paths are never inspected', async (t) => {
  const root = await fixture(t);
  const sentinel = join(root, 'executed');
  const bytes = Buffer.from(
    `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(sentinel)}, 'bad');\nthrow new Error('executed');\n`,
  );
  for (const path of paths) await writeFile(join(root, path), bytes);
  for (const trap of ['.env', 'dist', 'package.json', '.git'])
    await symlink(join(root, 'missing'), join(root, trap));
  const result = await instrument('trace', root);
  assert.deepEqual(
    result.bytes,
    paths.map(() => bytes.toString('hex')),
  );
  await assert.rejects(stat(sentinel), { code: 'ENOENT' });
  assert.deepEqual(
    result.trace.opens,
    paths.map((path) => join(root, path)),
  );
  assert.deepEqual(result.trace.closes.toSorted(), [0, 1, 2]);
  assert.deepEqual(result.trace.stats, [2, 2, 2]);
});

type TraceResult = {
  code?: string;
  message?: string;
  bytes?: string[];
  trace: {
    opens: string[];
    closes: number[];
    stats: number[];
    reads: { file: number; position: number; requested: number; returned: number }[];
    hooks: number;
    largestBuffer: number;
  };
};
async function instrument(
  mode: string,
  root: string,
  api = 'reconciliation',
): Promise<TraceResult> {
  const { stdout, stderr } = await execute(
    process.execPath,
    [
      fileURLToPath(new URL('./fixture-profile-name-reconciliation-worker.ts', import.meta.url)),
      mode,
      root,
      api,
    ],
    { timeout: 10000, maxBuffer: 8 * workspaceLimits.fileBytes },
  );
  assert.equal(stderr, '');
  return JSON.parse(stdout) as TraceResult;
}

test('reads stay bounded and positional while every descriptor remains held', async (t) => {
  const root = await fixture(t);
  const result = await instrument('short', root);
  assert.deepEqual(result.bytes, ['6162636465666768', '6162636465666768', '6162636465666768']);
  assert.equal(result.trace.largestBuffer, 8);
  assert.deepEqual(result.trace.stats, [2, 2, 2]);
  assert.deepEqual(result.trace.closes.toSorted(), [0, 1, 2]);
  assert.deepEqual(
    result.trace.reads,
    [0, 1, 2].flatMap((file) => [
      { file, position: 0, requested: 8, returned: 2 },
      { file, position: 2, requested: 6, returned: 2 },
      { file, position: 4, requested: 4, returned: 2 },
      { file, position: 6, requested: 2, returned: 2 },
      { file, position: 8, requested: 1, returned: 0 },
    ]),
  );
});

test('exact-limit captures use only bounded full reads and one-byte probes', async (t) => {
  const bytes = Buffer.alloc(workspaceLimits.fileBytes, 0x61);
  const root = await fixture(
    t,
    paths.map(() => bytes),
  );
  const result = await instrument('trace', root);
  assert.deepEqual(
    result.bytes,
    paths.map(() => bytes.toString('hex')),
  );
  assert.equal(result.trace.largestBuffer, workspaceLimits.fileBytes);
  assert.deepEqual(
    result.trace.reads,
    [0, 1, 2].flatMap((file) => [
      {
        file,
        position: 0,
        requested: workspaceLimits.fileBytes,
        returned: workspaceLimits.fileBytes,
      },
      { file, position: workspaceLimits.fileBytes, requested: 1, returned: 0 },
    ]),
  );
  assert.deepEqual(result.trace.stats, [2, 2, 2]);
  assert.deepEqual(result.trace.closes.toSorted(), [0, 1, 2]);
});

test('cross-file mutations and replacements reject the entire capture and release all handles', async (t) => {
  for (const mode of [
    'rewrite-second',
    'rewrite-third',
    'replace-second',
    'replace-third',
    'parent-second',
    'parent-third',
    'disappear',
    'grow',
    'shrink',
    'eof',
  ]) {
    const root = await fixture(t);
    const result = await instrument(mode, root);
    assert.equal(result.trace.hooks, 1, mode);
    assert.equal(result.code, 'fixture-source-changed', mode);
    assert.equal(result.message, 'fixture-source-changed', mode);
    assert.equal(result.bytes, undefined, mode);
    assert.deepEqual(
      result.trace.closes.toSorted(),
      mode === 'parent-second' ? [0, 1] : [0, 1, 2],
      mode,
    );
    assert.equal(result.trace.opens.length, mode === 'parent-second' ? 2 : 3, mode);
  }
});

test('I/O and cleanup failures are sanitized and every opened handle receives a close', async (t) => {
  for (const mode of [
    'open-error',
    'open-disappear',
    'read-error',
    'stat-error',
    'close-error',
    'changed-close-error',
    'unsafe-opened',
  ]) {
    const root = await fixture(t);
    const result = await instrument(mode, root);
    assert.equal(result.trace.hooks, mode === 'changed-close-error' ? 2 : 1, mode);
    const code =
      mode === 'open-disappear'
        ? 'fixture-source-changed'
        : mode === 'unsafe-opened'
          ? 'unsafe-fixture-source'
          : 'fixture-source-unavailable';
    assert.equal(result.code, code, mode);
    assert.equal(result.message, code, mode);
    assert.equal(result.bytes, undefined, mode);
    assert.deepEqual(
      result.trace.closes.toSorted(),
      mode.startsWith('open-') || mode === 'unsafe-opened' ? [0] : [0, 1, 2],
      mode,
    );
  }
});

test('helper retains unsafe-opened classification and cleanup failure precedence', async (t) => {
  for (const mode of ['unsafe-opened', 'close-error', 'changed-close-error']) {
    const root = await fixture(t);
    const result = await instrument(mode, root, 'helper');
    const code = mode === 'unsafe-opened' ? 'unsafe-fixture-source' : 'fixture-source-unavailable';
    assert.equal(result.code, code);
    assert.equal(result.message, code);
    assert.equal(result.bytes, undefined);
    assert.equal(result.trace.hooks, mode === 'changed-close-error' ? 2 : 1);
    assert.deepEqual(result.trace.closes, [0]);
  }
});
