import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerExecutionScope } from '../src/worker-execution-scope.ts';
import { ControlError, digest } from '../src/domain.ts';
import { frozenBrowserRequest } from '../src/frozen-browser.ts';
import type { FrozenBrowserAcceptance, FrozenBrowserConsumption } from '../src/frozen-browser.ts';
import { sha256 } from '../src/workspace.ts';

const request = frozenBrowserRequest({
  frozen: {
    caseId: '11111111-1111-4111-8111-111111111111',
    revision: 'a'.repeat(40),
    manifestDigest: 'b'.repeat(64),
  },
  action: {
    caseId: '11111111-1111-4111-8111-111111111111',
    actionId: '22222222-2222-4222-8222-222222222222',
    epoch: 1,
  },
  scenarioId: 'synthetic-click-v1',
  role: 'baseline',
  allowanceMs: 1000,
});
const accepted: FrozenBrowserAcceptance = {
  acceptanceId: '33333333-3333-4333-8333-333333333333',
  request,
  requestDigest: sha256(digest(request)),
  configurationDigest: sha256('c'.repeat(64)),
  ownerId: '44444444-4444-4444-8444-444444444444',
  acceptedAt: 1000,
  deadline: 2000,
};
const result: FrozenBrowserConsumption = {
  acceptanceId: accepted.acceptanceId,
  run: {
    runId: '55555555-5555-4555-8555-555555555555',
    request,
    requestDigest: accepted.requestDigest,
    configurationDigest: accepted.configurationDigest,
    admittedAt: 3000,
    deadline: 3500,
    state: 'recorded',
    outcome: { kind: 'uncertain', code: 'scripted-result' },
    cleanup: 'unresolved',
    build: 'not-started',
    image: { kind: 'none' },
    container: { kind: 'none' },
  },
};

test('WorkerExecutionScope shares execution and synchronous detached retention before delivery', async () => {
  let consumes = 0;
  let closes = 0;
  const retained: unknown[] = [];
  const scope = new WorkerExecutionScope(
    request,
    async () => ({
      accept: async () => structuredClone(accepted),
      consume: async (a) => {
        consumes++;
        Object.assign(a, { acceptanceId: 'mutated-by-journal' });
        return structuredClone(result);
      },
      inventory: async () => ({
        ownerId: accepted.ownerId,
        configurationDigest: accepted.configurationDigest,
        attempts: 0,
        contribution: 0,
        runs: [],
      }),
      close: async () => {
        closes++;
      },
    }),
    () => 1000,
    (a, r) => {
      retained.push(structuredClone({ a, r }));
      Object.assign(a, { acceptanceId: 'mutated-by-retention' });
      Object.assign(r.run, { deadline: 0 });
    },
  );
  await scope.accept();
  const results = await Promise.all([scope.consume(), scope.consume(), scope.consume()]);
  assert.deepEqual(retained, [{ a: accepted, r: result }]);
  assert.deepEqual(results, [result, result, result]);
  Object.assign(results[0].run, { deadline: 1 });
  assert.deepEqual(await scope.consume(), result);
  assert.deepEqual(await scope.accept(), accepted);
  await scope.close();
  assert.equal(consumes, 1);
  assert.equal(closes, 1);
});

for (const code of [
  'action-source-revoked',
  'check-dispatch-denied',
  'check-allowance-exhausted',
  'check-cancelled',
])
  test(`WorkerExecutionScope does not turn expected opening revocation ${code} into failed drainage`, async () => {
    const scope = new WorkerExecutionScope(
      request,
      async () => {
        throw new ControlError(code);
      },
      () => 1000,
      () => {
        throw Error('unexpected-retention');
      },
    );
    await assert.rejects(scope.accept(), new RegExp(code));
    await scope.close();
    assert.equal(scope.signal.aborted, true);
  });

test('WorkerExecutionScope still reports a real journal opening failure during drainage', async () => {
  const scope = new WorkerExecutionScope(
    request,
    async () => {
      throw Error('scripted-open-failure');
    },
    () => 1000,
    () => {
      throw Error('unexpected-retention');
    },
  );
  await assert.rejects(scope.accept(), /scripted-open-failure/);
  await assert.rejects(scope.close(), /scripted-open-failure/);
});

test('WorkerExecutionScope caches retention failure and closes its journal before rejecting repeated drainage', async () => {
  let consumes = 0;
  let retentions = 0;
  let closes = 0;
  const scope = new WorkerExecutionScope(
    request,
    async () => ({
      accept: async () => structuredClone(accepted),
      consume: async () => {
        consumes++;
        return structuredClone(result);
      },
      inventory: async () => ({
        ownerId: accepted.ownerId,
        configurationDigest: accepted.configurationDigest,
        attempts: 0,
        contribution: 0,
        runs: [],
      }),
      close: async () => {
        closes++;
      },
    }),
    () => 1000,
    () => {
      retentions++;
      throw Error('scripted-retention-failure');
    },
  );
  await scope.accept();
  await assert.rejects(
    Promise.all([scope.consume(), scope.consume()]),
    /scripted-retention-failure/,
  );
  await assert.rejects(scope.consume(), /scripted-retention-failure/);
  const closing = scope.close();
  assert.equal(scope.close(), closing);
  await assert.rejects(closing, /scripted-retention-failure/);
  assert.deepEqual({ consumes, retentions, closes }, { consumes: 1, retentions: 1, closes: 1 });
});
