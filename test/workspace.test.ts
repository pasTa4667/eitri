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
  mkdir,
  chmod,
  rename,
  symlink,
  link,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import {
  WorkspaceStore,
  workspaceLimits,
  caseId,
  repositoryId,
  requestId,
  virtualPath,
  gitRevision,
  sha256,
} from '../src/workspace.ts';
import type {
  Workspace,
  BaselineFile,
  CaseId,
  GitRevision,
  BrokerEdit,
  WorkspaceFaultPoint,
} from '../src/workspace.ts';

const regressionDirectory = virtualPath('test/regression');
const file = (path: string, bytes: string | Uint8Array): BaselineFile => ({
  virtualPath: virtualPath(path),
  bytes: typeof bytes === 'string' ? Buffer.from(bytes) : bytes,
});
function ready(w: Workspace) {
  assert.equal(w.state, 'ready');
  if (w.state !== 'ready') throw new Error('not ready');
  return w;
}
async function writable(path: string) {
  const s = await lstat(path);
  if (s.isDirectory()) {
    await chmod(path, 0o700);
    for (const name of await readdir(path)) await writable(join(path, name));
  } else if (!s.isSymbolicLink()) await chmod(path, 0o600);
}
async function temporary(t: TestContext, short = false) {
  const root = await realpath(
    await mkdtemp(
      join(short ? '/private/tmp' : tmpdir(), short ? 'eitri-ws-' : 'eitri-workspace-test-'),
    ),
  );
  t.after(async () => {
    await writable(root);
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
async function fixture(
  t: TestContext,
  baseline: readonly BaselineFile[] = [
    file('src/main.ts', 'A\n'),
    file('README.md', 'Protected\n'),
    file('test/baseline.test.ts', 'baseline\n'),
  ],
  short = false,
) {
  const root = await temporary(t, short);
  const store = await WorkspaceStore.open({ directory: root, regressionDirectory });
  t.after(() => store.close());
  const id = caseId(randomUUID()),
    repo = repositoryId(randomUUID());
  const workspace = ready(await store.provision({ caseId: id, repositoryId: repo, baseline }));
  const source = join(root, 'cases', id),
    repository = join(root, 'repositories', `${repo}.git`);
  return { root, store, id, repo, workspace, source, repository };
}
const edit = (
  path: string,
  expectedHash: BrokerEdit['expectedHash'],
  bytes: string,
): BrokerEdit => ({
  requestId: requestId(randomUUID()),
  virtualPath: virtualPath(path),
  expectedHash,
  bytes: Buffer.from(bytes),
});
async function ref(repository: string, id: CaseId) {
  return (await readFile(join(repository, 'refs', 'heads', 'cases', id), 'utf8')).trim();
}
async function object(repository: string, oid: string, type: string) {
  const raw = inflateSync(
    await readFile(join(repository, 'objects', oid.slice(0, 2), oid.slice(2))),
  );
  const nul = raw.indexOf(0),
    body = raw.subarray(nul + 1);
  assert.equal(raw.subarray(0, nul).toString(), `${type} ${body.length}`);
  return body;
}
async function commitBlob(
  repository: string,
  revision: GitRevision,
  path: string,
): Promise<Buffer> {
  const commit = await object(repository, revision, 'commit');
  assert.match(commit.toString(), /^tree [0-9a-f]{40}\n/);
  let tree = commit.toString().slice(5, 45);
  const parts = path.split('/');
  for (let i = 0; i < parts.length; i++) {
    const bytes = await object(repository, tree, 'tree');
    let offset = 0,
      found = '';
    while (offset < bytes.length) {
      const space = bytes.indexOf(32, offset),
        nul = bytes.indexOf(0, space);
      const mode = bytes.subarray(offset, space).toString(),
        name = bytes.subarray(space + 1, nul).toString();
      if (name === parts[i]) {
        assert.equal(mode, i === parts.length - 1 ? '100644' : '40000');
        found = bytes.subarray(nul + 1, nul + 21).toString('hex');
      }
      offset = nul + 21;
    }
    assert.notEqual(found, '');
    tree = found;
  }
  return object(repository, tree, 'blob');
}
async function allFiles(root: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const name of await readdir(join(root, prefix))) {
    const path = prefix ? `${prefix}/${name}` : name;
    if ((await lstat(join(root, path))).isDirectory()) files.push(...(await allFiles(root, path)));
    else files.push(path);
  }
  return files.sort();
}

test('workspace owns real independent worktrees and literal raw checkpoints without runtime wiring', async (t) => {
  const f = await fixture(t);
  const b = caseId(randomUUID());
  const other = ready(
    await f.store.provision({
      caseId: b,
      repositoryId: f.repo,
      baseline: [file('src/main.ts', 'Other\0bytes\n')],
    }),
  );
  assert.equal((await lstat(f.repository)).isDirectory(), true);
  assert.equal(
    (await readFile(join(f.repository, 'config'), 'utf8')).includes('bare = true'),
    true,
  );
  assert.match(await readFile(join(f.source, '.git'), 'utf8'), /\/worktrees\/[0-9a-f-]+\n$/);
  assert.equal(
    await readFile(join(f.repository, 'worktrees', f.id, 'HEAD'), 'utf8'),
    `ref: refs/heads/cases/${f.id}\n`,
  );
  const initial = await f.store.read(f.id, virtualPath('src/main.ts'));
  const saved = await f.store.edit(
    f.id,
    f.workspace.checkpoint.revision,
    edit('src/main.ts', initial.sha256, 'B\r\n$literal\0bytes'),
  );
  assert.equal(saved.checkpoint.sequence, 1);
  assert.equal(
    (await commitBlob(f.repository, saved.checkpoint.revision, 'src/main.ts')).toString(),
    'B\r\n$literal\0bytes',
  );
  assert.equal(
    (await commitBlob(f.repository, other.checkpoint.revision, 'src/main.ts')).toString(),
    'Other\0bytes\n',
  );
  assert.equal(await ref(f.repository, b), other.checkpoint.revision);
  assert.equal(
    (await f.store.read(b, virtualPath('src/main.ts'))).bytes.toString(),
    'Other\0bytes\n',
  );
  const created = await f.store.edit(
    f.id,
    saved.checkpoint.revision,
    edit('test/regression/new.test.ts', null, 'regression A'),
  );
  const revised = await f.store.edit(
    f.id,
    created.checkpoint.revision,
    edit('test/regression/new.test.ts', created.sha256, 'regression B'),
  );
  assert.equal(
    (
      await commitBlob(f.repository, revised.checkpoint.revision, 'test/regression/new.test.ts')
    ).toString(),
    'regression B',
  );
  for (const name of ['controller.ts', 'native.ts', 'http.ts', 'main.ts'])
    assert.doesNotMatch(
      await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8'),
      /(?:from\s*|import\s*\()['"]\.\/workspace(?:\.ts)?['"]/,
    );
});

test('workspace protects baseline tests and configuration even nested under src', async (t) => {
  const protectedPaths = [
    'README.md',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    '.github/workflows/check.yml',
    'src/helper.test.ts',
    'src/test_helper.ts',
    'src/Makefile',
    'src/CMakeLists.txt',
    'src/__tests__/helper.ts',
    'src/package.json',
    'src/README.md',
    'src/vite.config.ts',
    'src/build/options.ts',
    'src/policy.ts',
    'src/.config/policy',
    'test/baseline.test.ts',
    'test/regression/baseline.test.ts',
  ];
  const f = await fixture(t, [
    file('src/main.ts', 'A'),
    ...protectedPaths.map((p) => file(p, 'trusted')),
  ]);
  for (const path of protectedPaths) {
    const existing = await f.store.read(f.id, virtualPath(path));
    await assert.rejects(
      f.store.edit(f.id, f.workspace.checkpoint.revision, edit(path, existing.sha256, 'weakened')),
      /workspace-protected-path/,
    );
    assert.equal(await readFile(join(f.source, path), 'utf8'), 'trusted');
  }
  for (const path of [
    'src/.env',
    'src/package.json/new.ts',
    'src/connection.json',
    'src/oauth.json',
    'src/credentials.json',
    'src/config.json',
  ])
    await assert.rejects(
      f.store.edit(f.id, f.workspace.checkpoint.revision, edit(path, null, 'x')),
    );
  await assert.rejects(
    f.store.edit(f.id, f.workspace.checkpoint.revision, edit('src/MAIN.ts', null, 'collision')),
    /workspace-path-collision/,
  );
  assert.equal(await ref(f.repository, f.id), f.workspace.checkpoint.revision);
  assert.equal((await f.store.inspect(f.id)).state, 'ready');
});

test('workspace rejects sensitive imports, noncanonical paths, unicode and case collisions without writes', async (t) => {
  const root = await temporary(t),
    store = await WorkspaceStore.open({ directory: root, regressionDirectory });
  t.after(() => store.close());
  const repo = repositoryId(randomUUID());
  for (const path of [
    '.env',
    '.env.local',
    'src/.env',
    'src/.env.production',
    'oauth.json',
    'connection.json',
    'src/credentials.json',
    '.npmrc',
    '.ssh/key',
    'src/.gitconfig',
    'src/.git-credentials',
    'src/.envrc',
  ])
    await assert.rejects(
      store.provision({
        caseId: caseId(randomUUID()),
        repositoryId: repo,
        baseline: [file(path, 'secret')],
      }),
      /workspace-sensitive-path/,
    );
  for (const path of [
    '',
    '/etc/passwd',
    '../x',
    'src/../x',
    'src//x',
    'src/./x',
    'C:/x',
    'src\\x',
    'src/\0x',
    'src/\nx',
    'src/\u202ex',
    'src/\u200bx',
    'src/.GiT/config',
    'src/x/..',
    'src/a.',
    'src/a ',
    'src/cafe\u0301.ts',
    'a/'.repeat(16) + 'x',
    'x'.repeat(513),
  ])
    assert.throws(() => virtualPath(path), /invalid-workspace-path/);
  for (const paths of [
    ['src/A.ts', 'src/a.ts'],
    ['src/Foo/a.ts', 'src/foo/b.ts'],
    ['src/Straße.ts', 'src/STRASSE.ts'],
    ['src/K.ts', 'src/K.ts'],
    ['src/a', 'src/a/b'],
  ]) {
    await assert.rejects(async () =>
      store.provision({
        caseId: caseId(randomUUID()),
        repositoryId: repo,
        baseline: paths.map((p) => file(p, 'x')),
      }),
    );
  }
  assert.deepEqual(await readdir(join(root, 'repositories')), []);
  assert.deepEqual(await readdir(join(root, 'cases')), []);
});

test(
  'workspace bounds file, manifest count, aggregate bytes and canonical path bytes',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    await assert.rejects(
      f.store.edit(f.id, f.workspace.checkpoint.revision, {
        ...edit('src/big.ts', null, ''),
        bytes: Buffer.alloc(workspaceLimits.fileBytes + 1),
      }),
      /workspace-file-size-limit/,
    );
    await assert.rejects(
      f.store.provision({
        caseId: caseId(randomUUID()),
        repositoryId: f.repo,
        baseline: Array.from({ length: 1025 }, (_, i) => file(`src/${i}`, '')),
      }),
      /workspace-size-limit/,
    );
    const full = caseId(randomUUID());
    const w = ready(
      await f.store.provision({
        caseId: full,
        repositoryId: f.repo,
        baseline: Array.from({ length: 1024 }, (_, i) => file(`src/${i}`, '')),
      }),
    );
    await assert.rejects(
      f.store.edit(full, w.checkpoint.revision, edit('src/extra', null, '')),
      /workspace-size-limit/,
    );
    const bytes = Buffer.alloc(workspaceLimits.fileBytes, 0x61),
      large = caseId(randomUUID());
    const aggregate = ready(
      await f.store.provision({
        caseId: large,
        repositoryId: f.repo,
        baseline: Array.from({ length: 32 }, (_, i) => file(`src/${i}`, bytes)),
      }),
    );
    await assert.rejects(
      f.store.edit(large, aggregate.checkpoint.revision, edit('src/extra', null, 'x')),
      /workspace-size-limit/,
    );
    await assert.rejects(
      f.store.provision({
        caseId: caseId(randomUUID()),
        repositoryId: f.repo,
        baseline: Array.from({ length: 33 }, (_, i) => file(`src/${i}`, bytes)),
      }),
      /workspace-size-limit/,
    );
    assert.throws(() => virtualPath('src/' + 'é'.repeat(255)), /invalid-workspace-path/);
    assert.equal(await ref(f.repository, full), w.checkpoint.revision);
    assert.equal(await ref(f.repository, large), aggregate.checkpoint.revision);
  },
);

test('workspace copies bytes before awaits and serializes edit compare-and-swap', async (t) => {
  const root = await temporary(t),
    store = await WorkspaceStore.open({ directory: root, regressionDirectory });
  t.after(() => store.close());
  const id = caseId(randomUUID()),
    repo = repositoryId(randomUUID()),
    bytes = Buffer.from('baseline');
  const provision = store.provision({
    caseId: id,
    repositoryId: repo,
    baseline: [file('src/main.ts', bytes)],
  });
  bytes.fill(0);
  const w = ready(await provision),
    old = await store.read(id, virtualPath('src/main.ts'));
  assert.equal(old.bytes.toString(), 'baseline');
  const payload = Buffer.from('replacement'),
    request = { ...edit('src/main.ts', old.sha256, ''), bytes: payload };
  const first = store.edit(id, w.checkpoint.revision, request);
  payload.fill(0);
  const second = store.edit(id, w.checkpoint.revision, edit('src/main.ts', old.sha256, 'second'));
  const [a, b] = await Promise.allSettled([first, second]);
  assert.equal(a.status, 'fulfilled');
  assert.equal(b.status, 'rejected');
  assert.equal((await store.read(id, virtualPath('src/main.ts'))).bytes.toString(), 'replacement');
});

test('workspace stale checks and conflicting request reuse do not mutate source or refs', async (t) => {
  const f = await fixture(t),
    initial = await f.store.read(f.id, virtualPath('src/main.ts'));
  await assert.rejects(
    f.store.edit(f.id, gitRevision('1'.repeat(40)), edit('src/main.ts', initial.sha256, 'B')),
    /workspace-stale-checkpoint/,
  );
  await assert.rejects(
    f.store.edit(
      f.id,
      f.workspace.checkpoint.revision,
      edit('src/main.ts', sha256('1'.repeat(64)), 'B'),
    ),
    /workspace-stale-hash/,
  );
  await assert.rejects(
    f.store.edit(f.id, f.workspace.checkpoint.revision, edit('src/main.ts', null, 'B')),
    /workspace-stale-hash/,
  );
  assert.equal(await readFile(join(f.source, 'src/main.ts'), 'utf8'), 'A\n');
  assert.equal(await ref(f.repository, f.id), f.workspace.checkpoint.revision);
  const request = edit('src/main.ts', initial.sha256, 'B'),
    receipt = await f.store.edit(f.id, f.workspace.checkpoint.revision, request);
  assert.deepEqual(await f.store.edit(f.id, f.workspace.checkpoint.revision, request), receipt);
  await assert.rejects(
    f.store.edit(f.id, f.workspace.checkpoint.revision, { ...request, bytes: Buffer.from('C') }),
    /workspace-request-conflict/,
  );
  assert.equal(await ref(f.repository, f.id), receipt.checkpoint.revision);
  assert.equal(await readFile(join(f.source, 'src/main.ts'), 'utf8'), 'B');
  await f.store.close();
  const reopened = await WorkspaceStore.open({ directory: f.root, regressionDirectory });
  t.after(() => reopened.close());
  assert.deepEqual(await reopened.edit(f.id, f.workspace.checkpoint.revision, request), receipt);
  await writeFile(join(f.source, 'src/main.ts'), 'later human bytes');
  await assert.rejects(reopened.freeze(f.id, receipt.checkpoint.revision));
  assert.equal((await reopened.inspect(f.id)).state, 'uncertain');
  assert.deepEqual(await reopened.edit(f.id, f.workspace.checkpoint.revision, request), receipt);
  assert.equal(await readFile(join(f.source, 'src/main.ts'), 'utf8'), 'later human bytes');
});

for (const mutation of [
  'tracked',
  'untracked',
  'ignored',
  'protected',
  'mode',
  'directory',
  'ancestor-identity',
  'symlink',
  'hardlink',
  'socket',
  'pointer',
  'ref',
] as const)
  test(`workspace detects and preserves unexpected ${mutation} changes before edit and freeze`, async (t) => {
    const f = await fixture(t, undefined, mutation === 'socket'),
      original = await f.store.read(f.id, virtualPath('src/main.ts'));
    const path = join(f.source, 'src/main.ts');
    let socket: import('node:net').Server | undefined;
    if (mutation === 'tracked') await writeFile(path, 'human');
    if (mutation === 'untracked') await writeFile(join(f.source, 'new.txt'), 'human');
    if (mutation === 'ignored') {
      await mkdir(join(f.source, 'node_modules'));
      await writeFile(join(f.source, 'node_modules', 'ignored'), 'ignored human');
    }
    if (mutation === 'protected') await writeFile(join(f.source, 'README.md'), 'human README');
    if (mutation === 'mode') await chmod(path, 0o700);
    if (mutation === 'directory') {
      await rename(join(f.source, 'src'), join(f.source, 'preserved-src'));
      await mkdir(join(f.source, 'src'), { mode: 0o700 });
      await writeFile(path, 'A\n', { mode: 0o600 });
    }
    if (mutation === 'ancestor-identity') {
      const holder = await temporary(t),
        original = await lstat(path);
      await rename(join(f.source, 'src'), join(holder, 'src'));
      await mkdir(join(f.source, 'src'), { mode: 0o700 });
      await rename(join(holder, 'src/main.ts'), path);
      assert.equal((await lstat(path)).ino, original.ino);
    }
    if (mutation === 'symlink') {
      await rm(path);
      await symlink(join(f.source, 'README.md'), path);
    }
    if (mutation === 'hardlink') await link(path, join(f.source, 'linked'));
    if (mutation === 'socket') {
      const { createServer } = await import('node:net');
      socket = createServer();
      socket.listen(join(f.source, 'socket'));
      await once(socket, 'listening');
      t.after(() => new Promise<void>((resolve) => socket!.close(() => resolve())));
    }
    if (mutation === 'pointer') await writeFile(join(f.source, '.git'), 'gitdir: /unowned\n');
    if (mutation === 'ref')
      await writeFile(join(f.repository, 'refs/heads/cases', f.id), '1'.repeat(40) + '\n');
    const before =
      mutation === 'symlink' || mutation === 'socket'
        ? null
        : await readFile(mutation === 'protected' ? join(f.source, 'README.md') : path);
    const beforeRef = await ref(f.repository, f.id);
    await assert.rejects(
      f.store.edit(
        f.id,
        f.workspace.checkpoint.revision,
        edit('src/main.ts', original.sha256, 'broker overwrite'),
      ),
    );
    assert.equal((await f.store.inspect(f.id)).state, 'uncertain');
    await assert.rejects(
      f.store.freeze(f.id, f.workspace.checkpoint.revision),
      /workspace-not-ready/,
    );
    if (before)
      assert.deepEqual(
        await readFile(mutation === 'protected' ? join(f.source, 'README.md') : path),
        before,
      );
    if (mutation === 'untracked')
      assert.equal(await readFile(join(f.source, 'new.txt'), 'utf8'), 'human');
    if (mutation === 'ignored')
      assert.equal(await readFile(join(f.source, 'node_modules/ignored'), 'utf8'), 'ignored human');
    if (mutation === 'mode') assert.equal((await lstat(path)).mode & 0o7777, 0o700);
    if (mutation === 'symlink') assert.equal((await lstat(path)).isSymbolicLink(), true);
    if (mutation === 'hardlink') assert.equal((await lstat(path)).nlink, 2);
    assert.equal(await ref(f.repository, f.id), beforeRef);
  });

test('workspace freeze independently rejects dirty bytes and exports only recorded case-owned A after B', async (t) => {
  const f = await fixture(t),
    frozen = await f.store.freeze(f.id, f.workspace.checkpoint.revision);
  const b = caseId(randomUUID()),
    other = ready(
      await f.store.provision({
        caseId: b,
        repositoryId: f.repo,
        baseline: [file('src/main.ts', 'OTHER')],
      }),
    );
  await assert.rejects(
    f.store.exportRevision({
      ...frozen,
      revision: other.checkpoint.revision,
      manifestDigest: other.checkpoint.manifestDigest,
    }),
    /workspace-revision-not-frozen/,
  );
  await assert.rejects(
    f.store.exportRevision({ ...frozen, caseId: b }),
    /workspace-revision-not-frozen/,
  );
  const original = await f.store.read(f.id, virtualPath('src/main.ts'));
  await f.store.edit(
    f.id,
    f.workspace.checkpoint.revision,
    edit('src/main.ts', original.sha256, 'B'),
  );
  const exported = await f.store.exportRevision(frozen),
    root = join(f.root, 'exports', exported.exportId);
  assert.equal(await readFile(join(root, 'src/main.ts'), 'utf8'), 'A\n');
  assert.deepEqual(await allFiles(root), ['README.md', 'src/main.ts', 'test/baseline.test.ts']);
  assert.equal((await lstat(root)).mode & 0o7777, 0o500);
  assert.equal((await lstat(join(root, 'src/main.ts'))).mode & 0o7777, 0o400);
  await writeFile(join(f.source, 'src/main.ts'), 'human dirty');
  const current = await ref(f.repository, f.id);
  await assert.rejects(f.store.freeze(f.id, gitRevision(current)));
  assert.equal(await readFile(join(f.source, 'src/main.ts'), 'utf8'), 'human dirty');
  const again = await f.store.exportRevision(frozen);
  assert.equal(
    await readFile(join(f.root, 'exports', again.exportId, 'src/main.ts'), 'utf8'),
    'A\n',
  );
});

test('workspace rejects unowned nonempty and unsafe roots without changing bytes or permissions', async (t) => {
  const root = await temporary(t);
  for (const name of ['README.md', '.git', 'journal.sqlite'])
    await writeFile(join(root, name), 'unrelated', { mode: 0o640 });
  await assert.rejects(
    WorkspaceStore.open({ directory: root, regressionDirectory }),
    /unowned-workspace-store/,
  );
  assert.deepEqual((await readdir(root)).sort(), ['.git', 'README.md', 'journal.sqlite']);
  for (const name of await readdir(root)) {
    assert.equal(await readFile(join(root, name), 'utf8'), 'unrelated');
    assert.equal((await lstat(join(root, name))).mode & 0o7777, 0o640);
  }
  assert.equal((await lstat(root)).mode & 0o7777, 0o700);
  const unsafe = await temporary(t);
  await chmod(unsafe, 0o755);
  await assert.rejects(
    WorkspaceStore.open({ directory: unsafe, regressionDirectory }),
    /unsafe-workspace-root/,
  );
  assert.equal((await lstat(unsafe)).mode & 0o7777, 0o755);
});

for (const damage of ['journal', 'config', 'metadata-directory', 'source-directory'] as const)
  test(`workspace fails closed reopening corrupt ${damage}`, async (t) => {
    const f = await fixture(t);
    await f.store.close();
    if (damage === 'journal') {
      const db = new DatabaseSync(join(f.root, 'journal.sqlite'));
      db.prepare('UPDATE journal SET body=?').run('{broken');
      db.close();
    }
    if (damage === 'config')
      await writeFile(join(f.repository, 'config'), '[include]\npath = /unowned\n');
    if (damage === 'metadata-directory') {
      await rename(join(f.repository, 'objects'), join(f.repository, 'preserved-objects'));
      await mkdir(join(f.repository, 'objects'), { mode: 0o700 });
    }
    if (damage === 'source-directory') {
      await rename(join(f.source, 'src'), join(f.source, 'human-src'));
      await mkdir(join(f.source, 'src'), { mode: 0o700 });
      await writeFile(join(f.source, 'src/main.ts'), 'A\n', { mode: 0o600 });
    }
    if (damage === 'source-directory') {
      const reopened = await WorkspaceStore.open({ directory: f.root, regressionDirectory });
      t.after(() => reopened.close());
      assert.equal((await reopened.inspect(f.id)).state, 'uncertain');
      await assert.rejects(
        reopened.freeze(f.id, f.workspace.checkpoint.revision),
        /workspace-not-ready/,
      );
      assert.equal(await readFile(join(f.source, 'human-src/main.ts'), 'utf8'), 'A\n');
    } else await assert.rejects(WorkspaceStore.open({ directory: f.root, regressionDirectory }));
  });

test('workspace never inherits hostile Git configuration, execution canaries or parent environment', async (t) => {
  const parent = await temporary(t),
    root = join(parent, 'store');
  await mkdir(root, { mode: 0o700 });
  const hit = join(parent, 'executed'),
    trace = join(parent, 'trace'),
    canary = join(parent, 'canary.sh');
  await writeFile(canary, `#!/bin/sh\nprintf executed >> '${hit}'\nenv >> '${hit}'\n`, {
    mode: 0o700,
  });
  const global = join(parent, 'hostile-config');
  await writeFile(
    global,
    `[core]\n hooksPath = ${parent}\n fsmonitor = ${canary}\n[filter "evil"]\n clean = ${canary}\n smudge = ${canary}\n required = true\n[commit]\n gpgSign = true\n[gpg]\n program = ${canary}\n[credential]\n helper = !${canary}\n`,
  );
  for (const name of ['post-checkout', 'pre-commit', 'post-commit', 'reference-transaction'])
    await writeFile(join(parent, name), await readFile(canary), { mode: 0o700 });
  const values = {
    HOME: parent,
    XDG_CONFIG_HOME: parent,
    GIT_CONFIG_GLOBAL: global,
    GIT_CONFIG_SYSTEM: global,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'include.path',
    GIT_CONFIG_VALUE_0: '/nonexistent-hostile-config',
    GIT_TRACE: trace,
    GIT_TRACE2_EVENT: trace,
    GIT_TRACE2_ENV_VARS: 'WORKSPACE_SECRET_CANARY',
    GIT_AUTHOR_NAME: 'WORKSPACE_SECRET_CANARY',
    GIT_COMMITTER_NAME: 'WORKSPACE_SECRET_CANARY',
    GIT_OBJECT_DIRECTORY: join(parent, 'unowned-objects'),
    GIT_TEMPLATE_DIR: parent,
    GIT_EXTERNAL_DIFF: canary,
    GIT_ASKPASS: canary,
    GIT_SSH: canary,
    WORKSPACE_SECRET_CANARY: 'DO_NOT_INHERIT_ME',
  };
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of previous)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  const store = await WorkspaceStore.open({ directory: root, regressionDirectory });
  t.after(() => store.close());
  const id = caseId(randomUUID()),
    repo = repositoryId(randomUUID());
  const w = ready(
    await store.provision({
      caseId: id,
      repositoryId: repo,
      baseline: [
        file('.gitattributes', '*.ts filter=evil diff=evil\n'),
        file('src/main.ts', '$Id$\r\nA'),
      ],
    }),
  );
  const initial = await store.read(id, virtualPath('src/main.ts'));
  const saved = await store.edit(
    id,
    w.checkpoint.revision,
    edit('src/main.ts', initial.sha256, '$Id$\r\nB'),
  );
  assert.equal(
    (
      await commitBlob(
        join(root, 'repositories', `${repo}.git`),
        saved.checkpoint.revision,
        'src/main.ts',
      )
    ).toString(),
    '$Id$\r\nB',
  );
  const commit = await object(
    join(root, 'repositories', `${repo}.git`),
    saved.checkpoint.revision,
    'commit',
  );
  assert.match(commit.toString(), /author Workspace broker <workspace@invalid>/);
  assert.doesNotMatch(commit.toString(), /WORKSPACE_SECRET_CANARY|DO_NOT_INHERIT_ME/);
  const frozen = await store.freeze(id, saved.checkpoint.revision);
  await store.exportRevision(frozen);
  assert.equal((await readdir(parent)).includes('executed'), false);
  assert.equal((await readdir(parent)).includes('trace'), false);
  assert.equal((await readdir(parent)).includes('unowned-objects'), false);
  await writeFile(join(root, 'repositories', `${repo}.git`, 'config'), await readFile(global));
  await assert.rejects(store.freeze(id, saved.checkpoint.revision));
  assert.equal((await readdir(parent)).includes('executed'), false);
});

test(
  'workspace owns one serialized store and bounds failed-attempt objects and export orphans',
  { timeout: 120000 },
  async (t) => {
    const f = await fixture(t, [file('src/main.ts', 'A')]);
    await assert.rejects(
      WorkspaceStore.open({ directory: f.root, regressionDirectory }),
      /workspace-already-open/,
    );
    let checkpoint = f.workspace.checkpoint,
      previous = (await f.store.read(f.id, virtualPath('src/main.ts'))).sha256,
      count = 0;
    while (true) {
      try {
        const r = await f.store.edit(
          f.id,
          checkpoint.revision,
          edit('src/main.ts', previous, `edit ${count}`),
        );
        checkpoint = r.checkpoint;
        previous = r.sha256;
        count++;
      } catch (e) {
        assert.match(String(e), /workspace-object-budget/);
        break;
      }
    }
    assert.ok(count > 0 && count <= workspaceLimits.attempts);
    const files = await allFiles(f.repository),
      before = await ref(f.repository, f.id);
    for (let i = 0; i < 4; i++)
      await assert.rejects(
        f.store.edit(f.id, checkpoint.revision, edit('src/main.ts', previous, `denied ${i}`)),
        /workspace-object-budget/,
      );
    assert.deepEqual(await allFiles(f.repository), files);
    assert.equal(await ref(f.repository, f.id), before);
    const frozen = await f.store.freeze(f.id, checkpoint.revision);
    for (let i = 0; i < workspaceLimits.exports; i++) await f.store.exportRevision(frozen);
    await assert.rejects(f.store.exportRevision(frozen), /workspace-export-limit/);
    assert.equal((await readdir(join(f.root, 'exports'))).length, workspaceLimits.exports);
    assert.ok((await lstat(join(f.root, 'journal.sqlite'))).size <= workspaceLimits.journalBytes);
  },
);

for (const point of [
  'after-provision-intent',
  'after-provision-repository',
  'after-provision-worktree',
  'after-intent',
  'after-file',
  'after-commit',
  'after-ref',
  'after-checkpoint',
  'before-response',
  'inside-journal-transaction',
] satisfies (WorkspaceFaultPoint | 'inside-journal-transaction')[])
  test(
    `workspace SIGKILL ${point} preserves intents or replays the durable receipt`,
    { timeout: 30000 },
    async (t) => {
      const root = await temporary(t),
        id = caseId(randomUUID()),
        repo = repositoryId(randomUUID()),
        request = requestId(randomUUID());
      const child = fork(
        new URL('./workspace-crash-worker.ts', import.meta.url),
        [root, point, id, repo, request],
        { env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
      );
      let errors = '';
      child.stderr!.on('data', (b) => {
        errors += b.toString();
      });
      t.after(() => {
        child.kill('SIGKILL');
      });
      const message: unknown = await Promise.race([
        once(child, 'message').then(([m]) => m),
        once(child, 'exit').then(() => {
          throw new Error(`early exit ${errors}`);
        }),
      ]);
      assert.ok(
        message && typeof message === 'object' && 'point' in message && message.point === point,
      );
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      const [, signal] = await exited;
      assert.equal(signal, 'SIGKILL');
      if (point === 'inside-journal-transaction') {
        const rollback = await readFile(join(root, 'journal.sqlite-journal'));
        assert.equal(rollback.subarray(0, 8).toString('hex'), 'd9d505f920a163d7');
      }
      const store = await WorkspaceStore.open({ directory: root, regressionDirectory });
      t.after(() => store.close());
      const status = await store.inspect(id),
        source = join(root, 'cases', id, 'src/main.ts');
      if (point === 'after-checkpoint' || point === 'before-response') {
        const current = ready(status),
          before = sha256('559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd');
        assert.ok(message && 'previous' in message && typeof message.previous === 'string');
        const expected = gitRevision(message.previous);
        const body: BrokerEdit = {
          requestId: request,
          virtualPath: virtualPath('src/main.ts'),
          expectedHash: before,
          bytes: Buffer.from('B'),
        };
        const saved = await store.edit(id, expected, body);
        assert.deepEqual(await store.edit(id, expected, body), saved);
        assert.deepEqual(saved.checkpoint, current.checkpoint);
        assert.equal(saved.requestId, request);
        assert.equal(saved.checkpoint.sequence, 1);
        assert.equal(await readFile(source, 'utf8'), 'B');
        await assert.rejects(
          store.edit(id, expected, { ...body, bytes: Buffer.from('C') }),
          /workspace-request-conflict/,
        );
      } else {
        assert.equal(status.state, 'uncertain');
        if (status.state !== 'uncertain') throw new Error('not uncertain');
        assert.equal(status.reason, 'interrupted-workspace-intent');
        if (point.startsWith('after-provision-')) {
          assert.equal(status.previous.state, 'provisioning');
          const before = await allFiles(root);
          if (point === 'after-provision-intent')
            assert.deepEqual(await readdir(join(root, 'cases')), []);
          else assert.ok(before.includes(`repositories/${repo}.git/config`));
          if (point === 'after-provision-worktree') assert.ok(before.includes(`cases/${id}/.git`));
          await assert.rejects(
            store.provision({
              caseId: id,
              repositoryId: repo,
              baseline: [file('src/main.ts', 'C')],
            }),
          );
          assert.deepEqual(await allFiles(root), before);
          await assert.rejects(
            store.freeze(id, gitRevision('1'.repeat(40))),
            /workspace-not-ready/,
          );
        } else {
          assert.equal(status.previous.state, 'checkpoint');
          assert.equal(
            await readFile(source, 'utf8'),
            point === 'after-intent' || point === 'inside-journal-transaction' ? 'A' : 'B',
          );
          const beforeBytes = await readFile(source),
            beforeRef = await ref(join(root, 'repositories', `${repo}.git`), id);
          await assert.rejects(
            store.edit(id, gitRevision('1'.repeat(40)), {
              requestId: request,
              virtualPath: virtualPath('src/main.ts'),
              expectedHash: null,
              bytes: Buffer.from('replay'),
            }),
            /workspace-not-ready/,
          );
          await assert.rejects(store.freeze(id, gitRevision(beforeRef)), /workspace-not-ready/);
          assert.deepEqual(await readFile(source), beforeBytes);
          assert.equal(await ref(join(root, 'repositories', `${repo}.git`), id), beforeRef);
          const db = new DatabaseSync(join(root, 'journal.sqlite'), { readOnly: true });
          const body = db.prepare('SELECT body FROM journal').get()?.body;
          db.close();
          assert.equal(typeof body, 'string');
          if (typeof body !== 'string') throw new Error('no journal');
          assert.ok(body.includes('"payload":"Qg=="'));
          assert.ok(body.includes(request));
        }
        await store.close();
        const again = await WorkspaceStore.open({ directory: root, regressionDirectory });
        t.after(() => again.close());
        assert.equal((await again.inspect(id)).state, 'uncertain');
      }
    },
  );
