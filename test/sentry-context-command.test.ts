import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const usage =
  'Usage: npm run observe:sentry -- --account <explicit-account> --issue <positive-decimal-id>\n';

async function command(args: string[], scenario = 'available') {
  const preload = new URL('./fixtures/sentry-context-command-preload.mjs', import.meta.url);
  preload.searchParams.set('scenario', scenario);
  const child = spawn(
    process.execPath,
    ['--import', preload.href, 'scripts/observe-sentry.ts', ...args],
    {
      cwd,
      env: {
        HOME: '/fixture-home',
        PATH: '/fixture-path',
        USER: 'fixture-user',
        TMPDIR: '/fixture-tmp',
        OP_SERVICE_ACCOUNT_TOKEN: 'private-ambient-canary',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    },
  );
  let stdout = '';
  let stderr = '';
  let records = '';
  child.stdout!.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  child.stderr!.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  const fd = child.stdio[3];
  assert.ok(fd && 'setEncoding' in fd);
  fd.setEncoding('utf8').on('data', (chunk) => (records += chunk));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode, signal) => {
      if (signal) reject(new Error(`Command terminated by ${signal}`));
      else resolve(exitCode);
    });
  });
  return {
    code,
    stdout,
    stderr,
    calls: records.trim()
      ? records
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : [],
  };
}

function expectedCalls() {
  const url = 'https://sentry.io/api/0/organizations/pasta-re/issues/42/';
  const options = {
    method: 'GET',
    headers: { Authorization: 'Bearer private-context-token', Accept: 'application/json' },
    redirect: 'error',
    credentials: 'omit',
    signal: { isAbortSignal: true, aborted: false },
  };
  return [
    {
      kind: 'execFile',
      file: '/opt/homebrew/bin/op',
      args: ['read', 'op://Eitri/Sentry/password', '--account', 'company', '--no-newline'],
      options: {
        env: {
          HOME: '/fixture-home',
          PATH: '/fixture-path',
          USER: 'fixture-user',
          TMPDIR: '/fixture-tmp',
        },
        timeout: 60_000,
        maxBuffer: 16_384,
        encoding: 'utf8',
      },
    },
    { kind: 'fetch', url, options },
    { kind: 'fetch', url: `${url}events/latest/`, options },
  ];
}

const valid = ['--account', 'company', '--issue', '42'];

test('reported-context CLI flag prints literal metadata output through two event requests', async () => {
  assert.deepEqual(await command([...valid, '--reported-context']), {
    code: 0,
    stdout:
      '{"source":{"provider":"sentry","organization":"pasta-re","projectId":"4512275993002064","issueId":"42"},"classification":{"origin":"sentry","priority":"high","status":"unresolved"},"event":{"kind":"available","eventId":"abcdef0123456789abcdef0123456789","occurredAt":"2026-06-01T10:34:56.000Z","evidence":{"reportedExceptionCount":0,"reportedStackFrameCount":0},"context":{"environment":{"kind":"reported","value":"production"},"release":{"kind":"reported","value":"release-1+build@prod"}}}}\n',
    stderr: '',
    calls: expectedCalls(),
  });
});

test('omitting reported-context preserves literal default output and requests', async () => {
  assert.deepEqual(await command(valid), {
    code: 0,
    stdout:
      '{"source":{"provider":"sentry","organization":"pasta-re","projectId":"4512275993002064","issueId":"42"},"classification":{"origin":"sentry","priority":"high","status":"unresolved"},"event":{"kind":"available","eventId":"abcdef0123456789abcdef0123456789","occurredAt":"2026-06-01T10:34:56.000Z","evidence":{"reportedExceptionCount":0,"reportedStackFrameCount":0}}}\n',
    stderr: '',
    calls: expectedCalls(),
  });
});

test('reported-context preserves unavailable latest events without adding context', async () => {
  assert.deepEqual(await command([...valid, '--reported-context'], 'unavailable'), {
    code: 0,
    stdout:
      '{"source":{"provider":"sentry","organization":"pasta-re","projectId":"4512275993002064","issueId":"42"},"classification":{"origin":"sentry","priority":"high","status":"unresolved"},"event":{"kind":"unavailable","reason":"latest-event-not-found"}}\n',
    stderr: '',
    calls: expectedCalls(),
  });
});

test('malformed reported context is concealed by the fixed CLI error', async () => {
  const result = await command([...valid, '--reported-context'], 'malformed');
  assert.deepEqual(result, {
    code: 1,
    stdout: '',
    stderr: 'Sentry observation failed.\n',
    calls: expectedCalls(),
  });
  assert.doesNotMatch(result.stdout + result.stderr, /private-|company|op:\/\/|Authorization/);
});

for (const args of [
  [...valid, '--reported-context', '--reported-context'],
  [...valid, '--reported-context=true'],
  [...valid, '--reported-context', 'true'],
  [...valid, '--unknown'],
]) {
  test(`reported-context CLI rejects ${JSON.stringify(args)} before credential loading`, async () => {
    assert.deepEqual(await command(args), { code: 1, stdout: '', stderr: usage, calls: [] });
  });
}
