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
import type {
  OfflineActionWorkspace,
  WorkerExecutionFactsObservation,
} from '../../src/controller.ts';
import { digest, uuid } from '../../src/domain.ts';
import type { AdmittedCheckRequest, RealBrowserCheck, Snapshot } from '../../src/domain.ts';
import { FrozenBrowserValidator } from '../../src/frozen-browser.ts';
import type {
  FrozenBrowserAcceptance,
  FrozenBrowserConsumption,
  FrozenBrowserConsumedRunKey,
  FrozenBrowserJournal,
  FrozenBrowserRequest,
  RecoveryInventory,
  RecoveryRun,
} from '../../src/frozen-browser.ts';
import { repositoryId, virtualPath, WorkspaceStore } from '../../src/workspace.ts';

if (process.env.EITRI_FROZEN_DOCKER_ACCEPTANCE !== '1')
  throw new Error(
    'Actual Docker acceptance requires fresh parent security review and EITRI_FROZEN_DOCKER_ACCEPTANCE=1. This suite never substitutes transcripts or skips.',
  );

const scenarios = [
  { literal: 'A', outcome: 'baseline-reproduced', passed: true, providerTurns: 3 },
  { literal: 'B', outcome: 'baseline-not-reproduced', passed: false, providerTurns: 2 },
] as const;
type ControllerWorkerExecutionFacts = Extract<
  WorkerExecutionFactsObservation,
  { state: 'retained' }
>['facts'];
type SelectedView = NonNullable<Snapshot['selected']>;
const baseTag = 'eitri-chromium-probe:1.64.1-node26.5.0';
type DockerQuery =
  | readonly ['image', 'inspect', typeof baseTag, '--format', '{{.Id}}']
  | readonly ['image', 'ls', '--all', '--no-trunc', '--quiet', ...([] | ['--filter', string])]
  | readonly ['container', 'ls', '--all', '--no-trunc', '--quiet', '--filter', string];
const execute = promisify(execFile);

async function dockerRead(root: string, args: DockerQuery): Promise<string> {
  const command = ['--context', 'orbstack', ...args];
  await appendFile(join(root, 'docker-read.log'), `${JSON.stringify(command)}\n`);
  try {
    const { stdout, stderr } = await execute('docker', command, {
      encoding: 'utf8',
      timeout: 15000,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
    });
    await appendFile(join(root, 'docker-read.log'), JSON.stringify({ stdout, stderr }) + '\n');
    return stdout;
  } catch (error) {
    await appendFile(join(root, 'docker-read.log'), `${String(error)}\n`);
    throw error;
  }
}

function resourceIds(output: string, kind: 'image' | 'container'): string[] {
  const ids = output.trim() ? output.trim().split('\n') : [];
  for (const id of ids)
    assert.match(id, kind === 'image' ? /^sha256:[0-9a-f]{64}$/ : /^[0-9a-f]{64}$/);
  return ids;
}

async function baseImage(root: string): Promise<string> {
  const ids = resourceIds(
    await dockerRead(root, ['image', 'inspect', baseTag, '--format', '{{.Id}}']),
    'image',
  );
  assert.equal(ids.length, 1);
  return ids[0];
}

async function assertOwnedAbsent(
  root: string,
  ownerId: string,
  run: RecoveryRun,
  pinnedBase: string,
) {
  assert.ok(uuid(ownerId));
  assert.ok(uuid(run.runId));
  assert.equal(run.image.kind, 'acquired');
  assert.equal(run.container.kind, 'acquired');
  if (run.image.kind !== 'acquired' || run.container.kind !== 'acquired')
    return assert.fail('Actual worker resource acquisitions required');
  assert.match(run.image.id, /^sha256:[0-9a-f]{64}$/);
  assert.match(run.container.id, /^[0-9a-f]{64}$/);
  assert.notEqual(run.image.id, pinnedBase);
  for (const filter of [
    `label=eitri.frozen-browser.owner=${ownerId}`,
    `id=${run.container.id}`,
    `name=^/eitri-frozen-browser-${run.runId}$`,
  ])
    assert.deepEqual(
      resourceIds(
        await dockerRead(root, [
          'container',
          'ls',
          '--all',
          '--no-trunc',
          '--quiet',
          '--filter',
          filter,
        ]),
        'container',
      ),
      [],
      `Owned containers remain for ${filter}`,
    );
  for (const filter of [
    `label=eitri.frozen-browser.owner=${ownerId}`,
    `reference=eitri-frozen-browser:${run.runId}`,
  ])
    assert.deepEqual(
      resourceIds(
        await dockerRead(root, [
          'image',
          'ls',
          '--all',
          '--no-trunc',
          '--quiet',
          '--filter',
          filter,
        ]),
        'image',
      ),
      [],
      `Owned images remain for ${filter}`,
    );
  const images = resourceIds(
    await dockerRead(root, ['image', 'ls', '--all', '--no-trunc', '--quiet']),
    'image',
  );
  assert.equal(images.includes(run.image.id), false, `Owned image remains ${run.image.id}`);
  assert.equal(images.includes(pinnedBase), true);
  assert.equal(await baseImage(root), pinnedBase);
}

for (const scenario of scenarios)
  test(
    `actual Docker controller baseline ${scenario.literal} consumes one exact report and reopens its PNG`,
    { timeout: 300000 },
    async (t) => {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'eitri-controller-docker-')));
      t.diagnostic(`Fixture and diagnostics retained at ${root}`);
      console.log(`Fixture and diagnostics retained at ${root}`);
      const directory = join(root, 'controller');
      const journalDirectory = join(root, 'journal');
      const workspaceDirectory = join(root, 'bootstrap-workspace');
      let controller: Controller | undefined;
      let workspace: WorkspaceStore | undefined;
      let journal: FrozenBrowserJournal | FrozenBrowserValidator | undefined;
      const counters = {
        providerTurns: 0,
        assessmentCalls: 0,
        baselineCalls: 0,
        callbacks: 0,
        acceptances: 0,
        consumptions: 0,
        toolRetirements: 0,
        modelRetirements: 0,
        reopenedProviderTurns: 0,
        reopenedCallbacks: 0,
      };
      const diagnostics: Record<string, unknown> = { scenario, root, counters };
      const closeController = async () => {
        if (!controller) return;
        await controller.close();
        controller = undefined;
      };
      const closeJournal = async () => {
        if (!journal) return;
        await journal.close();
        journal = undefined;
      };
      const closeWorkspace = async () => {
        if (!workspace) return;
        await workspace.close();
        workspace = undefined;
      };
      t.after(async () => {
        const failures: unknown[] = [];
        if (controller) {
          try {
            diagnostics.finalSnapshot = await controller.snapshot();
          } catch (error) {
            failures.push(error);
          }
        }
        for (const close of [closeController, closeJournal, closeWorkspace]) {
          try {
            await close();
          } catch (error) {
            failures.push(error);
          }
        }
        diagnostics.teardownFailures = failures.map(String);
        try {
          await writeFile(join(root, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2));
        } catch (error) {
          failures.push(error);
        }
        if (failures.length)
          throw new AggregateError(failures, `Teardown failed, retained ${root}`);
      });
      await mkdir(journalDirectory, { mode: 0o700 });
      await mkdir(workspaceDirectory, { mode: 0o700 });
      const pinnedBase = await baseImage(root);
      diagnostics.pinnedBase = pinnedBase;
      const openWorkspace = async () => {
        assert.equal(workspace, undefined);
        workspace = await WorkspaceStore.open({
          directory: workspaceDirectory,
          regressionDirectory: virtualPath('regression'),
        });
        return workspace;
      };
      journal = await FrozenBrowserValidator.open({
        directory: journalDirectory,
        workspace: await openWorkspace(),
      });
      await closeJournal();
      journal = await FrozenBrowserValidator.open({
        directory: journalDirectory,
        workspace: workspace!,
        mode: 'journal-only',
      });
      const initialInventory = await journal.inventory();
      diagnostics.initialInventory = initialInventory;
      assert.equal(initialInventory.attempts, 0);
      assert.equal(initialInventory.contribution, 0);
      assert.deepEqual(initialInventory.runs, []);
      const binding = {
        directory: journalDirectory,
        ownerId: initialInventory.ownerId,
        configurationDigest: initialInventory.configurationDigest,
      };
      await closeJournal();
      await closeWorkspace();

      let callbackRequest: AdmittedCheckRequest | undefined;
      let selection: OfflineActionWorkspace['selection'] | undefined;
      let accepted: FrozenBrowserAcceptance | undefined;
      let consumed: FrozenBrowserConsumption | undefined;
      const options: Parameters<typeof Controller.open>[0] = {
        directory,
        policy: { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' },
        allowanceMs: 180000,
        offlineWorkspace: {
          repositoryId: repositoryId(randomUUID()),
          regressionDirectory: virtualPath('regression'),
          baseline: [
            {
              virtualPath: virtualPath('src/index.html'),
              bytes: Buffer.from(
                `<button id="run">Run</button><output id="result"></output><script>run.onclick=()=>result.textContent=${JSON.stringify(scenario.literal)}</script>`,
              ),
            },
          ],
        },
        offlineWorkerJournal: binding,
        offlineWorkerAcceptance: true,
        offlineWorkerConsumption: true,
        check: async (request, source) => {
          counters.callbacks++;
          assert.equal(request.kind, 'baseline');
          assert.ok(source?.workerAcceptance && source.workerConsumption);
          callbackRequest = request;
          selection = structuredClone(source.selection);
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
              counters.providerTurns++;
              counters.assessmentCalls++;
              const view = (await controller!.snapshot({ selected: id })).selected!;
              assert.equal(view.case.phase, 'triage');
              return fauxAssistantMessage(
                fauxToolCall('complete_assessment', {
                  phase: 'triage',
                  expectedControlVersion: view.case.version,
                  conclusion: 'progress',
                  reason: 'Investigate synthetic HTML only',
                  evidenceIds: [],
                }),
                { stopReason: 'toolUse' },
              );
            },
            () => {
              counters.providerTurns++;
              counters.baselineCalls++;
              return fauxAssistantMessage(fauxToolCall('run_check', { kind: 'baseline' }), {
                stopReason: 'toolUse',
              });
            },
            () => {
              counters.providerTurns++;
              return fauxAssistantMessage('Done');
            },
            () => {
              counters.providerTurns++;
              return assert.fail('Unexpected additional synthetic provider turn');
            },
          ]);
          return { provider: faux.provider, modelId: faux.getModel().id };
        },
        fault: (point) => {
          if (point === 'after-tool-action-receipt') counters.toolRetirements++;
          if (point === 'after-model-action-receipt') counters.modelRetirements++;
        },
      };
      controller = await Controller.open(options);
      const receipt = await controller.command({
        requestId: randomUUID(),
        intent: {
          type: 'investigate',
          issue: {
            ...options.policy,
            id: `synthetic-docker-${scenario.literal}`,
            title: `Synthetic HTML ${scenario.literal}`,
            priority: 'high',
            status: 'unresolved',
            regressed: false,
            escalating: false,
          },
        },
      });
      assert.equal(receipt.disposition, 'accepted');
      assert.ok(receipt.caseId);
      const id = receipt.caseId;
      diagnostics.caseId = id;
      const waitUntilRetired = async (): Promise<SelectedView> => {
        const deadline = Date.now() + 180000;
        while (true) {
          const view = (await controller!.snapshot({ selected: id })).selected!;
          diagnostics.lastSnapshot = view;
          if (
            view.case.status === 'needs-attention' &&
            view.case.accountedAt === null &&
            counters.toolRetirements === 2 &&
            counters.modelRetirements === scenario.providerTurns
          )
            return view;
          if (Date.now() >= deadline)
            return assert.fail(`Action retirement timed out, diagnostics retained at ${root}`);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      };
      const view = await waitUntilRetired();
      assert.equal(view.case.phase, 'investigation');
      assert.equal(
        view.case.reason,
        scenario.passed ? 'assessment-required' : 'baseline-not-reproduced-or-changed',
      );
      assert.equal(view.case.simulated, true);
      assert.equal(view.case.candidate, null);
      assert.equal(view.more, false);
      assert.deepEqual(counters, {
        providerTurns: scenario.providerTurns,
        assessmentCalls: 1,
        baselineCalls: 1,
        callbacks: 1,
        acceptances: 1,
        consumptions: 1,
        toolRetirements: 2,
        modelRetirements: scenario.providerTurns,
        reopenedProviderTurns: 0,
        reopenedCallbacks: 0,
      });
      assert.equal(view.checks.length, 1);
      const check = view.checks[0];
      assert.equal(check.simulated, false);
      if (check.simulated) return assert.fail('Real baseline receipt required');
      const real: RealBrowserCheck = check;
      assert.equal(real.kind, 'baseline');
      assert.equal(real.caseId, id);
      assert.equal(real.passed, scenario.passed);
      assert.equal(real.provenance.kind, 'frozen-browser-consumed-v1');
      assert.equal(real.provenance.outcome, scenario.outcome);
      assert.ok(callbackRequest && selection && accepted && consumed);

      const pins = controller.inspectWorkerExecutionFacts(id, real.actionId);
      diagnostics.executionPins = pins;
      assert.equal(pins.state, 'retained');
      if (pins.state !== 'retained') return assert.fail('Independent controller pins required');
      assert.equal(pins.provenance, 'controller-live-consumption');
      assert.deepEqual(pins.binding, { version: 1, ...binding });
      const request: FrozenBrowserRequest = pins.intent.request;
      const facts: ControllerWorkerExecutionFacts = pins.facts;
      const consumedRun: FrozenBrowserConsumedRunKey = facts.consumedRun;
      assert.equal(request.role, 'baseline');
      assert.equal(request.scenarioId, 'synthetic-click-v1');
      assert.deepEqual(request.frozen, selection);
      assert.deepEqual(request.action, {
        caseId: id,
        actionId: callbackRequest.actionId,
        epoch: callbackRequest.epoch,
      });
      assert.equal(real.actionId, request.action.actionId);
      assert.equal(request.frozen.caseId, id);
      assert.ok(request.allowanceMs > 30000 && request.allowanceMs <= 60000);
      assert.equal(pins.intent.requestDigest, digest(request));
      assert.equal(consumedRun.requestDigest, pins.intent.requestDigest);
      assert.equal(real.candidate, selection.revision);
      assert.equal(view.case.base, scenario.passed ? selection.revision : null);
      assert.equal(real.configuration, binding.configurationDigest);
      assert.deepEqual(real.provenance, {
        kind: 'frozen-browser-consumed-v1',
        epoch: request.action.epoch,
        ownerId: binding.ownerId,
        ...consumedRun,
        admittedAt: facts.admittedAt,
        deadline: facts.deadline,
        finishedAt: real.provenance.finishedAt,
        outcome: scenario.outcome,
      });

      const history = await controller.inspectWorkerConsumedHistory(id, real.actionId);
      diagnostics.history = history;
      assert.equal(history.state, 'consumed');
      if (history.state !== 'consumed') return assert.fail('Consumed history required');
      assert.deepEqual(history.independentExecutionPins, pins);
      assert.deepEqual(history.intent, pins.intent);
      assert.equal(history.acceptance.provenance, 'worker-journal');
      const acceptance = history.acceptance.value;
      assert.deepEqual(acceptance, accepted);
      assert.equal(acceptance.acceptanceId, consumedRun.acceptanceId);
      assert.deepEqual(acceptance.request, request);
      assert.equal(acceptance.requestDigest, pins.intent.requestDigest);
      assert.equal(acceptance.ownerId, binding.ownerId);
      assert.equal(acceptance.configurationDigest, binding.configurationDigest);
      assert.equal(acceptance.deadline, acceptance.acceptedAt + request.allowanceMs);
      assert.equal(history.history.provenance, 'worker-journal');
      const settled = history.history.value;
      assert.equal(settled.state, 'settled');
      if (settled.state !== 'settled') return assert.fail('Settled exact report required');
      assert.deepEqual(settled.consumedRun, consumedRun);
      assert.equal(settled.admittedAt, facts.admittedAt);
      assert.equal(settled.deadline, facts.deadline);
      assert.ok(facts.admittedAt >= acceptance.acceptedAt);
      assert.ok(facts.deadline > facts.admittedAt);
      assert.ok(facts.deadline <= facts.admittedAt + request.allowanceMs);
      assert.ok(facts.deadline <= callbackRequest.deadlineAt);
      const report = settled.report;
      assert.equal(report.runId, consumedRun.runId);
      assert.deepEqual(report.request, request);
      assert.deepEqual(report.outcome, { kind: scenario.outcome });
      assert.deepEqual(report.cleanup, { kind: 'owned-removed', cache: 'retained' });
      const evidence = report.evidence;
      assert.ok(evidence);
      assert.equal(evidence.observations.literal, scenario.literal);
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
      assert.equal(provenance.requestDigest, pins.intent.requestDigest);
      assert.equal(provenance.configurationDigest, binding.configurationDigest);
      assert.deepEqual(provenance.frozen, request.frozen);
      assert.equal(provenance.admittedAt, facts.admittedAt);
      assert.equal(provenance.deadline, facts.deadline);
      assert.equal(provenance.finishedAt, real.provenance.finishedAt);
      assert.ok(provenance.finishedAt >= facts.admittedAt);
      assert.ok(provenance.finishedAt <= facts.deadline);
      assert.equal(provenance.exitCode, 0);
      assert.equal(provenance.oomKilled, false);
      assert.equal(provenance.baseBefore.id, pinnedBase);
      assert.deepEqual(provenance.baseAfter, provenance.baseBefore);
      const admission = await controller.inspectWorkerConsumedAdmission(id, real.actionId);
      diagnostics.admission = admission;
      assert.equal(admission.state, 'consumed');
      if (admission.state !== 'consumed') return assert.fail('Consumed admission required');
      assert.equal(admission.conversion.state, 'converted');
      if (admission.conversion.state !== 'converted')
        return assert.fail('Accepted containment and conversion required');
      assert.equal(admission.conversion.admission.type, 'behavioral');

      assert.equal(view.artifacts.length, 1);
      const artifact = view.artifacts[0];
      assert.deepEqual(real.artifacts, [artifact.id]);
      assert.equal(artifact.caseId, id);
      assert.equal(artifact.actionId, real.actionId);
      assert.equal(artifact.checkId, real.id);
      assert.equal(artifact.revision, real.candidate);
      assert.equal(artifact.configuration, real.configuration);
      assert.equal(artifact.label, 'Frozen browser screenshot');
      assert.equal(artifact.mime, 'image/png');
      assert.equal(artifact.simulated, false);
      const retrieved = await controller.artifact(id, artifact.id);
      const bytes = validateOutput({ ...artifact, bytes: retrieved.bytes });
      assert.deepEqual(bytes, Buffer.from(evidence.png.base64, 'base64'));
      assert.equal(evidence.png.mime, 'image/png');
      assert.equal(bytes.length, artifact.size);
      assert.equal(bytes.length, evidence.png.size);
      assert.equal(checksum(bytes), artifact.sha256);
      assert.equal(checksum(bytes), evidence.png.sha256);
      const results = view.messages.filter((message) => message.kind === 'eitri.action-result');
      assert.equal(results.length, 2);
      assert.deepEqual(
        results.map((message) => message.data),
        [
          { actionId: (results[0].data as { actionId: string }).actionId, result: null },
          { actionId: real.actionId, result: real },
        ],
      );
      assert.notEqual((results[0].data as { actionId: string }).actionId, real.actionId);
      assert.ok(uuid((results[0].data as { actionId: string }).actionId));

      const readInventory = async (): Promise<RecoveryInventory> => {
        const store = await openWorkspace();
        journal = await FrozenBrowserValidator.open({
          directory: journalDirectory,
          workspace: store,
          mode: 'journal-only',
          expectedIdentity: {
            ownerId: binding.ownerId,
            configurationDigest: initialInventory.configurationDigest,
          },
        });
        const inventory = await journal.inventory();
        await closeJournal();
        await closeWorkspace();
        return inventory;
      };
      const inventory = await readInventory();
      diagnostics.inventory = inventory;
      assert.equal(inventory.ownerId, binding.ownerId);
      assert.equal(inventory.configurationDigest, binding.configurationDigest);
      assert.equal(inventory.attempts, 1);
      assert.equal(inventory.runs.length, 1);
      const record = inventory.runs[0];
      assert.ok('kind' in record && record.kind === 'offline-acceptance');
      if (!('kind' in record)) return assert.fail('Exactly one accepted and consumed run required');
      assert.equal(record.state, 'accepted');
      const { kind: _kind, state: _state, consumption: run, ...recordedAcceptance } = record;
      assert.deepEqual(recordedAcceptance, acceptance);
      assert.ok(run);
      assert.equal(run.state, 'settled');
      if (run.state !== 'settled') return assert.fail('No pending or recorded execution allowed');
      assert.equal(run.runId, consumedRun.runId);
      assert.deepEqual(run.request, request);
      assert.equal(run.requestDigest, pins.intent.requestDigest);
      assert.equal(run.configurationDigest, binding.configurationDigest);
      assert.equal(run.admittedAt, facts.admittedAt);
      assert.equal(run.deadline, facts.deadline);
      assert.equal(run.build, 'completed');
      assert.deepEqual(run.outcome, { kind: scenario.outcome });
      assert.deepEqual(run.cleanup, { kind: 'owned-removed', cache: 'retained' });
      assert.equal(run.image.kind, 'acquired');
      assert.equal(run.container.kind, 'acquired');
      if (run.image.kind !== 'acquired' || run.container.kind !== 'acquired')
        return assert.fail('Acquired resource IDs required');
      assert.equal(provenance.imageId, run.image.id);
      assert.equal(provenance.containerId, run.container.id);
      assert.equal(consumed.acceptanceId, consumedRun.acceptanceId);
      assert.deepEqual(consumed.run, run);
      await assertOwnedAbsent(root, binding.ownerId, run, pinnedBase);
      const savedCounters = { ...counters };
      await closeController();
      controller = await Controller.open({
        ...options,
        providerForCase: () => {
          const faux = fauxProvider();
          faux.setResponses([
            () => {
              counters.reopenedProviderTurns++;
              return assert.fail('Provider invoked after reopen');
            },
          ]);
          return { provider: faux.provider, modelId: faux.getModel().id };
        },
        check: async () => {
          counters.reopenedCallbacks++;
          return assert.fail('Check callback invoked after reopen');
        },
      });
      const reopened = (await controller.snapshot({ selected: id })).selected!;
      diagnostics.reopenedSnapshot = reopened;
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
      assert.deepEqual(
        await controller.inspectWorkerConsumedAdmission(id, real.actionId),
        admission,
      );
      assert.deepEqual(await readInventory(), inventory);
      await assertOwnedAbsent(root, binding.ownerId, run, pinnedBase);
      await closeController();
      assert.deepEqual(counters, savedCounters);
    },
  );
