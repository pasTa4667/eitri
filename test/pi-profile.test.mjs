import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile, readFile, rm, chmod, symlink, link, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { withDedicatedProfile } from '../prototypes/pi-profile.mjs';

import { syntheticProfile } from './helpers/pi-profile.mjs';

test('explicit dedicated profile uses fixed private paths, never initializes credentials or defaults to HOME', async (t) => {
  const p = await syntheticProfile(t);
  const bytes = await readFile(p.authPath);
  await assert.rejects(
    withDedicatedProfile(undefined, () => assert.fail()),
    /sign-in-required/,
  );
  await withDedicatedProfile(p.home, async (paths) => {
    assert.deepEqual(paths, { profile: p.profile, authPath: p.authPath });
  });
  await withDedicatedProfile(p.home, async () => {});
  assert.deepEqual(await readFile(p.authPath), bytes);
  await rm(p.authPath);
  await assert.rejects(
    withDedicatedProfile(p.home, () => assert.fail()),
    /sign-in-required/,
  );
  await assert.rejects(lstat(p.authPath), { code: 'ENOENT' });
});

for (const unsafe of [
  'directory-mode',
  'file-mode',
  'symlink-file',
  'symlink-directory',
  'hardlink',
  'oversize',
])
  test(`private profile refuses ${unsafe} without repair or callback`, async (t) => {
    const p = await syntheticProfile(t);
    if (unsafe === 'directory-mode') await chmod(p.profile, 0o755);
    if (unsafe === 'file-mode') await chmod(p.authPath, 0o644);
    if (unsafe === 'hardlink') await link(p.authPath, join(p.home, 'alias'));
    if (unsafe === 'oversize') await writeFile(p.authPath, 'x'.repeat(131073));
    if (unsafe === 'symlink-file') {
      await rm(p.authPath);
      await writeFile(join(p.home, 'other'), '{}', { mode: 0o600 });
      await symlink(join(p.home, 'other'), p.authPath);
    }
    if (unsafe === 'symlink-directory') {
      await rm(p.profile, { recursive: true });
      await mkdir(join(p.home, 'other'), { mode: 0o700 });
      await symlink(join(p.home, 'other'), p.profile);
    }
    await assert.rejects(
      withDedicatedProfile(p.home, () => assert.fail()),
      /^Error: sign-in-required$/,
    );
  });

test('exclusive profile ownership lasts until callback disposal, not just terminal delivery', async (t) => {
  const p = await syntheticProfile(t);
  const entered = Promise.withResolvers();
  const dispose = Promise.withResolvers();
  const first = withDedicatedProfile(p.home, async () => {
    entered.resolve();
    await dispose.promise;
  });
  await entered.promise;
  await assert.rejects(
    withDedicatedProfile(p.home, () => assert.fail()),
    /profile-in-use/,
  );
  dispose.resolve();
  await first;
  await withDedicatedProfile(p.home, async () => {});
});

test('failure is permanently sign-in required across reopen; error text and credentials never enter ownership record', async (t) => {
  const p = await syntheticProfile(t);
  const bytes = await readFile(p.authPath);
  await assert.rejects(
    withDedicatedProfile(p.home, () => {
      throw new Error('synthetic-secret-do-not-log');
    }),
    /^Error: sign-in-required$/,
  );
  await assert.rejects(
    withDedicatedProfile(p.home, () => assert.fail()),
    /^Error: sign-in-required$/,
  );
  assert.deepEqual(await readFile(p.authPath), bytes);
  assert.deepEqual(JSON.parse(await readFile(join(p.profile, 'eitri-use', 'owner.json'), 'utf8')), {
    version: 1,
    pid: process.pid,
  });
});

test('abrupt owner death never reuses uncertain profile even after the process is gone', async (t) => {
  const p = await syntheticProfile(t);
  const child = fork(new URL('./helpers/pi-profile-owner.mjs', import.meta.url), [p.home], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const exited = once(child, 'exit');
  t.after(async () => {
    child.kill('SIGKILL');
    await exited;
  });
  await once(child, 'message');
  await assert.rejects(
    withDedicatedProfile(p.home, () => assert.fail()),
    /profile-in-use/,
  );
  child.kill('SIGKILL');
  await exited;
  await assert.rejects(
    withDedicatedProfile(p.home, () => assert.fail()),
    /^Error: sign-in-required$/,
  );
  await assert.rejects(
    withDedicatedProfile(p.home, () => assert.fail()),
    /^Error: sign-in-required$/,
  );
});
