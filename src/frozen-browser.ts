import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { types } from 'node:util';
import { checksum, validateOutput } from './artifacts.ts';
import { digest, fail, uuid } from './domain.ts';
import { caseId, gitRevision, sha256, virtualPath } from './workspace.ts';
import type { WorkspaceStore, FrozenRevision, CaseId, Sha256 } from './workspace.ts';
import {
  namespaceChrootPolicy,
  engineCommit,
  baselineSha256,
} from '../prototypes/chromium/policy.mjs';
import { isSandboxStatusVerified } from '../prototypes/chromium/sandbox-status.mjs';

type ActionId = string & { readonly __brand: 'FrozenBrowserActionId' };
type ControlEpoch = number & { readonly __brand: 'FrozenBrowserControlEpoch' };
export type FrozenBrowserRequest = Readonly<{
  frozen: FrozenRevision;
  action: Readonly<{ caseId: CaseId; actionId: ActionId; epoch: ControlEpoch }>;
  scenarioId: 'synthetic-click-v1';
  role: 'baseline' | 'candidate';
  allowanceMs: number;
}>;
export type FrozenBrowserOutcome =
  | Readonly<{
      kind:
        | 'baseline-reproduced'
        | 'baseline-not-reproduced'
        | 'candidate-passed'
        | 'candidate-failed'
        | 'unrelated-failure';
    }>
  | Readonly<{ kind: 'infrastructure-failed' | 'cancelled' | 'uncertain'; code: string }>;
export type FrozenBrowserCleanup =
  | Readonly<{ kind: 'not-needed' | 'owned-removed'; cache: 'retained' }>
  | Readonly<{ kind: 'incomplete'; cache: 'retained'; code: string }>;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type ObjectValue = { [key: string]: Json };
type Manifest = { path: string; size: number; sha256: string }[];
export type FrozenBrowserProvenance = Readonly<{
  requestDigest: string;
  configurationDigest: string;
  frozen: FrozenRevision;
  transfer: Manifest;
  contextBytes: number;
  contextSha256: string;
  assets: ObjectValue;
  policy: ObjectValue;
  engine: ObjectValue;
  baseBefore: ObjectValue;
  baseAfter: ObjectValue;
  imageId: string;
  containerId: string;
  applied: ObjectValue;
  admittedAt: number;
  deadline: number;
  finishedAt: number;
  exitCode: number;
  oomKilled: false;
  stdoutSha256: string;
  stderrSha256: string;
  buildStdoutSha256: string;
  buildStderrSha256: string;
}>;
export type FrozenBrowserEvidence = Readonly<{
  provenance: FrozenBrowserProvenance;
  observations: ObjectValue;
  png: Readonly<{ mime: 'image/png'; size: number; sha256: string; base64: string }>;
}>;
export type FrozenBrowserReport = Readonly<{
  runId: string;
  request: FrozenBrowserRequest;
  outcome: FrozenBrowserOutcome;
  cleanup: FrozenBrowserCleanup;
  evidence: FrozenBrowserEvidence | null;
}>;
export type FrozenBrowserExpectation =
  | Readonly<{
      configurationDigest: Sha256;
      kind: 'baseline';
      request: FrozenBrowserRequest & Readonly<{ role: 'baseline' }>;
    }>
  | Readonly<{
      configurationDigest: Sha256;
      kind: 'browser';
      request: FrozenBrowserRequest & Readonly<{ role: 'candidate' }>;
    }>;
type BehavioralOutcome = Readonly<{
  kind: 'baseline-reproduced' | 'baseline-not-reproduced' | 'candidate-passed' | 'candidate-failed';
}>;
export type FrozenBrowserAdmission =
  | Readonly<{
      type: 'behavioral';
      report: FrozenBrowserReport &
        Readonly<{
          outcome: BehavioralOutcome;
          evidence: FrozenBrowserEvidence;
          cleanup: Readonly<{ kind: 'owned-removed'; cache: 'retained' }>;
        }>;
      passed: boolean;
      outputs: readonly [
        Readonly<{ label: 'Frozen browser screenshot'; mime: 'image/png'; bytes: Uint8Array }>,
      ];
    }>
  | Readonly<{
      type: 'blocked';
      report: FrozenBrowserReport;
      reason:
        | 'cleanup-incomplete'
        | 'infrastructure'
        | 'unrelated-failure'
        | 'cancelled'
        | 'uncertain';
    }>;
const limits = Object.freeze({
  attempts: 16,
  context: 40 * 1024 ** 2,
  contribution: 640 * 1024 ** 2,
  control: 256 * 1024,
  stdout: 6 * 1024 ** 2,
  stderr: 64 * 1024,
  evidence: 8 * 1024 ** 2,
  cleanupMs: 10000,
  journal: 160 * 1024 ** 2,
});
const baseTag = 'eitri-chromium-probe:1.64.1-node26.5.0';
const baseId = 'sha256:57911b2d47725e1d19e25203b82d7c90a3160da1815f78a9c66b42a89dd1ddff';
const policyHash = 'c85c2b40abc8ca15cace108b94f91e337b73313c8288b03c41d1ca51fe239bd7';
const entrypoint = ['/usr/local/bin/node', '/opt/eitri/frozen-browser/watchdog.mjs'];
const labelOwner = 'eitri.frozen-browser.owner';
const labelRun = 'eitri.frozen-browser.run';
const owners = new Set<string>();
type Identity = { dev: string; ino: string; mode: number };
type Resource = { kind: 'none' } | { kind: 'intent' } | { kind: 'acquired'; id: string };
type Intent = {
  runId: string;
  request: FrozenBrowserRequest;
  requestDigest: string;
  configurationDigest: string;
  nonce: string;
  owner: string;
  imageTag: string;
  containerName: string;
  admittedAt: number;
  deadline: number;
  reservation: number;
};
type Ledger = {
  build: 'not-started' | 'unknown' | 'completed';
  image: Resource;
  container: Resource;
};
type Result =
  | { kind: 'pending' }
  | { kind: 'recorded'; outcome: FrozenBrowserOutcome; evidence: FrozenBrowserEvidence | null }
  | { kind: 'settled'; report: FrozenBrowserReport };
type Run = { intent: Intent; ledger: Ledger; result: Result };
type Meta = {
  version: 1;
  owner: string;
  configurationDigest: string;
  attempts: number;
  contribution: number;
};
type Assets = {
  dockerfile: Buffer;
  driver: Buffer;
  watchdog: Buffer;
  scenario: Buffer;
  policy: Buffer;
};
type ClientResult =
  | { kind: 'exited'; status: number; stdout: Buffer; stderr: Buffer }
  | {
      kind: 'lost';
      code: 'client-error' | 'client-aborted' | 'client-timeout' | 'client-overflow';
    };

const same = (a: unknown, b: unknown) => digest(a) === digest(b);
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('invalid-frozen-browser-record');
  return value as ObjectValue;
}
function exact(value: unknown, keys: string[]): ObjectValue {
  const r = object(value);
  if (!same(Object.keys(r).sort(), [...keys].sort())) fail('invalid-frozen-browser-fields');
  return r;
}
function string(value: unknown, max = 1024): string {
  if (typeof value !== 'string' || !value.isWellFormed() || Buffer.byteLength(value) > max)
    return fail('invalid-frozen-browser-string');
  return value;
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    return fail('invalid-frozen-browser-number');
  return value;
}
function array(value: unknown, max: number): Json[] {
  if (!Array.isArray(value) || value.length > max) return fail('invalid-frozen-browser-array');
  return value;
}
function id(value: unknown): string {
  if (!uuid(value) || value !== value.toLowerCase()) return fail('invalid-frozen-browser-id');
  return value;
}
function imageId(value: unknown): string {
  const s = string(value, 71);
  if (!/^sha256:[a-f0-9]{64}$/.test(s)) fail('invalid-image-id');
  return s;
}
function containerId(value: unknown): string {
  const s = string(value, 64);
  if (!/^[a-f0-9]{64}$/.test(s)) fail('invalid-container-id');
  return s;
}
function parseJson(bytes: Buffer | string): unknown {
  return JSON.parse(
    typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  );
}
export function frozenBrowserRequest(value: unknown): FrozenBrowserRequest {
  const r = exact(value, ['frozen', 'action', 'scenarioId', 'role', 'allowanceMs']);
  const f = exact(r.frozen, ['caseId', 'revision', 'manifestDigest']);
  const a = exact(r.action, ['caseId', 'actionId', 'epoch']);
  const frozen = {
    caseId: caseId(f.caseId),
    revision: gitRevision(f.revision),
    manifestDigest: sha256(f.manifestDigest),
  };
  const action = {
    caseId: caseId(a.caseId),
    actionId: id(a.actionId) as ActionId,
    epoch: integer(a.epoch) as ControlEpoch,
  };
  if (
    action.caseId !== frozen.caseId ||
    r.scenarioId !== 'synthetic-click-v1' ||
    (r.role !== 'baseline' && r.role !== 'candidate')
  )
    return fail('invalid-frozen-browser-request');
  return {
    frozen,
    action,
    scenarioId: 'synthetic-click-v1',
    role: r.role,
    allowanceMs: integer(r.allowanceMs, 1, 60000),
  };
}
const key = (r: FrozenBrowserRequest) =>
  `${r.action.caseId}/${r.action.actionId}/${r.action.epoch}`;
async function identity(path: string): Promise<Identity> {
  const stat = await lstat(path, { bigint: true });
  if (stat.uid !== BigInt(process.getuid?.() ?? -1)) fail('unsafe-validator-owner');
  return { dev: String(stat.dev), ino: String(stat.ino), mode: Number(stat.mode & 0o7777n) };
}
async function readRegular(path: string, max: number, privateMode = true): Promise<Buffer> {
  const before = await lstat(path, { bigint: true });
  if (
    !before.isFile() ||
    before.nlink !== 1n ||
    before.size > BigInt(max) ||
    (privateMode && (before.mode & 0o7777n) !== 0o600n)
  )
    fail('unsafe-validator-file');
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await fd.stat({ bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino) fail('validator-file-replaced');
    const bytes = await fd.readFile();
    const after = await fd.stat({ bigint: true });
    const named = await lstat(path, { bigint: true });
    if (
      bytes.length > max ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      after.nlink !== 1n ||
      named.dev !== before.dev ||
      named.ino !== before.ino
    )
      fail('validator-file-replaced');
    return bytes;
  } finally {
    await fd.close();
  }
}
async function writePrivate(path: string, bytes: Buffer) {
  const fd = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await fd.writeFile(bytes);
    await fd.sync();
  } finally {
    await fd.close();
  }
}
function resource(value: unknown, kind: 'image' | 'container'): Resource {
  const r = object(value);
  if (r.kind === 'none' || r.kind === 'intent') {
    exact(r, ['kind']);
    return { kind: r.kind };
  }
  exact(r, ['kind', 'id']);
  if (r.kind !== 'acquired') return fail('corrupt-validator-ledger');
  return { kind: 'acquired', id: kind === 'image' ? imageId(r.id) : containerId(r.id) };
}
function outcome(value: unknown): FrozenBrowserOutcome {
  const r = object(value);
  switch (r.kind) {
    case 'baseline-reproduced':
    case 'baseline-not-reproduced':
    case 'candidate-passed':
    case 'candidate-failed':
    case 'unrelated-failure':
      exact(r, ['kind']);
      return { kind: r.kind };
    case 'infrastructure-failed':
    case 'cancelled':
    case 'uncertain':
      exact(r, ['kind', 'code']);
      return { kind: r.kind, code: string(r.code, 128) };
    default:
      return fail('corrupt-validator-outcome');
  }
}
function cleanup(value: unknown): FrozenBrowserCleanup {
  const r = object(value);
  if (r.cache !== 'retained') fail('corrupt-validator-cleanup');
  if (r.kind === 'not-needed' || r.kind === 'owned-removed') {
    exact(r, ['kind', 'cache']);
    return { kind: r.kind, cache: 'retained' };
  }
  exact(r, ['kind', 'cache', 'code']);
  if (r.kind !== 'incomplete') return fail('corrupt-validator-cleanup');
  return { kind: 'incomplete', cache: 'retained', code: string(r.code, 128) };
}
function evidence(value: unknown): FrozenBrowserEvidence | null {
  if (value === null) return null;
  const r = exact(value, ['provenance', 'observations', 'png']);
  if (Buffer.byteLength(JSON.stringify(r)) > limits.evidence) fail('evidence-overflow');
  const p = exact(r.png, ['mime', 'size', 'sha256', 'base64']);
  if (p.mime !== 'image/png') fail('invalid-png-mime');
  const base64 = string(p.base64, Math.ceil((4 * 1024 ** 2) / 3) * 4);
  const bytes = validateOutput({
    label: 'Browser screenshot',
    mime: 'image/png',
    bytes: Buffer.from(base64, 'base64'),
  });
  if (
    bytes.toString('base64') !== base64 ||
    integer(p.size) !== bytes.length ||
    sha256(p.sha256) !== checksum(bytes)
  )
    fail('invalid-png-integrity');
  const pHost = exact(r.provenance, [
    'requestDigest',
    'configurationDigest',
    'frozen',
    'transfer',
    'contextBytes',
    'contextSha256',
    'assets',
    'policy',
    'engine',
    'baseBefore',
    'baseAfter',
    'imageId',
    'containerId',
    'applied',
    'admittedAt',
    'deadline',
    'finishedAt',
    'exitCode',
    'oomKilled',
    'stdoutSha256',
    'stderrSha256',
    'buildStdoutSha256',
    'buildStderrSha256',
  ]);
  const f = exact(pHost.frozen, ['caseId', 'revision', 'manifestDigest']);
  if (pHost.oomKilled !== false) fail('invalid-host-exit');
  const provenance: FrozenBrowserProvenance = {
    requestDigest: sha256(pHost.requestDigest),
    configurationDigest: sha256(pHost.configurationDigest),
    frozen: {
      caseId: caseId(f.caseId),
      revision: gitRevision(f.revision),
      manifestDigest: sha256(f.manifestDigest),
    },
    transfer: array(pHost.transfer, 1024).map((v) => {
      const f = exact(v, ['path', 'size', 'sha256']);
      return {
        path: virtualPath(f.path),
        size: integer(f.size, 0, 1024 * 1024),
        sha256: sha256(f.sha256),
      };
    }),
    contextBytes: integer(pHost.contextBytes, 1, limits.context),
    contextSha256: sha256(pHost.contextSha256),
    assets: object(pHost.assets),
    policy: object(pHost.policy),
    engine: object(pHost.engine),
    baseBefore: object(pHost.baseBefore),
    baseAfter: object(pHost.baseAfter),
    imageId: imageId(pHost.imageId),
    containerId: containerId(pHost.containerId),
    applied: object(pHost.applied),
    admittedAt: integer(pHost.admittedAt),
    deadline: integer(pHost.deadline),
    finishedAt: integer(pHost.finishedAt),
    exitCode: integer(pHost.exitCode),
    oomKilled: false,
    stdoutSha256: sha256(pHost.stdoutSha256),
    stderrSha256: sha256(pHost.stderrSha256),
    buildStdoutSha256: sha256(pHost.buildStdoutSha256),
    buildStderrSha256: sha256(pHost.buildStderrSha256),
  };
  return {
    provenance,
    observations: object(r.observations),
    png: { mime: 'image/png', size: bytes.length, sha256: checksum(bytes), base64 },
  };
}
function admissionSnapshot(value: unknown): Json {
  let nodes = 0;
  let bytes = 0;
  const ancestors = new Set<object>();
  const charge = (count: number) => {
    bytes += count;
    if (bytes > limits.evidence + limits.control) fail('invalid-frozen-browser-admission');
  };
  const text = (value: string) => {
    charge(Buffer.byteLength(value) + 2);
    if (!value.isWellFormed()) fail('invalid-frozen-browser-admission');
    for (const char of value) {
      const code = char.charCodeAt(0);
      if (code < 32) charge([8, 9, 10, 12, 13].includes(code) ? 1 : 5);
      else if (char === '"' || char === '\\') charge(1);
    }
    return value;
  };
  const copy = (value: unknown, depth: number): Json => {
    if (++nodes > 100000 || depth > 32) fail('invalid-frozen-browser-admission');
    if (typeof value === 'string') return text(value);
    if (value === null || typeof value === 'boolean') {
      charge(5);
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      charge(32);
      return value;
    }
    if (typeof value !== 'object' || value === null || types.isProxy(value))
      return fail('invalid-frozen-browser-admission');
    if (ancestors.has(value)) fail('invalid-frozen-browser-admission');
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (
      isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null
    )
      fail('invalid-frozen-browser-admission');
    const keys = Reflect.ownKeys(value);
    if (keys.length > 100000) fail('invalid-frozen-browser-admission');
    const result: Json[] | ObjectValue = isArray ? [] : {};
    const length = isArray ? Object.getOwnPropertyDescriptor(value, 'length')!.value : 0;
    if (isArray && (length > 100000 || keys.length !== length + 1))
      fail('invalid-frozen-browser-admission');
    charge(2);
    ancestors.add(value);
    for (const key of keys) {
      if (isArray && key === 'length') continue;
      if (typeof key !== 'string') return fail('invalid-frozen-browser-admission');
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
        fail('invalid-frozen-browser-admission');
      if (isArray && key !== String((result as Json[]).length))
        fail('invalid-frozen-browser-admission');
      if (!isArray) text(key);
      charge(2);
      Object.defineProperty(result, key, {
        value: copy(descriptor.value, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    ancestors.delete(value);
    return result;
  };
  return copy(value, 0);
}

/** Converts detached report claims into scenario data, not controller admission or a receipt.
 * Matching digests establish consistency, not authorship, containment, or executed cleanup.
 */
export function admitFrozenBrowserReport(
  expected: FrozenBrowserExpectation,
  value: unknown,
): FrozenBrowserAdmission {
  try {
    const expectedData = admissionSnapshot(expected);
    const reportData = admissionSnapshot(value);
    const e = exact(expectedData, ['configurationDigest', 'kind', 'request']);
    const r = exact(reportData, ['runId', 'request', 'outcome', 'cleanup', 'evidence']);
    const request = frozenBrowserRequest(e.request);
    const returnedRequest = frozenBrowserRequest(r.request);
    const configurationDigest = sha256(e.configurationDigest);
    if (
      !(
        (e.kind === 'baseline' && request.role === 'baseline') ||
        (e.kind === 'browser' && request.role === 'candidate')
      ) ||
      !same(request, returnedRequest)
    )
      fail('invalid-frozen-browser-admission');
    const report: FrozenBrowserReport = {
      runId: id(r.runId),
      request: returnedRequest,
      outcome: outcome(r.outcome),
      cleanup: cleanup(r.cleanup),
      evidence: evidence(r.evidence),
    };
    const observedOutcome = !['infrastructure-failed', 'cancelled', 'uncertain'].includes(
      report.outcome.kind,
    );
    if (report.evidence) {
      const p = report.evidence.provenance;
      const observed = report.evidence.observations;
      scenarioObservations(observed);
      if (Object.hasOwn(p.applied, 'inspectionSha256')) sha256(p.applied.inspectionSha256);
      if (
        p.requestDigest !== digest(request) ||
        p.configurationDigest !== configurationDigest ||
        !same(p.frozen, request.frozen) ||
        !Number.isSafeInteger(p.admittedAt + request.allowanceMs) ||
        p.deadline !== p.admittedAt + request.allowanceMs ||
        p.finishedAt < p.admittedAt ||
        p.exitCode !== 0 ||
        new Set(p.transfer.map((f) => f.path)).size !== p.transfer.length ||
        p.transfer.reduce((n, f) => n + f.size, 0) > 32 * 1024 ** 2 ||
        !same(p.transfer, observed.manifest) ||
        (observedOutcome &&
          (p.finishedAt > p.deadline || !same(classify(request, observed), report.outcome))) ||
        report.cleanup.kind === 'not-needed'
      )
        fail('invalid-frozen-browser-admission');
    } else if (observedOutcome) fail('invalid-frozen-browser-admission');
    if (report.cleanup.kind === 'incomplete')
      return { type: 'blocked', report, reason: 'cleanup-incomplete' };
    switch (report.outcome.kind) {
      case 'infrastructure-failed':
        return { type: 'blocked', report, reason: 'infrastructure' };
      case 'unrelated-failure':
      case 'cancelled':
      case 'uncertain':
        return { type: 'blocked', report, reason: report.outcome.kind };
      default: {
        const retained = report.evidence;
        if (!retained || report.cleanup.kind !== 'owned-removed')
          return fail('invalid-frozen-browser-admission');
        return {
          type: 'behavioral',
          report: {
            ...report,
            outcome: { kind: report.outcome.kind },
            cleanup: { kind: report.cleanup.kind, cache: report.cleanup.cache },
            evidence: retained,
          },
          passed: ['baseline-reproduced', 'candidate-passed'].includes(report.outcome.kind),
          outputs: [
            {
              label: 'Frozen browser screenshot',
              mime: 'image/png',
              bytes: Buffer.from(retained.png.base64, 'base64'),
            },
          ],
        };
      }
    }
  } catch {
    return fail('invalid-frozen-browser-admission');
  }
}

function validateRecorded(
  result: Exclude<Result, { kind: 'pending' }>,
  intent: Intent,
  assets: Assets,
) {
  const saved = result.kind === 'recorded' ? result : result.report;
  const behavioral = !['infrastructure-failed', 'cancelled', 'uncertain'].includes(
    saved.outcome.kind,
  );
  if (!saved.evidence) {
    if (behavioral) fail('missing-committed-evidence');
    return;
  }
  const p = exact(saved.evidence.provenance, [
    'requestDigest',
    'configurationDigest',
    'frozen',
    'transfer',
    'contextBytes',
    'contextSha256',
    'assets',
    'policy',
    'engine',
    'baseBefore',
    'baseAfter',
    'imageId',
    'containerId',
    'applied',
    'admittedAt',
    'deadline',
    'finishedAt',
    'exitCode',
    'oomKilled',
    'stdoutSha256',
    'stderrSha256',
    'buildStdoutSha256',
    'buildStderrSha256',
  ]);
  const manifest = array(p.transfer, 1024).map((value) => {
    const f = exact(value, ['path', 'size', 'sha256']);
    return {
      path: virtualPath(f.path),
      size: integer(f.size, 0, 1024 * 1024),
      sha256: sha256(f.sha256),
    };
  });
  if (
    new Set(manifest.map((f) => f.path)).size !== manifest.length ||
    manifest.reduce((n, f) => n + f.size, 0) > 32 * 1024 ** 2 ||
    p.requestDigest !== intent.requestDigest ||
    p.configurationDigest !== intent.configurationDigest ||
    !same(p.frozen, intent.request.frozen) ||
    p.admittedAt !== intent.admittedAt ||
    p.deadline !== intent.deadline ||
    p.exitCode !== 0 ||
    p.oomKilled !== false ||
    !same(p.assets, Object.fromEntries(Object.entries(assets).map(([k, v]) => [k, checksum(v)])))
  )
    fail('corrupt-committed-provenance');
  integer(p.contextBytes, 1, limits.context);
  integer(p.finishedAt, intent.admittedAt);
  for (const field of [
    'contextSha256',
    'stdoutSha256',
    'stderrSha256',
    'buildStdoutSha256',
    'buildStderrSha256',
  ])
    sha256(p[field]);
  imageId(p.imageId);
  containerId(p.containerId);
  const policy = exact(p.policy, ['sha256', 'engineCommit', 'baselineSha256']);
  if (!same(policy, { sha256: policyHash, engineCommit, baselineSha256 }))
    fail('corrupt-committed-policy');
  const engine = exact(p.engine, ['version', 'arch', 'commit', 'security']);
  if (
    engine.version !== '29.4.0' ||
    engine.arch !== 'arm64' ||
    !engineCommit.startsWith(string(engine.commit, 40)) ||
    !array(engine.security, 32).includes('name=seccomp,profile=builtin')
  )
    fail('corrupt-committed-engine');
  const before = exact(p.baseBefore, ['id', 'architecture', 'os', 'rootFS', 'env']);
  exact(p.baseAfter, ['id', 'architecture', 'os', 'rootFS', 'env']);
  const root = exact(before.rootFS, ['Type', 'Layers']);
  if (
    before.id !== baseId ||
    before.architecture !== 'arm64' ||
    before.os !== 'linux' ||
    root.Type !== 'layers' ||
    !array(root.Layers, 256).length ||
    !same(before, p.baseAfter)
  )
    fail('corrupt-committed-base');
  for (const layer of array(root.Layers, 256)) imageId(layer);
  const applied = exact(p.applied, ['image', 'inspectionSha256', 'config', 'hostConfig', 'mounts']);
  sha256(applied.inspectionSha256);
  if (applied.image !== p.imageId || !same(applied.mounts, [])) fail('corrupt-committed-container');
  const c = exact(applied.config, [
    'User',
    'WorkingDir',
    'Entrypoint',
    'Cmd',
    'StopTimeout',
    'OpenStdin',
    'Tty',
    'Env',
    'Labels',
  ]);
  if (
    c.User !== '1001:1001' ||
    c.WorkingDir !== '/opt/eitri' ||
    !same(c.Entrypoint, entrypoint) ||
    !same(c.Cmd, []) ||
    c.StopTimeout !== 2 ||
    c.OpenStdin !== false ||
    c.Tty !== false ||
    !same(c.Labels, { [labelOwner]: intent.owner, [labelRun]: intent.runId }) ||
    !same(
      envSet(c.Env),
      envSet([
        ...envSet(before.env),
        `EITRI_DEADLINE=${intent.deadline}`,
        `EITRI_NONCE=${intent.nonce}`,
        `EITRI_REQUEST=${intent.requestDigest}`,
      ]),
    )
  )
    fail('corrupt-committed-bindings');
  const h = object(applied.hostConfig);
  const hostKeys = [
    'NetworkMode',
    'ReadonlyRootfs',
    'Privileged',
    'CapAdd',
    'CapDrop',
    'SecurityOpt',
    'Memory',
    'MemorySwap',
    'NanoCpus',
    'PidsLimit',
    'IpcMode',
    'ShmSize',
    'Tmpfs',
    'Ulimits',
    'PublishAllPorts',
    'AutoRemove',
    'Runtime',
    'CgroupnsMode',
    'RestartPolicy',
  ];
  if (
    Object.keys(h).some((key) => !hostKeys.includes(key)) ||
    h.NetworkMode !== 'none' ||
    h.ReadonlyRootfs !== true ||
    h.Privileged !== false ||
    (h.CapAdd !== undefined && h.CapAdd !== null && array(h.CapAdd, 0).length) ||
    !same(h.CapDrop, ['ALL']) ||
    h.Memory !== 4294967296 ||
    h.MemorySwap !== 4294967296 ||
    h.NanoCpus !== 2e9 ||
    h.PidsLimit !== 256 ||
    h.IpcMode !== 'private' ||
    h.ShmSize !== 268435456 ||
    h.PublishAllPorts !== false ||
    h.AutoRemove !== false ||
    !same(h.Tmpfs, { '/tmp': 'rw,exec,nosuid,size=256m,uid=1001,gid=1001' }) ||
    !same(h.Ulimits, [{ Name: 'core', Hard: 0, Soft: 0 }]) ||
    !same(h.RestartPolicy, { Name: 'no', MaximumRetryCount: 0 })
  )
    fail('corrupt-committed-contract');
  const security = array(h.SecurityOpt, 2).map((value) => string(value, limits.control));
  if (
    security.length !== 2 ||
    security.filter((value) => value === 'no-new-privileges' || value === 'no-new-privileges=true')
      .length !== 1 ||
    security.filter(
      (value) =>
        value.startsWith('seccomp=') && same(parseJson(value.slice(8)), parseJson(assets.policy)),
    ).length !== 1
  )
    fail('corrupt-committed-seccomp');
  observations(saved.evidence.observations, manifest, assets);
  if (
    behavioral &&
    (integer(p.finishedAt) > intent.deadline ||
      !same(classify(intent.request, saved.evidence.observations), saved.outcome))
  )
    fail('corrupt-committed-outcome');
}
function parseRun(value: unknown, meta: Meta, assets: Assets): Run {
  const r = exact(value, ['intent', 'ledger', 'result']);
  const i = exact(r.intent, [
    'runId',
    'request',
    'requestDigest',
    'configurationDigest',
    'nonce',
    'owner',
    'imageTag',
    'containerName',
    'admittedAt',
    'deadline',
    'reservation',
  ]);
  const runId = id(i.runId);
  const request = frozenBrowserRequest(i.request);
  const intent: Intent = {
    runId,
    request,
    requestDigest: sha256(i.requestDigest),
    configurationDigest: sha256(i.configurationDigest),
    nonce: sha256(i.nonce),
    owner: id(i.owner),
    imageTag: string(i.imageTag),
    containerName: string(i.containerName),
    admittedAt: integer(i.admittedAt),
    deadline: integer(i.deadline),
    reservation: integer(i.reservation),
  };
  if (
    intent.requestDigest !== digest(request) ||
    intent.configurationDigest !== meta.configurationDigest ||
    intent.owner !== meta.owner ||
    intent.imageTag !== `eitri-frozen-browser:${runId}` ||
    intent.containerName !== `eitri-frozen-browser-${runId}` ||
    intent.reservation !== limits.context ||
    intent.deadline !== intent.admittedAt + request.allowanceMs
  )
    fail('corrupt-validator-intent');
  const l = exact(r.ledger, ['build', 'image', 'container']);
  if (l.build !== 'not-started' && l.build !== 'unknown' && l.build !== 'completed')
    return fail('corrupt-validator-ledger');
  const ledger: Ledger = {
    build: l.build,
    image: resource(l.image, 'image'),
    container: resource(l.container, 'container'),
  };
  if (
    (ledger.build === 'not-started') !== (ledger.image.kind === 'none') ||
    (ledger.container.kind !== 'none' && ledger.image.kind !== 'acquired')
  )
    fail('corrupt-validator-ledger');
  const s = object(r.result);
  let result: Result;
  if (s.kind === 'pending') {
    exact(s, ['kind']);
    result = { kind: 'pending' };
  } else if (s.kind === 'recorded') {
    exact(s, ['kind', 'outcome', 'evidence']);
    result = { kind: 'recorded', outcome: outcome(s.outcome), evidence: evidence(s.evidence) };
  } else {
    exact(s, ['kind', 'report']);
    if (s.kind !== 'settled') return fail('corrupt-validator-result');
    const p = exact(s.report, ['runId', 'request', 'outcome', 'cleanup', 'evidence']);
    if (p.runId !== runId || !same(frozenBrowserRequest(p.request), request))
      fail('corrupt-validator-report');
    result = {
      kind: 'settled',
      report: {
        runId,
        request,
        outcome: outcome(p.outcome),
        cleanup: cleanup(p.cleanup),
        evidence: evidence(p.evidence),
      },
    };
  }
  if (result.kind !== 'pending') {
    const saved = result.kind === 'recorded' ? result : result.report;
    if (
      saved.evidence &&
      (ledger.image.kind !== 'acquired' ||
        ledger.container.kind !== 'acquired' ||
        saved.evidence.provenance.imageId !== ledger.image.id ||
        saved.evidence.provenance.containerId !== ledger.container.id)
    )
      fail('corrupt-committed-resource-identity');
    validateRecorded(result, intent, assets);
  }
  return { intent, ledger, result };
}

function tar(files: { path: string; bytes: Buffer; directory?: boolean }[]): Buffer {
  const chunks: Buffer[] = [];
  let total = 1024;
  const append = (bytes: Buffer) => {
    total += bytes.length;
    if (total > limits.context) fail('copy-context-limit');
    chunks.push(bytes);
  };
  const header = (name: string, size: number, mode: number, type: string) => {
    const b = Buffer.alloc(512);
    b.write(name, 0, 100, 'utf8');
    const octal = (n: number, offset: number, width: number) =>
      b.write(`${n.toString(8).padStart(width - 1, '0')}\0`, offset, width, 'ascii');
    octal(mode, 100, 8);
    octal(1001, 108, 8);
    octal(1001, 116, 8);
    octal(size, 124, 12);
    octal(0, 136, 12);
    b.fill(32, 148, 156);
    b.write(type, 156);
    b.write('ustar\0', 257);
    b.write('00', 263);
    const sum = b.reduce((n, byte) => n + byte, 0);
    b.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    return b;
  };
  for (const [index, file] of files.entries()) {
    const path = file.directory ? `${file.path}/` : file.path;
    const extended = Buffer.byteLength(path) > 100 || !/^[\x20-\x7e]+$/.test(path);
    if (extended) {
      let line = ` path=${path}\n`;
      let length = Buffer.byteLength(line) + 1;
      while (length !== Buffer.byteLength(line) + String(length).length)
        length = Buffer.byteLength(line) + String(length).length;
      line = `${length}${line}`;
      const pax = Buffer.from(line);
      append(header(`pax-${index}`, pax.length, 0o444, 'x'));
      append(pax);
      append(Buffer.alloc((512 - (pax.length % 512)) % 512));
    }
    append(
      header(
        extended ? `entry-${index}` : path,
        file.bytes.length,
        file.directory ? 0o555 : 0o444,
        file.directory ? '5' : '0',
      ),
    );
    append(file.bytes);
    append(Buffer.alloc((512 - (file.bytes.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks, total);
}
function envSet(value: unknown): string[] {
  const bindings = array(value, 64).map((v) => string(v, 4096));
  const keys = bindings.map((v) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(v)) fail('invalid-environment');
    return v.slice(0, v.indexOf('='));
  });
  if (new Set(keys).size !== keys.length) fail('duplicate-environment');
  return bindings.sort();
}
function single(value: unknown): ObjectValue {
  const rows = array(value, 1);
  if (rows.length !== 1) return fail('invalid-docker-inspection');
  return object(rows[0]);
}
function verifyImage(value: unknown, base = false): ObjectValue {
  const image = object(value);
  imageId(image.Id);
  if (base && image.Id !== baseId) fail('base-image-changed');
  if (image.Architecture !== 'arm64' || image.Os !== 'linux') fail('image-platform');
  const config = object(image.Config),
    root = object(image.RootFS);
  if (
    (config.OnBuild !== null && config.OnBuild !== undefined && array(config.OnBuild, 0).length) ||
    root.Type !== 'layers' ||
    !array(root.Layers, 256).length
  )
    fail('image-ancestry');
  for (const layer of array(root.Layers, 256)) imageId(layer);
  envSet(config.Env);
  if (config.Healthcheck || config.Volumes || config.ExposedPorts || config.Shell)
    fail('image-executable-configuration');
  if (
    envSet(config.Env).some((v) =>
      /^(NODE_OPTIONS|NODE_PATH|NODE_INSPECT_RESUME_ON_START|LD_PRELOAD|LD_LIBRARY_PATH|DEBUG)=/.test(
        v,
      ),
    )
  )
    fail('image-environment');
  return image;
}
function verifyWitness(value: unknown, initial: string): ObjectValue {
  const r = exact(value, [
    'pid',
    'startTicks',
    'ppid',
    'state',
    'uid',
    'capEff',
    'capPrm',
    'capBnd',
    'nnp',
    'seccomp',
    'nspid',
    'userNamespace',
    'uidMap',
    'gidMap',
  ]);
  const pid = string(r.pid, 10),
    ns = string(r.userNamespace, 64);
  if (
    !/^[1-9]\d*$/.test(pid) ||
    !/^[1-9]\d{0,19}$/.test(string(r.startTicks, 20)) ||
    !/^(0|[1-9]\d*)$/.test(string(r.ppid, 10)) ||
    !['live', 'zombie'].includes(string(r.state, 6)) ||
    !/^user:\[[1-9]\d*\]$/.test(ns) ||
    !same(r.uid, [1001, 1001, 1001, 1001]) ||
    r.nnp !== '1' ||
    r.seccomp !== '2'
  )
    fail('process-security');
  for (const cap of [r.capEff, r.capPrm, r.capBnd])
    if (!/^[0-9a-f]{16}$/.test(string(cap, 16))) fail('process-capability');
  for (const map of [r.uidMap, r.gidMap]) {
    const text = string(map, 256);
    if (!/^[0-9 \t\n]+$/.test(text) || !text.trim()) fail('namespace-map');
  }
  const nspid = string(r.nspid, 64);
  if (!/^[1-9]\d*(?:[ \t]+[1-9]\d*)*$/.test(nspid) || nspid.split(/[ \t]+/)[0] !== pid)
    fail('namespace-pid');
  if (ns === initial) {
    if ([r.capEff, r.capPrm, r.capBnd].some((c) => c !== '0000000000000000'))
      fail('initial-capability');
  } else {
    if (
      ![r.uidMap, r.gidMap].every((m) => /^1001[ \t]+1001[ \t]+1$/.test(string(m).trim())) ||
      !/^[1-9]\d*(?:[ \t]+[1-9]\d*)+$/.test(nspid)
    )
      fail('nested-namespace');
    if (!['0000000000000000', '000001ffffffffff'].includes(string(r.capBnd)))
      fail('process-bounding-capability');
  }
  return r;
}
function verifyCensus(r: ObjectValue) {
  const initial = string(object(r.outer).userNamespace, 64);
  const outer = verifyWitness(r.outer, initial),
    watchdog = verifyWitness(r.watchdog, initial);
  if (
    watchdog.pid !== '1' ||
    watchdog.ppid !== '0' ||
    watchdog.userNamespace !== initial ||
    outer.pid === '1' ||
    outer.state !== 'live' ||
    watchdog.state !== 'live'
  )
    fail('outer-identity');
  const processes = array(r.processes, 256).map((p) => verifyWitness(p, initial));
  const byPid = new Map<string, ObjectValue>();
  for (const p of processes) {
    const pid = string(p.pid);
    if (byPid.has(pid)) fail('duplicate-process-witness');
    byPid.set(pid, p);
  }
  if (!same(byPid.get(string(outer.pid)), outer) || !same(byPid.get('1'), watchdog))
    fail('missing-outer');
  for (const p of processes) {
    const seen = new Set<string>();
    let current = p;
    while (current.pid !== '1') {
      const pid = string(current.pid);
      if (seen.has(pid)) fail('process-ancestry-cycle');
      seen.add(pid);
      const parent = byPid.get(string(current.ppid));
      if (!parent || BigInt(string(parent.startTicks)) > BigInt(string(current.startTicks)))
        return fail('process-parent');
      current = parent;
    }
  }
  const labels = array(r.labels, 256).map((raw) => {
    const label = exact(raw, ['pid', 'startTicks', 'role']);
    const p = byPid.get(string(label.pid, 10));
    if (
      !p ||
      p.startTicks !== label.startTicks ||
      p.state !== 'live' ||
      !['browser', 'renderer'].includes(string(label.role, 8)) ||
      p.pid === outer.pid ||
      p.pid === '1'
    )
      return fail('invalid-cdp-label');
    return { p, role: label.role };
  });
  if (new Set(labels.map((l) => l.p.pid)).size !== labels.length) fail('duplicate-cdp-label');
  const browsers = labels.filter((l) => l.role === 'browser');
  const renderers = labels.filter((l) => l.role === 'renderer').map((l) => l.p);
  if (browsers.length !== 1 || !renderers.length) fail('missing-browser-witnesses');
  const browser = browsers[0]!.p;
  if (browser.ppid !== outer.pid || browser.userNamespace !== initial) fail('browser-identity');
  for (const renderer of renderers) {
    if (
      renderer.userNamespace === initial ||
      renderer.capEff !== '0000000000000000' ||
      renderer.capPrm !== '0000000000000000'
    )
      fail('renderer-security');
    let current = renderer;
    while (current.pid !== browser.pid) {
      if (current.pid === '1') fail('renderer-ancestry');
      current = byPid.get(string(current.ppid))!;
    }
  }
  for (const p of processes) {
    if (p.capEff === '0000000000000000' && p.capPrm === '0000000000000000') continue;
    if (
      p.userNamespace === initial ||
      p.state !== 'live' ||
      p.capEff !== '0000000000200000' ||
      p.capPrm !== '0000000000200000' ||
      labels.some((l) => l.p === p) ||
      !renderers.some((child) => child.ppid === p.pid && child.userNamespace === p.userNamespace)
    )
      fail('unwitnessed-renderer-parent-capability');
  }
}
function observations(value: unknown, manifest: Manifest, assets: Assets): ObjectValue {
  const r = exact(value, [
    'runtime',
    'driverSha256',
    'watchdogSha256',
    'scenarioSha256',
    'outer',
    'watchdog',
    'processes',
    'labels',
    'sandboxText',
    'budgets',
    'restrictions',
    'manifest',
    'stage',
    'literal',
    'events',
    'canaryAfter',
  ]);
  if (
    !same(r.runtime, { node: 'v26.5.0', arch: 'arm64', uid: 1001 }) ||
    r.driverSha256 !== checksum(assets.driver) ||
    r.watchdogSha256 !== checksum(assets.watchdog) ||
    r.scenarioSha256 !== checksum(assets.scenario) ||
    !same(r.manifest, manifest)
  )
    fail('worker-provenance');
  verifyCensus(r);
  if (!isSandboxStatusVerified(string(r.sandboxText, 16384))) fail('sandbox-status');
  const b = exact(r.budgets, ['memory.max', 'memory.swap.max', 'pids.max', 'cpu.max']);
  const cpu = string(b['cpu.max'], 128).split(/\s+/);
  if (
    b['memory.max'] !== '4294967296' ||
    b['memory.swap.max'] !== '0' ||
    b['pids.max'] !== '256' ||
    cpu.length !== 2 ||
    !cpu.every((n) => /^[1-9]\d*$/.test(n)) ||
    Number(cpu[0]) / Number(cpu[1]) !== 2
  )
    fail('runtime-budgets');
  const restrictions = exact(r.restrictions, [
    'root',
    'snapshot',
    'socket',
    'hostPath',
    'canary',
    'egress',
  ]);
  if (
    restrictions.root !== 'EROFS' ||
    !['EROFS', 'EACCES'].includes(string(restrictions.snapshot)) ||
    restrictions.socket !== 'ENOENT' ||
    restrictions.hostPath !== 'ENOENT' ||
    restrictions.canary !== 'ENOENT' ||
    !['ENETUNREACH', 'EHOSTUNREACH', 'EACCES', 'EPERM'].includes(string(restrictions.egress)) ||
    r.canaryAfter !== 'ENOENT'
  )
    fail('runtime-restrictions');
  scenarioObservations(r);
  return r;
}
function scenarioObservations(r: ObjectValue) {
  if (
    !['startup-failed', 'action-failed', 'complete'].includes(string(r.stage)) ||
    (r.stage === 'complete' ? typeof r.literal !== 'string' : r.literal !== null)
  )
    fail('scenario-stage');
  if (r.literal !== null) string(r.literal, 1024);
  let eventBytes = 0;
  for (const value of array(r.events, 32)) {
    const event = exact(value, ['kind', 'text']);
    if (!['console', 'console-error', 'page-error'].includes(string(event.kind)))
      fail('invalid-page-event');
    eventBytes += Buffer.byteLength(string(event.text, 1024));
  }
  if (eventBytes > 8192) fail('page-event-overflow');
}
function protocol(bytes: Buffer, intent: Intent, manifest: Manifest, assets: Assets) {
  if (bytes.length > limits.stdout) fail('wire-overflow');
  const lines = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\n');
  if (
    lines.length !== 4 ||
    lines[3] !== '' ||
    Buffer.byteLength(lines[0]) > limits.control ||
    Buffer.byteLength(lines[2]) > limits.control
  )
    fail('invalid-wire-framing');
  const frame = (line: string, kind: string) => {
    const parsed = parseJson(line);
    if (JSON.stringify(parsed) !== line) fail('noncanonical-wire-record');
    const r = exact(parsed, ['version', 'kind', 'nonce', 'requestDigest', 'data']);
    if (
      r.version !== 1 ||
      r.kind !== kind ||
      r.nonce !== intent.nonce ||
      r.requestDigest !== intent.requestDigest
    )
      fail('invalid-wire-binding');
    return r.data;
  };
  const observed = observations(frame(lines[0], 'observations'), manifest, assets);
  const p = exact(frame(lines[1], 'png'), ['mime', 'base64']);
  const end = exact(frame(lines[2], 'end'), ['observationsSha256', 'pngSha256']);
  const base64 = string(p.base64, Math.ceil((4 * 1024 ** 2) / 3) * 4);
  if (p.mime !== 'image/png') fail('invalid-png-mime');
  const png = validateOutput({
    label: 'Browser screenshot',
    mime: 'image/png',
    bytes: Buffer.from(base64, 'base64'),
  });
  if (
    png.toString('base64') !== base64 ||
    end.pngSha256 !== checksum(png) ||
    end.observationsSha256 !== checksum(Buffer.from(lines[0]))
  )
    fail('wire-integrity');
  return {
    observed,
    png: { mime: 'image/png' as const, size: png.length, sha256: checksum(png), base64 },
  };
}
function classify(request: FrozenBrowserRequest, observed: ObjectValue): FrozenBrowserOutcome {
  if (
    observed.stage !== 'complete' ||
    array(observed.events, 32).some((e) => object(e).kind !== 'console')
  )
    return { kind: 'unrelated-failure' };
  if (observed.literal !== 'A' && observed.literal !== 'B') return { kind: 'unrelated-failure' };
  return {
    kind:
      request.role === 'baseline'
        ? observed.literal === 'A'
          ? 'baseline-reproduced'
          : 'baseline-not-reproduced'
        : observed.literal === 'B'
          ? 'candidate-passed'
          : 'candidate-failed',
  };
}

const metaSchema =
  'CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL, digest TEXT NOT NULL) STRICT';
const runSchema =
  'CREATE TABLE runs (id INTEGER PRIMARY KEY, body TEXT NOT NULL, digest TEXT NOT NULL) STRICT';

/** Borrows WorkspaceStore. Requires one trusted owner and no malicious same-UID writers.
 * SQLite FULL sync covers process crashes, not an independently verified power-loss guarantee.
 * COPY reservations bound supplied inputs, not shared daemon disk or resolver traffic.
 */
export class FrozenBrowserValidator {
  private directory: string;
  private workspace: WorkspaceStore;
  private db: DatabaseSync;
  private meta: Meta;
  private runs: Run[];
  private assets: Assets;
  private marker: Buffer;
  private identities: { root: Identity; journal: Identity; marker: Identity; policy: Identity };
  private active: {
    request: FrozenBrowserRequest;
    digest: string;
    controller: AbortController;
    promise: Promise<FrozenBrowserReport>;
  } | null = null;
  private closing: Promise<void> | null = null;
  private broken = false;
  private constructor(
    directory: string,
    workspace: WorkspaceStore,
    db: DatabaseSync,
    meta: Meta,
    runs: Run[],
    assets: Assets,
    marker: Buffer,
    identities: { root: Identity; journal: Identity; marker: Identity; policy: Identity },
  ) {
    this.directory = directory;
    this.workspace = workspace;
    this.db = db;
    this.meta = meta;
    this.runs = runs;
    this.assets = assets;
    this.marker = marker;
    this.identities = identities;
  }
  static async open(options: {
    workspace: WorkspaceStore;
    directory: string;
  }): Promise<FrozenBrowserValidator> {
    const directory = resolve(options.directory);
    if (owners.has(directory)) fail('validator-already-open');
    owners.add(directory);
    let db: DatabaseSync | undefined;
    try {
      const root = await lstat(directory);
      if (
        !root.isDirectory() ||
        root.uid !== process.getuid?.() ||
        (root.mode & 0o7777) !== 0o700 ||
        (await realpath(directory)) !== directory ||
        /\p{C}/u.test(directory)
      )
        fail('unsafe-validator-root');
      const load = (name: string, max: number) =>
        readRegular(
          fileURLToPath(new URL(`../worker/frozen-browser/${name}`, import.meta.url)),
          max,
          false,
        );
      const assets: Assets = {
        dockerfile: await load('Dockerfile', 2048),
        driver: await load('driver.mjs', 32768),
        watchdog: await load('watchdog.mjs', 8192),
        scenario: await load('scenario.json', 1024),
        policy: Buffer.from(
          namespaceChrootPolicy(
            await readRegular(
              fileURLToPath(
                new URL('../prototypes/chromium/seccomp/docker-29.4.0.json', import.meta.url),
              ),
              limits.control,
              false,
            ),
          ),
        ),
      };
      if (
        checksum(assets.policy) !== policyHash ||
        !same(parseJson(assets.scenario), {
          id: 'synthetic-click-v1',
          entry: 'src/index.html',
          button: '#run',
          output: '#result',
          initial: '',
          baseline: 'A',
          candidate: 'B',
        })
      )
        fail('unreviewed-worker-configuration');
      const configurationDigest = digest({
        version: 1,
        assets: Object.fromEntries(Object.entries(assets).map(([k, v]) => [k, checksum(v)])),
        limits,
        baseId,
        baseTag,
        entrypoint,
        engineCommit,
        baselineSha256,
      });
      const names = await readdir(directory),
        fresh = names.length === 0;
      const journalPath = join(directory, 'journal.sqlite'),
        markerPath = join(directory, 'owner.json'),
        policyPath = join(directory, 'seccomp.json');
      if (
        !fresh &&
        (!names.includes('owner.json') ||
          !names.includes('journal.sqlite') ||
          !names.includes('seccomp.json'))
      )
        fail('unowned-validator-directory');
      if (
        names.some(
          (name) =>
            !['owner.json', 'journal.sqlite', 'journal.sqlite-journal', 'seccomp.json'].includes(
              name,
            ),
        )
      )
        fail('unexpected-validator-file');
      if (fresh) {
        await writePrivate(journalPath, Buffer.alloc(0));
        await writePrivate(policyPath, assets.policy);
      }
      const rootIdentity = await identity(directory),
        journalIdentity = await identity(journalPath);
      if (!same(await readRegular(policyPath, limits.control), assets.policy))
        fail('validator-policy-changed');
      let owner: string;
      let marker: Buffer;
      if (fresh) {
        owner = randomUUID();
        marker = Buffer.from(
          JSON.stringify({ version: 1, owner, root: directory, rootIdentity, journalIdentity }),
        );
        await writePrivate(markerPath, marker);
        const fd = await open(
          directory,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        try {
          await fd.sync();
        } finally {
          await fd.close();
        }
      } else {
        marker = await readRegular(markerPath, 8192);
        const m = exact(parseJson(marker), [
          'version',
          'owner',
          'root',
          'rootIdentity',
          'journalIdentity',
        ]);
        owner = id(m.owner);
        if (
          m.version !== 1 ||
          m.root !== directory ||
          !same(m.rootIdentity, rootIdentity) ||
          !same(m.journalIdentity, journalIdentity)
        )
          fail('validator-owner-mismatch');
      }
      await readRegular(journalPath, limits.journal);
      const hot = names.includes('journal.sqlite-journal');
      if (hot) await readRegular(join(directory, 'journal.sqlite-journal'), limits.journal * 2);
      db = new DatabaseSync(journalPath, { readOnly: !fresh && !hot });
      db.exec('PRAGMA trusted_schema=OFF;');
      if (
        Object.values(db.prepare('PRAGMA integrity_check').get() ?? {})[0] !== 'ok' ||
        Object.values(db.prepare('PRAGMA page_size').get() ?? {})[0] !== 4096
      )
        fail('corrupt-validator-journal');
      if (fresh) db.exec(`${metaSchema}; ${runSchema};`);
      const schema = db.prepare('SELECT name, type, sql FROM sqlite_master ORDER BY name').all();
      if (
        !same(schema, [
          { name: 'meta', type: 'table', sql: metaSchema },
          { name: 'runs', type: 'table', sql: runSchema },
        ])
      )
        fail('corrupt-validator-schema');
      const decode = (row: Record<string, unknown>) => {
        const body = string(row.body, limits.journal);
        const value: unknown = parseJson(body);
        if (digest(value) !== row.digest) fail('corrupt-validator-journal');
        return value;
      };
      let meta: Meta;
      let runs: Run[] = [];
      if (fresh) meta = { version: 1, owner, configurationDigest, attempts: 0, contribution: 0 };
      else {
        const rows = db.prepare('SELECT body, digest FROM meta').all();
        if (rows.length !== 1) fail('missing-validator-accounting');
        const m = exact(decode(rows[0]), [
          'version',
          'owner',
          'configurationDigest',
          'attempts',
          'contribution',
        ]);
        meta = {
          version: 1,
          owner: id(m.owner),
          configurationDigest: sha256(m.configurationDigest),
          attempts: integer(m.attempts, 0, limits.attempts),
          contribution: integer(m.contribution, 0, limits.contribution),
        };
        if (
          m.version !== 1 ||
          meta.owner !== owner ||
          meta.configurationDigest !== configurationDigest ||
          meta.contribution !== meta.attempts * limits.context
        )
          fail('corrupt-validator-accounting');
        const records = db.prepare('SELECT id, body, digest FROM runs ORDER BY id').all();
        if (records.length !== meta.attempts) fail('missing-validator-accounting');
        runs = records.map((row, index) => {
          if (row.id !== index + 1) fail('corrupt-validator-accounting');
          return parseRun(decode(row), meta, assets);
        });
        if (
          new Set(runs.map((r) => key(r.intent.request))).size !== runs.length ||
          new Set(runs.map((r) => r.intent.runId)).size !== runs.length
        )
          fail('corrupt-validator-identities');
      }
      if (!same(journalIdentity, await identity(journalPath))) fail('validator-journal-replaced');
      if (!fresh) {
        db.close();
        db = new DatabaseSync(journalPath);
      }
      db.exec(
        'PRAGMA trusted_schema=OFF; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA max_page_count=40960;',
      );
      const validator = new FrozenBrowserValidator(
        directory,
        options.workspace,
        db,
        meta,
        runs,
        assets,
        marker,
        {
          root: rootIdentity,
          journal: journalIdentity,
          marker: await identity(markerPath),
          policy: await identity(policyPath),
        },
      );
      if (fresh) await validator.save();
      for (const run of runs) {
        if (run.result.kind === 'pending') {
          run.result = {
            kind: 'recorded',
            outcome: { kind: 'uncertain', code: 'interrupted-run-no-replay' },
            evidence: null,
          };
          await validator.save(run);
        }
        if (
          run.result.kind === 'recorded' ||
          (run.result.kind === 'settled' && run.result.report.cleanup.kind === 'incomplete')
        )
          await validator.finalize(run);
      }
      return validator;
    } catch (error) {
      db?.close();
      owners.delete(directory);
      throw error;
    }
  }
  private async guard() {
    if (this.broken) fail('validator-journal-failed');
    if (
      (await realpath(this.directory)) !== this.directory ||
      !same(await identity(this.directory), this.identities.root) ||
      !(await lstat(this.directory)).isDirectory()
    )
      fail('validator-root-replaced');
    for (const [name, expected] of [
      ['journal.sqlite', this.identities.journal],
      ['owner.json', this.identities.marker],
      ['seccomp.json', this.identities.policy],
    ] as const)
      if (!same(await identity(join(this.directory, name)), expected))
        fail('validator-file-replaced');
    if (
      !same(await readRegular(join(this.directory, 'owner.json'), 8192), this.marker) ||
      !same(
        await readRegular(join(this.directory, 'seccomp.json'), limits.control),
        this.assets.policy,
      )
    )
      fail('validator-ownership-changed');
    for (const name of await readdir(this.directory)) {
      if (
        !['journal.sqlite', 'journal.sqlite-journal', 'owner.json', 'seccomp.json'].includes(name)
      )
        fail('unexpected-validator-file');
      await readRegular(
        join(this.directory, name),
        name === 'journal.sqlite-journal' ? limits.journal * 2 : limits.journal,
      );
    }
  }
  private async save(run?: Run, signal?: AbortSignal) {
    try {
      await this.guard();
      if (
        run?.result.kind === 'recorded' &&
        run.result.outcome.kind !== 'uncertain' &&
        (signal?.aborted || (signal && Date.now() >= run.intent.deadline))
      )
        run.result.outcome = { kind: 'cancelled', code: 'cancelled-or-allowance-exhausted' };
      const body = JSON.stringify(this.meta);
      this.db.exec('BEGIN IMMEDIATE');
      this.db
        .prepare(
          'INSERT INTO meta VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,digest=excluded.digest',
        )
        .run(body, digest(this.meta));
      if (run) {
        const value = JSON.stringify(run);
        if (Buffer.byteLength(value) > limits.evidence + limits.control)
          fail('validator-record-limit');
        this.db
          .prepare(
            'INSERT INTO runs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,digest=excluded.digest',
          )
          .run(this.runs.indexOf(run) + 1, value, digest(run));
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.broken = true;
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  validate(value: FrozenBrowserRequest, signal: AbortSignal): Promise<FrozenBrowserReport> {
    try {
      if (this.closing || this.broken) fail('validator-closed');
      const request = frozenBrowserRequest(value),
        requestDigest = digest(request);
      const existing = this.runs.find((r) => key(r.intent.request) === key(request));
      if (existing && existing.intent.requestDigest !== requestDigest)
        fail('validator-identity-conflict');
      if (this.active && key(this.active.request) === key(request)) {
        if (this.active.digest !== requestDigest) fail('validator-identity-conflict');
        this.attach(signal, this.active);
        return this.active.promise.then((r) => structuredClone(r));
      }
      if (existing) {
        if (existing.result.kind !== 'settled') return fail('validator-unsettled');
        return Promise.resolve(structuredClone(existing.result.report));
      }
      if (this.active) fail('validator-busy');
      if (this.runs.some((r) => r.ledger.build === 'unknown'))
        fail('validator-daemon-build-unresolved');
      if (
        this.meta.attempts >= limits.attempts ||
        this.meta.contribution + limits.context > limits.contribution
      )
        fail('validator-lifetime-limit');
      signal.throwIfAborted();
      const controller = new AbortController();
      const promise = Promise.resolve().then(() => this.execute(request, controller));
      const active = { request, digest: requestDigest, controller, promise };
      this.active = active;
      this.attach(signal, active);
      void promise
        .finally(() => {
          if (this.active === active) this.active = null;
        })
        .catch(() => {});
      return promise.then((r) => structuredClone(r));
    } catch (error) {
      return Promise.reject(error);
    }
  }
  private attach(signal: AbortSignal, active: NonNullable<FrozenBrowserValidator['active']>) {
    const abort = () => active.controller.abort(new Error('action-cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    void active.promise.finally(() => signal.removeEventListener('abort', abort)).catch(() => {});
  }
  private client(
    args: string[],
    deadline: number,
    signal?: AbortSignal,
    input?: Buffer,
    stdoutLimit = limits.control,
  ): Promise<ClientResult> {
    if (signal?.aborted) return Promise.resolve({ kind: 'lost', code: 'client-aborted' });
    if (deadline <= Date.now()) return Promise.resolve({ kind: 'lost', code: 'client-timeout' });
    return new Promise((resolveResult) => {
      const child = spawn('docker', ['--context', 'orbstack', ...args], {
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let lost: Extract<ClientResult, { kind: 'lost' }>['code'] | null = null;
      const stdout: Buffer[] = [],
        stderr: Buffer[] = [];
      let outBytes = 0,
        errBytes = 0;
      const stop = (code: NonNullable<typeof lost>) => {
        lost ??= code;
        child.kill('SIGKILL');
      };
      const timer = setTimeout(() => stop('client-timeout'), Math.max(1, deadline - Date.now()));
      const abort = () => stop('client-aborted');
      signal?.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', (bytes: Buffer) => {
        outBytes += bytes.length;
        if (outBytes > stdoutLimit) stop('client-overflow');
        else stdout.push(bytes);
      });
      child.stderr.on('data', (bytes: Buffer) => {
        errBytes += bytes.length;
        if (errBytes > limits.stderr) stop('client-overflow');
        else stderr.push(bytes);
      });
      child.on('error', () => {
        lost ??= 'client-error';
      });
      child.stdin.on('error', () => {
        lost ??= 'client-error';
        child.kill('SIGKILL');
      });
      child.on('close', (status, killed) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (lost) resolveResult({ kind: 'lost', code: lost });
        else if (killed || status === null) resolveResult({ kind: 'lost', code: 'client-error' });
        else
          resolveResult({
            kind: 'exited',
            status,
            stdout: Buffer.concat(stdout),
            stderr: Buffer.concat(stderr),
          });
      });
      if (signal?.aborted) abort();
      child.stdin.end(input);
    });
  }
  private async checked(args: string[], deadline: number, signal?: AbortSignal): Promise<Buffer> {
    const result = await this.client(args, deadline, signal);
    if (result.kind !== 'exited' || result.status !== 0) return fail('docker-operation-failed');
    return result.stdout;
  }
  private async inspect(
    kind: 'image' | 'container',
    reference: string,
    deadline: number,
    signal?: AbortSignal,
  ) {
    return single(
      parseJson(
        await this.checked(
          kind === 'image' ? ['image', 'inspect', reference] : ['container', 'inspect', reference],
          deadline,
          signal,
        ),
      ),
    );
  }
  private async base(deadline: number, signal?: AbortSignal) {
    const image = verifyImage(await this.inspect('image', baseTag, deadline, signal), true);
    return {
      id: imageId(image.Id),
      architecture: 'arm64',
      os: 'linux',
      rootFS: object(image.RootFS),
      env: envSet(object(image.Config).Env),
    };
  }
  private labels(run: Run, value: unknown) {
    const labels = object(object(value).Labels);
    if (labels[labelOwner] !== run.intent.owner || labels[labelRun] !== run.intent.runId)
      fail('resource-ownership-mismatch');
  }
  private async execute(
    request: FrozenBrowserRequest,
    controller: AbortController,
  ): Promise<FrozenBrowserReport> {
    const admittedAt = Date.now(),
      runId = randomUUID();
    const run: Run = {
      intent: {
        runId,
        request,
        requestDigest: digest(request),
        configurationDigest: this.meta.configurationDigest,
        nonce: randomBytes(32).toString('hex'),
        owner: this.meta.owner,
        imageTag: `eitri-frozen-browser:${runId}`,
        containerName: `eitri-frozen-browser-${runId}`,
        admittedAt,
        deadline: admittedAt + request.allowanceMs,
        reservation: limits.context,
      },
      ledger: { build: 'not-started', image: { kind: 'none' }, container: { kind: 'none' } },
      result: { kind: 'pending' },
    };
    this.runs.push(run);
    this.meta.attempts++;
    this.meta.contribution += limits.context;
    await this.save(run);
    const timer = setTimeout(
      () => controller.abort(new Error('allowance-exhausted')),
      Math.max(1, run.intent.deadline - Date.now()),
    );
    const signal = controller.signal,
      deadline = run.intent.deadline;
    let reportEvidence: FrozenBrowserEvidence | null = null;
    let result: FrozenBrowserOutcome;
    try {
      const files = await this.workspace.readFrozen(request.frozen, signal);
      signal.throwIfAborted();
      const manifest: Manifest = files
        .map((f) => ({ path: f.virtualPath, size: f.bytes.length, sha256: checksum(f.bytes) }))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      const directories = new Set(['rootfs', 'rootfs/snapshot']);
      for (const f of files) {
        const components = f.virtualPath.split('/');
        components.pop();
        while (components.length) {
          directories.add(`rootfs/snapshot/${components.join('/')}`);
          components.pop();
        }
      }
      const context = tar([
        ...[...directories]
          .sort()
          .map((path) => ({ path, bytes: Buffer.alloc(0), directory: true })),
        { path: 'Dockerfile', bytes: this.assets.dockerfile },
        { path: 'driver.mjs', bytes: this.assets.driver },
        { path: 'watchdog.mjs', bytes: this.assets.watchdog },
        { path: 'scenario.json', bytes: this.assets.scenario },
        ...files.map((f) => ({
          path: `rootfs/snapshot/${f.virtualPath}`,
          bytes: Buffer.from(f.bytes),
        })),
      ]);
      const server = object(
        parseJson(
          await this.checked(['version', '--format', '{{json .Server}}'], deadline, signal),
        ),
      );
      if (
        server.Version !== '29.4.0' ||
        server.Arch !== 'arm64' ||
        !/^[a-f0-9]{8,40}$/.test(string(server.GitCommit)) ||
        !engineCommit.startsWith(string(server.GitCommit))
      )
        fail('unreviewed-docker-engine');
      const security = array(
        parseJson(
          await this.checked(['info', '--format', '{{json .SecurityOptions}}'], deadline, signal),
        ),
        32,
      );
      if (!security.includes('name=seccomp,profile=builtin')) fail('docker-seccomp-unavailable');
      const before = await this.base(deadline, signal);
      run.ledger.build = 'unknown';
      run.ledger.image = { kind: 'intent' };
      await this.save(run);
      signal.throwIfAborted();
      const build = await this.client(
        [
          'build',
          '--pull=false',
          '--network=none',
          '--progress=plain',
          '--platform=linux/arm64',
          '--label',
          `${labelOwner}=${run.intent.owner}`,
          '--label',
          `${labelRun}=${runId}`,
          '--tag',
          run.intent.imageTag,
          '-',
        ],
        deadline,
        signal,
        context,
      );
      if (build.kind === 'lost') return fail('daemon-build-unresolved');
      run.ledger.build = 'completed';
      await this.save(run);
      if (
        build.status !== 0 ||
        /\[auth\]|\bpulling\b|pull access|https?:\/\/|failed to (?:authorize|fetch .*token)|dial tcp|proxyconnect|no such host/i.test(
          `${build.stdout}\n${build.stderr}`,
        )
      )
        fail('copy-build-failed-or-network-observed');
      const after = await this.base(deadline, signal);
      if (!same(before, after)) fail('base-image-changed');
      const image = verifyImage(await this.inspect('image', run.intent.imageTag, deadline, signal));
      this.labels(run, image.Config);
      const derivedId = imageId(image.Id),
        config = object(image.Config);
      if (
        derivedId === baseId ||
        !same(
          array(object(image.RootFS).Layers, 256).slice(0, array(before.rootFS.Layers, 256).length),
          before.rootFS.Layers,
        ) ||
        array(object(image.RootFS).Layers, 256).length <= array(before.rootFS.Layers, 256).length ||
        !same(config.Entrypoint, entrypoint) ||
        (config.Cmd !== undefined && config.Cmd !== null && !same(config.Cmd, [])) ||
        config.User !== '1001:1001' ||
        config.WorkingDir !== '/opt/eitri' ||
        !same(envSet(config.Env), before.env)
      )
        fail('derived-image-binding');
      run.ledger.image = { kind: 'acquired', id: derivedId };
      await this.save(run);
      const bindings = [
        `EITRI_DEADLINE=${deadline}`,
        `EITRI_NONCE=${run.intent.nonce}`,
        `EITRI_REQUEST=${run.intent.requestDigest}`,
      ];
      const expectedEnv = envSet([...before.env, ...bindings]);
      run.ledger.container = { kind: 'intent' };
      await this.save(run);
      signal.throwIfAborted();
      const created = containerId(
        (
          await this.checked(
            [
              'create',
              '--name',
              run.intent.containerName,
              '--label',
              `${labelOwner}=${run.intent.owner}`,
              '--label',
              `${labelRun}=${runId}`,
              '--platform',
              'linux/arm64',
              '--user',
              '1001:1001',
              '--read-only',
              '--network',
              'none',
              '--cap-drop',
              'ALL',
              '--security-opt',
              'no-new-privileges',
              '--security-opt',
              `seccomp=${join(this.directory, 'seccomp.json')}`,
              '--cpus',
              '2',
              '--memory',
              '4g',
              '--memory-swap',
              '4g',
              '--pids-limit',
              '256',
              '--ipc',
              'private',
              '--shm-size',
              '256m',
              '--tmpfs',
              '/tmp:rw,exec,nosuid,size=256m,uid=1001,gid=1001',
              '--ulimit',
              'core=0',
              '--stop-timeout',
              '2',
              ...bindings.flatMap((binding) => ['--env', binding]),
              derivedId,
            ],
            deadline,
            signal,
          )
        )
          .toString('utf8')
          .trim(),
      );
      run.ledger.container = { kind: 'acquired', id: created };
      await this.save(run);
      const container = await this.inspect('container', created, deadline, signal);
      const applied = this.applied(run, container, derivedId, expectedEnv);
      signal.throwIfAborted();
      const execution = await this.client(
        ['start', '-a', created],
        deadline,
        signal,
        undefined,
        limits.stdout,
      );
      if (execution.kind === 'lost') return fail('execution-client-lost');
      const stopped = await this.inspect('container', created, deadline, signal);
      this.labels(run, stopped.Config);
      const state = object(stopped.State);
      if (
        stopped.Id !== created ||
        stopped.Image !== derivedId ||
        state.Status !== 'exited' ||
        state.ExitCode !== 0 ||
        state.OOMKilled !== false ||
        execution.status !== 0
      )
        fail('worker-exit-failed');
      const parsed = protocol(execution.stdout, run.intent, manifest, this.assets);
      reportEvidence = evidence({
        provenance: {
          requestDigest: run.intent.requestDigest,
          configurationDigest: run.intent.configurationDigest,
          frozen: request.frozen,
          transfer: manifest,
          contextBytes: context.length,
          contextSha256: checksum(context),
          assets: Object.fromEntries(Object.entries(this.assets).map(([k, v]) => [k, checksum(v)])),
          policy: { sha256: policyHash, engineCommit, baselineSha256 },
          engine: {
            version: server.Version,
            arch: server.Arch,
            commit: server.GitCommit,
            security,
          },
          baseBefore: before,
          baseAfter: after,
          imageId: derivedId,
          containerId: created,
          applied,
          admittedAt,
          deadline,
          finishedAt: Date.now(),
          exitCode: execution.status,
          oomKilled: false,
          stdoutSha256: checksum(execution.stdout),
          stderrSha256: checksum(execution.stderr),
          buildStdoutSha256: checksum(build.stdout),
          buildStderrSha256: checksum(build.stderr),
        },
        observations: parsed.observed,
        png: parsed.png,
      });
      result = classify(request, parsed.observed);
    } catch {
      result =
        run.ledger.build === 'unknown'
          ? { kind: 'uncertain', code: 'daemon-build-unresolved' }
          : signal.aborted
            ? { kind: 'cancelled', code: 'cancelled-or-allowance-exhausted' }
            : { kind: 'infrastructure-failed', code: 'frozen-browser-check-failed' };
    } finally {
      clearTimeout(timer);
    }
    if (signal.aborted && result.kind !== 'uncertain')
      result = { kind: 'cancelled', code: 'cancelled-or-allowance-exhausted' };
    await this.guard();
    if (signal.aborted && result.kind !== 'uncertain')
      result = { kind: 'cancelled', code: 'cancelled-or-allowance-exhausted' };
    run.result = { kind: 'recorded', outcome: result, evidence: reportEvidence };
    await this.save(run, signal);
    return this.finalize(run);
  }
  private applied(
    run: Run,
    container: ObjectValue,
    derivedId: string,
    expectedEnv: string[],
  ): ObjectValue {
    this.labels(run, container.Config);
    if (
      run.ledger.container.kind !== 'acquired' ||
      container.Id !== run.ledger.container.id ||
      container.Image !== derivedId ||
      object(container.State).Status !== 'created' ||
      !same(container.Mounts, [])
    )
      fail('container-identity');
    const c = object(container.Config),
      h = object(container.HostConfig);
    if (
      c.User !== '1001:1001' ||
      c.WorkingDir !== '/opt/eitri' ||
      !same(c.Entrypoint, entrypoint) ||
      (c.Cmd !== undefined && c.Cmd !== null && !same(c.Cmd, [])) ||
      c.Healthcheck ||
      c.Volumes ||
      c.ExposedPorts ||
      c.StopTimeout !== 2 ||
      c.OpenStdin !== false ||
      c.Tty !== false ||
      !same(envSet(c.Env), expectedEnv)
    )
      fail('container-configuration');
    for (const field of [
      'Binds',
      'Mounts',
      'VolumesFrom',
      'Devices',
      'DeviceRequests',
      'Links',
      'ExtraHosts',
      'GroupAdd',
      'Dns',
      'DnsOptions',
      'DnsSearch',
      'CapAdd',
    ])
      if (h[field] !== undefined && h[field] !== null && array(h[field], 0).length)
        fail('container-host-binding');
    for (const field of ['PortBindings', 'Sysctls', 'StorageOpt', 'Annotations'])
      if (h[field] !== undefined && h[field] !== null && Object.keys(object(h[field])).length)
        fail('container-host-options');
    for (const field of [
      'PidMode',
      'UTSMode',
      'UsernsMode',
      'CgroupParent',
      'ContainerIDFile',
      'VolumeDriver',
    ])
      if (h[field] !== undefined && h[field] !== '') fail('container-host-namespace');
    if (
      h.NetworkMode !== 'none' ||
      h.ReadonlyRootfs !== true ||
      h.Privileged !== false ||
      !same(h.CapDrop, ['ALL']) ||
      h.Memory !== 4294967296 ||
      h.MemorySwap !== 4294967296 ||
      h.NanoCpus !== 2e9 ||
      h.PidsLimit !== 256 ||
      h.IpcMode !== 'private' ||
      h.ShmSize !== 256 * 1024 ** 2 ||
      h.PublishAllPorts !== false ||
      h.AutoRemove !== false ||
      (h.Runtime !== undefined && h.Runtime !== 'runc') ||
      (h.CgroupnsMode !== undefined && h.CgroupnsMode !== 'private') ||
      !same(h.Tmpfs, { '/tmp': 'rw,exec,nosuid,size=256m,uid=1001,gid=1001' }) ||
      !same(h.Ulimits, [{ Name: 'core', Hard: 0, Soft: 0 }])
    )
      fail('container-resource-contract');
    for (const field of [
      'CpuShares',
      'CpuPeriod',
      'CpuQuota',
      'CpuRealtimePeriod',
      'CpuRealtimeRuntime',
      'CpuCount',
      'CpuPercent',
      'MemoryReservation',
      'KernelMemory',
      'KernelMemoryTCP',
      'BlkioWeight',
      'IOMaximumIOps',
      'IOMaximumBandwidth',
      'OomScoreAdj',
    ])
      if (h[field] !== undefined && h[field] !== null && h[field] !== 0)
        fail('container-resource-override');
    for (const field of ['CpusetCpus', 'CpusetMems', 'Isolation'])
      if (h[field] !== undefined && h[field] !== '') fail('container-resource-override');
    for (const field of [
      'DeviceCgroupRules',
      'BlkioWeightDevice',
      'BlkioDeviceReadBps',
      'BlkioDeviceWriteBps',
      'BlkioDeviceReadIOps',
      'BlkioDeviceWriteIOps',
    ])
      if (h[field] !== undefined && h[field] !== null && array(h[field], 0).length)
        fail('container-device-override');
    if (
      (h.Init !== undefined && h.Init !== null && h.Init !== false) ||
      (h.OomKillDisable !== undefined && h.OomKillDisable !== null && h.OomKillDisable !== false) ||
      (h.MemorySwappiness !== undefined && h.MemorySwappiness !== null && h.MemorySwappiness !== -1)
    )
      fail('container-runtime-override');
    const restart = object(h.RestartPolicy);
    if (restart.Name !== 'no' || restart.MaximumRetryCount !== 0) fail('container-restart-policy');
    const opts = array(h.SecurityOpt, 2).map((s) => string(s, limits.control));
    if (
      opts.length !== 2 ||
      opts.filter((s) => s === 'no-new-privileges' || s === 'no-new-privileges=true').length !==
        1 ||
      opts.filter(
        (s) =>
          s.startsWith('seccomp=') && same(parseJson(s.slice(8)), parseJson(this.assets.policy)),
      ).length !== 1
    )
      fail('container-security-policy');
    return {
      image: derivedId,
      inspectionSha256: digest({ config: c, hostConfig: h, mounts: container.Mounts }),
      config: {
        User: c.User,
        WorkingDir: c.WorkingDir,
        Entrypoint: c.Entrypoint,
        Cmd: [],
        StopTimeout: c.StopTimeout,
        OpenStdin: c.OpenStdin,
        Tty: c.Tty,
        Env: envSet(c.Env),
        Labels: { [labelOwner]: run.intent.owner, [labelRun]: run.intent.runId },
      },
      hostConfig: Object.fromEntries(
        [
          'NetworkMode',
          'ReadonlyRootfs',
          'Privileged',
          'CapAdd',
          'CapDrop',
          'SecurityOpt',
          'Memory',
          'MemorySwap',
          'NanoCpus',
          'PidsLimit',
          'IpcMode',
          'ShmSize',
          'Tmpfs',
          'Ulimits',
          'PublishAllPorts',
          'AutoRemove',
          'Runtime',
          'CgroupnsMode',
          'RestartPolicy',
        ]
          .filter((field) => field in h)
          .map((field) => [field, h[field]]),
      ),
      mounts: [],
    };
  }
  private async resourceIds(
    run: Run,
    kind: 'image' | 'container',
    deadline: number,
  ): Promise<string[]> {
    const resource = run.ledger[kind];
    const filter =
      kind === 'container'
        ? [
            '--filter',
            resource.kind === 'acquired'
              ? `id=${resource.id}`
              : `name=^/${run.intent.containerName}$`,
          ]
        : resource.kind === 'acquired'
          ? []
          : ['--filter', `reference=${run.intent.imageTag}`];
    const bytes = await this.checked(
      [kind, 'ls', '--all', '--no-trunc', '--quiet', ...filter],
      deadline,
    );
    const text = bytes.toString('utf8').trim();
    const ids = text
      ? text.split('\n').map((v) => (kind === 'image' ? imageId(v) : containerId(v)))
      : [];
    return resource.kind === 'acquired' ? ids.filter((v) => v === resource.id) : [...new Set(ids)];
  }
  private async remove(run: Run, kind: 'image' | 'container', deadline: number) {
    if (run.ledger[kind].kind === 'none') return;
    const ids = await this.resourceIds(run, kind, deadline);
    if (!ids.length) {
      if (kind === 'container' && run.ledger.container.kind === 'intent')
        fail('container-acquisition-unresolved');
      return;
    }
    if (ids.length !== 1) fail('ambiguous-resource-identity');
    const inspected = await this.inspect(kind, ids[0], deadline);
    this.labels(run, inspected.Config);
    const actual = kind === 'image' ? imageId(inspected.Id) : containerId(inspected.Id);
    const known = run.ledger[kind];
    if (known.kind === 'acquired' && known.id !== actual) fail('resource-identity-mismatch');
    if (kind === 'image' && (actual === baseId || !same(inspected.RepoTags, [run.intent.imageTag])))
      fail('image-ownership-mismatch');
    if (kind === 'container' && inspected.Name !== `/${run.intent.containerName}`)
      fail('container-name-mismatch');
    run.ledger[kind] = { kind: 'acquired', id: actual };
    await this.save(run);
    await this.checked(
      kind === 'image'
        ? ['image', 'rm', run.intent.imageTag]
        : ['container', 'rm', '--force', actual],
      deadline,
    );
    if ((await this.resourceIds(run, kind, deadline)).length) fail('resource-removal-unconfirmed');
  }
  private async finalize(run: Run): Promise<FrozenBrowserReport> {
    if (run.result.kind === 'pending') return fail('validator-result-not-recorded');
    const saved = run.result.kind === 'recorded' ? run.result : run.result.report;
    let cleaned: FrozenBrowserCleanup;
    try {
      await this.guard();
      const deadline = Date.now() + limits.cleanupMs;
      await this.remove(run, 'container', deadline);
      if (run.ledger.build === 'unknown') fail('daemon-build-unresolved');
      await this.remove(run, 'image', deadline);
      cleaned = {
        kind:
          run.ledger.image.kind === 'none' && run.ledger.container.kind === 'none'
            ? 'not-needed'
            : 'owned-removed',
        cache: 'retained',
      };
    } catch {
      cleaned = {
        kind: 'incomplete',
        cache: 'retained',
        code:
          run.ledger.build === 'unknown' ? 'daemon-build-unresolved' : 'owned-cleanup-unconfirmed',
      };
    }
    const report: FrozenBrowserReport = {
      runId: run.intent.runId,
      request: run.intent.request,
      outcome: saved.outcome,
      evidence: saved.evidence,
      cleanup: cleaned,
    };
    run.result = { kind: 'settled', report };
    await this.save(run);
    return report;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    const active = this.active;
    this.closing = Promise.resolve().then(async () => {
      active?.controller.abort(new Error('validator-closing'));
      try {
        await active?.promise;
      } finally {
        this.db.close();
        owners.delete(this.directory);
      }
    });
    return this.closing;
  }
}
