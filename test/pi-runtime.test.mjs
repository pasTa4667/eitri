import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { probePiRuntime } from '../prototypes/pi-runtime.mjs';

async function fixture(t, scenario) {
  const root = await mkdtemp(join(tmpdir(), 'eitri-pi-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cliPath = join(root, 'cli.mjs');
  const auditPath = join(root, 'calls.jsonl');
  await writeFile(
    cliPath,
    `globalThis.scenario=${JSON.stringify(scenario)}; globalThis.auditPath=${JSON.stringify(auditPath)}; await import(${JSON.stringify(new URL('./fixtures/pi-runtime-child.mjs', import.meta.url).href)});`,
  );
  return {
    cliPath,
    calls: async () => (await readFile(auditPath, 'utf8')).trim().split('\n').map(JSON.parse),
  };
}

test('Pi prototype defaults to help without loading the runtime or credentials', () => {
  const result = spawnSync(process.execPath, ['prototypes/pi-runtime.mjs'], {
    cwd: new URL('../', import.meta.url),
    encoding: 'utf8',
    timeout: 5000,
    env: { PATH: process.env.PATH },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /--run/);
});

for (const scenario of ['success', 'fast', 'stderr']) {
  test(`Pi RPC prototype requires streamed final success and settled shutdown: ${scenario}`, async (t) => {
    const child = await fixture(t, scenario);
    const result = await probePiRuntime({ cliPath: child.cliPath });
    assert.deepEqual(result, {
      scope: 'pi-runtime-feasibility',
      transport: 'rpc',
      provider: 'openai-codex',
      model: 'gpt-6.1-sol',
      verdict: 'passed',
      configuredAuthType: 'oauth',
      streamed: true,
      assistantTurns: 1,
      toolExecutions: 0,
      settled: true,
      childExitCode: 0,
    });
    const calls = await child.calls();
    assert.deepEqual(
      calls.filter((call) => call.command).map((call) => call.command),
      ['get_state', 'get_commands', 'prompt'],
    );
    assert.ok(calls.filter((call) => call.args).every((call) => call.secretEnvironment === false));
    assert.equal(
      calls.find((call) => call.command === 'prompt').message,
      'Reply with exactly EITRI_PI_RPC_OK.',
    );
    const cwd = calls[0].cwd;
    await assert.rejects(readFile(join(cwd, '.pi', 'settings.json')), { code: 'ENOENT' });
    assert.doesNotMatch(JSON.stringify(result), /private-|stderr|errorMessage|baseUrl/);
  });
}

for (const scenario of [
  'key-auth',
  'wrong-provider',
  'persistent',
  'extension',
  'bad-json',
  'oversized',
  'rejected',
  'handled',
  'tool',
  'retry',
  'second-turn',
  'no-stream',
  'provider-error',
  'early-exit',
  'aborted',
  'late-start',
]) {
  test(`Pi RPC prototype rejects ${scenario} without exposing diagnostics`, async (t) => {
    const child = await fixture(t, scenario);
    await assert.rejects(probePiRuntime({ cliPath: child.cliPath, timeoutMs: 3000 }), {
      message: 'pi-runtime-probe-failed',
    });
    const calls = await child.calls();
    assert.ok(calls.filter((call) => call.command === 'prompt').length <= 1);
    if (['key-auth', 'wrong-provider', 'persistent', 'extension'].includes(scenario))
      assert.equal(
        calls.some((call) => call.command === 'prompt'),
        false,
      );
  });
}

test('Pi RPC prototype cancels an active stream and reaps its process', async (t) => {
  const child = await fixture(t, 'cancel-stream');
  const controller = new AbortController();
  const pending = probePiRuntime({ cliPath: child.cliPath, signal: controller.signal });
  const rejected = assert.rejects(pending, { message: 'pi-runtime-probe-failed' });
  let started = false;
  for (let i = 0; i < 200; i++) {
    const calls = await child.calls().catch(() => []);
    if (calls.some((call) => call.command === 'prompt')) {
      started = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  controller.abort();
  await rejected;
  assert.equal(started, true);
  const calls = await child.calls();
  const pid = calls.find((call) => call.args?.includes('--mode')).pid;
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('Pi RPC prototype bounds a hung process and closes it', async (t) => {
  const child = await fixture(t, 'hung');
  await assert.rejects(probePiRuntime({ cliPath: child.cliPath, timeoutMs: 300 }), {
    message: 'pi-runtime-probe-failed',
  });
});

test('Pi RPC prototype bounds uncooperative shutdown rather than reporting a pass', async (t) => {
  const child = await fixture(t, 'uncooperative');
  await assert.rejects(probePiRuntime({ cliPath: child.cliPath, timeoutMs: 3000 }), {
    message: 'pi-runtime-probe-failed',
  });
});
