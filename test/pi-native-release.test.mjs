import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, rm, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { NativeCase } from '../src/native.ts';
import { nativeFixtureProvider, openNativeFixtureController } from './helpers/pi-native.mjs';
import { Controller } from '../src/controller.ts';

const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
const issue = {
  ...policy,
  id: 'release',
  title: 'Offline release ordering',
  priority: 'high',
  status: 'unresolved',
  regressed: false,
  escalating: false,
};
const turn = () => new Promise((resolve) => setImmediate(resolve));

for (const mode of [
  'deadline',
  'deadline-close',
  'close',
  'pause',
  'reconcile',
  'terminal',
  'terminal-failure',
])
  test(
    `native ${mode} holds receipts, capacity and restart until adapter drainage`,
    { timeout: 20_000 },
    async (t) => {
      const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-release-')));
      const spawned = Promise.withResolvers(),
        cleaning = Promise.withResolvers();
      const release = Promise.withResolvers(),
        receipted = Promise.withResolvers();
      let now = 1000,
        wake,
        oldWake,
        helper,
        firstId,
        secondId,
        native;
      let receipts = 0,
        effects = 0,
        held = false,
        resourceReleasedAtReceipt = false;
      const requests = [];
      let controller;
      const open = NativeCase.open;
      t.mock.method(NativeCase, 'open', async (...args) => {
        const value = await open(...args);
        native ??= value;
        return value;
      });
      const hold = async () => {
        if (held) return;
        held = true;
        cleaning.resolve();
        await release.promise;
      };
      const options = {
        directory,
        policy,
        clock: () => now,
        allowanceMs: 1000,
        actionWakeup: (_delay, callback) => {
          wake = callback;
          return () => {};
        },
        providerForCase: (id) =>
          nativeFixtureProvider(directory, id, requests, {
            onSpawn: (value) => {
              if (helper) return;
              helper = value;
              oldWake = wake;
              spawned.resolve();
              if (mode.startsWith('deadline')) {
                now += 1000;
                wake();
              }
            },
            beforeCleanup: mode.startsWith('terminal') ? undefined : hold,
            // Deliberately separate terminal delivery from adapter disposal.
            afterTerminal: mode.startsWith('terminal')
              ? async () => {
                  await hold();
                  if (mode === 'terminal-failure') throw new Error('Private cleanup detail');
                }
              : undefined,
          }),
        probe: async () => {
          effects++;
          return 'Synthetic result';
        },
        fault: (point, id) => {
          if (point !== 'after-model-action-receipt' || id !== firstId) return;
          receipts++;
          try {
            process.kill(helper.pid, 0);
          } catch (error) {
            resourceReleasedAtReceipt = error.code === 'ESRCH' && !existsSync(helper.home);
          }
          receipted.resolve();
        },
      };
      controller = await openNativeFixtureController(options);
      t.after(async () => {
        release.resolve();
        await controller.close();
        await rm(directory, { recursive: true, force: true });
      });
      const add = async (id) =>
        (
          await controller.command({
            requestId: randomUUID(),
            intent: { type: 'investigate', issue: { ...issue, id } },
          })
        ).caseId;
      firstId = await add('release-first');
      await spawned.promise;
      if (mode === 'pause')
        await controller.command({
          requestId: randomUUID(),
          intent: { type: 'pause', caseId: firstId },
        });
      let closed = false,
        reconciled = false;
      const closing = mode.includes('close')
        ? controller.close().then(() => {
            closed = true;
          })
        : undefined;
      await cleaning.promise;
      const reconciling =
        mode === 'reconcile'
          ? native.reconcile().then(() => {
              reconciled = true;
            })
          : undefined;
      if (mode.startsWith('terminal')) await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
      else assert.ok((await lstat(helper.home)).isDirectory());
      assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
      if (!closing && mode !== 'terminal-failure') secondId = await add('release-second');
      // Flush native/controller promise continuations, without relying on a timing race.
      for (let i = 0; i < 20; i++) await turn();
      const db = new DatabaseSync(join(directory, 'catalogue.sqlite'), { readOnly: true });
      try {
        assert.equal(receipts, 0, 'no action receipt before drainage');
        assert.equal(
          db.prepare('SELECT count(*) AS n FROM actions WHERE case_id=?').get(firstId).n,
          1,
        );
        assert.equal(requests.length, 1, 'capacity remains occupied');
        assert.equal(effects, 0);
        assert.equal(closed, false, 'close cannot release the controller lock');
        assert.equal(reconciled, false, 'reconcile cannot acknowledge early release');
        if (secondId)
          assert.equal(
            (await controller.snapshot({ selected: secondId })).selected.case.status,
            'queued',
          );
        if (closing)
          await assert.rejects(Controller.open(options), {
            code: 'controller-already-open',
          });
      } finally {
        db.close();
      }
      release.resolve();
      await reconciling;
      if (closing) await closing;
      else {
        await receipted.promise;
        assert.equal(resourceReleasedAtReceipt, true);
        await controller.close();
      }
      if (mode === 'terminal-failure') {
        assert.equal(effects, 0, 'a failed drain must not publish a tool-use terminal');
        assert.equal(requests.length, 1);
      }
      await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
      // Reopen the real catalogue/native stores only after the old adapter has drained.
      controller = await openNativeFixtureController(options);
      const selected = (await controller.snapshot({ selected: firstId })).selected;
      if (mode.startsWith('deadline')) {
        assert.equal(selected.case.remainingMs, 0);
        assert.equal(selected.case.status, 'needs-attention');
      }
      if (mode === 'pause') assert.equal(selected.case.status, 'paused');
      if (mode === 'terminal-failure') {
        assert.equal(selected.case.reason, 'model-action-failed');
        assert.ok(!JSON.stringify(selected.messages).includes('Private cleanup detail'));
      }
      oldWake();
      assert.deepEqual(
        (await controller.snapshot({ selected: firstId })).selected.case,
        selected.case,
      );
    },
  );
