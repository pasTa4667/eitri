import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate as turn } from 'node:timers/promises';
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import { Controller } from '../../src/controller.ts';
import { NativeCase } from '../../src/native.ts';
import type { DispatchedCheckExecution } from '../../src/native.ts';
import type { AdmittedCheckRequest, CheckExecution } from '../../src/domain.ts';

const mode = process.argv[2];
if (mode === 'uncaught-control') {
  const abort = new AbortController();
  abort.signal.addEventListener('abort', () => {
    throw new Error('deferred-abort-positive-control');
  });
  abort.abort();
  await turn();
  assert.fail('Deferred AbortSignal exception was not detected');
}
if (mode === 'hang-control') {
  console.log('hanging-interruption-positive-control');
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
assert.equal(mode, 'run-check');

const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-clock-abort-')));
let now = 1000;
const wakes: (() => void)[] = [];
let entered!: (request: AdmittedCheckRequest) => void;
const entry = new Promise<AdmittedCheckRequest>((resolve) => {
  entered = resolve;
});
let release!: (result: CheckExecution) => void;
const pending = new Promise<CheckExecution>((resolve) => {
  release = resolve;
});
let settled: DispatchedCheckExecution | undefined;
const metadata = NativeCase.prototype.metadata;
let wrapped = false;
NativeCase.prototype.metadata = async function () {
  if (!wrapped) {
    wrapped = true;
    const check = this.host.check;
    this.host.check = async (...args) => {
      const result = await check(...args);
      settled = result;
      return result;
    };
  }
  return metadata.call(this);
};
const faux = fauxProvider({ tokensPerSecond: 100000 });
faux.setResponses([
  fauxAssistantMessage(fauxToolCall('run_check', { kind: 'browser' }), {
    stopReason: 'toolUse',
  }),
]);
const controller = await Controller.open({
  directory,
  policy: { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' },
  providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
  clock: () => now,
  actionWakeup: (_delay, callback) => {
    wakes.push(callback);
    return () => {};
  },
  check: async (request) => {
    entered(request);
    return pending;
  },
});
try {
  await controller.command({
    requestId: randomUUID(),
    intent: {
      type: 'investigate',
      issue: {
        project: 'demo',
        environment: 'demo',
        repository: 'eitri-test-web-app',
        id: 'invalid-clock-abort',
        title: 'Invalid clock abort',
        priority: 'high',
        status: 'unresolved',
        regressed: false,
        escalating: false,
      },
    },
  });
  const request = await entry;
  now = -1;
  wakes.at(-1)!();
  await turn();
  await turn();
  assert.equal(request.signal.aborted, true);
  assert.deepEqual(settled, { type: 'uncertain' });
  assert.equal(now, -1);
  const view = (await controller.snapshot({ selected: request.caseId })).selected!;
  assert.equal(view.case.native, 'ready');
  assert.equal(view.case.usedMs, 0);
  assert.equal(view.case.remainingMs, 600000);
  assert.deepEqual(view.checks, []);
  assert.deepEqual(view.artifacts, []);
  assert.deepEqual(
    view.messages.filter((message) => message.kind === 'eitri.action-result'),
    [],
  );
  const db = new DatabaseSync(join(directory, 'catalogue.sqlite'), { readOnly: true });
  try {
    const retained = JSON.parse(
      String(db.prepare('SELECT value FROM actions WHERE id=?').get(request.actionId)!.value),
    );
    assert.equal(retained.caseId, request.caseId);
    assert.equal(retained.epoch, request.epoch);
    assert.equal(retained.kind, 'tool');
  } finally {
    db.close();
  }
  console.log(
    'run-check interruption settled with persistently invalid clock after event-loop turns',
  );
} finally {
  now = 1000;
  release({ type: 'infrastructure' });
  NativeCase.prototype.metadata = metadata;
  await controller.close();
  await rm(directory, { recursive: true, force: true });
}
