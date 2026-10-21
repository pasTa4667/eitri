import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, chmod, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineDoc } from '@earendil-works/pi-durable';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { NativeCase } from '../src/native.ts';
import type { RuntimeHost } from '../src/native.ts';
import { ArtifactStore, checksum } from '../src/artifacts.ts';
import { digest } from '../src/domain.ts';
import type { Action, Artifact, Case, Check, CheckResult } from '../src/domain.ts';
import { frozenBrowserRequest } from '../src/frozen-browser.ts';
import type { FrozenBrowserOutcome } from '../src/frozen-browser.ts';
import { executionLimits, executionSize } from '../src/native-browser-check.ts';
import type { NativeExecutionAnchor, StoredCheck } from '../src/native-browser-check.ts';

const png = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c6360000200000500017a5eab3f0000000049454e44ae426082',
  'hex',
);
const config = 'a'.repeat(64);
const revision = 'c'.repeat(40);
const owner = '44444444-4444-4444-4444-444444444444';
type EvidenceDocument = {
  caseId: string;
  checks: Record<string, StoredCheck>;
  artifacts: Record<string, Artifact>;
};
const token = defineDoc({
  kind: 'eitri.artifacts',
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  initial: (): {
    caseId: string;
    checks: Record<string, StoredCheck>;
    artifacts: Record<string, Artifact>;
  } => ({ caseId: '', checks: {}, artifacts: {} }),
});
function claims(action: Action, role: 'baseline' | 'candidate' = 'candidate', literal = 'B') {
  const request = frozenBrowserRequest({
    frozen: { caseId: action.caseId, revision, manifestDigest: 'd'.repeat(64) },
    action: { caseId: action.caseId, actionId: action.id, epoch: action.epoch },
    scenarioId: 'synthetic-click-v1',
    role,
    allowanceMs: 1000,
  });
  const facts = {
    consumedRun: {
      acceptanceId: randomUUID(),
      runId: randomUUID(),
      requestDigest: digest(request),
    },
    admittedAt: 100,
    deadline: 600,
  };
  const anchor: NativeExecutionAnchor = {
    action: structuredClone(action),
    kind: role === 'baseline' ? 'baseline' : 'browser',
    frozen: request.frozen,
    intent: { request, requestDigest: digest(request) },
    binding: { version: 1, ownerId: owner, configurationDigest: config },
    facts,
  };
  const kind =
    role === 'baseline'
      ? literal === 'A'
        ? 'baseline-reproduced'
        : 'baseline-not-reproduced'
      : literal === 'B'
        ? 'candidate-passed'
        : 'candidate-failed';
  const manifest = [{ path: 'src/index.html', size: 12, sha256: 'e'.repeat(64) }];
  const history = {
    state: 'settled',
    ...structuredClone(facts),
    report: {
      runId: facts.consumedRun.runId,
      request: structuredClone(request),
      outcome: { kind } as FrozenBrowserOutcome,
      cleanup: { kind: 'owned-removed', cache: 'retained' },
      evidence: {
        provenance: {
          requestDigest: digest(request),
          configurationDigest: config,
          frozen: structuredClone(request.frozen),
          transfer: manifest,
          contextBytes: 1024,
          contextSha256: config,
          assets: {},
          policy: {},
          engine: {} as Record<string, string>,
          baseBefore: {},
          baseAfter: {},
          imageId: `sha256:${config}`,
          containerId: config,
          applied: {},
          admittedAt: 100,
          deadline: 600,
          finishedAt: 500,
          exitCode: 0,
          oomKilled: false,
          stdoutSha256: config,
          stderrSha256: config,
          buildStdoutSha256: config,
          buildStderrSha256: config,
        },
        observations: {
          stage: 'complete',
          literal,
          events: [] as { kind: string; text: string }[],
          manifest: structuredClone(manifest),
        },
        png: {
          mime: 'image/png',
          size: png.length,
          sha256: checksum(png),
          base64: png.toString('base64'),
        },
      },
    },
  };
  return { anchor, history };
}
async function fixture(t: TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-native-consumed-')));
  const id = randomUUID();
  await mkdir(join(directory, 'cases'), { mode: 0o700 });
  await mkdir(join(directory, 'cases', id), { mode: 0o700 });
  const c: Case = {
    id,
    issueKey: config,
    issue: {
      id: 'one',
      project: 'demo',
      environment: 'demo',
      repository: 'demo',
      title: 'scripted claims',
      priority: 'high',
      status: 'unresolved',
      regressed: false,
      escalating: false,
    },
    previousId: null,
    phase: 'testing',
    status: 'running',
    version: 1,
    epoch: 2,
    native: 'provisioning',
    remainingMs: 10000,
    usedMs: 0,
    attempt: 1,
    repairs: 0,
    accountedAt: 100,
    terminalAt: null,
    outcome: null,
    reason: '',
    base: null,
    candidate: revision,
    failedCandidate: null,
    simulated: true,
  };
  let action: Action = {
    id: randomUUID(),
    caseId: id,
    epoch: 2,
    kind: 'tool',
    startedAt: 100,
    limitMs: 1000,
    usedAtStart: 0,
  };
  let input = claims(action);
  let revoked = false;
  let expired = false;
  const checkpoints: Check[] = [];
  const faults: string[] = [];
  const unexpected = (): never => {
    throw Error('unexpected');
  };
  const host: RuntimeHost = {
    current: () => c,
    admit: unexpected,
    permit: unexpected,
    remaining: () => 1000,
    mayRecordCompletion: () => false,
    wakeup: () => () => {},
    finish: unexpected,
    receipt: unexpected,
    assess: unexpected,
    checkpoint: (_action, check) => {
      checkpoints.push(check);
    },
    probe: unexpected,
    check: unexpected,
    validateCheckAction: () => {
      if (revoked) throw Error('revoked');
    },
    captureConsumedCheckAuthority: (provided, signal) => {
      assert.deepEqual(provided, action);
      const anchor = structuredClone(input.anchor);
      return {
        anchor,
        assertCurrent: () => {
          signal.throwIfAborted();
          if (expired) throw Error('timed-out');
          if (revoked || c.epoch !== anchor.action.epoch) throw Error('revoked');
          assert.deepEqual(input.anchor, anchor);
        },
      };
    },
    fault: (point) => {
      faults.push(point);
    },
    changed: () => {},
  };
  const faux = fauxProvider();
  const route = { provider: faux.provider, modelId: faux.getModel().id };
  const store = await ArtifactStore.open(directory, id);
  const path = join(directory, 'cases', id, 'session.sqlite');
  let native = await NativeCase.open(path, c, route, host, store);
  t.after(async () => {
    await native.close();
    await rm(directory, { recursive: true, force: true });
  });
  const signal = new AbortController();
  return {
    directory,
    c,
    host,
    store,
    checkpoints,
    faults,
    signal,
    get native() {
      return native;
    },
    get action() {
      return action;
    },
    get input() {
      return input;
    },
    reset(role: 'baseline' | 'candidate' = 'candidate', literal = 'B') {
      action = { ...action, id: randomUUID() };
      input = claims(action, role, literal);
      return input;
    },
    revoke() {
      revoked = true;
    },
    expire() {
      expired = true;
    },
    record(checkId: string = randomUUID(), value: unknown = input.history) {
      return native.recordConsumedBrowserCheck(action, checkId, value, signal.signal);
    },
    async reopen() {
      await native.close();
      native = await NativeCase.open(path, c, route, host, store);
    },
    async document() {
      let result!: {
        caseId: string;
        checks: Record<string, StoredCheck>;
        artifacts: Record<string, Artifact>;
      };
      await native.root.commit(async (tx) => {
        result = JSON.parse(JSON.stringify(await tx.doc(token, native.root.id)));
      }, context);
      return result;
    },
    async mutate(change: (doc: EvidenceDocument) => void) {
      await native.root.commit(async (tx) => {
        change(await tx.doc(token, native.root.id));
      }, context);
    },
  };
}
type Assert<T extends true> = T;
export type SimulatedOnlyCallback = Assert<CheckResult['simulated'] extends true ? true : false>;
const simulated = (): CheckResult => ({
  kind: 'browser',
  candidate: revision,
  configuration: config,
  passed: true,
  simulated: true,
  outputs: [{ label: 'Scripted', mime: 'image/png', bytes: png }],
});

for (const [role, literal, outcome, passed] of [
  ['baseline', 'A', 'baseline-reproduced', true],
  ['baseline', 'B', 'baseline-not-reproduced', false],
  ['candidate', 'B', 'candidate-passed', true],
  ['candidate', 'A', 'candidate-failed', false],
] as const)
  test(`scripted worker claims with literal PNG bytes; actual native persistence ${outcome}`, async (t) => {
    const f = await fixture(t);
    f.reset(role, literal);
    const id = randomUUID();
    const result = await f.record(id);
    assert.equal(result.type, 'recorded');
    if (result.type !== 'recorded') return;
    assert.deepEqual(result.check, {
      id,
      caseId: f.c.id,
      actionId: f.action.id,
      kind: role === 'baseline' ? 'baseline' : 'browser',
      candidate: revision,
      configuration: config,
      passed,
      simulated: false,
      artifacts: result.check.artifacts,
      provenance: {
        kind: 'frozen-browser-consumed-v1',
        epoch: 2,
        ownerId: owner,
        ...f.input.anchor.facts.consumedRun,
        admittedAt: 100,
        deadline: 600,
        finishedAt: 500,
        outcome,
      },
    });
    assert.deepEqual(f.checkpoints, [result.check]);
    assert.equal(f.c.simulated, true);
    const before = await f.native.metadata();
    assert.equal(before.artifacts[0].simulated, false);
    assert.equal(before.artifacts[0].label, 'Frozen browser screenshot');
    assert.deepEqual((await f.native.readArtifact(result.check.artifacts[0])).bytes, png);
    await f.reopen();
    assert.deepEqual(await f.native.metadata(), before);
    await f.native.verifyArtifacts({ ...result.check, artifacts: [randomUUID()] });
  });

test('scripted firewall, optional host compatibility and duplicate mixed publication', async (t) => {
  const f = await fixture(t);
  for (const extra of [{ simulated: false }, { provenance: {} }, { execution: {} }])
    await assert.rejects(
      f.native.recordCheck(
        f.action,
        randomUUID(),
        { ...simulated(), ...extra } as CheckResult,
        f.signal.signal,
      ),
      /invalid-check-receipt/,
    );
  const capability = f.host.captureConsumedCheckAuthority;
  delete f.host.captureConsumedCheckAuthority;
  await assert.rejects(f.record(), /authority-unavailable/);
  const check = await f.native.recordCheck(f.action, randomUUID(), simulated(), f.signal.signal);
  assert.equal(check.simulated, true);
  f.host.captureConsumedCheckAuthority = capability;
  await assert.rejects(f.record(), /duplicate-check-receipt/);
  f.reset();
  const id = randomUUID();
  const results = await Promise.allSettled([
    f.record(id),
    f.record(id),
    f.native.recordCheck(f.action, randomUUID(), simulated(), f.signal.signal),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    ['fulfilled', 'rejected', 'rejected'],
  );
  assert.equal(f.checkpoints.length, 2);
  f.reset();
  await assert.rejects(f.record(check.id), /duplicate-check-receipt/);
});

for (const reason of [
  'cleanup-incomplete',
  'infrastructure',
  'unrelated-failure',
  'cancelled',
  'uncertain',
] as const)
  test(`blocked ${reason} never becomes behavioral evidence`, async (t) => {
    const f = await fixture(t);
    const h = f.input.history;
    if (reason === 'cleanup-incomplete')
      h.report.cleanup = {
        kind: 'incomplete',
        cache: 'retained',
        code: 'cleanup',
      } as typeof h.report.cleanup;
    else if (reason === 'unrelated-failure') {
      h.report.outcome = { kind: reason };
      h.report.evidence.observations.literal = 'C';
    } else
      h.report.outcome = {
        kind: reason === 'infrastructure' ? 'infrastructure-failed' : reason,
        code: 'scripted',
      };
    assert.deepEqual(await f.record(), { type: 'unavailable', reason });
    assert.deepEqual(await f.native.metadata(), { checks: [], artifacts: [] });
    assert.deepEqual(f.checkpoints, []);
    h.report.evidence.png.sha256 = '0'.repeat(64);
    await assert.rejects(f.record(), /invalid-frozen-browser-admission/);
  });

const inputMutations: [string, (h: ReturnType<typeof claims>['history']) => void][] = [
  [
    'request',
    (h) => {
      h.report.request = frozenBrowserRequest({ ...h.report.request, allowanceMs: 900 });
      h.consumedRun.requestDigest = digest(h.report.request);
      h.report.evidence.provenance.requestDigest = digest(h.report.request);
    },
  ],
  [
    'selector',
    (h) => {
      h.consumedRun.runId = randomUUID();
      h.report.runId = h.consumedRun.runId;
    },
  ],
  [
    'acceptance',
    (h) => {
      h.consumedRun.acceptanceId = randomUUID();
    },
  ],
  [
    'timing',
    (h) => {
      h.deadline++;
      h.report.evidence.provenance.deadline++;
    },
  ],
  [
    'configuration',
    (h) => {
      h.report.evidence.provenance.configurationDigest = 'b'.repeat(64);
    },
  ],
  [
    'frozen',
    (h) => {
      Reflect.set(h.report.evidence.provenance.frozen, 'manifestDigest', 'f'.repeat(64));
    },
  ],
  [
    'pending',
    (h) => {
      h.state = 'pending';
    },
  ],
  [
    'recorded',
    (h) => {
      h.state = 'recorded';
    },
  ],
  [
    'png',
    (h) => {
      h.report.evidence.png.base64 = Buffer.from('not PNG').toString('base64');
    },
  ],
  [
    'keys',
    (h) => {
      Reflect.set(h, 'trustedAdmission', true);
    },
  ],
];
for (const [name, mutate] of inputMutations)
  test(`independent expectation rejects ${name}`, async (t) => {
    const f = await fixture(t);
    mutate(f.input.history);
    await assert.rejects(f.record(), /invalid-frozen-browser-admission/);
    assert.deepEqual(await f.native.metadata(), { checks: [], artifacts: [] });
    assert.equal(f.checkpoints.length, 0);
  });
test('own-data input cannot execute getters or trust converted admissions', async (t) => {
  const f = await fixture(t);
  let reads = 0;
  const value = {
    get state() {
      reads++;
      return 'settled';
    },
  };
  await assert.rejects(f.record(randomUUID(), value), /invalid-frozen-browser-admission/);
  await assert.rejects(
    f.record(randomUUID(), {
      type: 'behavioral',
      report: f.input.history.report,
      passed: true,
      outputs: [],
    }),
    /invalid-frozen-browser-admission/,
  );
  assert.equal(reads, 0);
});

for (const gate of ['quota', 'blob', 'manifest', 'receipt', 'note', 'checkpoint'] as const)
  for (const revoke of ['cancel', 'epoch', 'authority', 'timeout', 'close'] as const)
    test(`${revoke} at ${gate} gates publication`, async (t) => {
      const f = await fixture(t);
      let closure: Promise<void> | undefined;
      const revokeNow = () => {
        if (revoke === 'cancel') f.signal.abort();
        else if (revoke === 'epoch') f.c.epoch++;
        else if (revoke === 'timeout') f.expire();
        else if (revoke === 'close') closure = f.native.close();
        else f.revoke();
      };
      if (gate === 'quota') {
        const metadata = f.native.metadata.bind(f.native);
        t.mock.method(f.native, 'metadata', async () => {
          const value = await metadata();
          revokeNow();
          return value;
        });
      }
      if (gate === 'blob') {
        const write = f.store.write.bind(f.store);
        t.mock.method(f.store, 'write', async (artifact: Artifact, bytes: Uint8Array) => {
          revokeNow();
          return write(artifact, bytes);
        });
      }
      if (gate === 'manifest' || gate === 'receipt' || gate === 'checkpoint')
        f.host.fault = (point) => {
          if (
            point ===
            (gate === 'manifest'
              ? 'after-artifact-blobs'
              : gate === 'receipt'
                ? 'after-artifact-manifests'
                : 'after-check-receipt')
          )
            revokeNow();
        };
      if (gate === 'note') {
        const note = f.native.note.bind(f.native);
        t.mock.method(f.native, 'note', async (...args: Parameters<NativeCase['note']>) => {
          revokeNow();
          return note(...args);
        });
      }
      await assert.rejects(f.record());
      await closure;
      assert.equal(f.checkpoints.length, 0);
      if (revoke !== 'close') {
        const metadata = await f.native.metadata();
        assert.equal(metadata.checks.length, gate === 'note' || gate === 'checkpoint' ? 1 : 0);
      }
    });

test('pause-requested permits the same reliable result', async (t) => {
  const f = await fixture(t);
  f.c.status = 'pause-requested';
  const result = await f.record();
  assert.equal(result.type, 'recorded');
  assert.equal(f.checkpoints.length, 1);
});

const storedMutations: [string, (doc: EvidenceDocument) => void][] = [
  [
    'execution version',
    (d) => {
      const c = Object.values(d.checks)[0];
      if (!c.simulated) Reflect.set(c.execution, 'version', 2);
    },
  ],
  [
    'execution keys',
    (d) => {
      const c = Object.values(d.checks)[0];
      if (!c.simulated) Reflect.set(c.execution, 'extra', 1);
    },
  ],
  [
    'anchor',
    (d) => {
      const c = Object.values(d.checks)[0];
      if (!c.simulated) c.execution.anchor.action.epoch++;
    },
  ],
  [
    'report',
    (d) => {
      const c = Object.values(d.checks)[0];
      if (!c.simulated)
        Reflect.set(c.execution.history.report.evidence!.provenance, 'finishedAt', 700);
    },
  ],
  [
    'outcome',
    (d) => {
      const c = Object.values(d.checks)[0];
      if (!c.simulated)
        Reflect.set(c.execution.history.report, 'outcome', { kind: 'candidate-failed' });
    },
  ],
  [
    'public provenance',
    (d) => {
      Reflect.set(Object.values(d.checks)[0], 'provenance', {});
    },
  ],
  [
    'anchor keys',
    (d) => {
      const c = Object.values(d.checks)[0];
      if (!c.simulated) Reflect.set(c.execution.anchor, 'directory', '/untrusted');
    },
  ],
  [
    'passed',
    (d) => {
      Object.values(d.checks)[0].passed = false;
    },
  ],
  [
    'candidate',
    (d) => {
      Object.values(d.checks)[0].candidate = 'b'.repeat(40);
    },
  ],
  [
    'configuration',
    (d) => {
      Object.values(d.checks)[0].configuration = 'b'.repeat(64);
    },
  ],
  [
    'links',
    (d) => {
      Object.values(d.checks)[0].artifacts = [randomUUID()];
    },
  ],
  [
    'manifest simulation',
    (d) => {
      Reflect.set(Object.values(d.artifacts)[0], 'simulated', true);
    },
  ],
  [
    'manifest action',
    (d) => {
      Reflect.set(Object.values(d.artifacts)[0], 'actionId', randomUUID());
    },
  ],
  [
    'manifest check',
    (d) => {
      Reflect.set(Object.values(d.artifacts)[0], 'checkId', randomUUID());
    },
  ],
  [
    'manifest revision',
    (d) => {
      Reflect.set(Object.values(d.artifacts)[0], 'revision', 'f'.repeat(40));
    },
  ],
  [
    'manifest configuration',
    (d) => {
      Reflect.set(Object.values(d.artifacts)[0], 'configuration', 'f'.repeat(64));
    },
  ],
  [
    'manifest label',
    (d) => {
      Reflect.set(Object.values(d.artifacts)[0], 'label', 'Not execution authority');
    },
  ],
  [
    'manifest MIME',
    (d) => {
      Reflect.set(Object.values(d.artifacts)[0], 'mime', 'text/plain');
    },
  ],
  [
    'manifest hash',
    (d) => {
      Reflect.set(Object.values(d.artifacts)[0], 'sha256', 'b'.repeat(64));
    },
  ],
  [
    'manifest size',
    (d) => {
      Reflect.set(Object.values(d.artifacts)[0], 'size', png.length + 1);
    },
  ],
];
for (const [name, mutate] of storedMutations)
  test(`reopen rejects tampered ${name}`, async (t) => {
    const f = await fixture(t);
    await f.record();
    await f.mutate(mutate);
    await assert.rejects(f.reopen());
  });
for (const mode of ['missing', 'corrupt'] as const)
  test(`reopen rejects ${mode} literal bytes`, async (t) => {
    const f = await fixture(t);
    await f.record();
    const artifact = (await f.native.metadata()).artifacts[0];
    const path = join(f.directory, 'cases', f.c.id, 'artifacts', artifact.id);
    if (mode === 'missing') await rm(path);
    else {
      await chmod(path, 0o600);
      await writeFile(path, Buffer.alloc(png.length));
    }
    await assert.rejects(f.reopen());
  });

for (const point of [
  'after-artifact-blobs',
  'after-artifact-manifests',
  'after-check-receipt',
] as const)
  test(`real ${point} preserves existing crash gap`, async (t) => {
    const f = await fixture(t);
    f.host.fault = (current) => {
      if (current === point) throw Error(point);
    };
    await assert.rejects(f.record(), new RegExp(point));
    await f.reopen();
    const metadata = await f.native.metadata();
    assert.equal(metadata.artifacts.length, point === 'after-artifact-blobs' ? 0 : 1);
    assert.equal(metadata.checks.length, point === 'after-check-receipt' ? 1 : 0);
    assert.equal(f.checkpoints.length, 0);
  });

test('actual native durability at 32 MiB aggregate with four bounded complete executions', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 4; i++) {
    f.reset();
    const execution = { version: 1 as const, anchor: f.input.anchor, history: f.input.history };
    f.input.history.report.evidence.provenance.engine.padding = '';
    const empty = Buffer.byteLength(JSON.stringify(execution));
    f.input.history.report.evidence.provenance.engine.padding = 'x'.repeat(8 * 1024 ** 2 - empty);
    assert.equal(Buffer.byteLength(JSON.stringify(execution)), 8 * 1024 ** 2);
    assert.equal((await f.record()).type, 'recorded');
  }
  const doc = await f.document();
  assert.equal(
    Object.values(doc.checks).reduce(
      (n, c) => n + (c.simulated ? 0 : executionSize(c.execution)),
      0,
    ),
    32 * 1024 ** 2,
  );
  f.reset();
  await assert.rejects(f.record(), /check-execution-case-limit/);
  await f.reopen();
  const metadata = await f.native.metadata();
  assert.equal(metadata.checks.length, 4);
  for (const c of metadata.checks)
    assert.deepEqual((await f.native.readArtifact(c.artifacts[0])).bytes, png);
  assert.equal(f.checkpoints.length, 4);
});

test('native document durably holds the 8 MiB plus 512 KiB envelope storage ceiling', async (t) => {
  const f = await fixture(t);
  await f.record();
  await f.mutate((doc) => {
    const c = Object.values(doc.checks)[0];
    if (c.simulated) assert.fail('real');
    const engine = c.execution.history.report.evidence!.provenance.engine;
    engine.padding = '';
    engine.padding = 'x'.repeat(executionLimits.executionBytes - executionSize(c.execution));
  });
  const metadata = t.mock.method(NativeCase.prototype, 'metadata', async () => ({
    checks: [],
    artifacts: [],
  }));
  await f.reopen();
  metadata.mock.restore();
  const doc = await f.document();
  const c = Object.values(doc.checks)[0];
  if (c.simulated) assert.fail('real');
  assert.equal(executionSize(c.execution), 8912896);
  await assert.rejects(f.native.metadata(), /invalid-frozen-browser-admission/);
  await f.mutate((d) => {
    const stored = Object.values(d.checks)[0];
    if (!stored.simulated)
      stored.execution.history.report.evidence!.provenance.engine.padding = `${stored.execution.history.report.evidence!.provenance.engine.padding}x`;
  });
  await assert.rejects(f.native.metadata(), /invalid-check-execution/);
});
