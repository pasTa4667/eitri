import { Controller } from '../../src/controller.ts';
import { randomUUID } from 'node:crypto';
import { nativeFixtureProvider } from './pi-native.mjs';

const [directory, mode] = process.argv.slice(2);
let helper;
let caseId;
let admission;
const checkpoint = (id) => {
  caseId = id;
  process.send({ id, stage: 'admitted', helper, admission });
  if (mode !== 'paused-model') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};
const controller = await Controller.open({
  directory,
  policy: { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' },
  providerForCase: (id) =>
    nativeFixtureProvider(directory, id, [], {
      before: async (request) => {
        admission = { actionId: request.actionId, epoch: request.epoch };
        if (mode === 'paused-model') {
          checkpoint(id);
          await new Promise(() => {});
        }
      },
      onSpawn: (value) => {
        helper = value;
      },
      onEvent: (event) => {
        if (event.type === 'start' && mode === 'model') checkpoint(id);
      },
    }),
  probe: async (id) => {
    if (mode === 'tool-receipt') return 'Effect saved before SDK receipt';
    checkpoint(id);
    return new Promise(() => {});
  },
  fault: (point, id) => {
    if (mode === 'tool-receipt' && point === 'after-tool-action-receipt') checkpoint(id);
  },
});
process.on('message', async (message) => {
  if (message === 'pause') {
    await controller.command({ requestId: randomUUID(), intent: { type: 'pause', caseId } });
    process.send({ id: caseId, stage: 'pause-persisted' });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }
});
setInterval(() => {}, 1000);
await controller.command({
  requestId: randomUUID(),
  intent: {
    type: 'investigate',
    issue: {
      project: 'demo',
      environment: 'demo',
      repository: 'eitri-test-web-app',
      id: 'native-crash',
      title: 'Synthetic crash',
      priority: 'high',
      status: 'unresolved',
      regressed: false,
      escalating: false,
    },
  },
});
