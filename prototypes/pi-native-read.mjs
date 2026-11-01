import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { captureProfileNameFixture } from '../src/fixture-profile-name.ts';

const path = 'src/lib/errors.js';
const digest = (content) => createHash('sha256').update(content).digest('hex');

// Trusted test seam only. CLI/model input cannot choose the checkout or virtual path.
// Reuses the existing quiescent-directory, no-symlink/single-link capture boundary.
export async function captureNativeReadFixture(
  directory = fileURLToPath(new URL('../../eitri-test-web-app', import.meta.url)),
) {
  const { source } = await captureProfileNameFixture(directory);
  return nativeReadResult(source.bytes);
}

// Also used for the already reviewed immutable application capture, without a second checkout read.
export function nativeReadResult(bytes) {
  assert.ok(bytes.length > 0 && bytes.length <= 4096);
  const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const result = JSON.stringify({ path, sha256: digest(bytes), content });
  validateNativeReadResult(result);
  return result;
}

export function validateNativeReadResult(text) {
  assert.equal(typeof text, 'string');
  assert.ok(Buffer.byteLength(text) <= 32_768);
  const value = JSON.parse(text);
  assert.deepEqual(Object.keys(value).sort(), ['content', 'path', 'sha256']);
  assert.equal(value.path, path);
  assert.equal(typeof value.content, 'string');
  assert.ok(value.content.isWellFormed());
  assert.ok(Buffer.byteLength(value.content) > 0 && Buffer.byteLength(value.content) <= 4096);
  assert.equal(value.sha256, digest(value.content));
  return value.sha256;
}
