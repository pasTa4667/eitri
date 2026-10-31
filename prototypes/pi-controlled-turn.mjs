import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const toolTurnResult = Object.freeze({
  scope: 'dedicated-pi-tool',
  verdict: 'tool-turn-pass',
  provider: 'openai-codex',
  model: 'gpt-6.1-sol',
  requests: 2,
  toolExecutions: 1,
  streamed: true,
  resultVerified: true,
});

// Trusted runtime seam only. No agent session, arbitrary prompts, tools or automatic follow-ups.
export async function runControlledTurn(runtime, { signal, onProgress } = {}) {
  const check = () => signal?.throwIfAborted();
  check();
  assert.deepEqual(await runtime.listCredentials({ signal }), [
    { providerId: toolTurnResult.provider, type: 'oauth' },
  ]);
  check();
  const model = runtime.getPhysicalModel(toolTurnResult.provider, toolTurnResult.model);
  assert.ok(model);
  assert.equal(model.provider, toolTurnResult.provider);
  assert.equal(model.id, toolTurnResult.model);
  assert.equal(model.api, 'openai-codex-responses');
  assert.equal(model.baseUrl, 'https://chatgpt.com/backend-api');
  const context = {
    messages: [
      {
        role: 'system',
        timestamp: Date.now(),
        content:
          'Call eitri_probe exactly once with {}. After its tool result, reply with only the returned text, without formatting or extra words. No other actions.',
        toolsAdded: [
          {
            name: 'eitri_probe',
            description: 'Returns a random verification string. No I/O or external effects.',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
          },
        ],
      },
      {
        role: 'user',
        content: 'Perform the bounded tool verification now.',
        timestamp: Date.now(),
      },
    ],
  };
  let textDeltas = 0;
  async function stream() {
    check();
    onProgress?.('model');
    check();
    const events = runtime.streamSimple(model, context, {
      signal,
      transport: 'sse',
      maxRetries: 0,
      maxTokens: 256,
      reasoning: 'minimal',
    });
    let terminal,
      count = 0,
      bytes = 0;
    for await (const event of events) {
      check();
      assert.ok(!terminal && ++count <= 4096);
      bytes += Buffer.byteLength(JSON.stringify(event));
      assert.ok(bytes <= 1_048_576);
      if (event.type === 'text_delta' && event.delta?.length) textDeltas++;
      if (event.type === 'done') terminal = event;
      assert.notEqual(event.type, 'error');
    }
    check();
    assert.ok(terminal);
    const message = await events.result();
    check();
    assert.ok(isDeepStrictEqual(message, terminal.message));
    assert.equal(terminal.reason, message.stopReason);
    assert.equal(message.role, 'assistant');
    assert.equal(message.provider, model.provider);
    assert.equal(message.model, model.id);
    assert.equal(message.api, model.api);
    assert.ok(Array.isArray(message.content) && message.content.length <= 32);
    return message;
  }
  const first = await stream();
  assert.equal(first.stopReason, 'toolUse');
  assert.ok(first.content.every((block) => ['text', 'thinking', 'toolCall'].includes(block.type)));
  const calls = first.content.filter((block) => block.type === 'toolCall');
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.name, 'eitri_probe');
  assert.ok(typeof call.id === 'string' && call.id.length > 0 && call.id.length <= 1024);
  assert.deepEqual(call.arguments, {});
  check();
  onProgress?.('tool');
  check();
  const result = randomBytes(16).toString('hex');
  context.messages.push(first, {
    role: 'toolResult',
    toolCallId: call.id,
    toolName: call.name,
    content: [{ type: 'text', text: result }],
    isError: false,
    timestamp: Date.now(),
  });
  const last = await stream();
  assert.equal(last.stopReason, 'stop');
  assert.ok(last.content.every((block) => ['text', 'thinking'].includes(block.type)));
  assert.equal(
    last.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim(),
    result,
  );
  assert.ok(textDeltas > 0);
  check();
  return { ...toolTurnResult };
}
