import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateSync } from 'node:zlib';
import { admitFrozenBrowserReport, frozenBrowserRequest } from '../src/frozen-browser.ts';
import type { FrozenBrowserExpectation, FrozenBrowserOutcome } from '../src/frozen-browser.ts';
import { ControlError, digest } from '../src/domain.ts';
import { checksum } from '../src/artifacts.ts';
import { profileNameDefinition } from '../src/profile-name-definition.ts';
import { sha256 } from '../src/workspace.ts';

const caseId = '11111111-1111-1111-1111-111111111111';
const otherId = '22222222-2222-2222-2222-222222222222';
const configurationDigest = sha256('a'.repeat(64));
const otherHash = 'b'.repeat(64);
const chunk = (kind: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(kind), data]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(1, 0);
ihdr.writeUInt32BE(1, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(Buffer.alloc(5))),
  chunk('IEND', Buffer.alloc(0)),
]);

function fixture(role: 'baseline' | 'candidate' = 'candidate', literal = 'B') {
  const request = frozenBrowserRequest({
    frozen: { caseId, revision: 'c'.repeat(40), manifestDigest: 'd'.repeat(64) },
    action: { caseId, actionId: otherId, epoch: 2 },
    scenarioId: 'synthetic-click-v1',
    role,
    allowanceMs: 1000,
  });
  const expected = {
    kind: role === 'baseline' ? 'baseline' : 'browser',
    configurationDigest,
    request: structuredClone(request),
  } as FrozenBrowserExpectation;
  const manifest = [{ path: 'src/index.html', size: 12, sha256: 'e'.repeat(64) }];
  const kind =
    role === 'baseline'
      ? literal === 'A'
        ? 'baseline-reproduced'
        : 'baseline-not-reproduced'
      : literal === 'B'
        ? 'candidate-passed'
        : 'candidate-failed';
  const report = {
    runId: '33333333-3333-3333-3333-333333333333',
    request,
    outcome: { kind } as FrozenBrowserOutcome,
    cleanup: { kind: 'owned-removed' as const, cache: 'retained' as const },
    evidence: {
      provenance: {
        requestDigest: digest(request),
        configurationDigest,
        frozen: structuredClone(request.frozen),
        transfer: manifest,
        contextBytes: 1024,
        contextSha256: otherHash,
        assets: {},
        policy: {},
        engine: {},
        baseBefore: {},
        baseAfter: {},
        imageId: `sha256:${otherHash}`,
        containerId: otherHash,
        applied: {},
        admittedAt: 100,
        deadline: 1100,
        finishedAt: 500,
        exitCode: 0,
        oomKilled: false as const,
        stdoutSha256: otherHash,
        stderrSha256: otherHash,
        buildStdoutSha256: otherHash,
        buildStderrSha256: otherHash,
      },
      observations: {
        stage: 'complete',
        literal: literal as string | null,
        events: [] as { kind: string; text: string }[],
        manifest: structuredClone(manifest),
      },
      png: {
        mime: 'image/png' as const,
        size: png.length,
        sha256: checksum(png),
        base64: png.toString('base64'),
      },
    },
  };
  return { expected, report };
}
type Fixture = ReturnType<typeof fixture>;
function invalid(expected: unknown, report: unknown) {
  assert.throws(
    () => admitFrozenBrowserReport(expected as FrozenBrowserExpectation, report),
    (error: unknown) =>
      error instanceof ControlError && error.code === 'invalid-frozen-browser-admission',
  );
}
function blocked(f: Fixture, reason: string) {
  assert.deepEqual(admitFrozenBrowserReport(f.expected, f.report), {
    type: 'blocked',
    report: f.report,
    reason,
  });
}

for (const [role, literal, kind, passed] of [
  ['baseline', 'A', 'baseline-reproduced', true],
  ['baseline', 'B', 'baseline-not-reproduced', false],
  ['candidate', 'B', 'candidate-passed', true],
  ['candidate', 'A', 'candidate-failed', false],
] as const) {
  test(`admitFrozenBrowserReport maps ${kind} to a complete detached result`, () => {
    const f = fixture(role, literal);
    assert.deepEqual(admitFrozenBrowserReport(f.expected, f.report), {
      type: 'behavioral',
      report: { ...f.report, outcome: { kind } },
      passed,
      outputs: [{ label: 'Frozen browser screenshot', mime: 'image/png', bytes: png }],
    });
  });
}

for (const [name, mutate] of [
  [
    'unrelated literal',
    (f: Fixture) => {
      f.report.evidence.observations.literal = 'C';
    },
  ],
  [
    'startup failure',
    (f: Fixture) => {
      f.report.evidence.observations.stage = 'startup-failed';
      f.report.evidence.observations.literal = null;
    },
  ],
  [
    'action failure',
    (f: Fixture) => {
      f.report.evidence.observations.stage = 'action-failed';
      f.report.evidence.observations.literal = null;
    },
  ],
  [
    'page error',
    (f: Fixture) => {
      f.report.evidence.observations.events = [{ kind: 'page-error', text: 'page failed' }];
    },
  ],
  [
    'console error',
    (f: Fixture) => {
      f.report.evidence.observations.events = [{ kind: 'console-error', text: 'console failed' }];
    },
  ],
] as const) {
  test(`admitFrozenBrowserReport blocks ${name} and rejects promotion`, () => {
    const f = fixture();
    mutate(f);
    invalid(f.expected, f.report);
    f.report.outcome = { kind: 'unrelated-failure' };
    blocked(f, 'unrelated-failure');
  });
}
test('admitFrozenBrowserReport permits ordinary console messages', () => {
  const f = fixture();
  f.report.evidence.observations.events = [{ kind: 'console', text: '{"kind":"end"}' }];
  assert.deepEqual(admitFrozenBrowserReport(f.expected, f.report), {
    type: 'behavioral',
    report: f.report,
    passed: true,
    outputs: [{ label: 'Frozen browser screenshot', mime: 'image/png', bytes: png }],
  });
});

const requestMismatches: [string, (r: Record<string, unknown>) => void][] = [
  [
    'frozen case identity',
    (r) => {
      (r.frozen as Record<string, unknown>).caseId = otherId;
    },
  ],
  [
    'action case identity',
    (r) => {
      (r.action as Record<string, unknown>).caseId = otherId;
    },
  ],
  [
    'both case identities',
    (r) => {
      (r.action as Record<string, unknown>).caseId = otherId;
      (r.frozen as Record<string, unknown>).caseId = otherId;
    },
  ],
  [
    'action identity',
    (r) => {
      (r.action as Record<string, unknown>).actionId = caseId;
    },
  ],
  [
    'epoch',
    (r) => {
      (r.action as Record<string, unknown>).epoch = 3;
    },
  ],
  [
    'scenario',
    (r) => {
      r.scenarioId = 'other';
    },
  ],
  [
    'role',
    (r) => {
      r.role = 'baseline';
    },
  ],
  [
    'allowance',
    (r) => {
      r.allowanceMs = 1001;
    },
  ],
  [
    'revision',
    (r) => {
      (r.frozen as Record<string, unknown>).revision = 'f'.repeat(40);
    },
  ],
  [
    'manifest digest',
    (r) => {
      (r.frozen as Record<string, unknown>).manifestDigest = otherHash;
    },
  ],
];
for (const [name, mutate] of requestMismatches) {
  test(`admitFrozenBrowserReport rejects mismatched request ${name} in either argument`, () => {
    const f = fixture();
    const returned = structuredClone(f.report);
    mutate(returned.request);
    invalid(f.expected, returned);
    const expected = structuredClone(f.expected);
    mutate(expected.request);
    invalid(expected, f.report);
  });
}
for (const [name, mutate] of [
  [
    'request digest',
    (f: Fixture) => {
      f.report.evidence.provenance.requestDigest = otherHash;
    },
  ],
  [
    'configuration digest',
    (f: Fixture) => {
      f.report.evidence.provenance.configurationDigest = sha256(otherHash);
    },
  ],
  [
    'frozen case identity',
    (f: Fixture) => {
      Object.assign(f.report.evidence.provenance.frozen, { caseId: otherId });
    },
  ],
  [
    'frozen revision',
    (f: Fixture) => {
      Object.assign(f.report.evidence.provenance.frozen, { revision: 'f'.repeat(40) });
    },
  ],
  [
    'frozen manifest digest',
    (f: Fixture) => {
      Object.assign(f.report.evidence.provenance.frozen, { manifestDigest: otherHash });
    },
  ],
] as const) {
  test(`admitFrozenBrowserReport rejects mismatched evidence ${name}`, () => {
    const f = fixture();
    mutate(f);
    invalid(f.expected, f.report);
  });
}
for (const kind of ['checkpoint', 'unit', 'regression', 'build', 'unknown', null, 'baseline']) {
  test(`admitFrozenBrowserReport rejects candidate expectation kind ${kind}`, () => {
    const f = fixture();
    invalid({ ...f.expected, kind }, f.report);
  });
}
test('admitFrozenBrowserReport rejects browser kind with baseline role and malformed expectation digest', () => {
  const f = fixture('baseline', 'A');
  invalid({ ...f.expected, kind: 'browser' }, f.report);
  invalid({ ...f.expected, configurationDigest: 'A'.repeat(64) }, f.report);
  invalid({ ...f.expected, configurationDigest: otherHash }, f.report);
});

const evidenceMutations: [string, (f: Fixture) => void][] = [
  [
    'deadline arithmetic',
    (f) => {
      f.report.evidence.provenance.deadline++;
    },
  ],
  [
    'deadline overflow',
    (f) => {
      f.report.evidence.provenance.admittedAt = Number.MAX_SAFE_INTEGER;
    },
  ],
  [
    'negative admitted time',
    (f) => {
      f.report.evidence.provenance.admittedAt = -1;
    },
  ],
  [
    'fractional admitted time',
    (f) => {
      f.report.evidence.provenance.admittedAt = 0.5;
    },
  ],
  [
    'unsafe deadline',
    (f) => {
      f.report.evidence.provenance.deadline = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    'fractional finished time',
    (f) => {
      f.report.evidence.provenance.finishedAt = 500.5;
    },
  ],
  [
    'finish before admission',
    (f) => {
      f.report.evidence.provenance.finishedAt = 99;
    },
  ],
  [
    'late completion',
    (f) => {
      f.report.evidence.provenance.finishedAt = 1101;
    },
  ],
  [
    'nonzero exit',
    (f) => {
      f.report.evidence.provenance.exitCode = 1;
    },
  ],
  [
    'OOM',
    (f) => {
      Object.assign(f.report.evidence.provenance, { oomKilled: true });
    },
  ],
  [
    'duplicate transfer path',
    (f) => {
      f.report.evidence.provenance.transfer.push({ ...f.report.evidence.provenance.transfer[0] });
      f.report.evidence.observations.manifest = structuredClone(
        f.report.evidence.provenance.transfer,
      );
    },
  ],
  [
    'noncanonical path',
    (f) => {
      f.report.evidence.provenance.transfer[0].path = 'src/../index.html';
    },
  ],
  [
    'oversized transfer file',
    (f) => {
      f.report.evidence.provenance.transfer[0].size = 1024 ** 2 + 1;
    },
  ],
  [
    'too many transfer files',
    (f) => {
      f.report.evidence.provenance.transfer = Array.from({ length: 1025 }, (_, i) => ({
        path: `src/${i}.html`,
        size: 0,
        sha256: otherHash,
      }));
    },
  ],
  [
    'total transfer size',
    (f) => {
      f.report.evidence.provenance.transfer = Array.from({ length: 33 }, (_, i) => ({
        path: `src/${i}.html`,
        size: 1024 ** 2,
        sha256: otherHash,
      }));
      f.report.evidence.observations.manifest = structuredClone(
        f.report.evidence.provenance.transfer,
      );
    },
  ],
  [
    'manifest disagreement',
    (f) => {
      f.report.evidence.observations.manifest[0].size++;
    },
  ],
  [
    'manifest comma-key substitute',
    (f) => {
      Object.assign(f.report.evidence.observations, {
        manifest: [{ 'path,size,sha256': 'src/index.html' }],
      });
    },
  ],
  [
    'wrong PNG MIME',
    (f) => {
      Object.assign(f.report.evidence.png, { mime: 'text/plain' });
    },
  ],
  [
    'PNG checksum mismatch',
    (f) => {
      f.report.evidence.png.sha256 = otherHash;
    },
  ],
  [
    'PNG size mismatch',
    (f) => {
      f.report.evidence.png.size++;
    },
  ],
  [
    'PNG corrupt bytes',
    (f) => {
      const bad = Buffer.from(png);
      bad[bad.length - 1] ^= 1;
      f.report.evidence.png = {
        mime: 'image/png',
        base64: bad.toString('base64'),
        size: bad.length,
        sha256: checksum(bad),
      };
    },
  ],
  [
    'noncanonical base64 whitespace',
    (f) => {
      f.report.evidence.png.base64 += '\n';
    },
  ],
  [
    'noncanonical base64 padding',
    (f) => {
      f.report.evidence.png.base64 = f.report.evidence.png.base64.replace(/=+$/, '');
    },
  ],
  [
    'empty PNG',
    (f) => {
      f.report.evidence.png.base64 = '';
      f.report.evidence.png.size = 0;
    },
  ],
  [
    'oversized PNG',
    (f) => {
      f.report.evidence.png.base64 = Buffer.alloc(4 * 1024 ** 2 + 1).toString('base64');
    },
  ],
  [
    'unknown stage',
    (f) => {
      f.report.evidence.observations.stage = 'unknown';
    },
  ],
  [
    'missing literal',
    (f) => {
      Object.assign(f.report.evidence.observations, { literal: undefined });
    },
  ],
  [
    'null complete literal',
    (f) => {
      f.report.evidence.observations.literal = null;
    },
  ],
  [
    'non-null failed literal',
    (f) => {
      f.report.evidence.observations.stage = 'startup-failed';
    },
  ],
  [
    'oversized literal',
    (f) => {
      f.report.evidence.observations.literal = 'x'.repeat(1025);
    },
  ],
  [
    'unknown event kind',
    (f) => {
      f.report.evidence.observations.events = [{ kind: 'other', text: '' }];
    },
  ],
  [
    'extra event field',
    (f) => {
      f.report.evidence.observations.events = [
        Object.assign({ kind: 'console', text: '' }, { extra: true }),
      ];
    },
  ],
  [
    'oversized event text',
    (f) => {
      f.report.evidence.observations.events = [{ kind: 'console', text: 'x'.repeat(1025) }];
    },
  ],
  [
    'event count',
    (f) => {
      f.report.evidence.observations.events = Array.from({ length: 33 }, () => ({
        kind: 'console',
        text: '',
      }));
    },
  ],
  [
    'event total bytes',
    (f) => {
      f.report.evidence.observations.events = Array.from({ length: 9 }, () => ({
        kind: 'console',
        text: 'x'.repeat(1024),
      }));
    },
  ],
  [
    'malformed present inspection hash',
    (f) => {
      f.report.evidence.provenance.applied = { inspectionSha256: 'not-a-hash' };
    },
  ],
  [
    'outcome contradiction',
    (f) => {
      f.report.outcome = { kind: 'candidate-failed' };
    },
  ],
  [
    'uppercase run UUID',
    (f) => {
      f.report.runId = 'AAAAAAAA-3333-3333-3333-333333333333';
    },
  ],
  [
    'invalid run UUID',
    (f) => {
      f.report.runId = 'invalid';
    },
  ],
];
for (const [name, mutate] of evidenceMutations) {
  test(`admitFrozenBrowserReport rejects ${name}`, () => {
    const f = fixture();
    mutate(f);
    invalid(f.expected, f.report);
  });
}
for (const field of [
  'contextSha256',
  'stdoutSha256',
  'stderrSha256',
  'buildStdoutSha256',
  'buildStderrSha256',
]) {
  test(`admitFrozenBrowserReport validates ${field} format without its preimage`, () => {
    const f = fixture();
    Object.assign(f.report.evidence.provenance, { [field]: 'not-a-hash' });
    invalid(f.expected, f.report);
  });
}
test('admitFrozenBrowserReport rejects late unrelated failure', () => {
  const f = fixture();
  f.report.outcome = { kind: 'unrelated-failure' };
  f.report.evidence.observations.literal = 'C';
  f.report.evidence.provenance.finishedAt = 1101;
  invalid(f.expected, f.report);
});
test('admitFrozenBrowserReport accepts exact deadline completion', () => {
  const f = fixture();
  f.report.evidence.provenance.finishedAt = 1100;
  const result = admitFrozenBrowserReport(f.expected, f.report);
  assert.equal(result.type, 'behavioral');
  if (result.type === 'behavioral') assert.equal(result.passed, true);
});

const outcomes: FrozenBrowserOutcome[] = [
  { kind: 'baseline-reproduced' },
  { kind: 'baseline-not-reproduced' },
  { kind: 'candidate-passed' },
  { kind: 'candidate-failed' },
  { kind: 'unrelated-failure' },
  { kind: 'infrastructure-failed', code: 'client-error' },
  { kind: 'cancelled', code: 'aborted' },
  { kind: 'uncertain', code: 'interrupted' },
];
function forOutcome(outcome: FrozenBrowserOutcome) {
  const role = outcome.kind.startsWith('baseline') ? 'baseline' : 'candidate';
  const literal = ['baseline-reproduced', 'candidate-failed'].includes(outcome.kind) ? 'A' : 'B';
  const f = fixture(role, literal);
  f.report.outcome = outcome;
  if (outcome.kind === 'unrelated-failure') f.report.evidence.observations.literal = 'C';
  return f;
}
for (const outcome of outcomes) {
  test(`admitFrozenBrowserReport handles ${outcome.kind} only after full validation`, () => {
    const f = forOutcome(outcome);
    const report = {
      ...f.report,
      cleanup: { kind: 'incomplete', cache: 'retained', code: 'cleanup-failed' },
    };
    assert.deepEqual(admitFrozenBrowserReport(f.expected, report), {
      type: 'blocked',
      report,
      reason: 'cleanup-incomplete',
    });
    invalid(f.expected, { ...report, runId: 'invalid' });
    invalid(f.expected, {
      ...report,
      evidence: { ...report.evidence, png: { ...report.evidence.png, sha256: otherHash } },
    });
    invalid(f.expected, { ...f.report, cleanup: { kind: 'not-needed', cache: 'retained' } });
    const needsEvidence = !['infrastructure-failed', 'cancelled', 'uncertain'].includes(
      outcome.kind,
    );
    if (needsEvidence) invalid(f.expected, { ...f.report, evidence: null });
    else {
      const reason = outcome.kind === 'infrastructure-failed' ? 'infrastructure' : outcome.kind;
      blocked(f, reason);
      for (const kind of ['not-needed', 'owned-removed', 'incomplete']) {
        const cleanup =
          kind === 'incomplete'
            ? { kind, cache: 'retained', code: 'cleanup-failed' }
            : { kind, cache: 'retained' };
        const emptyReport = { ...f.report, cleanup, evidence: null };
        assert.deepEqual(admitFrozenBrowserReport(f.expected, emptyReport), {
          type: 'blocked',
          report: emptyReport,
          reason: kind === 'incomplete' ? 'cleanup-incomplete' : reason,
        });
      }
    }
  });
}
test('admitFrozenBrowserReport does not promote cancelled B or require timely classification for retained diagnostic evidence', () => {
  for (const outcome of outcomes.slice(5)) {
    const f = fixture();
    f.report.outcome = outcome;
    f.report.evidence.provenance.finishedAt = 2000;
    blocked(f, outcome.kind === 'infrastructure-failed' ? 'infrastructure' : outcome.kind);
    f.report.evidence.provenance.configurationDigest = sha256(otherHash);
    invalid(f.expected, f.report);
  }
});

for (const [name, mutate] of [
  [
    'report',
    (f: Fixture) => {
      Object.assign(f.report, { extra: true });
    },
  ],
  [
    'request',
    (f: Fixture) => {
      Object.assign(f.report.request, { extra: true });
    },
  ],
  [
    'frozen tuple',
    (f: Fixture) => {
      Object.assign(f.report.request.frozen, { extra: true });
    },
  ],
  [
    'action',
    (f: Fixture) => {
      Object.assign(f.report.request.action, { extra: true });
    },
  ],
  [
    'outcome',
    (f: Fixture) => {
      Object.assign(f.report.outcome, { extra: true });
    },
  ],
  [
    'cleanup',
    (f: Fixture) => {
      Object.assign(f.report.cleanup, { extra: true });
    },
  ],
  [
    'evidence',
    (f: Fixture) => {
      Object.assign(f.report.evidence, { extra: true });
    },
  ],
  [
    'provenance',
    (f: Fixture) => {
      Object.assign(f.report.evidence.provenance, { extra: true });
    },
  ],
  [
    'evidence frozen tuple',
    (f: Fixture) => {
      Object.assign(f.report.evidence.provenance.frozen, { extra: true });
    },
  ],
  [
    'transfer entry',
    (f: Fixture) => {
      Object.assign(f.report.evidence.provenance.transfer[0], { extra: true });
    },
  ],
  [
    'PNG',
    (f: Fixture) => {
      Object.assign(f.report.evidence.png, { extra: true });
    },
  ],
  [
    'expectation',
    (f: Fixture) => {
      Object.assign(f.expected, { extra: true });
    },
  ],
] as const) {
  test(`admitFrozenBrowserReport rejects extra keys on fixed ${name} shape`, () => {
    const f = fixture();
    mutate(f);
    invalid(f.expected, f.report);
  });
}
test('admitFrozenBrowserReport rejects comma-key substitutes', () => {
  const f = fixture();
  invalid(f.expected, { 'runId,request,outcome,cleanup,evidence': f.report });
  invalid({ 'configurationDigest,kind,request': f.expected }, f.report);
  invalid(f.expected, { ...f.report, cleanup: { 'cache,kind': 'retained' } });
});

const unsafeValues: [string, () => unknown][] = [
  ['undefined', () => undefined],
  ['bigint', () => 1n],
  ['NaN', () => NaN],
  ['infinity', () => Infinity],
  ['function', () => () => {}],
  ['symbol value', () => Symbol('bad')],
  ['ill-formed string', () => '\ud800'],
  ['ill-formed key', () => ({ ['\ud800']: true })],
  ['date', () => new Date(0)],
  ['buffer', () => Buffer.from('x')],
  ['map', () => new Map()],
  ['boxed number', () => new Number(1)],
  ['custom prototype', () => Object.create({ inherited: true })],
  ['sparse array', () => Array(2)],
  ['decorated array', () => Object.assign([], { decoration: true })],
  ['array with hidden property', () => Object.defineProperty([], 'hidden', { value: true })],
  ['array with symbol', () => Object.assign([], { [Symbol('hidden')]: true })],
  ['array subclass', () => new (class extends Array {})()],
  ['null-prototype array', () => Object.setPrototypeOf([], null)],
  ['hidden property', () => Object.defineProperty({}, 'hidden', { value: true })],
  ['symbol key', () => ({ [Symbol('hidden')]: true })],
  [
    'cycle',
    () => {
      const value: Record<string, unknown> = {};
      value.self = value;
      return value;
    },
  ],
  [
    'depth limit',
    () => {
      let value: unknown = null;
      for (let i = 0; i < 33; i++) value = { nested: value };
      return value;
    },
  ],
  ['node limit', () => Array.from({ length: 100000 }, () => null)],
  ['byte limit', () => 'x'.repeat(9 * 1024 ** 2)],
  ['escaped byte limit', () => '\0'.repeat(2 * 1024 ** 2)],
];
for (const [name, make] of unsafeValues) {
  test(`admitFrozenBrowserReport rejects ${name} before parsing either argument`, () => {
    const f = fixture();
    const report = structuredClone(f.report);
    Object.assign(report.evidence.provenance.assets, { unsafe: make() });
    invalid(f.expected, report);
    const expected = structuredClone(f.expected);
    Object.assign(expected, { unsafe: make() });
    invalid(expected, f.report);
  });
}
test('admitFrozenBrowserReport rejects inherited required fields', () => {
  const f = fixture();
  invalid(f.expected, Object.create(f.report));
  invalid(Object.create(f.expected), f.report);
});
test('admitFrozenBrowserReport never invokes getters, serialization hooks, or proxy traps in either argument', () => {
  const f = fixture();
  let calls = 0;
  const execute = () => {
    calls++;
    throw Error('caller code executed');
  };
  const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: execute });
  const hook = { toJSON: execute };
  const proxy = new Proxy(
    {},
    {
      get: execute,
      getPrototypeOf: execute,
      ownKeys: execute,
      getOwnPropertyDescriptor: execute,
    },
  );
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const unsafe of [accessor, hook, proxy, revoked.proxy]) {
    invalid(unsafe, f.report);
    invalid(f.expected, unsafe);
    invalid({ ...f.expected, unsafe }, f.report);
    invalid(f.expected, {
      ...f.report,
      evidence: {
        ...f.report.evidence,
        provenance: { ...f.report.evidence.provenance, assets: { unsafe } },
      },
    });
  }
  const expectedGetter = Object.defineProperty({ ...f.expected }, 'request', {
    enumerable: true,
    get: execute,
  });
  const reportGetter = Object.defineProperty({ ...f.report }, 'evidence', {
    enumerable: true,
    get: execute,
  });
  invalid(expectedGetter, f.report);
  invalid(f.expected, reportGetter);
  assert.equal(calls, 0);
});
test('admitFrozenBrowserReport safely copies null prototypes and own __proto__ data', () => {
  const f = fixture();
  const assets = Object.create(null);
  Object.defineProperty(assets, '__proto__', { enumerable: true, value: { claimed: true } });
  f.report.evidence.provenance.assets = assets;
  Object.setPrototypeOf(f.expected, null);
  const result = admitFrozenBrowserReport(f.expected, f.report);
  assert.equal(result.type, 'behavioral');
  assert.equal(Object.getPrototypeOf(result.report.evidence!.provenance.assets), Object.prototype);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(result.report.evidence!.provenance.assets, '__proto__')!.value,
    { claimed: true },
  );
  assert.equal(Object.hasOwn(Object.prototype, 'claimed'), false);
});
test('admitFrozenBrowserReport detaches inputs, reports, and bytes across repeated calls', () => {
  const f = fixture();
  const original = structuredClone(f);
  const first = admitFrozenBrowserReport(f.expected, f.report);
  const second = admitFrozenBrowserReport(f.expected, f.report);
  assert.deepEqual(first, second);
  assert.notEqual(first.report, second.report);
  assert.notEqual(first.report.request, f.report.request);
  assert.notEqual(first.report.request, f.expected.request);
  if (first.type !== 'behavioral' || second.type !== 'behavioral')
    assert.fail('expected behavioral');
  assert.notEqual(first.outputs[0].bytes, second.outputs[0].bytes);
  first.outputs[0].bytes[0] = 0;
  Object.assign(first.report.evidence.provenance.frozen, { revision: 'f'.repeat(40) });
  Object.assign(first.report.evidence.observations, { literal: 'A' });
  assert.deepEqual(f, original);
  assert.deepEqual(second.outputs[0].bytes, png);
  assert.deepEqual(second.report, original.report);
  Object.assign(f.expected.request.action, { epoch: 99 });
  f.report.evidence.provenance.transfer[0].size = 99;
  assert.deepEqual(second.report, original.report);
  assert.deepEqual(admitFrozenBrowserReport(original.expected, original.report), second);
});
test('admitFrozenBrowserReport detaches blocked diagnostic evidence and never exposes outputs', () => {
  const f = fixture();
  f.report.outcome = { kind: 'cancelled', code: 'aborted' };
  const result = admitFrozenBrowserReport(f.expected, f.report);
  assert.deepEqual(result, { type: 'blocked', reason: 'cancelled', report: f.report });
  Object.assign(result.report.evidence!.observations, { literal: 'A' });
  assert.equal(f.report.evidence.observations.literal, 'B');
  blocked(f, 'cancelled');
});
test('admitFrozenBrowserReport does not require an inspection hash in opaque applied claims', () => {
  const f = fixture();
  assert.deepEqual(admitFrozenBrowserReport(f.expected, f.report), {
    type: 'behavioral',
    report: f.report,
    passed: true,
    outputs: [{ label: 'Frozen browser screenshot', mime: 'image/png', bytes: png }],
  });
});

test('admitFrozenBrowserReport accepts fabricated unsafe containment claims without authenticating them', () => {
  const f = fixture();
  f.report.evidence.provenance.assets = { forged: true };
  f.report.evidence.provenance.applied = {
    hostConfig: { Privileged: true, NetworkMode: 'host' },
    inspectionSha256: otherHash,
  };
  Object.assign(f.report.evidence.observations, {
    processes: [],
    sandboxText: 'sandbox disabled',
    restrictions: { egress: 'allowed' },
    budgets: { 'memory.max': 'max' },
    untrustedText: '<script>not sanitized</script>',
  });
  assert.deepEqual(admitFrozenBrowserReport(f.expected, f.report), {
    type: 'behavioral',
    report: f.report,
    passed: true,
    outputs: [{ label: 'Frozen browser screenshot', mime: 'image/png', bytes: png }],
  });
});

function profileFixture(role: 'baseline' | 'candidate' = 'candidate') {
  const f = fixture(role);
  const request = frozenBrowserRequest({ ...f.report.request, scenarioId: 'profile-name-v1' });
  const expected = { ...f.expected, request } as FrozenBrowserExpectation;
  const report: import('../src/frozen-browser.ts').FrozenBrowserReport = {
    ...f.report,
    request,
    evidence: structuredClone(f.report.evidence),
    outcome: { kind: role === 'baseline' ? 'baseline-reproduced' : 'candidate-passed' },
  };
  const evidence = report.evidence!;
  Object.assign(evidence.provenance, { requestDigest: digest(request) });
  Object.assign(evidence.provenance, {
    transfer: [
      {
        path: 'src/lib/errors.js',
        size: 525,
        sha256: '5fa6710bb0c4f120408d489d0b16f6a21bfc6e539081ab1d9fda7a3bddb1fa07',
      },
    ],
  });
  Object.assign(evidence, {
    observations: {
      stage: 'complete',
      scenarioId: 'profile-name-v1',
      events: [],
      manifest: structuredClone(evidence.provenance.transfer),
      profile: {
        definitionSha256: checksum(Buffer.from(JSON.stringify(profileNameDefinition))),
        actuals: [
          { caseId: 'missing-profile', kind: 'returned', value: 'Anonymous' },
          { caseId: 'trimmed-name', kind: 'returned', value: 'Ada Lovelace' },
          { caseId: 'second-name', kind: 'returned', value: 'gRaCe Hopper' },
          { caseId: 'blank-name', kind: 'returned', value: 'Anonymous' },
          { caseId: 'missing-name', kind: 'returned', value: 'Anonymous' },
          { caseId: 'null-name', kind: 'returned', value: 'Anonymous' },
          { caseId: 'null-profile', kind: 'returned', value: 'Anonymous' },
          { caseId: 'null-user', kind: 'returned', value: 'Anonymous' },
          { caseId: 'undefined-user', kind: 'returned', value: 'Anonymous' },
        ],
        diagnostic: null,
      },
    },
  });
  if (role === 'baseline') {
    const p = evidence.observations.profile as Record<string, unknown>;
    p.actuals = (p.actuals as Record<string, unknown>[]).map((v, i) =>
      i === 0 ? { caseId: 'missing-profile', kind: 'threw' } : v,
    );
    p.diagnostic = structuredClone(profileNameDefinition.diagnostic);
  }
  return {
    expected,
    report,
    observed: evidence.observations,
    profile: evidence.observations.profile as Record<string, unknown>,
  };
}

test('profile-name-v1 request preserves exact scenario without new request fields', () => {
  const f = profileFixture();
  assert.equal(f.expected.request.scenarioId, 'profile-name-v1');
  for (const change of [
    { scenarioId: 'profile-name-v2' },
    { capture: {} },
    { selector: '#result' },
  ])
    assert.throws(() => frozenBrowserRequest({ ...f.expected.request, ...change }));
});

test('profile-name-v1 admits exact strings and pinned native reproduction independently', () => {
  for (const role of ['candidate', 'baseline'] as const) {
    const f = profileFixture(role);
    const result = admitFrozenBrowserReport(f.expected, f.report);
    assert.equal(result.type, 'behavioral');
    assert.equal(result.type === 'behavioral' && result.passed, true);
    assert.deepEqual(result.report.outcome, {
      kind: role === 'candidate' ? 'candidate-passed' : 'baseline-reproduced',
    });
  }
});

for (const [name, actual] of [
  ['wrong case', { caseId: 'trimmed-name', kind: 'returned', value: 'ADA LOVELACE' }],
  ['untrimmed', { caseId: 'trimmed-name', kind: 'returned', value: '  Ada Lovelace  ' }],
  ['fallback', { caseId: 'trimmed-name', kind: 'returned', value: 'Anonymous' }],
  ['exception', { caseId: 'trimmed-name', kind: 'threw' }],
  ['invalid return', { caseId: 'trimmed-name', kind: 'invalid-return' }],
] as const) {
  test(`profile-name-v1 rejects promotion of ${name}`, () => {
    const f = profileFixture();
    (f.profile.actuals as unknown[])[1] = actual;
    invalid(f.expected, f.report);
    const report = { ...f.report, outcome: { kind: 'candidate-failed' as const } };
    const result = admitFrozenBrowserReport(f.expected, report);
    assert.equal(result.type, 'behavioral');
    assert.equal(result.type === 'behavioral' && result.passed, false);
  });
}

for (const name of [
  'definition',
  'order',
  'truncated',
  'extra',
  'diagnostic',
  'helper hash',
  'helper size',
  'scenario',
  'literal',
  'event',
] as const) {
  test(`profile-name-v1 rejects forged ${name}`, () => {
    const f = profileFixture('baseline');
    if (name === 'definition') f.profile.definitionSha256 = 'a'.repeat(64);
    if (name === 'order') (f.profile.actuals as unknown[]).reverse();
    if (name === 'truncated') (f.profile.actuals as unknown[]).pop();
    if (name === 'extra')
      (f.profile.actuals as unknown[]).push({
        caseId: 'forged',
        kind: 'returned',
        value: 'Anonymous',
      });
    if (name === 'diagnostic')
      (f.profile.diagnostic as Record<string, unknown>).message = 'forged TypeError';
    if (name === 'helper hash' || name === 'helper size') {
      const transfer = f.report.evidence!.provenance.transfer;
      if (name === 'helper hash') transfer[0].sha256 = 'a'.repeat(64);
      else transfer[0].size = 526;
      f.observed.manifest = structuredClone(transfer);
    }
    if (name === 'scenario') f.observed.scenarioId = 'synthetic-click-v1';
    if (name === 'literal') f.observed.literal = 'B';
    if (name === 'event') f.observed.events = [{ kind: 'page-error', text: 'late' }];
    invalid(f.expected, f.report);
  });
}

test('profile-name-v1 cannot replay a synthetic report or relabel a profile vector', () => {
  const f = profileFixture();
  invalid(f.expected, fixture().report);
  const request = frozenBrowserRequest({ ...f.report.request, scenarioId: 'synthetic-click-v1' });
  const report = structuredClone(f.report);
  Object.assign(report.evidence!.provenance, { requestDigest: digest(request) });
  invalid({ ...f.expected, request }, { ...report, request });
});

test('profile-name-v1 requires the diagnostic as well as the reviewed helper identity', () => {
  const f = profileFixture('baseline');
  f.profile.diagnostic = null;
  invalid(f.expected, f.report);
  assert.equal(
    admitFrozenBrowserReport(f.expected, {
      ...f.report,
      outcome: { kind: 'baseline-not-reproduced' },
    }).report.outcome.kind,
    'baseline-not-reproduced',
  );
  f.report.evidence!.provenance.transfer[0].sha256 = 'b'.repeat(64);
  f.observed.manifest = structuredClone(f.report.evidence!.provenance.transfer);
  invalid(f.expected, f.report);
  const blocked = admitFrozenBrowserReport(f.expected, {
    ...f.report,
    outcome: { kind: 'unrelated-failure' },
  });
  assert.equal(blocked.type, 'blocked');
  assert.equal(blocked.type === 'blocked' && blocked.reason, 'unrelated-failure');
});
