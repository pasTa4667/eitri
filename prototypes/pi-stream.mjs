import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { context, toolResponse, toolResult, finalResponse } from './pi-stream-fixtures.ts';
import { JsonLines, StreamReceiver, encodeLine, makeRequest } from './pi-stream-protocol.mjs';

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
// This exercises a private correlated pipe using fixed synthetic requests only.
// It is NOT a production provider adapter and never accepts case/model/CLI requests.
// Optional trusted caller control is synchronous: admit throws on pause/denial,
// remaining returns the caller-owned allowance, including any restart accounting.
// 'tool' admits fixture data only; it does not execute or checkpoint a native tool.
export async function probePiStream({ childPath, timeoutMs = 10_000, signal, control } = {}) {
  const started = performance.now();
  let home;
  try {
    assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 10_000);
    if (control !== undefined) {
      assert.ok(
        control && typeof control.admit === 'function' && typeof control.remaining === 'function',
      );
    }
    const allowance = () => {
      signal?.throwIfAborted();
      const value = control === undefined ? timeoutMs : control.remaining();
      assert.ok(Number.isFinite(value) && value > 0 && value <= 600_000);
      return value;
    };
    // Only tighten this ceiling: never renew it at spawn or a larger caller reading.
    let deadline = started + Math.min(timeoutMs, allowance());
    const remaining = () => {
      const value = allowance();
      const now = performance.now();
      deadline = Math.min(deadline, now + value);
      assert.ok(deadline > now);
      return deadline - now;
    };
    const admit = (kind) => {
      remaining();
      if (control !== undefined) assert.equal(control.admit(kind), undefined);
      remaining();
    };
    await verifyInstalledSources();
    remaining();
    const requests = [
      makeRequest(0, context),
      makeRequest(1, {
        messages: [...context.messages, toolResponse, toolResult],
      }),
    ];
    const expected = [toolResponse, finalResponse];
    const decoder = new JsonLines();
    let index = 0;
    let receiver = new StreamReceiver(requests[index]);
    home = await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-stream-')));
    admit('model');
    const child = spawn(
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
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let failed = false;
    const cancel = () => {
      failed = true;
      child.kill('SIGKILL');
    };
    let timer;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(cancel, remaining());
    };
    signal?.addEventListener('abort', cancel, { once: true });
    // Always settle on close, not error/abort: release the home only after reaping.
    const closed = new Promise((resolve) => {
      child.on('error', cancel);
      child.stdin.on('error', cancel);
      child.stdout.on('error', cancel);
      child.stderr.on('error', cancel);
      child.stderr.on('data', cancel); // no raw diagnostics are retained
      child.stdout.on('data', (chunk) => {
        if (failed) return;
        try {
          for (const frame of decoder.push(chunk)) {
            remaining();
            assert.ok(index < requests.length);
            const event = receiver.accept(frame);
            if (event.type === 'done' || event.type === 'error') {
              assert.deepEqual(receiver.finish(), expected[index]);
              index++;
              if (index < requests.length) {
                admit('tool');
                admit('model');
                receiver = new StreamReceiver(requests[index]);
                child.stdin.write(encodeLine(requests[index]));
              } else child.stdin.end();
            }
          }
          arm();
        } catch {
          cancel();
        }
      });
      child.on('close', (code, exitSignal) => resolve({ code, exitSignal }));
    });
    try {
      try {
        remaining();
        child.stdin.write(encodeLine(requests[0]));
        arm();
      } catch {
        cancel();
      }
      const { code, exitSignal } = await closed;
      assert.ok(!failed && !signal?.aborted);
      remaining();
      assert.equal(code, 0);
      assert.equal(exitSignal, null);
      decoder.finish();
      assert.equal(index, requests.length);
      return { ...observations };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  } catch {
    throw new Error('pi-stream-offline-failed');
  } finally {
    // Only our generated directory, after spawn has closed/reaped its child.
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
