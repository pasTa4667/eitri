import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { writeSync } from 'node:fs';
import { mkdtemp, realpath, rmdir } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withProfileLogin } from '../prototypes/pi-profile-login.mjs';
import { sdkRoot, verifyInstalledSources } from '../prototypes/pi-stream.mjs';

const usage = `Usage: npm run test:pi-login -- --run [--recover]
Operator-present dedicated Pi profile sign-in only; Pi saves OAuth credentials, never inference.
--recover explicitly reclaims only a dead login/probe owner, never a native/unknown lease.
`;
const args = process.argv.slice(2);
const valid =
  (args.length === 1 && args[0] === '--run') ||
  (args.length === 2 && args[0] === '--run' && args[1] === '--recover');
const help = args.length === 0 || (args.length === 1 && args[0] === '--help');

async function login() {
  const controller = new AbortController();
  let verdict = 'sign-in-required';
  const cancel = () => controller.abort();
  // Keep listeners installed through cancellation: the SDK's signal-exit dependency re-signals
  // when a once-listener has already removed itself during the same signal emission.
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  // Exit bounds even uncooperative SDK/network work. The dead lease then requires explicit recovery.
  const timer = setTimeout(() => {
    writeSync(
      1,
      '{"scope":"dedicated-pi-login","verdict":"timed-out","inference":"not-performed"}\n',
    );
    process.exit(1);
  }, 300_000);
  try {
    await verifyInstalledSources();
    await withProfileLogin(
      process.env.EITRI_PI_LOGIN_HOME,
      args.includes('--recover'),
      async ({ authPath }) => {
        const { ModelRuntime } = await import(`${sdkRoot}/dist/index.js`);
        const options = {
          authPath,
          modelsPath: null,
          allowModelNetwork: false,
          refreshOnCreate: false,
          signal: controller.signal,
        };
        const runtime = await ModelRuntime.create(options);
        const allowed = (entries) =>
          entries.length <= 1 &&
          entries.every((entry) => entry.providerId === 'openai-codex' && entry.type === 'oauth');
        // Metadata only, before anything that can resolve a command-valued key or refresh credentials.
        assert.ok(allowed(await runtime.listCredentials({ signal: controller.signal })));
        let browser;
        await runtime.login('openai-codex', 'oauth', {
          signal: controller.signal,
          prompt(request) {
            if (
              request.type === 'select' &&
              request.options?.some((option) => option.id === 'browser')
            )
              return Promise.resolve('browser');
            // No pasted codes/tokens and no headless/device fallback. Only the SDK's local callback wins.
            return new Promise((_, reject) => {
              const stop = () => reject(new Error());
              if (controller.signal.aborted) stop();
              else controller.signal.addEventListener('abort', stop, { once: true });
            });
          },
          notify(event) {
            // SDK installs callback cleanup after notify; never throw from this callback.
            try {
              assert.equal(event.type, 'auth_url');
              assert.equal(browser, undefined);
              const url = new URL(event.url);
              assert.equal(url.origin, 'https://auth.openai.com');
              assert.equal(url.pathname, '/oauth/authorize');
              assert.equal(url.username + url.password + url.hash, '');
              assert.equal(
                url.searchParams.get('redirect_uri'),
                'http://localhost:1455/auth/callback',
              );
              browser = new Promise((resolveBrowser, reject) => {
                execFile(
                  '/usr/bin/open',
                  [url.href],
                  {
                    env: { PATH: '/usr/bin:/bin' },
                    timeout: 10_000,
                    maxBuffer: 1024,
                    signal: controller.signal,
                  },
                  (error) => (error ? reject(new Error()) : resolveBrowser()),
                );
              }).catch(() => controller.abort());
            } catch {
              controller.abort();
            }
          },
        }); // Discard the returned credential. Pi alone owns its persistence.
        await browser;
        assert.ok(browser);
        controller.signal.throwIfAborted();
        const reopened = await ModelRuntime.create(options);
        const entries = await reopened.listCredentials({ signal: controller.signal });
        assert.equal(entries.length, 1);
        assert.ok(allowed(entries));
        controller.signal.throwIfAborted();
      },
    );
    verdict = 'oauth-saved';
  } catch {
    // Never emit provider errors, credential objects, response bodies, URLs or exception causes.
  } finally {
    clearTimeout(timer);
    controller.abort();
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
  writeSync(
    1,
    `${JSON.stringify({ scope: 'dedicated-pi-login', verdict, inference: 'not-performed' })}\n`,
  );
  return verdict === 'oauth-saved' ? 0 : 1;
}

async function main() {
  if (!valid) {
    writeSync(help ? 1 : 2, usage);
    return help ? 0 : 1;
  }
  if (process.platform !== 'darwin' || !process.stdin.isTTY || !process.stdout.isTTY) {
    writeSync(2, 'Requires an operator-present macOS terminal.\n');
    return 1;
  }
  if (process.env.EITRI_PI_LOGIN_CHILD === '1') return login();
  // Re-exec without ambient API keys, Node injection, proxy settings, provider overrides or normal Pi config.
  const home = await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-login-')));
  try {
    writeSync(
      2,
      'Pi sign-in only. Complete the browser flow; Ctrl+C cancels. No inference or automatic retry.\nTrust the terminal verdict, not the browser callback success page.\n',
    );
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], {
      cwd: home,
      stdio: 'inherit',
      env: {
        HOME: home,
        PATH: '/usr/bin:/bin',
        PI_CODING_AGENT_DIR: join(
          resolve(userInfo().homedir),
          'Library',
          'Application Support',
          'eitri',
          'pi',
        ),
        EITRI_PI_LOGIN_HOME: resolve(userInfo().homedir),
        EITRI_PI_LOGIN_CHILD: '1',
        PI_OFFLINE: '1',
        PI_SKIP_VERSION_CHECK: '1',
        PI_TELEMETRY: '0',
      },
    });
    const stop = () => child.kill('SIGTERM');
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    try {
      return await new Promise((resolveExit) => {
        child.once('error', () => resolveExit(1));
        child.once('close', (code) => resolveExit(code === 0 ? 0 : 1));
      });
    } finally {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  } finally {
    await rmdir(home);
  }
}

// A disposable login process, not an agent runtime. Hard exit also closes callback sockets.
try {
  process.exit(await main());
} catch {
  writeSync(2, 'sign-in-required\n');
  process.exit(1);
}
