import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Controller } from '../src/controller.ts';
import { nativeProbeProvider } from './pi-native-provider.mjs';
import { streamNativeLiveProbe } from './pi-native-stream.mjs';
import { reconcileNativeResources } from './pi-native-resources.mjs';

export const nativeLiveResult = Object.freeze({
  scope: 'dedicated-pi-native',
  verdict: 'native-turn-pass',
  provider: 'openai-codex',
  model: 'gpt-6.1-sol',
  requests: 2,
  toolExecutions: 1,
  streamed: true,
  resultVerified: true,
  paused: true,
  reopened: true,
  budgetPreserved: true,
  disposed: true,
});

// A fixed probe, not a production runner. No external issue or arbitrary prompt/tool input.
export async function runNativeLiveProbe({
  directory,
  profileHome,
  signal,
  onProgress,
  onDiagnostic,
  onSpawn,
  stream = streamNativeLiveProbe,
}) {
  signal?.throwIfAborted();
  assert.deepEqual(await readdir(directory), []);
  const store = join(directory, 'native');
  await mkdir(store, { mode: 0o700 });
  const requests = [];
  let controller,
    effects = 0,
    streamed = false,
    resultText;
  const deadline = performance.now() + 115_000;
  const check = () => {
    signal?.throwIfAborted();
    assert.ok(performance.now() < deadline);
  };
  const policy = {
    project: 'native-probe',
    environment: 'validation',
    repository: 'no-repository',
  };
  const options = {
    directory: store,
    policy,
    allowanceMs: 120_000,
    clock: () => Math.floor(performance.timeOrigin + performance.now()),
    providerForCase: (id) =>
      nativeProbeProvider(
        store,
        id,
        requests,
        (request, opts) => stream(request, { ...opts, profileHome, onDiagnostic }),
        {
          before: () => {
            check();
            assert.ok(requests.length <= 2);
            onProgress?.('model');
          },
          onSpawn,
          onEvent: (event) => {
            if (event.type === 'text_delta' && event.delta.length) streamed = true;
          },
        },
      ),
    probe: async (_id, actionSignal) => {
      check();
      actionSignal.throwIfAborted();
      assert.equal(++effects, 1);
      resultText = randomBytes(16).toString('hex');
      onProgress?.('tool');
      await controller.command({ requestId: randomUUID(), intent: { type: 'pause', caseId: _id } });
      return resultText;
    },
  };
  const open = async () => {
    check();
    await reconcileNativeResources(store);
    controller = await Controller.open(options);
  };
  const view = async (id) => (await controller.snapshot({ selected: id })).selected;
  const parked = async (id) => {
    while (true) {
      check();
      const selected = await view(id);
      if (['paused', 'needs-attention'].includes(selected.case.status)) return selected;
      await delay(10, undefined, { signal });
    }
  };
  const cancel = () => {
    void controller?.close().catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    await open();
    const { caseId } = await controller.command({
      requestId: randomUUID(),
      intent: {
        type: 'investigate',
        issue: {
          ...policy,
          id: 'bounded-live-probe',
          title: 'Fixed harmless native integration verification',
          priority: 'high',
          status: 'unresolved',
          regressed: false,
          escalating: false,
        },
      },
    });
    const paused = await parked(caseId);
    assert.equal(paused.case.status, 'paused');
    assert.equal(requests.length, 1);
    assert.equal(effects, 1);
    assert.equal(paused.messages.filter((m) => m.kind === 'eitri.action-result').length, 1);
    assert.ok(paused.case.usedMs > 0 && paused.case.usedMs < 120_000);
    const counters = (selected) => [
      selected.case.usedMs,
      selected.case.remainingMs,
      selected.case.attempt,
      selected.case.repairs,
    ];
    await controller.close();
    await open();
    const reopened = await view(caseId);
    assert.equal(reopened.case.status, 'paused');
    assert.deepEqual(counters(reopened), counters(paused));
    assert.deepEqual(reopened.messages, paused.messages);
    assert.equal(requests.length, 1);
    await controller.command({
      requestId: randomUUID(),
      expectedControlVersion: reopened.case.version,
      intent: { type: 'continue', caseId },
    });
    const done = await parked(caseId);
    assert.equal(done.case.reason, 'assessment-required');
    assert.equal(requests.length, 2);
    assert.equal(effects, 1);
    assert.ok(streamed);
    const second = requests[1];
    const call = second.context.messages
      .find((m) => m.role === 'assistant')
      .content.find((b) => b.type === 'toolCall');
    const result = second.context.messages.find((m) => m.role === 'toolResult');
    assert.equal(call.name, 'probe');
    assert.deepEqual(call.arguments, {});
    assert.equal(result.toolCallId, call.id);
    assert.equal(result.isError, false);
    assert.deepEqual(result.content, [{ type: 'text', text: resultText }]);
    assert.notEqual(requests[0].actionId, second.actionId);
    assert.ok(done.case.usedMs >= paused.case.usedMs);
    assert.equal(done.case.usedMs + done.case.remainingMs, 120_000);
    assert.equal(done.case.attempt, 1);
    assert.equal(done.case.repairs, 0);
    assert.equal(done.messages.filter((m) => m.kind === 'eitri.action-result').length, 1);
    const models = done.messages
      .flatMap((m) => m.data?.messages ?? [])
      .filter((m) => m.role === 'assistant');
    assert.equal(models.length, 2);
    assert.equal(
      models[1].content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim(),
      resultText,
    );
    await controller.close();
    await open();
    const final = await view(caseId);
    assert.equal(final.case.status, 'needs-attention');
    assert.deepEqual(final.messages, done.messages);
    assert.deepEqual(counters(final), counters(done));
    assert.equal(requests.length, 2);
    assert.equal(effects, 1);
    check();
  } finally {
    signal?.removeEventListener('abort', cancel);
    await controller?.close();
  }
  // Only this newly created store, after a successful durable reopen and controller close.
  // Failures retain private case state and never auto-requeue or reset it.
  await rm(store, { recursive: true });
  return { ...nativeLiveResult };
}
