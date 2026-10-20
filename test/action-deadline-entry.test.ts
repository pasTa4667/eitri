import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { AdmittedCheckRequest } from '../src/domain.ts';
import type { FrozenBrowserAcceptance } from '../src/frozen-browser.ts';
import { fixture, sources, receipt } from './controller-worker-association-fixture.ts';

for (const point of [
  'after-source-freeze',
  'after-source-selection-receipt',
  'after-worker-intent',
])
  for (const delta of [-1, 0, 1])
    test(`${point} callback entry at D${delta < 0 ? delta : `+${delta}`} with withheld wakeups`, async (t) => {
      let now = 1000;
      const requests: AdmittedCheckRequest[] = [];
      const f = await fixture(t, {
        clock: () => now,
        actionWakeup: () => () => {},
        offlineWorkerAcceptance: true,
        fault: (name) => {
          if (name === point) now = 61000 + delta;
        },
        check: async (request) => {
          requests.push(request);
          return receipt(request.kind);
        },
      });
      const id = await f.add();
      const c = await f.parked(id);
      assert.equal(c.reason, delta < 0 ? 'assessment-required' : 'check-allowance-exhausted');
      assert.equal(requests.length, delta < 0 ? 1 : 0);
      if (delta < 0) {
        assert.equal(requests[0].deadlineAt, 61000);
        assert.equal(requests[0].remainingMs, 1);
      }
      const source = sources(f.directory)[0];
      if (point === 'after-worker-intent')
        assert.equal(source.workerIntent.request.allowanceMs, 60000);
      const view = (await f.controller.snapshot({ selected: id })).selected!;
      assert.equal(view.checks.length, delta < 0 ? 1 : 0);
      assert.equal(view.artifacts.length, 0);
    });

function journalBytes(directory: string) {
  const db = new DatabaseSync(join(directory, 'journal.sqlite'), { readOnly: true });
  try {
    return {
      meta: db.prepare('SELECT body,digest FROM meta').all(),
      runs: db.prepare('SELECT id,body,digest FROM runs ORDER BY id').all(),
    };
  } finally {
    db.close();
  }
}

test('controller expiry and reopening preserve canonical request and historical acceptance bytes', async (t) => {
  let now = 1000;
  let accepted!: FrozenBrowserAcceptance;
  let request!: AdmittedCheckRequest;
  let before!: ReturnType<typeof journalBytes>;
  let intentBytes = '';
  const f = await fixture(t, {
    clock: () => now,
    actionWakeup: () => () => {},
    offlineWorkerAcceptance: true,
    check: async (r, source) => {
      request = r;
      const originalNow = Date.now;
      Date.now = () => 5000;
      try {
        accepted = await source!.workerAcceptance!.accept();
      } finally {
        Date.now = originalNow;
      }
      before = journalBytes(f.journalDirectory);
      intentBytes = JSON.stringify(sources(f.directory)[0].workerIntent);
      now = r.deadlineAt;
      await assert.rejects(source!.workerAcceptance!.accept(), /check-allowance-exhausted/);
      return receipt(r.kind);
    },
  });
  const id = await f.add();
  const c = await f.parked(id);
  assert.equal(c.reason, 'check-allowance-exhausted');
  assert.equal(request.deadlineAt, 61000);
  assert.equal(accepted.acceptedAt, 5000);
  assert.equal(accepted.deadline, 65000);
  assert.equal(accepted.request.allowanceMs, 60000);
  assert.equal(JSON.stringify(sources(f.directory)[0].workerIntent), intentBytes);
  assert.deepEqual(journalBytes(f.journalDirectory), before);
  const association = await f.controller.inspectWorkerAssociation(id, request.actionId);
  assert.equal(association.state, 'matched');
  const view = (await f.controller.snapshot({ selected: id })).selected!;
  assert.equal(view.checks.length, 0);
  assert.equal(view.artifacts.length, 0);
  await f.close();
  await f.reopen();
  assert.deepEqual(await f.controller.inspectWorkerAssociation(id, request.actionId), association);
  assert.deepEqual(journalBytes(f.journalDirectory), before);
  assert.equal(JSON.stringify(sources(f.directory)[0].workerIntent), intentBytes);
});

test('unsafe nested action-source endpoint parks recovery without rewriting its JSON', async (t) => {
  let callbacks = 0;
  const f = await fixture(t, {
    clock: () => 1000,
    check: async () => {
      callbacks++;
      return { type: 'infrastructure' };
    },
  });
  const id = await f.add();
  await f.parked(id);
  await f.close();
  const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
  const row = db.prepare('SELECT action_id,value FROM action_sources').get()!;
  const source = JSON.parse(String(row.value));
  source.action.startedAt = Number.MAX_SAFE_INTEGER;
  const bytes = JSON.stringify(source);
  db.prepare('UPDATE action_sources SET value=? WHERE action_id=?').run(bytes, row.action_id);
  db.close();
  await f.reopen();
  const c = await f.parked(id);
  assert.equal(c.native, 'ready');
  assert.equal(c.reason, 'invalid-action-state');
  assert.equal(callbacks, 1);
  const reopened = new DatabaseSync(join(f.directory, 'catalogue.sqlite'), { readOnly: true });
  assert.equal(
    reopened.prepare('SELECT value FROM action_sources WHERE action_id=?').get(row.action_id)!
      .value,
    bytes,
  );
  assert.equal(
    JSON.parse(
      String(
        reopened.prepare('SELECT value FROM workspace_bindings WHERE case_id=?').get(id)!.value,
      ),
    ).state,
    'uncertain',
  );
  reopened.close();
});
