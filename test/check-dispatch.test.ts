import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import type { FauxResponseStep } from '@earendil-works/pi-ai/providers/faux';
import { Controller } from '../src/controller.ts';
import type {
  Action,
  AdmittedCheckRequest,
  Case,
  Check,
  CheckExecution,
  CheckResult,
} from '../src/domain.ts';

const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
const issue = {
  ...policy,
  id: 'dispatch',
  title: 'Admitted check',
  priority: 'high',
  status: 'unresolved',
  regressed: false,
  escalating: false,
} as const;
const checkCall = (kind: Check['kind'] = 'browser') =>
  fauxAssistantMessage(fauxToolCall('run_check', { kind }), { stopReason: 'toolUse' });
const receipt = (kind: Check['kind'] = 'browser'): CheckResult => ({
  kind,
  candidate: 'a'.repeat(40),
  configuration: 'b'.repeat(64),
  passed: true,
  simulated: true,
  outputs: [
    {
      label: 'Scripted observation',
      mime: 'text/plain',
      bytes: Buffer.from('Original observation.\n'),
    },
  ],
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function disposition(controller: Controller, id: string, status: Case['status']) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const selected = (await controller.snapshot({ selected: id })).selected!;
    if (selected.case.status === status) return selected;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`Case ${id} did not reach ${status}`);
}
async function checkSettlement(controller: Controller, id: string, type: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const selected = (await controller.snapshot({ selected: id })).selected!;
    if (
      selected.messages.some(
        (m) =>
          m.kind === 'eitri.action-result' &&
          (m.data as { result?: { type?: string } }).result?.type === type,
      )
    )
      return selected;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`Check ${type} did not settle`);
}

test('callback receives its actual admitted action and a frozen scalar request with the remaining action limit', async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-check-identity-')));
  const faux = fauxProvider({ tokensPerSecond: 100000 });
  let now = 1000;
  faux.setResponses([
    async () => {
      now += 250;
      return checkCall();
    },
    fauxAssistantMessage('Done'),
  ]);
  let admitted: Action | undefined;
  let request: AdmittedCheckRequest | undefined;
  const source = receipt();
  let mutateOnClock = false;
  const controller = await Controller.open({
    directory,
    policy,
    allowanceMs: 70000,
    clock: () => {
      if (mutateOnClock) {
        mutateOnClock = false;
        source.candidate = 'd'.repeat(40);
        source.passed = false;
        source.outputs[0].bytes.fill(120);
        source.outputs[0].label = 'Changed';
      }
      return now;
    },
    providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
    fault: (point) => {
      if (point === 'before-check-dispatch') now += 125;
    },
    check: async (input) => {
      request = input;
      const db = new DatabaseSync(join(directory, 'catalogue.sqlite'), { readOnly: true });
      try {
        admitted = JSON.parse(
          String(db.prepare('SELECT value FROM actions WHERE case_id=?').get(input.caseId)!.value),
        );
      } finally {
        db.close();
      }
      assert.equal(Object.isFrozen(input), true);
      assert.equal(Object.isFrozen(input.signal), false);
      for (const key of [
        'caseId',
        'actionId',
        'epoch',
        'kind',
        'deadlineAt',
        'remainingMs',
        'signal',
      ])
        assert.equal(Reflect.set(input, key, null), false);
      mutateOnClock = true;
      return { type: 'completed', check: source };
    },
  });
  t.after(async () => {
    await controller.close();
    await rm(directory, { recursive: true });
  });
  const command = await controller.command({
    requestId: randomUUID(),
    intent: { type: 'investigate', issue },
  });
  const selected = await disposition(controller, command.caseId!, 'needs-attention');
  assert.deepEqual(request && { ...request, signal: undefined }, {
    caseId: command.caseId,
    actionId: admitted!.id,
    epoch: admitted!.epoch,
    kind: 'browser',
    deadlineAt: 61250,
    remainingMs: 59875,
    signal: undefined,
  });
  assert.deepEqual(admitted, {
    id: request!.actionId,
    caseId: command.caseId,
    epoch: request!.epoch,
    kind: 'tool',
    startedAt: 1250,
    limitMs: 60000,
    usedAtStart: 250,
  });
  assert.equal(selected.case.reason, 'assessment-required');
  assert.equal(selected.case.remainingMs, 69625);
  assert.equal(selected.checks.length, 1);
  assert.equal(selected.checks[0].actionId, request!.actionId);
  assert.equal(selected.checks[0].candidate, 'a'.repeat(40));
  assert.equal(selected.checks[0].passed, true);
  assert.equal(selected.artifacts[0].label, 'Scripted observation');
  assert.deepEqual(
    (await controller.artifact(command.caseId!, selected.artifacts[0].id)).bytes,
    Buffer.from('Original observation.\n'),
  );
  assert.equal(source.candidate, 'd'.repeat(40));
  assert.equal(faux.state.callCount, 2);
});

test('capacity two dispatches separate requests and records only each owning case and action', async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-check-capacity-')));
  const requests: AdmittedCheckRequest[] = [];
  const entered = deferred<void>(),
    release = deferred<void>();
  const routes = new Map<string, ReturnType<typeof fauxProvider>>();
  const controller = await Controller.open({
    directory,
    policy,
    capacity: 2,
    providerForCase: (id) => {
      const faux = fauxProvider({ tokensPerSecond: 100000 });
      faux.setResponses([checkCall(), fauxAssistantMessage('Done')]);
      routes.set(id, faux);
      return { provider: faux.provider, modelId: faux.getModel().id };
    },
    check: async (request) => {
      requests.push(request);
      if (requests.length === 2) entered.resolve();
      await release.promise;
      const check = receipt(request.kind);
      check.candidate = (requests[0] === request ? 'a' : 'c').repeat(40);
      return { type: 'completed', check };
    },
  });
  t.after(async () => {
    release.resolve();
    await controller.close();
    await rm(directory, { recursive: true });
  });
  const first = await controller.command({
    requestId: randomUUID(),
    intent: { type: 'investigate', issue },
  });
  const second = await controller.command({
    requestId: randomUUID(),
    intent: { type: 'investigate', issue: { ...issue, id: 'second' } },
  });
  await entered.promise;
  assert.deepEqual(new Set(requests.map((r) => r.caseId)), new Set([first.caseId, second.caseId]));
  assert.equal(new Set(requests.map((r) => r.actionId)).size, 2);
  release.resolve();
  for (const [index, request] of requests.entries()) {
    const selected = await disposition(controller, request.caseId, 'needs-attention');
    assert.deepEqual(
      selected.checks.map((c) => [c.caseId, c.actionId, c.candidate]),
      [[request.caseId, request.actionId, (index === 0 ? 'a' : 'c').repeat(40)]],
    );
    assert.equal(selected.artifacts[0].actionId, request.actionId);
    assert.equal(selected.artifacts[0].caseId, request.caseId);
    assert.equal(routes.get(request.caseId)!.state.callCount, 2);
  }
});

for (const field of [
  'id',
  'caseId',
  'epoch',
  'kind',
  'startedAt',
  'limitMs',
  'usedAtStart',
  'expired',
] as const)
  test(`dispatch denies ${field} authority before callback effects`, async (t) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-check-denied-')));
    const faux = fauxProvider({ tokensPerSecond: 100000 });
    faux.setResponses([checkCall()]);
    let now = 1000,
      calls = 0;
    const controller = await Controller.open({
      directory,
      policy,
      clock: () => now,
      providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
      fault: (point, id) => {
        if (point !== 'before-check-dispatch') return;
        if (field === 'expired') {
          now += 60000;
          return;
        }
        const db = new DatabaseSync(join(directory, 'catalogue.sqlite'));
        try {
          const row = db.prepare('SELECT id,value FROM actions WHERE case_id=?').get(id)!;
          const action: Action = JSON.parse(String(row.value));
          const changed = {
            ...action,
            [field]:
              typeof action[field] === 'number'
                ? Number(action[field]) + 1
                : field === 'kind'
                  ? 'model'
                  : randomUUID(),
          };
          db.prepare('UPDATE actions SET value=? WHERE id=?').run(
            JSON.stringify(changed),
            String(row.id),
          );
        } finally {
          db.close();
        }
      },
      check: async () => {
        calls++;
        return { type: 'completed', check: receipt() };
      },
    });
    t.after(async () => {
      await controller.close();
      await rm(directory, { recursive: true });
    });
    const command = await controller.command({
      requestId: randomUUID(),
      intent: { type: 'investigate', issue },
    });
    const selected = await disposition(controller, command.caseId!, 'needs-attention');
    assert.equal(
      selected.case.reason,
      field === 'expired' ? 'check-allowance-exhausted' : 'model-error-or-dispatch-denied',
    );
    assert.equal(selected.case.phase, 'triage');
    assert.equal(selected.case.repairs, 0);
    assert.deepEqual(selected.checks, []);
    assert.deepEqual(selected.artifacts, []);
    assert.equal(calls, 0);
    assert.equal(faux.state.callCount, 1);
  });

const stops = [
  'infrastructure',
  'unrelated-failure',
  'cancelled',
  'uncertain',
  'cleanup-incomplete',
] as const;
for (const type of stops)
  for (const pause of [false, true])
    test(`${type} retains existing repair history${pause ? ' and pending pause' : ''} across restart`, async (t) => {
      const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-check-stop-')));
      const faux = fauxProvider({ tokensPerSecond: 100000 });
      let controller: Controller,
        revision = 0,
        callsAtStop = 0;
      let before: Case | undefined;
      const step: FauxResponseStep = async () => {
        const c = (await controller.snapshot()).cases[0];
        const checks = (await controller.snapshot({ selected: c.id })).selected!.checks;
        if (c.phase === 'triage' || (c.phase === 'investigation' && c.base))
          return fauxAssistantMessage(
            fauxToolCall('complete_assessment', {
              phase: c.phase,
              expectedControlVersion: c.version,
              conclusion: 'progress',
              reason: 'Scripted repair history',
              evidenceIds: checks.map((c) => c.id),
              proposal: 'Bounded proposal',
              paths: ['src/example.ts'],
            }),
            { stopReason: 'toolUse' },
          );
        return checkCall(
          c.phase === 'investigation'
            ? 'baseline'
            : !c.candidate || c.failedCandidate
              ? 'checkpoint'
              : 'regression',
        );
      };
      faux.setResponses(Array.from({ length: 20 }, () => step));
      controller = await Controller.open({
        directory,
        policy,
        providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
        check: async ({ caseId, kind }) => {
          const selected = (await controller.snapshot({ selected: caseId })).selected!;
          if (selected.checks.length === 5) {
            before = selected.case;
            callsAtStop = faux.state.callCount;
            if (pause)
              await controller.command({
                requestId: randomUUID(),
                intent: { type: 'pause', caseId },
              });
            return { type };
          }
          if (kind === 'checkpoint') revision++;
          return {
            type: 'completed',
            check: {
              ...receipt(kind),
              candidate: kind === 'baseline' ? 'a'.repeat(40) : String(revision).repeat(40),
              passed: kind !== 'regression',
              outputs: kind === 'baseline' ? receipt(kind).outputs : [],
            },
          };
        },
      });
      t.after(async () => {
        await controller.close();
        await rm(directory, { recursive: true });
      });
      const command = await controller.command({
        requestId: randomUUID(),
        intent: { type: 'investigate', issue },
      });
      const status = pause ? 'paused' : 'needs-attention';
      await disposition(controller, command.caseId!, status);
      const selected = await checkSettlement(controller, command.caseId!, type);
      const history = (c: Case) => ({
        phase: c.phase,
        base: c.base,
        candidate: c.candidate,
        failedCandidate: c.failedCandidate,
        repairs: c.repairs,
        attempt: c.attempt,
      });
      assert.deepEqual(history(before!), {
        phase: 'implementation',
        base: 'a'.repeat(40),
        candidate: '2'.repeat(40),
        failedCandidate: '2'.repeat(40),
        repairs: 1,
        attempt: 1,
      });
      assert.deepEqual(history(selected.case), history(before!));
      assert.equal(selected.case.reason, `check-${type}`);
      assert.equal(selected.checks.length, 5);
      assert.equal(selected.artifacts.length, 1);
      assert.equal(faux.state.callCount, callsAtStop);
      const owned = await controller.command({
        requestId: randomUUID(),
        intent: { type: 'investigate', issue },
      });
      assert.equal(owned.caseId, command.caseId);
      assert.equal(owned.disposition, 'existing');
      await controller.close();
      controller = await Controller.open({
        directory,
        policy,
        providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
        check: async () => {
          assert.fail('Stopped checks cannot replay');
        },
      });
      const recovered = (await controller.snapshot({ selected: command.caseId! })).selected!;
      assert.equal(recovered.case.status, status);
      assert.equal(recovered.case.reason, `check-${type}`);
      assert.deepEqual(history(recovered.case), history(before!));
      assert.deepEqual(recovered.checks, selected.checks);
      assert.deepEqual(recovered.artifacts, selected.artifacts);
      assert.equal(faux.state.callCount, callsAtStop);
    });

const malformed = [
  undefined,
  null,
  [],
  {},
  { type: 'other' },
  { type: 'completed' },
  { type: 'infrastructure', check: receipt() },
  { type: 'uncertain', observations: [] },
  { type: 'completed', check: { ...receipt(), kind: 'baseline' } },
  { type: 'completed', check: { ...receipt(), simulated: false } },
  { type: 'completed', check: { ...receipt(), passed: 'yes' } },
  { type: 'completed', check: { ...receipt(), candidate: 'unbound' } },
  { type: 'completed', check: { ...receipt(), configuration: 'unbound' } },
  { type: 'completed', check: { ...receipt(), artifacts: [] } },
  {
    type: 'completed',
    check: { ...receipt(), outputs: [{ ...receipt().outputs[0], checkId: randomUUID() }] },
  },
  {
    type: 'completed',
    check: { ...receipt(), outputs: [{ label: 'Bad bytes', mime: 'text/plain', bytes: [1] }] },
  },
  {
    type: 'completed',
    check: {
      ...receipt(),
      outputs: [{ label: 'Bad UTF8', mime: 'text/plain', bytes: Buffer.from([255]) }],
    },
  },
  {
    type: 'completed',
    check: { ...receipt(), outputs: Array.from({ length: 9 }, () => receipt().outputs[0]) },
  },
  {
    type: 'completed',
    check: {
      ...receipt(),
      outputs: [{ label: 'Large', mime: 'text/plain', bytes: Buffer.alloc(256 * 1024 + 1) }],
    },
  },
  { type: 'completed', check: { ...receipt(), outputs: Object.assign([], { length: 1 }) } },
  { type: 'infrastructure', [Symbol('extra')]: true },
  Object.defineProperty({ type: 'uncertain' }, 'check', { value: receipt() }),
  { type: 'completed', check: Object.defineProperty(receipt(), 'observations', { value: [] }) },
  {
    get type() {
      throw new Error('Untrusted getter');
    },
  },
];
for (const [index, value] of malformed.entries())
  test(`malformed callback result ${index} stops without evidence or speculative repair`, async (t) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-check-invalid-')));
    const faux = fauxProvider({ tokensPerSecond: 100000 });
    faux.setResponses([checkCall()]);
    const controller = await Controller.open({
      directory,
      policy,
      providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
      check: async () => value as CheckExecution,
    });
    t.after(async () => {
      await controller.close();
      await rm(directory, { recursive: true });
    });
    const command = await controller.command({
      requestId: randomUUID(),
      intent: { type: 'investigate', issue },
    });
    const selected = await disposition(controller, command.caseId!, 'needs-attention');
    assert.equal(selected.case.reason, 'invalid-check-execution');
    assert.equal(selected.case.phase, 'triage');
    assert.equal(selected.case.candidate, null);
    assert.equal(selected.case.failedCandidate, null);
    assert.equal(selected.case.repairs, 0);
    assert.deepEqual(selected.checks, []);
    assert.deepEqual(selected.artifacts, []);
    assert.equal(faux.state.callCount, 1);
  });

const failedReceipt = { ...receipt(), passed: false };
const malformedOwnKeys = [
  {
    name: 'comma-joined envelope key with inherited type and check',
    value: Object.assign(Object.create({ type: 'completed', check: failedReceipt }), {
      'check,type': true,
    }),
  },
  {
    name: 'inherited completed envelope keys',
    value: Object.create({ type: 'completed', check: failedReceipt }),
  },
  {
    name: 'extra comma-containing completed envelope key',
    value: { type: 'completed', check: failedReceipt, 'check,type': true },
  },
  {
    name: 'inherited non-behavior type with a comma-containing key',
    value: Object.assign(Object.create({ type: 'infrastructure' }), { 'type,': true }),
  },
  {
    name: 'extra comma-containing non-behavior key',
    value: { type: 'infrastructure', ',': true },
  },
  {
    name: 'comma-joined receipt key with inherited candidate and configuration',
    value: {
      type: 'completed',
      check: Object.assign(
        Object.create({
          candidate: failedReceipt.candidate,
          configuration: failedReceipt.configuration,
        }),
        {
          'candidate,configuration': true,
          kind: 'browser',
          outputs: failedReceipt.outputs,
          passed: false,
          simulated: true,
        },
      ),
    },
  },
  {
    name: 'extra comma-containing receipt key',
    value: { type: 'completed', check: { ...failedReceipt, 'candidate,configuration': true } },
  },
  {
    name: 'inherited receipt fields',
    value: { type: 'completed', check: Object.create(failedReceipt) },
  },
  {
    name: 'comma-joined output key with inherited bytes and label',
    value: {
      type: 'completed',
      check: {
        ...failedReceipt,
        outputs: [
          Object.assign(
            Object.create({ bytes: receipt().outputs[0].bytes, label: 'Inherited observation' }),
            { 'bytes,label': true, mime: 'text/plain' },
          ),
        ],
      },
    },
  },
  {
    name: 'extra comma-containing output key',
    value: {
      type: 'completed',
      check: {
        ...failedReceipt,
        outputs: [{ ...receipt().outputs[0], 'bytes,label': true }],
      },
    },
  },
  {
    name: 'inherited output fields',
    value: {
      type: 'completed',
      check: { ...failedReceipt, outputs: [Object.create(receipt().outputs[0])] },
    },
  },
  {
    name: 'symbol completed envelope key',
    value: { type: 'completed', check: failedReceipt, [Symbol('extra')]: true },
  },
  {
    name: 'symbol receipt key',
    value: { type: 'completed', check: { ...failedReceipt, [Symbol('extra')]: true } },
  },
  {
    name: 'symbol output key',
    value: {
      type: 'completed',
      check: {
        ...failedReceipt,
        outputs: [{ ...receipt().outputs[0], [Symbol('extra')]: true }],
      },
    },
  },
];
for (const { name, value } of malformedOwnKeys)
  test(`${name} stops without evidence or speculative repair`, async (t) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-check-own-keys-')));
    const faux = fauxProvider({ tokensPerSecond: 100000 });
    faux.setResponses([checkCall(), fauxAssistantMessage('Done')]);
    const controller = await Controller.open({
      directory,
      policy,
      providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
      check: async () => value as CheckExecution,
    });
    t.after(async () => {
      await controller.close();
      await rm(directory, { recursive: true });
    });
    const command = await controller.command({
      requestId: randomUUID(),
      intent: { type: 'investigate', issue },
    });
    const selected = await disposition(controller, command.caseId!, 'needs-attention');
    assert.deepEqual(
      {
        reason: selected.case.reason,
        phase: selected.case.phase,
        base: selected.case.base,
        candidate: selected.case.candidate,
        failedCandidate: selected.case.failedCandidate,
        repairs: selected.case.repairs,
      },
      {
        reason: 'invalid-check-execution',
        phase: 'triage',
        base: null,
        candidate: null,
        failedCandidate: null,
        repairs: 0,
      },
    );
    assert.deepEqual(selected.checks, []);
    assert.deepEqual(selected.artifacts, []);
    assert.equal(faux.state.callCount, 1);
  });

test('timed-out callback cannot change a completed result from a newer Retry epoch', async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-check-retry-epoch-')));
  const faux = fauxProvider({ tokensPerSecond: 100000 });
  faux.setResponses([checkCall(), checkCall(), fauxAssistantMessage('Done')]);
  const release = deferred<CheckExecution>();
  const returned = deferred<void>();
  const requests: AdmittedCheckRequest[] = [];
  const controller = await Controller.open({
    directory,
    policy,
    allowanceMs: 500,
    providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
    check: async (request) => {
      requests.push(request);
      if (requests.length === 1) {
        const result = await release.promise;
        returned.resolve();
        return result;
      }
      return {
        type: 'completed',
        check: {
          ...receipt(request.kind),
          candidate: 'c'.repeat(40),
          outputs: [
            {
              label: 'New epoch observation',
              mime: 'text/plain',
              bytes: Buffer.from('New epoch.\n'),
            },
          ],
        },
      };
    },
  });
  t.after(async () => {
    release.resolve({ type: 'completed', check: failedReceipt });
    await controller.close();
    await rm(directory, { recursive: true });
  });
  const command = await controller.command({
    requestId: randomUUID(),
    intent: { type: 'investigate', issue },
  });
  const stopped = await disposition(controller, command.caseId!, 'needs-attention');
  assert.equal(stopped.case.reason, 'check-allowance-exhausted');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].signal.aborted, true);
  assert.deepEqual(stopped.checks, []);
  assert.deepEqual(stopped.artifacts, []);
  await controller.command({
    requestId: randomUUID(),
    expectedControlVersion: stopped.case.version,
    intent: { type: 'retry', caseId: command.caseId!, note: 'Retry with fresh validation.' },
  });
  const newer = await disposition(controller, command.caseId!, 'needs-attention');
  assert.equal(requests.length, 2);
  assert.ok(requests[1].epoch > requests[0].epoch);
  assert.notEqual(requests[1].actionId, requests[0].actionId);
  assert.equal(newer.case.reason, 'assessment-required');
  assert.equal(newer.case.phase, 'triage');
  assert.equal(newer.case.base, null);
  assert.equal(newer.case.candidate, null);
  assert.equal(newer.case.failedCandidate, null);
  assert.equal(newer.case.repairs, 0);
  assert.equal(newer.case.attempt, 2);
  assert.equal(newer.checks.length, 1);
  assert.deepEqual(
    newer.checks.map((check) => ({
      caseId: check.caseId,
      actionId: check.actionId,
      candidate: check.candidate,
      passed: check.passed,
    })),
    [
      {
        caseId: command.caseId,
        actionId: requests[1].actionId,
        candidate: 'c'.repeat(40),
        passed: true,
      },
    ],
  );
  assert.equal(newer.artifacts.length, 1);
  assert.equal(newer.artifacts[0].caseId, command.caseId);
  assert.equal(newer.artifacts[0].actionId, requests[1].actionId);
  assert.equal(newer.artifacts[0].label, 'New epoch observation');
  release.resolve({ type: 'completed', check: failedReceipt });
  await returned.promise;
  await new Promise((r) => setImmediate(r));
  const after = (await controller.snapshot({ selected: command.caseId! })).selected!;
  assert.deepEqual(after.case, newer.case);
  assert.deepEqual(after.checks, newer.checks);
  assert.deepEqual(after.artifacts, newer.artifacts);
  assert.deepEqual(
    (await controller.artifact(command.caseId!, after.artifacts[0].id)).bytes,
    Buffer.from('New epoch.\n'),
  );
  assert.equal(faux.state.callCount, 3);
});

for (const mode of [
  'missing',
  'reject',
  'paused-reject',
  'expired-return',
  'paused-expired-return',
  'late',
  'paused-late',
] as const)
  test(`${mode} callback cannot admit evidence or override pause`, async (t) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-check-expiry-')));
    const faux = fauxProvider({ tokensPerSecond: 100000 });
    faux.setResponses([checkCall()]);
    const release = deferred<CheckExecution>();
    let now = 1000,
      calls = 0;
    let controller: Controller, request: AdmittedCheckRequest | undefined;
    controller = await Controller.open({
      directory,
      policy,
      ...(mode.includes('expired-return') ? { clock: () => now } : {}),
      allowanceMs: mode.includes('late') ? 500 : 70000,
      providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
      ...(mode === 'missing'
        ? {}
        : {
            check: async (input: AdmittedCheckRequest): Promise<CheckExecution> => {
              calls++;
              request = input;
              if (mode.startsWith('paused-'))
                await controller.command({
                  requestId: randomUUID(),
                  intent: { type: 'pause', caseId: input.caseId },
                });
              if (mode.includes('reject'))
                throw new Error('Arbitrary provider text must not persist');
              if (mode.includes('expired-return')) {
                now += 60000;
                return { type: 'completed', check: receipt() };
              }
              return release.promise;
            },
          }),
    });
    t.after(async () => {
      release.resolve({ type: 'completed', check: receipt() });
      await controller.close();
      await rm(directory, { recursive: true });
    });
    const command = await controller.command({
      requestId: randomUUID(),
      intent: { type: 'investigate', issue },
    });
    const selected = await disposition(
      controller,
      command.caseId!,
      mode.startsWith('paused-') ? 'paused' : 'needs-attention',
    );
    assert.equal(
      selected.case.reason,
      mode === 'missing'
        ? 'validation-not-configured'
        : mode.includes('reject')
          ? 'check-callback-failed'
          : 'check-allowance-exhausted',
    );
    if (mode.includes('late')) assert.equal(request!.signal.aborted, true);
    release.resolve({ type: 'completed', check: receipt() });
    await new Promise((r) => setImmediate(r));
    const after = (await controller.snapshot({ selected: command.caseId! })).selected!;
    assert.equal(after.case.status, selected.case.status);
    assert.equal(after.case.reason, selected.case.reason);
    assert.equal(after.case.phase, 'triage');
    assert.equal(after.case.failedCandidate, null);
    assert.equal(after.case.repairs, 0);
    assert.deepEqual(after.checks, []);
    assert.deepEqual(after.artifacts, []);
    assert.equal(calls, mode === 'missing' ? 0 : 1);
    assert.equal(faux.state.callCount, 1);
  });

for (const pause of [false, true])
  test(
    `SIGKILL after durable check stop before tool settlement${pause ? ' with pending pause' : ''} preserves disposition without replay`,
    { timeout: 15000 },
    async (t) => {
      const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-check-stop-kill-')));
      const child = fork(
        new URL('./check-dispatch-crash-worker.ts', import.meta.url),
        [directory, String(pause)],
        {
          env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        },
      );
      let errors = '',
        controller: Controller | undefined;
      child.stderr!.on('data', (chunk) => {
        errors += chunk.toString();
      });
      t.after(async () => {
        child.kill('SIGKILL');
        await controller?.close();
        await rm(directory, { recursive: true, force: true });
      });
      const message = await Promise.race([
        once(child, 'message').then(([message]) => message as { id: string; stage: string }),
        once(child, 'exit').then(() => {
          throw new Error(`Child exited early. ${errors}`);
        }),
      ]);
      assert.equal(message.stage, 'stop-persisted');
      const db = new DatabaseSync(join(directory, 'catalogue.sqlite'), { readOnly: true });
      try {
        const c: Case = JSON.parse(
          String(db.prepare('SELECT value FROM cases WHERE id=?').get(message.id)!.value),
        );
        assert.equal(c.status, pause ? 'pause-requested' : 'needs-attention');
        assert.equal(c.reason, 'check-infrastructure');
        assert.equal(
          db.prepare('SELECT COUNT(*) AS count FROM actions WHERE case_id=?').get(message.id)!
            .count,
          1,
        );
      } finally {
        db.close();
      }
      const exit = once(child, 'exit');
      child.kill('SIGKILL');
      await exit;
      const faux = fauxProvider();
      controller = await Controller.open({
        directory,
        policy,
        providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
        check: async () => {
          assert.fail('Durably stopped check must not replay');
        },
      });
      const selected = (await controller.snapshot({ selected: message.id })).selected!;
      assert.equal(selected.case.status, pause ? 'paused' : 'needs-attention');
      assert.equal(selected.case.reason, 'check-infrastructure');
      assert.equal(selected.case.phase, 'triage');
      assert.equal(selected.case.repairs, 0);
      assert.equal(selected.case.failedCandidate, null);
      assert.deepEqual(selected.checks, []);
      assert.deepEqual(selected.artifacts, []);
      assert.equal(selected.messages.filter((m) => m.kind === 'eitri.action-result').length, 0);
      assert.equal(faux.state.callCount, 0);
    },
  );

for (const passed of [true, false])
  test(`completed ${passed ? 'passing' : 'failing'} baseline retains ordinary checkpoint behavior during pending pause`, async (t) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-check-baseline-pause-')));
    const faux = fauxProvider({ tokensPerSecond: 100000 });
    faux.setResponses([checkCall('baseline')]);
    const controller = await Controller.open({
      directory,
      policy,
      providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
      check: async ({ caseId, kind }) => {
        await controller.command({ requestId: randomUUID(), intent: { type: 'pause', caseId } });
        return { type: 'completed', check: { ...receipt(kind), passed } };
      },
    });
    t.after(async () => {
      await controller.close();
      await rm(directory, { recursive: true });
    });
    const command = await controller.command({
      requestId: randomUUID(),
      intent: { type: 'investigate', issue },
    });
    const selected = await disposition(
      controller,
      command.caseId!,
      passed ? 'paused' : 'needs-attention',
    );
    assert.equal(selected.case.reason, passed ? '' : 'baseline-not-reproduced-or-changed');
    assert.equal(selected.case.base, passed ? 'a'.repeat(40) : null);
    assert.equal(selected.case.phase, 'triage');
    assert.equal(selected.case.repairs, 0);
    assert.equal(selected.checks.length, 1);
    assert.equal(selected.checks[0].passed, passed);
    assert.equal(selected.artifacts.length, 1);
    assert.equal(faux.state.callCount, 1);
  });

test('native write guard rejects expiry between callback admission and evidence persistence', async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-check-write-expiry-')));
  const faux = fauxProvider({ tokensPerSecond: 100000 });
  faux.setResponses([checkCall()]);
  let returned = false,
    readings = 0;
  const controller = await Controller.open({
    directory,
    policy,
    clock: () => (returned && ++readings >= 2 ? 61000 : 1000),
    providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
    check: async () => {
      returned = true;
      return { type: 'completed', check: receipt() };
    },
  });
  t.after(async () => {
    await controller.close();
    await rm(directory, { recursive: true });
  });
  const command = await controller.command({
    requestId: randomUUID(),
    intent: { type: 'investigate', issue },
  });
  const selected = await disposition(controller, command.caseId!, 'needs-attention');
  assert.equal(selected.case.reason, 'check-allowance-exhausted');
  assert.equal(selected.case.phase, 'triage');
  assert.equal(selected.case.repairs, 0);
  assert.deepEqual(selected.checks, []);
  assert.deepEqual(selected.artifacts, []);
  assert.equal(faux.state.callCount, 1);
});
