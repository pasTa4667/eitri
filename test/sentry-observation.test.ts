import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { inspect } from 'node:util';
import { beforeEach, describe, test, type TestContext } from 'node:test';
import { observeSentryIssue } from '../src/sentry.ts';

const secret = 'unique-Sentry-secret-canary-83b251a9';
const issueUrl = 'https://sentry.io/api/0/organizations/pasta-re/issues/12345/';
const eventUrl = `${issueUrl}events/latest/`;
const available = {
  source: {
    provider: 'sentry',
    organization: 'pasta-re',
    projectId: '4512275993002064',
    issueId: '12345',
  },
  classification: { origin: 'sentry', priority: 'high', status: 'unresolved' },
  event: {
    kind: 'available',
    eventId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    occurredAt: '2026-02-01T12:00:00.000Z',
    evidence: { reportedExceptionCount: 1, reportedStackFrameCount: 2 },
  },
};

function issue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '12345',
    project: { id: '4512275993002064' },
    priority: 'high',
    status: 'unresolved',
    ...overrides,
  };
}

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a-legitimately-different-id',
    eventID: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    groupID: '12345',
    projectID: '4512275993002064',
    dateCreated: '2026-02-01T12:00:00Z',
    entries: [{ type: 'exception', data: { values: [{ stacktrace: { frames: [{}, {}] } }] } }],
    ...overrides,
  };
}

function response(body: BodyInit | ReadableStream<Uint8Array> | null, url: string, status = 200) {
  return Object.defineProperty(new Response(body, { status }), 'url', { value: url });
}

function json(value: unknown, url: string) {
  return response(JSON.stringify(value), url);
}

function serve(t: TestContext, responses: Response[]) {
  let index = 0;
  return t.mock.method(globalThis, 'fetch', async () => {
    const result = responses[index++];
    assert.ok(result, 'no additional request is allowed');
    return result;
  });
}

async function fails(pending: Promise<unknown>) {
  let failure: Error | undefined;
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(Object.getPrototypeOf(error), Error.prototype);
    assert.equal(error.message, 'Sentry observation failed.');
    assert.deepEqual(Object.getOwnPropertyNames(error).sort(), ['message', 'stack']);
    assert.equal('cause' in error, false);
    assert.equal(inspect(error).includes(secret), false);
    failure = error;
    return true;
  });
  return failure;
}

function stalledBody(cancel: () => Promise<void> | void) {
  return new ReadableStream<Uint8Array>({
    pull: () => new Promise<void>(() => {}),
    cancel,
  });
}

describe('observeSentryIssue', { concurrency: false }, () => {
  beforeEach((t) => {
    assert.ok('mock' in t);
    const calls: unknown[][] = [];
    for (const method of [
      'log',
      'info',
      'warn',
      'error',
      'debug',
      'dir',
      'table',
      'trace',
    ] as const)
      t.mock.method(console, method, (...args: unknown[]) => calls.push(args));
    t.after(() => assert.deepEqual(calls, []));
  });

  test('returns the full allowlisted observation through exactly two fixed GETs', async (t) => {
    const request = serve(t, [json(issue(), issueUrl), json(event(), eventUrl)]);
    const result = await observeSentryIssue(secret, '12345');
    assert.deepEqual(result, available);
    assert.equal(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 2048, true);
    assert.equal(request.mock.callCount(), 2);
    const signal = request.mock.calls[0].arguments[1]?.signal;
    assert.ok(signal instanceof AbortSignal);
    assert.equal(signal.aborted, false);
    assert.deepEqual(
      request.mock.calls.map(({ arguments: [url, options] }) => [String(url), options]),
      [
        [
          issueUrl,
          {
            method: 'GET',
            headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
            redirect: 'error',
            credentials: 'omit',
            signal,
          },
        ],
        [
          eventUrl,
          {
            method: 'GET',
            headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
            redirect: 'error',
            credentials: 'omit',
            signal,
          },
        ],
      ],
    );
  });

  test('omits all remote text, including metadata, exception and frame fields', async (t) => {
    serve(t, [
      json(
        issue({
          title: secret,
          environment: secret,
          release: secret,
          substatus: secret,
          extra: secret,
        }),
        issueUrl,
      ),
      json(
        event({
          id: secret,
          title: secret,
          environment: secret,
          release: secret,
          tags: [[secret, secret]],
          contexts: { secret },
          user: { email: secret },
          request: { headers: { Authorization: secret }, url: secret },
          breadcrumbs: [{ message: secret }],
          repository: secret,
          entries: [
            {
              type: 'exception',
              data: {
                values: [
                  {
                    type: secret,
                    value: secret,
                    stacktrace: {
                      frames: [
                        {
                          function: secret,
                          filename: secret,
                          abs_path: secret,
                          context_line: secret,
                        },
                        { vars: { secret }, pre_context: [secret], post_context: [secret] },
                      ],
                    },
                  },
                ],
              },
            },
            { type: 'unrelated', data: secret },
          ],
        }),
        eventUrl,
      ),
    ]);
    const result = await observeSentryIssue(secret, '12345');
    assert.deepEqual(result, available);
    assert.equal(inspect(result).includes(secret), false);
  });

  test('missing metadata stays absent and empty entries report zero counts', async (t) => {
    serve(t, [
      json(issue({ priority: null, status: 'future-status' }), issueUrl),
      json(event({ entries: [] }), eventUrl),
    ]);
    assert.deepEqual(await observeSentryIssue(secret, '12345'), {
      source: {
        provider: 'sentry',
        organization: 'pasta-re',
        projectId: '4512275993002064',
        issueId: '12345',
      },
      classification: { origin: 'sentry', priority: 'unknown', status: 'unknown' },
      event: {
        kind: 'available',
        eventId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        occurredAt: '2026-02-01T12:00:00.000Z',
        evidence: { reportedExceptionCount: 0, reportedStackFrameCount: 0 },
      },
    });
  });

  test('only latest-event 404 is unavailable and its unread body is safely canceled', async (t) => {
    for (const cleanup of ['stalled', 'rejected'] as const) {
      await t.test(cleanup, async (t) => {
        let canceled = 0;
        const body = stalledBody(() => {
          canceled++;
          return cleanup === 'stalled' ? new Promise(() => {}) : Promise.reject(new Error(secret));
        });
        const remoteIssue = issue({ status: 'future-status' });
        delete remoteIssue.priority;
        const request = serve(t, [json(remoteIssue, issueUrl), response(body, eventUrl, 404)]);
        assert.deepEqual(await observeSentryIssue(secret, '12345'), {
          source: {
            provider: 'sentry',
            organization: 'pasta-re',
            projectId: '4512275993002064',
            issueId: '12345',
          },
          classification: { origin: 'sentry', priority: 'unknown', status: 'unknown' },
          event: { kind: 'unavailable', reason: 'latest-event-not-found' },
        });
        assert.equal(request.mock.callCount(), 2);
        assert.equal(canceled, 1);
        assert.equal(body.locked, false);
      });
    }
  });

  test('retains only native closed classifications and maps unfamiliar bounded strings to unknown', async (t) => {
    for (const [index, [priority, status, expectedPriority, expectedStatus]] of [
      ['medium', 'resolved', 'medium', 'resolved'],
      ['low', 'ignored', 'low', 'ignored'],
      [undefined, undefined, 'unknown', 'unknown'],
      [null, null, 'unknown', 'unknown'],
      [secret, 's'.repeat(64), 'unknown', 'unknown'],
    ].entries()) {
      await t.test(`classification case ${index}`, async (t) => {
        serve(t, [json(issue({ priority, status }), issueUrl), json(event(), eventUrl)]);
        assert.deepEqual(await observeSentryIssue(secret, '12345'), {
          ...available,
          classification: { origin: 'sentry', priority: expectedPriority, status: expectedStatus },
        });
      });
    }
  });

  test('preflight rejects invalid selections and credentials without any request', async (t) => {
    const request = serve(t, []);
    for (const selected of [
      '',
      '0',
      '012345',
      '-1',
      '1.5',
      ' 12345',
      '12345\n',
      issueUrl,
      '1'.repeat(21),
      12345,
    ])
      await fails(observeSentryIssue(secret, selected as string));
    for (const token of [
      '',
      `${secret}\n`,
      `a ${secret}`,
      `a\u0000${secret}`,
      `é${secret}`,
      'x'.repeat(8193),
      null,
    ])
      await fails(observeSentryIssue(token as string, '12345'));
    const controller = new AbortController();
    controller.abort(new Error(secret));
    await fails(observeSentryIssue(secret, '12345', { signal: controller.signal }));
    assert.equal(request.mock.callCount(), 0);
  });

  test('accepts the selection and token size boundaries', async (t) => {
    const selected = '12345678901234567890';
    const url = `https://sentry.io/api/0/organizations/pasta-re/issues/${selected}/`;
    const request = serve(t, [
      json(issue({ id: selected }), url),
      json(event({ groupID: selected }), `${url}events/latest/`),
    ]);
    assert.deepEqual(await observeSentryIssue('x'.repeat(8192), selected), {
      ...available,
      source: {
        provider: 'sentry',
        organization: 'pasta-re',
        projectId: '4512275993002064',
        issueId: '12345678901234567890',
      },
    });
    assert.equal(request.mock.callCount(), 2);
    assert.equal(
      new Headers(request.mock.calls[0].arguments[1]?.headers).get('Authorization')?.length,
      8199,
    );
  });

  test('accepts lossless numeric remote identities and ignores the separate event id', async (t) => {
    serve(t, [
      json(issue({ id: 12345, project: { id: 4512275993002064 } }), issueUrl),
      json(
        event({ groupID: 12345, projectID: 4512275993002064, id: { arbitrary: secret } }),
        eventUrl,
      ),
    ]);
    assert.deepEqual(await observeSentryIssue(secret, '12345'), available);
  });

  test('rejects invalid issue identities before fetching an event', async (t) => {
    const invalid: unknown[] = [null, [], {}, issue({ project: null })];
    for (const value of [
      undefined,
      null,
      '54321',
      '012345',
      '12345 ',
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      {},
      [],
    ]) {
      invalid.push(issue({ id: value }));
      invalid.push(issue({ project: { id: value } }));
    }
    for (const [index, value] of invalid.entries()) {
      await t.test(String(index), async (t) => {
        const request = serve(t, [json(value, issueUrl)]);
        await fails(observeSentryIssue(secret, '12345'));
        assert.equal(request.mock.callCount(), 1);
      });
    }
  });

  test('rejects invalid event joins and event identifiers without partial observations', async (t) => {
    const invalid: unknown[] = [null, [], {}, event({ eventID: undefined })];
    for (const value of [
      undefined,
      null,
      '54321',
      '012345',
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      {},
      [],
    ]) {
      invalid.push(event({ groupID: value }));
      invalid.push(event({ projectID: value }));
    }
    for (const value of [
      '',
      'a'.repeat(31),
      'a'.repeat(33),
      'g'.repeat(32),
      `${'a'.repeat(32)}\n`,
      123,
      null,
    ])
      invalid.push(event({ eventID: value }));
    for (const [index, value] of invalid.entries()) {
      await t.test(String(index), async (t) => {
        const request = serve(t, [json(issue(), issueUrl), json(value, eventUrl)]);
        await fails(observeSentryIssue(secret, '12345'));
        assert.equal(request.mock.callCount(), 2);
      });
    }
  });

  test('rejects non-string and over-limit native classification fields', async (t) => {
    for (const key of ['priority', 'status']) {
      for (const value of [true, 1, {}, [], 'x'.repeat(65)]) {
        await t.test(`${key} ${JSON.stringify(value)}`, async (t) => {
          const request = serve(t, [json(issue({ [key]: value }), issueUrl)]);
          await fails(observeSentryIssue(secret, '12345'));
          assert.equal(request.mock.callCount(), 1);
        });
      }
    }
  });

  test('normalizes valid RFC 3339 dates, including offsets, leap days and fractional precision', async (t) => {
    for (const [dateCreated, occurredAt] of [
      ['2024-02-29T23:30:45.123456789+02:30', '2024-02-29T21:00:45.123Z'],
      ['2000-02-29t00:00:00z', '2000-02-29T00:00:00.000Z'],
      ['2026-02-01T12:00:00-05:30', '2026-02-01T17:30:00.000Z'],
    ]) {
      await t.test(dateCreated, async (t) => {
        serve(t, [json(issue(), issueUrl), json(event({ dateCreated }), eventUrl)]);
        assert.deepEqual(await observeSentryIssue(secret, '12345'), {
          ...available,
          event: {
            kind: 'available',
            eventId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            occurredAt,
            evidence: { reportedExceptionCount: 1, reportedStackFrameCount: 2 },
          },
        });
      });
    }
  });

  test('rejects malformed dates instead of silently rolling calendar fields', async (t) => {
    for (const dateCreated of [
      undefined,
      null,
      0,
      '',
      '2026-02-01',
      '2026-02-01T12:00:00',
      '2026-02-01 12:00:00Z',
      '2026-02-29T12:00:00Z',
      '1900-02-29T12:00:00Z',
      '2024-04-31T12:00:00Z',
      '2024-00-01T00:00:00Z',
      '2024-13-01T00:00:00Z',
      '2024-01-00T00:00:00Z',
      '2024-01-01T24:00:00Z',
      '2024-01-01T00:60:00Z',
      '2024-01-01T00:00:61Z',
      '2024-01-01T00:00:00+24:00',
      '2024-01-01T00:00:00+00:60',
      '2024-01-01T00:00:00.1234567890+00:00',
      '2026-02-01T12:00:00Z\n',
    ]) {
      await t.test(String(dateCreated), async (t) => {
        const request = serve(t, [json(issue(), issueUrl), json(event({ dateCreated }), eventUrl)]);
        await fails(observeSentryIssue(secret, '12345'));
        assert.equal(request.mock.callCount(), 2);
      });
    }
  });

  test('accepts structural limits exactly without truncating counts', async (t) => {
    const entries = [
      {
        type: 'exception',
        data: {
          values: Array.from({ length: 4 }, () => ({
            stacktrace: { frames: Array.from({ length: 128 }, () => ({})) },
          })),
        },
      },
      {
        type: 'exception',
        data: {
          values: Array.from({ length: 4 }, () => ({
            stacktrace: { frames: Array.from({ length: 128 }, () => ({})) },
          })),
        },
      },
      ...Array.from({ length: 30 }, () => ({ type: 'x'.repeat(64), data: secret })),
    ];
    serve(t, [json(issue(), issueUrl), json(event({ entries }), eventUrl)]);
    assert.deepEqual(await observeSentryIssue(secret, '12345'), {
      ...available,
      event: {
        kind: 'available',
        eventId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        occurredAt: '2026-02-01T12:00:00.000Z',
        evidence: { reportedExceptionCount: 8, reportedStackFrameCount: 1024 },
      },
    });
  });

  test('missing and null stacktraces contribute zero reported frames', async (t) => {
    serve(t, [
      json(issue(), issueUrl),
      json(
        event({ entries: [{ type: 'exception', data: { values: [{}, { stacktrace: null }] } }] }),
        eventUrl,
      ),
    ]);
    assert.deepEqual(await observeSentryIssue(secret, '12345'), {
      ...available,
      event: {
        kind: 'available',
        eventId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        occurredAt: '2026-02-01T12:00:00.000Z',
        evidence: { reportedExceptionCount: 2, reportedStackFrameCount: 0 },
      },
    });
  });

  test('rejects structural boundary plus one and malformed selected structures', async (t) => {
    const invalid: unknown[] = [
      undefined,
      null,
      {},
      Array(33).fill({ type: 'other' }),
      [null],
      [[]],
      [{}],
      [{ type: 1 }],
      [{ type: 'x'.repeat(65) }],
      [{ type: 'exception' }],
      [{ type: 'exception', data: [] }],
      [{ type: 'exception', data: { values: null } }],
      [{ type: 'exception', data: { values: Array(9).fill({}) } }],
      [
        { type: 'exception', data: { values: Array(4).fill({}) } },
        { type: 'exception', data: { values: Array(5).fill({}) } },
      ],
    ];
    for (const value of [
      null,
      [],
      1,
      { stacktrace: 1 },
      { stacktrace: [] },
      { stacktrace: {} },
      { stacktrace: { frames: {} } },
      { stacktrace: { frames: Array(129).fill({}) } },
      { stacktrace: { frames: [null] } },
      { stacktrace: { frames: [[]] } },
      { stacktrace: { frames: ['text'] } },
    ])
      invalid.push([{ type: 'exception', data: { values: [value] } }]);
    for (const [index, entries] of invalid.entries()) {
      await t.test(String(index), async (t) => {
        const request = serve(t, [json(issue(), issueUrl), json(event({ entries }), eventUrl)]);
        await fails(observeSentryIssue(secret, '12345'));
        assert.equal(request.mock.callCount(), 2);
      });
    }
  });

  test('enforces a separate streamed byte limit for each body without trusting Content-Length', async (t) => {
    const padded = (value: unknown) => {
      const text = JSON.stringify(value);
      const bytes = Buffer.from(text + ' '.repeat(1_048_576 - Buffer.byteLength(text)));
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 500_000));
          controller.enqueue(bytes.subarray(500_000));
          controller.close();
        },
      });
      return body;
    };
    const first = response(padded(issue()), issueUrl);
    const second = response(padded(event()), eventUrl);
    first.headers.set('Content-Length', '1');
    second.headers.set('Content-Length', '999999999');
    serve(t, [first, second]);
    assert.deepEqual(await observeSentryIssue(secret, '12345'), available);
    assert.equal(first.body?.locked, false);
    assert.equal(second.body?.locked, false);
  });

  test('rejects streaming byte boundary plus one and cancels the reader', async (t) => {
    for (const endpoint of ['issue', 'event']) {
      await t.test(endpoint, async (t) => {
        let canceled = 0;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Buffer.alloc(1_048_575, ' '));
            controller.enqueue(Buffer.from('é'));
          },
          cancel() {
            canceled++;
          },
        });
        const oversized = response(body, endpoint === 'issue' ? issueUrl : eventUrl);
        oversized.headers.set('Content-Length', '1');
        const request = serve(
          t,
          endpoint === 'issue' ? [oversized] : [json(issue(), issueUrl), oversized],
        );
        await fails(observeSentryIssue(secret, '12345'));
        assert.equal(canceled, 1);
        assert.equal(body.locked, false);
        assert.equal(request.mock.callCount(), endpoint === 'issue' ? 1 : 2);
      });
    }
  });

  test('rejects HTTP failures at either endpoint and discards unread bodies', async (t) => {
    for (const endpoint of ['issue', 'event']) {
      for (const status of [204, 301, 401, 403, 429, 500, ...(endpoint === 'issue' ? [404] : [])]) {
        await t.test(`${endpoint} ${status}`, async (t) => {
          let canceled = 0;
          const body =
            status === 204
              ? null
              : stalledBody(() => {
                  canceled++;
                  return Promise.reject(new Error(secret));
                });
          const rejected = response(body, endpoint === 'issue' ? issueUrl : eventUrl, status);
          const request = serve(
            t,
            endpoint === 'issue' ? [rejected] : [json(issue(), issueUrl), rejected],
          );
          await fails(observeSentryIssue(secret, '12345'));
          assert.equal(canceled, status === 204 ? 0 : 1);
          assert.equal(request.mock.callCount(), endpoint === 'issue' ? 1 : 2);
          assert.equal(body?.locked ?? false, false);
        });
      }
    }
  });

  test('rejects malformed success, redirects and mismatched response URLs', async (t) => {
    for (const endpoint of ['issue', 'event']) {
      for (const variant of [
        'json',
        'invalid-utf8',
        'array',
        'scalar',
        'null-body',
        'redirected',
        'wrong-url',
        'empty-url',
      ]) {
        await t.test(`${endpoint} ${variant}`, async (t) => {
          const url = endpoint === 'issue' ? issueUrl : eventUrl;
          let rejected = json(endpoint === 'issue' ? issue() : event(), url);
          if (variant === 'json') rejected = response(secret, url);
          if (variant === 'invalid-utf8') {
            const text = JSON.stringify(
              endpoint === 'issue' ? issue({ title: 'MARKER' }) : event({ title: 'MARKER' }),
            );
            const [before, after] = text.split('MARKER');
            rejected = response(
              Buffer.concat([Buffer.from(before), Buffer.from([0xff]), Buffer.from(after)]),
              url,
            );
          }
          if (variant === 'array') rejected = json([], url);
          if (variant === 'scalar') rejected = json(secret, url);
          if (variant === 'null-body') rejected = response(null, url);
          if (variant === 'redirected')
            Object.defineProperty(rejected, 'redirected', { value: true });
          if (variant === 'wrong-url') rejected = json({}, `${url}?remote=${secret}`);
          if (variant === 'empty-url') rejected = new Response(secret);
          const request = serve(
            t,
            endpoint === 'issue' ? [rejected] : [json(issue(), issueUrl), rejected],
          );
          await fails(observeSentryIssue(secret, '12345'));
          assert.equal(rejected.body?.locked ?? false, false);
          assert.equal(request.mock.callCount(), endpoint === 'issue' ? 1 : 2);
        });
      }
    }
  });

  test('replaces header and body failures with fresh generic errors', async (t) => {
    const failures: (Error | undefined)[] = [];
    for (const endpoint of ['issue', 'event']) {
      for (const stage of ['headers', 'body']) {
        await t.test(`${endpoint} ${stage}`, async (t) => {
          let calls = 0;
          t.mock.method(globalThis, 'fetch', async () => {
            calls++;
            if (endpoint === 'event' && calls === 1) return json(issue(), issueUrl);
            if (stage === 'headers') throw new Error(secret, { cause: { secret } });
            return response(
              new ReadableStream({
                start(controller) {
                  controller.error(new Error(secret));
                },
              }),
              endpoint === 'issue' ? issueUrl : eventUrl,
            );
          });
          failures.push(await fails(observeSentryIssue(secret, '12345')));
          assert.equal(calls, endpoint === 'issue' ? 1 : 2);
        });
      }
    }
    assert.equal(new Set(failures).size, 4);
  });

  test('clears its one timer and caller listener after success', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    const clear = t.mock.method(globalThis, 'clearTimeout');
    const timeout = t.mock.method(globalThis, 'setTimeout');
    const controller = new AbortController();
    const added = t.mock.method(controller.signal, 'addEventListener');
    const removed = t.mock.method(controller.signal, 'removeEventListener');
    const request = serve(t, [json(issue(), issueUrl), json(event(), eventUrl)]);
    assert.deepEqual(
      await observeSentryIssue(secret, '12345', { signal: controller.signal }),
      available,
    );
    assert.equal(timeout.mock.callCount(), 1);
    assert.equal(timeout.mock.calls[0].arguments[1], 15_000);
    assert.equal(clear.mock.callCount(), 1);
    assert.equal(removed.mock.callCount(), 1);
    assert.deepEqual(removed.mock.calls[0].arguments, ['abort', added.mock.calls[0].arguments[1]]);
    const signal = request.mock.calls[0].arguments[1]?.signal;
    assert.notEqual(signal, controller.signal);
    controller.abort(new Error(secret));
    t.mock.timers.tick(15_000);
    assert.equal(signal?.aborted, false);
    assert.equal(request.mock.callCount(), 2);
  });

  test('bounds stalled headers and cancels late responses without follow-up requests', async (t) => {
    for (const endpoint of ['issue', 'event']) {
      for (const trigger of ['deadline', 'caller']) {
        await t.test(`${endpoint} ${trigger}`, async (t) => {
          t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
          const clear = t.mock.method(globalThis, 'clearTimeout');
          const caller = new AbortController();
          const removed = t.mock.method(caller.signal, 'removeEventListener');
          const held = Promise.withResolvers<Response>();
          let calls = 0;
          let signal: AbortSignal | null | undefined;
          t.mock.method(
            globalThis,
            'fetch',
            async (_url: string | URL | Request, options?: RequestInit) => {
              calls++;
              signal = options?.signal;
              if (endpoint === 'event' && calls === 1) return json(issue(), issueUrl);
              return held.promise;
            },
          );
          let settled = false;
          const rejected = fails(
            observeSentryIssue(secret, '12345', { signal: caller.signal }),
          ).then(() => {
            settled = true;
          });
          await setImmediate();
          assert.equal(calls, endpoint === 'issue' ? 1 : 2);
          if (trigger === 'deadline') {
            t.mock.timers.tick(14_999);
            await setImmediate();
            assert.equal(settled, false);
            t.mock.timers.tick(1);
          } else caller.abort(new Error(secret));
          await rejected;
          assert.equal(signal?.aborted, true);
          assert.equal(clear.mock.callCount(), 1);
          assert.equal(removed.mock.callCount(), 1);
          let canceled = 0;
          const late = stalledBody(() => {
            canceled++;
            return new Promise(() => {});
          });
          held.resolve(response(late, endpoint === 'issue' ? issueUrl : eventUrl));
          await setImmediate();
          assert.equal(canceled, 1);
          assert.equal(late.locked, false);
          assert.equal(calls, endpoint === 'issue' ? 1 : 2);
        });
      }
    }
  });

  test('cancellation and deadline settle pending body reads and release their locks', async (t) => {
    for (const endpoint of ['issue', 'event']) {
      for (const trigger of ['deadline', 'caller']) {
        await t.test(`${endpoint} ${trigger}`, async (t) => {
          t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
          const clear = t.mock.method(globalThis, 'clearTimeout');
          const caller = new AbortController();
          const removed = t.mock.method(caller.signal, 'removeEventListener');
          let canceled = 0;
          const body = stalledBody(() => {
            canceled++;
            return Promise.reject(new Error(secret));
          });
          const blocked = response(body, endpoint === 'issue' ? issueUrl : eventUrl);
          const request = serve(
            t,
            endpoint === 'issue' ? [blocked] : [json(issue(), issueUrl), blocked],
          );
          const rejected = fails(observeSentryIssue(secret, '12345', { signal: caller.signal }));
          await setImmediate();
          assert.equal(body.locked, true);
          if (trigger === 'deadline') t.mock.timers.tick(15_000);
          else caller.abort(new Error(secret));
          await rejected;
          assert.equal(canceled, 1);
          assert.equal(body.locked, false);
          assert.equal(request.mock.calls[0].arguments[1]?.signal?.aborted, true);
          assert.equal(request.mock.callCount(), endpoint === 'issue' ? 1 : 2);
          assert.equal(clear.mock.callCount(), 1);
          assert.equal(removed.mock.callCount(), 1);
        });
      }
    }
  });

  test('one absolute deadline includes the SECOND body even with noncooperative reads and cleanup', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    const clear = t.mock.method(globalThis, 'clearTimeout');
    const caller = new AbortController();
    const removed = t.mock.method(caller.signal, 'removeEventListener');
    const held = Promise.withResolvers<Response>();
    const body = stalledBody(() => new Promise(() => {}));
    const blocked = response(body, eventUrl);
    const reader = body.getReader();
    const read = t.mock.method(
      reader,
      'read',
      () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {}),
    );
    const canceled = t.mock.method(reader, 'cancel');
    const released = t.mock.method(reader, 'releaseLock');
    t.mock.method(body, 'getReader', () => reader);
    let calls = 0;
    let signal: AbortSignal | null | undefined;
    t.mock.method(
      globalThis,
      'fetch',
      async (_url: string | URL | Request, options?: RequestInit) => {
        signal = options?.signal;
        return ++calls === 1 ? held.promise : blocked;
      },
    );
    let settled = false;
    const rejected = fails(observeSentryIssue(secret, '12345', { signal: caller.signal })).then(
      () => {
        settled = true;
      },
    );
    t.mock.timers.tick(10_000);
    held.resolve(json(issue(), issueUrl));
    await setImmediate();
    assert.equal(calls, 2);
    assert.equal(read.mock.callCount(), 1);
    t.mock.timers.tick(4_999);
    await setImmediate();
    assert.equal(settled, false);
    t.mock.timers.tick(1);
    await rejected;
    assert.equal(signal?.aborted, true);
    assert.equal(canceled.mock.callCount(), 1);
    assert.equal(released.mock.callCount(), 1);
    assert.equal(body.locked, false);
    assert.equal(calls, 2);
    assert.equal(clear.mock.callCount(), 1);
    assert.equal(removed.mock.callCount(), 1);
  });

  test('checks absolute elapsed time after synchronous parsing without waiting for timer delivery', async (t) => {
    for (const endpoint of ['issue', 'event']) {
      await t.test(endpoint, async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'], now: 0 });
        let now = 0;
        t.mock.method(Date, 'now', () => now);
        const parse = JSON.parse;
        let parsed = 0;
        t.mock.method(JSON, 'parse', (text: string) => {
          const result: unknown = parse(text);
          if (++parsed === (endpoint === 'issue' ? 1 : 2)) now = 15_000;
          return result;
        });
        const request = serve(t, [json(issue(), issueUrl), json(event(), eventUrl)]);
        await fails(observeSentryIssue(secret, '12345'));
        assert.equal(request.mock.callCount(), endpoint === 'issue' ? 1 : 2);
        assert.equal(request.mock.calls[0].arguments[1]?.signal?.aborted, true);
      });
    }
  });
});
