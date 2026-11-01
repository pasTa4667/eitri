import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, rm, writeFile, readdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  nativeDiagnosisEvidence,
  validateNativeDiagnosis,
} from '../../prototypes/pi-native-diagnosis.mjs';
import {
  runNativeLiveCheckProbe,
  nativeLiveCheckResult,
  runNativeLiveWorkflowProbe,
  nativeLiveWorkflowResult,
  runNativeLiveDiagnosisProbe,
  nativeLiveDiagnosisResult,
} from '../../prototypes/pi-native-live.mjs';
import { streamNativeLiveProbe } from '../../prototypes/pi-native-stream.mjs';
import { captureFixtureApplicationInput } from '../../src/fixture-profile-name.ts';
import { syntheticProfile } from '../helpers/pi-profile.mjs';

if (process.env.EITRI_FROZEN_DOCKER_ACCEPTANCE !== '1')
  throw new Error('Requires explicit EITRI_FROZEN_DOCKER_ACCEPTANCE=1. No skips or substitutes.');

for (const mode of [
  'check',
  'workflow',
  'before-check-failure',
  'ack-failure',
  'diagnosis',
  'diagnosis-failure',
])
  test(
    `synthetic inference / real protected Docker recipe: ${mode}`,
    { timeout: 125000 },
    async (t) => {
      const workflow = mode !== 'check';
      const diagnosis = mode.startsWith('diagnosis');
      const failed = mode.endsWith('failure');
      const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-native-check-test-')));
      t.diagnostic(`Private test store: ${directory}`);
      const fixtureDirectory = fileURLToPath(
        new URL('../../../eitri-test-web-app', import.meta.url),
      );
      const before = await captureFixtureApplicationInput(fixtureDirectory);
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
      const requests = [],
        progress = [],
        helpers = [],
        diagnostics = [];
      const pending = (
        diagnosis
          ? runNativeLiveDiagnosisProbe
          : workflow
            ? runNativeLiveWorkflowProbe
            : runNativeLiveCheckProbe
      )({
        directory,
        fixtureDirectory,
        onProgress: (v) => progress.push(v),
        onSpawn: (v) => helpers.push(v),
        onDiagnostic: (v) => diagnostics.push(v),
        stream: (request, options) => {
          requests.push(request);
          return streamNativeLiveProbe(request, {
            ...options,
            profileHome: p.home,
            preload: new URL(
              `../fixtures/pi-tool-preload.mjs?native=1&scenario=${mode === 'before-check-failure' && requests.length === 2 ? 'bad-tool' : mode === 'diagnosis-failure' && requests.length === 3 ? 'diagnosis-stale' : mode === 'ack-failure' && requests.length === 3 ? 'bad-result' : 'success'}`,
              import.meta.url,
            ),
          });
        },
      });
      if (failed) {
        await assert.rejects(pending);
        assert.deepEqual(diagnostics, ['result-validation']);
        assert.ok((await readdir(directory)).includes('native'));
        assert.ok((await readdir(p.profile)).includes('eitri-use'));
      } else {
        assert.deepEqual(
          await pending,
          diagnosis
            ? nativeLiveDiagnosisResult
            : workflow
              ? nativeLiveWorkflowResult
              : nativeLiveCheckResult,
        );
        assert.deepEqual(diagnostics, []);
        assert.deepEqual(await readdir(directory), diagnosis ? ['native'] : []);
        assert.deepEqual(await readdir(p.profile), ['auth.json']);
      }
      assert.equal(helpers.length, requests.length);
      for (const helper of helpers) {
        assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
        await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
      }
      assert.deepEqual(
        progress,
        workflow && mode !== 'before-check-failure'
          ? ['model', 'tool', 'model', 'tool', 'model']
          : ['model', 'tool', 'model'],
      );
      assert.equal(requests.length, workflow && mode !== 'before-check-failure' ? 3 : 2);
      assert.equal(new Set(requests.map((r) => r.caseId)).size, 1);
      const tool = requests
        .at(-1)
        .context.messages.filter((m) => m.role === 'toolResult')
        .at(-1);
      if (mode === 'before-check-failure') assert.equal(tool.toolName, 'read_fixture');
      else {
        assert.equal(tool.toolName, 'run_check');
        assert.equal(JSON.parse(tool.content[0].text).provenance.outcome, 'baseline-reproduced');
      }
      if (diagnosis) {
        const id = requests[0].caseId;
        const db = new DatabaseSync(join(directory, 'native', 'cases', id, 'session.sqlite'), {
          readOnly: true,
        });
        let assistant;
        try {
          assistant = db
            .prepare('SELECT record FROM entries ORDER BY commit_seq, id')
            .all()
            .flatMap((row) => JSON.parse(row.record).model ?? [])
            .filter((m) => m.role === 'assistant' && m.stopReason === 'stop');
        } finally {
          db.close();
        }
        assert.equal(assistant.length, failed ? 0 : 1);
        if (!failed) {
          const text = assistant[0].content
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('');
          const value = validateNativeDiagnosis(
            text,
            nativeDiagnosisEvidence(requests[2].context, id),
          );
          assert.match(value.diagnosis, /missing profile Ω/);
          assert.ok((await lstat(join(directory, 'native'))).mode % 512 === 448);
        }
      }
      const source = before.files.find((f) => f.virtualPath === 'src/lib/errors.js');
      if (workflow) {
        const read = requests[1].context.messages.find((m) => m.role === 'toolResult');
        assert.equal(read.toolName, 'read_fixture');
        assert.equal(JSON.parse(read.content[0].text).content, source.bytes.toString('utf8'));
        assert.equal(JSON.parse(read.content[0].text).sha256, source.sha256);
        assert.ok(!JSON.stringify(requests[0]).includes(source.bytes.toString('utf8')));
      } else assert.ok(!JSON.stringify(requests).includes(source.bytes.toString('utf8')));
      assert.equal(
        (await captureFixtureApplicationInput(fixtureDirectory)).captureDigest,
        before.captureDigest,
      );
      await rm(directory, { recursive: true });
    },
  );
