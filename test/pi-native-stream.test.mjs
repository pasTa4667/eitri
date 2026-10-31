import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { Controller } from '../src/controller.ts';
import { nativeFixtureProvider } from './helpers/pi-native.mjs';
import { streamNativeFixture } from '../prototypes/pi-native-stream.mjs';
import { context } from '../prototypes/pi-stream-fixtures.ts';
import { makeRequest } from '../prototypes/pi-stream-protocol.mjs';

const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
const issue = {
  ...policy,
  id: 'offline-native',
  title: 'Synthetic café 🛠️',
  priority: 'high',
  status: 'unresolved',
  regressed: false,
  escalating: false,
};
async function until(read, accept) {
  const end = Date.now() + 10_000;
  while (true) {
    const value = await read();
    if (accept(value)) return value;
    assert.ok(Date.now() < end, `Timed out: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function fixture(t, extra = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-native-')));
  const requests = [];
  let controller;
  const options = {
    directory,
    policy,
    providerForCase: (caseId) => nativeFixtureProvider(directory, caseId, requests, extra.stream),
    probe: async () => 'Native result café ✓',
    ...extra.controller,
  };
  controller = await Controller.open(options);
  t.after(async () => {
    await controller.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    requests,
    get controller() {
      return controller;
    },
    async restart() {
      await controller.close();
      controller = await Controller.open(options);
    },
    async add(issueId = issue.id) {
      return (
        await controller.command({
          requestId: randomUUID(),
          intent: { type: 'investigate', issue: { ...issue, id: issueId } },
        })
      ).caseId;
    },
    async view(id) {
      return (await controller.snapshot({ selected: id })).selected;
    },
    async parked(id) {
      return until(
        () => this.view(id),
        (v) => ['needs-attention', 'paused'].includes(v.case.status),
      );
    },
  };
}

test(
  'installed stream SDK round trips the real native tool result and SQLite transcript',
  { timeout: 20_000 },
  async (t) => {
    let effects = 0;
    const f = await fixture(t, {
      controller: {
        probe: async () => {
          effects++;
          return 'Native result café ✓';
        },
      },
    });
    const id = await f.add();
    const view = await f.parked(id);
    assert.equal(view.case.reason, 'assessment-required');
    assert.equal(effects, 1);
    assert.equal(f.requests.length, 2);
    const [first, second] = f.requests;
    assert.equal(first.caseId, id);
    assert.equal(second.caseId, id);
    assert.notEqual(first.actionId, second.actionId);
    assert.equal(first.epoch, second.epoch);
    const result = second.context.messages.find((m) => m.role === 'toolResult');
    const call = second.context.messages
      .find((m) => m.role === 'assistant')
      .content.find((b) => b.type === 'toolCall');
    assert.equal(result.toolCallId, call.id);
    assert.equal(result.toolName, 'probe');
    assert.deepEqual(result.content, [{ type: 'text', text: 'Native result café ✓' }]);
    assert.equal(view.messages.filter((m) => m.kind === 'eitri.action-result').length, 1);
    const before = view.messages;
    await f.restart();
    assert.deepEqual((await f.view(id)).messages, before);
    assert.equal(f.requests.length, 2);
    assert.equal(effects, 1);
  },
);

for (const boundary of ['model', 'tool'])
  test(
    `pause during admitted ${boundary} settles only that action; Continue retains allowance`,
    { timeout: 20_000 },
    async (t) => {
      let now = 1000;
      let f;
      let effects = 0;
      let paused = false;
      const pause = async (id) => {
        if (paused) return;
        paused = true;
        now += 25;
        await f.controller.command({
          requestId: randomUUID(),
          intent: { type: 'pause', caseId: id },
        });
      };
      f = await fixture(t, {
        stream: {
          before: async (request) => {
            if (boundary === 'model') await pause(request.caseId);
          },
        },
        controller: {
          clock: () => now,
          allowanceMs: 1000,
          probe: async (id) => {
            effects++;
            await pause(id);
            return 'Native result café ✓';
          },
        },
      });
      const id = await f.add();
      const view = await f.parked(id);
      assert.equal(view.case.status, 'paused');
      assert.equal(f.requests.length, 1);
      assert.equal(effects, boundary === 'model' ? 0 : 1);
      assert.equal(view.case.usedMs, 25);
      assert.equal(view.case.remainingMs, 975);
      await f.restart();
      assert.equal((await f.view(id)).case.status, 'paused');
      assert.equal(f.requests.length, 1);
      now += 500_000;
      const current = (await f.view(id)).case;
      await f.controller.command({
        requestId: randomUUID(),
        expectedControlVersion: current.version,
        intent: { type: 'continue', caseId: id },
      });
      const stopped = await f.parked(id);
      assert.equal(stopped.case.reason, 'assessment-required');
      assert.equal(stopped.case.usedMs, 25);
      assert.equal(stopped.case.remainingMs, 975);
      assert.equal(stopped.case.attempt, 1);
      assert.equal(effects, boundary === 'model' ? 0 : 1);
      assert.equal(f.requests.length, 2);
      assert.equal(
        f.requests[1].context.messages.find((m) => m.role === 'toolResult').isError,
        boundary === 'model',
      );
    },
  );

test(
  'native deadline aborts the adapter before dispatch and restart grants no fresh allowance',
  { timeout: 20_000 },
  async (t) => {
    let now = 1000;
    let spawned = 0;
    const f = await fixture(t, {
      stream: {
        before: async () => {
          now += 100;
          await new Promise((resolve) => setTimeout(resolve, 150));
        },
        onSpawn: () => {
          spawned++;
        },
      },
      controller: { clock: () => now, allowanceMs: 100 },
    });
    const id = await f.add();
    const stopped = await f.parked(id);
    assert.equal(stopped.case.reason, 'model-action-timed-out');
    assert.equal(stopped.case.remainingMs, 0);
    assert.equal(stopped.case.usedMs, 100);
    assert.equal(spawned, 0);
    assert.equal(stopped.messages.filter((m) => m.kind === 'eitri.action-result').length, 0);
    await f.restart();
    assert.equal((await f.view(id)).case.remainingMs, 0);
    assert.equal(f.requests.length, 1);
  },
);

for (const failure of ['pre-abort', 'spawn-abort', 'spawn-throw', 'event-throw', 'cleanup-throw'])
  test(
    `single native stream ${failure} returns a fixed error after helper reaping/cleanup`,
    { timeout: 15_000 },
    async () => {
      const abort = new AbortController();
      let helper;
      const fixtureContext = structuredClone(context);
      fixtureContext.messages[0].toolsAdded[0] = {
        name: 'probe',
        description: 'Synthetic',
        parameters: { type: 'object' },
      };
      if (failure === 'pre-abort') abort.abort();
      await assert.rejects(
        streamNativeFixture(makeRequest(0, fixtureContext), {
          signal: abort.signal,
          onSpawn: (value) => {
            helper = value;
            if (failure === 'spawn-abort') abort.abort();
            if (failure === 'spawn-throw') throw new Error('private callback detail');
          },
          onEvent: () => {
            if (failure === 'event-throw') throw new Error('private event detail');
          },
          beforeCleanup: () => {
            if (failure === 'cleanup-throw') throw new Error('private cleanup detail');
          },
        }),
        {
          message:
            failure === 'cleanup-throw'
              ? 'pi-native-stream-offline-cleanup-failed'
              : 'pi-native-stream-offline-failed',
        },
      );
      if (failure === 'pre-abort') assert.equal(helper, undefined);
      else {
        assert.ok(helper.pid);
        assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
        await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
      }
    },
  );

test(
  'native active deadline cancels a real helper and denies all subsequent tool/model work',
  { timeout: 15_000 },
  async (t) => {
    let now = 1000;
    let helper;
    let wake;
    let effects = 0;
    const f = await fixture(t, {
      stream: {
        onSpawn: (value) => {
          helper = value;
          now += 100;
          wake();
        },
      },
      controller: {
        clock: () => now,
        allowanceMs: 100,
        actionWakeup: (_delay, callback) => {
          wake = callback;
          return () => {};
        },
        probe: async () => {
          effects++;
          return 'Must not run';
        },
      },
    });
    const id = await f.add();
    const stopped = await f.parked(id);
    assert.equal(stopped.case.reason, 'model-action-timed-out');
    assert.equal(stopped.case.remainingMs, 0);
    assert.equal(f.requests.length, 1);
    assert.equal(effects, 0);
    assert.ok(helper.pid);
    await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
    assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
    await f.restart();
    assert.equal(f.requests.length, 1);
    assert.equal(effects, 0);
  },
);

for (const mode of ['model', 'paused-model', 'tool', 'tool-receipt'])
  test(
    `native SQLite recovery after SIGKILL at ${mode} never replays uncertain tools`,
    { timeout: 25_000 },
    async (t) => {
      const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-native-crash-')));
      const child = fork(
        new URL('./helpers/pi-native-crash.mjs', import.meta.url),
        [directory, mode],
        {
          env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR },
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
      );
      let controller;
      let helper;
      t.after(async () => {
        child.kill('SIGKILL');
        await controller?.close();
        if (helper) {
          try {
            process.kill(helper.pid, 'SIGKILL');
          } catch {}
          await rm(helper.home, { recursive: true, force: true });
        }
        await rm(directory, { recursive: true, force: true });
      });
      const [message] = await Promise.race([
        once(child, 'message'),
        once(child, 'exit').then(() => assert.fail('Fixture exited before checkpoint')),
      ]);
      helper = message.helper;
      assert.equal(message.stage, 'admitted');
      if (mode === 'paused-model') {
        const ack = once(child, 'message');
        child.send('pause');
        assert.equal((await ack)[0].stage, 'pause-persisted');
      }
      const exit = once(child, 'exit');
      child.kill('SIGKILL');
      await exit;
      // The helper has no continuing loop; closed pipes/its own bounded lifetime stop it.
      if (helper)
        await until(
          async () => {
            try {
              process.kill(helper.pid, 0);
              return false;
            } catch (error) {
              assert.equal(error.code, 'ESRCH');
              return true;
            }
          },
          (gone) => gone,
        );
      const requests = [];
      let effects = 0;
      const options = {
        directory,
        policy,
        providerForCase: (id) => nativeFixtureProvider(directory, id, requests),
        probe: async () => {
          effects++;
          return 'Native result café ✓';
        },
      };
      controller = await Controller.open(options);
      const selected = await until(
        async () => (await controller.snapshot({ selected: message.id })).selected,
        (v) => ['paused', 'needs-attention'].includes(v.case.status),
      );
      assert.equal(selected.case.id, message.id);
      assert.equal(selected.case.attempt, 1);
      assert.equal(selected.case.status, mode === 'paused-model' ? 'paused' : 'needs-attention');
      assert.equal(effects, mode === 'model' ? 1 : 0);
      assert.equal(requests.length, mode === 'model' ? 2 : 0);
      if (mode === 'model') {
        assert.notEqual(requests[0].actionId, message.admission.actionId);
        assert.ok(requests[0].epoch > message.admission.epoch);
      }
      if (mode === 'model' || mode === 'paused-model') {
        assert.ok(selected.case.usedMs >= 120_000);
        assert.ok(selected.case.remainingMs <= 480_000);
      }
      if (mode === 'tool') {
        assert.equal(selected.case.reason, 'interrupted-tool-effect-uncertain');
        assert.ok(selected.case.usedMs >= 60_000);
        assert.equal(selected.messages.filter((m) => m.kind === 'eitri.action-result').length, 0);
      }
      if (mode === 'tool-receipt') {
        assert.equal(selected.case.reason, 'incomplete-native-tool-checkpoint');
        assert.equal(selected.messages.filter((m) => m.kind === 'eitri.action-result').length, 1);
        assert.ok(JSON.stringify(selected.messages).includes('Effect saved before SDK receipt'));
      }
      const before = selected.messages;
      await controller.close();
      controller = await Controller.open(options);
      assert.deepEqual(
        (await controller.snapshot({ selected: message.id })).selected.messages,
        before,
      );
      assert.equal(effects, mode === 'model' ? 1 : 0);
      assert.equal(requests.length, mode === 'model' ? 2 : 0);
    },
  );
