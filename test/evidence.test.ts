import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import type { FauxResponseStep } from '@earendil-works/pi-ai/providers/faux';
import { Controller } from '../src/controller.ts';
import type { Check, Case } from '../src/domain.ts';

const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
const issue = { ...policy, id: 'one', title: 'Scripted evidence', priority: 'high', status: 'unresolved', regressed: false, escalating: false } as const;
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
async function wait(controller: Controller, status: Case['status']) {
  const stop = Date.now() + 4000;
  while (true) { const c = (await controller.snapshot()).cases[0]; if (c.status === status) return c; if (Date.now() > stop) assert.fail(JSON.stringify(c)); await new Promise(r => setTimeout(r, 5)); }
}

test('pause during asynchronous auth is checked at the actual provider dispatch', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-auth-test-')));
  const entered = deferred(), release = deferred();
  const faux = fauxProvider({ tokensPerSecond: 100000 });
  const original = faux.provider.auth.apiKey!;
  const provider = { ...faux.provider, auth: { apiKey: { ...original, resolve: async (input: Parameters<typeof original.resolve>[0]) => {
    entered.resolve(); await release.promise; return original.resolve(input);
  } } } };
  const controller = await Controller.open({ directory, policy, providerForCase: () => ({ provider, modelId: faux.getModel().id }) });
  t.after(async () => { release.resolve(); await controller.close(); await rm(directory, { recursive: true }); });
  const receipt = await controller.command({ requestId: randomUUID(), intent: { type: 'investigate', issue } });
  await entered.promise;
  await controller.command({ requestId: randomUUID(), intent: { type: 'pause', caseId: receipt.caseId } });
  release.resolve(); await wait(controller, 'paused');
  assert.equal(faux.state.callCount, 0);
});

test('auth waiting is bounded by the allowance and cannot dispatch after timeout', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-timeout-test-')));
  const release = deferred(); const faux = fauxProvider(); const original = faux.provider.auth.apiKey!;
  const provider = { ...faux.provider, auth: { apiKey: { ...original, resolve: async (input: Parameters<typeof original.resolve>[0]) => { await release.promise; return original.resolve(input); } } } };
  const controller = await Controller.open({ directory, policy, allowanceMs: 30, providerForCase: () => ({ provider, modelId: faux.getModel().id }) });
  t.after(async () => { release.resolve(); await controller.close(); await rm(directory, { recursive: true }); });
  await controller.command({ requestId: randomUUID(), intent: { type: 'investigate', issue } });
  const c = await wait(controller, 'needs-attention');
  assert.equal(c.remainingMs, 0); assert.equal(faux.state.callCount, 0);
  release.resolve(); await new Promise(r => setTimeout(r, 20));
  assert.equal(faux.state.callCount, 0);
});

for (const stale of [false, true]) test(`revision-bound scripted checks ${stale ? 'reject a stale green result' : 'reach but cannot bypass publication gating'}`, async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-evidence-test-')));
  const faux = fauxProvider({ tokensPerSecond: 100000 });
  const base = 'a'.repeat(40), candidate = 'b'.repeat(40), config = 'c'.repeat(64);
  let controller: Controller;
  const step: FauxResponseStep = async () => {
    const c = (await controller.snapshot()).cases[0];
    const messages = (await controller.snapshot({ selected: c.id })).selected!.messages;
    const checks = messages.filter(m => m.kind === 'eitri.check').map(m => m.data as Check);
    const required: Check['kind'][] = c.phase === 'investigation' ? ['baseline'] : c.phase === 'implementation' ? ['checkpoint', 'regression'] : c.phase === 'testing' ? ['unit', 'build', 'browser'] : [];
    const next = required.find(kind => !checks.some(check => check.kind === kind));
    if (next) return fauxAssistantMessage(fauxToolCall('run_check', { kind: next }), { stopReason: 'toolUse' });
    return fauxAssistantMessage(fauxToolCall('complete_assessment', {
      phase: c.phase, expectedControlVersion: c.version, conclusion: 'progress', reason: 'Scripted fixture observations, not a live model fix',
      evidenceIds: checks.map(check => check.id), proposal: 'Bounded scripted proposal', paths: ['src/example.ts'],
      ...(c.candidate ? { candidate: c.candidate } : {}),
    }), { stopReason: 'toolUse' });
  };
  faux.setResponses(Array.from({ length: 25 }, () => step));
  controller = await Controller.open({ directory, policy,
    providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
    check: async (_id, kind) => ({ kind, candidate: kind === 'baseline' ? base : stale && kind === 'regression' ? 'd'.repeat(40) : candidate, configuration: config, passed: true, simulated: true, artifacts: kind === 'browser' ? [randomUUID()] : [] }),
  });
  t.after(async () => { await controller.close(); await rm(directory, { recursive: true }); });
  await controller.command({ requestId: randomUUID(), intent: { type: 'investigate', issue } });
  const c = await wait(controller, 'needs-attention');
  assert.equal(c.phase, stale ? 'implementation' : 'publication');
  assert.equal(c.candidate, candidate); assert.equal(c.base, base); assert.equal(c.simulated, true);
  assert.ok(faux.state.callCount < 25);
});

test('initial failed validation permits two repair candidates, not two arbitrary check failures', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-repair-test-')));
  const faux = fauxProvider({ tokensPerSecond: 100000 });
  let controller: Controller, revision = 0;
  const step: FauxResponseStep = async () => {
    const c = (await controller.snapshot()).cases[0];
    const checks = (await controller.snapshot({ selected: c.id })).selected!.messages.filter(m => m.kind === 'eitri.check').map(m => m.data as Check);
    if (c.phase === 'triage' || (c.phase === 'investigation' && c.base)) return fauxAssistantMessage(fauxToolCall('complete_assessment', {
      phase: c.phase, expectedControlVersion: c.version, conclusion: 'progress', reason: 'Scripted repair exercise',
      evidenceIds: checks.map(check => check.id), proposal: 'Bounded proposal', paths: ['src/example.ts'],
    }), { stopReason: 'toolUse' });
    const kind = c.phase === 'investigation' ? 'baseline' : !c.candidate || c.failedCandidate ? 'checkpoint' : 'regression';
    return fauxAssistantMessage(fauxToolCall('run_check', { kind }), { stopReason: 'toolUse' });
  };
  faux.setResponses(Array.from({ length: 25 }, () => step));
  controller = await Controller.open({ directory, policy, providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
    check: async (_id, kind) => {
      if (kind === 'checkpoint') revision++;
      return { kind, candidate: kind === 'baseline' ? 'a'.repeat(40) : String(revision).repeat(40), configuration: 'c'.repeat(64), passed: kind !== 'regression', simulated: true, artifacts: [] };
    },
  });
  t.after(async () => { await controller.close(); await rm(directory, { recursive: true }); });
  await controller.command({ requestId: randomUUID(), intent: { type: 'investigate', issue } });
  const c = await wait(controller, 'needs-attention');
  assert.equal(c.repairs, 2); assert.equal(revision, 3); assert.equal(c.reason, 'repair-budget-exhausted');
  assert.ok(faux.state.callCount < 25);
});
