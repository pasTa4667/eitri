import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  realpath,
  rm,
  readFile,
  writeFile,
  rename,
  lstat,
  readdir,
  symlink,
  link,
  mkdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { WorkspaceStore, virtualPath } from '../src/workspace.ts';

async function snapshot(root: string) {
  const entries: { path: string; mode: number; ino: number; bytes: Buffer | null }[] = [];
  async function walk(path: string) {
    const absolute = join(root, path),
      stat = await lstat(absolute);
    entries.push({
      path,
      mode: stat.mode,
      ino: stat.ino,
      bytes: stat.isDirectory() ? null : await readFile(absolute),
    });
    if (stat.isDirectory())
      for (const name of (await readdir(absolute)).sort())
        await walk(path ? `${path}/${name}` : name);
  }
  await walk('');
  return entries;
}

for (const damage of [
  'marker',
  'catalogue',
  'rollback-symlink',
  'rollback-hardlink',
  'rollback-mode',
] as const)
  test(`workspace ownership rejects ${damage} mismatch before catalogue mutation`, async (t) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'eitri-workspace-owner-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const options = { directory: root, regressionDirectory: virtualPath('test/regression') };
    const store = await WorkspaceStore.open(options);
    await store.close();
    const marker = join(root, 'workspace-owner'),
      catalogue = join(root, 'journal.sqlite'),
      rollback = join(root, 'journal.sqlite-journal');
    if (damage === 'marker') await writeFile(marker, '{}');
    if (damage === 'catalogue') {
      await rename(catalogue, join(root, 'preserved.sqlite'));
      await writeFile(catalogue, await readFile(join(root, 'preserved.sqlite')), { mode: 0o600 });
    }
    if (damage === 'rollback-symlink') await symlink(catalogue, rollback);
    if (damage === 'rollback-hardlink') await link(catalogue, rollback);
    if (damage === 'rollback-mode') await writeFile(rollback, 'unowned rollback', { mode: 0o640 });
    const before = await readFile(catalogue),
      beforeMarker = await readFile(marker),
      stat = await lstat(catalogue),
      names = (await readdir(root)).sort();
    await assert.rejects(WorkspaceStore.open(options));
    assert.deepEqual(await readFile(catalogue), before);
    assert.deepEqual(await readFile(marker), beforeMarker);
    assert.equal((await lstat(catalogue)).ino, stat.ino);
    assert.equal((await lstat(catalogue)).mode, stat.mode);
    assert.deepEqual((await readdir(root)).sort(), names);
  });

for (const damage of ['marker', 'catalogue', 'root'] as const)
  test(
    `workspace rejects hot-journal ${damage} identity mismatch without rollback or source mutation`,
    { timeout: 30000 },
    async (t) => {
      const parent = await realpath(await mkdtemp(join(tmpdir(), 'eitri-workspace-hot-owner-'))),
        root = join(parent, 'store');
      await mkdir(root, { mode: 0o700 });
      t.after(() => rm(parent, { recursive: true, force: true }));
      const child = fork(
        new URL('./workspace-crash-worker.ts', import.meta.url),
        [root, 'inside-journal-transaction', randomUUID(), randomUUID(), randomUUID()],
        { env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
      );
      t.after(() => {
        child.kill('SIGKILL');
      });
      let errors = '';
      child.stderr!.on('data', (bytes) => {
        errors += bytes.toString();
      });
      const message: unknown = await Promise.race([
        once(child, 'message').then(([value]) => value),
        once(child, 'exit').then(() => {
          throw new Error(`early exit ${errors}`);
        }),
      ]);
      assert.deepEqual(
        message && typeof message === 'object' && 'point' in message ? message.point : null,
        'inside-journal-transaction',
      );
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      const [, signal] = await exited;
      assert.equal(signal, 'SIGKILL');
      const rollback = await readFile(join(root, 'journal.sqlite-journal'));
      assert.equal(rollback.subarray(0, 8).toString('hex'), 'd9d505f920a163d7');
      if (damage === 'marker') await writeFile(join(root, 'workspace-owner'), '{}');
      if (damage === 'catalogue') {
        const original = join(parent, 'original.sqlite');
        await rename(join(root, 'journal.sqlite'), original);
        await writeFile(join(root, 'journal.sqlite'), await readFile(original), { mode: 0o600 });
      }
      if (damage === 'root') {
        const original = join(parent, 'original');
        await rename(root, original);
        await mkdir(root, { mode: 0o700 });
        for (const name of await readdir(original))
          await rename(join(original, name), join(root, name));
      }
      const before = await snapshot(root);
      await assert.rejects(
        WorkspaceStore.open({
          directory: root,
          regressionDirectory: virtualPath('test/regression'),
        }),
        /workspace-owner-mismatch/,
      );
      assert.deepEqual(await snapshot(root), before);
      assert.deepEqual(await readFile(join(root, 'journal.sqlite-journal')), rollback);
    },
  );

test('workspace incomplete store creation is never adopted or reinitialized', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'eitri-workspace-incomplete-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'journal.sqlite'), 'partial', { mode: 0o600 });
  await assert.rejects(
    WorkspaceStore.open({ directory: root, regressionDirectory: virtualPath('test/regression') }),
    /unowned-workspace-store/,
  );
  assert.equal(await readFile(join(root, 'journal.sqlite'), 'utf8'), 'partial');
  assert.deepEqual(await readdir(root), ['journal.sqlite']);
});
