import test from 'node:test';
import assert from 'node:assert/strict';
import {
  admitFrozenBrowserConsumedReport,
  admitFrozenBrowserReport,
  frozenBrowserRequest,
  FrozenBrowserValidator,
} from '../src/frozen-browser.ts';
import type {
  FrozenBrowserConsumedExpectation,
  FrozenBrowserOutcome,
  FrozenBrowserExpectation,
} from '../src/frozen-browser.ts';
import { ControlError, digest } from '../src/domain.ts';
import { checksum } from '../src/artifacts.ts';
import { sha256 } from '../src/workspace.ts';

const caseId = '11111111-1111-1111-1111-111111111111';
const actionId = '22222222-2222-2222-2222-222222222222';
const runId = '33333333-3333-3333-3333-333333333333';
const acceptanceId = '44444444-4444-4444-4444-444444444444';
const hash = 'b'.repeat(64);
const configurationDigest = sha256('a'.repeat(64));
const png = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c6360000200000500017a5eab3f0000000049454e44ae426082',
  'hex',
);

function fixture(role: 'baseline' | 'candidate' = 'candidate', literal = 'B') {
  const request = frozenBrowserRequest({
    frozen: { caseId, revision: 'c'.repeat(40), manifestDigest: 'd'.repeat(64) },
    action: { caseId, actionId, epoch: 2 },
    scenarioId: 'synthetic-click-v1',
    role,
    allowanceMs: 1000,
  });
  const consumedRun = { acceptanceId, runId, requestDigest: sha256(digest(request)) };
  const expected = {
    kind: role === 'baseline' ? 'baseline' : 'browser',
    configurationDigest,
    request: structuredClone(request),
    consumedRun: structuredClone(consumedRun),
    admittedAt: 100,
    deadline: 600,
  } as FrozenBrowserConsumedExpectation;
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
    consumedRun,
    admittedAt: 100,
    deadline: 600,
    state: 'settled',
    report: {
      runId,
      request,
      outcome: { kind } as FrozenBrowserOutcome,
      cleanup: { kind: 'owned-removed', cache: 'retained' },
      evidence: {
        provenance: {
          requestDigest: digest(request),
          configurationDigest,
          frozen: structuredClone(request.frozen),
          transfer: manifest,
          contextBytes: 1024,
          contextSha256: hash,
          assets: {},
          policy: {},
          engine: {},
          baseBefore: {},
          baseAfter: {},
          imageId: `sha256:${hash}`,
          containerId: hash,
          applied: {},
          admittedAt: 100,
          deadline: 600,
          finishedAt: 500,
          exitCode: 0,
          oomKilled: false,
          stdoutSha256: hash,
          stderrSha256: hash,
          buildStdoutSha256: hash,
          buildStderrSha256: hash,
        },
        observations: {
          stage: 'complete',
          literal: literal as string | null,
          events: [] as { kind: string; text: string }[],
          manifest: structuredClone(manifest),
        },
        png: {
          mime: 'image/png',
          size: 68,
          sha256: '43739c566e26fd7cb88f69d3864ea34740372f5ee99acac169e090beffbce5c6',
          base64:
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
        },
      },
    },
  };
  return { expected, history };
}
type Fixture = ReturnType<typeof fixture>;
function invalid(expected: unknown, history: unknown) {
  assert.throws(
    () => admitFrozenBrowserConsumedReport(expected as FrozenBrowserConsumedExpectation, history),
    (error: unknown) =>
      error instanceof ControlError && error.code === 'invalid-frozen-browser-admission',
  );
}
function behavioral(f: Fixture, passed = true) {
  const result = admitFrozenBrowserConsumedReport(f.expected, f.history);
  assert.deepEqual(result, {
    type: 'behavioral',
    report: f.history.report,
    passed,
    outputs: [{ label: 'Frozen browser screenshot', mime: 'image/png', bytes: png }],
  });
  return result;
}
function blocked(f: Fixture, reason: string) {
  assert.deepEqual(admitFrozenBrowserConsumedReport(f.expected, f.history), {
    type: 'blocked',
    report: f.history.report,
    reason,
  });
}
function ordinaryExpectation(f: Fixture) {
  const { kind, request, configurationDigest } = f.expected;
  return { kind, request, configurationDigest } as FrozenBrowserExpectation;
}
function setTiming(f: Fixture, admittedAt: number, deadline: number, finishedAt = deadline) {
  Object.assign(f.expected, { admittedAt, deadline });
  Object.assign(f.history, { admittedAt, deadline });
  Object.assign(f.history.report.evidence.provenance, { admittedAt, deadline, finishedAt });
}

for (const [role, literal, kind, passed] of [
  ['baseline', 'A', 'baseline-reproduced', true],
  ['baseline', 'B', 'baseline-not-reproduced', false],
  ['candidate', 'B', 'candidate-passed', true],
  ['candidate', 'A', 'candidate-failed', false],
] as const)
  test(`admitFrozenBrowserConsumedReport converts shortened ${kind} without rewriting the request`, () => {
    const f = fixture(role, literal);
    assert.deepEqual(behavioral(f, passed).report.outcome, { kind });
    assert.throws(
      () => admitFrozenBrowserReport(ordinaryExpectation(f), f.history.report),
      /invalid-frozen-browser-admission/,
    );
    assert.equal(f.history.report.request.allowanceMs, 1000);
    assert.equal(
      f.history.report.evidence.provenance.requestDigest,
      f.expected.consumedRun.requestDigest,
    );
    assert.equal(f.history.report.evidence.provenance.deadline, 600);
  });

test('admitFrozenBrowserConsumedReport full-allowance conversion equals ordinary admission', () => {
  const f = fixture();
  setTiming(f, 100, 1100);
  behavioral(f);
  assert.deepEqual(
    admitFrozenBrowserConsumedReport(f.expected, f.history),
    admitFrozenBrowserReport(ordinaryExpectation(f), f.history.report),
  );
});

for (const [admittedAt, deadline] of [
  [0, 1],
  [0, 1000],
  [100, 600],
  [Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER],
])
  test(`admitFrozenBrowserConsumedReport accepts safe endpoints ${admittedAt}/${deadline} and exact deadline finish`, () => {
    const f = fixture();
    setTiming(f, admittedAt, deadline);
    behavioral(f);
    if (admittedAt === Number.MAX_SAFE_INTEGER - 1)
      assert.throws(
        () => admitFrozenBrowserReport(ordinaryExpectation(f), f.history.report),
        /invalid-frozen-browser-admission/,
      );
  });

for (const [name, mutate] of [
  [
    'acceptance identity',
    (f: Fixture) => {
      f.history.consumedRun.acceptanceId = caseId;
    },
  ],
  [
    'run identity',
    (f: Fixture) => {
      f.history.consumedRun.runId = caseId;
    },
  ],
  [
    'request digest',
    (f: Fixture) => {
      f.history.consumedRun.requestDigest = sha256(hash);
    },
  ],
  [
    'report run identity',
    (f: Fixture) => {
      f.history.report.runId = caseId;
    },
  ],
  [
    'mixed run identities',
    (f: Fixture) => {
      f.history.consumedRun.runId = f.history.report.runId = caseId;
    },
  ],
  [
    'malformed acceptance UUID',
    (f: Fixture) => {
      f.history.consumedRun.acceptanceId = 'invalid';
    },
  ],
  [
    'uppercase run UUID',
    (f: Fixture) => {
      f.history.consumedRun.runId = 'AAAAAAAA-3333-3333-3333-333333333333';
    },
  ],
  [
    'uppercase selector digest',
    (f: Fixture) => {
      f.history.consumedRun.requestDigest = sha256(
        hash,
      ).toUpperCase() as typeof f.history.consumedRun.requestDigest;
    },
  ],
  [
    'configuration',
    (f: Fixture) => {
      Object.assign(f.expected, { configurationDigest: hash });
    },
  ],
  [
    'malformed independent configuration',
    (f: Fixture) => {
      Object.assign(f.expected, { configurationDigest: 'invalid' });
    },
  ],
  [
    'kind-role pairing',
    (f: Fixture) => {
      Object.assign(f.expected, { kind: 'baseline' });
    },
  ],
  [
    'unknown kind',
    (f: Fixture) => {
      Object.assign(f.expected, { kind: 'unit' });
    },
  ],
] as const)
  test(`admitFrozenBrowserConsumedReport rejects ${name}`, () => {
    const f = fixture();
    mutate(f);
    invalid(f.expected, f.history);
  });

for (const field of ['acceptanceId', 'runId', 'requestDigest'] as const)
  test(`admitFrozenBrowserConsumedReport validates independently pinned selector ${field}`, () => {
    const f = fixture();
    Object.assign(f.expected.consumedRun, { [field]: field === 'requestDigest' ? hash : caseId });
    invalid(f.expected, f.history);
    if (field === 'requestDigest') {
      f.history.consumedRun.requestDigest = sha256(hash);
      f.history.report.evidence.provenance.requestDigest = hash;
      invalid(f.expected, f.history);
    }
  });

const requestMutations: [string, (r: Record<string, unknown>) => void][] = [
  [
    'frozen case',
    (r) => {
      Object.assign(r.frozen as object, { caseId: acceptanceId });
    },
  ],
  [
    'action case',
    (r) => {
      Object.assign(r.action as object, { caseId: acceptanceId });
    },
  ],
  [
    'revision',
    (r) => {
      Object.assign(r.frozen as object, { revision: 'f'.repeat(40) });
    },
  ],
  [
    'manifest',
    (r) => {
      Object.assign(r.frozen as object, { manifestDigest: hash });
    },
  ],
  [
    'action',
    (r) => {
      Object.assign(r.action as object, { actionId: acceptanceId });
    },
  ],
  [
    'epoch',
    (r) => {
      Object.assign(r.action as object, { epoch: 3 });
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
      r.allowanceMs = 500;
    },
  ],
];
for (const [name, mutate] of requestMutations)
  test(`admitFrozenBrowserConsumedReport rejects mismatched ${name} in either request`, () => {
    for (const side of ['expected', 'report']) {
      const f = fixture();
      mutate(side === 'expected' ? f.expected.request : f.history.report.request);
      if (side === 'expected') {
        const pinnedDigest = sha256(digest(f.expected.request));
        Object.assign(f.expected.consumedRun, { requestDigest: pinnedDigest });
        f.history.consumedRun.requestDigest = pinnedDigest;
        f.history.report.evidence.provenance.requestDigest = pinnedDigest;
      }
      invalid(f.expected, f.history);
    }
  });

for (const [name, select] of [
  ['expectation', (f: Fixture) => f.expected],
  ['expected selector', (f: Fixture) => f.expected.consumedRun],
  ['history', (f: Fixture) => f.history],
  ['history selector', (f: Fixture) => f.history.consumedRun],
  ['report', (f: Fixture) => f.history.report],
] as const)
  test(`admitFrozenBrowserConsumedReport requires exact ${name} fields`, () => {
    for (const key of Object.keys(select(fixture()))) {
      const f = fixture();
      Reflect.deleteProperty(select(f), key);
      invalid(f.expected, f.history);
    }
    const f = fixture();
    Object.assign(select(f), { extra: true });
    invalid(f.expected, f.history);
  });

test('admitFrozenBrowserConsumedReport rejects bare reports, nonsettled states and comma-key substitutes', () => {
  const f = fixture();
  for (const history of [
    f.history.report,
    null,
    undefined,
    [],
    ...['pending', 'recorded', 'unknown'].flatMap((state) => [
      { ...f.history, state },
      { consumedRun: f.history.consumedRun, admittedAt: 100, deadline: 600, state },
    ]),
    { 'consumedRun,admittedAt,deadline,state,report': f.history },
    { ...f.history, consumedRun: { 'acceptanceId,runId,requestDigest': f.history.consumedRun } },
  ])
    invalid(f.expected, history);
  invalid(
    { 'configurationDigest,kind,request,consumedRun,admittedAt,deadline': f.expected },
    f.history,
  );
});

for (const field of ['admittedAt', 'deadline'] as const)
  for (const location of ['expected', 'history', 'provenance', 'coordinated'] as const)
    test(`admitFrozenBrowserConsumedReport rejects ${location} ${field} mismatch against independent pins`, () => {
      const f = fixture();
      const p = f.history.report.evidence.provenance;
      if (location === 'expected') Object.assign(f.expected, { [field]: f.expected[field] + 1 });
      if (location === 'history' || location === 'coordinated') f.history[field]++;
      if (location === 'provenance' || location === 'coordinated') p[field]++;
      invalid(f.expected, f.history);
    });

for (const [admittedAt, deadline] of [
  [-1, 600],
  [0.5, 600],
  [100, -1],
  [100, 600.5],
  [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 2],
  [100, Number.MAX_SAFE_INTEGER + 1],
  [100, 100],
  [100, 99],
  [100, 1101],
  [NaN, 600],
  [100, Infinity],
])
  test(`admitFrozenBrowserConsumedReport rejects invalid interval ${admittedAt}/${deadline} even with null evidence`, () => {
    const f = fixture();
    setTiming(f, admittedAt, deadline);
    invalid(f.expected, f.history);
    const report = {
      ...f.history.report,
      outcome: { kind: 'cancelled', code: 'aborted' },
      evidence: null,
    };
    invalid(f.expected, { ...f.history, report });
  });

const outcomes: [FrozenBrowserOutcome, string | null, string][] = [
  [{ kind: 'baseline-reproduced' }, null, 'A'],
  [{ kind: 'baseline-not-reproduced' }, null, 'B'],
  [{ kind: 'candidate-passed' }, null, 'B'],
  [{ kind: 'candidate-failed' }, null, 'A'],
  [{ kind: 'unrelated-failure' }, 'unrelated-failure', 'C'],
  [{ kind: 'infrastructure-failed', code: 'client-error' }, 'infrastructure', 'B'],
  [{ kind: 'cancelled', code: 'aborted' }, 'cancelled', 'B'],
  [{ kind: 'uncertain', code: 'interrupted' }, 'uncertain', 'B'],
];
for (const [outcome, reason, literal] of outcomes)
  test(`admitFrozenBrowserConsumedReport preserves ${outcome.kind} cleanup precedence and evidence requirements`, () => {
    const f = fixture(outcome.kind.startsWith('baseline') ? 'baseline' : 'candidate', literal);
    f.history.report.outcome = outcome;
    if (reason) blocked(f, reason);
    Object.assign(f.history.report.cleanup, { kind: 'incomplete', code: 'cleanup-failed' });
    blocked(f, 'cleanup-incomplete');
    f.history.report.evidence.png.sha256 = hash;
    invalid(f.expected, f.history);
    const needsEvidence = !['infrastructure-failed', 'cancelled', 'uncertain'].includes(
      outcome.kind,
    );
    for (const kind of ['not-needed', 'owned-removed', 'incomplete']) {
      const cleanup =
        kind === 'incomplete'
          ? { kind, cache: 'retained', code: 'cleanup-failed' }
          : { kind, cache: 'retained' };
      const report = { ...f.history.report, cleanup, evidence: null };
      if (needsEvidence) invalid(f.expected, { ...f.history, report });
      else
        assert.deepEqual(admitFrozenBrowserConsumedReport(f.expected, { ...f.history, report }), {
          type: 'blocked',
          report,
          reason: kind === 'incomplete' ? 'cleanup-incomplete' : reason,
        });
    }
  });

for (const [outcome, reason] of outcomes.slice(5))
  test(`admitFrozenBrowserConsumedReport permits late ${outcome.kind} diagnostic evidence but still validates it`, () => {
    const f = fixture();
    f.history.report.outcome = outcome;
    f.history.report.evidence.provenance.finishedAt = 2000;
    blocked(f, reason!);
    f.history.report.evidence.provenance.configurationDigest = sha256(hash);
    invalid(f.expected, f.history);
  });

test('admitFrozenBrowserConsumedReport validates null-evidence configuration without inventing provenance or ordinary timing rules', () => {
  const f = fixture();
  setTiming(f, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER);
  const report = {
    ...f.history.report,
    outcome: { kind: 'cancelled', code: 'aborted' },
    evidence: null,
  };
  const history = { ...f.history, report };
  const result = { type: 'blocked', reason: 'cancelled', report };
  assert.deepEqual(
    admitFrozenBrowserConsumedReport({ ...f.expected, configurationDigest: sha256(hash) }, history),
    result,
  );
  assert.deepEqual(admitFrozenBrowserReport(ordinaryExpectation(f), report), result);
  invalid({ ...f.expected, configurationDigest: 'invalid' }, history);
});

const evidenceMutations: [string, (f: Fixture) => void][] = [
  [
    'request digest',
    (f) => {
      f.history.report.evidence.provenance.requestDigest = hash;
    },
  ],
  [
    'configuration',
    (f) => {
      f.history.report.evidence.provenance.configurationDigest = sha256(hash);
    },
  ],
  [
    'frozen identity',
    (f) => {
      Object.assign(f.history.report.evidence.provenance.frozen, { revision: 'f'.repeat(40) });
    },
  ],
  [
    'fractional finish',
    (f) => {
      f.history.report.evidence.provenance.finishedAt = 500.5;
    },
  ],
  [
    'finish before admission',
    (f) => {
      f.history.report.evidence.provenance.finishedAt = 99;
    },
  ],
  [
    'late observed finish',
    (f) => {
      f.history.report.evidence.provenance.finishedAt = 601;
    },
  ],
  [
    'exit',
    (f) => {
      f.history.report.evidence.provenance.exitCode = 1;
    },
  ],
  [
    'OOM',
    (f) => {
      f.history.report.evidence.provenance.oomKilled = true;
    },
  ],
  [
    'inspection hash',
    (f) => {
      Object.assign(f.history.report.evidence.provenance.applied, { inspectionSha256: 'bad' });
    },
  ],
  [
    'duplicate paths',
    (f) => {
      f.history.report.evidence.provenance.transfer.push({
        ...f.history.report.evidence.provenance.transfer[0],
      });
      f.history.report.evidence.observations.manifest = structuredClone(
        f.history.report.evidence.provenance.transfer,
      );
    },
  ],
  [
    'manifest mismatch',
    (f) => {
      f.history.report.evidence.observations.manifest[0].size++;
    },
  ],
  [
    'noncanonical path',
    (f) => {
      f.history.report.evidence.provenance.transfer[0].path = '../index.html';
    },
  ],
  [
    'total transfer budget',
    (f) => {
      const transfer = Array.from({ length: 33 }, (_, i) => ({
        path: `src/${i}`,
        size: 1024 ** 2,
        sha256: hash,
      }));
      f.history.report.evidence.provenance.transfer = transfer;
      f.history.report.evidence.observations.manifest = structuredClone(transfer);
    },
  ],
  [
    'PNG MIME',
    (f) => {
      f.history.report.evidence.png.mime = 'text/plain';
    },
  ],
  [
    'PNG size',
    (f) => {
      f.history.report.evidence.png.size++;
    },
  ],
  [
    'PNG digest',
    (f) => {
      f.history.report.evidence.png.sha256 = hash;
    },
  ],
  [
    'PNG content',
    (f) => {
      f.history.report.evidence.png.base64 = '';
    },
  ],
  [
    'PNG corrupt bytes with matching digest and size',
    (f) => {
      const bytes = Buffer.from(png);
      bytes[bytes.length - 1] ^= 1;
      Object.assign(f.history.report.evidence.png, {
        base64: bytes.toString('base64'),
        size: bytes.length,
        sha256: checksum(bytes),
      });
    },
  ],
  [
    'PNG canonical encoding',
    (f) => {
      f.history.report.evidence.png.base64 += '\n';
    },
  ],
  [
    'classification',
    (f) => {
      f.history.report.outcome = { kind: 'candidate-failed' };
    },
  ],
  [
    'unknown stage',
    (f) => {
      f.history.report.evidence.observations.stage = 'unknown';
    },
  ],
  [
    'null complete literal',
    (f) => {
      f.history.report.evidence.observations.literal = null;
    },
  ],
  [
    'unknown event',
    (f) => {
      f.history.report.evidence.observations.events = [{ kind: 'other', text: '' }];
    },
  ],
  [
    'not-needed cleanup with evidence',
    (f) => {
      f.history.report.cleanup.kind = 'not-needed';
    },
  ],
];
for (const [name, mutate] of evidenceMutations)
  test(`admitFrozenBrowserConsumedReport rejects invalid evidence ${name}`, () => {
    const f = fixture();
    mutate(f);
    invalid(f.expected, f.history);
  });

test('admitFrozenBrowserConsumedReport rejects late unrelated failures', () => {
  const f = fixture('candidate', 'C');
  f.history.report.outcome = { kind: 'unrelated-failure' };
  blocked(f, 'unrelated-failure');
  f.history.report.evidence.provenance.finishedAt = 601;
  invalid(f.expected, f.history);
});

const unsafeValues: [string, () => unknown][] = [
  ['undefined', () => undefined],
  ['bigint', () => 1n],
  ['NaN', () => NaN],
  ['infinity', () => Infinity],
  ['function', () => () => {}],
  ['symbol', () => Symbol('bad')],
  ['ill-formed string', () => '\ud800'],
  ['ill-formed key', () => ({ ['\ud800']: true })],
  ['date', () => new Date(0)],
  ['buffer', () => Buffer.from('x')],
  ['map', () => new Map()],
  ['custom prototype', () => Object.create({ inherited: true })],
  ['sparse array', () => Array(2)],
  ['decorated array', () => Object.assign([], { extra: true })],
  ['hidden key', () => Object.defineProperty({}, 'hidden', { value: true })],
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
    'depth budget',
    () => {
      let value: unknown = null;
      for (let i = 0; i < 33; i++) value = { nested: value };
      return value;
    },
  ],
  ['node budget', () => Array.from({ length: 100000 }, () => null)],
  ['array length budget', () => Array(100001)],
  ['byte budget', () => 'x'.repeat(9 * 1024 ** 2)],
  ['escaped byte budget', () => '\0'.repeat(2 * 1024 ** 2)],
];
for (const [name, make] of unsafeValues)
  test(`admitFrozenBrowserConsumedReport rejects ${name} in both arguments and nested claims`, () => {
    const f = fixture();
    invalid(make(), f.history);
    invalid(f.expected, make());
    invalid({ ...f.expected, unsafe: make() }, f.history);
    Object.assign(f.history.report.evidence.provenance.assets, { unsafe: make() });
    invalid(f.expected, f.history);
  });

test('admitFrozenBrowserConsumedReport never invokes accessors, serialization hooks or proxy traps', () => {
  const f = fixture();
  let calls = 0;
  const execute = () => {
    calls++;
    throw Error('caller code executed');
  };
  const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: execute });
  const proxy = new Proxy(
    {},
    { get: execute, getPrototypeOf: execute, ownKeys: execute, getOwnPropertyDescriptor: execute },
  );
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const unsafe of [accessor, proxy, revoked.proxy, { toJSON: execute }]) {
    invalid(unsafe, f.history);
    invalid(f.expected, unsafe);
    for (const field of ['consumedRun', 'request'])
      invalid({ ...f.expected, [field]: unsafe }, f.history);
    for (const field of ['state', 'consumedRun', 'report'])
      invalid(f.expected, { ...f.history, [field]: unsafe });
    Object.assign(f.history.report.evidence.provenance.assets, { unsafe });
    invalid(f.expected, f.history);
  }
  for (const field of ['consumedRun', 'admittedAt', 'deadline', 'request'])
    invalid(
      Object.defineProperty({ ...f.expected }, field, { enumerable: true, get: execute }),
      f.history,
    );
  for (const field of ['state', 'report', 'consumedRun', 'admittedAt', 'deadline'])
    invalid(
      f.expected,
      Object.defineProperty({ ...fixture().history }, field, { enumerable: true, get: execute }),
    );
  assert.equal(calls, 0);
});

test('admitFrozenBrowserConsumedReport copies null prototypes and own __proto__ without pollution', () => {
  const f = fixture();
  const assets = Object.create(null);
  Object.defineProperty(assets, '__proto__', { enumerable: true, value: { claimed: true } });
  f.history.report.evidence.provenance.assets = assets;
  Object.setPrototypeOf(f.expected, null);
  Object.setPrototypeOf(f.history, null);
  const result = admitFrozenBrowserConsumedReport(f.expected, f.history);
  assert.equal(result.type, 'behavioral');
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(result.report.evidence!.provenance.assets, '__proto__')!.value,
    { claimed: true },
  );
  assert.equal(Object.hasOwn(Object.prototype, 'claimed'), false);
  assert.equal(Object.getPrototypeOf(result.report.evidence!.provenance.assets), Object.prototype);
});

test('admitFrozenBrowserConsumedReport detaches behavioral reports and PNG bytes across calls and input mutation', () => {
  const f = fixture();
  const original = structuredClone(f);
  const first = admitFrozenBrowserConsumedReport(f.expected, f.history);
  const second = admitFrozenBrowserConsumedReport(f.expected, f.history);
  behavioral(f);
  assert.deepEqual(first, second);
  if (first.type !== 'behavioral' || second.type !== 'behavioral') assert.fail('not-behavioral');
  assert.notEqual(first.report, second.report);
  assert.notEqual(first.report.request, f.expected.request);
  assert.notEqual(first.report.request, f.history.report.request);
  assert.notEqual(first.outputs[0].bytes, second.outputs[0].bytes);
  first.outputs[0].bytes.fill(0);
  Object.assign(first.report.evidence.observations, { literal: 'A' });
  Object.assign(first.report.request.action, { epoch: 99 });
  assert.deepEqual(f, original);
  Object.assign(f.expected.consumedRun, { runId: caseId });
  Object.assign(f.expected.request.action, { epoch: 100 });
  f.history.report.evidence.png.base64 = '';
  assert.deepEqual(second.report, original.history.report);
  assert.deepEqual(second.outputs[0].bytes, png);
  assert.deepEqual(admitFrozenBrowserConsumedReport(original.expected, original.history), second);
});

test('admitFrozenBrowserConsumedReport detaches blocked reports including diagnostic evidence', () => {
  const f = fixture();
  f.history.report.outcome = { kind: 'cancelled', code: 'aborted' };
  const original = structuredClone(f);
  const first = admitFrozenBrowserConsumedReport(f.expected, f.history);
  blocked(f, 'cancelled');
  Object.assign(first.report.evidence!.observations, { literal: 'A' });
  Object.assign(first.report.request.action, { epoch: 99 });
  assert.deepEqual(f, original);
  assert.deepEqual(admitFrozenBrowserConsumedReport(f.expected, f.history), {
    type: 'blocked',
    reason: 'cancelled',
    report: original.history.report,
  });
});

test('admitFrozenBrowserConsumedReport performs no validator or wall-clock work', (t) => {
  const f = fixture();
  const calls: string[] = [];
  for (const target of [FrozenBrowserValidator, FrozenBrowserValidator.prototype])
    for (const method of Object.getOwnPropertyNames(target)) {
      if (['constructor', 'length', 'name', 'prototype'].includes(method)) continue;
      if (typeof Object.getOwnPropertyDescriptor(target, method)?.value !== 'function') continue;
      t.mock.method(target, method as never, () => {
        calls.push(method);
        throw Error('validator-effect');
      });
    }
  t.mock.method(Date, 'now', () => {
    calls.push('now');
    throw Error('clock-effect');
  });
  behavioral(f);
  f.history.report.outcome = { kind: 'cancelled', code: 'aborted' };
  blocked(f, 'cancelled');
  assert.deepEqual(calls, []);
});
