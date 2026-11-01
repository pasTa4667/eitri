import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { writeSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

// Fixed synthetic transport only. No real fetch implementation is retained or called.
const scenario = new URL(import.meta.url).searchParams.get('scenario');
const native = new URL(import.meta.url).searchParams.get('native') === '1';
const fixtureRead =
  process.argv.includes('--native-read') || process.env.EITRI_PI_NATIVE_FIXTURE === 'read-fixture';
const fixtureCheck =
  process.argv.includes('--native-check') ||
  process.env.EITRI_PI_NATIVE_FIXTURE === 'check-fixture';
const toolName = fixtureCheck
  ? 'run_check'
  : fixtureRead
    ? 'read_fixture'
    : native
      ? 'probe'
      : 'eitri_probe';
const record = (value) => {
  if (!native) writeSync(3, `${JSON.stringify(value)}\n`);
};
let requests = 0,
  refreshes = 0;
let expire;
const originalTimer = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => {
  if (ms === 120_000) {
    expire = fn;
    return originalTimer(fn, scenario === 'hung' ? 1000 : ms, ...args);
  }
  return originalTimer(fn, ms, ...args);
};
if (scenario.startsWith('launcher')) {
  childProcess.spawn = (file, args, options) => {
    assert.equal(file, process.execPath);
    assert.deepEqual(args.slice(1), [
      ...(fixtureCheck
        ? ['--native-check']
        : fixtureRead
          ? ['--native-read']
          : process.argv.includes('--native')
            ? ['--native']
            : []),
      '--run',
    ]);
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'ignore']);
    assert.deepEqual(Object.keys(options.env).sort(), [
      'EITRI_PI_TOOL_CHILD',
      'EITRI_PI_TOOL_HOME',
      'HOME',
      'PATH',
      'PI_CODING_AGENT_DIR',
      'PI_OFFLINE',
      'PI_SKIP_VERSION_CHECK',
      'PI_TELEMETRY',
    ]);
    if (fixtureCheck) {
      assert.notEqual(options.cwd, options.env.HOME);
      assert.equal(options.env.HOME, options.env.EITRI_PI_TOOL_HOME);
      assert.equal(options.env.PATH, '/usr/local/bin:/usr/bin:/bin');
    } else {
      assert.equal(options.cwd, options.env.HOME);
      assert.notEqual(options.env.HOME, process.env.HOME);
    }
    assert.equal(
      options.env.PI_CODING_AGENT_DIR,
      `${options.env.EITRI_PI_TOOL_HOME}/Library/Application Support/eitri/pi`,
    );
    record({ kind: 'clean-launch' });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => queueMicrotask(() => child.emit('close', 1, 'SIGKILL'));
    queueMicrotask(() => {
      if (scenario === 'launcher-private') {
        child.stdout.emit('data', Buffer.from('private-provider-text\n'));
        return;
      }
      if (scenario.startsWith('launcher-diagnostic')) {
        const frame = {
          failureStage:
            scenario === 'launcher-diagnostic-private'
              ? 'private-provider-text'
              : scenario === 'launcher-diagnostic-event'
                ? 'event-validation-toolcall_start'
                : scenario === 'launcher-diagnostic-refresh'
                  ? 'stream-refresh'
                  : 'stream',
          ...(scenario === 'launcher-diagnostic-extra' ? { detail: 'private-provider-text' } : {}),
        };
        child.stdout.emit('data', Buffer.from(`${JSON.stringify(frame)}\n`));
        if (scenario === 'launcher-diagnostic-duplicate')
          child.stdout.emit('data', Buffer.from(`${JSON.stringify(frame)}\n`));
        if (scenario !== 'launcher-diagnostic-success') {
          child.stdout.emit(
            'data',
            Buffer.from(
              `${JSON.stringify({ scope: fixtureCheck ? 'dedicated-pi-native-check' : fixtureRead ? 'dedicated-pi-native-read' : 'dedicated-pi-native', verdict: 'sign-in-required' })}\n`,
            ),
          );
          child.emit('close', 1, null);
          return;
        }
      }
      for (const progress of ['model', 'tool', 'model'])
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({ progress })}\n`));
      child.stdout.emit(
        'data',
        Buffer.from(
          fixtureCheck
            ? '{"scope":"dedicated-pi-native-check","verdict":"native-check-pass","provider":"openai-codex","model":"gpt-6.1-sol","requests":2,"toolExecutions":1,"streamed":true,"resultVerified":true,"paused":true,"reopened":true,"budgetPreserved":true,"disposed":true,"protectedCheck":true}\n'
            : fixtureRead
              ? '{"scope":"dedicated-pi-native-read","verdict":"native-read-pass","provider":"openai-codex","model":"gpt-6.1-sol","requests":2,"toolExecutions":1,"streamed":true,"resultVerified":true,"paused":true,"reopened":true,"budgetPreserved":true,"disposed":true,"fixtureRead":true}\n'
              : process.argv.includes('--native')
                ? '{"scope":"dedicated-pi-native","verdict":"native-turn-pass","provider":"openai-codex","model":"gpt-6.1-sol","requests":2,"toolExecutions":1,"streamed":true,"resultVerified":true,"paused":true,"reopened":true,"budgetPreserved":true,"disposed":true}\n'
                : '{"scope":"dedicated-pi-tool","verdict":"tool-turn-pass","provider":"openai-codex","model":"gpt-6.1-sol","requests":2,"toolExecutions":1,"streamed":true,"resultVerified":true}\n',
        ),
      );
      if (scenario === 'launcher-late')
        child.stdout.emit('data', Buffer.from('{"progress":"model"}\n'));
      child.emit('close', scenario === 'launcher-nonzero' ? 1 : 0, null);
    });
    return child;
  };
}
async function syntheticFetch(url, options) {
  if (url === 'https://auth.openai.com/oauth/token') {
    assert.equal(++refreshes, 1);
    record({ kind: 'refresh' });
    if (scenario === 'refresh-denied') return new Response('private-auth-error', { status: 401 });
    const payload = Buffer.from(
      JSON.stringify({
        'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account' },
      }),
    ).toString('base64url');
    return Response.json({
      access_token: `synthetic.${payload}.signature`,
      refresh_token: 'private-rotated',
      expires_in: 3600,
    });
  }
  assert.equal(url, 'https://chatgpt.com/backend-api/codex/responses');
  assert.ok(++requests <= 2);
  record({ kind: 'request', number: requests });
  if (scenario === 'hold' || scenario === 'hung') return new Promise(() => {});
  if (scenario === 'cancel') {
    return new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('private-cancel')), {
        once: true,
      });
      process.emit('SIGINT');
    });
  }
  if (scenario === 'deadline') {
    expire();
    return new Promise(() => {});
  }
  if (native && scenario.startsWith('diagnostic-')) {
    process.send(
      scenario === 'diagnostic-extra'
        ? { failureStage: 'stream', detail: 'private-provider-text' }
        : { failureStage: 'private-provider-text' },
    );
  }
  if (scenario === 'denied') return new Response('private-provider-error', { status: 403 });
  if (scenario === 'unauthorized') return new Response('private-provider-error', { status: 401 });
  if (scenario === 'rate-limited') return new Response('private-provider-error', { status: 429 });
  if (scenario === 'network') throw new Error('private-network-error');
  const headers = new Headers(options.headers);
  const body = JSON.parse(
    headers.get('content-encoding') === 'zstd'
      ? zstdDecompressSync(options.body).toString()
      : options.body,
  );
  assert.equal(body.model, 'gpt-6.1-sol');
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.equal(body.tools, undefined);
  assert.deepEqual(
    body.input
      .filter((item) => item.type === 'additional_tools')
      .flatMap((item) => item.tools.map((tool) => tool.name)),
    [toolName],
  );
  if (fixtureCheck) {
    const tool = body.input.find((item) => item.type === 'additional_tools').tools[0];
    assert.deepEqual(tool.parameters.properties.kind.enum, ['baseline']);
    assert.equal(tool.parameters.additionalProperties, false);
  }
  const first = native
    ? !body.input.some((item) => item.type === 'function_call_output')
    : requests === 1;
  if (native) assert.equal(requests, 1);
  const item = first
    ? {
        type: 'function_call',
        id: 'fc_probe',
        call_id: 'call_probe',
        name: scenario === 'bad-tool' ? 'bash' : toolName,
        arguments:
          scenario === 'bad-arguments'
            ? '{"unexpected":true}'
            : scenario === 'wrong-check-kind'
              ? '{"kind":"browser"}'
              : fixtureCheck
                ? '{"kind":"baseline"}'
                : '{}',
      }
    : {
        type: 'message',
        id: 'msg_probe',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text:
              scenario === 'bad-result'
                ? 'wrong'
                : fixtureCheck
                  ? JSON.parse(
                      body.input.find((item) => item.type === 'function_call_output').output,
                    ).id
                  : fixtureRead
                    ? JSON.parse(
                        body.input.find((item) => item.type === 'function_call_output').output,
                      ).sha256
                    : body.input.find((item) => item.type === 'function_call_output').output,
          },
        ],
      };
  const events = [
    { type: 'response.created', response: { id: 'synthetic-response' } },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: first ? { ...item, arguments: '' } : { ...item, content: [] },
    },
    first
      ? { type: 'response.function_call_arguments.delta', output_index: 0, delta: item.arguments }
      : { type: 'response.output_text.delta', output_index: 0, delta: item.content[0].text },
    { type: 'response.output_item.done', output_index: 0, item },
    {
      type: 'response.completed',
      response: { id: 'synthetic-response', status: 'completed', output: [item] },
    },
  ];
  if (scenario === 'paced-toolcall' && first) {
    // Advance only after the live helper validates and writes each intermediate frame.
    // This prevents SDK finalization from deleting scratch before consumer snapshotting.
    return new Response(
      new ReadableStream({
        start(controller) {
          const enqueue = (batch) =>
            controller.enqueue(
              new TextEncoder().encode(
                batch.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
              ),
            );
          const write = process.stdout.write.bind(process.stdout);
          process.stdout.write = (chunk, ...args) => {
            const type = JSON.parse(chunk.toString()).event.type;
            const result = write(chunk, ...args);
            if (type === 'toolcall_start') enqueue([events[2]]);
            if (type === 'toolcall_delta') {
              enqueue(events.slice(3));
              controller.close();
              process.stdout.write = write;
            }
            return result;
          };
          enqueue(events.slice(0, 2));
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  }
  if (scenario === 'open-toolcall') {
    // Keep a valid intermediate SDK event live: no later done/error can mutate away
    // its partialJson scratch field before the consumer snapshots/validates it.
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              events
                .slice(0, 2)
                .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                .join(''),
            ),
          );
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  }
  return new Response(
    (scenario === 'malformed' ? events.slice(0, 2) : events)
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join(''),
    {
      headers: { 'content-type': 'text/event-stream' },
    },
  );
}
globalThis.fetch = async (...args) => {
  try {
    return await syntheticFetch(...args);
  } catch (error) {
    if (error.name === 'AssertionError') record({ kind: 'fixture-failure' });
    throw new Error('synthetic-fixture-failed');
  }
};
syncBuiltinESMExports();
