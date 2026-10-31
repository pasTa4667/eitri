import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  chmod,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withProfileLogin } from '../prototypes/pi-profile-login.mjs';

async function fixture(t) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'eitri-profile-login-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const profile = join(home, 'Library', 'Application Support', 'eitri', 'pi');
  return { home, profile, authPath: join(profile, 'auth.json') };
}
const save = ({ authPath }) => writeFile(authPath, '{}', { mode: 0o600 });

test('explicit login initializes only its private suffix, and leaves Pi responsible for auth bytes', async (t) => {
  const p = await fixture(t);
  await withProfileLogin(p.home, false, save);
  assert.deepEqual(await readdir(p.profile), ['auth.json']);
  assert.equal(await readFile(p.authPath, 'utf8'), '{}');
});

test('live login ownership excludes concurrent login and is not reclaimed by explicit recovery', async (t) => {
  const p = await fixture(t);
  await withProfileLogin(p.home, false, async (paths) => {
    for (const recover of [false, true])
      await assert.rejects(withProfileLogin(p.home, recover, () => assert.fail()));
    await save(paths);
  });
});

test('failed login stays blocked until its process exits; errors never expose credential causes', async (t) => {
  const p = await fixture(t);
  await assert.rejects(
    withProfileLogin(p.home, false, () => {
      throw new Error('private-token');
    }),
    /^Error: sign-in-required$/,
  );
  await assert.rejects(
    withProfileLogin(p.home, true, () => assert.fail()),
    /^Error: sign-in-required$/,
  );
  assert.deepEqual(await readdir(join(p.profile, 'eitri-use')), ['owner.json']);
});

async function deadPid() {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  const pid = child.pid;
  await new Promise((resolve) => child.once('close', resolve));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  return pid;
}

for (const kind of ['login', 'native', 'pending', 'unknown-file', 'recovery-interrupted']) {
  test(`explicit recovery handles a dead ${kind} owner conservatively`, async (t) => {
    const p = await fixture(t);
    const lease = join(p.profile, 'eitri-use');
    await mkdir(lease, { recursive: true, mode: 0o700 });
    const owner =
      kind === 'native'
        ? { version: 1, pid: await deadPid() }
        : { version: 2, kind: 'login', pid: await deadPid() };
    if (kind !== 'pending')
      await writeFile(join(lease, 'owner.json'), JSON.stringify(owner), { mode: 0o600 });
    if (kind === 'unknown-file') await writeFile(join(lease, 'unexpected'), 'sentinel');
    if (kind === 'recovery-interrupted') await mkdir(join(lease, 'recovery'), { mode: 0o700 });
    await assert.rejects(withProfileLogin(p.home, false, () => assert.fail()));
    if (kind === 'login') {
      await withProfileLogin(p.home, true, save);
      assert.deepEqual(await readdir(p.profile), ['auth.json']);
    } else {
      await assert.rejects(withProfileLogin(p.home, true, () => assert.fail()));
      assert.ok((await readdir(p.profile)).includes('eitri-use'));
    }
  });
}

for (const kind of [
  'linked-parent',
  'public-directory',
  'linked-auth',
  'public-auth',
  'oversized-auth',
]) {
  test(`login refuses ${kind} without repairing paths or starting Pi`, async (t) => {
    const p = await fixture(t);
    await mkdir(p.profile, { recursive: true, mode: 0o700 });
    if (kind === 'linked-parent') {
      await rm(p.profile, { recursive: true });
      await symlink(p.home, p.profile);
    } else if (kind === 'public-directory') await chmod(p.profile, 0o755);
    else if (kind === 'linked-auth') await symlink(join(p.home, 'sentinel'), p.authPath);
    else
      await writeFile(p.authPath, kind === 'oversized-auth' ? 'a'.repeat(131073) : '{}', {
        mode: kind === 'public-auth' ? 0o644 : 0o600,
      });
    await assert.rejects(
      withProfileLogin(p.home, false, () => assert.fail()),
      /^Error: sign-in-required$/,
    );
  });
}

test('default and invalid login CLI arguments do not open a profile', async (t) => {
  const p = await fixture(t);
  for (const args of [[], ['--help'], ['--recover'], ['--run', '--unknown'], ['--run', '--run']]) {
    const result = spawnSync(process.execPath, ['scripts/test-pi-login.mjs', ...args], {
      encoding: 'utf8',
      env: { HOME: p.home, PATH: process.env.PATH },
    });
    assert.equal(result.status, args.length === 0 || args[0] === '--help' ? 0 : 1);
    assert.match(result.stdout + result.stderr, /Usage:/);
    assert.deepEqual(await readdir(p.home), []);
  }
});

test('nonterminal login refuses before real home access', async (t) => {
  const p = await fixture(t);
  const result = spawnSync(process.execPath, ['scripts/test-pi-login.mjs', '--run'], {
    encoding: 'utf8',
    env: { HOME: p.home, PATH: process.env.PATH },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /macOS terminal/);
  assert.deepEqual(await readdir(p.home), []);
});
