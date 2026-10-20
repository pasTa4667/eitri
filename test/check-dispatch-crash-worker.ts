import { randomUUID } from 'node:crypto';
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import { Controller } from '../src/controller.ts';

const [directory, pause] = process.argv.slice(2);
const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
const faux = fauxProvider({ tokensPerSecond: 100000 });
faux.setResponses([
  fauxAssistantMessage(fauxToolCall('run_check', { kind: 'browser' }), { stopReason: 'toolUse' }),
]);
const controller = await Controller.open({
  directory,
  policy,
  providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
  check: async ({ caseId }) => {
    if (pause === 'true')
      await controller.command({ requestId: randomUUID(), intent: { type: 'pause', caseId } });
    return { type: 'infrastructure' };
  },
  fault: (point, id) => {
    if (point !== 'after-check-stop') return;
    process.send?.({ stage: 'stop-persisted', id });
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
      id: 'check-stop-crash',
      title: 'Crash after durable stop',
      priority: 'high',
      status: 'unresolved',
      regressed: false,
      escalating: false,
    },
  },
});
