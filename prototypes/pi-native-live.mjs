import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Controller } from '../src/controller.ts';
import { nativeProbeProvider } from './pi-native-provider.mjs';
import { streamNativeLiveProbe } from './pi-native-stream.mjs';
import { reconcileNativeResources } from './pi-native-resources.mjs';
import { captureNativeReadFixture, validateNativeReadResult } from './pi-native-read.mjs';
import {
  prepareNativeCheck,
  consumeNativeCheck,
  validateNativeCheckResult,
  verifyNativeCheck,
} from './pi-native-check.mjs';

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

export const nativeLiveReadResult = Object.freeze({
  ...nativeLiveResult,
  scope: 'dedicated-pi-native-read',
  verdict: 'native-read-pass',
  fixtureRead: true,
});

export const nativeLiveCheckResult = Object.freeze({
  ...nativeLiveResult,
  scope: 'dedicated-pi-native-check',
  verdict: 'native-check-pass',
  protectedCheck: true,
});

export function runNativeLiveCheckProbe(options) {
  return runNativeProbe(options, 'check-fixture');
}

export function runNativeLiveReadProbe(options) {
  return runNativeProbe(options, 'read-fixture');
}

export function runNativeLiveProbe(options) {
  return runNativeProbe(options, 'probe');
}

// Fixed harnesses, not production runners. No arbitrary prompt/tool/path input.
async function runNativeProbe(
  {
    directory,
    profileHome,
    signal,
    onProgress,
    onDiagnostic,
    onSpawn,
    stream = streamNativeLiveProbe,
    fixtureDirectory,
  },
  fixture,
) {
  const fixtureRead = fixture === 'read-fixture';
  const fixtureCheck = fixture === 'check-fixture';
  const toolName = fixtureCheck ? 'run_check' : fixtureRead ? 'read_fixture' : 'probe';
  const toolArguments = fixtureCheck ? { kind: 'baseline' } : {};
  signal?.throwIfAborted();
  assert.deepEqual(await readdir(directory), []);
  const store = join(directory, 'native');
  await mkdir(store, { mode: 0o700 });
  const requests = [];
  let controller,
    effects = 0,
    streamed = false,
    resultText,
    expectedReply,
    checkPause;
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
    ...(fixtureCheck ? await prepareNativeCheck(store, fixtureDirectory) : {}),
    directory: store,
    policy,
    allowanceMs: 120_000,
    clock: () => Math.floor(performance.timeOrigin + performance.now()),
    providerForCase: (id) =>
      nativeProbeProvider(
        store,
        id,
        requests,
        (request, opts) =>
          stream(request, {
            ...opts,
            profileHome,
            onDiagnostic,
            fixture,
          }),
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
    ...(fixtureCheck
      ? {
          fault: (point, id) => {
            if (point !== 'after-check-receipt') return;
            check();
            assert.equal(checkPause, undefined);
            onProgress?.('tool');
            // Pause only after handoff/drain and durable receipt, not while the worker scope
            // is live. The queued command runs before the next native model admission.
            checkPause = controller.command({
              requestId: randomUUID(),
              intent: { type: 'pause', caseId: id },
            });
            void checkPause.catch(() => {});
          },
          check: async (request, source) => {
            check();
            assert.equal(++effects, 1);
            assert.equal(request.caseId, requests[0].caseId);
            const result = await consumeNativeCheck(request, source);
            check();
            return result;
          },
        }
      : {}),
    [fixtureRead ? 'readFixture' : 'probe']: async (_id, actionSignal) => {
      assert.ok(!fixtureCheck);
      check();
      actionSignal.throwIfAborted();
      assert.equal(++effects, 1);
      assert.equal(_id, requests[0].caseId);
      resultText = fixtureRead
        ? await captureNativeReadFixture(fixtureDirectory)
        : randomBytes(16).toString('hex');
      actionSignal.throwIfAborted();
      check();
      expectedReply = fixtureRead ? validateNativeReadResult(resultText) : resultText;
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
    const savedResults = paused.messages.filter((m) => m.kind === 'eitri.action-result');
    assert.equal(savedResults.length, 1);
    let checkEvidence;
    if (fixtureCheck) {
      assert.ok(checkPause);
      await checkPause;
      checkEvidence = await verifyNativeCheck(controller, paused);
      assert.deepEqual(savedResults[0].data.result, checkEvidence.check);
      expectedReply = checkEvidence.check.id;
    } else assert.equal(savedResults[0].data.result, resultText);
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
    if (fixtureCheck)
      assert.deepEqual(await verifyNativeCheck(controller, reopened), checkEvidence);
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
    assert.equal(call.name, toolName);
    assert.deepEqual(call.arguments, toolArguments);
    assert.equal(result.toolCallId, call.id);
    assert.equal(result.toolName, call.name);
    assert.equal(result.isError, false);
    if (fixtureCheck) {
      assert.equal(result.content.length, 1);
      assert.equal(result.content[0].type, 'text');
      assert.equal(validateNativeCheckResult(result.content[0].text), expectedReply);
      const { controlVersion: _version, ...receipt } = JSON.parse(result.content[0].text);
      assert.deepEqual(receipt, checkEvidence.check);
    } else assert.deepEqual(result.content, [{ type: 'text', text: resultText }]);
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
      expectedReply,
    );
    await controller.close();
    await open();
    const final = await view(caseId);
    assert.equal(final.case.status, 'needs-attention');
    assert.deepEqual(final.messages, done.messages);
    assert.deepEqual(counters(final), counters(done));
    if (fixtureCheck) assert.deepEqual(await verifyNativeCheck(controller, final), checkEvidence);
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
  return {
    ...(fixtureCheck
      ? nativeLiveCheckResult
      : fixtureRead
        ? nativeLiveReadResult
        : nativeLiveResult),
  };
}
