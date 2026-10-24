import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { verifySentryReviewAssignment } from '../scripts/check-sentry-review.mjs';

const base = 'https://sentry.io';
const issueUrl = `${base}/api/0/organizations/pasta-re/issues/155897738/`;
const stateUrl = `${issueUrl}?expand=inbox`;
const initial = () => ({
  id: '155897738',
  project: { id: '4512275993002064' },
  status: 'unresolved',
  priority: 'high',
  substatus: 'new',
  hasSeen: false,
  inbox: { reason: 0 },
  assignedTo: null,
  title: 'PRIVATE TELEMETRY',
});
const reviewed = () => ({ ...initial(), inbox: null, substatus: 'ongoing' });
const assigned = () => ({
  ...reviewed(),
  assignedTo: { type: 'user', id: '5090062', email: 'PRIVATE EMAIL' },
});

function serve(t, values) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), ...init });
    const value = values[calls.length - 1];
    if (value instanceof Error) throw value;
    assert.notEqual(value, undefined, 'unexpected request');
    if (value instanceof Response) return value;
    const response = Response.json(value);
    Object.defineProperty(response, 'url', { value: String(url) });
    return response;
  });
  return calls;
}
const auth = () => ({
  user: { id: '123', email: 'PRIVATE EMAIL' },
  auth: { scopes: ['event:read', 'event:write'] },
});

test('default is bounded read-only inspection with allowlisted output', async (t) => {
  const calls = serve(t, [auth(), initial()]);
  const result = await verifySentryReviewAssignment('test-token');
  assert.equal(result.verdict, 'inspected');
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.method === 'GET' && call.body === undefined));
  assert.equal(result.before.inInbox, true);
  assert.equal(result.before.assignedTo, null);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('activation uses only review and assignment payloads, with separate fresh readbacks', async (t) => {
  const calls = serve(t, [
    auth(),
    initial(),
    { inbox: false },
    reviewed(),
    { assignedTo: { id: '5090062' } },
    assigned(),
  ]);
  const result = await verifySentryReviewAssignment('test-token', { activate: true });
  assert.equal(result.verdict, 'passed');
  assert.deepEqual(
    calls.map((c) => [c.method, c.url]),
    [
      ['GET', `${base}/api/0/`],
      ['GET', stateUrl],
      ['PUT', issueUrl],
      ['GET', stateUrl],
      ['PUT', issueUrl],
      ['GET', stateUrl],
    ],
  );
  assert.deepEqual(
    calls.filter((c) => c.method === 'PUT').map((c) => JSON.parse(c.body)),
    [{ inbox: false }, { assignedTo: 'user:5090062' }],
  );
  assert.ok(calls.every((c) => c.redirect === 'error' && c.credentials === 'omit'));
  assert.ok(calls.every((c) => c.signal === calls[0].signal));
  assert.equal(result.afterReview.hasSeen, false);
  assert.equal(result.afterAssignment.hasSeen, false);
  assert.equal(result.authenticatedUserId, '123');
  assert.equal(result.assigneeId, '5090062');
  assert.deepEqual(result.afterAssignment.assignedTo, { type: 'user', id: '5090062' });
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

for (const [name, change] of [
  ['wrong issue', { id: '7' }],
  ['wrong project', { project: { id: '7' } }],
  ['missing inbox', { inbox: undefined }],
  ['boolean inbox', { inbox: true }],
  ['missing seen', { hasSeen: undefined }],
  ['missing assignment', { assignedTo: undefined }],
  ['already reviewed', { inbox: null }],
  ['already assigned', { assignedTo: { type: 'user', id: '321' } }],
  ['changed status', { status: 'resolved' }],
  ['changed priority', { priority: 'low' }],
]) {
  test(`activation refuses ${name} before any write`, async (t) => {
    const calls = serve(t, [auth(), { ...initial(), ...change }]);
    const result = await verifySentryReviewAssignment('test-token', { activate: true });
    assert.equal(result.verdict, 'failed');
    assert.ok(calls.every((c) => c.method === 'GET'));
  });
}

for (const [name, state] of [
  ['review not applied', initial()],
  ['status changed', { ...reviewed(), status: 'resolved' }],
  ['priority changed', { ...reviewed(), priority: 'low' }],
  ['seen changed', { ...reviewed(), hasSeen: true }],
  ['assignment changed', { ...reviewed(), assignedTo: { type: 'user', id: '321' } }],
]) {
  test(`review readback refuses ${name} without attempting assignment`, async (t) => {
    const calls = serve(t, [auth(), initial(), { inbox: false }, state]);
    const result = await verifySentryReviewAssignment('test-token', { activate: true });
    assert.equal(result.verdict, 'failed');
    assert.equal(result.failedStage, 'review-readback');
    assert.equal(calls.length, 4);
  });
}

test('lost mutation response records uncertainty and never retries', async (t) => {
  const calls = serve(t, [auth(), initial(), new Error('PRIVATE TOKEN AND RESPONSE')]);
  const result = await verifySentryReviewAssignment('test-token', { activate: true });
  assert.equal(result.verdict, 'failed');
  assert.equal(result.failedStage, 'review-write');
  assert.deepEqual(result.attemptedWrites, [{ inbox: false }]);
  assert.equal(calls.length, 3);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('assignment needs an observed matching user, not a successful PUT alone', async (t) => {
  serve(t, [
    auth(),
    initial(),
    {},
    reviewed(),
    {},
    { ...assigned(), assignedTo: { type: 'team', id: '5090062' } },
  ]);
  const result = await verifySentryReviewAssignment('test-token', { activate: true });
  assert.equal(result.verdict, 'failed');
  assert.equal(result.failedStage, 'assignment-readback');
});

for (const response of [
  () => new Response('{}', { status: 403 }),
  () => new Response('x'.repeat(1_048_577)),
  () => new Response(new Uint8Array([0xff])),
  () => {
    const r = Response.json(auth());
    Object.defineProperty(r, 'url', { value: 'https://other.example/' });
    return r;
  },
]) {
  test('invalid HTTP, size, UTF-8 or response destination fails closed', async (t) => {
    const calls = serve(t, [response()]);
    assert.equal(
      (await verifySentryReviewAssignment('test-token', { activate: true })).verdict,
      'failed',
    );
    assert.equal(calls.length, 1);
  });
}

test('assignment-only recovery is explicit and never replays review', async (t) => {
  const calls = serve(t, [auth(), reviewed(), {}, assigned()]);
  const result = await verifySentryReviewAssignment('test-token', {
    activate: true,
    resumeAssignment: true,
  });
  assert.equal(result.verdict, 'passed');
  assert.equal(result.scope, 'assignment-after-review');
  assert.deepEqual(result.attemptedWrites, [{ assignedTo: 'user:5090062' }]);
  assert.equal(calls.length, 4);
});

test('recovery refuses an unreviewed issue without writing', async (t) => {
  const calls = serve(t, [auth(), initial()]);
  const result = await verifySentryReviewAssignment('test-token', {
    activate: true,
    resumeAssignment: true,
  });
  assert.equal(result.verdict, 'failed');
  assert.equal(calls.length, 2);
});

test('six ordinary three-second responses fit the finite acceptance deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const values = [auth(), initial(), {}, reviewed(), {}, assigned()];
  t.mock.method(globalThis, 'fetch', async (url) => {
    t.mock.timers.tick(3000);
    const response = Response.json(values.shift());
    Object.defineProperty(response, 'url', { value: String(url) });
    return response;
  });
  const result = await verifySentryReviewAssignment('test-token', { activate: true });
  assert.equal(result.verdict, 'passed');
  assert.equal(result.responses.length, 6);
});

for (const stalled of ['headers', 'body']) {
  test(`deadline bounds stalled ${stalled} without retry and cancels late bytes`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    const held = Promise.withResolvers();
    let cancelled = 0;
    const body = new ReadableStream({
      cancel() {
        cancelled++;
        return new Promise(() => {});
      },
    });
    const response = new Response(body);
    Object.defineProperty(response, 'url', { value: 'https://sentry.io/api/0/' });
    const request = t.mock.method(globalThis, 'fetch', async () =>
      stalled === 'headers' ? held.promise : response,
    );
    const pending = verifySentryReviewAssignment('test-token', { activate: true });
    await setImmediate();
    t.mock.timers.tick(60_000);
    const result = await pending;
    assert.equal(result.verdict, 'failed');
    assert.equal(result.failure, 'deadline');
    held.resolve(response);
    await setImmediate();
    assert.equal(cancelled, 1);
    assert.equal(body.locked, false);
    assert.equal(request.mock.callCount(), 1);
  });
}

test('assignment rejection is classified without retaining diagnostic text', async (t) => {
  const response = Response.json(
    { assignedTo: ['Cannot assign to non-team member'], detail: 'PRIVATE ERROR' },
    { status: 400 },
  );
  Object.defineProperty(response, 'url', { value: issueUrl });
  serve(t, [auth(), reviewed(), response]);
  const result = await verifySentryReviewAssignment('test-token', {
    activate: true,
    resumeAssignment: true,
  });
  assert.equal(result.verdict, 'failed');
  assert.deepEqual(result.responses.at(-1), {
    stage: 'assignment-write',
    status: 400,
    rejection: 'non-team-member',
  });
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('failure retains only an HTTP status, not its error body', async (t) => {
  const response = new Response('PRIVATE ERROR', { status: 403 });
  Object.defineProperty(response, 'url', { value: 'https://sentry.io/api/0/' });
  serve(t, [response]);
  const result = await verifySentryReviewAssignment('test-token');
  assert.equal(result.responses[0].status, 403);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('assignment cannot silently change the reviewed substatus', async (t) => {
  serve(t, [auth(), reviewed(), {}, { ...assigned(), substatus: 'new' }]);
  const result = await verifySentryReviewAssignment('test-token', {
    activate: true,
    resumeAssignment: true,
  });
  assert.equal(result.verdict, 'failed');
  assert.equal(result.failedStage, 'assignment-readback');
});

for (const scopes of [[], ['event:read'], 'event:write', null]) {
  test('missing or malformed write scopes refuse activation', async (t) => {
    const calls = serve(t, [{ ...auth(), auth: { scopes } }, initial()]);
    const result = await verifySentryReviewAssignment('test-token', { activate: true });
    assert.equal(result.verdict, 'failed');
    assert.equal(calls.length, 2);
  });
}

for (const args of [
  ['--unknown'],
  ['--activate', '--activate'],
  ['--activate', '--assign-reviewed'],
  ['--'],
  ['--activate=false'],
]) {
  test(`CLI rejects invalid selection ${JSON.stringify(args)} without credential access`, () => {
    const execution = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../scripts/check-sentry-review.mjs', import.meta.url)), ...args],
      { encoding: 'utf8', timeout: 10000 },
    );
    assert.equal(execution.status, 1);
    assert.equal(execution.stdout, '');
    assert.equal(
      execution.stderr,
      'Usage: node scripts/check-sentry-review.mjs [--activate | --assign-reviewed]\n',
    );
  });
}

test('newline-tainted actor identity is refused before writing', async (t) => {
  const calls = serve(t, [{ ...auth(), user: { id: '123\n' } }, initial()]);
  const result = await verifySentryReviewAssignment('test-token', { activate: true });
  assert.equal(result.verdict, 'failed');
  assert.equal(calls.length, 1);
});

for (const token of ['', 'bad\ntoken', 'x'.repeat(8193)]) {
  test('invalid credentials fail before requests', async (t) => {
    const calls = serve(t, []);
    assert.equal((await verifySentryReviewAssignment(token, { activate: true })).verdict, 'failed');
    assert.equal(calls.length, 0);
  });
}
