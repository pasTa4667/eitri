import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { describe, test, type TestContext } from 'node:test';
import {
  observeSentryIssue,
  type SentryEventContext,
  type SentryEventContextObservation,
  type SentryIssueObservationOptions,
  type SentryObservation,
} from '../src/sentry.ts';

const issueUrl = 'https://sentry.io/api/0/organizations/pasta-re/issues/12345/';
const eventUrl = `${issueUrl}events/latest/`;
const baseEvent = {
  groupID: '12345',
  projectID: '4512275993002064',
  eventID: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  dateCreated: '2026-02-01T12:00:00Z',
  entries: [],
};

function response(value: unknown, url: string, status = 200) {
  const result = new Response(JSON.stringify(value), { status });
  Object.defineProperty(result, 'url', { value: url });
  return result;
}

function serve(t: TestContext, values: Response[]) {
  let count = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    const result = values[count++];
    assert.ok(result, 'no additional request is allowed');
    return result;
  });
  return fetch;
}

function typeChecks(token: string, issueId: string, options: SentryIssueObservationOptions) {
  const ordinary: Promise<SentryObservation> = observeSentryIssue(token, issueId, {
    signal: options.signal,
  });
  const contextual: Promise<SentryEventContextObservation> = observeSentryIssue(token, issueId, {
    eventContext: 'reported-environment-release',
  });
  const union: Promise<SentryObservation | SentryEventContextObservation> = observeSentryIssue(
    token,
    issueId,
    options,
  );
  void [ordinary, contextual, union];
}
void typeChecks;

const context: SentryEventContext = {
  environment: { kind: 'reported', value: 'production-us_1.example' },
  release: { kind: 'reported', value: 'v2.4.1+build@prod' },
};

function contextualOutput(
  event: Record<string, unknown>,
  expectedContext: SentryEventContext = context,
) {
  return {
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
      evidence: { reportedExceptionCount: 0, reportedStackFrameCount: 0 },
      context: expectedContext,
    },
  };
}

async function rejectObservation(pending: Promise<unknown>) {
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'Sentry observation failed.');
    assert.equal(Object.getOwnPropertyNames(error).sort().join(','), 'message,stack');
    assert.equal('cause' in error, false);
    return true;
  });
}

describe('reported Sentry event context', { concurrency: false }, () => {
  test('adds allowlisted metadata from the same event in exactly two requests', async (t) => {
    const request = serve(t, [
      response(
        {
          id: '12345',
          project: { id: '4512275993002064' },
          priority: 'high',
          status: 'unresolved',
        },
        issueUrl,
      ),
      response(
        {
          ...baseEvent,
          environment: 'ignored-top-level',
          tags: [
            { key: 'environment', value: 'production-us_1.example' },
            { key: 'other', value: 'private-tag' },
          ],
          release: {
            version: 'v2.4.1+build@prod',
            repository: 'private-repository',
            commits: ['private-commit'],
          },
          request: { url: 'private-url' },
        },
        eventUrl,
      ),
    ]);
    const result = await observeSentryIssue('token', '12345', {
      eventContext: 'reported-environment-release',
    });
    assert.deepEqual(result, contextualOutput({}));
    assert.equal(request.mock.callCount(), 2);
    assert.deepEqual(
      request.mock.calls.map(({ arguments: [url] }) => String(url)),
      [issueUrl, eventUrl],
    );
    assert.equal(JSON.stringify(result).includes('private-'), false);
    assert.equal(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 2048, true);
  });

  test('represents missing metadata explicitly and ignores unrelated fields', async (t) => {
    const request = serve(t, [
      response(
        {
          id: '12345',
          project: { id: '4512275993002064' },
          priority: 'high',
          status: 'unresolved',
        },
        issueUrl,
      ),
      response({ ...baseEvent, tags: null, release: null, environment: 'ignored' }, eventUrl),
    ]);
    assert.deepEqual(
      await observeSentryIssue('token', '12345', { eventContext: 'reported-environment-release' }),
      contextualOutput(
        {},
        {
          environment: { kind: 'not-reported' },
          release: { kind: 'not-reported' },
        },
      ),
    );
    assert.equal(request.mock.callCount(), 2);
  });

  test('default observation ignores malformed context fields and preserves its exact output', async (t) => {
    const request = serve(t, [
      response(
        {
          id: '12345',
          project: { id: '4512275993002064' },
          priority: 'high',
          status: 'unresolved',
        },
        issueUrl,
      ),
      response({ ...baseEvent, tags: 'malformed', release: [], environment: 'private' }, eventUrl),
    ]);
    assert.deepEqual(await observeSentryIssue('token', '12345'), {
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
        evidence: { reportedExceptionCount: 0, reportedStackFrameCount: 0 },
      },
    });
    assert.equal(request.mock.callCount(), 2);
  });

  test('latest-event 404 remains unavailable without context', async (t) => {
    const request = serve(t, [
      response({ id: '12345', project: { id: '4512275993002064' } }, issueUrl),
      response({}, eventUrl, 404),
    ]);
    assert.deepEqual(
      await observeSentryIssue('token', '12345', { eventContext: 'reported-environment-release' }),
      {
        source: {
          provider: 'sentry',
          organization: 'pasta-re',
          projectId: '4512275993002064',
          issueId: '12345',
        },
        classification: { origin: 'sentry', priority: 'unknown', status: 'unknown' },
        event: { kind: 'unavailable', reason: 'latest-event-not-found' },
      },
    );
    assert.equal(request.mock.callCount(), 2);
  });

  test('accepts grammar boundaries and rejects malformed selected context', async (t) => {
    const goodEnvironment = `A${'a'.repeat(63)}`;
    assert.equal(goodEnvironment.length, 64);
    const goodRelease = `A${'a'.repeat(199)}`;
    assert.equal(goodRelease.length, 200);
    const validEvents = [
      {
        ...baseEvent,
        tags: [{ key: 'environment', value: goodEnvironment }],
        release: { version: goodRelease },
      },
      {
        ...baseEvent,
        tags: Array(128).fill({ key: 'other', value: 'ignored' }),
        release: { version: 'A' },
      },
      { ...baseEvent, tags: [{ key: 'other', value: { ignored: true } }] },
    ];
    const expectedContexts: SentryEventContext[] = [
      {
        environment: { kind: 'reported', value: goodEnvironment },
        release: { kind: 'reported', value: goodRelease },
      },
      {
        environment: { kind: 'not-reported' },
        release: { kind: 'reported', value: 'A' },
      },
      {
        environment: { kind: 'not-reported' },
        release: { kind: 'not-reported' },
      },
    ];
    for (const [index, value] of validEvents.entries()) {
      const fetch = serve(t, [
        response({ id: '12345', project: { id: '4512275993002064' } }, issueUrl),
        response(value, eventUrl),
      ]);
      const result = await observeSentryIssue('token', '12345', {
        eventContext: 'reported-environment-release',
      });
      assert.deepEqual(
        result.event.kind === 'available' ? result.event.context : undefined,
        expectedContexts[index],
      );
      assert.equal(fetch.mock.callCount(), 2);
    }
    assert.equal(goodEnvironment.length <= 64, true);
    assert.equal(goodRelease.length <= 200, true);
  });

  test('rejects malformed tags, duplicate environment tags and invalid selected values', async (t) => {
    const invalidEvents: Record<string, unknown>[] = [
      { tags: {} },
      { tags: Array(129).fill({ key: 'other' }) },
      { tags: [null] },
      { tags: [[]] },
      { tags: [{ key: 1 }] },
      { tags: [{ key: 'x'.repeat(201) }] },
      { tags: [{ key: 'environment' }] },
      { tags: [{ key: 'environment', value: null }] },
      { tags: [{ key: 'environment', value: 1 }] },
      {
        tags: [
          { key: 'environment', value: 'production' },
          { key: 'environment', value: 'production' },
        ],
      },
      { tags: [{ key: 'environment', value: '' }] },
      ...['a'.repeat(65), 'a\n', ' a', 'é', '_name', 'a/'.repeat(2)].map((value) => ({
        tags: [{ key: 'environment', value }],
      })),
      { release: [] },
      { release: 'release' },
      { release: { version: '' } },
      ...['a'.repeat(201), 'a\n', ' a', 'é', '_name', 'a/'.repeat(2)].map((version) => ({
        release: { version },
      })),
    ];
    for (const [index, metadata] of invalidEvents.entries()) {
      await t.test(String(index), async (t) => {
        const request = serve(t, [
          response({ id: '12345', project: { id: '4512275993002064' } }, issueUrl),
          response({ ...baseEvent, ...metadata }, eventUrl),
        ]);
        await rejectObservation(
          observeSentryIssue('token', '12345', { eventContext: 'reported-environment-release' }),
        );
        assert.equal(request.mock.callCount(), 2);
      });
    }
  });

  test('opt-in reads retain caller cancellation and the shared 15-second deadline', async (t) => {
    const preAborted = new AbortController();
    preAborted.abort();
    const noRequests = serve(t, []);
    await rejectObservation(
      observeSentryIssue('token', '12345', {
        eventContext: 'reported-environment-release',
        signal: preAborted.signal,
      }),
    );
    assert.equal(noRequests.mock.callCount(), 0);

    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    const body = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) });
    const issueResponse = response({ id: '12345', project: { id: '4512275993002064' } }, issueUrl);
    const eventResponse = new Response(body, { status: 200 });
    Object.defineProperty(eventResponse, 'url', { value: eventUrl });
    const request = serve(t, [issueResponse, eventResponse]);
    const pending = rejectObservation(
      observeSentryIssue('token', '12345', { eventContext: 'reported-environment-release' }),
    );
    await setImmediate();
    assert.equal(body.locked, true);
    t.mock.timers.tick(15_000);
    await pending;
    assert.equal(request.mock.callCount(), 2);
    assert.equal(request.mock.calls[0].arguments[1]?.signal?.aborted, true);
    assert.equal(body.locked, false);
  });

  test('rejects unsupported runtime modes before requesting Sentry', async (t) => {
    const request = serve(t, []);
    for (const eventContext of [false, '', 'other', null, 1]) {
      const options = { eventContext } as unknown as SentryIssueObservationOptions;
      await rejectObservation(observeSentryIssue('token', '12345', options));
    }
    assert.equal(request.mock.callCount(), 0);
  });
});
