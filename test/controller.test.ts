import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath, lstat, unlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import type { FauxProviderHandle, FauxResponseStep } from '@earendil-works/pi-ai/providers/faux';
import { Controller } from '../src/controller.ts';
import type { Case, Check, Intent, Issue } from '../src/domain.ts';

const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
const issue = (id = 'one'): Issue => ({ ...policy, id, title: id, priority: 'high', status: 'unresolved', regressed: false, escalating: false });
const command = (intent: Intent, expectedControlVersion?: number) => ({ requestId: randomUUID(), expectedControlVersion, intent });
const gate = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeout = 5000): Promise<T> {
  const stop = Date.now() + timeout;
  while (true) { const value = await read(); if (predicate(value)) return value; if (Date.now() >= stop) assert.fail(`Timed out: ${JSON.stringify(value)}`); await new Promise(r => setTimeout(r, 5)); }
}
const phaseResult = (c: Case, conclusion: 'progress' | 'no-fix' | 'attention', extra = {}) => fauxAssistantMessage(fauxToolCall('complete_assessment', {
  phase: c.phase, expectedControlVersion: c.version, conclusion, reason: 'Observed scripted assessment', evidenceIds: [], ...extra,
}), { stopReason: 'toolUse' });

async function fixture(t: test.TestContext, extra: Partial<Parameters<typeof Controller.open>[0]> = {}, script?: (id: string) => FauxResponseStep[]) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-core-test-')));
  const providers = new Map<string, FauxProviderHandle>();
  const options = { directory, policy, providerForCase: (id: string) => {
    let faux = providers.get(id);
    if (!faux) { faux = fauxProvider({ tokensPerSecond: 100000 }); faux.setResponses(script?.(id) ?? [fauxAssistantMessage('Scripted model cannot complete this phase.')]); providers.set(id, faux); }
    return { provider: faux.provider, modelId: faux.getModel().id };
  }, ...extra };
  let controller = await Controller.open(options);
  t.after(async () => { await controller.close(); await rm(directory, { recursive: true, force: true }); });
  const current = async (id: string) => (await controller.snapshot()).cases.find(c => c.id === id)!;
  return {
    get controller() { return controller; }, directory, providers, current, options,
    async restart() { await controller.close(); controller = await Controller.open(options); },
    async add(id = 'one') { return (await controller.command(command({ type: 'investigate', issue: issue(id) }))).caseId!; },
    async wait(id: string, status: Case['status']) { return until(() => current(id), c => c.status === status); },
  };
}

test('atomic ownership, durable request receipts, policy checks and compact catalogue', async t => {
  const f = await fixture(t);
  const input = command({ type: 'investigate', issue: issue() });
  const results = await Promise.all(Array.from({ length: 12 }, (_, n) => f.controller.command(n % 2 ? input : command({ type: 'investigate', issue: issue() }))));
  assert.equal(new Set(results.map(r => r.caseId)).size, 1);
  assert.equal((await f.controller.snapshot()).cases.length, 1);
  assert.deepEqual(await f.controller.command(input), results[1]);
  await assert.rejects(f.controller.command({ ...input, intent: { type: 'check-now' } }), { code: 'request-id-conflict' });
  await assert.rejects(f.controller.command(command({ type: 'investigate', issue: { ...issue('bad'), project: 'outside' } })), { code: 'issue-policy-denied' });
  await f.wait(results[0].caseId!, 'needs-attention');
  assert.equal(f.providers.get(results[0].caseId!)!.state.callCount, 1);
  const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
  try {
    const receipts = db.prepare('SELECT value FROM receipts').all();
    assert.ok(receipts.every(row => Object.keys(JSON.parse(String(row.value))).sort().join(',') === 'caseId,disposition,requestId,version'));
  } finally { db.close(); }
  assert.equal((await lstat(f.directory)).mode & 0o777, 0o700);
  assert.equal((await lstat(join(f.directory, 'catalogue.sqlite'))).mode & 0o777, 0o600);
});

test('pause lets an admitted tool finish, denies follow-up inference, and releases capacity', async t => {
  const entered = gate(), finish = gate(); let executions = 0;
  const f = await fixture(t, { probe: async () => { executions++; entered.resolve(); await finish.promise; return 'Saved tool result'; } }, () => [
    fauxAssistantMessage(fauxToolCall('probe', {}), { stopReason: 'toolUse' }), fauxAssistantMessage('Must not be called until continued'),
  ]);
  const a = await f.add('A'); await entered.promise;
  const b = await f.add('B');
  const paused = await f.controller.command(command({ type: 'pause', caseId: a }));
  assert.equal((await f.current(a)).status, 'pause-requested');
  assert.equal((await f.current(b)).status, 'queued');
  finish.resolve(); await f.wait(a, 'paused'); await f.wait(b, 'needs-attention');
  assert.equal(f.providers.get(a)!.state.callCount, 1);
  assert.equal(executions, 2);
  assert.ok((await f.controller.snapshot({ selected: a })).selected!.messages.some(m => JSON.stringify(m.data).includes('Saved tool result')));
  const c = await f.current(a);
  await assert.rejects(f.controller.command(command({ type: 'continue', caseId: a }, paused.version! - 1)), { code: 'stale-control-version' });
  const used = c.usedMs;
  await f.controller.command(command({ type: 'continue', caseId: a }, c.version));
  const done = await f.wait(a, 'needs-attention');
  assert.equal(done.attempt, 1); assert.ok(done.usedMs >= used);
});

test('pause during model auth/response denies the next tool and native SDK follow-up', async t => {
  const entered = gate(), finish = gate(); let executions = 0;
  const f = await fixture(t, { probe: async () => { executions++; return 'forbidden'; } }, () => [async () => {
    entered.resolve(); await finish.promise; return fauxAssistantMessage(fauxToolCall('probe', {}), { stopReason: 'toolUse' });
  }]);
  const id = await f.add(); await entered.promise;
  await f.controller.command(command({ type: 'pause', caseId: id })); finish.resolve();
  await f.wait(id, 'paused'); assert.equal(executions, 0); assert.equal(f.providers.get(id)!.state.callCount, 1);
});

test('parked notes, duplicate delivery, views, reconnect watches and restart never infer', async t => {
  let crash = false;
  const f = await fixture(t, { fault: point => { if (crash && point === 'after-note-delivery') { crash = false; throw new Error('delivery seam crash'); } } });
  const id = await f.add(); await f.wait(id, 'needs-attention');
  const input = command({ type: 'post-message', caseId: id, text: 'Unique passive note 🔨' });
  crash = true; await assert.rejects(f.controller.command(input), /delivery seam crash/);
  await f.restart();
  const receipts = await Promise.all([f.controller.command(input), f.controller.command(input)]);
  assert.deepEqual(receipts[0], receipts[1]);
  for (let n = 0; n < 4; n++) {
    const stop = f.controller.watch({ selected: id }, () => {});
    await f.controller.snapshot({ selected: id }); stop();
  }
  const view = (await f.controller.snapshot({ selected: id })).selected!;
  assert.equal(view.messages.filter(m => m.kind === 'eitri.note').length, 1);
  assert.equal(f.providers.get(id)!.state.callCount, 1);
  const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM deliveries').get()!.n, 0); db.close();
});

test('interrupted provisioning recovers the same owner and native file', async t => {
  let interrupted = true;
  const f = await fixture(t, { fault: point => { if (point === 'after-native-provision' && interrupted) { interrupted = false; throw new Error('provisioning seam crash'); } } });
  const input = command({ type: 'investigate', issue: issue() });
  await assert.rejects(f.controller.command(input), /provisioning seam crash/);
  const before = (await f.controller.snapshot()).cases[0]; assert.equal(before.native, 'provisioning');
  await f.restart();
  const receipt = await f.controller.command(input);
  assert.equal(receipt.caseId, before.id); await f.wait(before.id, 'needs-attention');
  assert.equal((await readdir(join(f.directory, 'cases'))).length, 1);
  assert.equal(f.providers.get(before.id)!.state.callCount, 1);
});

test('structured triage can advance; a stale completion cannot advance or use a phase setter', async t => {
  let f: Awaited<ReturnType<typeof fixture>>;
  f = await fixture(t, {}, id => [async () => phaseResult(await f.current(id), 'progress'), async () => phaseResult({ ...await f.current(id), version: 1 }, 'progress'), fauxAssistantMessage('Stopped')]);
  const id = await f.add(); const c = await f.wait(id, 'needs-attention');
  assert.equal(c.phase, 'investigation');
  await assert.rejects(f.controller.command(command({ type: 'set-phase', caseId: id, phase: 'publication' } as unknown as Intent)), { code: 'invalid-intent' });
  assert.ok((await f.controller.snapshot({ selected: id })).selected!.messages.some(m => m.kind === 'eitri.assessment'));
});

test('No fix needed suppresses intake; explicit requeue links a new session', async t => {
  let f: Awaited<ReturnType<typeof fixture>>;
  f = await fixture(t, {}, id => [async () => phaseResult(await f.current(id), 'no-fix')]);
  const id = await f.add(); const done = await f.wait(id, 'terminal');
  assert.equal(done.outcome, 'no-fix');
  assert.equal(await f.add(), id);
  await unlink(join(f.directory, 'cases', id, 'session.sqlite'));
  await f.restart();
  const recovered = await f.current(id);
  assert.equal(recovered.status, 'terminal'); assert.equal(recovered.outcome, 'no-fix'); assert.equal(recovered.native, 'missing');
  assert.equal(recovered.reason, done.reason); assert.equal(recovered.warning, 'native-file-missing');
  assert.equal(await f.add(), id);
  const receipt = await f.controller.command(command({ type: 'requeue', caseId: id, note: 'New explicit investigation' }, recovered.version));
  assert.notEqual(receipt.caseId, id);
  assert.equal((await f.current(receipt.caseId!)).previousId, id);
});

test('budget exhaustion makes no summary call; Retry is explicit, bounded, and cumulative', async t => {
  let now = 1000, f: Awaited<ReturnType<typeof fixture>>;
  f = await fixture(t, { clock: () => now, allowanceMs: 100 }, id => [async () => {
    now += 150; return fauxAssistantMessage(fauxToolCall('probe', {}), { stopReason: 'toolUse' });
  }, async () => phaseResult(await f.current(id), 'attention')]);
  const id = await f.add(); const c = await f.wait(id, 'needs-attention');
  assert.equal(c.remainingMs, 0); assert.equal(c.usedMs, 100); assert.equal(f.providers.get(id)!.state.callCount, 1);
  await assert.rejects(f.controller.command(command({ type: 'continue', caseId: id }, c.version)), { code: 'cannot-continue' });
  await f.controller.command(command({ type: 'retry', caseId: id, note: 'Investigate again with a new allowance' }, c.version));
  const retried = await f.wait(id, 'needs-attention');
  assert.equal(retried.attempt, 2); assert.ok(retried.usedMs >= 100); assert.equal(f.providers.get(id)!.state.callCount, 2);
});

test('capacity-two scripted cases have distinct databases, messages, counters and IDs', async t => {
  const started = gate(), done = gate(); let n = 0;
  const f = await fixture(t, { capacity: 2, probe: async id => { if (++n === 2) started.resolve(); await done.promise; return `Owned ${id}`; } }, () => [fauxAssistantMessage(fauxToolCall('probe', {}), { stopReason: 'toolUse' }), fauxAssistantMessage('finished')]);
  const a = await f.add('A'), b = await f.add('B'); await started.promise;
  assert.equal((await f.current(a)).status, 'running'); assert.equal((await f.current(b)).status, 'running');
  done.resolve(); await f.wait(a, 'needs-attention'); await f.wait(b, 'needs-attention');
  const av = (await f.controller.snapshot({ selected: a })).selected!, bv = (await f.controller.snapshot({ selected: b })).selected!;
  assert.ok(av.messages.some(m => JSON.stringify(m.data).includes(`Owned ${a}`)));
  assert.ok(!av.messages.some(m => JSON.stringify(m.data).includes(`Owned ${b}`)));
  assert.ok(!av.messages.some(m => bv.messages.some(n => n.id === m.id)));
  assert.notEqual((await lstat(join(f.directory, 'cases', a, 'session.sqlite'))).ino, (await lstat(join(f.directory, 'cases', b, 'session.sqlite'))).ino);
});

test('per-file expiry preserves guards, cannot wake or recreate details, and protects unfinished work', async t => {
  let now = Date.now(), f: Awaited<ReturnType<typeof fixture>>;
  f = await fixture(t, { clock: () => now }, id => [async () => phaseResult(await f.current(id), 'no-fix')]);
  const id = await f.add(); await f.wait(id, 'terminal');
  await f.controller.command(command({ type: 'post-message', caseId: id, text: 'Does not reset expiry' }));
  now += 30 * 86400_000 + 1; await f.controller.maintain();
  assert.equal((await f.current(id)).native, 'expired');
  await assert.rejects(lstat(join(f.directory, 'cases', id)), { code: 'ENOENT' });
  assert.equal((await f.controller.snapshot({ selected: id })).selected!.messages.length, 0);
  assert.equal(await f.add(), id);
  await assert.rejects(f.controller.command(command({ type: 'post-message', caseId: id, text: 'Must not resurrect' })), { code: 'details-unavailable' });
  await f.restart(); assert.equal((await f.current(id)).native, 'expired');
  assert.equal(f.providers.get(id)!.state.callCount, 1);
});

test('missing native details and cleanup failure are surfaced without recreating history', async t => {
  let failCleanup = true, f: Awaited<ReturnType<typeof fixture>>;
  f = await fixture(t, { fault: point => { if (failCleanup && point === 'before-details-delete') throw new Error('cleanup failure'); } });
  const id = await f.add(); const c = await f.wait(id, 'needs-attention');
  await f.controller.command(command({ type: 'dismiss', caseId: id, note: 'Stop local work' }, c.version));
  const terminal = await f.current(id);
  await assert.rejects(f.controller.command(command({ type: 'details-cleanup', caseId: id, confirmed: true }, terminal.version)), /cleanup failure/);
  assert.equal((await f.current(id)).native, 'deleting');
  failCleanup = false; await f.restart(); assert.equal((await f.current(id)).native, 'expired');
  const other = await f.add('missing'); await f.wait(other, 'needs-attention');
  await unlink(join(f.directory, 'cases', other, 'session.sqlite'));
  await f.restart(); assert.equal((await f.current(other)).native, 'missing');
  await assert.rejects(lstat(join(f.directory, 'cases', other, 'session.sqlite')), { code: 'ENOENT' });
});

test('active notes are steered at the SDK boundary without a handler starting inference', async t => {
  const entered = gate(), release = gate(); let observed = false;
  const f = await fixture(t, { probe: async () => { entered.resolve(); await release.promise; return 'done'; } }, () => [
    fauxAssistantMessage(fauxToolCall('probe', {}), { stopReason: 'toolUse' }),
    transcript => { observed = JSON.stringify(transcript).includes('Boundary instruction'); return fauxAssistantMessage('finished'); },
  ]);
  const id = await f.add(); await entered.promise;
  const c = await f.current(id);
  await assert.rejects(f.controller.command(command({ type: 'details-cleanup', caseId: id, confirmed: true }, c.version)), { code: 'unfinished-case-protected' });
  await f.controller.command(command({ type: 'post-message', caseId: id, text: 'Boundary instruction' }));
  assert.equal(f.providers.get(id)!.state.callCount, 1);
  release.resolve(); await f.wait(id, 'needs-attention');
  assert.equal(observed, true);
});

test('corrupt durable allowance fails closed rather than allowing another model call', async t => {
  const f = await fixture(t);
  const id = await f.add(); const c = await f.wait(id, 'needs-attention');
  const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
  db.prepare('UPDATE cases SET value=? WHERE id=?').run(JSON.stringify({ ...c, remainingMs: 'invalid', status: 'running' }), id); db.close();
  await assert.rejects(f.controller.snapshot(), { code: 'invalid-control-state' });
  await assert.rejects(f.controller.command(command({ type: 'retry', caseId: id, note: 'Must not execute with invalid allowance' }, c.version)), { code: 'invalid-control-state' });
  assert.equal(f.providers.get(id)!.state.callCount, 1);
});
