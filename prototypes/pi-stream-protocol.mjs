import { isDeepStrictEqual } from 'node:util';
import { route } from './pi-stream-fixtures.ts';

// Private offline subset shared by 1.3.0 and the reviewed 1.4.0 declarations.
// Unknown fields/modalities are errors, never silently stripped or cast across versions.
const maxLine = 65_536;
const maxBytes = 1_048_576;
const maxFrames = 1024;
const invalid = () => {
  throw new Error('pi-stream-protocol-invalid');
};
const check = (condition) => {
  if (!condition) invalid();
};
const object = (v) => check(v !== null && typeof v === 'object' && !Array.isArray(v));
const string = (v) => check(typeof v === 'string' && v.isWellFormed());
const number = (v) => check(typeof v === 'number' && Number.isFinite(v) && v >= 0);
const integer = (v) => {
  number(v);
  check(Number.isSafeInteger(v));
};
const boolean = (v) => check(typeof v === 'boolean');
function fields(v, required, optional = []) {
  object(v);
  check(required.every((key) => Object.hasOwn(v, key)));
  check(Object.keys(v).every((key) => required.includes(key) || optional.includes(key)));
}
function optional(v, validators) {
  for (const [key, validate] of Object.entries(validators))
    if (Object.hasOwn(v, key)) validate(v[key]);
}
function list(v, validate) {
  check(Array.isArray(v));
  v.forEach(validate);
}
function json(v, depth = 0) {
  check(depth <= 24);
  if (v === null || typeof v === 'boolean') return;
  if (typeof v === 'string') return string(v);
  if (typeof v === 'number') return check(Number.isFinite(v));
  check(v !== null && typeof v === 'object');
  check(Object.getPrototypeOf(v) === Object.prototype || Array.isArray(v));
  if (Array.isArray(v)) {
    const keys = Object.keys(v);
    check(keys.length === v.length && keys.every((key, index) => key === String(index)));
  }
  check(Object.getOwnPropertySymbols(v).length === 0);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(v))) {
    if (Array.isArray(v) && key === 'length') continue;
    check(!['__proto__', 'constructor', 'prototype'].includes(key));
    check(descriptor.enumerable && Object.hasOwn(descriptor, 'value'));
    string(key);
    json(descriptor.value, depth + 1);
  }
}
function copy(v) {
  try {
    // Validate before stringify: undefined, accessors, NaN, cycles etc must not be lost.
    json(v);
    const encoded = JSON.stringify(v);
    check(Buffer.byteLength(encoded) <= maxLine - 1);
    return JSON.parse(encoded);
  } catch {
    invalid();
  }
}
function fixedRoute(v) {
  fields(v, ['provider', 'model', 'api', 'baseUrl']);
  check(isDeepStrictEqual(v, route));
}
function text(v) {
  fields(v, ['type', 'text'], ['textSignature']);
  check(v.type === 'text');
  string(v.text);
  optional(v, { textSignature: string });
}
function block(v) {
  if (v?.type === 'text') return text(v);
  if (v?.type === 'thinking') {
    fields(v, ['type', 'thinking'], ['thinkingSignature', 'redacted']);
    string(v.thinking);
    optional(v, { thinkingSignature: string, redacted: boolean });
    return;
  }
  fields(v, ['type', 'id', 'name', 'arguments'], ['thoughtSignature']);
  check(v.type === 'toolCall');
  string(v.id);
  string(v.name);
  check(v.id.length > 0 && v.name.length > 0);
  object(v.arguments);
  optional(v, { thoughtSignature: string });
}
function usage(v) {
  fields(
    v,
    ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens', 'cost'],
    ['reasoning', 'cacheWrite1h'],
  );
  for (const key of Object.keys(v).filter((key) => key !== 'cost')) integer(v[key]);
  fields(v.cost, ['input', 'output', 'cacheRead', 'cacheWrite', 'total']);
  Object.values(v.cost).forEach(number);
}
function assistant(v, partial = false) {
  fields(
    v,
    ['role', 'provider', 'model', 'api', 'content', 'usage', 'stopReason', 'timestamp'],
    [
      'responseId',
      'responseModel',
      'providerThinkingLevel',
      'thinkingLevel',
      'rawStopReason',
      'endTurn',
      'durationMs',
    ],
  );
  check(v.role === 'assistant');
  for (const key of ['provider', 'model', 'api']) check(v[key] === route[key]);
  list(v.content, block);
  usage(v.usage);
  integer(v.timestamp);
  check(
    ['stop', 'length', 'toolUse', 'error', 'aborted', ...(partial ? ['pending'] : [])].includes(
      v.stopReason,
    ),
  );
  optional(v, {
    responseId: string,
    responseModel: (x) => check(x === route.model),
    providerThinkingLevel: string,
    thinkingLevel: (x) => check(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(x)),
    rawStopReason: string,
    endTurn: boolean,
    durationMs: number,
  });
  const calls = v.content.filter((b) => b.type === 'toolCall');
  check(new Set(calls.map((b) => b.id)).size === calls.length);
  if (!partial && !['error', 'aborted'].includes(v.stopReason))
    check(calls.length > 0 === (v.stopReason === 'toolUse'));
}
export function validateAssistant(value) {
  const v = copy(value);
  assistant(v);
  return v;
}
function tool(v) {
  fields(v, ['name', 'description', 'parameters']);
  string(v.name);
  check(v.name.length > 0);
  string(v.description);
  object(v.parameters);
  check(v.parameters.type === 'object');
}
function content(v) {
  if (typeof v === 'string') string(v);
  else list(v, text);
}
function transcript(v) {
  fields(v, ['messages']);
  check(Array.isArray(v.messages) && v.messages.length > 0 && v.messages.length <= 128);
  const tools = new Map();
  const calls = new Map();
  const used = new Set();
  for (const m of v.messages) {
    object(m);
    integer(m.timestamp);
    if (m.role === 'system') {
      fields(m, ['role', 'content', 'timestamp'], ['sections', 'toolsAdded', 'toolsRemoved']);
      content(m.content);
      optional(m, {
        sections: (x) => {
          object(x);
          Object.values(x).forEach((s) => {
            if (s !== null) string(s);
          });
        },
        toolsAdded: (x) =>
          list(x, (t) => {
            tool(t);
            tools.set(t.name, t);
          }),
        toolsRemoved: (x) =>
          list(x, (t) => {
            fields(t, ['name']);
            string(t.name);
            tools.delete(t.name);
          }),
      });
    } else if (m.role === 'user') {
      check(calls.size === 0);
      fields(m, ['role', 'content', 'timestamp']);
      content(m.content);
    } else if (m.role === 'assistant') {
      check(calls.size === 0);
      assistant(m);
      for (const b of m.content.filter((b) => b.type === 'toolCall')) {
        check(tools.has(b.name) && !used.has(b.id));
        used.add(b.id);
        calls.set(b.id, b.name);
      }
    } else {
      fields(
        m,
        ['role', 'toolCallId', 'toolName', 'content', 'isError', 'timestamp'],
        ['details', 'usage', 'durationMs'],
      );
      check(
        m.role === 'toolResult' &&
          calls.has(m.toolCallId) &&
          calls.get(m.toolCallId) === m.toolName,
      );
      list(m.content, text);
      boolean(m.isError);
      optional(m, { usage, durationMs: number });
      calls.delete(m.toolCallId);
    }
  }
  check(calls.size === 0);
  return { tools, used };
}
export function validateRequest(value) {
  const v = copy(value);
  fields(v, ['version', 'caseId', 'actionId', 'epoch', 'route', 'context', 'options']);
  check(v.version === 1);
  string(v.caseId);
  string(v.actionId);
  check(
    v.caseId.length > 0 &&
      v.caseId.length <= 128 &&
      v.actionId.length > 0 &&
      v.actionId.length <= 128,
  );
  integer(v.epoch);
  check(v.epoch > 0);
  fixedRoute(v.route);
  transcript(v.context);
  fields(v.options, ['maxTokens']);
  integer(v.options.maxTokens);
  check(v.options.maxTokens > 0 && v.options.maxTokens <= 64);
  return v;
}
export function makeRequest(index, context) {
  return validateRequest({
    version: 1,
    caseId: 'synthetic-case',
    actionId: `synthetic-action-${index}`,
    epoch: 1,
    route,
    context,
    options: { maxTokens: 64 },
  });
}
export function encodeLine(value) {
  return Buffer.from(`${JSON.stringify(copy(value))}\n`);
}

export class JsonLines {
  #buffer = Buffer.alloc(0);
  #bytes = 0;
  #frames = 0;
  #failed = false;
  #ended = false;
  push(chunk) {
    try {
      check(!this.#failed && !this.#ended && Buffer.isBuffer(chunk));
      this.#bytes += chunk.length;
      check(this.#bytes <= maxBytes);
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      const result = [];
      let end;
      while ((end = this.#buffer.indexOf(10)) >= 0) {
        check(end > 0 && end < maxLine && ++this.#frames <= maxFrames);
        const line = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
          this.#buffer.subarray(0, end),
        );
        check(!line.includes('\r') && !line.startsWith('\ufeff'));
        result.push(copy(JSON.parse(line)));
        this.#buffer = this.#buffer.subarray(end + 1);
      }
      check(this.#buffer.length < maxLine);
      return result;
    } catch {
      this.#failed = true;
      invalid();
    }
  }
  finish() {
    const valid = !this.#failed && !this.#ended && this.#buffer.length === 0;
    this.#ended = true;
    check(valid);
  }
}

// One request/epoch only. A failure poisons the receiver; finish is required at EOF.
// Partial events are display data, not authority to execute a tool or commit success.
export class StreamReceiver {
  #request;
  #seq = 0;
  #bytes = 0;
  #started = false;
  #terminal;
  #failed = false;
  #ended = false;
  #blocks = [];
  #open;
  #delta = '';
  #tools;
  #used;
  constructor(request) {
    this.#request = validateRequest(request);
    ({ tools: this.#tools, used: this.#used } = transcript(this.#request.context));
  }
  accept(value) {
    try {
      check(!this.#failed && !this.#ended && !this.#terminal);
      const f = copy(value);
      this.#bytes += Buffer.byteLength(JSON.stringify(f));
      check(this.#bytes <= maxBytes);
      fields(f, ['version', 'caseId', 'actionId', 'epoch', 'route', 'seq', 'event']);
      for (const key of ['version', 'caseId', 'actionId', 'epoch', 'route'])
        check(isDeepStrictEqual(f[key], this.#request[key]));
      check(this.#seq < maxFrames && f.seq === this.#seq++);
      this.#event(f.event);
      return copy(f.event);
    } catch {
      this.#failed = true;
      invalid();
    }
  }
  #event(e) {
    if (e.type === 'done' || e.type === 'error') {
      const key = e.type === 'done' ? 'message' : 'error';
      fields(e, ['type', 'reason', key]);
      assistant(e[key]);
      check(e.reason === e[key].stopReason);
      if (e.type === 'done') {
        check(this.#started && !this.#open && ['stop', 'length', 'toolUse'].includes(e.reason));
        check(isDeepStrictEqual(e.message.content, this.#blocks));
      } else check(['error', 'aborted'].includes(e.reason));
      this.#checkCalls(e[key]);
      this.#terminal = e[key];
      return;
    }
    if (e.type === 'start') {
      fields(e, ['type', 'partial']);
      check(!this.#started);
      assistant(e.partial, true);
      this.#started = true;
      return;
    }
    check(this.#started);
    const match = /^(text|thinking|toolcall)_(start|delta|end)$/.exec(e.type);
    check(match);
    const [, kind, phase] = match;
    const extra =
      phase === 'delta'
        ? ['delta']
        : phase === 'end'
          ? [kind === 'toolcall' ? 'toolCall' : 'content']
          : [];
    fields(e, ['type', 'contentIndex', 'partial', ...extra]);
    assistant(e.partial, true);
    integer(e.contentIndex);
    check(e.contentIndex === this.#blocks.length && e.contentIndex < 128);
    const b = e.partial.content[e.contentIndex];
    block(b);
    check(b.type === (kind === 'toolcall' ? 'toolCall' : kind));
    if (phase === 'start') {
      check(!this.#open);
      this.#open = kind;
      this.#delta = '';
      return;
    }
    check(this.#open === kind);
    if (phase === 'delta') {
      string(e.delta);
      this.#delta += e.delta;
      check(Buffer.byteLength(this.#delta) < maxLine);
      return;
    }
    if (kind === 'toolcall') {
      block(e.toolCall);
      check(e.toolCall.type === 'toolCall' && isDeepStrictEqual(e.toolCall, b));
      if (this.#delta !== '') check(isDeepStrictEqual(JSON.parse(this.#delta), b.arguments));
    } else {
      string(e.content);
      check(e.content === (kind === 'text' ? b.text : b.thinking));
      check(e.content === this.#delta || (kind === 'thinking' && b.redacted && this.#delta === ''));
    }
    this.#blocks.push(b);
    this.#open = undefined;
  }
  #checkCalls(message) {
    for (const b of message.content.filter((b) => b.type === 'toolCall'))
      check(this.#tools.has(b.name) && !this.#used.has(b.id));
  }
  finish() {
    const valid = !this.#failed && !this.#ended && this.#terminal;
    this.#ended = true;
    check(valid);
    return copy(this.#terminal);
  }
}
