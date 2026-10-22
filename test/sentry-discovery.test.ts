import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { inspect } from 'node:util';
import { test, type TestContext } from 'node:test';
import { listSentryIssues, observeSentryIssue } from '../src/sentry.ts';

const url =
  'https://sentry.io/api/0/organizations/pasta-re/issues/?project=4512275993002064&query=&statsPeriod=14d&limit=25&sort=date';
const secret = 'private-token-canary';
const empty = {
  source: { provider: 'sentry', organization: 'pasta-re', projectId: '4512275993002064' },
  scope: {
    coverage: 'single-page-only',
    statsPeriod: '14d',
    query: '',
    sort: 'date',
    maxResults: 25,
  },
  items: [],
};
function issue(overrides: Record<string, unknown> = {}) {
  return {
    id: '42',
    project: { id: '4512275993002064' },
    priority: 'high',
    status: 'unresolved',
    ...overrides,
  };
}
function response(body: BodyInit | null, status = 200, destination = url) {
  return Object.defineProperty(new Response(body, { status }), 'url', { value: destination });
}
function serve(t: TestContext, value: unknown) {
  const result = response(JSON.stringify(value));
  return t.mock.method(globalThis, 'fetch', async () => result);
}
async function fails(pending: Promise<unknown>, message = 'Sentry discovery failed.') {
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(Object.getPrototypeOf(error), Error.prototype);
    assert.equal(error.message, message);
    assert.deepEqual(Object.getOwnPropertyNames(error).sort(), ['message', 'stack']);
    assert.equal(inspect(error).includes(secret), false);
    return true;
  });
}

test('empty discovery is a single page with one exact credential-isolated GET', async (t) => {
  const request = serve(t, []);
  assert.deepEqual(await listSentryIssues(secret), empty);
  assert.equal(request.mock.callCount(), 1);
  const [input, options] = request.mock.calls[0].arguments;
  assert.equal(String(input), url);
  assert.ok(options?.signal instanceof AbortSignal);
  assert.equal(options.signal.aborted, false);
  assert.deepEqual(options, {
    method: 'GET',
    headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
    redirect: 'error',
    credentials: 'omit',
    signal: options.signal,
  });
});

test('populated page preserves response order and strips private telemetry', async (t) => {
  serve(t, [
    issue({ id: 73, title: secret, permalink: secret, assignedTo: secret }),
    issue({ id: '2', priority: 'future', status: null }),
  ]);
  assert.deepEqual(await listSentryIssues(secret), {
    ...empty,
    items: [
      {
        issueId: '73',
        classification: { origin: 'sentry', priority: 'high', status: 'unresolved' },
      },
      {
        issueId: '2',
        classification: { origin: 'sentry', priority: 'unknown', status: 'unknown' },
      },
    ],
  });
});

test('25 maximum-length IDs fit the result bound without implying completeness', async (t) => {
  serve(
    t,
    Array.from({ length: 25 }, (_, i) => issue({ id: String(10000000000000000000n + BigInt(i)) })),
  );
  const page = await listSentryIssues(secret);
  assert.deepEqual(page, {
    ...empty,
    items: [
      '10000000000000000000',
      '10000000000000000001',
      '10000000000000000002',
      '10000000000000000003',
      '10000000000000000004',
      '10000000000000000005',
      '10000000000000000006',
      '10000000000000000007',
      '10000000000000000008',
      '10000000000000000009',
      '10000000000000000010',
      '10000000000000000011',
      '10000000000000000012',
      '10000000000000000013',
      '10000000000000000014',
      '10000000000000000015',
      '10000000000000000016',
      '10000000000000000017',
      '10000000000000000018',
      '10000000000000000019',
      '10000000000000000020',
      '10000000000000000021',
      '10000000000000000022',
      '10000000000000000023',
      '10000000000000000024',
    ].map((issueId) => ({
      issueId,
      classification: { origin: 'sentry', priority: 'high', status: 'unresolved' },
    })),
  });
  assert.equal(Buffer.byteLength(JSON.stringify(page)) <= 8192, true);
});

for (const value of [
  null,
  {},
  'private-token-canary',
  [null],
  [[]],
  [true],
  Array.from({ length: 26 }, (_, i) => issue({ id: String(i + 1) })),
  [issue(), issue()],
  [issue(), issue({ id: 42 })],
]) {
  test(`rejects invalid page ${JSON.stringify(value)}`, async (t) => {
    const request = serve(t, value);
    await fails(listSentryIssues(secret));
    assert.equal(request.mock.callCount(), 1);
  });
}
for (const id of [
  undefined,
  null,
  true,
  {},
  [],
  0,
  -1,
  1.5,
  Number.MAX_SAFE_INTEGER + 1,
  '',
  '0',
  '01',
  '+1',
  '1e2',
  '1'.repeat(21),
  ...['\n', '\r', '\r\n', '\u2028', '\u2029', ' ', '\t', 'x'].map((suffix) => `42${suffix}`),
]) {
  test(`rejects discovery identity ${JSON.stringify(id)}`, async (t) => {
    serve(t, [issue({ id })]);
    await fails(listSentryIssues(secret));
  });
}
for (const project of [
  undefined,
  null,
  [],
  {},
  { id: 'other' },
  { id: '4512275993002064\n' },
  { id: '4512275993002064\r' },
]) {
  test(`rejects project ${JSON.stringify(project)}`, async (t) => {
    serve(t, [issue({ project })]);
    await fails(listSentryIssues(secret));
  });
}
for (const field of ['priority', 'status']) {
  for (const value of [1, true, {}, [], 'x'.repeat(65)]) {
    test(`rejects malformed ${field} ${JSON.stringify(value)}`, async (t) => {
      serve(t, [issue({ [field]: value })]);
      await fails(listSentryIssues(secret));
    });
  }
}
for (const [priority, status, expectedPriority, expectedStatus] of [
  ['high', 'unresolved', 'high', 'unresolved'],
  ['medium', 'resolved', 'medium', 'resolved'],
  ['low', 'ignored', 'low', 'ignored'],
  [null, undefined, 'unknown', 'unknown'],
  ['x'.repeat(64), '', 'unknown', 'unknown'],
]) {
  test(`normalizes classification ${priority} ${status}`, async (t) => {
    serve(t, [issue({ priority, status, project: { id: 4512275993002064 } })]);
    assert.deepEqual(await listSentryIssues(secret), {
      ...empty,
      items: [
        {
          issueId: '42',
          classification: { origin: 'sentry', priority: expectedPriority, status: expectedStatus },
        },
      ],
    });
  });
}
for (const token of ['', 'a\n', 'é', 'x'.repeat(8193)]) {
  test(`rejects invalid token of length ${token.length} before fetch`, async (t) => {
    const request = serve(t, []);
    await fails(listSentryIssues(token));
    assert.equal(request.mock.callCount(), 0);
  });
}
test('pre-aborted input makes no request', async (t) => {
  const request = serve(t, []);
  await fails(listSentryIssues(secret, { signal: AbortSignal.abort(secret) }));
  assert.equal(request.mock.callCount(), 0);
});
for (const status of [201, 301, 401, 403, 404, 429, 500]) {
  test(`rejects HTTP ${status} without following links or retries`, async (t) => {
    const result = response(secret, status);
    result.headers.set('Link', '<https://private.invalid/>; rel="next"');
    const request = t.mock.method(globalThis, 'fetch', async () => result);
    await fails(listSentryIssues(secret));
    assert.equal(request.mock.callCount(), 1);
  });
}
for (const [name, result] of [
  ['wrong URL', response('[]', 200, 'https://private.invalid/')],
  ['redirected', Object.defineProperty(response('[]'), 'redirected', { value: true })],
  ['missing body', response(null)],
  ['invalid JSON', response(secret)],
  ['invalid UTF-8', response(new Uint8Array([0xff]))],
  ['oversized body', response(' '.repeat(1_048_577))],
] as const) {
  test(`rejects ${name}`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => result);
    await fails(listSentryIssues(secret));
  });
}
test('network failures conceal private details', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error(secret);
  });
  await fails(listSentryIssues(secret));
});

for (const phase of ['headers', 'body']) {
  for (const trigger of ['caller', 'deadline']) {
    test(`${trigger} bounds stalled ${phase} and cancels late bodies`, async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
      const caller = new AbortController();
      const removed = t.mock.method(caller.signal, 'removeEventListener');
      const cleared = t.mock.method(globalThis, 'clearTimeout');
      const held = Promise.withResolvers<Response>();
      let canceled = 0;
      const body = new ReadableStream<Uint8Array>({
        pull: () => new Promise<void>(() => {}),
        cancel: () => {
          canceled++;
          return new Promise<void>(() => {});
        },
      });
      const result = response(body);
      const request = t.mock.method(globalThis, 'fetch', async () =>
        phase === 'headers' ? held.promise : result,
      );
      let settled = false;
      const pending = fails(listSentryIssues(secret, { signal: caller.signal })).then(() => {
        settled = true;
      });
      await setImmediate();
      if (trigger === 'caller') caller.abort(secret);
      else {
        t.mock.timers.tick(14_999);
        await setImmediate();
        assert.equal(settled, false);
        t.mock.timers.tick(1);
      }
      await pending;
      held.resolve(result);
      await setImmediate();
      assert.equal(canceled, 1);
      assert.equal(body.locked, false);
      assert.equal(request.mock.callCount(), 1);
      assert.equal(request.mock.calls[0].arguments[1]?.signal?.aborted, true);
      assert.equal(removed.mock.callCount(), 1);
      assert.equal(cleared.mock.callCount(), 1);
    });
  }
}

test('successful discovery removes the listener and timer without aborting the request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const caller = new AbortController();
  const request = serve(t, []);
  const removed = t.mock.method(caller.signal, 'removeEventListener');
  const cleared = t.mock.method(globalThis, 'clearTimeout');
  assert.deepEqual(await listSentryIssues(secret, { signal: caller.signal }), empty);
  caller.abort();
  t.mock.timers.tick(15_000);
  assert.equal(request.mock.calls[0].arguments[1]?.signal?.aborted, false);
  assert.equal(removed.mock.callCount(), 1);
  assert.equal(cleared.mock.callCount(), 1);
});

for (const operation of ['discovery', 'observation']) {
  for (const phase of ['normalization', 'serialization', 'result bound']) {
    test(`${operation} lifetime includes ${phase}`, async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      let now = 0;
      t.mock.method(Date, 'now', () => now);
      const issueUrl = 'https://sentry.io/api/0/organizations/pasta-re/issues/42/';
      const initial = response(
        JSON.stringify(operation === 'discovery' ? [issue()] : issue()),
        200,
        operation === 'discovery' ? url : issueUrl,
      );
      const latest = response('{}', 404, `${issueUrl}events/latest/`);
      let calls = 0;
      const request = t.mock.method(globalThis, 'fetch', async () =>
        ++calls === 1 ? initial : latest,
      );
      if (phase === 'normalization') {
        const parse = JSON.parse;
        t.mock.method(JSON, 'parse', (text: string) => {
          const value = parse(text);
          const target = operation === 'discovery' ? value[0] : value;
          Object.defineProperty(target, 'priority', {
            get() {
              now = 15_000;
              return 'high';
            },
          });
          return value;
        });
      } else {
        const stringify = JSON.stringify;
        t.mock.method(JSON, 'stringify', (value: unknown) => {
          const result = stringify(value);
          if (phase === 'result bound') return 'x'.repeat(operation === 'discovery' ? 8193 : 2049);
          now = 15_000;
          return result;
        });
      }
      await fails(
        operation === 'discovery' ? listSentryIssues(secret) : observeSentryIssue(secret, '42'),
        operation === 'discovery' ? 'Sentry discovery failed.' : 'Sentry observation failed.',
      );
      assert.equal(
        request.mock.callCount(),
        operation === 'discovery' || phase === 'normalization' ? 1 : 2,
      );
      assert.equal(request.mock.calls[0].arguments[1]?.signal?.aborted, true);
    });
  }
}

for (const token of [null, undefined, 123, {}, []]) {
  test(`rejects runtime token ${JSON.stringify(token)} before requests`, async (t) => {
    const request = serve(t, []);
    await fails(Reflect.apply(listSentryIssues, undefined, [token]));
    assert.equal(request.mock.callCount(), 0);
  });
}

test('accepts the token and body byte boundaries', async (t) => {
  const body = `[]${' '.repeat(1_048_574)}`;
  t.mock.method(globalThis, 'fetch', async () => response(body));
  assert.deepEqual(await listSentryIssues('x'.repeat(8192)), empty);
});

test('checks elapsed time after JSON parsing before normalization', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  const request = serve(t, []);
  const parse = JSON.parse;
  t.mock.method(JSON, 'parse', (text: string) => {
    const value: unknown = parse(text);
    now = 15_000;
    return value;
  });
  await fails(listSentryIssues(secret));
  assert.equal(request.mock.callCount(), 1);
  assert.equal(request.mock.calls[0].arguments[1]?.signal?.aborted, true);
});
