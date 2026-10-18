import { createHash } from 'node:crypto';

export const phases = ['triage', 'investigation', 'implementation', 'testing', 'publication', 'pr-created'] as const;
export type Phase = typeof phases[number];
export type Status = 'provisioning' | 'queued' | 'running' | 'pause-requested' | 'paused' | 'needs-attention' | 'awaiting-merge' | 'terminal';
export type Issue = {
  id: string; project: string; environment: string; repository: string; title: string;
  priority: 'high' | 'medium' | 'low' | 'unknown'; status: 'unresolved' | 'resolved' | 'ignored' | 'unknown';
  regressed: boolean; escalating: boolean;
};
export type Case = {
  id: string; issueKey: string; issue: Issue; previousId: string | null;
  phase: Phase; status: Status; version: number; epoch: number;
  native: 'provisioning' | 'ready' | 'missing' | 'deleting' | 'expired';
  remainingMs: number; usedMs: number; attempt: number; repairs: number;
  accountedAt: number | null; terminalAt: number | null;
  outcome: 'no-fix' | 'dismissed' | 'merged' | null; reason: string;
  base: string | null; candidate: string | null; failedCandidate: string | null; simulated: boolean;
};
export type Intent =
  | { type: 'investigate'; issue: Issue }
  | { type: 'pause' | 'continue' | 'retry' | 'dismiss' | 'requeue' | 'details-cleanup'; caseId: string; note?: string; confirmed?: boolean }
  | { type: 'post-message'; caseId: string; text: string }
  | { type: 'check-now' };
export type Command = { requestId: string; expectedControlVersion?: number; intent: Intent };
export type Receipt = { requestId: string; caseId: string | null; version: number | null; disposition: 'accepted' | 'existing' };
export type Selection = { selected?: string; before?: string; limit?: number };
export type Message = { id: string; kind: string; data: unknown; timestamp: number };
export type Snapshot = { protocol: 1; bootId: string; sequence: number; mode: 'scripted'; cases: Case[]; selected: { case: Case; messages: Message[]; more: boolean } | null };
export type Assessment = {
  phase: Phase; expectedControlVersion: number;
  conclusion: 'progress' | 'no-fix' | 'attention'; reason: string; evidenceIds: string[];
  proposal?: string; paths?: string[]; candidate?: string;
};
export type Check = {
  id: string; kind: 'baseline' | 'checkpoint' | 'unit' | 'regression' | 'build' | 'browser';
  candidate: string; configuration: string; passed: boolean; simulated: boolean;
  artifacts: string[];
};
export type Action = { id: string; caseId: string; epoch: number; kind: 'model' | 'tool'; startedAt: number; limitMs: number; usedAtStart: number };
export class ControlError extends Error {
  code: string;
  constructor(code: string, message = code) { super(message); this.code = code; }
}
export const fail = (code: string): never => { throw new ControlError(code); };
export const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const text = (value: unknown, max = 16000): value is string => typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= max;
export const issueKey = (issue: Issue) => digest([issue.project, issue.environment, issue.repository, issue.id]);
export function parseCommand(value: unknown): Command {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('invalid-command');
  const c = value as Record<string, unknown>;
  if (!uuid(c.requestId) || Object.keys(c).some(k => !['requestId', 'expectedControlVersion', 'intent'].includes(k))) return fail('invalid-command');
  if (c.expectedControlVersion !== undefined && (!Number.isSafeInteger(c.expectedControlVersion) || Number(c.expectedControlVersion) < 1)) return fail('invalid-version');
  const i = c.intent as Record<string, unknown>;
  if (!i || typeof i !== 'object' || Array.isArray(i) || typeof i.type !== 'string') return fail('invalid-intent');
  const allowed: Record<string, string[]> = {
    investigate: ['type', 'issue'], 'check-now': ['type'], 'post-message': ['type', 'caseId', 'text'],
    pause: ['type', 'caseId'], continue: ['type', 'caseId'], retry: ['type', 'caseId', 'note'],
    dismiss: ['type', 'caseId', 'note'], requeue: ['type', 'caseId', 'note'],
    'details-cleanup': ['type', 'caseId', 'confirmed'],
  };
  const keys = allowed[i.type];
  if (!keys || Object.keys(i).some(k => !keys.includes(k))) return fail('invalid-intent');
  if (i.type === 'investigate') {
    const issue = i.issue as Record<string, unknown>;
    if (!issue || typeof issue !== 'object' || Array.isArray(issue)
      || Object.keys(issue).sort().join(',') !== 'environment,escalating,id,priority,project,regressed,repository,status,title'
      || !['id', 'project', 'environment', 'repository', 'title'].every(k => text(issue[k], 512))
      || !['high', 'medium', 'low', 'unknown'].includes(String(issue.priority))
      || !['unresolved', 'resolved', 'ignored', 'unknown'].includes(String(issue.status))
      || typeof issue.regressed !== 'boolean' || typeof issue.escalating !== 'boolean') return fail('invalid-issue');
  } else if (i.type !== 'check-now') {
    if (!uuid(i.caseId)) return fail('invalid-case');
    if (i.type === 'post-message' && !text(i.text)) return fail('invalid-message');
    if (['retry', 'dismiss', 'requeue'].includes(i.type) && !text(i.note, 512)) return fail('note-required');
    if (i.type === 'details-cleanup' && i.confirmed !== true) return fail('confirmation-required');
  }
  return value as Command;
}
