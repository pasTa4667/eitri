import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runNativeLiveCheckProbe,
  nativeLiveCheckResult,
} from '../../prototypes/pi-native-live.mjs';
import { streamNativeLiveProbe } from '../../prototypes/pi-native-stream.mjs';
import { captureFixtureApplicationInput } from '../../src/fixture-profile-name.ts';
import { syntheticProfile } from '../helpers/pi-profile.mjs';

if (process.env.EITRI_FROZEN_DOCKER_ACCEPTANCE !== '1')
  throw new Error('Requires explicit EITRI_FROZEN_DOCKER_ACCEPTANCE=1. No skips or substitutes.');

test(
  'synthetic inference joins one actual protected Docker baseline to native Pause/reopen/Continue',
  { timeout: 125000 },
  async (t) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-native-check-test-')));
    t.diagnostic(`Private test store: ${directory}`);
    const fixtureDirectory = fileURLToPath(new URL('../../../eitri-test-web-app', import.meta.url));
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
      progress = [];
    const result = await runNativeLiveCheckProbe({
      directory,
      fixtureDirectory,
      onProgress: (v) => progress.push(v),
      stream: (request, options) => {
        requests.push(request);
        return streamNativeLiveProbe(request, {
          ...options,
          profileHome: p.home,
          preload: new URL(
            '../fixtures/pi-tool-preload.mjs?native=1&scenario=success',
            import.meta.url,
          ),
        });
      },
    });
    assert.deepEqual(result, nativeLiveCheckResult);
    assert.deepEqual(progress, ['model', 'tool', 'model']);
    assert.equal(requests.length, 2);
    const tool = requests[1].context.messages.find((m) => m.role === 'toolResult');
    assert.equal(tool.toolName, 'run_check');
    assert.equal(JSON.parse(tool.content[0].text).provenance.outcome, 'baseline-reproduced');
    assert.ok(
      !JSON.stringify(requests).includes(
        before.files.find((f) => f.virtualPath === 'src/lib/errors.js').bytes.toString('utf8'),
      ),
    );
    assert.equal(
      (await captureFixtureApplicationInput(fixtureDirectory)).captureDigest,
      before.captureDigest,
    );
    await rm(directory, { recursive: true });
  },
);
