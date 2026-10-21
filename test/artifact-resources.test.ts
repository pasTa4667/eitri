import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import { Controller } from '../src/controller.ts';
import type { Artifact, Case, Check, CheckResult } from '../src/domain.ts';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineDoc } from '@earendil-works/pi-durable';
import { NativeCase } from '../src/native.ts';
import { ArtifactStore } from '../src/artifacts.ts';

const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
const issue = {
  ...policy,
  id: 'artifact',
  title: 'Stored scripted check',
  priority: 'high',
  status: 'unresolved',
  regressed: false,
  escalating: false,
} as const;
const result = (): CheckResult => ({
  kind: 'browser',
  candidate: 'a'.repeat(40),
  configuration: 'b'.repeat(64),
  simulated: true,
  passed: true,
  outputs: [
    {
      label: 'Browser assertions',
      mime: 'text/plain',
      bytes: Buffer.from('Simulated target passed.\n'),
    },
  ],
});
async function settled(controller: Controller, caseId: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const c = (await controller.snapshot()).cases.find((c) => c.id === caseId)!;
    if (c.status === 'needs-attention') return c;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail('Case did not settle');
}

test('artifact reads stay passive across pagination, restart, missing directories, and serialized expiry', async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-resource-')));
  const faux = fauxProvider({ tokensPerSecond: 100000 });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('run_check', { kind: 'browser' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('Scripted attention'),
  ]);
  let now = Date.now();
  let controller = await Controller.open({
    directory,
    policy,
    clock: () => now,
    providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
    check: async () => ({ type: 'completed', check: result() }),
  });
  t.after(async () => {
    await controller.close();
    await rm(directory, { recursive: true, force: true });
  });
  const receipt = await controller.command({
    requestId: randomUUID(),
    intent: { type: 'investigate', issue },
  });
  const caseId = receipt.caseId!;
  let c: Case = await settled(controller, caseId);
  const selected = (await controller.snapshot({ selected: caseId, limit: 1 })).selected!;
  assert.equal(selected.checks.length, 1);
  assert.equal(selected.artifacts.length, 1);
  const artifact = selected.artifacts[0];
  for (let i = 0; i < 105; i++)
    await controller.command({
      requestId: randomUUID(),
      intent: { type: 'post-message', caseId, text: `Note ${i}` },
    });
  assert.equal(
    (await controller.snapshot({ selected: caseId })).selected!.messages.some(
      (m) => m.kind === 'eitri.check',
    ),
    false,
  );
  assert.equal(
    (await controller.snapshot({ selected: caseId, limit: 1 })).selected!.checks[0].id,
    artifact.checkId,
  );
  const calls = faux.state.callCount;
  assert.deepEqual(
    (await controller.artifact(caseId, artifact.id)).bytes,
    Buffer.from('Simulated target passed.\n'),
  );
  for (const [id, artifactId] of [
    [randomUUID(), artifact.id],
    [caseId, randomUUID()],
    [caseId, '../escape'],
  ])
    await assert.rejects(controller.artifact(id, artifactId));
  assert.equal(faux.state.callCount, calls);
  assert.equal((await readdir(join(directory, 'cases'))).length, 1);
  await controller.close();
  controller = await Controller.open({
    directory,
    policy,
    clock: () => now,
    providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
  });
  assert.deepEqual(
    (await controller.artifact(caseId, artifact.id)).bytes,
    Buffer.from('Simulated target passed.\n'),
  );
  assert.equal(faux.state.callCount, calls);
  c = (await controller.snapshot()).cases[0];
  await controller.command({
    requestId: randomUUID(),
    expectedControlVersion: c.version,
    intent: { type: 'dismiss', caseId, note: 'Finished scripted test' },
  });
  now += 30 * 24 * 60 * 60 * 1000;
  const read = controller.artifact(caseId, artifact.id);
  const expire = controller.maintain();
  assert.deepEqual((await read).bytes, Buffer.from('Simulated target passed.\n'));
  await expire;
  await assert.rejects(controller.artifact(caseId, artifact.id), { code: 'details-unavailable' });
  assert.equal((await controller.snapshot({ selected: caseId })).selected!.artifacts.length, 0);
  await assert.rejects(lstat(join(directory, 'cases', caseId)), { code: 'ENOENT' });
  assert.equal(faux.state.callCount, calls);
  const second = await controller.command({
    requestId: randomUUID(),
    intent: { type: 'requeue', caseId, note: 'Another isolated case' },
    expectedControlVersion: (await controller.snapshot()).cases[0].version,
  });
  await settled(controller, second.caseId!);
  await assert.rejects(controller.artifact(second.caseId!, artifact.id), {
    code: 'artifact-not-found',
  });
  await rm(join(directory, 'cases', second.caseId!), { recursive: true });
  await assert.rejects(controller.artifact(second.caseId!, artifact.id), {
    code: 'artifact-unavailable',
  });
  await assert.rejects(lstat(join(directory, 'cases', second.caseId!)), { code: 'ENOENT' });
});

function largePng() {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
    'base64',
  );
  const data = Buffer.concat([Buffer.from('tEXtComment\0'), Buffer.alloc(3 * 1024 * 1024, 97)]);
  const size = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length - 4);
  crc.writeUInt32BE(crc32(data));
  return Buffer.concat([png.subarray(0, -12), size, data, crc, png.subarray(-12)]);
}
for (const mode of [
  'forged-ids',
  'live-result',
  'check-count',
  'case-count',
  'check-bytes',
  'case-bytes',
])
  test(`trusted check output rejects ${mode} without accepting evidence`, async (t) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-resource-limit-')));
    const faux = fauxProvider({ tokensPerSecond: 100000 });
    faux.setResponses(
      Array.from({ length: 20 }, () =>
        fauxAssistantMessage(fauxToolCall('run_check', { kind: 'browser' }), {
          stopReason: 'toolUse',
        }),
      ),
    );
    const controller = await Controller.open({
      directory,
      policy,
      providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
      check: async () => {
        const check = result();
        if (mode === 'forged-ids')
          return { type: 'completed', check: { ...check, artifacts: [randomUUID()] } };
        if (mode === 'live-result') Reflect.set(check, 'simulated', false);
        if (mode === 'check-count')
          check.outputs = Array.from({ length: 9 }, () => check.outputs[0]);
        if (mode === 'case-count')
          check.outputs = Array.from({ length: 8 }, () => check.outputs[0]);
        if (mode.endsWith('-bytes'))
          check.outputs = Array.from({ length: mode === 'check-bytes' ? 3 : 2 }, () => ({
            label: 'Screenshot',
            mime: 'image/png',
            bytes: largePng(),
          }));
        return { type: 'completed', check };
      },
    });
    t.after(async () => {
      await controller.close();
      await rm(directory, { recursive: true });
    });
    const receipt = await controller.command({
      requestId: randomUUID(),
      intent: { type: 'investigate', issue },
    });
    await settled(controller, receipt.caseId!);
    const selected = (await controller.snapshot({ selected: receipt.caseId! })).selected!;
    assert.equal(
      selected.checks.length,
      mode === 'case-count' ? 16 : mode === 'case-bytes' ? 5 : 0,
    );
    assert.equal(
      selected.artifacts.length,
      mode === 'case-count' ? 128 : mode === 'case-bytes' ? 10 : 0,
    );
    assert.equal(
      (await readdir(join(directory, 'cases', receipt.caseId!, 'artifacts'))).length,
      mode === 'case-count' ? 128 : mode === 'case-bytes' ? 10 : 0,
    );
  });

test('native manifests bind every evidence reference to its case, action, receipt, revision and configuration', async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-native-artifact-')));
  const faux = fauxProvider({ tokensPerSecond: 100000 });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('run_check', { kind: 'browser' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('Scripted attention'),
  ]);
  const route = { provider: faux.provider, modelId: faux.getModel().id };
  const controller = await Controller.open({
    directory,
    policy,
    providerForCase: () => route,
    check: async () => ({ type: 'completed', check: result() }),
  });
  const receipt = await controller.command({
    requestId: randomUUID(),
    intent: { type: 'investigate', issue },
  });
  const c = await settled(controller, receipt.caseId!);
  const { checks, artifacts } = (await controller.snapshot({ selected: c.id })).selected!;
  await controller.close();
  const unexpected = () => {
    throw new Error('No execution allowed during native evidence verification');
  };
  const native = await NativeCase.open(
    join(directory, 'cases', c.id, 'session.sqlite'),
    c,
    route,
    {
      current: () => c,
      admit: unexpected,
      permit: unexpected,
      remaining: unexpected,
      mayRecordCompletion: unexpected,
      wakeup: unexpected,
      finish: unexpected,
      receipt: unexpected,
      assess: unexpected,
      checkpoint: unexpected,
      probe: unexpected,
      check: unexpected,
      validateCheckAction: unexpected,
      fault: unexpected,
      changed: () => {},
    },
    await ArtifactStore.open(directory, c.id),
  );
  t.after(async () => {
    await native.close();
    await rm(directory, { recursive: true });
  });
  const docToken = defineDoc({
    kind: 'eitri.artifacts',
    version: 1,
    scope: 'conversation',
    history: 'latest',
    fork: 'initial',
    initial: (): {
      caseId: string;
      artifacts: Record<string, Artifact>;
      checks: Record<string, Check>;
    } => ({ caseId: '', artifacts: {}, checks: {} }),
  });
  const original = artifacts[0];
  await native.verifyArtifacts(checks[0]);
  for (const changed of [
    { caseId: randomUUID() },
    { checkId: randomUUID() },
    { actionId: randomUUID() },
    { revision: 'c'.repeat(40) },
    { configuration: 'd'.repeat(64) },
    { simulated: false },
    { bytes: [1, 2, 3] },
  ]) {
    await native.root.commit(async (tx) => {
      (await tx.doc(docToken, native.root.id)).artifacts[original.id] = {
        ...original,
        ...changed,
      } as Artifact;
    }, context);
    await assert.rejects(native.verifyArtifacts(checks[0]));
  }
  await native.root.commit(async (tx) => {
    (await tx.doc(docToken, native.root.id)).artifacts[original.id] = original;
  }, context);
  await native.verifyArtifacts(checks[0]);
  await assert.rejects(native.verifyArtifacts({ ...checks[0], artifacts: [randomUUID()] }), {
    code: 'artifact-not-found',
  });
  const forged = { ...checks[0], id: randomUUID() };
  await native.note(randomUUID(), 'eitri.check', forged);
  assert.deepEqual(
    (await native.metadata()).checks.map((check) => check.id),
    [checks[0].id],
  );
  await native.root.commit(async (tx) => {
    (await tx.doc(docToken, native.root.id)).caseId = randomUUID();
  }, context);
  await assert.rejects(native.artifact(original.id), { code: 'invalid-artifact-document' });
});
