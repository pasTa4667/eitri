import assert from 'node:assert/strict';
import test from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, realpath, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Controller } from '../src/controller.ts';
import { nativeFixtureProvider } from './helpers/pi-native.mjs';

const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
function catalogue(directory) {
  const db = new DatabaseSync(join(directory, 'catalogue.sqlite'), { readOnly: true });
  try {
    return {
      actions: db
        .prepare('SELECT value FROM actions')
        .all()
        .map((row) => JSON.parse(row.value)),
      cases: db
        .prepare('SELECT value FROM cases')
        .all()
        .map((row) => JSON.parse(row.value)),
    };
  } finally {
    db.close();
  }
}

for (const boundary of ['admission', 'terminal', 'model-receipt', 'committed-tool'])
  test(
    `SIGKILL at native ${boundary} preserves pause, exact accounting and committed results`,
    { timeout: 20_000 },
    async (t) => {
      const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-boundary-')));
      const child = fork(
        new URL('./helpers/pi-native-crash.mjs', import.meta.url),
        [directory, boundary],
        {
          env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR },
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
      );
      let controller;
      let helper;
      t.after(async () => {
        const closed =
          child.exitCode !== null || child.signalCode !== null ? null : once(child, 'exit');
        child.kill('SIGKILL');
        if (closed) await closed;
        await controller?.close();
        // These boundaries have no live helper; this is failure-path test cleanup only.
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
        once(child, 'exit').then(() => assert.fail('Fixture exited before boundary')),
      ]);
      helper = message.helper;
      assert.equal(message.stage, 'boundary');
      assert.equal(message.boundary, boundary);
      assert.equal(message.admission.epoch, 1);
      if (boundary !== 'model-receipt') {
        const ack = once(child, 'message');
        child.send('pause');
        assert.equal((await ack)[0].stage, 'pause-persisted');
      }
      const before = catalogue(directory);
      assert.equal(before.cases.length, 1);
      assert.equal(before.cases[0].status, 'pause-requested');
      assert.equal(before.cases[0].usedMs, 0);
      assert.equal(before.actions.length, boundary === 'model-receipt' ? 0 : 1);
      if (before.actions.length) {
        assert.equal(before.actions[0].kind, 'model');
        assert.equal(before.actions[0].id, message.admission.actionId);
      }
      if (boundary === 'admission') assert.equal(helper, undefined);
      else {
        assert.ok(helper.pid);
        assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
        await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
      }
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      assert.deepEqual(await exited, [null, 'SIGKILL']);

      const requests = [];
      let effects = 0;
      const options = {
        directory,
        policy,
        clock: () => 1000,
        providerForCase: (id) => nativeFixtureProvider(directory, id, requests),
        probe: async () => {
          effects++;
          return 'Unexpected replay';
        },
      };
      controller = await Controller.open(options);
      const selected = (await controller.snapshot({ selected: message.id })).selected;
      const charged = boundary === 'model-receipt' ? 0 : 120_000;
      assert.equal(selected.case.status, 'paused');
      assert.equal(selected.case.usedMs, charged);
      assert.equal(selected.case.remainingMs, 600_000 - charged);
      assert.equal(selected.case.attempt, 1);
      assert.equal(selected.case.repairs, 0);
      assert.ok(selected.case.epoch > message.admission.epoch);
      assert.equal(requests.length, 0);
      assert.equal(effects, 0);
      assert.deepEqual(catalogue(directory).actions, []);
      const results = selected.messages.filter((m) => m.kind === 'eitri.action-result');
      assert.equal(results.length, boundary === 'committed-tool' ? 1 : 0);
      const modelMessages = selected.messages.flatMap((m) => m.data?.messages ?? []);
      const assistants = modelMessages.filter((m) => m.role === 'assistant');
      const toolResults = modelMessages.filter((m) => m.role === 'toolResult');
      if (boundary === 'committed-tool') {
        assert.equal(message.toolCallId, `probe-${message.firstActionId}`);
        assert.equal(assistants.length, 1);
        assert.equal(
          assistants[0].content.find((block) => block.type === 'toolCall').id,
          message.toolCallId,
        );
        assert.equal(toolResults.length, 1);
        assert.equal(toolResults[0].toolCallId, message.toolCallId);
        assert.equal(toolResults[0].isError, false);
        assert.deepEqual(toolResults[0].content, [
          { type: 'text', text: 'Native committed result café ✓' },
        ]);
        assert.ok(JSON.stringify(results[0]).includes('Native committed result café ✓'));
      } else {
        assert.deepEqual(assistants, [], 'uncommitted assistant became a transcript');
        assert.deepEqual(toolResults, []);
      }

      await controller.close();
      controller = await Controller.open(options);
      const reopened = (await controller.snapshot({ selected: message.id })).selected;
      assert.deepEqual(reopened.messages, selected.messages);
      for (const field of ['status', 'usedMs', 'remainingMs', 'attempt', 'repairs'])
        assert.equal(reopened.case[field], selected.case[field]);
      assert.equal(requests.length, 0);
      assert.equal(effects, 0);
      const duplicate = await controller.command({
        requestId: randomUUID(),
        intent: {
          type: 'investigate',
          issue: {
            ...policy,
            id: 'native-crash',
            title: 'Synthetic crash',
            priority: 'high',
            status: 'unresolved',
            regressed: false,
            escalating: false,
          },
        },
      });
      assert.equal(duplicate.caseId, message.id);
      assert.equal(catalogue(directory).cases.length, 1);
      assert.deepEqual(catalogue(directory).actions, []);
      assert.equal(requests.length, 0);
      assert.equal(effects, 0);
    },
  );
