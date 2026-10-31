import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

async function privatePath(path, directory, limit = 131072) {
  const stat = await lstat(path);
  assert.equal(stat.uid, process.getuid());
  assert.equal(stat.mode & 0o777, directory ? 0o700 : 0o600);
  assert.ok(
    directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1 && stat.size <= limit,
  );
}

// Offline composition only: explicit generated home, never ambient HOME or a default credential path.
// Pi owns auth.json. This non-secret lease is deliberately NOT a credential store or token repair.
export async function withDedicatedProfile(home, run) {
  let profile, authPath, lease;
  try {
    assert.ok(typeof home === 'string' && isAbsolute(home));
    assert.equal(await realpath(home), resolve(home));
    await privatePath(home, true);
    profile = home;
    for (const part of ['Library', 'Application Support', 'eitri', 'pi']) {
      profile = join(profile, part);
      await privatePath(profile, true);
    }
    authPath = join(profile, 'auth.json');
    await privatePath(authPath, false);
    lease = join(profile, 'eitri-use');
  } catch {
    throw new Error('sign-in-required');
  }
  try {
    // Atomic exclusion, not a PID scan. A crash/pending record is never automatically reclaimed.
    await mkdir(lease, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') {
      try {
        await privatePath(lease, true);
        await privatePath(join(lease, 'owner.json'), false, 128);
        const owner = JSON.parse(await readFile(join(lease, 'owner.json'), 'utf8'));
        assert.deepEqual(Object.keys(owner).sort(), ['pid', 'version']);
        assert.equal(owner.version, 1);
        assert.ok(Number.isSafeInteger(owner.pid) && owner.pid > 0);
        await lstat(join(lease, 'sign-in-required')).then(
          () => {
            throw new Error('blocked');
          },
          (e) => {
            if (e.code !== 'ENOENT') throw e;
          },
        );
        process.kill(owner.pid, 0);
      } catch {
        throw new Error('sign-in-required');
      }
      throw new Error('profile-in-use');
    }
    throw new Error('sign-in-required');
  }
  try {
    await writeFile(join(lease, 'owner.json'), JSON.stringify({ version: 1, pid: process.pid }), {
      flag: 'wx',
      mode: 0o600,
    });
    const result = await run({ profile, authPath });
    // The caller returns only after helper reaping AND resource disposal. Never unlink on failure.
    await privatePath(authPath, false);
    await unlink(join(lease, 'owner.json'));
    await rmdir(lease);
    return result;
  } catch {
    await writeFile(join(lease, 'sign-in-required'), '', { flag: 'wx', mode: 0o600 }).catch(
      () => {},
    );
    throw new Error('sign-in-required');
  }
}
