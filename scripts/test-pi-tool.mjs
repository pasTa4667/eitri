import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';
import { mkdtemp, realpath, rmdir } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withProfileProbe } from '../prototypes/pi-profile-login.mjs';
import { runControlledTurn, toolTurnResult } from '../prototypes/pi-controlled-turn.mjs';
import { JsonLines } from '../prototypes/pi-stream-protocol.mjs';
import { sdkRoot, verifyInstalledSources } from '../prototypes/pi-stream.mjs';
import { runNativeLiveProbe, nativeLiveResult } from '../prototypes/pi-native-live.mjs';

const native = process.argv[2] === '--native';
const expectedResult = native ? nativeLiveResult : toolTurnResult;
const commandName = native ? 'test:pi-native' : 'test:pi-tool';
const failure = {
  scope: native ? 'dedicated-pi-native' : 'dedicated-pi-tool',
  verdict: 'sign-in-required',
};
const emit = (value) => writeSync(1, `${JSON.stringify(value)}\n`);

async function probe() {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  // Standalone mode owns auth here; native mode's sole-auth helpers exit on IPC disconnect.
  // Hard interruption may lose the login. No success or automatic retry follows.
  const timer = setTimeout(() => process.exit(1), 120_000);
  try {
    await verifyInstalledSources();
    const result = native
      ? await runNativeLiveProbe({
          directory: process.cwd(),
          profileHome: process.env.EITRI_PI_TOOL_HOME,
          signal: controller.signal,
          onProgress: (progress) => emit({ progress }),
        })
      : await withProfileProbe(process.env.EITRI_PI_TOOL_HOME, async ({ authPath }) => {
          controller.signal.throwIfAborted();
          const { ModelRuntime } = await import(`${sdkRoot}/dist/index.js`);
          const runtime = await ModelRuntime.create({
            authPath,
            modelsPath: null,
            allowModelNetwork: false,
            refreshOnCreate: false,
            signal: controller.signal,
          });
          return runControlledTurn(runtime, {
            signal: controller.signal,
            onProgress: (progress) => emit({ progress }),
          });
        });
    emit(result);
    return 0;
  } catch {
    // No raw provider errors, tokens, transcript, callback URLs or response bodies.
    emit(failure);
    return 1;
  } finally {
    clearTimeout(timer);
    controller.abort();
    // Keep signal handlers until process.exit; SDK signal-exit may re-signal cancellation.
  }
}

async function launch() {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-tool-')));
  try {
    const actualHome = resolve(userInfo().homedir);
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), ...(native ? ['--native'] : []), '--run'],
      {
        cwd: home,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: {
          HOME: home,
          PATH: '/usr/bin:/bin',
          PI_CODING_AGENT_DIR: join(actualHome, 'Library', 'Application Support', 'eitri', 'pi'),
          EITRI_PI_TOOL_HOME: actualHome,
          EITRI_PI_TOOL_CHILD: '1',
          PI_OFFLINE: '1',
          PI_SKIP_VERSION_CHECK: '1',
          PI_TELEMETRY: '0',
        },
      },
    );
    let failed = false,
      terminal,
      bytes = 0,
      progressCount = 0;
    const decoder = new JsonLines();
    const cancel = () => {
      failed = true;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(cancel, 125_000);
    process.on('SIGINT', cancel);
    process.on('SIGTERM', cancel);
    try {
      const exit = await new Promise((settle) => {
        child.on('error', cancel);
        child.stdout.on('error', cancel);
        child.stdout.on('data', (chunk) => {
          if (failed) return;
          try {
            bytes += chunk.length;
            assert.ok(bytes <= 4096);
            for (const frame of decoder.push(chunk)) {
              assert.equal(terminal, undefined);
              if (Object.hasOwn(frame, 'progress')) {
                const expected = ['model', 'tool', 'model'][progressCount++];
                assert.ok(expected);
                assert.deepEqual(frame, { progress: expected });
                writeSync(
                  2,
                  expected === 'model'
                    ? 'Pi model request (streaming).\n'
                    : 'Fixed probe tool executed.\n',
                );
              } else {
                assert.ok(
                  [expectedResult, failure].some((allowed) => {
                    try {
                      assert.deepEqual(frame, allowed);
                      return true;
                    } catch {
                      return false;
                    }
                  }),
                );
                terminal = frame;
              }
            }
          } catch {
            cancel();
          }
        });
        child.on('close', (code, signal) => settle({ code, signal }));
      });
      decoder.finish();
      assert.ok(!failed && exit.signal === null && exit.code === 0 && progressCount === 3);
      assert.deepEqual(terminal, expectedResult);
      return { ...expectedResult };
    } finally {
      clearTimeout(timer);
      process.removeListener('SIGINT', cancel);
      process.removeListener('SIGTERM', cancel);
    }
  } finally {
    // Remove only our empty scratch home after child close. Failed native stores are retained.
    await rmdir(home);
  }
}

const args = process.argv.slice(native ? 3 : 2);
if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
  writeSync(
    1,
    `Usage: npm run ${commandName} -- --run\nTwo bounded genuine Pi streams and one fixed side-effect-free tool${native ? ' through the real native controller/SQLite lifecycle' : ''}. No production dispatch.\n`,
  );
} else if (args.length !== 1 || args[0] !== '--run' || process.platform !== 'darwin') {
  writeSync(2, `Usage: npm run ${commandName} -- --run (macOS only)\n`);
  process.exitCode = 1;
} else if (process.env.EITRI_PI_TOOL_CHILD === '1') {
  process.exit(await probe());
} else {
  try {
    const result = await launch();
    emit(result);
  } catch {
    emit(failure);
    process.exitCode = 1;
  }
}
