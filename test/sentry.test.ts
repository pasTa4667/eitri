import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSentry, loadSentryToken, sentryTarget } from '../src/sentry.ts';

test('1Password reads only the fixed field with explicit account and private bounded output', async () => {
  const token = await loadSentryToken('company.1password.eu', async (file, args, options) => {
    assert.equal(file, '/opt/homebrew/bin/op');
    assert.deepEqual(args, [
      'read',
      'op://Eitri/Sentry/password',
      '--account',
      'company.1password.eu',
      '--no-newline',
    ]);
    assert.equal(options?.timeout, 60_000);
    assert.equal(options?.maxBuffer, 16_384);
    assert.deepEqual(
      Object.keys(options?.env ?? {}).filter((key) => key.startsWith('OP_')),
      [],
    );
    return { stdout: 'private-test-token', stderr: '' };
  });
  assert.equal(token, 'private-test-token');
  for (const account of ['', '--bad', 'with space', 'https://company.1password.eu'])
    await assert.rejects(loadSentryToken(account), /explicit 1Password account/);
  await assert.rejects(
    loadSentryToken('company', async () => {
      throw new Error('private-test-token');
    }),
    (error: Error) => !String(error).includes('private-test-token') && !error.cause,
  );
  for (const stdout of ['', 'token\n', 'a b', 'x'.repeat(8193)])
    await assert.rejects(
      loadSentryToken('company', async () => ({ stdout, stderr: '' })),
      /not a valid API token/,
    );
});

test('Sentry probe is one fixed-project GET with no redirects or telemetry output', async () => {
  const summary = await checkSentry('private-test-token', async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://sentry.io');
    assert.equal(url.pathname, '/api/0/organizations/pasta-re/issues/');
    assert.equal(url.searchParams.get('project'), sentryTarget.projectId);
    assert.equal(url.searchParams.get('limit'), '1');
    assert.equal(options?.method, 'GET');
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal);
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer private-test-token');
    return Response.json([{ project: { id: sentryTarget.projectId }, title: 'private telemetry' }]);
  });
  assert.deepEqual(summary, {
    connected: true,
    organization: 'pasta-re',
    projectId: sentryTarget.projectId,
    sampledIssues: 1,
    liveRemediation: false,
  });
  assert.equal(JSON.stringify(summary).includes('private'), false);
  assert.equal((await checkSentry('token', async () => Response.json([]))).sampledIssues, 0);
});

test('probe failures discard remote bodies and underlying error details', async () => {
  for (const status of [301, 401, 403, 429, 500])
    await assert.rejects(
      checkSentry('token', async () => new Response('private telemetry', { status })),
      new RegExp(`HTTP ${status}`),
    );
  await assert.rejects(
    checkSentry('token', async () => {
      throw new Error('private-test-token');
    }),
    (error: Error) => !String(error).includes('private-test-token') && !error.cause,
  );
  for (const body of [
    'private telemetry',
    '{}',
    '[{}]',
    JSON.stringify([{ project: { id: 'other-project' } }]),
    JSON.stringify(Array(2).fill({ project: { id: sentryTarget.projectId } })),
    'x'.repeat(1_048_577),
  ])
    await assert.rejects(
      checkSentry('token', async () => new Response(body)),
      /invalid, oversized or out-of-project/,
    );
});
