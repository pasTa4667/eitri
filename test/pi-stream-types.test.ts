import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeContext } from '@earendil-works/pi-ai';
import {
  context,
  toolResponse,
  toolResult,
  finalResponse,
} from '../prototypes/pi-stream-fixtures.ts';

test('synthetic stream fixtures retain pinned native context structure and call IDs', () => {
  const complete = {
    messages: [...context.messages, toolResponse, toolResult, finalResponse],
  };
  assert.deepEqual(
    normalizeContext(JSON.parse(JSON.stringify(complete))).messages,
    complete.messages,
  );
  assert.equal(toolResponse.content[2]?.type, 'toolCall');
  assert.equal(toolResult.toolCallId, 'synthetic-call-α');
});
