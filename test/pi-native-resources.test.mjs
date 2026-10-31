import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtemp,
  realpath,
  rm,
  readdir,
  lstat,
  readFile,
  writeFile,
  mkdir,
  symlink,
  chmod,
  unlink,
  rmdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  createNativeResource,
  reconcileNativeResources,
} from '../prototypes/pi-native-resources.mjs';

async function exitedPid() {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await once(child, 'close');
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  return child.pid;
}

async function fixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-resource-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const request = { caseId: randomUUID(), actionId: randomUUID(), epoch: 3 };
  const resource = await createNativeResource(directory, request);
  const root = join(directory, 'pi-offline-resources');
  const leaf = join(root, request.actionId);
  const record = join(leaf, 'owner.json');
  return { directory, request, resource, root, leaf, record };
}

for (const mutation of [
  'pending-pid',
  'live-pid',
  'bad-json',
  'extra-field',
  'wrong-action',
  'wrong-case',
  'bad-epoch',
  'oversized',
  'next-file',
  'home-data',
  'linked-home',
  'linked-record',
  'linked-leaf',
  'linked-root',
  'public-record',
  'public-root',
])
  test(`orphan reconciliation refuses ${mutation} without deleting or signaling unrelated resources`, async (t) => {
    const f = await fixture(t);
    const sentinel = join(f.directory, 'global-auth-sentinel');
    await mkdir(sentinel, { mode: 0o700 });
    await writeFile(join(sentinel, 'synthetic.json'), 'synthetic-global-auth-unchanged', {
      mode: 0o600,
    });
    // A live (possibly reused) PID is never signaled by recovery.
    const dead = await exitedPid();
    if (mutation !== 'pending-pid')
      await f.resource.spawned(mutation === 'live-pid' ? process.pid : dead);
    const owner = { ...JSON.parse(await readFile(f.record, 'utf8')), controllerPid: dead };
    await writeFile(f.record, JSON.stringify(owner));
    if (mutation === 'bad-json') await writeFile(f.record, '{');
    if (mutation === 'extra-field')
      await writeFile(f.record, JSON.stringify({ ...owner, home: sentinel }));
    if (mutation === 'wrong-action')
      await writeFile(f.record, JSON.stringify({ ...owner, actionId: randomUUID() }));
    if (mutation === 'wrong-case')
      await writeFile(f.record, JSON.stringify({ ...owner, caseId: '../global-auth-sentinel' }));
    if (mutation === 'bad-epoch') await writeFile(f.record, JSON.stringify({ ...owner, epoch: 0 }));
    if (mutation === 'oversized') await writeFile(f.record, ' '.repeat(1025));
    if (mutation === 'next-file') await writeFile(join(f.leaf, 'owner.next'), '{}');
    if (mutation === 'home-data') await writeFile(join(f.resource.home, 'unexpected'), 'retain');
    if (mutation === 'linked-home') {
      await rmdir(f.resource.home);
      await symlink(sentinel, f.resource.home);
    }
    if (mutation === 'linked-record') {
      await unlink(f.record);
      await symlink(join(sentinel, 'synthetic.json'), f.record);
    }
    if (mutation === 'linked-leaf') {
      await f.resource.dispose();
      await symlink(sentinel, f.leaf);
    }
    if (mutation === 'linked-root') {
      await f.resource.dispose();
      await rmdir(f.root);
      await symlink(sentinel, f.root);
    }
    if (mutation === 'public-record') await chmod(f.record, 0o644);
    if (mutation === 'public-root') await chmod(f.root, 0o755);
    await assert.rejects(reconcileNativeResources(f.directory, { timeoutMs: 0 }), {
      message: 'pi-native-resource-reconciliation-failed',
    });
    assert.equal(
      await readFile(join(sentinel, 'synthetic.json'), 'utf8'),
      'synthetic-global-auth-unchanged',
    );
    assert.ok(await lstat(f.root));
    if (mutation === 'linked-root') assert.ok((await lstat(f.root)).isSymbolicLink());
    else assert.ok(await lstat(f.leaf));
    if (mutation === 'home-data')
      assert.equal(await readFile(join(f.resource.home, 'unexpected'), 'utf8'), 'retain');
  });

test('dead ownership is removed idempotently, including empty-home and final-unlink crash gaps', async (t) => {
  const f = await fixture(t);
  // Obtain a genuine exited PID, not an assumed unused number.
  const dead = await exitedPid();
  await f.resource.spawned(dead);
  const owner = JSON.parse(await readFile(f.record, 'utf8'));
  await writeFile(f.record, JSON.stringify({ ...owner, controllerPid: dead }));
  await rmdir(f.resource.home); // Crash after home removal but before ownership unlink.
  const empty = join(f.root, randomUUID());
  await mkdir(empty, { mode: 0o700 }); // Crash before initial record, or after final unlink.
  await reconcileNativeResources(f.directory);
  assert.deepEqual(await readdir(f.root), []);
  await reconcileNativeResources(f.directory);
  assert.deepEqual(await readdir(f.root), []);
});

test('empty-home cleanup fails closed on unexpected SDK files after the helper exits', async (t) => {
  const f = await fixture(t);
  const pid = await exitedPid();
  await f.resource.spawned(pid);
  const owner = JSON.parse(await readFile(f.record, 'utf8'));
  await writeFile(f.record, JSON.stringify({ ...owner, controllerPid: pid }));
  await writeFile(join(f.resource.home, 'unexpected'), 'retain');
  await assert.rejects(reconcileNativeResources(f.directory), {
    message: 'pi-native-resource-reconciliation-failed',
  });
  assert.equal(await readFile(join(f.resource.home, 'unexpected'), 'utf8'), 'retain');
  assert.equal(JSON.parse(await readFile(f.record, 'utf8')).pid, pid);
});

test('recovery cannot dispose resources still owned by a live controller after helper exit', async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-live-owner-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const request = { caseId: randomUUID(), actionId: randomUUID(), epoch: 1 };
  const resource = await createNativeResource(directory, request);
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  const exited = once(child, 'close');
  await resource.spawned(child.pid);
  await exited;
  const record = join(directory, 'pi-offline-resources', request.actionId, 'owner.json');
  const before = await readFile(record);
  await assert.rejects(reconcileNativeResources(directory, { timeoutMs: 0 }), {
    message: 'pi-native-resource-reconciliation-failed',
  });
  assert.deepEqual(await readFile(record), before);
  assert.ok((await lstat(resource.home)).isDirectory());
  await resource.dispose();
});
