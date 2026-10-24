import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateDsn,
  validateEnvelope,
  deliverEnvelope,
  confirmGroupedEvent,
} from '../scripts/check-monitored-sentry.mjs';

test('delivery retains the remote receipt but does not settle before browser fulfillment and disposal', async () => {
  let finish;
  const gate = new Promise((accept) => {
    finish = accept;
  });
  let disposed = false;
  const response = {
    status: () => 200,
    dispose: async () => {
      disposed = true;
    },
  };
  const receipts = [];
  let settled = false;
  const pending = deliverEnvelope(
    {
      fetch: async (options) => {
        assert.deepEqual(options, { maxRedirects: 0, timeout: 15000 });
        return response;
      },
      fulfill: async () => {
        await gate;
      },
    },
    { eventId: 'b'.repeat(32) },
    receipts,
  ).then(() => {
    settled = true;
  });
  await new Promise((accept) => setImmediate(accept));
  assert.equal(receipts.length, 1);
  assert.equal(settled, false);
  assert.equal(disposed, false);
  finish();
  await pending;
  assert.equal(settled, true);
  assert.equal(disposed, true);
});

test('browser fulfillment failure preserves remote delivery and disposes the response', async () => {
  const receipts = [];
  let disposed = false;
  await assert.rejects(
    deliverEnvelope(
      {
        fetch: async () => ({
          status: () => 200,
          dispose: async () => {
            disposed = true;
          },
        }),
        fulfill: async () => {
          throw new Error('closed context');
        },
      },
      { eventId: 'b'.repeat(32) },
      receipts,
    ),
  );
  assert.equal(receipts.length, 1);
  assert.equal(disposed, true);
});

test('historical grouping reads reuse the organization-scoped issue endpoint', async () => {
  const eventId = 'b'.repeat(32);
  await confirmGroupedEvent('synthetic-token', '123', eventId, async (url, options) => {
    assert.equal(
      url,
      `https://sentry.io/api/0/organizations/pasta-re/issues/123/events/${eventId}/`,
    );
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    return new Response(
      JSON.stringify({ eventID: eventId, groupID: '123', projectID: '4512275993002064' }),
    );
  });
});

const revision = 'a'.repeat(40);
const dsn = 'https://public@o123.ingest.de.sentry.io/4512275993002064';
test('monitored DSN must select the approved hosted project without redirects or extra data', () => {
  assert.equal(validateDsn(dsn).pathname, '/4512275993002064');
  for (const value of [
    undefined,
    '',
    'http://public@o123.ingest.de.sentry.io/4512275993002064',
    dsn.replace('4512275993002064', '99'),
    dsn.replace('public@', 'public:secret@'),
    dsn.replace('sentry.io', 'sentry.io.invalid'),
    `${dsn}?private=data`,
    `${dsn}#private`,
    `${dsn}\n`,
  ])
    assert.throws(() => validateDsn(value));
});
const event = {
  event_id: 'b'.repeat(32),
  timestamp: 123,
  platform: 'javascript',
  level: 'error',
  environment: 'demo',
  release: revision,
  tags: { 'fixture.scenario': 'profile-name' },
  fingerprint: ['eitri-fixture-v1', 'profile-name'],
  exception: { values: [{ type: 'Error', value: 'Synthetic fixture scenario: profile-name' }] },
};
const envelope = (value = event, type = 'event') =>
  Buffer.from(
    [
      JSON.stringify({ event_id: event.event_id }),
      JSON.stringify({ type }),
      JSON.stringify(value),
    ].join('\n'),
  );
test('only one bounded synthetic event with exact revision and no private context may be sent', () => {
  assert.deepEqual(validateEnvelope(envelope(), revision, 'profile-name'), {
    eventId: event.event_id,
    scenario: 'profile-name',
  });
  for (const value of [
    { ...event, release: 'wrong' },
    { ...event, environment: 'validation' },
    { ...event, tags: { ...event.tags, private: 'secret' } },
    { ...event, fingerprint: ['wrong'] },
    { ...event, event_id: 'invalid' },
    { ...event, request: { url: 'secret' } },
    { ...event, breadcrumbs: [] },
    { ...event, exception: { values: [{ type: 'Error', value: 'private' }] } },
    { ...event, exception: { values: [{ ...event.exception.values[0], stacktrace: {} }] } },
  ])
    assert.throws(() => validateEnvelope(envelope(value), revision, 'profile-name'));
  assert.throws(() => validateEnvelope(envelope(), revision, 'cart-total'));
  assert.throws(() => validateEnvelope(envelope(event, 'session'), revision, 'profile-name'));
  assert.throws(() => validateEnvelope(Buffer.alloc(16385), revision, 'profile-name'));
  assert.throws(() =>
    validateEnvelope(Buffer.concat([envelope(), Buffer.from('\n{}')]), revision, 'profile-name'),
  );
});
