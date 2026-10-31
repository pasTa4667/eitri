import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const run = promisify(execFile);
const childPath = new URL('./helpers/pi-auth.mjs', import.meta.url).pathname;
const scenarios = [
  'serialized-refresh',
  'cancel-before-auth',
  'cancel-lock-wait',
  'cancel-active-refresh',
  'refresh-rejected',
  'refresh-malformed',
  'store-read-failed',
  'store-write-failed',
  'missing-oauth',
  'stored-api-key',
  'provider-rejected',
  'cancel-provider',
];

test('auth helper refuses unauthorised activation without raw diagnostics', async () => {
  await assert.rejects(
    run(process.execPath, [childPath, 'serialized-refresh'], {
      env: {},
      timeout: 15_000,
      killSignal: 'SIGKILL',
      maxBuffer: 4096,
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, '');
      assert.equal(error.stderr, 'pi-stream-auth-offline-failed\n');
      return true;
    },
  );
});

for (const scenario of scenarios) {
  test(`installed Pi built-in synthetic OAuth: ${scenario}`, async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-auth-test-')));
    const home = join(root, 'home');
    const sentinel = join(root, 'global-auth.json');
    const bytes = '{"synthetic":"not-case-owned"}\n';
    try {
      await mkdir(home, { mode: 0o700 });
      await writeFile(sentinel, bytes, { mode: 0o600 });
      const { stdout, stderr } = await run(process.execPath, [childPath, scenario], {
        cwd: home,
        env: {
          HOME: home,
          PI_CODING_AGENT_DIR: join(home, 'agent'),
          PI_OFFLINE: '1',
          PI_SKIP_VERSION_CHECK: '1',
          PI_TELEMETRY: '0',
          EITRI_PI_AUTH_CHILD: 'synthetic-only',
        },
        timeout: 15_000,
        killSignal: 'SIGKILL',
        maxBuffer: 4096,
      });
      assert.equal(stderr, '');
      assert.deepEqual(JSON.parse(stdout), { status: 'offline-auth-pass', scenario });
      assert.deepEqual(await readdir(home), [], 'no auth/config/transcript files');
      assert.equal(await readFile(sentinel, 'utf8'), bytes);
    } finally {
      // execFile settles only after the isolated child closes, including timeout kill.
      await rm(root, { recursive: true, force: true });
    }
  });
}
