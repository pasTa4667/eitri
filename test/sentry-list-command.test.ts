import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const usage = 'Usage: npm run list:sentry -- --account <explicit-account>\n';
const env = {
  HOME: '/fixture-home',
  PATH: '/fixture-path',
  USER: 'fixture-user',
  TMPDIR: '/fixture-tmp',
  OP_SERVICE_ACCOUNT_TOKEN: 'private-ambient-credential-canary',
};

async function command(args: string[], scenario = 'available') {
  const preload = new URL('./fixtures/sentry-list-command-preload.mjs', import.meta.url);
  preload.searchParams.set('scenario', scenario);
  const child = spawn(
    process.execPath,
    ['--import', preload.href, 'scripts/list-sentry.ts', ...args],
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

function expectedCalls(account: string) {
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
    {
      kind: 'fetch',
      url: 'https://sentry.io/api/0/organizations/pasta-re/issues/?project=4512275993002064&query=&statsPeriod=14d&limit=25&sort=date',
      options: {
        method: 'GET',
        headers: { Authorization: 'Bearer private-token-canary', Accept: 'application/json' },
        redirect: 'error',
        credentials: 'omit',
        signal: { isAbortSignal: true, aborted: false },
      },
    },
  ];
}

for (const [scenario, stdout] of [
  [
    'available',
    '{"source":{"provider":"sentry","organization":"pasta-re","projectId":"4512275993002064"},"scope":{"coverage":"single-page-only","statsPeriod":"14d","query":"","sort":"date","maxResults":25},"items":[{"issueId":"42","classification":{"origin":"sentry","priority":"high","status":"unresolved"}}]}\n',
  ],
  [
    'empty',
    '{"source":{"provider":"sentry","organization":"pasta-re","projectId":"4512275993002064"},"scope":{"coverage":"single-page-only","statsPeriod":"14d","query":"","sort":"date","maxResults":25},"items":[]}\n',
  ],
]) {
  for (const account of ['company.1password.eu', 'a', 'A.b-9', 'a'.repeat(253)]) {
    for (const args of [['--account', account], [`--account=${account}`]]) {
      test(`list:sentry emits literal ${scenario} output for ${JSON.stringify(args)}`, async () => {
        assert.deepEqual(await command(args, scenario), {
          code: 0,
          stdout,
          stderr: '',
          calls: expectedCalls(account),
        });
      });
    }
  }
}
const valid = ['--account', 'company'];
const invalidArguments = [
  [],
  ['--account'],
  ['--account='],
  ['--Account=company'],
  ['-a', 'company'],
  [...valid, '--account', 'company'],
  [...valid, '--account=other'],
  [...valid, '--'],
  ['--', ...valid],
  [...valid, 'private-argument-canary'],
  ['private-argument-canary', ...valid],
  ...[
    'token',
    'organization',
    'project',
    'query',
    'limit',
    'cursor',
    'url',
    'issue',
    'statsPeriod',
    'sort',
  ].map((name) => [...valid, `--${name}=private-argument-canary`]),
  ...[
    ' ',
    '\t',
    '.company',
    '-company',
    'a_b',
    'a/b',
    'https://company',
    'café',
    'a'.repeat(254),
    ...['\n', '\r', '\r\n', '\u2028', '\u2029', ' ', '\t'].map((suffix) => `company${suffix}`),
  ].map((account) => [`--account=${account}`]),
];
for (const args of invalidArguments) {
  test(`list:sentry rejects ${JSON.stringify(args)} before credentials`, async () => {
    assert.deepEqual(await command(args), { code: 1, stdout: '', stderr: usage, calls: [] });
  });
}
for (const [scenario, count] of [
  ['loader-rejection', 1],
  ['empty-token', 1],
  ['invalid-token', 1],
  ['oversized-token', 1],
  ['issue-auth', 2],
  ['issue-network', 2],
  ['invalid-json', 2],
] as const) {
  test(`list:sentry conceals ${scenario} details`, async () => {
    const result = await command(valid, scenario);
    assert.deepEqual(result, {
      code: 1,
      stdout: '',
      stderr: 'Sentry discovery failed.\n',
      calls: expectedCalls('company').slice(0, count),
    });
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /private-|company|op:\/\/|Authorization|Bearer/,
    );
  });
}
