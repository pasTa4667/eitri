import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const sdkRoot = '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent';
export const observations = Object.freeze({
  status: 'offline-seam-pass',
  sdkVersion: '1.4.0',
  nativeTypesVersion: '1.3.0',
  requests: 2,
  refreshes: 1,
  toolExecutions: 0,
  contextRoundTrip: true,
  ambientKeysAbsent: true,
  networkAttempts: 0,
});

export async function verifyInstalledSources() {
  const manifest = JSON.parse(
    await readFile(new URL('./pi-stream-source.json', import.meta.url), 'utf8'),
  );
  for (const [path, expected] of Object.entries(manifest)) {
    const url = path.startsWith('/') ? path : new URL(`../${path}`, import.meta.url);
    assert.equal(
      createHash('sha256')
        .update(await readFile(url))
        .digest('hex'),
      expected,
    );
  }
}

// Trusted test seam only: childPath is never accepted from CLI/model/case data.
// This runs a fixed synthetic program, NOT a provider transport or agent adapter.
export async function probePiStream({ childPath, timeoutMs = 10_000, signal } = {}) {
  let home;
  try {
    assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 10_000);
    signal?.throwIfAborted();
    await verifyInstalledSources();
    home = await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-stream-')));
    const pending = promisify(execFile)(
      process.execPath,
      childPath ? [childPath] : [fileURLToPath(new URL('./pi-stream-child.mjs', import.meta.url))],
      {
        cwd: home,
        env: {
          HOME: home,
          PI_CODING_AGENT_DIR: join(home, 'agent'),
          PI_OFFLINE: '1',
          PI_SKIP_VERSION_CHECK: '1',
          PI_TELEMETRY: '0',
          EITRI_PI_STREAM_CHILD: 'synthetic-only',
        },
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: 4096,
        encoding: 'utf8',
      },
    );
    // Node's built-in AbortSignal path can reject before close and uses SIGTERM.
    // Kill explicitly, then await execFile's close callback before releasing the home.
    const cancel = () => pending.child.kill('SIGKILL');
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    try {
      const { stdout, stderr } = await pending;
      signal?.throwIfAborted();
      assert.equal(stderr, '');
      assert.equal(stdout, `${JSON.stringify(observations)}\n`);
      return { ...observations };
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  } catch {
    throw new Error('pi-stream-offline-failed');
  } finally {
    // Only our generated directory, after execFile has closed/reaped its child.
    if (home) {
      await rm(home, { recursive: true, force: true }).catch(() => {
        throw new Error('pi-stream-offline-cleanup-failed');
      });
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
    console.log(
      'Usage: npm run probe:pi-stream -- --offline\nSynthetic SDK seam only; no login or inference.',
    );
  } else if (args.length === 1 && args[0] === '--offline') {
    try {
      console.log(JSON.stringify(await probePiStream()));
    } catch {
      console.error('pi-stream-offline-failed');
      process.exitCode = 1;
    }
  } else {
    console.error('Invalid arguments. Use --help.');
    process.exitCode = 2;
  }
}
