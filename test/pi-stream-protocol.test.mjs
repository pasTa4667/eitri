import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { probePiStream } from '../prototypes/pi-stream.mjs';
import {
  validateRequest,
  validateAssistant,
  StreamReceiver,
  JsonLines,
  encodeLine,
  makeRequest,
} from '../prototypes/pi-stream-protocol.mjs';
import {
  context,
  route,
  toolResponse,
  toolResult,
  finalResponse,
} from '../prototypes/pi-stream-fixtures.ts';

const request = () => makeRequest(0, context);
const clone = (value) => structuredClone(value);
function events(message = toolResponse) {
  const partial = { ...message, stopReason: 'pending' };
  const result = [{ type: 'start', partial }];
  message.content.forEach((block, contentIndex) => {
    const kind = block.type === 'toolCall' ? 'toolcall' : block.type;
    result.push({ type: `${kind}_start`, contentIndex, partial });
    if (block.type === 'text' || (block.type === 'thinking' && !block.redacted)) {
      result.push({
        type: `${kind}_delta`,
        contentIndex,
        delta: block.text ?? block.thinking,
        partial,
      });
    }
    if (block.type === 'toolCall') {
      result.push({
        type: 'toolcall_delta',
        contentIndex,
        delta: JSON.stringify(block.arguments),
        partial,
      });
    }
    result.push({
      type: `${kind}_end`,
      contentIndex,
      partial,
      ...(kind === 'toolcall' ? { toolCall: block } : { content: block.text ?? block.thinking }),
    });
  });
  return [...result, { type: 'done', reason: message.stopReason, message }];
}
function frames(message = toolResponse) {
  const { version, caseId, actionId, epoch, route } = request();
  return events(message).map((event, seq) => ({
    version,
    caseId,
    actionId,
    epoch,
    route,
    seq,
    event,
  }));
}
function receive(values = frames()) {
  const receiver = new StreamReceiver(request());
  for (const value of values) receiver.accept(value);
  return receiver.finish();
}
function rejected(fn) {
  assert.throws(fn, { message: 'pi-stream-protocol-invalid' });
}

test('cross-version subset preserves ordered system updates, definitions, signatures, Unicode, IDs and usage', () => {
  const input = request();
  input.context.messages.push(
    clone(toolResponse),
    clone(toolResult),
    {
      role: 'system',
      content: [{ type: 'text', text: '更新' }],
      sections: { policy: null },
      toolsRemoved: [{ name: 'run_check' }],
      timestamp: 5,
    },
    clone(finalResponse),
  );
  assert.deepEqual(validateRequest(input), input);
  assert.notEqual(validateRequest(input).context, input.context);
  assert.deepEqual(receive(), toolResponse);
  for (const stopReason of ['stop', 'length']) {
    const message = {
      ...finalResponse,
      stopReason,
      responseId: 'synthetic-response',
      durationMs: 2,
      endTurn: true,
    };
    assert.deepEqual(receive(frames(message)), message);
  }
});

for (const [name, mutate] of [
  [
    'unknown field',
    (r) => {
      r.context.extra = true;
    },
  ],
  [
    'null message',
    (r) => {
      r.context.messages.push(null);
    },
  ],
  [
    'non-string tool result ID',
    (r) => {
      r.context.messages.push({ ...toolResult, toolCallId: {} });
    },
  ],
  [
    'shorthand context',
    (r) => {
      r.context.systemPrompt = 'flatten me';
    },
  ],
  [
    'image modality',
    (r) => {
      r.context.messages[1].content = [{ type: 'image', data: 'abc', mimeType: 'image/png' }];
    },
  ],
  [
    'custom role',
    (r) => {
      r.context.messages[1].role = 'bashExecution';
    },
  ],
  [
    'nonfinite timestamp',
    (r) => {
      r.context.messages[0].timestamp = Infinity;
    },
  ],
  [
    'undefined',
    (r) => {
      r.context.messages[0].sections.policy = undefined;
    },
  ],
  [
    'illformed Unicode',
    (r) => {
      r.context.messages[1].content = '\ud800';
    },
  ],
  [
    'oversize UTF8',
    (r) => {
      r.context.messages[1].content = '🛠'.repeat(25000);
    },
  ],
  [
    'deep JSON',
    (r) => {
      let x = {};
      for (let i = 0; i < 30; i++) x = { x };
      r.context.messages[0].toolsAdded[0].parameters = x;
    },
  ],
  [
    'orphan tool result',
    (r) => {
      r.context.messages.push(clone(toolResult));
    },
  ],
  [
    'duplicate call ID',
    (r) => {
      r.context.messages.push(clone(toolResponse), clone(toolResult), clone(toolResponse));
    },
  ],
  [
    'unknown tool',
    (r) => {
      const m = clone(toolResponse);
      m.content[2].name = 'shell';
      r.context.messages.push(m);
    },
  ],
  [
    'wrong result name',
    (r) => {
      r.context.messages.push(clone(toolResponse), { ...toolResult, toolName: 'shell' });
    },
  ],
  [
    'unresolved call',
    (r) => {
      r.context.messages.push(clone(toolResponse));
    },
  ],
  [
    'duplicate result',
    (r) => {
      r.context.messages.push(clone(toolResponse), clone(toolResult), clone(toolResult));
    },
  ],
  [
    'key fallback',
    (r) => {
      r.options.apiKey = 'synthetic-private';
    },
  ],
  [
    'headers',
    (r) => {
      r.options.headers = { Authorization: 'synthetic-private' };
    },
  ],
  [
    'environment',
    (r) => {
      r.options.env = { OPENAI_API_KEY: 'synthetic-private' };
    },
  ],
  [
    'virtual route',
    (r) => {
      r.route.type = 'virtual';
    },
  ],
  [
    'custom endpoint',
    (r) => {
      r.route.baseUrl = 'https://other.invalid';
    },
  ],
  [
    'model switch',
    (r) => {
      r.route.model = 'another';
    },
  ],
  [
    'provider switch',
    (r) => {
      r.route.provider = 'openai';
    },
  ],
  [
    'API switch',
    (r) => {
      r.route.api = 'other';
    },
  ],
  [
    'bad epoch',
    (r) => {
      r.epoch = 0;
    },
  ],
  [
    'generation bounds',
    (r) => {
      r.options.maxTokens = 65;
    },
  ],
]) {
  test(`request rejects ${name} without raw diagnostics`, () => {
    const input = request();
    mutate(input);
    rejected(() => validateRequest(input));
  });
}

test('JSON conversion rejects cycles, accessors, functions, sparse arrays and prototype pollution', () => {
  const sparse = [];
  sparse.length = 1;
  const namedArray = [];
  namedArray.length = 1;
  namedArray.extra = 'must not disappear';
  for (const value of [
    () => {},
    sparse,
    namedArray,
    JSON.parse('{"__proto__": {}}'),
    Object.defineProperty({}, 'x', {
      enumerable: true,
      get() {
        throw new Error('private');
      },
    }),
  ]) {
    const r = request();
    r.context.messages[0].toolsAdded[0].parameters.extra = value;
    rejected(() => validateRequest(r));
  }
  const r = request();
  r.context.messages.push(r);
  rejected(() => validateRequest(r));
});

for (const [name, mutate] of [
  [
    'wrong identity',
    (m) => {
      m.model = 'other';
    },
  ],
  [
    'negative usage',
    (m) => {
      m.usage.input = -1;
    },
  ],
  [
    'bad cost',
    (m) => {
      m.usage.cost.total = '0';
    },
  ],
  [
    'unknown block',
    (m) => {
      m.content.push({ type: 'audio' });
    },
  ],
  [
    'malformed arguments',
    (m) => {
      m.content[2].arguments = [];
    },
  ],
  [
    'invalid-arguments diagnostic',
    (m) => {
      m.content[2].argumentsError = 'synthetic-private';
    },
  ],
  [
    'raw diagnostic',
    (m) => {
      m.diagnostics = [{ message: 'synthetic-private' }];
    },
  ],
  [
    'raw provider error',
    (m) => {
      m.errorMessage = 'synthetic-private';
    },
  ],
  [
    'deferred',
    (m) => {
      m.stopReason = 'deferred';
    },
  ],
  [
    'pending terminal',
    (m) => {
      m.stopReason = 'pending';
    },
  ],
]) {
  test(`assistant rejects ${name}`, () => {
    const m = clone(toolResponse);
    mutate(m);
    rejected(() => validateAssistant(m));
  });
}

test('non-redacted thinking and structured tool argument deltas survive conversion', () => {
  const message = clone(toolResponse);
  message.content[1] = {
    type: 'thinking',
    thinking: 'Synthetic café 思考',
    thinkingSignature: 'opaque',
  };
  assert.deepEqual(receive(frames(message)), message);
});
for (const delta of ['{', '{"check":"different"}']) {
  test(`tool argument delta ${JSON.stringify(delta)} cannot disagree with its completed block`, () => {
    const f = frames();
    f.find((x) => x.event.type === 'toolcall_delta').event.delta = delta;
    rejected(() => receive(f));
  });
}

for (const [name, mutate] of [
  [
    'empty EOF',
    (f) => {
      f.length = 0;
    },
  ],
  [
    'missing terminal',
    (f) => {
      f.pop();
    },
  ],
  [
    'duplicate terminal',
    (f) => {
      f.push({ ...clone(f.at(-1)), seq: f.length });
    },
  ],
  [
    'late delta',
    (f) => {
      f.push({ ...clone(f[2]), seq: f.length });
    },
  ],
  [
    'wrong action',
    (f) => {
      f[1].actionId = 'older-action';
    },
  ],
  [
    'wrong case',
    (f) => {
      f[1].caseId = 'other-case';
    },
  ],
  [
    'wrong epoch',
    (f) => {
      f[1].epoch++;
    },
  ],
  [
    'wrong endpoint',
    (f) => {
      f[1].route = { ...route, baseUrl: 'https://other.invalid' };
    },
  ],
  [
    'wrong sequence',
    (f) => {
      f[1].seq++;
    },
  ],
  [
    'duplicate start',
    (f) => {
      f[1].event = clone(f[0].event);
    },
  ],
  [
    'delta before start',
    (f) => {
      f[0].event = clone(f[2].event);
    },
  ],
  [
    'unknown event',
    (f) => {
      f[1].event.type = 'retry';
    },
  ],
  [
    'bad block index',
    (f) => {
      f[1].event.contentIndex = 9;
    },
  ],
  [
    'wrong block end',
    (f) => {
      f[3].event.content = 'wrong';
    },
  ],
  [
    'terminal differs from updates',
    (f) => {
      f.at(-1).event.message.content[0].text = 'different';
    },
  ],
  [
    'terminal reason mismatch',
    (f) => {
      f.at(-1).event.reason = 'stop';
    },
  ],
  [
    'unfinished block',
    (f) => {
      f.splice(3, 1);
      f.forEach((x, seq) => {
        x.seq = seq;
      });
    },
  ],
]) {
  test(`stream rejects ${name}`, () => {
    const f = clone(frames());
    mutate(f);
    rejected(() => receive(f));
  });
}

test('error/aborted terminals are explicit failure reasons, never successful messages', () => {
  for (const reason of ['error', 'aborted']) {
    const f = frames().slice(0, 1);
    const error = { ...finalResponse, stopReason: reason };
    f.push({ ...f[0], seq: 1, event: { type: 'error', reason, error } });
    assert.deepEqual(receive(f), error);
    assert.deepEqual(receive([{ ...f[1], seq: 0 }]), error); // setup can fail before start
  }
});

test('returned event mutation cannot change the validated terminal retained by the receiver', () => {
  const receiver = new StreamReceiver(request());
  for (const frame of frames()) {
    const event = receiver.accept(frame);
    if (event.type === 'done') event.message.model = 'unvalidated-model';
  }
  assert.deepEqual(receiver.finish(), toolResponse);
});

test('receiver is poisoned after rejection; no partial result can become success', () => {
  const receiver = new StreamReceiver(request());
  rejected(() => receiver.accept({}));
  rejected(() => receiver.accept(frames()[0]));
  rejected(() => receiver.finish());
});

test('LF/UTF8 framing survives arbitrary byte splits without corrupting Unicode', () => {
  const wire = Buffer.concat(frames().map(encodeLine));
  const decoder = new JsonLines();
  const result = [];
  for (const byte of wire) result.push(...decoder.push(Buffer.from([byte])));
  decoder.finish();
  assert.deepEqual(result, frames());
});
for (const [name, wire] of [
  ['truncated', Buffer.from('{')],
  ['malformed', Buffer.from('{bad}\n')],
  ['invalid UTF8', Buffer.from([0xff, 10])],
  ['blank', Buffer.from('\n')],
  ['CRLF', Buffer.from('{}\r\n')],
  ['BOM', Buffer.from('\ufeff{}\n')],
  ['oversized', Buffer.alloc(65537, 120)],
]) {
  test(`framing rejects ${name}`, () => {
    const decoder = new JsonLines();
    rejected(() => {
      decoder.push(wire);
      decoder.finish();
    });
  });
}

test('total byte/event ceilings apply even to many individually small frames', () => {
  const decoder = new JsonLines();
  rejected(() => {
    for (let i = 0; i < 10000; i++) decoder.push(Buffer.from('{}\n'));
  });
  const receiver = new StreamReceiver(request());
  const f = frames();
  receiver.accept(f[0]);
  receiver.accept(f[1]);
  rejected(() => {
    for (let i = 2; i < 10000; i++)
      receiver.accept({ ...f[2], seq: i, event: { ...f[2].event, delta: '' } });
  });
});

const completeFrames = () => [
  ...frames(),
  ...frames(finalResponse).map((f) => ({ ...f, actionId: 'synthetic-action-1' })),
];
for (const [name, mutate, suffix = ''] of [
  [
    'stale terminal after next admission',
    (f) => {
      f.splice(frames().length, 0, clone(f[frames().length - 1]));
    },
  ],
  [
    'extra terminal after completion',
    (f) => {
      f.push(clone(f.at(-1)));
    },
  ],
  [
    'wrong epoch',
    (f) => {
      f[1].epoch++;
    },
  ],
  [
    'wrong model',
    (f) => {
      f.at(-1).event.message.model = 'other';
    },
  ],
  ['complete streams but failed process', () => {}, 'process.exitCode = 1;'],
  ['complete streams but leaked diagnostics', () => {}, 'console.error("synthetic-private");'],
  ['complete streams but trailing truncation', () => {}, 'process.stdout.write("{");'],
]) {
  test(`real pipe rejects ${name} without returning partial observations`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'eitri-stream-wire-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const childPath = join(root, 'child.mjs');
    const values = completeFrames();
    mutate(values);
    const wire = values.map((f) => JSON.stringify(f)).join('\n') + '\n';
    await writeFile(
      childPath,
      `process.stdin.resume(); process.stdout.write(${JSON.stringify(wire)}); ${suffix}`,
    );
    await assert.rejects(probePiStream({ childPath }), { message: 'pi-stream-offline-failed' });
  });
}

test('actual installed SDK child rejects a non-fixture request instead of dispatching or diagnosing it', async (t) => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'eitri-stream-input-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const pending = promisify(execFile)(
    process.execPath,
    [new URL('../prototypes/pi-stream-child.mjs', import.meta.url).pathname],
    {
      cwd: home,
      timeout: 10000,
      maxBuffer: 4096,
      env: {
        HOME: home,
        PI_CODING_AGENT_DIR: join(home, 'agent'),
        PI_OFFLINE: '1',
        PI_SKIP_VERSION_CHECK: '1',
        PI_TELEMETRY: '0',
        EITRI_PI_STREAM_CHILD: 'synthetic-only',
      },
    },
  );
  const r = request();
  r.options.apiKey = 'synthetic-private';
  pending.child.stdin.on('error', () => {});
  pending.child.stdin.end(`${JSON.stringify(r)}\n`);
  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, '');
    assert.equal(error.stderr, 'pi-stream-offline-failed\n');
    return true;
  });
});

test('truncated framing poisons the decoder rather than accepting a later suffix', () => {
  const decoder = new JsonLines();
  decoder.push(Buffer.from('{'));
  rejected(() => decoder.finish());
  rejected(() => decoder.push(Buffer.from('}\n')));
});
