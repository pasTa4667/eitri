import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { streamNativeFixture } from '../../prototypes/pi-native-stream.mjs';
import { validateRequest } from '../../prototypes/pi-stream-protocol.mjs';
import { route } from '../../prototypes/pi-stream-fixtures.ts';

// Test-only alias: retain NativeCase's faux-only guard. No live route is registered.
export function nativeFixtureProvider(directory, caseId, requests, hooks = {}) {
  const faux = fauxProvider({ api: route.api, models: [{ id: route.model }] });
  const pending = new Map();
  const native = (value) => {
    const copy = structuredClone(value);
    for (const key of ['partial', 'message', 'error']) if (copy[key]) copy[key].provider = 'faux';
    return copy;
  };
  const stream = (model, context, options) => {
    assert.equal(model.provider, 'faux');
    assert.equal(model.id, route.model);
    const db = new DatabaseSync(join(directory, 'catalogue.sqlite'), { readOnly: true });
    let action;
    try {
      action = JSON.parse(
        db.prepare('SELECT value FROM actions WHERE case_id=?').get(caseId).value,
      );
    } finally {
      db.close();
    }
    assert.equal(action.kind, 'model');
    const messages = structuredClone(context.messages);
    for (const m of messages)
      if (m.role === 'assistant') {
        assert.equal(m.provider, 'faux');
        m.provider = route.provider;
      }
    const request = validateRequest({
      version: 1,
      caseId,
      actionId: action.id,
      epoch: action.epoch,
      route,
      context: { messages },
      options: { maxTokens: 64 },
    });
    requests.push(request);
    const output = createAssistantMessageEventStream();
    const run = (async () => {
      let failed = false;
      try {
        await hooks.before?.(request);
        const message = await streamNativeFixture(request, {
          signal: options?.signal,
          onSpawn: hooks.onSpawn,
          beforeCleanup: () => hooks.beforeCleanup?.(request),
          onEvent: (event) => {
            hooks.onEvent?.(event, request);
            output.push(native(event));
          },
        });
        output.push(native({ type: 'done', reason: message.stopReason, message }));
      } catch {
        failed = true;
        const message = {
          role: 'assistant',
          api: route.api,
          provider: 'faux',
          model: route.model,
          content: [],
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'error',
          timestamp: Date.now(),
        };
        output.push({ type: 'error', reason: 'error', error: message });
      } finally {
        try {
          await hooks.afterTerminal?.(request);
        } finally {
          output.end();
        }
      }
      if (failed) throw new Error('pi-native-model-failed');
    })();
    void run.catch(() => {});
    pending.set(action.id, run);
    return output;
  };
  return {
    provider: { ...faux.provider, stream, streamSimple: stream },
    modelId: route.model,
    async drainModel(action) {
      try {
        await pending.get(action.id);
      } finally {
        pending.delete(action.id);
      }
    },
  };
}
