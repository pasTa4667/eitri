import { execFile } from 'node:child_process';
import { writeSync } from 'node:fs';

const usage = `Usage: npm run test:openai-login -- --run
Opt-in macOS terminal experiment: identity is not validated; no tokens are saved or used.
May create an Eitri authorization in ChatGPT. No inference or automatic revocation.
`;

function untilAborted(signal) {
  return new Promise((_, reject) => {
    const stop = () => reject(new Error());
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== '--run') {
    writeSync(args.length === 0 || (args.length === 1 && args[0] === '--help') ? 1 : 2, usage);
    return args.length === 0 || (args.length === 1 && args[0] === '--help') ? 0 : 1;
  }
  if (
    process.platform !== 'darwin' ||
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    (process.env.PI_OAUTH_CALLBACK_HOST && process.env.PI_OAUTH_CALLBACK_HOST !== '127.0.0.1')
  ) {
    writeSync(2, 'Requires a macOS terminal and the default loopback callback host.\n');
    return 1;
  }
  writeSync(
    2,
    'Login-only experiment: identity is NOT validated. Tokens will be discarded.\nThis may leave an Eitri authorization in ChatGPT; disconnect it in ChatGPT Settings afterward.\nTrust the terminal result, not the SDK browser callback success page. Ctrl+C cancels.\n',
  );
  const controller = new AbortController();
  let verdict = 'failed';
  const cancel = () => {
    verdict = 'cancelled';
    controller.abort();
  };
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  const timer = setTimeout(() => {
    verdict = 'timed-out';
    controller.abort();
  }, 300_000);
  const stopped = untilAborted(controller.signal);
  try {
    await Promise.race([
      stopped,
      (async () => {
        const { OpenAICredentialStore } = await import('../src/openai-credentials.ts');
        const store = await OpenAICredentialStore.open();
        let identity;
        try {
          identity = await store.identity({ signal: controller.signal });
        } finally {
          await store.close();
        }
        controller.signal.throwIfAborted();
        const { openaiProvider } = await import('@earendil-works/pi-ai/providers/openai');
        const oauth = openaiProvider().auth.oauth;
        let browser;
        // Call OAuthAuth directly: Models.login would activate/persist the returned credential.
        await oauth.login(
          {
            signal: controller.signal,
            prompt: ({ signal }) => untilAborted(signal ?? controller.signal),
            notify(event) {
              if (event.type !== 'auth_url') return;
              // notify must not throw: the pinned SDK installs its cleanup after this callback.
              try {
                const url = new URL(event.url);
                if (
                  browser ||
                  url.origin !== 'https://auth.openai.com' ||
                  url.pathname !== '/api/accounts/authorize' ||
                  url.username ||
                  url.password ||
                  url.hash ||
                  url.searchParams.get('agent_name_hint') !== 'Eitri' ||
                  url.searchParams.get('ext_agent_host_id') !==
                    `urn:uuid:${identity.installationId}` ||
                  url.searchParams.get('redirect_uri') !== 'http://127.0.0.1:1455/auth/callback'
                )
                  throw new Error();
                browser = new Promise((resolve, reject) => {
                  execFile(
                    '/usr/bin/open',
                    [url.href],
                    {
                      env: {
                        HOME: process.env.HOME,
                        PATH: process.env.PATH,
                        USER: process.env.USER,
                        TMPDIR: process.env.TMPDIR,
                      },
                      timeout: 10_000,
                      maxBuffer: 1024,
                      signal: controller.signal,
                    },
                    (error) => (error ? reject(new Error()) : resolve()),
                  );
                }).catch(() => controller.abort());
              } catch {
                controller.abort();
              }
            },
          },
          { agentName: identity.agentName, getDeviceId: () => identity.installationId },
        );
        await browser;
        controller.signal.throwIfAborted();
        if (!browser) throw new Error();
      })(),
    ]);
    verdict = 'token-exchange-succeeded';
  } catch {
    // Provider errors may contain response bodies or credentials. Never print them or their causes.
  } finally {
    clearTimeout(timer);
    controller.abort();
    // Let cooperative SDK cancellation run its finally; exit below bounds uncooperative work.
    await new Promise((resolve) => setImmediate(resolve));
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
  writeSync(
    1,
    `${JSON.stringify({
      scope: 'login-only',
      verdict,
      identityValidation: 'not-performed',
      credentialsPersisted: false,
      inference: 'not-performed',
      remoteRevocation: 'not-attempted',
    })}\n`,
  );
  return verdict === 'token-exchange-succeeded' ? 0 : 1;
}

// This disposable command has a hard lifetime even if a dependency ignores cancellation.
// Synchronous output is flushed first; process exit closes any remaining callback sockets.
process.exit(await main());
