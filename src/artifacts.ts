import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { crc32, inflateSync } from 'node:zlib';
import { fail, text, uuid } from './domain.ts';
import type { Artifact, ArtifactOutput } from './domain.ts';

export const artifactLimits = {
  textBytes: 256 * 1024,
  pngBytes: 4 * 1024 * 1024,
  dimension: 4096,
  pixels: 16_000_000,
  checkCount: 8,
  checkBytes: 8 * 1024 * 1024,
  caseCount: 128,
  caseBytes: 32 * 1024 * 1024,
  checks: 256,
} as const;
export const checksum = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const validLabel = (value: unknown): value is string =>
  text(value, 128) &&
  value.isWellFormed() &&
  [...value].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127);
export function validateOutput(output: ArtifactOutput): Buffer {
  if (
    !output ||
    !validLabel(output.label) ||
    !(output.bytes instanceof Uint8Array) ||
    !['text/plain', 'image/png'].includes(output.mime)
  )
    return fail('invalid-artifact');
  const max = output.mime === 'text/plain' ? artifactLimits.textBytes : artifactLimits.pngBytes;
  if (!output.bytes.byteLength || output.bytes.byteLength > max) fail('artifact-size-limit');
  const bytes = Buffer.from(output.bytes);
  if (output.mime === 'text/plain') {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      fail('invalid-artifact-utf8');
    }
  } else validatePng(bytes);
  return bytes;
}
export function validateArtifact(artifact: Artifact, caseId: string) {
  if (
    !artifact ||
    Object.keys(artifact).some(
      (key) =>
        ![
          'id',
          'caseId',
          'actionId',
          'checkId',
          'revision',
          'configuration',
          'simulated',
          'createdAt',
          'label',
          'mime',
          'size',
          'sha256',
        ].includes(key),
    ) ||
    artifact.caseId !== caseId ||
    ![artifact.id, artifact.caseId, artifact.actionId, artifact.checkId].every(uuid) ||
    typeof artifact.revision !== 'string' ||
    !/^[0-9a-f]{40,64}$/.test(artifact.revision) ||
    ![artifact.configuration, artifact.sha256].every(
      (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value),
    ) ||
    artifact.simulated !== true ||
    !Number.isSafeInteger(artifact.createdAt) ||
    artifact.createdAt < 0 ||
    !validLabel(artifact.label) ||
    !['text/plain', 'image/png'].includes(artifact.mime) ||
    !Number.isSafeInteger(artifact.size) ||
    artifact.size < 1 ||
    artifact.size >
      (artifact.mime === 'text/plain' ? artifactLimits.textBytes : artifactLimits.pngBytes)
  )
    fail('invalid-artifact-manifest');
}

function validatePng(bytes: Buffer) {
  const invalid = () => fail('invalid-artifact-png');
  if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) invalid();
  let offset = 8,
    width = 0,
    height = 0,
    bits = 0,
    color = 0,
    interlace = 0,
    palette = false,
    ended = false,
    dataEnded = false;
  const data: Buffer[] = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) invalid();
    const size = bytes.readUInt32BE(offset);
    if (size > bytes.length - offset - 12) invalid();
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2].toUpperCase()) invalid();
    const chunk = bytes.subarray(offset + 8, offset + 8 + size);
    if (
      crc32(bytes.subarray(offset + 4, offset + 8 + size)) !== bytes.readUInt32BE(offset + 8 + size)
    )
      invalid();
    if (!width && type !== 'IHDR') invalid();
    if (type === 'IHDR') {
      if (offset !== 8 || size !== 13) invalid();
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bits = chunk[8];
      color = chunk[9];
      interlace = chunk[12];
      const depths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        !width ||
        !height ||
        width > artifactLimits.dimension ||
        height > artifactLimits.dimension ||
        width * height > artifactLimits.pixels ||
        !depths[color]?.includes(bits) ||
        chunk[10] !== 0 ||
        chunk[11] !== 0 ||
        interlace > 1
      )
        invalid();
    } else if (type === 'PLTE') {
      if (palette || data.length || [0, 4].includes(color) || !size || size % 3 || size > 768)
        invalid();
      if (color === 3 && size / 3 > 2 ** bits) invalid();
      palette = true;
    } else if (type === 'IDAT') {
      if (dataEnded || (color === 3 && !palette)) invalid();
      data.push(chunk);
    } else if (type === 'IEND') {
      if (size || !data.length || offset + 12 !== bytes.length) invalid();
      ended = true;
    } else if (type[0] === type[0].toUpperCase() || ['acTL', 'fcTL', 'fdAT'].includes(type))
      invalid();
    if (data.length && type !== 'IDAT') dataEnded = true;
    offset += size + 12;
  }
  if (!ended) invalid();
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const passes = interlace
    ? [
        [0, 0, 8, 8],
        [4, 0, 8, 8],
        [0, 4, 4, 8],
        [2, 0, 4, 4],
        [0, 2, 2, 4],
        [1, 0, 2, 2],
        [0, 1, 1, 2],
      ]
    : [[0, 0, 1, 1]];
  const rows = passes.map(([x, y, dx, dy]) => {
    const columns = Math.max(0, Math.ceil((width - x) / dx));
    const count = columns ? Math.max(0, Math.ceil((height - y) / dy)) : 0;
    return { count, size: 1 + Math.ceil((columns * channels[color] * bits) / 8) };
  });
  const expected = rows.reduce((sum, row) => sum + row.count * row.size, 0);
  try {
    const compressed = Buffer.concat(data);
    const decoded = inflateSync(compressed, {
      maxOutputLength: expected,
      info: true,
    }) as unknown as {
      buffer: Buffer;
      engine: { bytesWritten: number };
    };
    if (decoded.buffer.length !== expected || decoded.engine.bytesWritten !== compressed.length)
      invalid();
    let cursor = 0;
    for (const row of rows)
      for (let i = 0; i < row.count; i++, cursor += row.size)
        if (decoded.buffer[cursor] > 4) invalid();
  } catch {
    invalid();
  }
}

export class ArtifactStore {
  private directories: { path: string; dev: number; ino: number }[] = [];
  private caseId: string;
  private constructor(caseId: string) {
    this.caseId = caseId;
  }
  static async open(directory: string, caseId: string) {
    if (!uuid(caseId)) fail('unsafe-case-id');
    const store = new ArtifactStore(caseId);
    const paths = [directory, join(directory, 'cases'), join(directory, 'cases', caseId)];
    for (const path of paths) await store.remember(path);
    const artifacts = join(paths[2], 'artifacts');
    await mkdir(artifacts, { mode: 0o700 }).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
    await store.remember(artifacts);
    return store;
  }
  private async remember(path: string) {
    const stat = await lstat(path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.mode & 0o077 ||
      (await realpath(path)) !== path
    )
      fail('unsafe-artifact-directory');
    this.directories.push({ path, dev: stat.dev, ino: stat.ino });
  }
  private async path(artifact: Artifact) {
    validateArtifact(artifact, this.caseId);
    for (const directory of this.directories) {
      const stat = await lstat(directory.path);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        stat.mode & 0o077 ||
        stat.dev !== directory.dev ||
        stat.ino !== directory.ino ||
        (await realpath(directory.path)) !== directory.path
      )
        fail('unsafe-artifact-directory');
    }
    return join(this.directories[3].path, artifact.id);
  }
  async write(artifact: Artifact, bytes: Uint8Array) {
    const path = await this.path(artifact);
    const copy = validateOutput({ label: artifact.label, mime: artifact.mime, bytes });
    if (copy.length !== artifact.size || checksum(copy) !== artifact.sha256)
      fail('artifact-integrity');
    const entries = await readdir(this.directories[3].path);
    if (entries.length >= artifactLimits.caseCount) fail('artifact-case-limit');
    let total = copy.length;
    for (const id of entries) {
      if (!uuid(id)) fail('unsafe-artifact-file');
      const stat = await lstat(join(this.directories[3].path, id));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.mode & 0o077)
        fail('unsafe-artifact-file');
      total += stat.size;
    }
    if (total > artifactLimits.caseBytes) fail('artifact-case-limit');
    const file = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o400,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1) fail('unsafe-artifact-file');
      await file.writeFile(copy);
      await file.sync();
    } finally {
      await file.close();
    }
    await this.read(artifact);
  }
  async read(artifact: Artifact): Promise<Buffer> {
    const path = await this.path(artifact);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await file.stat();
      if (
        !before.isFile() ||
        before.nlink !== 1 ||
        before.mode & 0o077 ||
        before.size !== artifact.size
      )
        fail('unsafe-artifact-file');
      const bytes = Buffer.alloc(artifact.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) fail('artifact-integrity');
        offset += bytesRead;
      }
      const after = await file.stat();
      if (
        after.size !== before.size ||
        after.dev !== before.dev ||
        after.ino !== before.ino ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs ||
        after.nlink !== 1 ||
        checksum(bytes) !== artifact.sha256
      )
        fail('artifact-integrity');
      await this.path(artifact);
      const current = await lstat(path);
      if (
        current.dev !== before.dev ||
        current.ino !== before.ino ||
        !current.isFile() ||
        current.isSymbolicLink() ||
        current.nlink !== 1 ||
        current.mode & 0o077 ||
        current.size !== before.size ||
        current.mtimeMs !== before.mtimeMs ||
        current.ctimeMs !== before.ctimeMs
      )
        fail('artifact-integrity');
      return bytes;
    } finally {
      await file.close();
    }
  }
}
