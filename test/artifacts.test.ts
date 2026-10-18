import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  chmod,
  writeFile,
  symlink,
  link,
  rename,
  lstat,
  truncate,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { ArtifactStore, artifactLimits, checksum, validateOutput } from '../src/artifacts.ts';
import type { Artifact } from '../src/domain.ts';

function chunk(kind: string, bytes: Buffer) {
  const data = Buffer.concat([Buffer.from(kind), bytes]);
  const size = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  crc.writeUInt32BE(crc32(data));
  return Buffer.concat([size, data, crc]);
}
function png(width = 1, height = 1, raw = Buffer.from([0, 255, 0, 0, 255])) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('artifact MIME validation bounds UTF-8, labels, PNG structure, dimensions and decompression', () => {
  const text = { label: 'Output', mime: 'text/plain' as const, bytes: Buffer.from('héllo\n') };
  assert.deepEqual(validateOutput(text), Buffer.from('héllo\n'));
  text.bytes.fill(0);
  assert.deepEqual(
    validateOutput({ ...text, bytes: Buffer.alloc(artifactLimits.textBytes, 97) }).length,
    artifactLimits.textBytes,
  );
  for (const output of [
    { ...text, bytes: Buffer.from([0xff]) },
    { ...text, bytes: Buffer.alloc(0) },
    { ...text, bytes: Buffer.alloc(artifactLimits.textBytes + 1) },
    { ...text, label: 'x'.repeat(129) },
    { ...text, label: 'bad\nlabel' },
    { ...text, mime: 'text/html' as 'text/plain' },
  ])
    assert.throws(() => validateOutput(output));
  const image = { label: 'Screenshot', mime: 'image/png' as const, bytes: png() };
  assert.deepEqual(validateOutput(image), png());
  const corrupt = png();
  corrupt[corrupt.length - 1] ^= 1;
  for (const bytes of [
    Buffer.from('89504e470d0a1a0a', 'hex'),
    corrupt,
    png(4097),
    png(4096, 4096),
    png(1, 1, Buffer.from([5, 0, 0, 0, 0])),
    png(1, 1, Buffer.alloc(1000)),
    png(1, 1, Buffer.alloc(1)),
    Buffer.concat([png(), Buffer.from([0])]),
    Buffer.alloc(artifactLimits.pngBytes + 1),
  ])
    assert.throws(() => validateOutput({ ...image, bytes }));
});

test('private immutable blobs reject unsafe identities, corruption, links and replaced directories', async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-artifacts-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const caseId = randomUUID();
  const caseDirectory = join(directory, 'cases', caseId);
  await mkdir(caseDirectory, { recursive: true, mode: 0o700 });
  const store = await ArtifactStore.open(directory, caseId);
  const bytes = Buffer.from('Immutable log.\n');
  const artifact: Artifact = {
    id: randomUUID(),
    caseId,
    actionId: randomUUID(),
    checkId: randomUUID(),
    revision: 'a'.repeat(40),
    configuration: 'b'.repeat(64),
    simulated: true,
    createdAt: 1,
    label: 'Log',
    mime: 'text/plain',
    size: bytes.length,
    sha256: checksum(bytes),
  };
  const path = join(caseDirectory, 'artifacts', artifact.id);
  await store.write(artifact, bytes);
  assert.deepEqual(await store.read(artifact), Buffer.from('Immutable log.\n'));
  assert.equal((await lstat(path)).mode & 0o777, 0o400);
  await assert.rejects(store.write(artifact, bytes), { code: 'EEXIST' });
  for (const changed of [
    { id: '../escape' },
    { caseId: randomUUID() },
    { size: 0 },
    { sha256: 'x' },
  ])
    await assert.rejects(store.read({ ...artifact, ...changed }));
  await chmod(path, 0o600);
  await writeFile(path, Buffer.from('Modified log!!\n'));
  await assert.rejects(store.read(artifact), { code: 'artifact-integrity' });
  await rm(path);
  const target = join(caseDirectory, 'target');
  await writeFile(target, bytes, { mode: 0o600 });
  await symlink(target, path);
  await assert.rejects(store.read(artifact));
  await assert.rejects(store.write(artifact, bytes), { code: 'unsafe-artifact-file' });
  await rm(path);
  await link(target, path);
  await assert.rejects(store.read(artifact), { code: 'unsafe-artifact-file' });
  await rm(path);
  const orphan = join(caseDirectory, 'artifacts', randomUUID());
  await writeFile(orphan, bytes, { mode: 0o600 });
  await truncate(orphan, artifactLimits.caseBytes);
  await assert.rejects(store.write(artifact, bytes), { code: 'artifact-case-limit' });
  await rm(orphan);
  const orphans = Array.from({ length: artifactLimits.caseCount }, () =>
    join(caseDirectory, 'artifacts', randomUUID()),
  );
  await Promise.all(orphans.map((path) => writeFile(path, bytes, { mode: 0o600 })));
  await assert.rejects(store.write(artifact, bytes), { code: 'artifact-case-limit' });
  await Promise.all(orphans.map((path) => rm(path)));
  await rename(join(caseDirectory, 'artifacts'), join(caseDirectory, 'old-artifacts'));
  await mkdir(join(caseDirectory, 'artifacts'), { mode: 0o700 });
  await assert.rejects(store.read(artifact), { code: 'unsafe-artifact-directory' });
  await assert.rejects(store.write(artifact, bytes), { code: 'unsafe-artifact-directory' });
  await rm(join(caseDirectory, 'artifacts'), { recursive: true });
  await symlink(join(caseDirectory, 'old-artifacts'), join(caseDirectory, 'artifacts'));
  await assert.rejects(ArtifactStore.open(directory, caseId), {
    code: 'unsafe-artifact-directory',
  });
});
