import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const usage =
  'Usage: npm run observe:sentry -- --account <explicit-account> --issue <positive-decimal-id>\n';
const env = {
  HOME: '/fixture-home',
  PATH: '/fixture-path',
  USER: 'fixture-user',
  TMPDIR: '/fixture-tmp',
  OP_SERVICE_ACCOUNT_TOKEN: 'private-ambient-credential-canary',
};

async function command(args: string[], scenario = 'available') {
  const preload = new URL('./fixtures/sentry-command-preload.mjs', import.meta.url);
  preload.searchParams.set('scenario', scenario);
  const child = spawn(
    process.execPath,
    ['--import', preload.href, 'scripts/observe-sentry.ts', ...args],
    { cwd, env, stdio: ['ignore', 'pipe', 'pipe', 'pipe'], timeout: 10_000 },
  );
  let stdout = '';
  let stderr = '';
  let calls = '';
  child.stdout!.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  child.stderr!.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  const records = child.stdio[3];
  assert.ok(records && 'setEncoding' in records);
  records.setEncoding('utf8').on('data', (chunk) => (calls += chunk));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (signal) reject(new Error(`Command terminated by ${signal}`));
      else resolve(code);
    });
  });
  return {
    code,
    stdout,
    stderr,
    calls: calls.trim()
      ? calls
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : [],
  };
}

function expectedCalls(account: string, issueId: string) {
  const url = `https://sentry.io/api/0/organizations/pasta-re/issues/${issueId}/`;
  const options = {
    method: 'GET',
    headers: { Authorization: 'Bearer private-token-canary', Accept: 'application/json' },
    redirect: 'error',
    credentials: 'omit',
    signal: { isAbortSignal: true, aborted: false },
  };
  return [
    {
      kind: 'execFile',
      file: '/opt/homebrew/bin/op',
      args: ['read', 'op://Eitri/Sentry/password', '--account', account, '--no-newline'],
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

for (const [scenario, stdout] of [
  [
    'available',
    '{"source":{"provider":"sentry","organization":"pasta-re","projectId":"4512275993002064","issueId":"42"},"classification":{"origin":"sentry","priority":"high","status":"unresolved"},"event":{"kind":"available","eventId":"abcdef0123456789abcdef0123456789","occurredAt":"2026-06-01T10:34:56.000Z","evidence":{"reportedExceptionCount":2,"reportedStackFrameCount":2}}}\n',
  ],
  [
    'unavailable',
    '{"source":{"provider":"sentry","organization":"pasta-re","projectId":"4512275993002064","issueId":"42"},"classification":{"origin":"sentry","priority":"high","status":"unresolved"},"event":{"kind":"unavailable","reason":"latest-event-not-found"}}\n',
  ],
]) {
  test(`observe:sentry prints one literal ${scenario} observation through the real loader and reader`, async () => {
    const result = await command(['--account', 'company.1password.eu', '--issue', '42'], scenario);
    assert.deepEqual(result, {
      code: 0,
      stdout,
      stderr: '',
      calls: expectedCalls('company.1password.eu', '42'),
    });
  });
}

for (const [name, args, account, issueId] of [
  ['equals', ['--account=a', '--issue=1'], 'a', '1'],
  ['reversed', ['--issue', '42', '--account', 'A.b-9'], 'A.b-9', '42'],
  [
    '20-digit issue',
    ['--account', 'a', '--issue=12345678901234567890'],
    'a',
    '12345678901234567890',
  ],
  [
    '253-character account',
    [`--account=${'a'.repeat(253)}`, '--issue', '42'],
    'a'.repeat(253),
    '42',
  ],
] as const) {
  test(`observe:sentry accepts ${name}`, async () => {
    const result = await command([...args], 'unavailable');
    assert.deepEqual(result, {
      code: 0,
      stdout: `{"source":{"provider":"sentry","organization":"pasta-re","projectId":"4512275993002064","issueId":"${issueId}"},"classification":{"origin":"sentry","priority":"high","status":"unresolved"},"event":{"kind":"unavailable","reason":"latest-event-not-found"}}\n`,
      stderr: '',
      calls: expectedCalls(account, issueId),
    });
  });
}

const valid = ['--account', 'company', '--issue', '42'];
const invalidArguments = [
  [],
  ['--account', 'company'],
  ['--issue', '42'],
  ['--account'],
  ['--issue'],
  ['--account', '--issue', '42'],
  ['--account', 'company', '--issue'],
  [...valid, '--account', 'company'],
  [...valid, '--account=other'],
  [...valid, '--issue', '42'],
  [...valid, '--issue=43'],
  ['--account=company', '--account=company'],
  ['--issue=42', '--issue=42'],
  [...valid, '--unknown'],
  [...valid, '--token=private-argument-canary'],
  [...valid, '--organization=other'],
  [...valid, '--project=other'],
  [...valid, 'private-argument-canary'],
  ['private-argument-canary', ...valid],
  [...valid, '--'],
  ['--', ...valid],
  [...valid, '--', 'private-argument-canary'],
  ['-a', 'company', '--issue', '42'],
  ['--Account=company', '--issue=42'],
  ['--account=company', '--Issue=42'],
  ...[
    '',
    ' ',
    '\t',
    '.company',
    '-company',
    'a_b',
    'a/b',
    'https://company',
    'café',
    'a'.repeat(254),
  ].map((account) => [`--account=${account}`, '--issue=42']),
  ...['', ' ', '\t', '0', '00', '01', '-1', '+1', '1.5', '1e2', '１２', '1'.repeat(21)].map(
    (issue) => ['--account=company', `--issue=${issue}`],
  ),
  ...['\n', '\r', '\r\n', '\u2028', '\u2029', ' ', '\t'].flatMap((suffix) => [
    [`--account=company${suffix}`, '--issue=42'],
    ['--account=company', `--issue=42${suffix}`],
  ]),
];

for (const args of invalidArguments) {
  test(`observe:sentry rejects ${JSON.stringify(args)} before credential loading`, async () => {
    assert.deepEqual(await command(args), { code: 1, stdout: '', stderr: usage, calls: [] });
  });
}

for (const [scenario, callCount] of [
  ['loader-rejection', 1],
  ['empty-token', 1],
  ['invalid-token', 1],
  ['oversized-token', 1],
  ['issue-auth', 2],
  ['event-auth', 3],
  ['issue-network', 2],
  ['event-network', 3],
  ['invalid-json', 2],
  ['malformed-event', 3],
] as const) {
  test(`observe:sentry conceals private details on ${scenario}`, async () => {
    const result = await command(valid, scenario);
    assert.deepEqual(result, {
      code: 1,
      stdout: '',
      stderr: 'Sentry observation failed.\n',
      calls: expectedCalls('company', '42').slice(0, callCount),
    });
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /private-|company|op:\/\/|Authorization|Bearer|stacktrace/,
    );
  });
}
