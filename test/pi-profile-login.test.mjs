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
import { withProfileLogin, withProfileProbe } from '../prototypes/pi-profile-login.mjs';

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

for (const kind of [
  'login',
  'probe',
  'native',
  'pending',
  'unknown-file',
  'recovery-interrupted',
]) {
  test(`explicit recovery handles a dead ${kind} owner conservatively`, async (t) => {
    const p = await fixture(t);
    const lease = join(p.profile, 'eitri-use');
    await mkdir(lease, { recursive: true, mode: 0o700 });
    const owner =
      kind === 'native'
        ? { version: 1, pid: await deadPid() }
        : { version: 2, kind: kind === 'probe' ? 'probe' : 'login', pid: await deadPid() };
    if (kind !== 'pending')
      await writeFile(join(lease, 'owner.json'), JSON.stringify(owner), { mode: 0o600 });
    if (kind === 'unknown-file') await writeFile(join(lease, 'unexpected'), 'sentinel');
    if (kind === 'recovery-interrupted') await mkdir(join(lease, 'recovery'), { mode: 0o700 });
    await assert.rejects(withProfileLogin(p.home, false, () => assert.fail()));
    if (kind === 'login' || kind === 'probe') {
      await withProfileLogin(p.home, true, save);
      assert.deepEqual(await readdir(p.profile), ['auth.json']);
    } else {
      await assert.rejects(withProfileLogin(p.home, true, () => assert.fail()));
      assert.ok((await readdir(p.profile)).includes('eitri-use'));
    }
  });
}

async function deadProbeLease(t, owner) {
  const p = await fixture(t);
  const lease = join(p.profile, 'eitri-use');
  await mkdir(lease, { recursive: true, mode: 0o700 });
  await writeFile(p.authPath, '{"sentinel":true}', { mode: 0o600 });
  if (owner) await writeFile(join(lease, 'owner.json'), JSON.stringify(owner), { mode: 0o600 });
  return { ...p, lease };
}

test('an ordinary probe reclaims only a dead probe owner, without sign-in, then releases', async (t) => {
  const p = await deadProbeLease(t, { version: 2, kind: 'probe', pid: await deadPid() });
  const seen = await withProfileProbe(p.home, async ({ authPath }) => {
    assert.equal(authPath, p.authPath);
    return JSON.parse(await readFile(join(p.lease, 'owner.json'), 'utf8'));
  });
  assert.deepEqual(seen, { version: 2, kind: 'probe', pid: process.pid });
  assert.deepEqual(await readdir(p.profile), ['auth.json']);
  assert.equal(await readFile(p.authPath, 'utf8'), '{"sentinel":true}');
});

for (const kind of [
  'dead-login',
  'dead-native',
  'pending',
  'unknown-file',
  'recovery-interrupted',
  'owner-next',
  'live-probe',
  'foreign-probe',
  'own-probe',
  'missing-auth',
]) {
  test(`an ordinary probe refuses a ${kind} lease without changing it`, async (t) => {
    let pid = await deadPid();
    if (kind === 'live-probe') {
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
        stdio: 'ignore',
      });
      const closed = new Promise((resolve) => child.once('close', resolve));
      t.after(async () => {
        child.kill('SIGKILL');
        await closed;
      });
      pid = child.pid;
    } else if (kind === 'foreign-probe') pid = 1; // Alive but not signalable: EPERM.
    else if (kind === 'own-probe') pid = process.pid; // A failed in-process probe never retries.
    const owner =
      kind === 'pending'
        ? undefined
        : kind === 'dead-native'
          ? { version: 1, pid }
          : { version: 2, kind: kind === 'dead-login' ? 'login' : 'probe', pid };
    const p = await deadProbeLease(t, owner);
    if (kind === 'unknown-file') await writeFile(join(p.lease, 'unexpected'), 'sentinel');
    if (kind === 'recovery-interrupted') await mkdir(join(p.lease, 'recovery'), { mode: 0o700 });
    if (kind === 'owner-next') await writeFile(join(p.lease, 'owner.next'), '{}', { mode: 0o600 });
    if (kind === 'missing-auth') await rm(p.authPath);
    const before = async () =>
      Promise.all(
        (await readdir(p.lease))
          .sort()
          .map(async (name) => [
            name,
            name === 'recovery' ? 'directory' : await readFile(join(p.lease, name), 'utf8'),
          ]),
      );
    const snapshot = await before();
    await assert.rejects(
      withProfileProbe(p.home, () => assert.fail('probe ran')),
      /^Error: sign-in-required$/,
    );
    assert.deepEqual(await before(), snapshot);
    assert.deepEqual(
      (await readdir(p.profile)).sort(),
      kind === 'missing-auth' ? ['eitri-use'] : ['auth.json', 'eitri-use'],
    );
  });
}

test('concurrent probes reclaim one dead probe owner at most once', async (t) => {
  const p = await deadProbeLease(t, { version: 2, kind: 'probe', pid: await deadPid() });
  let runs = 0;
  const results = await Promise.allSettled(
    [0, 1].map(() =>
      withProfileProbe(p.home, async () => {
        runs += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }),
    ),
  );
  assert.equal(runs, 1);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.deepEqual(await readdir(p.profile), ['auth.json']);
});

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
