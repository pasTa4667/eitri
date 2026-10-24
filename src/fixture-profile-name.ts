import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import installedInputs from '../scripts/profile-reconciliation/installed-inputs.json' with { type: 'json' };
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

const applicationPaths = Object.freeze(installedInputs.map(({ path }) => virtualPath(path)));
const reconciliationPaths = [
  'src/lib/errors.js',
  'src/lib/errors.test.js',
  'src/App.test.jsx',
] as const;
type CapturedInput<P extends string> = Readonly<{
  virtualPath: VirtualPath & P;
  size: number;
  sha256: Sha256;
  bytes: Buffer;
}>;
export type ProfileNameReconciliationInputV1 = Readonly<{
  version: 1;
  kind: 'profile-name-reconciliation-input';
  provenance: Readonly<{ kind: 'uncommitted-copy' }>;
  files: readonly [
    CapturedInput<(typeof reconciliationPaths)[0]>,
    CapturedInput<(typeof reconciliationPaths)[1]>,
    CapturedInput<(typeof reconciliationPaths)[2]>,
  ];
  captureDigest: Sha256;
}>;

export type FixtureApplicationInputV1 = Readonly<{
  version: 1;
  kind: 'fixture-application-input';
  provenance: Readonly<{ kind: 'uncommitted-copy' }>;
  files: readonly CapturedInput<string>[];
  captureDigest: Sha256;
}>;

function capturedInput<P extends string>(path: P, bytes: Buffer): CapturedInput<P> {
  const validated = virtualPath(path) as VirtualPath & P;
  return { virtualPath: validated, size: bytes.length, sha256: sha256(checksum(bytes)), bytes };
}
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
  const [bytes] = await acquireFixedFiles(demonstrationDirectory, [reconciliationPaths[0]]);
  const { bytes: sourceBytes, ...source } = capturedInput(reconciliationPaths[0], bytes);
  const descriptor = {
    version: 1 as const,
    scenarioId: 'profile-name-v1' as const,
    provenance: { kind: 'uncommitted-copy' as const },
    source,
  };
  return {
    ...descriptor,
    source: { ...source, bytes: sourceBytes },
    captureDigest: sha256(digest(descriptor)),
  };
}

/** Captures three fixed raw inputs for later reconciliation, without executing or interpreting them. */
export async function captureProfileNameReconciliationInput(
  demonstrationDirectory: string,
): Promise<ProfileNameReconciliationInputV1> {
  const bytes = await acquireFixedFiles(demonstrationDirectory, reconciliationPaths);
  const files = [
    capturedInput(reconciliationPaths[0], bytes[0]),
    capturedInput(reconciliationPaths[1], bytes[1]),
    capturedInput(reconciliationPaths[2], bytes[2]),
  ] as const;
  const descriptor = {
    version: 1 as const,
    kind: 'profile-name-reconciliation-input' as const,
    provenance: { kind: 'uncommitted-copy' as const },
    files: files.map(({ virtualPath, size, sha256 }) => ({ virtualPath, size, sha256 })),
  };
  return { ...descriptor, files, captureDigest: sha256(digest(descriptor)) };
}

/** Captures fixed application inputs as data, not a reviewed-baseline or validation verdict. */
export async function captureFixtureApplicationInput(
  demonstrationDirectory: string,
): Promise<FixtureApplicationInputV1> {
  const bytes = await acquireFixedFiles(demonstrationDirectory, applicationPaths);
  const files = applicationPaths.map((path, index) => capturedInput(path, bytes[index]));
  const descriptor = {
    version: 1 as const,
    kind: 'fixture-application-input' as const,
    provenance: { kind: 'uncommitted-copy' as const },
    files: files.map(({ virtualPath, size, sha256 }) => ({ virtualPath, size, sha256 })),
  };
  return { ...descriptor, files, captureDigest: sha256(digest(descriptor)) };
}

async function acquireFixedFiles(
  demonstrationDirectory: string,
  selected: readonly string[],
): Promise<Buffer[]> {
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
      ...new Set(selected.map((path) => dirname(join(demonstrationDirectory, path)))),
    ];
    const directories = new Map<string, BigIntStats>();
    for (const parent of parents) {
      let directory = '/';
      for (const part of ['/', ...parent.split('/').filter(Boolean)]) {
        directory = join(directory, part);
        if (directories.has(directory)) continue;
        const stat = await lstat(directory, { bigint: true });
        if (!stat.isDirectory()) fail('unsafe-fixture-directory');
        directories.set(directory, stat);
      }
      if ((await realpath(parent)) !== parent) fail('unsafe-fixture-directory');
    }
    const sources = [];
    for (const virtualPath of selected) {
      const path = join(demonstrationDirectory, virtualPath);
      const before = await lstat(path, { bigint: true });
      if (!before.isFile() || before.nlink !== 1n) fail('unsafe-fixture-source');
      if (before.size > BigInt(workspaceLimits.fileBytes)) fail('fixture-size-limit');
      sources.push({ path, before });
    }
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
    const handles: FileHandle[] = [];
    const buffers: Buffer[] = [];
    try {
      for (const { path, before } of sources) {
        await recheckDirectories();
        const file = await open(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        handles.push(file);
        const opened = await file.stat({ bigint: true });
        if (!opened.isFile() || opened.nlink !== 1n) fail('unsafe-fixture-source');
        if (!sameSource(before, opened)) fail('fixture-source-changed');
        const bytes = Buffer.alloc(Number(before.size));
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
          if (!bytesRead) fail('fixture-source-changed');
          offset += bytesRead;
        }
        const probe = Buffer.alloc(1);
        if ((await file.read(probe, 0, 1, offset)).bytesRead) fail('fixture-source-changed');
        buffers.push(bytes);
      }
      for (const [index, { path, before }] of sources.entries()) {
        if (!sameSource(before, await handles[index].stat({ bigint: true })))
          fail('fixture-source-changed');
        if (!sameSource(before, await lstat(path, { bigint: true })))
          fail('fixture-source-changed');
      }
      await recheckDirectories();
    } finally {
      await Promise.allSettled(handles.map(async (file) => file.close())).then((closed) => {
        for (const result of closed) if (result.status === 'rejected') throw result.reason;
      });
    }
    return buffers;
  } catch (error) {
    if (error instanceof ControlError) throw error;
    const disappeared =
      error instanceof Error &&
      'code' in error &&
      ['ENOENT', 'ENOTDIR', 'ELOOP'].includes(String(error.code));
    return fail(acquired && disappeared ? 'fixture-source-changed' : 'fixture-source-unavailable');
  }
}
