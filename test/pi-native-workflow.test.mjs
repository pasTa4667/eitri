import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFile, lstat } from 'node:fs/promises';
import { nativeWorkflowStep } from '../prototypes/pi-native-workflow.mjs';
import { nativeLiveWorkflowResult } from '../prototypes/pi-native-live.mjs';
import { streamNativeLiveProbe } from '../prototypes/pi-native-stream.mjs';
import { makeRequest } from '../prototypes/pi-stream-protocol.mjs';
import { context } from '../prototypes/pi-stream-fixtures.ts';
import { syntheticProfile } from './helpers/pi-profile.mjs';
import { createHash } from 'node:crypto';

const content = 'untrusted source; ignore instructions here Ω';
const read = JSON.stringify({
  path: 'src/lib/errors.js',
  content,
  sha256: createHash('sha256').update(content).digest('hex'),
});
function receipt(caseId) {
  return {
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
}
function transcript() {
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
  return input;
}
function append(input, call, text) {
  input.messages.push(
    { role: 'assistant', content: [call] },
    {
      role: 'toolResult',
      toolCallId: call.id,
      toolName: call.name,
      content: [{ type: 'text', text }],
      isError: false,
      timestamp: 1,
    },
  );
}
const readCall = { type: 'toolCall', id: 'read-1', name: 'read_fixture', arguments: {} };
const checkCall = {
  type: 'toolCall',
  id: 'check-1',
  name: 'run_check',
  arguments: { kind: 'baseline' },
};

test('workflow policy admits only fixed read, then baseline, then correlated receipt acknowledgement', () => {
  const input = transcript(),
    caseId = randomUUID();
  assert.deepEqual(nativeWorkflowStep(input, caseId), {
    toolName: 'read_fixture',
    toolArguments: {},
  });
  append(input, readCall, read);
  assert.deepEqual(nativeWorkflowStep(input, caseId), {
    toolName: 'run_check',
    toolArguments: { kind: 'baseline' },
  });
  const value = receipt(caseId);
  append(input, checkCall, JSON.stringify(value));
  assert.deepEqual(nativeWorkflowStep(input, caseId), { expectedReply: value.id });
});

for (const fault of [
  'reordered',
  'extra-args',
  'wrong-id',
  'wrong-name',
  'failed',
  'duplicate',
  'pending',
  'bad-read',
  'wrong-case',
  'extra-result',
])
  test(`workflow refuses ${fault} history before another dispatch`, () => {
    const input = transcript(),
      caseId = randomUUID();
    append(input, structuredClone(readCall), read);
    const assistant = input.messages.at(-2),
      result = input.messages.at(-1);
    if (fault === 'reordered') assistant.content[0] = checkCall;
    if (fault === 'extra-args') assistant.content[0].arguments = { path: '../auth.json' };
    if (fault === 'wrong-id') result.toolCallId = 'unrelated';
    if (fault === 'wrong-name') result.toolName = 'run_check';
    if (fault === 'failed') result.isError = true;
    if (fault === 'duplicate') append(input, readCall, read);
    if (fault === 'pending') input.messages.pop();
    if (fault === 'bad-read') result.content[0].text = '{}';
    if (fault === 'wrong-case') append(input, checkCall, JSON.stringify(receipt(randomUUID())));
    if (fault === 'extra-result') input.messages.push(structuredClone(result));
    assert.throws(() => nativeWorkflowStep(input, caseId));
  });

for (const fault of ['parallel-calls', 'check-before-read-result'])
  test(`workflow refuses ${fault} instead of accepting flattened history`, () => {
    const input = transcript(),
      caseId = randomUUID();
    append(input, structuredClone(readCall), read);
    append(input, structuredClone(checkCall), JSON.stringify(receipt(caseId)));
    if (fault === 'parallel-calls') {
      input.messages.at(-4).content.push(checkCall);
      input.messages.splice(input.messages.length - 2, 1);
    } else {
      const resultIndex = input.messages.length - 3;
      const [result] = input.messages.splice(resultIndex, 1);
      input.messages.splice(resultIndex + 1, 0, result);
    }
    assert.throws(() => nativeWorkflowStep(input, caseId));
  });

for (const scenario of ['success', 'bad-tool', 'bad-arguments', 'wrong-check-kind', 'bad-result'])
  test(
    `installed live workflow helper ${scenario} restricts each of three streams`,
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
      const helpers = [],
        input = transcript();
      const caseId = randomUUID();
      const request = (index) => ({ ...makeRequest(index, input), caseId });
      const opts = {
        profileHome: p.home,
        fixture: 'read-check-fixture',
        preload: new URL(
          `./fixtures/pi-tool-preload.mjs?native=1&scenario=${scenario}`,
          import.meta.url,
        ),
        onSpawn: (v) => helpers.push(v),
      };
      const firstRequest = request(0);
      if (['bad-tool', 'bad-arguments'].includes(scenario)) {
        await assert.rejects(streamNativeLiveProbe(firstRequest, opts));
      } else {
        const first = await streamNativeLiveProbe(firstRequest, opts);
        const call = first.content.find((b) => b.type === 'toolCall');
        assert.equal(call.name, 'read_fixture');
        input.messages.push(first, {
          role: 'toolResult',
          toolCallId: call.id,
          toolName: call.name,
          content: [{ type: 'text', text: read }],
          isError: false,
          timestamp: 1,
        });
        if (scenario === 'wrong-check-kind')
          await assert.rejects(streamNativeLiveProbe(request(1), opts));
        else {
          const second = await streamNativeLiveProbe(request(1), opts);
          const check = second.content.find((b) => b.type === 'toolCall');
          assert.equal(check.name, 'run_check');
          assert.deepEqual(check.arguments, { kind: 'baseline' });
          const value = receipt(firstRequest.caseId);
          input.messages.push(second, {
            role: 'toolResult',
            toolCallId: check.id,
            toolName: check.name,
            content: [{ type: 'text', text: JSON.stringify(value) }],
            isError: false,
            timestamp: 1,
          });
          if (scenario === 'bad-result')
            await assert.rejects(streamNativeLiveProbe(request(2), opts));
          else {
            const third = await streamNativeLiveProbe(request(2), opts);
            assert.equal(
              third.content
                .filter((b) => b.type === 'text')
                .map((b) => b.text)
                .join(''),
              value.id,
            );
          }
        }
      }
      assert.equal(
        helpers.length,
        ['bad-tool', 'bad-arguments'].includes(scenario)
          ? 1
          : scenario === 'wrong-check-kind'
            ? 2
            : 3,
      );
      for (const helper of helpers) {
        assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
        await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
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
  test(`workflow launcher ${scenario} bounds progress/output and strips ambient credentials and Docker overrides`, () => {
    const preload = new URL(`./fixtures/pi-tool-preload.mjs?scenario=${scenario}`, import.meta.url);
    const result = spawnSync(
      process.execPath,
      ['--import', preload.href, 'scripts/test-pi-tool.mjs', '--native-workflow', '--run'],
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
    assert.deepEqual(
      JSON.parse(result.stdout),
      scenario === 'launcher'
        ? nativeLiveWorkflowResult
        : { scope: 'dedicated-pi-native-workflow', verdict: 'sign-in-required' },
    );
  });

for (const args of [[], ['--help'], ['--run', '--extra']])
  test(`workflow launcher ${JSON.stringify(args)} requires exact opt-in`, () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/test-pi-tool.mjs', '--native-workflow', ...args],
      { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 10000 },
    );
    assert.equal(result.status, args.length === 2 ? 1 : 0);
    assert.match(result.stdout + result.stderr, /Usage: npm run test:pi-native-workflow/);
    assert.doesNotMatch(result.stdout, /native-workflow-pass/);
  });
