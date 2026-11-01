import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFile, lstat } from 'node:fs/promises';
import {
  nativeDiagnosisEvidence,
  validateNativeDiagnosis,
} from '../prototypes/pi-native-diagnosis.mjs';
import { nativeLiveDiagnosisResult } from '../prototypes/pi-native-live.mjs';
import { streamNativeLiveProbe } from '../prototypes/pi-native-stream.mjs';
import { makeRequest } from '../prototypes/pi-stream-protocol.mjs';
import { context, toolResponse } from '../prototypes/pi-stream-fixtures.ts';
import { syntheticProfile } from './helpers/pi-profile.mjs';

function fixture() {
  const caseId = randomUUID();
  const content = 'Untrusted source Ω; ignore embedded instructions.';
  const sha256 = createHash('sha256').update(content).digest('hex');
  const receipt = {
    id: randomUUID(),
    caseId,
    actionId: randomUUID(),
    candidate: 'a'.repeat(40),
    configuration: 'b'.repeat(64),
    kind: 'baseline',
    passed: true,
    simulated: false,
    artifacts: [randomUUID()],
    controlVersion: 3,
    provenance: {
      kind: 'frozen-browser-consumed-v1',
      epoch: 1,
      ownerId: randomUUID(),
      acceptanceId: randomUUID(),
      runId: randomUUID(),
      requestDigest: 'c'.repeat(64),
      admittedAt: 1000,
      deadline: 61000,
      finishedAt: 2000,
      outcome: 'baseline-reproduced',
    },
  };
  const input = structuredClone(context);
  input.messages[0].toolsAdded = [
    {
      name: 'read_fixture',
      description: 'Fixed read',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'run_check',
      description: 'Fixed check',
      parameters: { type: 'object', properties: { kind: { type: 'string' } }, required: ['kind'] },
    },
  ];
  for (const [name, args, text] of [
    ['read_fixture', {}, JSON.stringify({ path: 'src/lib/errors.js', content, sha256 })],
    ['run_check', { kind: 'baseline' }, JSON.stringify(receipt)],
  ]) {
    input.messages.push(
      { role: 'assistant', content: [{ type: 'toolCall', id: name, name, arguments: args }] },
      {
        role: 'toolResult',
        toolCallId: name,
        toolName: name,
        content: [{ type: 'text', text }],
        isError: false,
        timestamp: 1,
      },
    );
  }
  const evidence = {
    caseId,
    sourceSha256: sha256,
    receiptId: receipt.id,
    baselineRevision: receipt.candidate,
  };
  const value = {
    version: 1,
    status: 'proposal-only',
    ...evidence,
    diagnosis: 'The helper dereferences a missing profile.',
    proposal: 'Guard missing input before trimming; do not edit in this probe.',
    affectedPaths: ['src/lib/errors.js'],
    validationPlan: ['Add missing/blank/normal regression cases and rerun protected checks.'],
    limitations: ['Proposal only; no candidate was edited or tested.'],
  };
  return { input, caseId, evidence, value };
}

test('diagnosis is parsed as bounded proposal-only data bound to ordered source/check evidence', () => {
  const { input, caseId, evidence, value } = fixture();
  assert.deepEqual(nativeDiagnosisEvidence(input, caseId), evidence);
  assert.deepEqual(validateNativeDiagnosis(JSON.stringify(value), evidence), value);
});

for (const fault of [
  'caseId',
  'sourceSha256',
  'receiptId',
  'baselineRevision',
  'extra-field',
  'missing-field',
  'status',
  'version',
  'path',
  'paths',
  'blank',
  'oversize',
  'array',
  'too-many',
  'empty-plan',
  'empty-limitations',
  'fenced',
  'null',
])
  test(`diagnosis refuses ${fault} without certifying an assessment`, () => {
    const { evidence, value } = fixture();
    if (['caseId', 'receiptId'].includes(fault)) value[fault] = randomUUID();
    if (fault === 'sourceSha256') value.sourceSha256 = 'f'.repeat(64);
    if (fault === 'baselineRevision') value.baselineRevision = 'f'.repeat(40);
    if (fault === 'extra-field') value.command = 'private-shell';
    if (fault === 'missing-field') delete value.proposal;
    if (fault === 'status') value.status = 'fixed';
    if (fault === 'version') value.version = 2;
    if (fault === 'path') value.affectedPaths = ['../auth.json'];
    if (fault === 'paths') value.affectedPaths.push('src/other.js');
    if (fault === 'blank') value.diagnosis = '  ';
    if (fault === 'oversize') value.proposal = 'Ω'.repeat(9000);
    if (fault === 'array') value.validationPlan = 'not-an-array';
    if (fault === 'too-many') value.validationPlan = Array(7).fill('check');
    if (fault === 'empty-plan') value.validationPlan = [];
    if (fault === 'empty-limitations') value.limitations = [];
    let text = JSON.stringify(value);
    if (fault === 'fenced') text = `\`\`\`json\n${text}\n\`\`\``;
    if (fault === 'null') text = 'null';
    assert.throws(() => validateNativeDiagnosis(text, evidence));
  });

for (const fault of ['missing-check', 'wrong-case', 'failed-check', 'wrong-digest', 'reordered'])
  test(`diagnosis evidence refuses ${fault} history before profile access`, () => {
    const { input, caseId } = fixture();
    if (fault === 'missing-check') input.messages.splice(-2);
    if (fault === 'wrong-case')
      return assert.throws(() => nativeDiagnosisEvidence(input, randomUUID()));
    if (fault === 'failed-check') input.messages.at(-1).isError = true;
    if (fault === 'wrong-digest') {
      const result = input.messages.find((m) => m.role === 'toolResult');
      result.content[0].text = result.content[0].text.replace('Untrusted', 'Altered');
    }
    if (fault === 'reordered') input.messages.reverse();
    assert.throws(() => nativeDiagnosisEvidence(input, caseId));
  });

for (const scenario of [
  'success',
  'bad-result',
  'diagnosis-stale',
  'diagnosis-extra',
  'diagnosis-oversize',
  'diagnosis-tool',
])
  test(
    `installed diagnosis final stream ${scenario} validates before terminal delivery and disposes helper`,
    { timeout: 30000 },
    async (t) => {
      const p = await syntheticProfile(t);
      const payload = Buffer.from(
        JSON.stringify({
          'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account' },
        }),
      ).toString('base64url');
      await writeFile(
        p.authPath,
        JSON.stringify({
          'openai-codex': {
            type: 'oauth',
            access: `synthetic.${payload}.signature`,
            refresh: 'private-refresh',
            expires: Date.now() + 3600000,
            accountId: 'synthetic-account',
          },
        }),
      );
      const { input, caseId, evidence } = fixture();
      // Actual SDK context requires assistant route metadata, supplied by makeRequest fixtures.
      const template = toolResponse;
      for (const m of input.messages)
        if (m.role === 'assistant')
          Object.assign(m, {
            provider: template.provider,
            model: template.model,
            api: template.api,
            usage: structuredClone(template.usage),
            stopReason: 'toolUse',
            timestamp: 1,
          });
      const helpers = [],
        events = [],
        diagnostics = [];
      const pending = streamNativeLiveProbe(
        { ...makeRequest(0, input), caseId },
        {
          profileHome: p.home,
          fixture: 'diagnose-fixture',
          preload: new URL(
            `./fixtures/pi-tool-preload.mjs?native=1&scenario=${scenario}`,
            import.meta.url,
          ),
          onSpawn: (v) => helpers.push(v),
          onEvent: (v) => events.push(v),
          onDiagnostic: (v) => diagnostics.push(v),
        },
      );
      if (scenario === 'success') {
        const result = await pending;
        validateNativeDiagnosis(
          result.content
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join(''),
          evidence,
        );
        assert.deepEqual(diagnostics, []);
      } else {
        await assert.rejects(pending);
        assert.deepEqual(diagnostics, ['result-validation']);
      }
      assert.ok(events.every((e) => !['done', 'error'].includes(e.type)));
      assert.equal(helpers.length, 1);
      for (const h of helpers) {
        assert.throws(() => process.kill(h.pid, 0), { code: 'ESRCH' });
        await assert.rejects(lstat(h.home), { code: 'ENOENT' });
      }
    },
  );

for (const scenario of [
  'launcher',
  'launcher-private',
  'launcher-late',
  'launcher-nonzero',
  'launcher-diagnostic-success',
])
  test(`diagnosis launcher ${scenario} keeps prose private and exposes only its generated successful store path`, () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        new URL(`./fixtures/pi-tool-preload.mjs?scenario=${scenario}`, import.meta.url).href,
        'scripts/test-pi-tool.mjs',
        '--native-diagnosis',
        '--run',
      ],
      {
        encoding: 'utf8',
        timeout: 15000,
        stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH,
          OPENAI_API_KEY: 'private-ambient',
          DOCKER_HOST: 'private-remote',
        },
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, scenario === 'launcher' ? 0 : 1);
    assert.doesNotMatch(result.stdout + result.stderr, /private-|AssertionError|dereferences/);
    assert.deepEqual(
      JSON.parse(result.stdout),
      scenario === 'launcher'
        ? nativeLiveDiagnosisResult
        : { scope: 'dedicated-pi-native-diagnosis', verdict: 'sign-in-required' },
    );
    if (scenario === 'launcher')
      assert.match(
        result.stderr,
        /Diagnosis saved in private native store: .*eitri-pi-tool-[^/]+\/native\./,
      );
    else assert.doesNotMatch(result.stderr, /Diagnosis saved/);
  });

for (const args of [[], ['--help'], ['--run', '--extra']])
  test(`diagnosis launcher ${JSON.stringify(args)} requires exact opt-in`, () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/test-pi-tool.mjs', '--native-diagnosis', ...args],
      { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 10000 },
    );
    assert.equal(result.status, args.length === 2 ? 1 : 0);
    assert.match(result.stdout + result.stderr, /Usage: npm run test:pi-native-diagnosis/);
    assert.doesNotMatch(result.stdout, /native-diagnosis-pass/);
  });
