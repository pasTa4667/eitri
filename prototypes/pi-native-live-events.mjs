import assert from 'node:assert/strict';
import { encodeLine } from './pi-stream-protocol.mjs';

// Pinned Codex SDK function-call partials carry a temporary argument buffer.
// Project only that known field on a detached active start/delta block; the strict
// receiver still validates every remaining field, sequence and terminal unchanged.
export function snapshotNativeLiveEvent(raw) {
  const event = structuredClone(raw);
  // Validate JSON/UTF-8 and the original event's byte bound before omitting scratch.
  encodeLine(event);
  if (event.type === 'toolcall_start' || event.type === 'toolcall_delta') {
    const index = event.contentIndex;
    if (Number.isSafeInteger(index) && index >= 0 && Array.isArray(event.partial?.content)) {
      const block = event.partial.content[index];
      if (block?.type === 'toolCall' && Object.hasOwn(block, 'partialJson')) {
        assert.equal(typeof block.partialJson, 'string');
        delete block.partialJson;
      }
    }
  }
  return event;
}
