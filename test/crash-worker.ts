import { Controller } from '../src/controller.ts';
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import { randomUUID } from 'node:crypto';

const [directory, mode] = process.argv.slice(2);
const hold = () => new Promise<never>(() => {});
const controller = await Controller.open({
  directory,
  policy: { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' },
  providerForCase: (id) => {
    const faux = fauxProvider({ tokensPerSecond: 100000 });
    faux.setResponses([
      async () => {
        if (mode === 'model') {
          process.send?.({ stage: 'admitted', id });
          return hold();
        }
        return fauxAssistantMessage(fauxToolCall('probe', {}), { stopReason: 'toolUse' });
      },
    ]);
    return { provider: faux.provider, modelId: faux.getModel().id };
  },
  probe: async (id) => {
    if (mode === 'tool-receipt') return 'Effect saved before SDK receipt';
    process.send?.({ stage: 'admitted', id });
    return hold();
  },
  fault: (point, id) => {
    if (mode === 'tool-receipt' && point === 'after-tool-action-receipt') {
      process.send?.({ stage: 'admitted', id });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    }
  },
});
process.on('message', async (message) => {
  if (message === 'pause') {
    const c = (await controller.snapshot()).cases[0];
    await controller.command({ requestId: randomUUID(), intent: { type: 'pause', caseId: c.id } });
    process.send?.({ stage: 'pause-persisted', id: c.id });
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
      id: 'crashed',
      title: 'Crash recovery',
      priority: 'high',
      status: 'unresolved',
      regressed: false,
      escalating: false,
    },
  },
});
