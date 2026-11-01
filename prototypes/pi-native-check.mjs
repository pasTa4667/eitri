import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureFixtureApplicationInput } from '../src/fixture-profile-name.ts';
import { FrozenBrowserValidator } from '../src/frozen-browser.ts';
import { WorkspaceStore, virtualPath, repositoryId } from '../src/workspace.ts';
import { checksum, validateOutput } from '../src/artifacts.ts';
import { uuid } from '../src/domain.ts';
import { applicationVariant } from '../scripts/profile-reconciliation/application.mjs';

const scenario = 'fixture-profile-v1';
const exact = (value, keys) => assert.deepEqual(Object.keys(value).sort(), keys.sort());

// Fixed trusted recipe only; no path, command, patch or scenario comes from the model/CLI.
export async function prepareNativeCheck(
  store,
  directory = fileURLToPath(new URL('../../eitri-test-web-app', import.meta.url)),
) {
  const capture = await captureFixtureApplicationInput(directory);
  assert.equal(
    applicationVariant(
      scenario,
      capture.files.map((f) => ({
        path: f.virtualPath,
        size: f.size,
        sha256: f.sha256,
      })),
    ),
    'baseline-with-regressions',
  );
  const journalDirectory = join(store, 'worker-journal');
  const bootstrapDirectory = join(store, 'bootstrap');
  await mkdir(journalDirectory, { mode: 0o700 });
  await mkdir(bootstrapDirectory, { mode: 0o700 });
  const bootstrap = await WorkspaceStore.open({
    directory: bootstrapDirectory,
    regressionDirectory: virtualPath('regression'),
  });
  let journal;
  let inventory;
  try {
    const validator = await FrozenBrowserValidator.open({
      directory: journalDirectory,
      workspace: bootstrap,
    });
    await validator.close();
    journal = await FrozenBrowserValidator.open({
      directory: journalDirectory,
      workspace: bootstrap,
      mode: 'journal-only',
    });
    inventory = await journal.inventory();
  } finally {
    try {
      await journal?.close();
    } finally {
      await bootstrap.close();
    }
  }
  return {
    offlineWorkspace: {
      repositoryId: repositoryId(randomUUID()),
      regressionDirectory: virtualPath('regression'),
      workerScenarioId: scenario,
      baseline: capture.files.map(({ virtualPath, bytes }) => ({ virtualPath, bytes })),
    },
    offlineWorkerJournal: {
      directory: journalDirectory,
      ownerId: inventory.ownerId,
      configurationDigest: inventory.configurationDigest,
    },
    offlineWorkerAcceptance: true,
    offlineWorkerConsumption: true,
  };
}

export async function consumeNativeCheck(request, source) {
  assert.equal(request.kind, 'baseline');
  request.signal.throwIfAborted();
  assert.ok(source?.workerAcceptance && source?.workerConsumption);
  await source.workerAcceptance.accept();
  request.signal.throwIfAborted();
  const consumed = await source.workerConsumption.consume();
  request.signal.throwIfAborted();
  assert.equal(consumed.run.state, 'settled');
  assert.deepEqual(consumed.run.cleanup, { kind: 'owned-removed', cache: 'retained' });
  assert.equal(consumed.run.outcome.kind, 'baseline-reproduced');
  return { type: 'consumed-browser' };
}

// Shape/acknowledgement boundary only. Controller/native admission independently authenticates
// the worker history; a model's acknowledgement never certifies that tests actually ran.
export function validateNativeCheckResult(text) {
  assert.equal(typeof text, 'string');
  assert.ok(Buffer.byteLength(text) <= 32768);
  const value = JSON.parse(text);
  exact(value, [
    'id',
    'caseId',
    'actionId',
    'candidate',
    'configuration',
    'kind',
    'passed',
    'simulated',
    'artifacts',
    'provenance',
    'controlVersion',
  ]);
  for (const key of ['id', 'caseId', 'actionId']) assert.ok(uuid(value[key]));
  assert.match(value.candidate, /^[0-9a-f]{40,64}$/);
  assert.match(value.configuration, /^[0-9a-f]{64}$/);
  assert.equal(value.kind, 'baseline');
  assert.equal(value.passed, true);
  assert.equal(value.simulated, false);
  assert.ok(
    Array.isArray(value.artifacts) && value.artifacts.length === 1 && uuid(value.artifacts[0]),
  );
  assert.ok(Number.isSafeInteger(value.controlVersion) && value.controlVersion > 0);
  const p = value.provenance;
  exact(p, [
    'kind',
    'epoch',
    'ownerId',
    'acceptanceId',
    'runId',
    'requestDigest',
    'admittedAt',
    'deadline',
    'finishedAt',
    'outcome',
  ]);
  assert.equal(p.kind, 'frozen-browser-consumed-v1');
  assert.equal(p.outcome, 'baseline-reproduced');
  for (const key of ['ownerId', 'acceptanceId', 'runId']) assert.ok(uuid(p[key]));
  assert.match(p.requestDigest, /^[0-9a-f]{64}$/);
  for (const key of ['epoch', 'admittedAt', 'deadline', 'finishedAt'])
    assert.ok(Number.isSafeInteger(p[key]) && p[key] >= 0);
  assert.ok(p.admittedAt <= p.finishedAt && p.finishedAt <= p.deadline);
  return value.id;
}

export async function verifyNativeCheck(controller, selected) {
  assert.equal(selected.checks.length, 1);
  const check = selected.checks[0];
  validateNativeCheckResult(JSON.stringify({ ...check, controlVersion: selected.case.version }));
  assert.equal(check.caseId, selected.case.id);
  assert.equal(check.candidate, selected.case.base);
  const history = await controller.inspectWorkerConsumedHistory(check.caseId, check.actionId);
  assert.equal(history.state, 'consumed');
  assert.equal(history.history.value.state, 'settled');
  const report = history.history.value.report;
  assert.equal(report.request.scenarioId, scenario);
  assert.equal(report.request.frozen.revision, check.candidate);
  assert.equal(report.request.action.actionId, check.actionId);
  assert.equal(report.evidence.provenance.transfer.length, 28);
  assert.equal(report.evidence.observations.application.unit.numTotalTests, 35);
  assert.equal(report.evidence.observations.application.previewStopped, true);
  const artifact = selected.artifacts.find((a) => a.id === check.artifacts[0]);
  assert.ok(artifact && !artifact.simulated && artifact.revision === check.candidate);
  const { bytes } = await controller.artifact(check.caseId, artifact.id);
  validateOutput({ ...artifact, bytes });
  assert.equal(checksum(bytes), report.evidence.png.sha256);
  return { check, artifact, history };
}
