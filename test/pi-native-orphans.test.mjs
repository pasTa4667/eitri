import assert from 'node:assert/strict';
import test from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, realpath, rm, readdir, lstat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeFixtureProvider, openNativeFixtureController } from './helpers/pi-native.mjs';

const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
async function until(read, accept) {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await delay(10);
  }
  assert.fail('orphan checkpoint timed out');
}

for (const mode of ['orphan', 'orphan-paused'])
  test(
    `recovery reconciles a live ${mode} before any native redispatch`,
    { timeout: 25_000 },
    async (t) => {
      const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-orphan-')));
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
        const closed =
          child.exitCode === null && child.signalCode === null ? once(child, 'exit') : null;
        child.kill('SIGKILL');
        if (closed) await closed;
        await controller?.close();
        if (helper) {
          try {
            process.kill(helper.pid, 'SIGKILL');
          } catch {}
        }
        await rm(directory, { recursive: true, force: true });
      });
      const [message] = await Promise.race([
        once(child, 'message'),
        once(child, 'exit').then(() => assert.fail('fixture exited before orphan checkpoint')),
      ]);
      helper = message.helper;
      assert.equal(message.stage, 'admitted');
      const root = join(directory, 'pi-offline-resources');
      const [resource] = await readdir(root);
      const owner = JSON.parse(await readFile(join(root, resource, 'owner.json'), 'utf8'));
      assert.equal(owner.pid, helper.pid);
      assert.equal(owner.controllerPid, child.pid);
      assert.equal(owner.caseId, message.id);
      assert.equal(owner.actionId, message.admission.actionId);
      assert.equal(owner.epoch, message.admission.epoch);
      assert.deepEqual(await readdir(helper.home), []);
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      assert.deepEqual(await exited, [null, 'SIGKILL']);
      process.kill(helper.pid, 0); // SIGSTOP keeps a real orphan alive across restart.

      const requests = [];
      let effects = 0;
      const boundaryChecks = [];
      const options = {
        directory,
        policy,
        clock: () => 1000,
        providerForCase: (id) =>
          nativeFixtureProvider(directory, id, requests, {
            before: async () => {
              let pidGone = false;
              try {
                process.kill(helper.pid, 0);
              } catch (error) {
                pidGone = error.code === 'ESRCH';
              }
              let homeGone = false;
              try {
                await lstat(helper.home);
              } catch (error) {
                homeGone = error.code === 'ENOENT';
              }
              boundaryChecks.push({ pidGone, homeGone });
            },
          }),
        probe: async () => {
          effects++;
          return 'Recovered orphan result café ✓';
        },
      };
      const catalogueBefore = await readFile(join(directory, 'catalogue.sqlite'));
      await assert.rejects(openNativeFixtureController(options, { timeoutMs: 50 }), {
        message: 'pi-native-resource-reconciliation-failed',
      });
      assert.deepEqual(await readFile(join(directory, 'catalogue.sqlite')), catalogueBefore);
      assert.equal(requests.length, 0);
      assert.equal(effects, 0);
      assert.ok((await lstat(helper.home)).isDirectory());
      assert.equal(
        JSON.parse(await readFile(join(root, resource, 'owner.json'), 'utf8')).pid,
        helper.pid,
      );

      let opened = false;
      const opening = openNativeFixtureController(options).then((value) => {
        opened = true;
        controller = value;
        return value;
      });
      await delay(50);
      assert.equal(opened, false);
      assert.equal(requests.length, 0);
      process.kill(helper.pid, 'SIGCONT'); // Let the orphan observe EOF; recovery owns cleanup.
      await opening;
      await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
      const selected = await until(
        async () => (await controller.snapshot({ selected: message.id })).selected,
        (value) => ['paused', 'needs-attention'].includes(value.case.status),
      );
      assert.equal(selected.case.status, mode === 'orphan-paused' ? 'paused' : 'needs-attention');
      assert.equal(selected.case.usedMs, 120_000);
      assert.equal(selected.case.remainingMs, 480_000);
      assert.equal(selected.case.attempt, 1);
      assert.equal(selected.case.repairs, 0);
      assert.equal(effects, mode === 'orphan-paused' ? 0 : 1);
      assert.equal(requests.length, mode === 'orphan-paused' ? 0 : 2);
      assert.deepEqual(
        boundaryChecks,
        requests.map(() => ({ pidGone: true, homeGone: true })),
      );
      if (requests.length) {
        const results = selected.messages.filter((m) => m.kind === 'eitri.action-result');
        assert.equal(results.length, 1);
        assert.ok(JSON.stringify(results[0]).includes('Recovered orphan result café ✓'));
        const transcript = selected.messages.flatMap((m) => m.data?.messages ?? []);
        assert.equal(transcript.filter((m) => m.role === 'assistant').length, 2);
        assert.equal(transcript.filter((m) => m.role === 'toolResult').length, 1);
        assert.notEqual(requests[0].actionId, message.admission.actionId);
        assert.ok(requests[0].epoch > message.admission.epoch);
      }
      assert.deepEqual(await readdir(root), []);
      await controller.close();
      controller = await openNativeFixtureController(options);
      const reopened = (await controller.snapshot({ selected: message.id })).selected;
      assert.deepEqual(reopened.messages, selected.messages);
      assert.equal(reopened.case.usedMs, selected.case.usedMs);
      assert.equal(requests.length, mode === 'orphan-paused' ? 0 : 2);
      assert.equal(effects, mode === 'orphan-paused' ? 0 : 1);
    },
  );
