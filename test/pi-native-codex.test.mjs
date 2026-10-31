import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeFixtureProvider, openNativeFixtureController } from './helpers/pi-native.mjs';
import { streamNativeFixture } from '../prototypes/pi-native-stream.mjs';
import { context } from '../prototypes/pi-stream-fixtures.ts';
import { makeRequest } from '../prototypes/pi-stream-protocol.mjs';

const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
const resultText = 'Native Codex result café 🛠️ ✓';
function probeRequest() {
  const transcript = structuredClone(context);
  transcript.messages[0].toolsAdded[0].name = 'probe';
  return makeRequest(0, transcript);
}

test('built-in offline fixture rejects file-profile configuration before profile use', async () => {
  await assert.rejects(
    streamNativeFixture(probeRequest(), {
      fixture: 'codex-probe',
      profileHome: '/nonexistent-eitri-profile-must-not-be-opened',
    }),
    { message: 'pi-native-stream-offline-failed' },
  );
});

for (const boundary of ['before-dispatch', 'stream-start'])
  test(
    `built-in offline fixture cancels at ${boundary} and disposes before rejecting`,
    { timeout: 15000 },
    async () => {
      const control = new AbortController();
      let helper,
        started = false;
      if (boundary === 'before-dispatch') control.abort();
      await assert.rejects(
        streamNativeFixture(probeRequest(), {
          fixture: 'codex-probe',
          signal: control.signal,
          onSpawn: (value) => {
            helper = value;
          },
          onEvent: (event) => {
            if (event.type === 'start') {
              started = true;
              control.abort();
            }
          },
        }),
        { message: 'pi-native-stream-offline-failed' },
      );
      assert.equal(started, boundary === 'stream-start');
      if (helper) {
        assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
        await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
      } else assert.equal(boundary, 'before-dispatch');
    },
  );
async function fixture(t, scenario = 'codex-probe', pause = false) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-native-codex-')));
  const requests = [],
    helpers = [],
    events = [];
  let controller,
    effects = 0,
    now = 1000;
  const options = {
    directory,
    policy,
    clock: () => now,
    providerForCase: (id) =>
      nativeFixtureProvider(directory, id, requests, {
        fixture: scenario,
        onSpawn: (helper) => helpers.push(helper),
        onEvent: (event) => events.push(event.type),
      }),
    probe: async (caseId) => {
      effects++;
      now += 25;
      if (pause)
        await controller.command({
          requestId: randomUUID(),
          intent: { type: 'pause', caseId },
        });
      return resultText;
    },
  };
  controller = await openNativeFixtureController(options);
  t.after(async () => {
    await controller.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    requests,
    helpers,
    events,
    get effects() {
      return effects;
    },
    get controller() {
      return controller;
    },
    async add() {
      return (
        await controller.command({
          requestId: randomUUID(),
          intent: {
            type: 'investigate',
            issue: {
              ...policy,
              id: 'offline-codex',
              title: 'Synthetic only',
              priority: 'high',
              status: 'unresolved',
              regressed: false,
              escalating: false,
            },
          },
        })
      ).caseId;
    },
    async view(id) {
      return (await controller.snapshot({ selected: id })).selected;
    },
    async parked(id) {
      const deadline = performance.now() + 10000;
      while (performance.now() < deadline) {
        const view = await this.view(id);
        if (['paused', 'needs-attention'].includes(view.case.status)) return view;
        await delay(10);
      }
      assert.fail('offline Codex composition timed out');
    },
    async restart() {
      await controller.close();
      now += 100000;
      controller = await openNativeFixtureController(options);
    },
    async disposed() {
      for (const helper of helpers) {
        assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
        await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
      }
    },
  };
}

for (const pause of [false, true])
  test(
    `built-in Codex SSE joins native tool/result and SQLite with pause=${pause}`,
    { timeout: 20000 },
    async (t) => {
      const f = await fixture(t, 'codex-probe', pause);
      const id = await f.add();
      let view = await f.parked(id);
      assert.equal(f.effects, 1);
      assert.equal(view.case.usedMs, 25);
      if (pause) {
        assert.equal(view.case.status, 'paused');
        assert.equal(f.requests.length, 1);
        await f.disposed();
        await f.restart();
        view = await f.view(id);
        assert.equal(view.case.status, 'paused');
        assert.equal(f.requests.length, 1);
        await f.controller.command({
          requestId: randomUUID(),
          expectedControlVersion: view.case.version,
          intent: { type: 'continue', caseId: id },
        });
        view = await f.parked(id);
      }
      assert.equal(view.case.reason, 'assessment-required');
      assert.equal(f.requests.length, 2);
      assert.equal(f.effects, 1);
      const [first, second] = f.requests;
      assert.notEqual(first.actionId, second.actionId);
      const call = second.context.messages
        .find((m) => m.role === 'assistant')
        .content.find((b) => b.type === 'toolCall');
      const result = second.context.messages.find((m) => m.role === 'toolResult');
      assert.equal(call.name, 'probe');
      assert.deepEqual(call.arguments, {});
      assert.equal(result.toolCallId, call.id);
      assert.equal(result.isError, false);
      assert.deepEqual(result.content, [{ type: 'text', text: resultText }]);
      assert.ok(f.events.includes('text_delta'));
      assert.ok(f.events.includes('toolcall_delta'));
      assert.equal(view.messages.filter((m) => m.kind === 'eitri.action-result').length, 1);
      assert.equal(view.case.usedMs, 25);
      assert.equal(view.case.remainingMs, 599975);
      assert.equal(view.case.attempt, 1);
      assert.equal(view.case.repairs, 0);
      assert.ok(!JSON.stringify(view).includes('synthetic-private'));
      await f.disposed();
      await f.restart();
      assert.deepEqual((await f.view(id)).messages, view.messages);
      assert.equal((await f.view(id)).case.usedMs, 25);
      assert.equal(f.requests.length, 2);
      assert.equal(f.effects, 1);
    },
  );

for (const scenario of ['codex-denied', 'codex-malformed', 'codex-unknown'])
  test(
    `${scenario} parks native work without tool execution, fallback or replay`,
    { timeout: 20000 },
    async (t) => {
      const f = await fixture(t, scenario);
      const id = await f.add();
      const view = await f.parked(id);
      assert.equal(view.case.reason, 'model-action-failed');
      assert.equal(f.requests.length, 1);
      assert.equal(f.effects, 0);
      assert.equal(f.helpers.length, 1);
      if (scenario !== 'codex-denied') assert.ok(f.events.includes('start'));
      assert.equal(view.messages.filter((m) => m.kind === 'eitri.action-result').length, 0);
      assert.ok(!JSON.stringify(view).includes('synthetic-private'));
      await f.disposed();
      await f.restart();
      assert.equal(f.requests.length, 1);
      assert.equal(f.effects, 0);
      assert.equal((await f.view(id)).case.remainingMs, view.case.remainingMs);
    },
  );
