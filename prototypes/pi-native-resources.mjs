import assert from 'node:assert/strict';
import {
  mkdir,
  lstat,
  readFile,
  writeFile,
  rename,
  readdir,
  rmdir,
  unlink,
  realpath,
} from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
async function privatePath(path, directory) {
  const stat = await lstat(path);
  assert.ok(directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1);
  assert.equal(stat.uid, process.getuid());
  assert.equal(stat.mode & 0o777, directory ? 0o700 : 0o600);
  if (!directory) assert.ok(stat.size <= 1024);
}
async function rootPath(directory) {
  return join(await realpath(directory), 'pi-offline-resources');
}
async function removeEmptyResource(path) {
  const home = join(path, 'home');
  try {
    await privatePath(home, true);
    await rmdir(home); // Never recursively remove SDK output or follow a linked home.
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await unlink(join(path, 'owner.json'));
  await rmdir(path);
}

// Offline, single-controller composition only. Records contain no transcript or credentials.
export async function createNativeResource(directory, request) {
  assert.ok(uuid.test(request.caseId) && uuid.test(request.actionId));
  assert.ok(Number.isSafeInteger(request.epoch) && request.epoch > 0);
  const root = await rootPath(directory);
  await mkdir(root, { mode: 0o700, recursive: true });
  await privatePath(root, true);
  const path = join(root, request.actionId);
  await mkdir(path, { mode: 0o700 });
  const owner = {
    version: 1,
    caseId: request.caseId,
    actionId: request.actionId,
    epoch: request.epoch,
    controllerPid: process.pid,
    pid: null,
  };
  await writeFile(join(path, 'owner.json'), JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
  const home = join(path, 'home');
  await mkdir(home, { mode: 0o700 });
  return {
    home,
    async spawned(pid) {
      assert.ok(Number.isSafeInteger(pid) && pid > 0);
      owner.pid = pid;
      await writeFile(join(path, 'owner.next'), JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
      await rename(join(path, 'owner.next'), join(path, 'owner.json'));
    },
    // Caller must have awaited child closure, including on failure.
    dispose: () => removeEmptyResource(path),
  };
}

export async function reconcileNativeResources(directory, { timeoutMs = 12_000 } = {}) {
  try {
    assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 0 && timeoutMs <= 12_000);
    const deadline = performance.now() + timeoutMs;
    const root = await rootPath(directory);
    let names;
    try {
      await privatePath(root, true);
      names = await readdir(root);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    assert.ok(names.length <= 64);
    for (const name of names) {
      assert.ok(uuid.test(name));
      const path = join(root, name);
      await privatePath(path, true);
      const entries = await readdir(path);
      // Empty directory: crash before recording ownership, or after removing the record.
      if (entries.length === 0) {
        await rmdir(path);
        continue;
      }
      assert.ok(entries.every((entry) => ['owner.json', 'home'].includes(entry)));
      const record = join(path, 'owner.json');
      await privatePath(record, false);
      const owner = JSON.parse(await readFile(record, 'utf8'));
      assert.deepEqual(Object.keys(owner).sort(), [
        'actionId',
        'caseId',
        'controllerPid',
        'epoch',
        'pid',
        'version',
      ]);
      assert.equal(owner.version, 1);
      assert.ok(uuid.test(owner.caseId));
      assert.equal(owner.actionId, name);
      assert.ok(Number.isSafeInteger(owner.epoch) && owner.epoch > 0);
      assert.ok(Number.isSafeInteger(owner.controllerPid) && owner.controllerPid > 0);
      let controllerGone = false;
      try {
        process.kill(owner.controllerPid, 0);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
        controllerGone = true;
      }
      // Do not race a live controller's cooperative drainage, even after its helper exits.
      assert.ok(controllerGone);
      // The spawn/PID-save gap is uncertain. Never guess, kill a PID, or delete its home.
      assert.ok(Number.isSafeInteger(owner.pid) && owner.pid > 0);
      for (;;) {
        try {
          process.kill(owner.pid, 0);
        } catch (error) {
          if (error.code === 'ESRCH') break;
          throw error;
        }
        assert.ok(performance.now() < deadline);
        await delay(Math.min(20, Math.max(1, deadline - performance.now())));
      }
      // A reused/live PID conservatively blocks; ESRCH proves the old helper is gone.
      await removeEmptyResource(path);
    }
  } catch {
    throw new Error('pi-native-resource-reconciliation-failed');
  }
}
