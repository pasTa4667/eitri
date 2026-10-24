import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  link,
  writeFile,
  truncate,
  stat,
} from 'node:fs/promises';
import installedInputs from '../scripts/profile-reconciliation/installed-inputs.json' with { type: 'json' };
import { captureFixtureApplicationInput } from '../src/fixture-profile-name.ts';
import { ControlError, digest } from '../src/domain.ts';
import {
  WorkspaceStore,
  caseId,
  repositoryId,
  requestId,
  virtualPath,
  workspaceLimits,
} from '../src/workspace.ts';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function temporary(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'eitri-application-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function fixture(t: TestContext) {
  const root = await temporary(t);
  const originals = new Map<string, Buffer>();
  for (const input of installedInputs) {
    const bytes = Buffer.from(
      input.path === 'src/lib/errors.js'
        ? "export function getUserDisplayName(user) { return user.profile.name?.trim() || 'Anonymous' }\n"
        : `// ${input.path}\nthrow new Error('must not execute');\n`,
    );
    originals.set(input.path, bytes);
    await mkdir(dirname(join(root, input.path)), { recursive: true });
    await writeFile(join(root, input.path), bytes);
  }
  return { root, originals };
}

test('application capture includes exactly the fixed input paths and excludes private/output files', async (t) => {
  const { root, originals } = await fixture(t);
  for (const trap of ['.env', '.git', 'dist', 'node_modules', 'README.md'])
    await symlink(join(root, 'missing-private'), join(root, trap));
  const capture = await captureFixtureApplicationInput(root);
  const descriptor = {
    version: 1,
    kind: 'fixture-application-input',
    provenance: { kind: 'uncommitted-copy' },
    files: installedInputs.map(({ path }) => ({
      virtualPath: path,
      size: originals.get(path)!.length,
      sha256: hash(originals.get(path)!),
    })),
  };
  assert.deepEqual(capture, {
    ...descriptor,
    files: descriptor.files.map((file) => ({ ...file, bytes: originals.get(file.virtualPath) })),
    captureDigest: digest(descriptor),
  });
  assert.equal(capture.files.length, 28);
  for (const file of capture.files) {
    assert.deepEqual(await readFile(join(root, file.virtualPath)), file.bytes);
    file.bytes.fill(0);
  }
  const again = await captureFixtureApplicationInput(root);
  assert.equal(again.captureDigest, capture.captureDigest);
  for (const file of again.files) assert.deepEqual(file.bytes, originals.get(file.virtualPath));
});

test('application path selection is detached from later mutations of the imported inventory', async (t) => {
  const { root } = await fixture(t);
  const expected = installedInputs.map(({ path }) => path);
  const first = installedInputs[0].path;
  try {
    installedInputs[0].path = '.env';
    await writeFile(join(root, '.env'), 'private');
    const capture = await captureFixtureApplicationInput(root);
    assert.deepEqual(
      capture.files.map((file) => file.virtualPath),
      expected,
    );
  } finally {
    installedInputs[0].path = first;
  }
});

test('every application input contributes its observed bytes to the digest without a baseline claim', async (t) => {
  const { root, originals } = await fixture(t);
  const original = await captureFixtureApplicationInput(root);
  const other = await fixture(t);
  assert.deepEqual(await captureFixtureApplicationInput(other.root), original);
  for (const input of installedInputs) {
    const bytes = Buffer.from(originals.get(input.path)!);
    bytes[0] ^= 1;
    await writeFile(join(root, input.path), bytes);
    const changed = await captureFixtureApplicationInput(root);
    assert.notEqual(changed.captureDigest, original.captureDigest);
    assert.equal(
      changed.files.find((file) => file.virtualPath === input.path)!.sha256,
      hash(bytes),
    );
    await writeFile(join(root, input.path), originals.get(input.path)!);
  }
});

test('application capture rejects missing, linked, nonregular and oversized files', async (t) => {
  const { root, originals } = await fixture(t);
  for (const input of installedInputs) {
    const path = join(root, input.path);
    for (const kind of ['missing', 'symlink', 'hardlink', 'directory', 'oversized']) {
      await rm(path, { force: true, recursive: true });
      if (kind === 'symlink') await symlink(join(root, 'private'), path);
      if (kind === 'hardlink') {
        await writeFile(join(root, 'private'), 'private');
        await link(join(root, 'private'), path);
      }
      if (kind === 'directory') await mkdir(path);
      if (kind === 'oversized') {
        await writeFile(path, '');
        await truncate(path, workspaceLimits.fileBytes + 1);
      }
      const code =
        kind === 'missing'
          ? 'fixture-source-unavailable'
          : kind === 'oversized'
            ? 'fixture-size-limit'
            : 'unsafe-fixture-source';
      await assert.rejects(captureFixtureApplicationInput(root), (error: unknown) => {
        assert.ok(error instanceof ControlError);
        assert.equal(error.code, code);
        assert.equal(error.message, code);
        return true;
      });
      await rm(path, { force: true, recursive: true });
      await writeFile(path, originals.get(input.path)!);
      await rm(join(root, 'private'), { force: true });
    }
  }
});

test('all application directory routes reject links', async (t) => {
  for (const directory of ['e2e', 'src', 'src/lib', 'src/pages']) {
    const { root } = await fixture(t);
    await rm(join(root, directory), { recursive: true });
    await symlink(join(root, 'missing-private'), join(root, directory));
    await assert.rejects(captureFixtureApplicationInput(root), {
      code: 'unsafe-fixture-directory',
    });
  }
});

test('application capture holds every descriptor until final checks and rejects cross-file mutation', async (t) => {
  const { root, originals } = await fixture(t);
  const execute = promisify(execFile);
  for (const mode of [
    'trace',
    'rewrite-third',
    'replace-third',
    'disappear',
    'grow',
    'open-error',
    'close-error',
    'read-error',
  ]) {
    const clean = mode === 'trace' ? root : (await fixture(t)).root;
    const { stdout, stderr } = await execute(
      process.execPath,
      [
        fileURLToPath(new URL('./fixture-profile-name-reconciliation-worker.ts', import.meta.url)),
        mode,
        clean,
        'application',
      ],
      { timeout: 10000, maxBuffer: 1024 * 1024 },
    );
    assert.equal(stderr, '');
    const result = JSON.parse(stdout);
    assert.deepEqual(
      result.trace.closes.toSorted((a: number, b: number) => a - b),
      result.trace.opens.map((_path: string, i: number) => i),
    );
    if (mode === 'trace') {
      assert.deepEqual(
        result.trace.opens,
        installedInputs.map(({ path }) => join(clean, path)),
      );
      assert.deepEqual(
        result.trace.stats,
        installedInputs.map(() => 2),
      );
      assert.deepEqual(
        result.bytes,
        installedInputs.map(({ path }) => originals.get(path)!.toString('hex')),
      );
    } else {
      assert.equal(result.trace.hooks, 1, mode);
      assert.equal(result.bytes, undefined, mode);
      assert.equal(
        result.code,
        ['open-error', 'close-error', 'read-error'].includes(mode)
          ? 'fixture-source-unavailable'
          : 'fixture-source-changed',
        mode,
      );
      assert.equal(result.message, result.code);
    }
  }
});

test('application capture never executes source or package/configuration scripts', async (t) => {
  const { root } = await fixture(t);
  const sentinel = join(root, 'executed');
  for (const { path } of installedInputs) {
    await writeFile(
      join(root, path),
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'bad');`,
    );
  }
  assert.equal((await captureFixtureApplicationInput(root)).files.length, 28);
  await assert.rejects(stat(sentinel), { code: 'ENOENT' });
});

test('application inputs freeze as complete managed baseline and candidate revisions independent of checkout changes', async (t) => {
  const { root, originals } = await fixture(t);
  const capture = await captureFixtureApplicationInput(root);
  const store = await WorkspaceStore.open({
    directory: await temporary(t),
    regressionDirectory: virtualPath('regression'),
  });
  t.after(() => store.close());
  const id = caseId(randomUUID());
  const workspace = await store.provision({
    caseId: id,
    repositoryId: repositoryId(randomUUID()),
    baseline: capture.files.map(({ virtualPath, bytes }) => ({ virtualPath, bytes })),
  });
  assert.equal(workspace.state, 'ready');
  if (workspace.state !== 'ready') throw new Error('ready required');
  const baseline = await store.freeze(id, workspace.checkpoint.revision);
  const path = virtualPath('src/lib/errors.js');
  const bytes = Buffer.from(
    originals.get(path)!.toString().replace('user.profile.name', 'user?.profile?.name'),
  );
  const edit = await store.edit(id, workspace.checkpoint.revision, {
    requestId: requestId(randomUUID()),
    virtualPath: path,
    expectedHash: capture.files.find((file) => file.virtualPath === path)!.sha256,
    bytes,
  });
  const candidate = await store.freeze(id, edit.checkpoint.revision);
  assert.notEqual(candidate.revision, baseline.revision);
  assert.notEqual(candidate.manifestDigest, baseline.manifestDigest);
  await writeFile(join(root, path), 'changed original');
  for (const file of capture.files) file.bytes.fill(0);
  const signal = new AbortController().signal;
  const baselineFiles = await store.readFrozen(baseline, signal);
  const candidateFiles = await store.readFrozen(candidate, signal);
  assert.equal(baselineFiles.length, 28);
  assert.equal(candidateFiles.length, 28);
  for (const input of installedInputs) {
    assert.deepEqual(
      baselineFiles.find((file) => file.virtualPath === input.path)!.bytes,
      originals.get(input.path),
    );
    assert.deepEqual(
      candidateFiles.find((file) => file.virtualPath === input.path)!.bytes,
      input.path === path ? bytes : originals.get(input.path),
    );
  }
});
