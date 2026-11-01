import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Controller } from '../src/controller.ts';
import { nativeProbeProvider } from './pi-native-provider.mjs';
import { streamNativeLiveProbe } from './pi-native-stream.mjs';
import { reconcileNativeResources } from './pi-native-resources.mjs';
import {
  captureNativeReadFixture,
  nativeReadResult,
  validateNativeReadResult,
} from './pi-native-read.mjs';
import {
  prepareNativeCheck,
  consumeNativeCheck,
  validateNativeCheckResult,
  verifyNativeCheck,
} from './pi-native-check.mjs';
import { nativeDiagnosisEvidence, validateNativeDiagnosis } from './pi-native-diagnosis.mjs';

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

export const nativeLiveWorkflowResult = Object.freeze({
  ...nativeLiveCheckResult,
  scope: 'dedicated-pi-native-workflow',
  verdict: 'native-workflow-pass',
  requests: 3,
  toolExecutions: 2,
  fixtureRead: true,
});

export const nativeLiveDiagnosisResult = Object.freeze({
  ...nativeLiveWorkflowResult,
  scope: 'dedicated-pi-native-diagnosis',
  verdict: 'native-diagnosis-pass',
  diagnosisSaved: true,
  proposalOnly: true,
});

export function runNativeLiveDiagnosisProbe(options) {
  return runNativeProbe(options, 'diagnose-fixture');
}

export function runNativeLiveWorkflowProbe(options) {
  return runNativeProbe(options, 'read-check-fixture');
}

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
  const diagnosis = fixture === 'diagnose-fixture';
  const workflow = diagnosis || fixture === 'read-check-fixture';
  const fixtureRead = fixture === 'read-fixture' || workflow;
  const fixtureCheck = fixture === 'check-fixture' || workflow;
  const expectedRequests = workflow ? 3 : 2;
  const expectedEffects = workflow ? 2 : 1;
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
  const prepared = fixtureCheck ? await prepareNativeCheck(store, fixtureDirectory) : {};
  const capturedRead = workflow
    ? nativeReadResult(
        prepared.offlineWorkspace.baseline.find((f) => f.virtualPath === 'src/lib/errors.js').bytes,
      )
    : undefined;
  const options = {
    ...prepared,
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
            assert.ok(requests.length <= expectedRequests);
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
            assert.equal(++effects, expectedEffects);
            assert.equal(requests.length, expectedRequests - 1);
            assert.equal(request.caseId, requests[0].caseId);
            const result = await consumeNativeCheck(request, source);
            check();
            return result;
          },
        }
      : {}),
    [fixtureRead ? 'readFixture' : 'probe']: async (_id, actionSignal) => {
      assert.ok(!fixtureCheck || workflow);
      check();
      actionSignal.throwIfAborted();
      assert.equal(++effects, 1);
      assert.equal(requests.length, 1);
      assert.equal(_id, requests[0].caseId);
      resultText = fixtureRead
        ? (capturedRead ?? (await captureNativeReadFixture(fixtureDirectory)))
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
    const counters = (selected) => [
      selected.case.usedMs,
      selected.case.remainingMs,
      selected.case.attempt,
      selected.case.repairs,
    ];
    const continuePaused = async (paused, evidence) => {
      const count = requests.length;
      await controller.close();
      await open();
      const reopened = await view(caseId);
      assert.equal(reopened.case.status, 'paused');
      assert.deepEqual(counters(reopened), counters(paused));
      assert.deepEqual(reopened.messages, paused.messages);
      assert.equal(requests.length, count);
      assert.deepEqual(reopened.checks, paused.checks);
      assert.deepEqual(reopened.artifacts, paused.artifacts);
      if (evidence) assert.deepEqual(await verifyNativeCheck(controller, reopened), evidence);
      await controller.command({
        requestId: randomUUID(),
        expectedControlVersion: reopened.case.version,
        intent: { type: 'continue', caseId },
      });
    };
    let readPaused;
    if (workflow) {
      readPaused = await parked(caseId);
      assert.equal(readPaused.case.status, 'paused');
      assert.equal(requests.length, 1);
      assert.equal(effects, 1);
      assert.deepEqual(
        readPaused.messages
          .filter((m) => m.kind === 'eitri.action-result')
          .map((m) => m.data.result),
        [capturedRead],
      );
      assert.equal(readPaused.checks.length, 0);
      assert.ok(readPaused.case.usedMs > 0);
      await continuePaused(readPaused);
    }
    const paused = await parked(caseId);
    assert.equal(paused.case.status, 'paused');
    assert.equal(requests.length, expectedRequests - 1);
    assert.equal(effects, expectedEffects);
    const savedResults = paused.messages.filter((m) => m.kind === 'eitri.action-result');
    assert.equal(savedResults.length, expectedEffects);
    let checkEvidence;
    if (fixtureCheck) {
      assert.ok(checkPause);
      await checkPause;
      checkEvidence = await verifyNativeCheck(controller, paused);
      assert.deepEqual(savedResults.at(-1).data.result, checkEvidence.check);
      if (workflow) {
        assert.equal(savedResults[0].data.result, capturedRead);
        assert.ok(paused.case.usedMs >= readPaused.case.usedMs);
        assert.deepEqual(
          [paused.case.attempt, paused.case.repairs],
          [readPaused.case.attempt, readPaused.case.repairs],
        );
        const transfer = checkEvidence.history.history.value.report.evidence.provenance.transfer;
        assert.equal(
          transfer.find((f) => f.path === 'src/lib/errors.js').sha256,
          validateNativeReadResult(capturedRead),
        );
      }
      expectedReply = checkEvidence.check.id;
    } else assert.equal(savedResults[0].data.result, resultText);
    assert.ok(paused.case.usedMs > 0 && paused.case.usedMs < 120_000);
    await continuePaused(paused, checkEvidence);
    const done = await parked(caseId);
    assert.equal(done.case.reason, 'assessment-required');
    assert.equal(requests.length, expectedRequests);
    assert.equal(effects, expectedEffects);
    assert.ok(streamed);
    const last = requests.at(-1);
    const call = last.context.messages
      .filter((m) => m.role === 'assistant')
      .at(-1)
      .content.find((b) => b.type === 'toolCall');
    const result = last.context.messages.filter((m) => m.role === 'toolResult').at(-1);
    if (workflow) {
      const readResult = last.context.messages.find((m) => m.role === 'toolResult');
      assert.equal(readResult.toolName, 'read_fixture');
      assert.deepEqual(readResult.content, [{ type: 'text', text: capturedRead }]);
    }
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
    assert.equal(new Set(requests.map((r) => r.actionId)).size, expectedRequests);
    assert.ok(done.case.usedMs >= paused.case.usedMs);
    assert.equal(done.case.usedMs + done.case.remainingMs, 120_000);
    assert.equal(done.case.attempt, 1);
    assert.equal(done.case.repairs, 0);
    assert.equal(
      done.messages.filter((m) => m.kind === 'eitri.action-result').length,
      expectedEffects,
    );
    const models = done.messages
      .flatMap((m) => m.data?.messages ?? [])
      .filter((m) => m.role === 'assistant');
    assert.equal(models.length, expectedRequests);
    const finalText = models
      .at(-1)
      .content.filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (diagnosis)
      validateNativeDiagnosis(finalText, nativeDiagnosisEvidence(last.context, caseId));
    else assert.equal(finalText, expectedReply);
    await controller.close();
    await open();
    const final = await view(caseId);
    assert.equal(final.case.status, 'needs-attention');
    assert.equal(final.case.phase, done.case.phase);
    assert.equal(final.case.candidate, null);
    assert.deepEqual(final.messages, done.messages);
    assert.deepEqual(counters(final), counters(done));
    if (fixtureCheck) assert.deepEqual(await verifyNativeCheck(controller, final), checkEvidence);
    assert.equal(requests.length, expectedRequests);
    assert.equal(effects, expectedEffects);
    check();
  } finally {
    signal?.removeEventListener('abort', cancel);
    await controller?.close();
  }
  // Diagnosis lives in the authoritative native transcript. Keep its private store after
  // success; delivery-only probes remove theirs. Failures never auto-resume or reset.
  if (!diagnosis) await rm(store, { recursive: true });
  return {
    ...(diagnosis
      ? nativeLiveDiagnosisResult
      : workflow
        ? nativeLiveWorkflowResult
        : fixtureCheck
          ? nativeLiveCheckResult
          : fixtureRead
            ? nativeLiveReadResult
            : nativeLiveResult),
  };
}
