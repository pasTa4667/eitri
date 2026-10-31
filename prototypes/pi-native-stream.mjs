import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyInstalledSources } from './pi-stream.mjs';
import { createNativeResource } from './pi-native-resources.mjs';
import { withDedicatedProfile } from './pi-profile.mjs';
import { JsonLines, StreamReceiver, validateRequest, encodeLine } from './pi-stream-protocol.mjs';

// Offline test composition only. Exactly one admitted native model action, no tool loop.
// Source/configuration controls are not a sandbox for the trusted installed SDK.
export async function streamNativeFixture(value, options = {}) {
  if (options.profileHome !== undefined)
    return withDedicatedProfile(options.profileHome, (paths) =>
      streamFixture(value, options, paths),
    );
  return streamFixture(value, options);
}

async function streamFixture(
  value,
  { signal, onEvent, onSpawn, beforeCleanup, resourceDirectory, fixture = 'probe' },
  profilePaths,
) {
  const deadline = performance.now() + 10_000;
  let home;
  let resource;
  const check = () => {
    signal?.throwIfAborted();
    assert.ok(performance.now() < deadline);
  };
  try {
    check();
    assert.ok(['probe', 'repair-budget', 'profile-refresh'].includes(fixture));
    const request = validateRequest(value);
    const receiver = new StreamReceiver(request);
    const decoder = new JsonLines();
    await verifyInstalledSources();
    check();
    if (resourceDirectory) resource = await createNativeResource(resourceDirectory, request);
    home =
      resource?.home ?? (await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-native-stream-'))));
    check();
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('./pi-native-child.mjs', import.meta.url))],
      {
        cwd: home,
        env: {
          HOME: home,
          PI_CODING_AGENT_DIR: profilePaths?.profile ?? join(home, 'agent'),
          ...(profilePaths ? { EITRI_PI_NATIVE_AUTH_PATH: profilePaths.authPath } : {}),
          PI_OFFLINE: '1',
          PI_SKIP_VERSION_CHECK: '1',
          PI_TELEMETRY: '0',
          EITRI_PI_NATIVE_CHILD: 'synthetic-only',
          EITRI_PI_NATIVE_FIXTURE: fixture,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let failed = false;
    const cancel = () => {
      failed = true;
      child.kill('SIGKILL');
    };
    const closed = new Promise((resolve) => {
      child.on('error', cancel);
      child.stdin.on('error', cancel);
      child.stdout.on('error', cancel);
      child.stderr.on('error', cancel);
      child.stderr.on('data', cancel);
      child.stdout.on('data', (chunk) => {
        if (failed) return;
        try {
          check();
          for (const frame of decoder.push(chunk)) {
            const event = receiver.accept(frame);
            // Do not let native execute tools/commit success before clean child closure.
            if (!['done', 'error'].includes(event.type)) onEvent?.(event);
          }
        } catch {
          cancel();
        }
      });
      child.on('close', (code, exitSignal) => resolve({ code, exitSignal }));
    });
    const timer = setTimeout(cancel, Math.max(1, deadline - performance.now()));
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      try {
        check();
        if (resource) await resource.spawned(child.pid);
        check();
        onSpawn?.({ pid: child.pid, home });
        check();
        child.stdin.end(encodeLine(request));
      } catch {
        cancel();
      }
      const { code, exitSignal } = await closed;
      check();
      assert.ok(!failed && code === 0 && exitSignal === null);
      decoder.finish();
      const message = receiver.finish();
      assert.ok(['stop', 'toolUse'].includes(message.stopReason));
      return message;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  } catch {
    throw new Error('pi-native-stream-offline-failed');
  } finally {
    if (home)
      await Promise.resolve()
        .then(() => beforeCleanup?.())
        .finally(() => (resource ? resource.dispose() : rm(home, { recursive: true, force: true })))
        .catch(() => {
          throw new Error('pi-native-stream-offline-cleanup-failed');
        });
  }
}
