import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import { Controller } from '../../src/controller.ts';
import type { WorkerConsumedHistoryObservation } from '../../src/controller.ts';
import type { Snapshot } from '../../src/domain.ts';
import { checksum, validateOutput } from '../../src/artifacts.ts';
import { captureFixtureApplicationInput } from '../../src/fixture-profile-name.ts';
import { FrozenBrowserValidator } from '../../src/frozen-browser.ts';
import type { FrozenBrowserReport } from '../../src/frozen-browser.ts';
import { repositoryId, sha256, virtualPath, WorkspaceStore } from '../../src/workspace.ts';

if (
  process.env.EITRI_FROZEN_DOCKER_ACCEPTANCE !== '1' ||
  !process.env.EITRI_APPLICATION_FIXTURE_DIRECTORY
)
  throw new Error(
    'Requires reviewed EITRI_FROZEN_DOCKER_ACCEPTANCE=1 and EITRI_APPLICATION_FIXTURE_DIRECTORY. No skips or substitutes.',
  );

for (const target of [
  {
    scenario: 'fixture-profile-v1' as const,
    path: 'src/lib/errors.js',
    before: "return user.profile.name?.trim() || 'Anonymous'",
    after: "return user?.profile?.name?.trim() || 'Anonymous'",
    units: 35,
  },
  {
    scenario: 'fixture-cart-v1' as const,
    path: 'src/lib/cart.js',
    before: 'return amounts.reduce((total, amount) => total + amount)',
    after: 'return amounts.reduce((total, amount) => total + amount, 0)',
    units: 32,
  },
])
  test(
    `${target.scenario}: controller freezes, reproduces, edits, validates and reopens full application`,
    { timeout: 240000 },
    async (t) => {
      const capture = await captureFixtureApplicationInput(
        process.env.EITRI_APPLICATION_FIXTURE_DIRECTORY!,
      );
      const root = await realpath(await mkdtemp(join(tmpdir(), 'eitri-controller-application-')));
      console.log(`Application evidence retained at ${root}`);
      t.diagnostic(root);
      const directory = join(root, 'controller');
      const journalDirectory = join(root, 'journal');
      const bootstrapDirectory = join(root, 'bootstrap');
      await mkdir(journalDirectory, { mode: 0o700 });
      await mkdir(bootstrapDirectory, { mode: 0o700 });
      const bootstrap = await WorkspaceStore.open({
        directory: bootstrapDirectory,
        regressionDirectory: virtualPath('regression'),
      });
      const validator = await FrozenBrowserValidator.open({
        directory: journalDirectory,
        workspace: bootstrap,
      });
      await validator.close();
      const journal = await FrozenBrowserValidator.open({
        directory: journalDirectory,
        workspace: bootstrap,
        mode: 'journal-only',
      });
      const inventory = await journal.inventory();
      await journal.close();
      await bootstrap.close();
      const binding = {
        directory: journalDirectory,
        ownerId: inventory.ownerId,
        configurationDigest: inventory.configurationDigest,
      };
      let controller: Controller | undefined;
      t.after(async () => controller?.close());
      const diagnostics: Record<string, unknown> = {
        root,
        captureDigest: capture.captureDigest,
        binding,
      };
      t.after(async () =>
        writeFile(join(root, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2)),
      );
      let turns = 0;
      let callbacks = 0;
      let edited = false;
      let browser = false;
      let baseRevision = '';
      let candidateRevision = '';
      const options: Parameters<typeof Controller.open>[0] = {
        directory,
        policy: { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' },
        allowanceMs: 180000,
        offlineWorkspace: {
          repositoryId: repositoryId(randomUUID()),
          regressionDirectory: virtualPath('regression'),
          workerScenarioId: target.scenario,
          baseline: capture.files.map(({ virtualPath, bytes }) => ({ virtualPath, bytes })),
        },
        offlineWorkerJournal: binding,
        offlineWorkerAcceptance: true,
        offlineWorkerConsumption: true,
        check: async (request, source) => {
          callbacks++;
          assert.ok(source);
          const selected = await source.readSelected();
          assert.equal(selected.length, 28);
          if (request.kind === 'checkpoint') {
            const file = selected.find((file) => file.virtualPath === target.path)!;
            const text = Buffer.from(file.bytes).toString('utf8');
            assert.equal(text.split(target.before).length, 2);
            const receipt = await source.edit(source.selection.revision, {
              virtualPath: virtualPath(target.path),
              expectedHash: sha256(checksum(file.bytes)),
              bytes: Buffer.from(text.replace(target.before, target.after)),
            });
            candidateRevision = receipt.checkpoint.revision;
            assert.notEqual(candidateRevision, source.selection.revision);
            assert.deepEqual(
              await source.readSelected(),
              selected,
              'Selected baseline remains frozen after brokered edit',
            );
            edited = true;
            return {
              type: 'completed',
              check: {
                kind: 'checkpoint',
                candidate: candidateRevision,
                configuration: binding.configurationDigest,
                passed: true,
                simulated: true,
                outputs: [],
              },
            };
          }
          assert.ok(source.workerAcceptance && source.workerConsumption);
          assert.ok(request.kind === 'baseline' || request.kind === 'browser');
          if (request.kind === 'baseline') baseRevision = source.selection.revision;
          else {
            assert.equal(source.selection.revision, candidateRevision);
            browser = true;
          }
          await source.workerAcceptance.accept();
          const consumed = await source.workerConsumption.consume();
          assert.equal(consumed.run.state, 'settled');
          if (consumed.run.state === 'settled') {
            assert.deepEqual(consumed.run.cleanup, { kind: 'owned-removed', cache: 'retained' });
            assert.equal(
              consumed.run.outcome.kind,
              request.kind === 'baseline' ? 'baseline-reproduced' : 'candidate-passed',
            );
          }
          return { type: 'consumed-browser' };
        },
        providerForCase: (id) => {
          const faux = fauxProvider({ tokensPerSecond: 100000 });
          const next = async () => {
            assert.ok(++turns <= 7, 'No hidden extra model turns');
            const view = (await controller!.snapshot({ selected: id })).selected!;
            const current = view.case;
            if (current.phase === 'triage' || (current.phase === 'investigation' && current.base))
              return fauxAssistantMessage(
                fauxToolCall('complete_assessment', {
                  phase: current.phase,
                  expectedControlVersion: current.version,
                  conclusion: 'progress',
                  reason: 'Scripted immutable application verification, not an AI fix',
                  evidenceIds: view.checks.map((check) => check.id),
                  proposal: 'Apply the reviewed one-line scripted patch',
                  paths: [target.path],
                }),
                { stopReason: 'toolUse' },
              );
            if (browser) return fauxAssistantMessage('Done; retain evidence without publication');
            return fauxAssistantMessage(
              fauxToolCall('run_check', {
                kind:
                  current.phase === 'investigation'
                    ? 'baseline'
                    : edited
                      ? 'browser'
                      : 'checkpoint',
              }),
              { stopReason: 'toolUse' },
            );
          };
          faux.setResponses(Array.from({ length: 8 }, () => next));
          return { provider: faux.provider, modelId: faux.getModel().id };
        },
      };
      controller = await Controller.open(options);
      const receipt = await controller.command({
        requestId: randomUUID(),
        intent: {
          type: 'investigate',
          issue: {
            ...options.policy,
            id: target.scenario,
            title: 'Scripted full-application validation',
            priority: 'high',
            status: 'unresolved',
            regressed: false,
            escalating: false,
          },
        },
      });
      const id = receipt.caseId!;
      const deadline = Date.now() + 180000;
      let view: NonNullable<Snapshot['selected']>;
      while (true) {
        view = (await controller.snapshot({ selected: id })).selected!;
        diagnostics.snapshot = view;
        if (view.case.status === 'needs-attention') break;
        assert.ok(Date.now() < deadline, `Timed out; retained ${root}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(view.case.reason, 'assessment-required');
      assert.equal(view.case.phase, 'implementation');
      assert.equal(view.case.simulated, true);
      assert.equal(callbacks, 3);
      assert.equal(view.case.base, baseRevision);
      assert.equal(view.case.candidate, candidateRevision);
      assert.notEqual(baseRevision, candidateRevision);
      assert.equal(view.checks.length, 3);
      assert.equal(view.artifacts.length, 2);
      const histories: Extract<WorkerConsumedHistoryObservation, { state: 'consumed' }>[] = [];
      for (const check of view.checks.filter((check) => !check.simulated)) {
        assert.equal(check.passed, true);
        const history: WorkerConsumedHistoryObservation =
          await controller.inspectWorkerConsumedHistory(id, check.actionId);
        assert.equal(history.state, 'consumed');
        if (history.state !== 'consumed' || history.history.value.state !== 'settled')
          return assert.fail('Settled history required');
        const report: FrozenBrowserReport = history.history.value.report;
        assert.ok(report.evidence);
        assert.equal(report.request.scenarioId, target.scenario);
        assert.equal(report.request.frozen.revision, check.candidate);
        assert.equal(report.evidence.provenance.transfer.length, 28);
        assert.equal(report.evidence.observations.stage, 'complete');
        const application = report.evidence.observations.application as {
          unit: { numTotalTests: number };
          browser: unknown;
          previewStopped: boolean;
          verdict: string;
        };
        assert.equal(application.unit.numTotalTests, target.units);
        assert.equal(application.previewStopped, true);
        assert.equal(application.verdict, 'passed');
        const artifact = view.artifacts.find((artifact) => artifact.id === check.artifacts[0])!;
        assert.equal(artifact.revision, check.candidate);
        const bytes: Uint8Array = (await controller.artifact(id, artifact.id)).bytes;
        validateOutput({ ...artifact, bytes });
        assert.equal(checksum(bytes), artifact.sha256);
        assert.equal(checksum(bytes), report.evidence.png.sha256);
        await writeFile(join(root, `${check.kind}.png`), bytes);
        const admission = await controller.inspectWorkerConsumedAdmission(id, check.actionId);
        assert.equal(admission.state, 'consumed');
        if (admission.state === 'consumed') assert.equal(admission.conversion.state, 'converted');
        histories.push(history);
      }
      assert.equal(histories.length, 2);
      diagnostics.histories = histories;
      const calls = { turns, callbacks };
      await controller.close();
      controller = undefined;
      controller = await Controller.open({
        ...options,
        providerForCase: () => {
          const faux = fauxProvider();
          faux.setResponses([() => assert.fail('No provider replay')]);
          return { provider: faux.provider, modelId: faux.getModel().id };
        },
        check: () => assert.fail('No check replay'),
      });
      const reopened = (await controller.snapshot({ selected: id })).selected!;
      assert.deepEqual(reopened.checks, view.checks);
      assert.deepEqual(reopened.artifacts, view.artifacts);
      for (const check of view.checks.filter((check) => !check.simulated)) {
        assert.deepEqual(
          await controller.inspectWorkerConsumedHistory(id, check.actionId),
          histories.find((history) => history.intent.request.action.actionId === check.actionId),
        );
        const artifact = view.artifacts.find((artifact) => artifact.id === check.artifacts[0])!;
        assert.equal(checksum((await controller.artifact(id, artifact.id)).bytes), artifact.sha256);
      }
      const docker = (args: string[]) =>
        execFileSync('docker', ['--context', 'orbstack', ...args], {
          encoding: 'utf8',
          timeout: 15000,
        }).trim();
      assert.equal(
        docker([
          'container',
          'ls',
          '-aq',
          '--filter',
          `label=eitri.frozen-browser.owner=${binding.ownerId}`,
        ]),
        '',
      );
      assert.equal(
        docker([
          'image',
          'ls',
          '-aq',
          '--filter',
          `label=eitri.frozen-browser.owner=${binding.ownerId}`,
        ]),
        '',
      );
      diagnostics.resourcesAbsent = true;
      assert.deepEqual({ turns, callbacks }, calls);
      assert.equal(
        (await captureFixtureApplicationInput(process.env.EITRI_APPLICATION_FIXTURE_DIRECTORY!))
          .captureDigest,
        capture.captureDigest,
      );
    },
  );
