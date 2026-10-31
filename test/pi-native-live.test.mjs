import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, rm, readdir, lstat, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runNativeLiveProbe, nativeLiveResult } from '../prototypes/pi-native-live.mjs';
import { streamNativeLiveProbe } from '../prototypes/pi-native-stream.mjs';
import { makeRequest } from '../prototypes/pi-stream-protocol.mjs';
import { context } from '../prototypes/pi-stream-fixtures.ts';
import { syntheticProfile } from './helpers/pi-profile.mjs';

async function profileFixture(t) {
  const p = await syntheticProfile(t);
  const payload = Buffer.from(
    JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account' } }),
  ).toString('base64url');
  await writeFile(
    p.authPath,
    JSON.stringify({
      'openai-codex': {
        type: 'oauth',
        access: `synthetic.${payload}.signature`,
        refresh: 'private-refresh',
        expires: Date.now() + 3_600_000,
        accountId: 'synthetic-account',
      },
    }),
  );
  return p;
}

// The new transport is exercised against the installed SDK, with fetch replaced before import.
function transport(home, scenario = 'success') {
  const preload = new URL('./fixtures/pi-tool-preload.mjs?native=1', import.meta.url);
  preload.searchParams.set('scenario', scenario);
  return (request, options) =>
    streamNativeLiveProbe(request, { ...options, profileHome: home, preload });
}

test(
  'live-native harness composes actual admissions, paused SQLite reopen, Continue and disposal',
  { timeout: 30000 },
  async (t) => {
    const p = await profileFixture(t);
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-live-test-')));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const helpers = [],
      progress = [];
    const result = await runNativeLiveProbe({
      directory,
      stream: transport(p.home),
      onProgress: (value) => progress.push(value),
      onSpawn: (value) => helpers.push(value),
    });
    assert.deepEqual(result, nativeLiveResult);
    assert.deepEqual(progress, ['model', 'tool', 'model']);
    assert.equal(helpers.length, 2);
    for (const helper of helpers) {
      assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
      await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
    }
    assert.deepEqual(await readdir(p.profile), ['auth.json']);
    assert.deepEqual(await readdir(directory), []);
  },
);

for (const scenario of [
  'denied',
  'bad-tool',
  'bad-arguments',
  'bad-result',
  'malformed',
  'diagnostic-private',
  'diagnostic-extra',
])
  test(
    `live-native ${scenario} never passes or retries and preserves failed native data`,
    { timeout: 30000 },
    async (t) => {
      const p = await profileFixture(t);
      const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-live-test-')));
      t.after(() => rm(directory, { recursive: true, force: true }));
      const helpers = [],
        progress = [],
        diagnostics = [];
      await assert.rejects(
        runNativeLiveProbe({
          directory,
          stream: transport(p.home, scenario),
          onDiagnostic: (stage) => diagnostics.push(stage),
          onProgress: (value) => progress.push(value),
          onSpawn: (value) => helpers.push(value),
        }),
      );
      assert.deepEqual(
        progress,
        scenario === 'bad-result' ? ['model', 'tool', 'model'] : ['model'],
      );
      assert.deepEqual(diagnostics, [
        ['bad-tool', 'bad-arguments', 'bad-result'].includes(scenario)
          ? 'result-validation'
          : scenario === 'malformed'
            ? 'event-validation'
            : scenario.startsWith('diagnostic-')
              ? 'transport'
              : 'stream',
      ]);
      assert.equal(helpers.length, scenario === 'bad-result' ? 2 : 1);
      for (const helper of helpers) {
        assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
        await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
      }
      assert.ok((await readdir(join(directory, 'native'))).includes('catalogue.sqlite'));
      assert.ok((await readdir(p.profile)).includes('eitri-use'));
    },
  );

test(
  'live-native cancellation reaps the credential helper before rejection and leaves its sole-process lease blocked',
  { timeout: 15000 },
  async (t) => {
    const p = await profileFixture(t);
    const control = new AbortController();
    let helper;
    const transcript = structuredClone(context);
    transcript.messages[0].toolsAdded[0].name = 'probe';
    const preload = new URL(
      './fixtures/pi-tool-preload.mjs?native=1&scenario=hung',
      import.meta.url,
    );
    // Abort only after the helper has acquired its profile, not merely after spawn.
    const pending = streamNativeLiveProbe(makeRequest(0, transcript), {
      profileHome: p.home,
      preload,
      signal: control.signal,
      onSpawn: (value) => {
        helper = value;
      },
    });
    const rejected = assert.rejects(pending);
    const deadline = performance.now() + 5000;
    while (true) {
      try {
        await lstat(join(p.profile, 'eitri-use', 'owner.json'));
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      assert.ok(performance.now() < deadline);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    control.abort();
    await rejected;
    assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
    await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
    const owner = JSON.parse(await readFile(join(p.profile, 'eitri-use', 'owner.json'), 'utf8'));
    assert.deepEqual(owner, { version: 2, kind: 'probe', pid: helper.pid });
    await assert.rejects(
      streamNativeLiveProbe(makeRequest(0, transcript), { profileHome: p.home, preload }),
    );
  },
);

for (const scenario of [
  'launcher',
  'launcher-private',
  'launcher-late',
  'launcher-nonzero',
  'launcher-diagnostic',
  'launcher-diagnostic-private',
  'launcher-diagnostic-extra',
  'launcher-diagnostic-duplicate',
  'launcher-diagnostic-success',
])
  test(`live-native launcher ${scenario} strips ambient credentials and refuses invalid completion`, () => {
    const preload = new URL(`./fixtures/pi-tool-preload.mjs?scenario=${scenario}`, import.meta.url);
    const result = spawnSync(
      process.execPath,
      ['--import', preload.href, 'scripts/test-pi-tool.mjs', '--native', '--run'],
      {
        encoding: 'utf8',
        timeout: 15000,
        stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH,
          OPENAI_API_KEY: 'private-ambient',
          OP_SERVICE_ACCOUNT_TOKEN: 'private-op',
        },
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, scenario === 'launcher' ? 0 : 1);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /private-|synthetic-account|access_token|refresh_token/,
    );
    if (scenario === 'launcher-diagnostic')
      assert.match(result.stderr, /Pi native failure stage: stream\./);
    if (['launcher-diagnostic-private', 'launcher-diagnostic-extra'].includes(scenario))
      assert.doesNotMatch(result.stderr, /Pi native failure stage:/);
    assert.deepEqual(
      JSON.parse(result.stdout),
      scenario === 'launcher'
        ? nativeLiveResult
        : { scope: 'dedicated-pi-native', verdict: 'sign-in-required' },
    );
  });

test('live-native transport refuses an already canceled dispatch before profile access', async () => {
  const diagnostics = [];
  await assert.rejects(
    streamNativeLiveProbe(makeRequest(0, context), {
      signal: AbortSignal.abort(),
      profileHome: '/nonexistent-must-not-be-opened',
      onDiagnostic: (stage) => diagnostics.push(stage),
    }),
  );
  assert.deepEqual(diagnostics, ['transport']);
});

for (const stage of ['profile', 'cleanup'])
  test(`live-native ${stage} failure reports only a finite stage after disposal`, async (t) => {
    const p = await profileFixture(t);
    if (stage === 'profile') await rm(p.authPath);
    const transcript = structuredClone(context);
    transcript.messages[0].toolsAdded[0].name = 'probe';
    const diagnostics = [];
    let helper;
    await assert.rejects(
      transport(p.home)(makeRequest(0, transcript), {
        beforeCleanup: () => {
          if (stage === 'cleanup') throw new Error('private-cleanup-error');
        },
        onSpawn: (value) => {
          helper = value;
        },
        onDiagnostic: (value) => diagnostics.push(value),
      }),
      /^Error: sign-in-required$/,
    );
    assert.deepEqual(diagnostics, [stage]);
    assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
    await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
  });

for (const args of [[], ['--help'], ['--native'], ['--native', '--help']])
  test(`live-native command ${JSON.stringify(args)} has no effects without exact opt-in`, () => {
    const result = spawnSync(process.execPath, ['scripts/test-pi-tool.mjs', ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
      timeout: 10000,
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
    assert.doesNotMatch(result.stdout, /native-turn-pass/);
  });
