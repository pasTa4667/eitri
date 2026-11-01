import assert from 'node:assert/strict';
import { nativeWorkflowStep } from './pi-native-workflow.mjs';

// Assessment data only. No tool, phase change or source-write authority lives here.
export function nativeDiagnosisEvidence(context, caseId) {
  assert.ok(nativeWorkflowStep(context, caseId).expectedReply);
  const results = context.messages.filter((m) => m.role === 'toolResult');
  const read = JSON.parse(results[0].content[0].text);
  const check = JSON.parse(results[1].content[0].text);
  return {
    caseId,
    sourceSha256: read.sha256,
    receiptId: check.id,
    baselineRevision: check.candidate,
  };
}

export function validateNativeDiagnosis(text, evidence) {
  assert.equal(typeof text, 'string');
  assert.ok(Buffer.byteLength(text) <= 16384);
  const value = JSON.parse(text);
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(
    Object.keys(value).sort(),
    [
      'affectedPaths',
      'baselineRevision',
      'caseId',
      'diagnosis',
      'limitations',
      'proposal',
      'receiptId',
      'sourceSha256',
      'status',
      'validationPlan',
      'version',
    ].sort(),
  );
  assert.equal(value.version, 1);
  assert.equal(value.status, 'proposal-only');
  for (const key of ['caseId', 'sourceSha256', 'receiptId', 'baselineRevision'])
    assert.equal(value[key], evidence[key]);
  assert.deepEqual(value.affectedPaths, ['src/lib/errors.js']);
  const boundedText = (v, max) => {
    assert.equal(typeof v, 'string');
    assert.ok(v.trim().length > 0 && Buffer.byteLength(v) <= max);
    assert.ok(
      [...v].every((c) => {
        const n = c.codePointAt(0);
        return n === 9 || n === 10 || (n >= 32 && n !== 127);
      }),
    );
  };
  boundedText(value.diagnosis, 2000);
  boundedText(value.proposal, 3000);
  for (const key of ['validationPlan', 'limitations']) {
    assert.ok(Array.isArray(value[key]) && value[key].length >= 1 && value[key].length <= 6);
    for (const item of value[key]) boundedText(item, 512);
  }
  return value;
}

export function nativeDiagnosisInstruction(evidence) {
  return `Both source and baseline receipt are present. Return only one JSON object, no markdown or tools, with exactly these fields: version: 1, status: "proposal-only", ${Object.entries(
    evidence,
  )
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(
      ', ',
    )}, affectedPaths: ["src/lib/errors.js"], diagnosis: a nonempty string (at most 2000 UTF-8 bytes), proposal: a nonempty string (at most 3000 bytes), validationPlan: 1-6 nonempty strings (at most 512 bytes each), limitations: 1-6 nonempty strings (at most 512 bytes each). Diagnose the profile-name missing/blank input defect and propose the smallest shared-helper fix based on the source. Explain proposed regression and protected checks without claiming they ran on a fix. The baseline receipt proves reproduction, not a repaired candidate. Only this source was inspected; callers and coverage remain limitations. No changes have been made or authorized. No shell, patches, new paths, other scenarios, publication or phase advancement.`;
}
