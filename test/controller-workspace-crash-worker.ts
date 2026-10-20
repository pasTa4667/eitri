import { randomUUID, createHash } from 'node:crypto';
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import type { FauxResponseStep } from '@earendil-works/pi-ai/providers/faux';
import { Controller } from '../src/controller.ts';
import { repositoryId, virtualPath, sha256 } from '../src/workspace.ts';

const [directory, point] = process.argv.slice(2);
const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
const implementation = [
  'workspace-after-intent',
  'workspace-after-commit',
  'workspace-after-checkpoint',
  'after-source-edit-effect',
].includes(point);
const faux = fauxProvider({ tokensPerSecond: 100000 });
let callbacks = 0;
const respond: FauxResponseStep = async () => {
  const c = (await controller.snapshot()).cases[0];
  const checks = (await controller.snapshot({ selected: c.id })).selected!.checks;
  if (implementation && (c.phase === 'triage' || (c.phase === 'investigation' && c.base)))
    return fauxAssistantMessage(
      fauxToolCall('complete_assessment', {
        phase: c.phase,
        expectedControlVersion: c.version,
        conclusion: 'progress',
        reason: 'Synthetic phase progression',
        evidenceIds: checks.map((c) => c.id),
        proposal: 'Edit synthetic value',
        paths: ['src/value.ts'],
      }),
      { stopReason: 'toolUse' },
    );
  return fauxAssistantMessage(
    fauxToolCall('run_check', {
      kind: implementation && c.phase === 'investigation' ? 'baseline' : 'browser',
    }),
    { stopReason: 'toolUse' },
  );
};
faux.setResponses(Array.from({ length: 20 }, () => respond));
const controller = await Controller.open({
  directory,
  policy,
  offlineWorkspace: {
    repositoryId: repositoryId('11111111-1111-4111-8111-111111111111'),
    regressionDirectory: virtualPath('regression'),
    baseline: [{ virtualPath: virtualPath('src/value.ts'), bytes: Buffer.from('literal A\n') }],
  },
  providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
  check: async (request, source) => {
    callbacks++;
    if (implementation && request.kind !== 'baseline')
      await source!.edit(source!.selection.revision, {
        virtualPath: virtualPath('src/value.ts'),
        expectedHash: sha256(createHash('sha256').update('literal A\n').digest('hex')),
        bytes: Buffer.from('literal B\n'),
      });
    return {
      type: 'completed',
      check: {
        kind: request.kind,
        candidate: 'a'.repeat(40),
        configuration: 'b'.repeat(64),
        passed: true,
        simulated: true,
        outputs: [],
      },
    };
  },
  fault: (actual, id) => {
    if (actual !== point) return;
    process.send?.({ id, point, callbacks });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  },
});
setInterval(() => {}, 1000);
await controller.command({
  requestId: randomUUID(),
  intent: {
    type: 'investigate',
    issue: {
      ...policy,
      id: 'offline-crash',
      title: 'Offline crash boundary',
      status: 'unresolved',
      priority: 'high',
      regressed: false,
      escalating: false,
    },
  },
});
