import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runControlledTurn } from '../prototypes/pi-controlled-turn.mjs';
import { withProfileProbe, withProfileLogin } from '../prototypes/pi-profile-login.mjs';

function runtime(scenario = 'success', controller = new AbortController()) {
  let requests = 0;
  const model = {
    provider: 'openai-codex',
    id: 'gpt-6.1-sol',
    api: 'openai-codex-responses',
    baseUrl: 'https://chatgpt.com/backend-api',
  };
  return {
    get requests() {
      return requests;
    },
    listCredentials: async () =>
      scenario === 'api-key'
        ? [{ providerId: 'openai-codex', type: 'api_key' }]
        : [{ providerId: 'openai-codex', type: 'oauth' }],
    getPhysicalModel: () => (scenario === 'missing-model' ? undefined : model),
    streamSimple(selected, context, options) {
      assert.equal(selected, model);
      assert.equal(options.maxRetries, 0);
      assert.equal(options.transport, 'sse');
      assert.equal(options.signal, controller.signal);
      assert.ok(options.maxTokens <= 256);
      requests++;
      const call = { type: 'toolCall', id: 'probe-call', name: 'eitri_probe', arguments: {} };
      if (scenario === 'unknown-tool') call.name = 'bash';
      if (scenario === 'extra-argument') call.arguments = { command: 'private-command' };
      if (scenario === 'abort-before-tool') controller.abort();
      const content =
        requests === 1 ? [call] : [{ type: 'text', text: context.messages.at(-1).content[0].text }];
      if (scenario === 'duplicate-tool' && requests === 1) content.push({ ...call, id: 'second' });
      if (scenario === 'wrong-ack' && requests === 2) content[0].text = 'wrong';
      const message = {
        role: 'assistant',
        provider: model.provider,
        model: model.id,
        api: model.api,
        content,
        stopReason: requests === 1 ? 'toolUse' : 'stop',
        timestamp: Date.now(),
      };
      if (scenario === 'provider-error') message.stopReason = 'error';
      const events = [
        { type: 'start', partial: message },
        ...(requests === 2
          ? [{ type: 'text_delta', delta: content[0].text, partial: message }]
          : [{ type: 'toolcall_delta', delta: '{}', partial: message }]),
        { type: 'done', reason: message.stopReason, message },
      ];
      if (scenario === 'late-event') events.push({ type: 'text_delta', delta: 'late' });
      if (scenario === 'no-stream') events.splice(1, 1);
      if (scenario === 'oversized-event')
        events.unshift({ type: 'text_delta', delta: 'a'.repeat(1_048_577) });
      if (scenario === 'missing-terminal') events.pop();
      return {
        async *[Symbol.asyncIterator]() {
          yield* events;
        },
        result: async () => message,
      };
    },
  };
}

test('two explicit streams execute only one fixed tool and verify its unpredictable result', async () => {
  const controller = new AbortController();
  const sdk = runtime('success', controller);
  const progress = [];
  assert.deepEqual(
    await runControlledTurn(sdk, {
      signal: controller.signal,
      onProgress: (kind) => progress.push(kind),
    }),
    {
      scope: 'dedicated-pi-tool',
      verdict: 'tool-turn-pass',
      provider: 'openai-codex',
      model: 'gpt-6.1-sol',
      requests: 2,
      toolExecutions: 1,
      streamed: true,
      resultVerified: true,
    },
  );
  assert.deepEqual(progress, ['model', 'tool', 'model']);
  assert.equal(sdk.requests, 2);
});

for (const scenario of [
  'api-key',
  'missing-model',
  'unknown-tool',
  'extra-argument',
  'duplicate-tool',
  'abort-before-tool',
  'wrong-ack',
  'provider-error',
  'late-event',
  'no-stream',
  'oversized-event',
  'missing-terminal',
]) {
  test(`controlled turn refuses ${scenario} without retries or additional tool execution`, async () => {
    const controller = new AbortController();
    const sdk = runtime(scenario, controller);
    const progress = [];
    await assert.rejects(
      runControlledTurn(sdk, {
        signal: controller.signal,
        onProgress: (kind) => progress.push(kind),
      }),
    );
    const afterTool = ['wrong-ack', 'no-stream'].includes(scenario);
    assert.ok(sdk.requests <= (afterTool ? 2 : 1));
    if (!afterTool) assert.ok(!progress.includes('tool'));
  });
}

test('cancellation at either explicit model admission prevents that request', async () => {
  for (const stopAt of [1, 2]) {
    const controller = new AbortController();
    const sdk = runtime('success', controller);
    let models = 0;
    await assert.rejects(
      runControlledTurn(sdk, {
        signal: controller.signal,
        onProgress(kind) {
          if (kind === 'model' && ++models === stopAt) controller.abort();
        },
      }),
    );
    assert.equal(sdk.requests, stopAt - 1);
  }
});

async function profile(t) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'eitri-tool-test-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const directory = join(home, 'Library', 'Application Support', 'eitri', 'pi');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const authPath = join(directory, 'auth.json');
  await writeFile(authPath, '{}', { mode: 0o600 });
  return { home, directory, authPath };
}

test('probe uses the existing private profile and excludes login without initializing missing credentials', async (t) => {
  const p = await profile(t);
  await withProfileProbe(p.home, async (paths) => {
    assert.equal(paths.authPath, p.authPath);
    const owner = JSON.parse(await readFile(join(p.directory, 'eitri-use', 'owner.json'), 'utf8'));
    assert.deepEqual(owner, { version: 2, kind: 'probe', pid: process.pid });
    await assert.rejects(withProfileLogin(p.home, true, () => assert.fail()));
    await assert.rejects(withProfileProbe(p.home, () => assert.fail()));
  });
  assert.deepEqual(await readdir(p.directory), ['auth.json']);
  await rm(p.authPath);
  await assert.rejects(withProfileProbe(p.home, () => assert.fail()));
  assert.deepEqual(await readdir(p.directory), []);
});

test('failed probe retains its lease and never retries or leaks its cause', async (t) => {
  const p = await profile(t);
  await assert.rejects(
    withProfileProbe(p.home, () => {
      throw new Error('private-provider-error');
    }),
    /^Error: sign-in-required$/,
  );
  await assert.rejects(withProfileProbe(p.home, () => assert.fail()));
  assert.equal(await readFile(p.authPath, 'utf8'), '{}');
  assert.ok((await readdir(p.directory)).includes('eitri-use'));
});

test('default and invalid tool CLI arguments have no credential or inference effects', () => {
  for (const args of [[], ['--help'], ['--run', '--unknown'], ['--run', '--run']]) {
    const result = spawnSync(process.execPath, ['scripts/test-pi-tool.mjs', ...args], {
      encoding: 'utf8',
    });
    assert.equal(result.status, args.length <= 1 ? 0 : 1);
    assert.match(result.stdout + result.stderr, /Usage:/);
  }
});
