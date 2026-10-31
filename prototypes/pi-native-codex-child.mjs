import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';
import { sdkRoot, verifyInstalledSources } from './pi-stream.mjs';
import { JsonLines, StreamReceiver, validateRequest, encodeLine } from './pi-stream-protocol.mjs';
import { route } from './pi-stream-fixtures.ts';

// Fixed offline composition. No provider override, file credentials, native store or tool loop.
const timer = setTimeout(() => process.exit(1), 10000);
try {
  assert.equal(process.env.EITRI_PI_NATIVE_CHILD, 'synthetic-only');
  assert.equal(process.env.HOME, process.cwd());
  assert.equal(process.env.PI_CODING_AGENT_DIR, join(process.cwd(), 'agent'));
  assert.equal(process.env.PI_OFFLINE, '1');
  assert.deepEqual(
    Object.keys(process.env)
      .filter((k) => k !== '__CF_USER_TEXT_ENCODING')
      .sort(),
    [
      'EITRI_PI_NATIVE_CHILD',
      'EITRI_PI_NATIVE_FIXTURE',
      'HOME',
      'PI_CODING_AGENT_DIR',
      'PI_OFFLINE',
      'PI_SKIP_VERSION_CHECK',
      'PI_TELEMETRY',
    ],
  );
  const scenario = process.env.EITRI_PI_NATIVE_FIXTURE;
  assert.ok(['codex-probe', 'codex-denied', 'codex-malformed', 'codex-unknown'].includes(scenario));
  await verifyInstalledSources();
  const decoder = new JsonLines(),
    requests = [];
  for await (const chunk of process.stdin) requests.push(...decoder.push(chunk));
  decoder.finish();
  assert.equal(requests.length, 1);
  const request = validateRequest(requests[0]);
  const results = request.context.messages.filter((m) => m.role === 'toolResult');
  assert.ok(results.length <= 1);
  if (results.length) assert.equal(results[0].toolName, 'probe');
  const provider = 'openai-codex',
    modelId = 'gpt-6.1-sol',
    api = 'openai-codex-responses';
  const accountId = 'synthetic-private-account';
  const access = `synthetic.${Buffer.from(
    JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_account_id: accountId },
    }),
  ).toString('base64url')}.synthetic`;
  let fetches = 0,
    contractFailures = 0;
  // Replace fetch before importing/constructing the runtime; retain no network fallback.
  globalThis.fetch = async (url, options) => {
    try {
      assert.equal(++fetches, 1);
      assert.equal(url, 'https://chatgpt.com/backend-api/codex/responses');
      const headers = new Headers(options.headers);
      assert.equal(headers.get('authorization'), `Bearer ${access}`);
      assert.equal(headers.get('chatgpt-account-id'), accountId);
      const body = JSON.parse(
        headers.get('content-encoding') === 'zstd'
          ? zstdDecompressSync(options.body).toString()
          : options.body,
      );
      assert.equal(body.model, modelId);
      assert.equal(body.stream, true);
      assert.equal(body.store, false);
      assert.ok(
        body.input.some(
          (item) =>
            item.type === 'additional_tools' && item.tools.some((tool) => tool.name === 'probe'),
        ),
      );
      const outputs = body.input.filter((item) => item.type === 'function_call_output');
      assert.equal(outputs.length, results.length);
      if (results.length) {
        assert.equal(outputs[0].call_id, results[0].toolCallId.split('|')[0]);
        assert.equal(outputs[0].output, results[0].content.map((b) => b.text).join(''));
      }
      if (scenario === 'codex-denied')
        return new Response('synthetic-private-denial', { status: 403 });
      const item = results.length
        ? {
            type: 'message',
            id: 'msg_probe',
            role: 'assistant',
            content: [{ type: 'output_text', text: outputs[0].output }],
          }
        : {
            type: 'function_call',
            id: 'fc_probe',
            call_id: 'call_probe',
            name: scenario === 'codex-unknown' ? 'unconfigured_tool' : 'probe',
            arguments: '{}',
          };
      const events = [
        { type: 'response.created', response: { id: 'synthetic-response' } },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: results.length ? { ...item, content: [] } : { ...item, arguments: '' },
        },
        results.length
          ? { type: 'response.output_text.delta', output_index: 0, delta: item.content[0].text }
          : { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{}' },
        { type: 'response.output_item.done', output_index: 0, item },
        {
          type: 'response.completed',
          response: { id: 'synthetic-response', status: 'completed', output: [item] },
        },
      ];
      return new Response(
        events
          .slice(0, scenario === 'codex-malformed' ? 2 : events.length)
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    } catch {
      contractFailures++;
      throw new Error('offline-fixture-contract-failed');
    }
  };
  const { ModelRuntime } = await import(pathToFileURL(join(sdkRoot, 'dist/index.js')).href);
  const runtime = await ModelRuntime.create({
    credentials: {
      list: async () => [{ providerId: provider, type: 'oauth' }],
      read: async (id) => {
        assert.equal(id, provider);
        return {
          type: 'oauth',
          access,
          refresh: 'synthetic-private-refresh',
          expires: Date.now() + 3600000,
          accountId,
        };
      },
      modify: async () => assert.fail('refresh outside this slice'),
      delete: async () => assert.fail('credential deletion forbidden'),
    },
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  assert.deepEqual(await runtime.listCredentials(), [{ providerId: provider, type: 'oauth' }]);
  const model = runtime.getPhysicalModel(provider, modelId);
  assert.ok(model);
  assert.equal(model.api, api);
  assert.equal(model.baseUrl, 'https://chatgpt.com/backend-api');
  const context = structuredClone(request.context);
  // Explicit test-only alias boundary. Preserve every other field, including call IDs/signatures.
  for (const message of context.messages)
    if (message.role === 'assistant') {
      message.provider = provider;
      message.model = modelId;
      message.api = api;
      if (message.responseModel !== undefined) message.responseModel = modelId;
    }
  const alias = (message) => {
    assert.equal(message.provider, provider);
    assert.equal(message.model, modelId);
    assert.equal(message.api, api);
    const copy = structuredClone(message);
    Object.assign(copy, { provider: route.provider, model: route.model, api: route.api });
    if (Object.hasOwn(copy, 'responseModel')) {
      assert.equal(copy.responseModel, modelId);
      copy.responseModel = route.model;
    }
    return copy;
  };
  const receiver = new StreamReceiver(request);
  const { context: _context, options: _options, ...identity } = request;
  let seq = 0,
    terminal;
  const events = runtime.streamSimple(model, context, {
    ...request.options,
    transport: 'sse',
    maxRetries: 0,
    reasoning: 'minimal',
  });
  for await (const raw of events) {
    assert.notEqual(raw.type, 'error');
    const event = structuredClone(raw);
    for (const key of ['partial', 'message']) if (event[key]) event[key] = alias(event[key]);
    if (event.type === 'done') terminal = raw.message;
    const frame = { ...identity, seq: seq++, event };
    receiver.accept(frame);
    await new Promise((resolve, reject) =>
      process.stdout.write(encodeLine(frame), (error) => (error ? reject(error) : resolve())),
    );
  }
  assert.equal(fetches, 1);
  assert.equal(contractFailures, 0);
  assert.deepEqual(await events.result(), terminal);
  const message = receiver.finish();
  assert.deepEqual(message, alias(terminal));
  if (results.length)
    assert.equal(
      message.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join(''),
      results[0].content.map((b) => b.text).join(''),
    );
  assert.deepEqual(await readdir(process.cwd()), []);
} catch {
  console.error('pi-native-codex-offline-failed');
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
