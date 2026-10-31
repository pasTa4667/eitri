import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotNativeLiveEvent } from '../prototypes/pi-native-live-events.mjs';
import { makeRequest, StreamReceiver } from '../prototypes/pi-stream-protocol.mjs';
import { context } from '../prototypes/pi-stream-fixtures.ts';

function fixture() {
  const request = makeRequest(0, context);
  const { context: _context, options: _options, ...identity } = request;
  const partial = {
    role: 'assistant',
    provider: request.route.provider,
    model: request.route.model,
    api: request.route.api,
    content: [],
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'pending',
    timestamp: 1,
  };
  const block = { type: 'toolCall', id: 'call-1', name: 'run_check', arguments: {} };
  const start = {
    type: 'toolcall_start',
    contentIndex: 0,
    partial: { ...partial, content: [{ ...block, partialJson: '' }] },
  };
  const receiver = new StreamReceiver(request);
  receiver.accept({ ...identity, seq: 0, event: { type: 'start', partial } });
  return { identity, partial, block, start, receiver };
}

test('live snapshots project only the active partial scratch buffer without mutating SDK data', () => {
  const { identity, start, receiver } = fixture();
  const before = structuredClone(start);
  const normalized = snapshotNativeLiveEvent(start);
  assert.deepEqual(start, before);
  assert.equal(Object.hasOwn(normalized.partial.content[0], 'partialJson'), false);
  assert.deepEqual(receiver.accept({ ...identity, seq: 1, event: normalized }), normalized);
  const delta = structuredClone(start);
  Object.assign(delta, { type: 'toolcall_delta', delta: '{"value":"λ' });
  Object.assign(delta.partial.content[0], { arguments: { value: 'λ' }, partialJson: delta.delta });
  const snapshot = snapshotNativeLiveEvent(delta);
  assert.deepEqual(receiver.accept({ ...identity, seq: 2, event: snapshot }), snapshot);
  delta.partial.content[0].arguments.value = 'later mutation';
  delete delta.partial.content[0].partialJson;
  assert.equal(snapshot.partial.content[0].arguments.value, 'λ');
  assert.throws(() => receiver.finish(), /^Error: pi-stream-protocol-invalid$/);
});

test('live projection preserves argument data and terminals while retaining end/delta validation', () => {
  for (const fault of ['none', 'mismatched-delta', 'terminal-scratch', 'terminal-content']) {
    const { identity, partial, block, start, receiver } = fixture();
    block.arguments = { partialJson: 'actual argument, not SDK scratch' };
    const frame = (seq, event) => ({ ...identity, seq, event: snapshotNativeLiveEvent(event) });
    receiver.accept(frame(1, start));
    const json = JSON.stringify(block.arguments);
    receiver.accept(
      frame(2, {
        type: 'toolcall_delta',
        contentIndex: 0,
        delta: fault === 'mismatched-delta' ? '{}' : json,
        partial: { ...partial, content: [{ ...block, partialJson: json }] },
      }),
    );
    const end = {
      type: 'toolcall_end',
      contentIndex: 0,
      toolCall: block,
      partial: { ...partial, content: [block] },
    };
    if (fault === 'mismatched-delta') {
      assert.throws(() => receiver.accept(frame(3, end)));
      continue;
    }
    receiver.accept(frame(3, end));
    const done = {
      type: 'done',
      reason: 'toolUse',
      message: { ...partial, content: [structuredClone(block)], stopReason: 'toolUse' },
    };
    if (fault === 'terminal-scratch') done.message.content[0].partialJson = json;
    if (fault === 'terminal-content') done.message.content[0].arguments = {};
    const before = structuredClone(done);
    const normalized = snapshotNativeLiveEvent(done);
    assert.deepEqual(normalized, before);
    assert.deepEqual(done, before);
    if (fault !== 'none')
      assert.throws(() => receiver.accept({ ...identity, seq: 4, event: normalized }));
    else {
      receiver.accept({ ...identity, seq: 4, event: normalized });
      assert.deepEqual(receiver.finish(), done.message);
      assert.throws(() => receiver.accept({ ...identity, seq: 5, event: normalized }));
    }
  }
});

test('live projection rejects malformed or oversized scratch before discarding it', () => {
  for (const scratch of [null, 1, {}, [], '\ud800', 'x'.repeat(65_536), 'λ'.repeat(32_768)]) {
    const { start } = fixture();
    start.partial.content[0].partialJson = scratch;
    assert.throws(() => snapshotNativeLiveEvent(start));
  }
});

test('live projection never hides unknown fields, unsupported tool kinds or misplaced scratch', () => {
  for (const change of [
    (e) => {
      e.partial.content[0].unknown = true;
    },
    (e) => {
      e.partial.content[0].namespace = 'unsupported';
    },
    (e) => {
      e.partial.content[0].customInput = 'unsupported';
    },
    (e) => {
      e.partial.content[0].type = 'text';
    },
    (e) => {
      e.partial.content.push({ ...e.partial.content[0] });
    },
    (e) => {
      e.partial.partialJson = '';
    },
    (e) => {
      e.partialJson = '';
    },
    (e) => {
      e.contentIndex = 1;
    },
    (e) => {
      e.type = 'text_start';
    },
    (e) => {
      e.type = 'start';
      delete e.contentIndex;
    },
    (e) => {
      e.type = 'toolcall_end';
      e.toolCall = structuredClone(e.partial.content[0]);
    },
    (e) => {
      e.type = 'done';
      e.reason = 'toolUse';
      e.message = e.partial;
      delete e.partial;
      delete e.contentIndex;
    },
  ]) {
    const { identity, start, receiver } = fixture();
    change(start);
    assert.throws(() =>
      receiver.accept({ ...identity, seq: 1, event: snapshotNativeLiveEvent(start) }),
    );
    assert.throws(() => receiver.finish(), /^Error: pi-stream-protocol-invalid$/);
  }
});

test('live projection leaves strict event sequencing and correlation checks authoritative', () => {
  for (const change of [
    (f) => {
      f.actionId = 'wrong';
    },
    (f) => {
      f.epoch++;
    },
    (f) => {
      f.seq++;
    },
    (f) => {
      f.event.partial.provider = 'wrong';
    },
  ]) {
    const { identity, start, receiver } = fixture();
    const frame = { ...identity, seq: 1, event: snapshotNativeLiveEvent(start) };
    change(frame);
    assert.throws(() => receiver.accept(frame), /^Error: pi-stream-protocol-invalid$/);
  }
});
