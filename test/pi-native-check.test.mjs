import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdtemp, realpath, rm, mkdir, readdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  consumeNativeCheck,
  validateNativeCheckResult,
  prepareNativeCheck,
} from '../prototypes/pi-native-check.mjs';
import { streamNativeLiveProbe } from '../prototypes/pi-native-stream.mjs';
import { makeRequest } from '../prototypes/pi-stream-protocol.mjs';
import { context } from '../prototypes/pi-stream-fixtures.ts';
import { syntheticProfile } from './helpers/pi-profile.mjs';

function receipt() {
  return {
    id: randomUUID(),
    caseId: randomUUID(),
    actionId: randomUUID(),
    candidate: 'a'.repeat(40),
    configuration: 'b'.repeat(64),
    kind: 'baseline',
    passed: true,
    simulated: false,
    artifacts: [randomUUID()],
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
    controlVersion: 3,
  };
}

test('check acknowledgement accepts only a real reproduced baseline receipt', () => {
  const value = receipt();
  assert.equal(validateNativeCheckResult(JSON.stringify(value)), value.id);
  for (const changed of [
    { ...value, simulated: true },
    { ...value, passed: false },
    { ...value, kind: 'browser' },
    { ...value, candidate: '../auth.json' },
    { ...value, extra: 'private' },
    { ...value, artifacts: [] },
    { ...value, controlVersion: 0 },
    { ...value, id: 'not-an-id' },
    { ...value, provenance: { ...value.provenance, outcome: 'candidate-passed' } },
    { ...value, provenance: { ...value.provenance, finishedAt: 62000 } },
    { ...value, provenance: { ...value.provenance, private: 'hidden' } },
  ])
    assert.throws(() => validateNativeCheckResult(JSON.stringify(changed)));
  assert.throws(() => validateNativeCheckResult('x'.repeat(32769)));
});

for (const state of ['pass', 'cleanup', 'outcome', 'pending', 'aborted'])
  test(`fixed consumption ${state} uses existing acceptance and consumption without edits`, async () => {
    const calls = [];
    const abort = new AbortController();
    if (state === 'aborted') abort.abort();
    const request = { kind: 'baseline', signal: abort.signal };
    const source = {
      workerAcceptance: {
        accept: async () => {
          calls.push('accept');
        },
      },
      workerConsumption: {
        consume: async () => {
          calls.push('consume');
          return {
            run: {
              state: state === 'pending' ? 'pending' : 'settled',
              cleanup: {
                kind: state === 'cleanup' ? 'incomplete' : 'owned-removed',
                cache: 'retained',
              },
              outcome: { kind: state === 'outcome' ? 'infrastructure' : 'baseline-reproduced' },
            },
          };
        },
      },
      edit: () => assert.fail('No edits'),
    };
    if (state === 'pass') {
      assert.deepEqual(await consumeNativeCheck(request, source), { type: 'consumed-browser' });
    } else await assert.rejects(consumeNativeCheck(request, source));
    assert.deepEqual(calls, state === 'aborted' ? [] : ['accept', 'consume']);
  });

for (const boundary of ['accept', 'consume'])
  test(`cancellation after ${boundary} stops before receipt or further worker work`, async () => {
    const control = new AbortController();
    const calls = [];
    const source = {
      workerAcceptance: {
        accept: async () => {
          calls.push('accept');
          if (boundary === 'accept') control.abort();
        },
      },
      workerConsumption: {
        consume: async () => {
          calls.push('consume');
          control.abort();
          return {};
        },
      },
    };
    await assert.rejects(consumeNativeCheck({ kind: 'baseline', signal: control.signal }, source));
    assert.deepEqual(calls, boundary === 'accept' ? ['accept'] : ['accept', 'consume']);
  });

test('unconfigured, wrong-kind and cancelled checks do not reach worker acceptance', async () => {
  let calls = 0;
  const source = {
    workerAcceptance: {
      accept: async () => {
        calls++;
      },
    },
  };
  for (const kind of ['checkpoint', 'browser', 'unit', 'build'])
    await assert.rejects(
      consumeNativeCheck({ kind, signal: new AbortController().signal }, source),
    );
  await assert.rejects(
    consumeNativeCheck({ kind: 'baseline', signal: new AbortController().signal }),
  );
  assert.equal(calls, 0);
});

test('preparation rejects missing/unreviewed application inputs before opening journals or inference', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'eitri-native-check-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = join(root, 'store');
  const fixture = join(root, 'fixture');
  await mkdir(store);
  await mkdir(fixture);
  await assert.rejects(prepareNativeCheck(store, fixture));
  assert.deepEqual(await readdir(store), []);
});

for (const scenario of ['success', 'bad-tool', 'bad-arguments', 'wrong-check-kind', 'bad-result'])
  test(
    `live check helper ${scenario} restricts calls and acknowledges the receipt without source upload`,
    { timeout: 20000 },
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
      const helpers = [];
      const preload = new URL(
        `./fixtures/pi-tool-preload.mjs?native=1&scenario=${scenario}`,
        import.meta.url,
      );
      const opts = {
        profileHome: p.home,
        preload,
        fixture: 'check-fixture',
        onSpawn: (v) => helpers.push(v),
      };
      const input = structuredClone(context);
      input.messages[0].toolsAdded = [
        {
          name: 'run_check',
          description: 'Fixed baseline',
          parameters: {
            type: 'object',
            properties: { kind: { type: 'string' } },
            required: ['kind'],
          },
        },
      ];
      if (['bad-tool', 'bad-arguments', 'wrong-check-kind'].includes(scenario)) {
        await assert.rejects(streamNativeLiveProbe(makeRequest(0, input), opts));
      } else {
        const first = await streamNativeLiveProbe(makeRequest(0, input), opts);
        const call = first.content.find((b) => b.type === 'toolCall');
        assert.equal(call.name, 'run_check');
        assert.deepEqual(call.arguments, { kind: 'baseline' });
        const value = receipt();
        input.messages.push(first, {
          role: 'toolResult',
          toolCallId: call.id,
          toolName: call.name,
          content: [{ type: 'text', text: JSON.stringify(value) }],
          isError: false,
          timestamp: 1,
        });
        if (scenario === 'bad-result')
          await assert.rejects(streamNativeLiveProbe(makeRequest(1, input), opts));
        else {
          const second = await streamNativeLiveProbe(makeRequest(1, input), opts);
          assert.equal(
            second.content
              .filter((b) => b.type === 'text')
              .map((b) => b.text)
              .join(''),
            value.id,
          );
        }
      }
      for (const helper of helpers) {
        assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
        await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
      }
    },
  );

for (const scenario of ['launcher', 'launcher-private', 'launcher-diagnostic-success'])
  test(`native check launcher ${scenario} bounds output and strips ambient provider/Docker configuration`, () => {
    const preload = new URL(`./fixtures/pi-tool-preload.mjs?scenario=${scenario}`, import.meta.url);
    const result = spawnSync(
      process.execPath,
      ['--import', preload.href, 'scripts/test-pi-tool.mjs', '--native-check', '--run'],
      {
        encoding: 'utf8',
        timeout: 15000,
        stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH,
          OPENAI_API_KEY: 'private-ambient',
          DOCKER_HOST: 'private-remote',
          DOCKER_CONFIG: 'private-config',
        },
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, scenario === 'launcher' ? 0 : 1);
    assert.doesNotMatch(result.stdout + result.stderr, /private-|src\/lib|AssertionError/);
    const terminal = JSON.parse(result.stdout);
    assert.equal(terminal.scope, 'dedicated-pi-native-check');
    assert.equal(
      terminal.verdict,
      scenario === 'launcher' ? 'native-check-pass' : 'sign-in-required',
    );
  });

for (const args of [[], ['--help'], ['--run', '--extra']])
  test(`native check launcher ${JSON.stringify(args)} requires exact opt-in`, () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/test-pi-tool.mjs', '--native-check', ...args],
      { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 10000 },
    );
    assert.equal(result.status, args.length === 2 ? 1 : 0);
    assert.match(result.stdout + result.stderr, /Usage: npm run test:pi-native-check/);
    assert.doesNotMatch(result.stdout, /native-check-pass/);
  });
