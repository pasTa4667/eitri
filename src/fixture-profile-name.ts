import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { checksum } from './artifacts.ts';
import { ControlError, digest, fail } from './domain.ts';
import { sha256, virtualPath, workspaceLimits } from './workspace.ts';
import type { Sha256, VirtualPath } from './workspace.ts';

export type ProfileNameFixtureCaptureV1 = Readonly<{
  version: 1;
  scenarioId: 'profile-name-v1';
  provenance: Readonly<{ kind: 'uncommitted-copy' }>;
  source: Readonly<{
    virtualPath: VirtualPath;
    size: number;
    sha256: Sha256;
    bytes: Buffer;
  }>;
  captureDigest: Sha256;
}>;

const sourcePath = virtualPath('src/lib/errors.js');
const sameDirectory = (a: BigIntStats, b: BigIntStats) =>
  b.isDirectory() && a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
const sameSource = (a: BigIntStats, b: BigIntStats) =>
  b.isFile() &&
  b.nlink === 1n &&
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.mode === b.mode &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs;

/**
 * Requires a quiescent, operator-controlled directory. Node path APIs cannot contain hostile same-UID races.
 * Returned bytes are detached but mutable. Checksums do not authenticate source or establish a revision or scenario validity.
 */
export async function captureProfileNameFixture(
  demonstrationDirectory: string,
): Promise<ProfileNameFixtureCaptureV1> {
  if (
    typeof demonstrationDirectory !== 'string' ||
    !demonstrationDirectory.isWellFormed() ||
    !isAbsolute(demonstrationDirectory) ||
    Buffer.byteLength(demonstrationDirectory) > 4096 ||
    /\p{C}/u.test(demonstrationDirectory) ||
    resolve(demonstrationDirectory) !== demonstrationDirectory
  )
    fail('invalid-fixture-directory');

  let acquired = false;
  try {
    const parents = [
      demonstrationDirectory,
      join(demonstrationDirectory, 'src'),
      join(demonstrationDirectory, 'src/lib'),
    ];
    const directories = new Map<string, BigIntStats>();
    let directory = '/';
    for (const part of ['/', ...parents[2].split('/').filter(Boolean)]) {
      directory = join(directory, part);
      const stat = await lstat(directory, { bigint: true });
      if (!stat.isDirectory()) fail('unsafe-fixture-directory');
      directories.set(directory, stat);
    }
    for (const path of parents) {
      if ((await realpath(path)) !== path) fail('unsafe-fixture-directory');
    }
    const path = join(demonstrationDirectory, sourcePath);
    const before = await lstat(path, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n) fail('unsafe-fixture-source');
    if (before.size > BigInt(workspaceLimits.fileBytes)) fail('fixture-size-limit');
    acquired = true;

    const recheckDirectories = async () => {
      for (const [directory, stat] of directories) {
        if (!sameDirectory(stat, await lstat(directory, { bigint: true })))
          fail('fixture-source-changed');
      }
      for (const directory of parents) {
        if ((await realpath(directory)) !== directory) fail('fixture-source-changed');
      }
    };
    await recheckDirectories();
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      const opened = await file.stat({ bigint: true });
      if (!opened.isFile() || opened.nlink !== 1n) fail('unsafe-fixture-source');
      if (!sameSource(before, opened)) fail('fixture-source-changed');
      bytes = Buffer.alloc(Number(before.size));
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) fail('fixture-source-changed');
        offset += bytesRead;
      }
      const probe = Buffer.alloc(1);
      if ((await file.read(probe, 0, 1, offset)).bytesRead) fail('fixture-source-changed');
      if (!sameSource(before, await file.stat({ bigint: true }))) fail('fixture-source-changed');
      if (!sameSource(before, await lstat(path, { bigint: true }))) fail('fixture-source-changed');
      await recheckDirectories();
    } finally {
      await file.close();
    }
    const descriptor = {
      version: 1 as const,
      scenarioId: 'profile-name-v1' as const,
      provenance: { kind: 'uncommitted-copy' as const },
      source: { virtualPath: sourcePath, size: bytes.length, sha256: sha256(checksum(bytes)) },
    };
    return {
      ...descriptor,
      source: { ...descriptor.source, bytes },
      captureDigest: sha256(digest(descriptor)),
    };
  } catch (error) {
    if (error instanceof ControlError) throw error;
    const disappeared =
      error instanceof Error &&
      'code' in error &&
      ['ENOENT', 'ENOTDIR', 'ELOOP'].includes(String(error.code));
    return fail(acquired && disappeared ? 'fixture-source-changed' : 'fixture-source-unavailable');
  }
}
