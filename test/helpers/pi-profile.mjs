import { mkdtemp, realpath, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function syntheticProfile(t) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-profile-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const profile = join(home, 'Library', 'Application Support', 'eitri', 'pi');
  await mkdir(profile, { recursive: true, mode: 0o700 });
  const authPath = join(profile, 'auth.json');
  const credential = {
    type: 'oauth',
    access: 'synthetic-only',
    refresh: 'synthetic-only',
    expires: Date.now() + 3_600_000,
  };
  await writeFile(authPath, JSON.stringify({ 'eitri-offline': credential }), { mode: 0o600 });
  return { home, profile, authPath };
}
