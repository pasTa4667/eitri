import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtemp,
  realpath,
  rm,
  mkdir,
  writeFile,
  readFile,
  readdir,
  lstat,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Controller } from '../src/controller.ts';
import { nativeFixtureProvider } from './helpers/pi-native.mjs';

const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
const retentionMs = 30 * 86400_000;

async function parked(controller, id) {
  const deadline = Date.now() + 10_000;
  while (true) {
    const view = (await controller.snapshot({ selected: id })).selected;
    if (view.case.status === 'needs-attention') {
      assert.equal(view.case.reason, 'assessment-required');
      return view;
    }
    assert.ok(Date.now() < deadline, 'native case did not settle');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

for (const expiry of ['maintain', 'reopen', 'explicit'])
  test(
    `sequential installed streams isolate cases and ${expiry} expires only eligible details`,
    { timeout: 30_000 },
    async (t) => {
      const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-pi-isolation-')));
      const requests = [],
        helpers = [],
        cleaned = [],
        effects = [];
      let controller;
      let reopens = 0;
      t.after(async () => {
        try {
          await controller?.close();
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      });
      // A deletion-boundary sentinel, not SDK storage or shared-auth/refresh evidence.
      const authDirectory = join(directory, 'global-auth');
      await mkdir(authDirectory, { mode: 0o700 });
      const authPath = join(authDirectory, 'oauth.json');
      const authBytes = Buffer.from('{"synthetic":"global-not-case-owned"}\n');
      await writeFile(authPath, authBytes, { mode: 0o600 });
      let now = Date.now();
      const options = {
        directory,
        policy,
        clock: () => now,
        providerForCase: (id) =>
          nativeFixtureProvider(directory, id, requests, {
            onSpawn: (helper) => {
              for (const previous of helpers) {
                assert.throws(() => process.kill(previous.pid, 0), { code: 'ESRCH' });
                assert.equal(existsSync(previous.home), false, 'previous helper home retained');
              }
              helpers.push(helper);
            },
            beforeCleanup: async (request) => {
              const helper = helpers.at(-1);
              assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
              assert.deepEqual(await readdir(helper.home), [], 'no helper transcript/cache');
              cleaned.push(request.actionId);
            },
          }),
        probe: async (id) => {
          effects.push(id);
          return `Private native result ${id} café ✓`;
        },
      };
      controller = await Controller.open(options);
      const investigate = async (id) =>
        controller.command({
          requestId: randomUUID(),
          intent: {
            type: 'investigate',
            issue: {
              ...policy,
              id,
              title: `Private issue ${id} 🛠️`,
              priority: 'high',
              status: 'unresolved',
              regressed: false,
              escalating: false,
            },
          },
        });
      const issueIds = [randomUUID(), randomUUID()];
      const views = [];
      for (const issueId of issueIds) {
        const { caseId } = await investigate(issueId);
        views.push(await parked(controller, caseId));
      }
      const [a, b] = views.map((view) => view.case.id);
      assert.notEqual(a, b);
      assert.deepEqual(effects, [a, b]);
      assert.equal(requests.length, 4);
      assert.equal(helpers.length, 4);
      assert.equal(new Set(helpers.map((helper) => helper.home)).size, 4);
      assert.deepEqual(
        cleaned,
        requests.map((request) => request.actionId),
      );
      assert.equal(new Set(cleaned).size, 4);
      const calls = [];
      for (let i = 0; i < views.length; i++) {
        const id = views[i].case.id,
          other = views[1 - i].case.id;
        const owned = requests.filter((request) => request.caseId === id);
        assert.equal(owned.length, 2);
        assert.equal(owned[0].epoch, owned[1].epoch);
        for (const request of owned) {
          const text = JSON.stringify(request.context);
          assert.ok(text.includes(issueIds[i]), 'native issue context missing');
          assert.ok(!text.includes(issueIds[1 - i]), 'foreign issue context');
          assert.ok(!text.includes(other), 'foreign case identity/result');
        }
        assert.equal(
          owned[0].context.messages.some((m) => m.role === 'toolResult'),
          false,
        );
        const results = owned[1].context.messages.filter((m) => m.role === 'toolResult');
        assert.equal(results.length, 1);
        assert.deepEqual(results[0].content, [
          { type: 'text', text: `Private native result ${id} café ✓` },
        ]);
        const call = owned[1].context.messages
          .flatMap((m) => m.content ?? [])
          .find((block) => block.type === 'toolCall');
        assert.equal(results[0].toolCallId, call.id);
        assert.equal(call.id, `probe-${owned[0].actionId}`);
        calls.push(call.id);
        const transcript = JSON.stringify(views[i].messages);
        assert.ok(transcript.includes(`Private native result ${id}`));
        assert.ok(!transcript.includes(`Private native result ${other}`));
      }
      assert.notEqual(calls[0], calls[1]);
      assert.ok(!views[0].messages.some((m) => views[1].messages.some((n) => m.id === n.id)));
      const casePath = (id) => join(directory, 'cases', id);
      const dbPath = (id) => join(casePath(id), 'session.sqlite');
      const bInode = (await lstat(dbPath(b))).ino;
      assert.notEqual((await lstat(dbPath(a))).ino, bInode);
      await assert.rejects(
        controller.command({
          requestId: randomUUID(),
          expectedControlVersion: views[1].case.version,
          intent: { type: 'details-cleanup', caseId: b, confirmed: true },
        }),
        { code: 'unfinished-case-protected' },
      );
      await controller.command({
        requestId: randomUUID(),
        expectedControlVersion: views[0].case.version,
        intent: { type: 'dismiss', caseId: a, note: 'End synthetic isolation case' },
      });
      if (expiry === 'explicit') {
        const current = (await controller.snapshot({ selected: a })).selected.case;
        await controller.command({
          requestId: randomUUID(),
          expectedControlVersion: current.version,
          intent: { type: 'details-cleanup', caseId: a, confirmed: true },
        });
      } else {
        now += retentionMs - 1;
        await controller.maintain();
        assert.equal((await controller.snapshot({ selected: a })).selected.case.native, 'ready');
        assert.ok(await lstat(dbPath(a)));
        now += 1;
        if (expiry === 'maintain') await controller.maintain();
        else {
          await controller.close();
          controller = await Controller.open(options);
          reopens++;
        }
      }
      const assertExpired = async () => {
        const expired = (await controller.snapshot({ selected: a })).selected;
        assert.equal(expired.case.native, 'expired');
        assert.equal(expired.case.outcome, 'dismissed');
        assert.deepEqual(expired.messages, []);
        await assert.rejects(lstat(casePath(a)), { code: 'ENOENT' });
        const preserved = (await controller.snapshot({ selected: b })).selected;
        assert.deepEqual(preserved, {
          ...views[1],
          case: { ...views[1].case, epoch: views[1].case.epoch + reopens },
        });
        assert.equal((await lstat(dbPath(b))).ino, bInode);
        assert.deepEqual(await readFile(authPath), authBytes);
        assert.deepEqual((await readdir(join(directory, 'cases'))).sort(), [b]);
        for (const helper of helpers) {
          assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
          await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
        }
        assert.equal(requests.length, 4);
        assert.deepEqual(effects, [a, b]);
      };
      await assertExpired();
      const duplicate = await investigate(issueIds[0]);
      assert.equal(duplicate.disposition, 'existing');
      assert.equal(duplicate.caseId, a);
      await assert.rejects(
        controller.command({
          requestId: randomUUID(),
          intent: { type: 'post-message', caseId: a, text: 'Must not recreate details' },
        }),
        { code: 'details-unavailable' },
      );
      await controller.close();
      controller = await Controller.open(options);
      reopens++;
      await assertExpired();
      const db = new DatabaseSync(join(directory, 'catalogue.sqlite'), { readOnly: true });
      try {
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM deliveries').get().n, 0);
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM actions').get().n, 0);
        for (const table of [
          'metadata',
          'cases',
          'receipts',
          'action_sources',
          'workspace_bindings',
        ]) {
          const text = JSON.stringify(db.prepare(`SELECT value FROM ${table}`).all());
          for (const id of [a, b])
            assert.ok(
              !text.includes(`Private native result ${id}`),
              'catalogue retained tool transcript',
            );
        }
      } finally {
        db.close();
      }
    },
  );
