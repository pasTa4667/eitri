import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import { checksum, validateOutput } from '../../src/artifacts.ts';
import { Controller } from '../../src/controller.ts';
import { digest } from '../../src/domain.ts';
import type { AdmittedCheckRequest } from '../../src/domain.ts';
import { captureProfileNameFixture } from '../../src/fixture-profile-name.ts';
import { FrozenBrowserValidator } from '../../src/frozen-browser.ts';
import type {
  FrozenBrowserAcceptance,
  FrozenBrowserConsumption,
  RecoveryRun,
} from '../../src/frozen-browser.ts';
import { repositoryId, virtualPath, WorkspaceStore } from '../../src/workspace.ts';

if (
  process.env.EITRI_FROZEN_DOCKER_ACCEPTANCE !== '1' ||
  !process.env.EITRI_PROFILE_NAME_FIXTURE_DIRECTORY
)
  throw new Error(
    'Profile controller Docker acceptance requires fresh parent review, EITRI_FROZEN_DOCKER_ACCEPTANCE=1 and an explicit EITRI_PROFILE_NAME_FIXTURE_DIRECTORY. No skips or substitutes.',
  );

const execute = promisify(execFile);
const baseTag = 'eitri-chromium-probe:1.64.1-node26.5.0';
async function dockerRead(root: string, args: string[]) {
  await appendFile(join(root, 'docker-read.log'), JSON.stringify(args) + '\n');
  const { stdout, stderr } = await execute('docker', ['--context', 'orbstack', ...args], {
    encoding: 'utf8',
    timeout: 15000,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
  });
  await appendFile(join(root, 'docker-read.log'), JSON.stringify({ stdout, stderr }) + '\n');
  return stdout.trim();
}
async function ownedAbsent(root: string, owner: string, run: RecoveryRun, base: string) {
  if (run.image.kind !== 'acquired' || run.container.kind !== 'acquired')
    return assert.fail('Real acquired resource IDs required');
  assert.match(run.image.id, /^sha256:[0-9a-f]{64}$/);
  assert.match(run.container.id, /^[0-9a-f]{64}$/);
  assert.notEqual(run.image.id, base);
  for (const filter of [
    `label=eitri.frozen-browser.owner=${owner}`,
    `id=${run.container.id}`,
    `name=^/eitri-frozen-browser-${run.runId}$`,
  ])
    assert.equal(
      await dockerRead(root, ['container', 'ls', '-aq', '--no-trunc', '--filter', filter]),
      '',
      filter,
    );
  for (const filter of [
    `label=eitri.frozen-browser.owner=${owner}`,
    `reference=eitri-frozen-browser:${run.runId}`,
  ])
    assert.equal(
      await dockerRead(root, ['image', 'ls', '-aq', '--no-trunc', '--filter', filter]),
      '',
      filter,
    );
  const images = (await dockerRead(root, ['image', 'ls', '-aq', '--no-trunc'])).split('\n');
  assert.equal(images.includes(run.image.id), false);
  assert.equal(images.includes(base), true);
  assert.equal(await dockerRead(root, ['image', 'inspect', baseTag, '--format', '{{.Id}}']), base);
}

test(
  'actual captured profile baseline becomes one real native check and PNG without replay',
  { timeout: 300000 },
  async (t) => {
    const captured = await captureProfileNameFixture(
      process.env.EITRI_PROFILE_NAME_FIXTURE_DIRECTORY!,
    );
    assert.deepEqual(captured.provenance, { kind: 'uncommitted-copy' });
    assert.equal(captured.source.size, 534);
    assert.equal(
      captured.source.sha256,
      'cd69431e5b7fda7ec116377d033d192a7b214a9c42a8101bd8c809c862af80f4',
    );
    assert.equal(
      captured.captureDigest,
      '709e1a12ba7bfd02a33adb2d12b9f13c2cf5c831b1c224943b10bee111b65fe0',
    );
    const root = await realpath(await mkdtemp(join(tmpdir(), 'eitri-controller-profile-')));
    t.diagnostic(`Profile diagnostics retained at ${root}`);
    console.log(`Profile diagnostics retained at ${root}`);
    const directory = join(root, 'controller');
    const journalDirectory = join(root, 'journal');
    const workspaceDirectory = join(root, 'bootstrap-workspace');
    await mkdir(journalDirectory, { mode: 0o700 });
    await mkdir(workspaceDirectory, { mode: 0o700 });
    let controller: Controller | undefined;
    const diagnostics: Record<string, unknown> = { root, captureDigest: captured.captureDigest };
    t.after(async () => {
      try {
        await controller?.close();
      } finally {
        await writeFile(join(root, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2));
      }
    });
    const base = await dockerRead(root, ['image', 'inspect', baseTag, '--format', '{{.Id}}']);
    assert.match(base, /^sha256:[0-9a-f]{64}$/);
    const inventory = async (initialize = false) => {
      const workspace = await WorkspaceStore.open({
        directory: workspaceDirectory,
        regressionDirectory: virtualPath('regression'),
      });
      try {
        if (initialize) {
          const validator = await FrozenBrowserValidator.open({
            directory: journalDirectory,
            workspace,
          });
          await validator.close();
        }
        const journal = await FrozenBrowserValidator.open({
          directory: journalDirectory,
          workspace,
          mode: 'journal-only',
        });
        try {
          return await journal.inventory();
        } finally {
          await journal.close();
        }
      } finally {
        await workspace.close();
      }
    };
    const initial = await inventory(true);
    assert.equal(initial.attempts, 0);
    assert.deepEqual(initial.runs, []);
    const binding = {
      directory: journalDirectory,
      ownerId: initial.ownerId,
      configurationDigest: initial.configurationDigest,
    };
    const counters = {
      turns: 0,
      callbacks: 0,
      assessments: 0,
      baseline: 0,
      tools: 0,
      models: 0,
      acceptances: 0,
      consumptions: 0,
      reopenedTurns: 0,
      reopenedCallbacks: 0,
    };
    let callbackRequest!: AdmittedCheckRequest;
    let accepted!: FrozenBrowserAcceptance;
    let consumed!: FrozenBrowserConsumption;
    const options: Parameters<typeof Controller.open>[0] = {
      directory,
      policy: { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' },
      allowanceMs: 180000,
      offlineWorkspace: {
        repositoryId: repositoryId(randomUUID()),
        regressionDirectory: virtualPath('regression'),
        workerScenarioId: 'profile-name-v1',
        baseline: [{ virtualPath: captured.source.virtualPath, bytes: captured.source.bytes }],
      },
      offlineWorkerJournal: binding,
      offlineWorkerAcceptance: true,
      offlineWorkerConsumption: true,
      check: async (request, source) => {
        counters.callbacks++;
        callbackRequest = request;
        assert.equal(request.kind, 'baseline');
        assert.ok(source?.workerAcceptance && source.workerConsumption);
        accepted = await source.workerAcceptance.accept();
        counters.acceptances++;
        consumed = await source.workerConsumption.consume();
        counters.consumptions++;
        return { type: 'consumed-browser' };
      },
      providerForCase: (id) => {
        const faux = fauxProvider({ tokensPerSecond: 100000 });
        faux.setResponses([
          async () => {
            counters.turns++;
            counters.assessments++;
            const view = (await controller!.snapshot({ selected: id })).selected!;
            assert.equal(view.case.phase, 'triage');
            return fauxAssistantMessage(
              fauxToolCall('complete_assessment', {
                phase: 'triage',
                expectedControlVersion: view.case.version,
                conclusion: 'progress',
                reason: 'Investigate captured helper in the protected browser probe',
                evidenceIds: [],
              }),
              { stopReason: 'toolUse' },
            );
          },
          () => {
            counters.turns++;
            counters.baseline++;
            return fauxAssistantMessage(fauxToolCall('run_check', { kind: 'baseline' }), {
              stopReason: 'toolUse',
            });
          },
          () => {
            counters.turns++;
            return fauxAssistantMessage('Done');
          },
          () => assert.fail('Unexpected provider turn or historical replay'),
        ]);
        return { provider: faux.provider, modelId: faux.getModel().id };
      },
      fault: (point) => {
        if (point === 'after-tool-action-receipt') counters.tools++;
        if (point === 'after-model-action-receipt') counters.models++;
      },
    };
    controller = await Controller.open(options);
    const command = await controller.command({
      requestId: randomUUID(),
      intent: {
        type: 'investigate',
        issue: {
          ...options.policy,
          id: 'profile-name',
          title: 'Captured helper baseline',
          priority: 'high',
          status: 'unresolved',
          regressed: false,
          escalating: false,
        },
      },
    });
    assert.equal(command.disposition, 'accepted');
    const id = command.caseId!;
    const deadline = Date.now() + 180000;
    let view;
    while (true) {
      view = (await controller.snapshot({ selected: id })).selected!;
      diagnostics.lastSnapshot = view;
      if (view.case.status === 'needs-attention' && counters.tools === 2 && counters.models === 3)
        break;
      if (Date.now() >= deadline) assert.fail(`Retirement timed out, retained ${root}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.deepEqual(counters, {
      turns: 3,
      callbacks: 1,
      assessments: 1,
      baseline: 1,
      tools: 2,
      models: 3,
      acceptances: 1,
      consumptions: 1,
      reopenedTurns: 0,
      reopenedCallbacks: 0,
    });
    assert.equal(view.case.simulated, true);
    assert.equal(view.case.phase, 'investigation');
    assert.equal(view.case.reason, 'assessment-required');
    assert.equal(view.case.candidate, null);
    assert.equal(view.case.accountedAt, null);
    assert.equal(view.checks.length, 1);
    const real = view.checks[0];
    if (real.simulated) return assert.fail('Real native baseline receipt required');
    assert.equal(real.kind, 'baseline');
    assert.equal(real.passed, true);
    assert.equal(real.caseId, id);
    assert.equal(real.actionId, callbackRequest.actionId);
    const pins = controller.inspectWorkerExecutionFacts(id, real.actionId);
    if (pins.state !== 'retained') return assert.fail('Independent live execution facts required');
    assert.equal(pins.provenance, 'controller-live-consumption');
    assert.deepEqual(pins.binding, { version: 1, ...binding });
    const request = pins.intent.request;
    assert.equal(request.scenarioId, 'profile-name-v1');
    assert.equal(request.role, 'baseline');
    assert.deepEqual(request.action, {
      caseId: id,
      actionId: callbackRequest.actionId,
      epoch: callbackRequest.epoch,
    });
    assert.equal(request.frozen.caseId, id);
    assert.equal(request.frozen.revision, real.candidate);
    assert.equal(view.case.base, real.candidate);
    assert.ok(request.allowanceMs > 30000 && request.allowanceMs <= 60000);
    assert.equal(pins.intent.requestDigest, digest(request));
    const facts = pins.facts;
    const key = facts.consumedRun;
    assert.deepEqual(real.provenance, {
      kind: 'frozen-browser-consumed-v1',
      epoch: request.action.epoch,
      ownerId: binding.ownerId,
      ...key,
      admittedAt: facts.admittedAt,
      deadline: facts.deadline,
      finishedAt: real.provenance.finishedAt,
      outcome: 'baseline-reproduced',
    });
    assert.equal(real.configuration, binding.configurationDigest);
    const history = await controller.inspectWorkerConsumedHistory(id, real.actionId);
    if (history.state !== 'consumed' || history.history.value.state !== 'settled')
      return assert.fail('Settled consumed history required');
    assert.deepEqual(history.independentExecutionPins, pins);
    assert.deepEqual(history.intent, pins.intent);
    assert.equal(history.acceptance.provenance, 'worker-journal');
    assert.equal(history.history.provenance, 'worker-journal');
    assert.deepEqual(history.acceptance.value, accepted);
    assert.deepEqual(accepted.request, request);
    assert.equal(accepted.requestDigest, digest(request));
    assert.equal(accepted.ownerId, binding.ownerId);
    assert.equal(accepted.configurationDigest, binding.configurationDigest);
    assert.equal(accepted.acceptanceId, key.acceptanceId);
    assert.equal(accepted.deadline, accepted.acceptedAt + request.allowanceMs);
    const settled = history.history.value;
    assert.deepEqual(settled.consumedRun, key);
    assert.equal(settled.admittedAt, facts.admittedAt);
    assert.equal(settled.deadline, facts.deadline);
    assert.ok(facts.admittedAt >= accepted.acceptedAt && facts.deadline > facts.admittedAt);
    assert.ok(
      facts.deadline <= callbackRequest.deadlineAt &&
        facts.deadline <= facts.admittedAt + request.allowanceMs,
    );
    const report = settled.report;
    diagnostics.report = report;
    diagnostics.pins = pins;
    assert.equal(report.runId, key.runId);
    assert.deepEqual(report.request, request);
    assert.deepEqual(report.outcome, { kind: 'baseline-reproduced' });
    assert.deepEqual(report.cleanup, { kind: 'owned-removed', cache: 'retained' });
    const evidence = report.evidence;
    assert.ok(evidence);
    assert.equal(evidence.observations.scenarioId, 'profile-name-v1');
    assert.equal(Object.hasOwn(evidence.observations, 'literal'), false);
    const profile = evidence.observations.profile as {
      definitionSha256: string;
      actuals: unknown;
      diagnostic: unknown;
    };
    assert.equal(
      profile.definitionSha256,
      '35d237dc1f5f753c7a89772b9b258c48631e04d758a7632fee5d9724710aa412',
    );
    assert.deepEqual(profile.actuals, [
      { caseId: 'missing-profile', kind: 'threw' },
      { caseId: 'trimmed-name', kind: 'returned', value: 'Ada Lovelace' },
      { caseId: 'second-name', kind: 'returned', value: 'gRaCe Hopper' },
      { caseId: 'blank-name', kind: 'returned', value: 'Anonymous' },
      { caseId: 'missing-name', kind: 'returned', value: 'Anonymous' },
      { caseId: 'null-name', kind: 'returned', value: 'Anonymous' },
      { caseId: 'null-profile', kind: 'threw' },
      { caseId: 'null-user', kind: 'threw' },
      { caseId: 'undefined-user', kind: 'threw' },
    ]);
    assert.deepEqual(profile.diagnostic, {
      caseId: 'missing-profile',
      nativeTypeError: true,
      name: 'TypeError',
      message: "Cannot read properties of undefined (reading 'name')",
      firstFrame: 'at getUserDisplayName (/src/lib/errors.js:5:23)',
    });
    assert.equal(evidence.observations.canaryAfter, 'ENOENT');
    assert.deepEqual(evidence.observations.restrictions, {
      root: 'EROFS',
      snapshot: 'EROFS',
      socket: 'ENOENT',
      hostPath: 'ENOENT',
      canary: 'ENOENT',
      egress: 'ENETUNREACH',
    });
    const provenance = evidence.provenance;
    assert.deepEqual(provenance.frozen, request.frozen);
    assert.equal(provenance.requestDigest, digest(request));
    assert.equal(provenance.configurationDigest, binding.configurationDigest);
    assert.equal(provenance.admittedAt, facts.admittedAt);
    assert.equal(provenance.deadline, facts.deadline);
    assert.equal(provenance.finishedAt, real.provenance.finishedAt);
    assert.ok(provenance.finishedAt >= facts.admittedAt && provenance.finishedAt <= facts.deadline);
    assert.equal(provenance.exitCode, 0);
    assert.equal(provenance.oomKilled, false);
    assert.equal(provenance.baseBefore.id, base);
    assert.deepEqual(provenance.baseAfter, provenance.baseBefore);
    assert.deepEqual(provenance.transfer, [
      {
        path: 'src/lib/errors.js',
        size: 534,
        sha256: 'cd69431e5b7fda7ec116377d033d192a7b214a9c42a8101bd8c809c862af80f4',
      },
    ]);
    const admission = await controller.inspectWorkerConsumedAdmission(id, real.actionId);
    if (admission.state !== 'consumed' || admission.conversion.state !== 'converted')
      return assert.fail('Behavioral native conversion required');
    assert.equal(admission.conversion.admission.type, 'behavioral');
    assert.equal(view.artifacts.length, 1);
    const artifact = view.artifacts[0];
    assert.deepEqual(real.artifacts, [artifact.id]);
    assert.equal(artifact.caseId, id);
    assert.equal(artifact.actionId, real.actionId);
    assert.equal(artifact.checkId, real.id);
    assert.equal(artifact.revision, real.candidate);
    assert.equal(artifact.configuration, real.configuration);
    assert.equal(artifact.simulated, false);
    assert.equal(artifact.mime, 'image/png');
    const bytes = validateOutput({
      ...artifact,
      bytes: (await controller.artifact(id, artifact.id)).bytes,
    });
    assert.deepEqual(bytes, Buffer.from(evidence.png.base64, 'base64'));
    assert.equal(bytes.length, evidence.png.size);
    assert.equal(bytes.length, artifact.size);
    assert.equal(checksum(bytes), evidence.png.sha256);
    assert.equal(checksum(bytes), artifact.sha256);
    const recorded = await inventory();
    diagnostics.inventory = recorded;
    assert.equal(recorded.ownerId, binding.ownerId);
    assert.equal(recorded.configurationDigest, binding.configurationDigest);
    assert.equal(recorded.attempts, 1);
    assert.equal(recorded.runs.length, 1);
    const record = recorded.runs[0];
    if (!('kind' in record) || !record.consumption || record.consumption.state !== 'settled')
      return assert.fail('Exactly one settled accepted execution required');
    const { kind, state, consumption: run, ...ack } = record;
    assert.equal(kind, 'offline-acceptance');
    assert.equal(state, 'accepted');
    assert.deepEqual(ack, accepted);
    assert.equal(run.runId, key.runId);
    assert.deepEqual(run.request, request);
    assert.equal(run.requestDigest, pins.intent.requestDigest);
    assert.equal(run.configurationDigest, binding.configurationDigest);
    assert.equal(run.admittedAt, facts.admittedAt);
    assert.equal(run.deadline, facts.deadline);
    assert.equal(run.build, 'completed');
    assert.deepEqual(run.outcome, report.outcome);
    assert.deepEqual(run.cleanup, report.cleanup);
    assert.equal(run.image.kind, 'acquired');
    assert.equal(run.container.kind, 'acquired');
    if (run.image.kind !== 'acquired' || run.container.kind !== 'acquired')
      return assert.fail('Acquired IDs required');
    assert.equal(provenance.imageId, run.image.id);
    assert.equal(provenance.containerId, run.container.id);
    assert.equal(consumed.acceptanceId, key.acceptanceId);
    assert.deepEqual(consumed.run, run);
    await ownedAbsent(root, binding.ownerId, run, base);
    const results = view.messages.filter((message) => message.kind === 'eitri.action-result');
    assert.equal(results.length, 2);
    assert.deepEqual(results[1].data, { actionId: real.actionId, result: real });
    const savedCounters = { ...counters };
    await controller.close();
    controller = undefined;
    controller = await Controller.open({
      ...options,
      providerForCase: () => {
        const faux = fauxProvider();
        faux.setResponses([
          () => {
            counters.reopenedTurns++;
            return assert.fail('Provider replay');
          },
        ]);
        return { provider: faux.provider, modelId: faux.getModel().id };
      },
      check: async () => {
        counters.reopenedCallbacks++;
        return assert.fail('Callback replay');
      },
    });
    const reopened = (await controller.snapshot({ selected: id })).selected!;
    assert.deepEqual(reopened.case, { ...view.case, epoch: view.case.epoch + 1 });
    assert.deepEqual(reopened.checks, view.checks);
    assert.deepEqual(reopened.artifacts, view.artifacts);
    assert.deepEqual(
      reopened.messages.filter((message) => message.kind === 'eitri.action-result'),
      results,
    );
    assert.deepEqual((await controller.artifact(id, artifact.id)).bytes, bytes);
    assert.deepEqual(controller.inspectWorkerExecutionFacts(id, real.actionId), pins);
    assert.deepEqual(await controller.inspectWorkerConsumedHistory(id, real.actionId), history);
    assert.deepEqual(await controller.inspectWorkerConsumedAdmission(id, real.actionId), admission);
    assert.deepEqual(await inventory(), recorded);
    await ownedAbsent(root, binding.ownerId, run, base);
    await controller.close();
    controller = undefined;
    assert.deepEqual(counters, savedCounters);
  },
);
