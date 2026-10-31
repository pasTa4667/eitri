import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyInstalledSources } from './pi-stream.mjs';
import { createNativeResource } from './pi-native-resources.mjs';
import { withDedicatedProfile } from './pi-profile.mjs';
import { ControlError } from '../src/domain.ts';
import { JsonLines, StreamReceiver, validateRequest, encodeLine } from './pi-stream-protocol.mjs';
import { validateNativeDiagnostic } from './pi-native-diagnostics.mjs';

const codexProfiles = ['codex-profile', 'codex-profile-denied'];
const codexFixtures = [
  'codex-probe',
  'codex-denied',
  'codex-malformed',
  'codex-unknown',
  ...codexProfiles,
];

// Offline test composition only. Exactly one admitted native model action, no tool loop.
// Source/configuration controls are not a sandbox for the trusted installed SDK.
export async function streamNativeFixture(value, options = {}) {
  // Reject before opening/claiming any file profile: this composition is synthetic-only.
  if (codexProfiles.includes(options.fixture)) {
    // Only generated synthetic-profile homes under the OS temp root, never user profiles.
    if (
      typeof options.profileHome !== 'string' ||
      dirname(options.profileHome) !== (await realpath(tmpdir())) ||
      !/^eitri-pi-profile-[A-Za-z0-9]+$/.test(basename(options.profileHome))
    )
      throw new Error('pi-native-stream-offline-failed');
  } else if (codexFixtures.includes(options.fixture) && options.profileHome !== undefined)
    throw new Error('pi-native-stream-offline-failed');
  if (options.profileHome !== undefined)
    return withDedicatedProfile(options.profileHome, (paths) =>
      streamFixture(value, options, paths),
    );
  return streamFixture(value, options);
}

// Separate trusted opt-in harness entry; never selected by fixture/model/production configuration.
// profileHome and preload are caller-owned test seams, not CLI or model inputs.
export async function streamNativeLiveProbe(value, options = {}) {
  const live = { home: options.profileHome, preload: options.preload, failureStage: 'transport' };
  try {
    options.signal?.throwIfAborted();
    assert.ok(typeof options.profileHome === 'string');
    return await streamFixture(value, options, undefined, live);
  } catch {
    options.onDiagnostic?.(live.failureStage);
    throw new ControlError('sign-in-required');
  }
}

async function streamFixture(
  value,
  { signal, onEvent, onSpawn, onCheckpoint, beforeCleanup, resourceDirectory, fixture = 'probe' },
  profilePaths,
  live,
) {
  const deadline = performance.now() + (live ? 60_000 : 10_000);
  let home;
  let resource;
  const check = () => {
    signal?.throwIfAborted();
    assert.ok(performance.now() < deadline);
  };
  try {
    check();
    const codex = codexFixtures.includes(fixture);
    assert.ok(live || codex || ['probe', 'repair-budget', 'profile-refresh'].includes(fixture));
    assert.ok(!codex || Boolean(profilePaths) === codexProfiles.includes(fixture));
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
      [
        ...(live?.preload ? ['--import', live.preload.href] : []),
        fileURLToPath(
          new URL(
            live
              ? './pi-native-live-child.mjs'
              : codex
                ? './pi-native-codex-child.mjs'
                : './pi-native-child.mjs',
            import.meta.url,
          ),
        ),
      ],
      {
        cwd: home,
        env: {
          HOME: home,
          PI_CODING_AGENT_DIR: live
            ? join(live.home, 'Library', 'Application Support', 'eitri', 'pi')
            : (profilePaths?.profile ?? join(home, 'agent')),
          ...(profilePaths ? { EITRI_PI_NATIVE_AUTH_PATH: profilePaths.authPath } : {}),
          ...(live ? { EITRI_PI_LIVE_HOME: live.home } : {}),
          PI_OFFLINE: '1',
          PI_SKIP_VERSION_CHECK: '1',
          PI_TELEMETRY: '0',
          EITRI_PI_NATIVE_CHILD: live ? 'live-probe' : 'synthetic-only',
          EITRI_PI_NATIVE_FIXTURE: fixture,
        },
        stdio: [
          'pipe',
          'pipe',
          'pipe',
          ...(live || codexProfiles.includes(fixture) ? ['ipc'] : []),
        ],
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
    // Bounded control IPC, separate from model frames: live failure or synthetic refresh handshake.
    let checkpoints = 0;
    child.on('message', (point) => {
      if (failed) return;
      if (live) {
        try {
          assert.equal(checkpoints++, 0);
          live.failureStage = validateNativeDiagnostic(point);
        } catch {
          live.failureStage = 'transport';
          cancel();
        }
        return;
      }
      if (
        !codexProfiles.includes(fixture) ||
        ++checkpoints > 2 ||
        !['refresh-response', 'provider-request'].includes(point)
      )
        return cancel();
      Promise.resolve()
        .then(() => onCheckpoint?.(point))
        .then(() => {
          if (!failed && child.connected)
            child.send(point, (error) => {
              if (error) cancel();
            });
        })
        .catch(cancel);
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
      assert.ok(!failed && code === 0 && exitSignal === null && (!live || checkpoints === 0));
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
          if (live) live.failureStage = 'cleanup';
          throw new Error('pi-native-stream-offline-cleanup-failed');
        });
  }
}
