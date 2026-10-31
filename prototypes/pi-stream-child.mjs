import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { sdkRoot, verifyInstalledSources } from './pi-stream.mjs';
import {
  JsonLines,
  StreamReceiver,
  validateRequest,
  encodeLine,
  makeRequest,
} from './pi-stream-protocol.mjs';
import { context, route, toolResponse, toolResult, finalResponse } from './pi-stream-fixtures.ts';

// Fixed offline fixture runner: only the two exact synthetic requests below are accepted.
// The validated pipe is experimental, never a production/credential/tool interface.
try {
  assert.equal(process.env.EITRI_PI_STREAM_CHILD, 'synthetic-only');
  assert.equal(process.env.PI_OFFLINE, '1');
  assert.equal(process.env.PI_CODING_AGENT_DIR, join(process.cwd(), 'agent'));
  assert.equal(process.env.HOME, process.cwd());
  // macOS may inject this non-secret locale field after exec, even with an explicit env.
  assert.deepEqual(
    Object.keys(process.env)
      .filter((key) => key !== '__CF_USER_TEXT_ENCODING')
      .sort(),
    [
      'EITRI_PI_STREAM_CHILD',
      'HOME',
      'PI_CODING_AGENT_DIR',
      'PI_OFFLINE',
      'PI_SKIP_VERSION_CHECK',
      'PI_TELEMETRY',
    ],
  );
  await verifyInstalledSources();
  let networkAttempts = 0;
  globalThis.fetch = () => {
    networkAttempts++;
    throw new Error('offline-network-forbidden');
  };
  const { ModelRuntime } = await import(pathToFileURL(join(sdkRoot, 'dist/index.js')).href);
  const { createAssistantMessageEventStream } = await import(
    pathToFileURL(join(sdkRoot, 'node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js'))
      .href
  );
  const { normalizeContext } = await import('@earendil-works/pi-ai');
  let credential = {
    type: 'oauth',
    access: 'synthetic-expired',
    refresh: 'synthetic-refresh',
    expires: 0,
  };
  let lock = Promise.resolve();
  const credentials = {
    read: async (id) => (id === route.provider ? structuredClone(credential) : undefined),
    list: async () => [{ providerId: route.provider, type: 'oauth' }],
    modify: (id, fn) => {
      assert.equal(id, route.provider);
      const operation = lock.then(async () => {
        credential = (await fn(structuredClone(credential))) ?? credential;
        return structuredClone(credential);
      });
      lock = operation.catch(() => {});
      return operation;
    },
    delete: async () => assert.fail('credential deletion forbidden'),
  };
  // Inject all storage/configuration before construction; never call default AuthStorage.create().
  const runtime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const model = {
    id: route.model,
    name: 'Offline fixture',
    provider: route.provider,
    api: route.api,
    baseUrl: route.baseUrl,
    input: ['text'],
    reasoning: true,
    contextWindow: 4096,
    maxTokens: 64,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  let requests = 0;
  let refreshes = 0;
  const expectedContexts = [context, { messages: [...context.messages, toolResponse, toolResult] }];
  const responses = [toolResponse, finalResponse];
  function stream(requestModel, transcript, options) {
    const index = requests++;
    assert.ok(index < 2, 'no automatic retry or second agent loop');
    assert.deepEqual(requestModel, model);
    assert.deepEqual(transcript.messages, normalizeContext(expectedContexts[index]).messages);
    assert.equal(options.apiKey, 'synthetic-refreshed');
    assert.equal(options.maxTokens, 64);
    const events = createAssistantMessageEventStream();
    const response = structuredClone(responses[index]);
    const partial = { ...response, content: [], stopReason: 'pending' };
    queueMicrotask(() => {
      events.push({ type: 'start', partial });
      response.content.forEach((block, contentIndex) => {
        partial.content.push(
          block.type === 'text' ? { ...block, text: '' } : structuredClone(block),
        );
        const prefix = block.type === 'toolCall' ? 'toolcall' : block.type;
        events.push({ type: `${prefix}_start`, contentIndex, partial });
        if (block.type === 'text') {
          partial.content[contentIndex].text = block.text;
          events.push({ type: 'text_delta', contentIndex, delta: block.text, partial });
        }
        events.push({
          type: `${prefix}_end`,
          contentIndex,
          ...(block.type === 'toolCall'
            ? { toolCall: block }
            : { content: block.text ?? block.thinking }),
          partial,
        });
      });
      events.push({ type: 'done', reason: response.stopReason, message: response });
      events.end();
    });
    return events;
  }
  runtime.registerNativeProvider({
    id: route.provider,
    name: 'Synthetic OAuth/stream provider, not OpenAI',
    auth: {
      oauth: {
        name: 'Synthetic only',
        isSubscription: true,
        login: async () => assert.fail('login forbidden'),
        refresh: async (current, signal) => {
          signal.throwIfAborted();
          assert.equal(current.access, 'synthetic-expired');
          refreshes++;
          return { ...current, access: 'synthetic-refreshed', expires: Date.now() + 3_600_000 };
        },
        toAuth: async (current) => ({ apiKey: current.access }),
      },
    },
    getModels: () => [model],
    stream,
    streamSimple: stream,
  });
  assert.deepEqual(await runtime.checkAuth(route.provider), { type: 'oauth', source: 'OAuth' });
  assert.deepEqual(runtime.getPhysicalModel(route.provider, route.model), model);
  // No agent loop: a second stream requires a second explicit parent request.
  const decoder = new JsonLines();
  let index = 0;
  for await (const chunk of process.stdin) {
    for (const value of decoder.push(chunk)) {
      assert.ok(index < 2);
      const request = validateRequest(value);
      assert.deepEqual(request, makeRequest(index, expectedContexts[index]));
      const receiver = new StreamReceiver(request);
      const events = runtime.streamSimple(model, request.context, request.options);
      const { context: _context, options: _options, ...identity } = request;
      let seq = 0;
      for await (const event of events) {
        const frame = { ...identity, seq: seq++, event };
        receiver.accept(frame);
        // Bound every frame and honor backpressure; never retain a raw pipe transcript.
        const line = encodeLine(frame);
        await new Promise((resolve, reject) =>
          process.stdout.write(line, (error) => (error ? reject(error) : resolve())),
        );
      }
      assert.deepEqual(receiver.finish(), responses[index]);
      assert.deepEqual(await events.result(), responses[index]);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(requests, ++index);
    }
  }
  decoder.finish();
  assert.equal(index, 2);
  assert.equal(refreshes, 1);
  assert.equal(networkAttempts, 0);
  assert.deepEqual(await readdir(process.cwd()), []);
  // Parent accepts only two complete correlated streams AND normal child closure.
} catch {
  console.error('pi-stream-offline-failed');
  process.exitCode = 1;
}
