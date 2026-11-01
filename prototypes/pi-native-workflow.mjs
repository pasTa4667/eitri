import assert from 'node:assert/strict';
import { validateNativeReadResult } from './pi-native-read.mjs';
import { validateNativeCheckResult } from './pi-native-check.mjs';

// Fixed trusted sequence, not a configurable workflow engine. Validate history before profile
// access; the controller separately admits actions and authenticates the real worker evidence.
export function nativeWorkflowStep(context, caseId) {
  const history = context.messages.flatMap((m) =>
    m.role === 'assistant'
      ? m.content.filter((b) => b.type === 'toolCall')
      : m.role === 'toolResult'
        ? [m]
        : [],
  );
  const calls = history.filter((v) => v.type === 'toolCall');
  const results = history.filter((v) => v.role === 'toolResult');
  const steps = [
    { toolName: 'read_fixture', toolArguments: {} },
    { toolName: 'run_check', toolArguments: { kind: 'baseline' } },
  ];
  assert.ok(results.length <= steps.length);
  assert.equal(calls.length, results.length);
  assert.equal(new Set(calls.map((c) => c.id)).size, calls.length);
  for (const [i, result] of results.entries()) {
    const call = calls[i];
    assert.equal(history[i * 2], call);
    assert.equal(history[i * 2 + 1], result);
    assert.equal(call.name, steps[i].toolName);
    assert.deepEqual(call.arguments, steps[i].toolArguments);
    assert.equal(result.toolName, call.name);
    assert.equal(result.toolCallId, call.id);
    assert.equal(result.isError, false);
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, 'text');
    const text = result.content[0].text;
    if (i === 0) validateNativeReadResult(text);
    else {
      validateNativeCheckResult(text);
      assert.equal(JSON.parse(text).caseId, caseId);
    }
  }
  return steps[results.length] ?? { expectedReply: JSON.parse(results[1].content[0].text).id };
}
