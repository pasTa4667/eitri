import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, rm, readdir, lstat, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runNativeLiveProbe, nativeLiveResult } from '../prototypes/pi-native-live.mjs';
import { streamNativeLiveProbe } from '../prototypes/pi-native-stream.mjs';
import { withProfileProbe } from '../prototypes/pi-profile-login.mjs';
import { makeRequest, StreamReceiver } from '../prototypes/pi-stream-protocol.mjs';
import {
  nativeEventFailureStage,
  nativeStreamFailureStage,
  validateNativeDiagnostic,
} from '../prototypes/pi-native-diagnostics.mjs';
import { context } from '../prototypes/pi-stream-fixtures.ts';
import { syntheticProfile } from './helpers/pi-profile.mjs';

async function profileFixture(t, expires = Date.now() + 3_600_000) {
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
        expires,
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

// Finite stage per failure; the stream sub-stages distinguish a failed automatic
// OAuth refresh (sign in again) from a rejected request or a missing response.
const failureStages = {
  denied: 'stream-http-403',
  unauthorized: 'stream-http-401',
  'rate-limited': 'stream-http-429',
  network: 'stream-no-response',
  'refresh-denied': 'stream-refresh',
  'bad-tool': 'result-validation',
  'bad-arguments': 'result-validation',
  'bad-result': 'result-validation',
  malformed: 'event-validation-toolcall_start',
  'diagnostic-private': 'transport',
  'diagnostic-extra': 'transport',
};
for (const [scenario, failureStage] of Object.entries(failureStages))
  test(
    `live-native ${scenario} never passes or retries and preserves failed native data`,
    { timeout: 30000 },
    async (t) => {
      // Only the refresh scenario holds a token inside the SDK's five-minute refresh window.
      const p = await profileFixture(t, scenario === 'refresh-denied' ? Date.now() : undefined);
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
      assert.deepEqual(diagnostics, [failureStage]);
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
  'live-native accepts paced SDK toolcall start/delta snapshots through native Pause/reopen',
  { timeout: 30000 },
  async (t) => {
    const p = await profileFixture(t);
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-live-test-')));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const progress = [],
      diagnostics = [],
      helpers = [],
      events = [];
    const stream = transport(p.home, 'paced-toolcall');
    const result = await runNativeLiveProbe({
      directory,
      stream: (request, options) =>
        stream(request, {
          ...options,
          onEvent: (event) => {
            events.push(event);
            options.onEvent?.(event);
          },
        }),
      onProgress: (value) => progress.push(value),
      onDiagnostic: (stage) => diagnostics.push(stage),
      onSpawn: (value) => helpers.push(value),
    });
    assert.deepEqual(result, nativeLiveResult);
    assert.deepEqual(progress, ['model', 'tool', 'model']);
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(
      events.filter((e) => e.type.startsWith('toolcall')).map((e) => e.type),
      ['toolcall_start', 'toolcall_delta', 'toolcall_end'],
    );
    assert.doesNotMatch(JSON.stringify(events), /partialJson/);
    assert.equal(helpers.length, 2);
    for (const helper of helpers) {
      assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
      await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
    }
    assert.deepEqual(await readdir(p.profile), ['auth.json']);
    assert.deepEqual(await readdir(directory), []);
  },
);

test(
  'live-native cancellation after a normalized open SDK toolcall never delivers a terminal',
  { timeout: 15000 },
  async (t) => {
    const p = await profileFixture(t);
    const helpers = [],
      events = [],
      diagnostics = [];
    const control = new AbortController();
    const transcript = structuredClone(context);
    transcript.messages[0].toolsAdded[0].name = 'probe';
    const preload = new URL(
      './fixtures/pi-tool-preload.mjs?native=1&scenario=open-toolcall',
      import.meta.url,
    );
    await assert.rejects(
      streamNativeLiveProbe(makeRequest(0, transcript), {
        profileHome: p.home,
        preload,
        signal: control.signal,
        onDiagnostic: (stage) => diagnostics.push(stage),
        onSpawn: (value) => helpers.push(value),
        onEvent: (event) => {
          events.push(event);
          if (event.type === 'toolcall_start') control.abort();
        },
      }),
    );
    assert.deepEqual(
      events.map((e) => e.type),
      ['start', 'toolcall_start'],
    );
    assert.doesNotMatch(JSON.stringify(events), /partialJson/);
    assert.deepEqual(diagnostics, ['transport']);
    assert.equal(helpers.length, 1);
    assert.throws(() => process.kill(helpers[0].pid, 0), { code: 'ESRCH' });
    await assert.rejects(lstat(helpers[0].home), { code: 'ENOENT' });
    assert.ok((await readdir(p.profile)).includes('eitri-use'));
  },
);

test('live-native event diagnostics are finite and never accept provider text as a stage', () => {
  for (const type of [
    'start',
    'text_start',
    'text_delta',
    'text_end',
    'thinking_start',
    'thinking_delta',
    'thinking_end',
    'toolcall_start',
    'toolcall_delta',
    'toolcall_end',
    'done',
  ]) {
    const failureStage = `event-validation-${type}`;
    assert.equal(nativeEventFailureStage(type), failureStage);
    assert.equal(validateNativeDiagnostic({ failureStage }), failureStage);
  }
  for (const type of ['private-provider-text', 'error', null, {}, ['toolcall_start']])
    assert.equal(nativeEventFailureStage(type), 'event-validation');
  assert.equal(validateNativeDiagnostic({ failureStage: 'event-alias' }), 'event-alias');
  for (const failureStage of [
    'event-validation-private-provider-text',
    'event-validation-error',
    'event-validation-toolcall_start\nprivate',
  ])
    assert.throws(() => validateNativeDiagnostic({ failureStage }));
  assert.throws(() =>
    validateNativeDiagnostic({
      failureStage: 'event-validation-toolcall_start',
      detail: 'private-provider-text',
    }),
  );
});

test('live-native stream diagnostics classify only the pinned refresh literal or a status', () => {
  const refresh = 'OAuth refresh failed for openai-codex: private-provider-text (401)';
  const cases = [
    [[refresh, undefined], 'stream-refresh'],
    [[refresh, 401], 'stream-refresh'],
    [['private-provider-text', undefined], 'stream-no-response'],
    [[undefined, undefined], 'stream-no-response'],
    [['private-provider-text', 200], 'stream-response-ok'],
    [['private-provider-text', 400], 'stream-http-400'],
    [['private-provider-text', 401], 'stream-http-401'],
    [['private-provider-text', 403], 'stream-http-403'],
    [['private-provider-text', 404], 'stream-http-404'],
    [['private-provider-text', 429], 'stream-http-429'],
    [['private-provider-text', 418], 'stream-http-4xx'],
    [['private-provider-text', 503], 'stream-http-5xx'],
    [['private-provider-text', 302], 'stream-http-other'],
    [['private-provider-text', '401'], 'stream'],
    [['private-provider-text', 401.5], 'stream'],
  ];
  for (const [[message, status], failureStage] of cases) {
    assert.equal(nativeStreamFailureStage(message, status), failureStage);
    assert.equal(validateNativeDiagnostic({ failureStage }), failureStage);
  }
  // The provider-controlled message never becomes a stage, even when it mimics the literal.
  assert.equal(
    nativeStreamFailureStage(' OAuth refresh failed for openai-codex', undefined),
    'stream-no-response',
  );
  assert.equal(
    nativeStreamFailureStage('OAuth refresh failed for other', undefined),
    'stream-no-response',
  );
  for (const failureStage of [
    'stream-http-401\nprivate',
    'stream-http-418',
    'stream-refresh-private',
  ])
    assert.throws(() => validateNativeDiagnostic({ failureStage }));
});

test('strict receiver rejects the SDK scratch field, not the otherwise valid toolcall start', () => {
  const transcript = structuredClone(context);
  transcript.messages[0].toolsAdded[0].name = 'probe';
  const request = makeRequest(0, transcript);
  const { context: _context, options: _options, ...identity } = request;
  const partial = {
    role: 'assistant',
    provider: request.route.provider,
    model: request.route.model,
    api: request.route.api,
    content: [],
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'pending',
    timestamp: 1,
  };
  for (const scratch of [false, true]) {
    const receiver = new StreamReceiver(request);
    receiver.accept({ ...identity, seq: 0, event: { type: 'start', partial } });
    const frame = {
      ...identity,
      seq: 1,
      event: {
        type: 'toolcall_start',
        contentIndex: 0,
        partial: {
          ...partial,
          content: [
            {
              type: 'toolCall',
              id: 'call_probe|fc_probe',
              name: 'probe',
              arguments: {},
              ...(scratch ? { partialJson: '' } : {}),
            },
          ],
        },
      },
    };
    if (scratch) {
      assert.throws(() => receiver.accept(frame), /^Error: pi-stream-protocol-invalid$/);
      assert.throws(() => receiver.finish(), /^Error: pi-stream-protocol-invalid$/);
    } else assert.deepEqual(receiver.accept(frame), frame.event);
  }
});

test(
  'live-native cancellation reaps the credential helper before rejection; only then can a later probe reclaim its lease',
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
    // Only the reaped helper's exit makes the owner reclaimable by a later, separate probe.
    assert.equal(await withProfileProbe(p.home, async () => 'reclaimed'), 'reclaimed');
    assert.deepEqual(await readdir(p.profile), ['auth.json']);
  },
);

for (const scenario of [
  'launcher',
  'launcher-private',
  'launcher-late',
  'launcher-nonzero',
  'launcher-diagnostic',
  'launcher-diagnostic-event',
  'launcher-diagnostic-refresh',
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
    if (scenario === 'launcher-diagnostic-event')
      assert.match(result.stderr, /Pi native failure stage: event-validation-toolcall_start\./);
    if (scenario === 'launcher-diagnostic-refresh')
      assert.match(result.stderr, /Pi native failure stage: stream-refresh\./);
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
