import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { sdkRoot, verifyInstalledSources } from './pi-stream.mjs';
import { JsonLines, StreamReceiver, validateRequest, encodeLine } from './pi-stream-protocol.mjs';
import { route, toolResponse, finalResponse } from './pi-stream-fixtures.ts';

// One synthetic response to a real native context; no case storage or tool executor.
const timer = setTimeout(() => process.exit(1), 10_000);
try {
  assert.equal(process.env.EITRI_PI_NATIVE_CHILD, 'synthetic-only');
  assert.equal(process.env.HOME, process.cwd());
  assert.equal(process.env.PI_CODING_AGENT_DIR, join(process.cwd(), 'agent'));
  assert.equal(process.env.PI_OFFLINE, '1');
  assert.deepEqual(
    Object.keys(process.env)
      .filter((key) => key !== '__CF_USER_TEXT_ENCODING')
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
  await verifyInstalledSources();
  globalThis.fetch = () => {
    throw new Error('offline-network-forbidden');
  };
  const decoder = new JsonLines();
  const requests = [];
  for await (const chunk of process.stdin) requests.push(...decoder.push(chunk));
  decoder.finish();
  assert.equal(requests.length, 1);
  const request = validateRequest(requests[0]);
  const { ModelRuntime } = await import(pathToFileURL(join(sdkRoot, 'dist/index.js')).href);
  const { createAssistantMessageEventStream, normalizeContext } = await import(
    pathToFileURL(join(sdkRoot, 'node_modules/@earendil-works/pi-ai/dist/index.js')).href
  );
  const { normalizeContext: nativeNormalize } = await import('@earendil-works/pi-ai');
  assert.deepEqual(
    normalizeContext(request.context).messages,
    nativeNormalize(request.context).messages,
  );
  const runtime = await ModelRuntime.create({
    credentials: {
      read: async () => ({
        type: 'oauth',
        access: 'synthetic-only',
        refresh: 'synthetic-only',
        expires: Date.now() + 3_600_000,
      }),
      list: async () => [{ providerId: route.provider, type: 'oauth' }],
      modify: async () => assert.fail('refresh outside this lifecycle slice'),
      delete: async () => assert.fail('deletion forbidden'),
    },
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const model = {
    id: route.model,
    name: 'Offline native fixture',
    provider: route.provider,
    api: route.api,
    baseUrl: route.baseUrl,
    input: ['text'],
    reasoning: true,
    contextWindow: 8192,
    maxTokens: 64,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const fixture = process.env.EITRI_PI_NATIVE_FIXTURE;
  assert.ok(['probe', 'repair-budget'].includes(fixture));
  const results = request.context.messages.filter((m) => m.role === 'toolResult');
  if (fixture === 'probe') {
    assert.ok(results.length <= 1);
    if (results.length) assert.equal(results[0].toolName, 'probe');
  }
  let response = results.length
    ? finalResponse
    : {
        ...toolResponse,
        content: [
          { type: 'toolCall', id: `probe-${request.actionId}`, name: 'probe', arguments: {} },
        ],
      };
  if (fixture === 'repair-budget') {
    // Fixed synthetic policy only. Native/controller still execute tools and own all counters.
    const inputMessage = request.context.messages.findLast((m) => m.role === 'user');
    const input = JSON.parse(
      typeof inputMessage.content === 'string'
        ? inputMessage.content
        : inputMessage.content.map((block) => block.text).join(''),
    );
    assert.ok(['triage', 'investigation', 'implementation'].includes(input.phase));
    const checks = results
      .filter((m) => m.toolName === 'run_check')
      .map((m) => {
        assert.equal(m.isError, false);
        return JSON.parse(m.content.map((block) => block.text).join(''));
      });
    const last = checks.at(-1);
    let name = 'run_check',
      args;
    if (
      input.phase === 'triage' ||
      (input.phase === 'investigation' && last?.kind === 'baseline')
    ) {
      name = 'complete_assessment';
      args = {
        phase: input.phase,
        expectedControlVersion:
          input.phase === 'triage' ? input.expectedControlVersion : last.controlVersion,
        conclusion: 'progress',
        reason: 'Synthetic repair-budget exercise, not a live fix',
        evidenceIds: input.phase === 'triage' ? [] : [last.id],
        proposal: 'Bounded synthetic proposal',
        paths: ['src/example.ts'],
      };
    } else
      args = {
        kind:
          input.phase === 'investigation'
            ? 'baseline'
            : last?.kind === 'checkpoint'
              ? 'regression'
              : 'checkpoint',
      };
    response = {
      ...toolResponse,
      content: [{ type: 'toolCall', id: `repair-${request.actionId}`, name, arguments: args }],
    };
  }
  let calls = 0;
  const stream = (selected, transcript, options) => {
    assert.equal(++calls, 1);
    assert.deepEqual(selected, model);
    assert.deepEqual(transcript.messages, normalizeContext(request.context).messages);
    assert.equal(options.apiKey, 'synthetic-only');
    const output = createAssistantMessageEventStream();
    const partial = { ...response, content: [], stopReason: 'pending' };
    output.push({ type: 'start', partial: structuredClone(partial) });
    for (const [contentIndex, block] of response.content.entries()) {
      const prefix = block.type === 'toolCall' ? 'toolcall' : 'text';
      partial.content.push(prefix === 'text' ? { ...block, text: '' } : block);
      output.push({ type: `${prefix}_start`, contentIndex, partial: structuredClone(partial) });
      if (prefix === 'text') {
        partial.content[contentIndex] = block;
        output.push({
          type: 'text_delta',
          contentIndex,
          delta: block.text,
          partial: structuredClone(partial),
        });
      }
      output.push({
        type: `${prefix}_end`,
        contentIndex,
        ...(prefix === 'toolcall' ? { toolCall: block } : { content: block.text }),
        partial: structuredClone(partial),
      });
    }
    output.push({ type: 'done', reason: response.stopReason, message: structuredClone(response) });
    output.end();
    return output;
  };
  runtime.registerNativeProvider({
    id: route.provider,
    name: 'Synthetic, not OpenAI',
    auth: {
      oauth: {
        name: 'Synthetic',
        isSubscription: true,
        login: async () => assert.fail('login forbidden'),
        refresh: async () => assert.fail('refresh forbidden'),
        toAuth: async (credential) => ({ apiKey: credential.access }),
      },
    },
    getModels: () => [model],
    stream,
    streamSimple: stream,
  });
  assert.deepEqual(await runtime.checkAuth(route.provider), { type: 'oauth', source: 'OAuth' });
  const receiver = new StreamReceiver(request);
  const { context: _context, options: _options, ...identity } = request;
  let seq = 0;
  const events = runtime.streamSimple(model, request.context, request.options);
  for await (const event of events) {
    const frame = { ...identity, seq: seq++, event };
    receiver.accept(frame);
    await new Promise((resolve, reject) =>
      process.stdout.write(encodeLine(frame), (error) => (error ? reject(error) : resolve())),
    );
  }
  assert.deepEqual(receiver.finish(), response);
  assert.deepEqual(await events.result(), response);
  assert.equal(calls, 1);
  assert.deepEqual(await readdir(process.cwd()), []);
} catch {
  console.error('pi-native-stream-offline-failed');
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
