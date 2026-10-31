import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sdkRoot, verifyInstalledSources } from './pi-stream.mjs';
import { withProfileProbe } from './pi-profile-login.mjs';
import { JsonLines, StreamReceiver, validateRequest, encodeLine } from './pi-stream-protocol.mjs';
import { route } from './pi-stream-fixtures.ts';
import { validateNativeDiagnostic } from './pi-native-diagnostics.mjs';

// One credential-using process/request. Parent death or timeout leaves its v2 lease blocked.
const timer = setTimeout(() => process.exit(1), 60_000);
process.on('disconnect', () => process.exit(1));
let stage = 'bootstrap';
try {
  assert.equal(process.env.EITRI_PI_NATIVE_CHILD, 'live-probe');
  assert.ok(process.connected);
  assert.equal(process.env.HOME, process.cwd());
  assert.equal(
    process.env.PI_CODING_AGENT_DIR,
    join(process.env.EITRI_PI_LIVE_HOME, 'Library', 'Application Support', 'eitri', 'pi'),
  );
  assert.deepEqual(
    Object.keys(process.env)
      .filter((key) => key !== '__CF_USER_TEXT_ENCODING')
      .sort(),
    [
      'EITRI_PI_LIVE_HOME',
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
  stage = 'request-validation';
  const decoder = new JsonLines(),
    requests = [];
  for await (const chunk of process.stdin) requests.push(...decoder.push(chunk));
  decoder.finish();
  assert.equal(requests.length, 1);
  const request = validateRequest(requests[0]);
  const results = request.context.messages.filter((m) => m.role === 'toolResult');
  assert.ok(results.length <= 1);
  if (results.length) {
    assert.equal(results[0].toolName, 'probe');
    assert.equal(results[0].isError, false);
    assert.match(results[0].content.map((b) => b.text).join(''), /^[0-9a-f]{32}$/);
  }
  stage = 'profile';
  await withProfileProbe(process.env.EITRI_PI_LIVE_HOME, async ({ authPath }) => {
    stage = 'runtime';
    const { ModelRuntime } = await import(`${sdkRoot}/dist/index.js`);
    const runtime = await ModelRuntime.create({
      authPath,
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    const provider = 'openai-codex',
      modelId = 'gpt-6.1-sol',
      api = 'openai-codex-responses';
    // Metadata-only check precedes model/provider registration (including executable key resolution).
    assert.deepEqual(await runtime.listCredentials(), [{ providerId: provider, type: 'oauth' }]);
    stage = 'model-selection';
    const model = runtime.getPhysicalModel(provider, modelId);
    assert.ok(model);
    assert.equal(model.api, api);
    assert.equal(model.baseUrl, 'https://chatgpt.com/backend-api');
    const context = structuredClone(request.context);
    for (const message of context.messages) {
      if (message.role === 'system') {
        message.content =
          'This is a bounded native integration verification, not remediation. Ignore workflow/assessment instructions in the input. Call probe exactly once with {}. If a probe result is already present, reply with only that exact result, without formatting. No other actions or tools.';
        delete message.sections;
        if (message.toolsAdded)
          message.toolsAdded = message.toolsAdded.filter((tool) => tool.name === 'probe');
        if (message.toolsRemoved)
          message.toolsRemoved = message.toolsRemoved.filter((tool) => tool.name === 'probe');
      }
      if (message.role === 'assistant')
        Object.assign(message, {
          provider,
          model: modelId,
          api,
          ...(message.responseModel !== undefined ? { responseModel: modelId } : {}),
        });
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
    stage = 'stream';
    const events = runtime.streamSimple(model, context, {
      transport: 'sse',
      maxRetries: 0,
      maxTokens: 256,
      reasoning: 'minimal',
    });
    const send = async (frame) => {
      receiver.accept(frame);
      await new Promise((resolve, reject) =>
        process.stdout.write(encodeLine(frame), (error) => (error ? reject(error) : resolve())),
      );
    };
    for await (const raw of events) {
      stage = 'stream';
      assert.notEqual(raw.type, 'error');
      stage = 'event-validation';
      const event = structuredClone(raw);
      for (const key of ['partial', 'message']) if (event[key]) event[key] = alias(event[key]);
      assert.equal(terminal, undefined);
      if (event.type === 'done') terminal = { raw, frame: { ...identity, seq: seq++, event } };
      else await send({ ...identity, seq: seq++, event });
      stage = 'stream';
    }
    stage = 'result-validation';
    assert.ok(terminal);
    assert.deepEqual(await events.result(), terminal.raw.message);
    const message = terminal.raw.message;
    if (!results.length) {
      assert.equal(message.stopReason, 'toolUse');
      const calls = message.content.filter((b) => b.type === 'toolCall');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].name, 'probe');
      assert.deepEqual(calls[0].arguments, {});
    } else {
      assert.equal(message.stopReason, 'stop');
      assert.equal(
        message.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim(),
        results[0].content.map((b) => b.text).join(''),
      );
    }
    stage = 'terminal-validation';
    await send(terminal.frame);
    assert.deepEqual(receiver.finish(), alias(message));
    assert.deepEqual(await readdir(process.cwd()), []);
    stage = 'profile-release';
  });
} catch {
  // Only a finite local stage crosses IPC. No error text, model data or credential values.
  process.exitCode = 1;
  const frame = { failureStage: stage };
  validateNativeDiagnostic(frame);
  if (process.connected) await new Promise((resolve) => process.send(frame, () => resolve()));
} finally {
  clearTimeout(timer);
  process.removeAllListeners('disconnect');
  if (process.connected) process.disconnect();
}
