import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { nativeFixtureProvider, openNativeFixtureController } from './pi-native.mjs';

const [directory, mode, profileHome] = process.argv.slice(2);
const codexBoundary = /^codex-(refresh-response|provider-request)(-paused)?$/.exec(mode);
let helper;
let caseId;
let admission;
let firstActionId;
let requests = 0;
let terminalDelivered = false;
const boundaryMode = ['admission', 'terminal', 'model-receipt', 'committed-tool'].includes(mode);
const boundary = (request) => {
  process.send({
    id: caseId,
    stage: 'boundary',
    boundary: mode,
    helper,
    admission,
    firstActionId,
    toolCallId: request?.context.messages.find((m) => m.role === 'toolResult')?.toolCallId,
  });
};
const checkpoint = (id) => {
  caseId = id;
  process.send({
    id,
    stage: 'admitted',
    helper,
    admission,
    ...(codexBoundary ? { checkpoint: codexBoundary[1] } : {}),
  });
  if (mode !== 'paused-model') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};
const controller = await openNativeFixtureController({
  directory,
  ...(boundaryMode || mode.startsWith('orphan') || codexBoundary ? { clock: () => 1000 } : {}),
  policy: { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' },
  providerForCase: (id) =>
    nativeFixtureProvider(directory, id, [], {
      profileHome,
      ...(codexBoundary ? { fixture: 'codex-profile' } : {}),
      onCheckpoint: (point) => {
        if (point === codexBoundary?.[1]) {
          process.kill(helper.pid, 'SIGSTOP');
          checkpoint(id);
        }
      },
      before: async (request) => {
        admission = { actionId: request.actionId, epoch: request.epoch };
        firstActionId ??= request.actionId;
        caseId = id;
        requests++;
        if (mode === 'admission' || (mode === 'committed-tool' && requests === 2)) {
          boundary(request);
          await new Promise(() => {});
        }
        if (mode === 'model-receipt' || mode === 'orphan-paused' || codexBoundary?.[2])
          await controller.command({ requestId: randomUUID(), intent: { type: 'pause', caseId } });
        if (mode === 'paused-model') {
          checkpoint(id);
          await new Promise(() => {});
        }
      },
      onSpawn: (value) => {
        helper = value;
        if (mode.startsWith('orphan')) {
          process.kill(helper.pid, 'SIGSTOP');
          checkpoint(id);
        }
      },
      onEvent: (event) => {
        if (event.type === 'start' && mode === 'model') checkpoint(id);
      },
      afterTerminal: async (_request, { failed }) => {
        terminalDelivered = !failed;
        if (boundaryMode) assert.equal(terminalDelivered, true);
        if (mode === 'terminal') {
          boundary();
          await new Promise(() => {});
        }
      },
    }),
  probe: async (id) => {
    if (mode === 'committed-tool') return 'Native committed result café ✓';
    if (mode === 'tool-receipt') return 'Effect saved before SDK receipt';
    checkpoint(id);
    return new Promise(() => {});
  },
  fault: (point, id) => {
    if (mode === 'model-receipt' && point === 'after-model-action-receipt') {
      assert.equal(terminalDelivered, true);
      boundary();
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    }
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
