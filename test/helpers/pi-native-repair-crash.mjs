import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { nativeFixtureProvider, openNativeFixtureController } from './pi-native.mjs';

const [directory] = process.argv.slice(2);
const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
let checkpoints = 0;
const controller = await openNativeFixtureController({
  directory,
  policy,
  clock: () => 1000,
  providerForCase: (id) =>
    nativeFixtureProvider(directory, id, [], {
      fixture: 'repair-budget',
      before: async (request) => {
        const selected = (await controller.snapshot({ selected: id })).selected;
        if (selected.case.repairs !== 2) return;
        assert.equal(selected.case.candidate, '3'.repeat(40));
        assert.equal(selected.case.failedCandidate, null);
        await controller.command({
          requestId: randomUUID(),
          intent: { type: 'pause', caseId: id },
        });
        process.send({ id, actionId: request.actionId, epoch: request.epoch });
        // Admission precedes spawn: no helper/resource exists at the kill boundary.
        await new Promise(() => {});
      },
    }),
  check: async ({ kind }) => {
    if (kind === 'checkpoint') checkpoints++;
    return {
      type: 'completed',
      check: {
        kind,
        candidate: kind === 'baseline' ? 'a'.repeat(40) : String(checkpoints).repeat(40),
        configuration: 'c'.repeat(64),
        passed: kind !== 'regression',
        simulated: true,
        outputs: [],
      },
    };
  },
});
setInterval(() => {}, 1000);
await controller.command({
  requestId: randomUUID(),
  intent: {
    type: 'investigate',
    issue: {
      ...policy,
      id: 'offline-repair-crash',
      title: 'Synthetic interrupted repair',
      priority: 'high',
      status: 'unresolved',
      regressed: false,
      escalating: false,
    },
  },
});
