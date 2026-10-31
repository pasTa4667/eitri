import assert from 'node:assert/strict';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

async function checked(path, directory, privateMode = true, limit = 131072) {
  const stat = await lstat(path);
  assert.equal(stat.uid, process.getuid());
  assert.ok(
    directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1 && stat.size <= limit,
  );
  assert.ok(
    privateMode ? (stat.mode & 0o777) === (directory ? 0o700 : 0o600) : (stat.mode & 0o022) === 0,
  );
}

async function loginOwner(lease) {
  await checked(join(lease, 'owner.json'), false, true, 128);
  const owner = JSON.parse(await readFile(join(lease, 'owner.json'), 'utf8'));
  assert.deepEqual(Object.keys(owner).sort(), ['kind', 'pid', 'version']);
  assert.equal(owner.version, 2);
  assert.ok(['login', 'probe'].includes(owner.kind));
  assert.ok(Number.isSafeInteger(owner.pid) && owner.pid > 0);
  return owner;
}

// Both callbacks are sole-process credential users, with no auth helper/agent, so ESRCH for the
// recorded PID proves its credential use ended. Explicit fresh login may reclaim a dead login or
// probe owner; an ordinary probe reclaims only a dead probe owner, never an interrupted login.
// Native v1 leases and live/unsignalable/ambiguous owners remain blocked.
export const withProfileLogin = (home, recover, login) =>
  withProfileOperation(home, recover, 'login', login);
export const withProfileProbe = (home, probe) => withProfileOperation(home, true, 'probe', probe);

async function withProfileOperation(home, recover, kind, run) {
  try {
    assert.ok(typeof home === 'string' && isAbsolute(home));
    assert.equal(await realpath(home), resolve(home));
    await checked(home, true, false);
    let profile = home;
    for (const [index, part] of ['Library', 'Application Support', 'eitri', 'pi'].entries()) {
      profile = join(profile, part);
      if (kind === 'login')
        await mkdir(profile, { mode: 0o700 }).catch((error) => {
          if (error.code !== 'EEXIST') throw error;
        });
      // Existing macOS Library/Application Support need not be 0700; never chmod them.
      await checked(profile, true, index >= 2);
    }
    const authPath = join(profile, 'auth.json');
    const checkAuthPath = () => checked(authPath, false);
    await checkAuthPath().catch((error) => {
      if (kind !== 'login' || error.code !== 'ENOENT') throw error;
    });
    const lease = join(profile, 'eitri-use');
    let fresh = false;
    try {
      await mkdir(lease, { mode: 0o700 });
      fresh = true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const owner = { version: 2, kind, pid: process.pid };
    if (fresh) {
      await writeFile(join(lease, 'owner.json'), JSON.stringify(owner), {
        flag: 'wx',
        mode: 0o600,
      });
    } else {
      assert.equal(recover, true);
      await checked(lease, true);
      assert.deepEqual((await readdir(lease)).sort(), ['owner.json']);
      // Pin the old directory while replacing its dead owner, excluding concurrent recovery.
      await mkdir(join(lease, 'recovery'), { mode: 0o700 });
      try {
        const previous = await loginOwner(lease);
        assert.ok(kind === 'login' || previous.kind === 'probe');
        let gone = false;
        try {
          process.kill(previous.pid, 0);
        } catch (error) {
          if (error.code === 'ESRCH') gone = true;
          else throw error;
        }
        assert.ok(gone);
        await writeFile(join(lease, 'owner.next'), JSON.stringify(owner), {
          flag: 'wx',
          mode: 0o600,
        });
        await rename(join(lease, 'owner.next'), join(lease, 'owner.json'));
      } finally {
        await rmdir(join(lease, 'recovery'));
      }
    }
    const result = await run({ profile, authPath });
    await checkAuthPath();
    assert.deepEqual(await loginOwner(lease), owner);
    assert.deepEqual(await readdir(lease), ['owner.json']);
    await unlink(join(lease, 'owner.json'));
    await rmdir(lease);
    return result;
  } catch {
    // Failure leaves the lease behind; only a later process can reclaim it after this one exits.
    throw new Error('sign-in-required');
  }
}
