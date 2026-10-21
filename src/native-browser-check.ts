import { isDeepStrictEqual } from 'node:util';
import { actionDeadlineAt, digest, fail, uuid } from './domain.ts';
import type { Action, RealBrowserCheck, SimulatedCheck } from './domain.ts';
import { admitFrozenBrowserConsumedReport, frozenBrowserRequest } from './frozen-browser.ts';
import type {
  FrozenBrowserAdmission,
  FrozenBrowserConsumedExpectation,
  FrozenBrowserConsumedReport,
  FrozenBrowserRequest,
} from './frozen-browser.ts';
import { sha256 } from './workspace.ts';
import type { FrozenRevision } from './workspace.ts';

export type NativeExecutionAnchor = Readonly<{
  action: Action;
  kind: 'baseline' | 'browser';
  frozen: FrozenRevision;
  intent: { request: FrozenBrowserRequest; requestDigest: string };
  binding: { version: 1; ownerId: string; configurationDigest: string };
  facts: {
    consumedRun: { acceptanceId: string; runId: string; requestDigest: string };
    admittedAt: number;
    deadline: number;
  };
}>;
export type ConsumedCheckAuthority = Readonly<{
  anchor: NativeExecutionAnchor;
  assertCurrent(): void;
}>;
export type NativeRealExecutionV1 = Readonly<{
  version: 1;
  anchor: NativeExecutionAnchor;
  history: Extract<FrozenBrowserConsumedReport, { state: 'settled' }>;
}>;
export type StoredRealCheck = Omit<RealBrowserCheck, 'provenance'> & {
  execution: NativeRealExecutionV1;
};
export type StoredCheck = SimulatedCheck | StoredRealCheck;
export const executionLimits = {
  executionBytes: 8 * 1024 ** 2 + 512 * 1024,
  caseBytes: 32 * 1024 ** 2,
} as const;
export const executionSize = (value: NativeRealExecutionV1) =>
  Buffer.byteLength(JSON.stringify(value));
function keys(value: object, expected: string[]) {
  if (
    !value ||
    Array.isArray(value) ||
    !isDeepStrictEqual(Object.keys(value).sort(), expected.sort())
  )
    fail('invalid-check-execution');
}
export function consumedExpectation(
  anchor: NativeExecutionAnchor,
): FrozenBrowserConsumedExpectation {
  keys(anchor, ['action', 'kind', 'frozen', 'intent', 'binding', 'facts']);
  keys(anchor.action, ['id', 'caseId', 'epoch', 'kind', 'startedAt', 'limitMs', 'usedAtStart']);
  keys(anchor.frozen, ['caseId', 'revision', 'manifestDigest']);
  keys(anchor.intent, ['request', 'requestDigest']);
  keys(anchor.binding, ['version', 'ownerId', 'configurationDigest']);
  keys(anchor.facts, ['consumedRun', 'admittedAt', 'deadline']);
  const { action, intent, binding, facts } = anchor;
  const request = frozenBrowserRequest(intent.request);
  actionDeadlineAt(action);
  if (
    !uuid(action.id) ||
    !uuid(action.caseId) ||
    action.kind !== 'tool' ||
    !Number.isSafeInteger(action.epoch) ||
    action.epoch < 0 ||
    !Number.isSafeInteger(action.usedAtStart) ||
    action.usedAtStart < 0 ||
    binding.version !== 1 ||
    !uuid(binding.ownerId) ||
    binding.ownerId !== binding.ownerId.toLowerCase() ||
    digest(request) !== intent.requestDigest ||
    facts.consumedRun.requestDigest !== intent.requestDigest ||
    !isDeepStrictEqual(request.frozen, anchor.frozen) ||
    request.action.caseId !== action.caseId ||
    request.action.actionId !== action.id ||
    request.action.epoch !== action.epoch ||
    request.allowanceMs > action.limitMs
  )
    fail('invalid-check-execution');
  const common = {
    configurationDigest: sha256(binding.configurationDigest),
    consumedRun: { ...facts.consumedRun, requestDigest: sha256(facts.consumedRun.requestDigest) },
    admittedAt: facts.admittedAt,
    deadline: facts.deadline,
  };
  if (anchor.kind === 'baseline' && request.role === 'baseline')
    return { ...common, kind: 'baseline', request: { ...request, role: 'baseline' } };
  if (anchor.kind === 'browser' && request.role === 'candidate')
    return { ...common, kind: 'browser', request: { ...request, role: 'candidate' } };
  return fail('invalid-check-execution');
}
export function realCheckFields(
  anchor: NativeExecutionAnchor,
  admission: Extract<FrozenBrowserAdmission, { type: 'behavioral' }>,
) {
  return {
    caseId: anchor.action.caseId,
    actionId: anchor.action.id,
    kind: anchor.kind,
    candidate: anchor.frozen.revision,
    configuration: anchor.binding.configurationDigest,
    passed: admission.passed,
    simulated: false as const,
  };
}
export function projectRealCheck(stored: StoredRealCheck) {
  keys(stored, [
    'id',
    'caseId',
    'actionId',
    'kind',
    'candidate',
    'configuration',
    'passed',
    'simulated',
    'artifacts',
    'execution',
  ]);
  const execution = stored.execution;
  keys(execution, ['version', 'anchor', 'history']);
  if (execution.version !== 1 || executionSize(execution) > executionLimits.executionBytes)
    fail('invalid-check-execution');
  const expected = consumedExpectation(execution.anchor);
  const admission = admitFrozenBrowserConsumedReport(expected, execution.history);
  if (admission.type !== 'behavioral') return fail('invalid-check-execution');
  const { execution: _execution, ...fields } = stored;
  if (
    !uuid(stored.id) ||
    !Array.isArray(stored.artifacts) ||
    stored.artifacts.length !== 1 ||
    !uuid(stored.artifacts[0]) ||
    !isDeepStrictEqual(fields, {
      id: stored.id,
      ...realCheckFields(execution.anchor, admission),
      artifacts: stored.artifacts,
    })
  )
    fail('invalid-check-receipt');
  const { anchor } = execution;
  const check: RealBrowserCheck = {
    ...fields,
    provenance: {
      kind: 'frozen-browser-consumed-v1',
      epoch: anchor.action.epoch,
      ownerId: anchor.binding.ownerId,
      ...anchor.facts.consumedRun,
      admittedAt: anchor.facts.admittedAt,
      deadline: anchor.facts.deadline,
      finishedAt: admission.report.evidence.provenance.finishedAt,
      outcome: admission.report.outcome.kind,
    },
  };
  return { check, output: admission.outputs[0] };
}
