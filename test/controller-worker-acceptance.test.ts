import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { once } from 'node:events';
import { fork } from 'node:child_process';
import { Controller } from '../src/controller.ts';
import type { OfflineActionWorkspace } from '../src/controller.ts';
import type { AdmittedCheckRequest } from '../src/domain.ts';
import { FrozenBrowserValidator } from '../src/frozen-browser.ts';
import type { FrozenBrowserAcceptanceJournal } from '../src/frozen-browser.ts';
import {
  fixture,
  gate,
  sources,
  journalRows,
  command,
  until,
  providerFor,
  investigate,
} from './controller-worker-association-fixture.ts';

for (const kind of ['baseline', 'browser'] as const)
  test(`${kind} explicitly accepts exact retained intent with detached concurrent retries but no check or artifact`, async (t) => {
    let request!: AdmittedCheckRequest;
    let scope!: OfflineActionWorkspace;
    let accepted;
    const f = await fixture(
      t,
      {
        clock: () => 1000,
        offlineWorkerAcceptance: true,
        check: async (r, source) => {
          request = r;
          scope = source!;
          assert.equal(Object.isFrozen(source), true);
          assert.equal(Object.isFrozen(source!.workerAcceptance), true);
          const before = (await f.controller.snapshot()).cases.find((c) => c.id === r.caseId)!;
          const results = await Promise.all([
            source!.workerAcceptance!.accept(),
            source!.workerAcceptance!.accept(),
          ]);
          assert.deepEqual(results[0], results[1]);
          const after = (await f.controller.snapshot()).cases.find((c) => c.id === r.caseId)!;
          assert.equal(after.remainingMs, before.remainingMs);
          assert.equal(after.usedMs, before.usedMs);
          accepted = structuredClone(results[0]);
          Object.assign(results[0].request.action, { epoch: 999 });
          assert.deepEqual(await source!.workerAcceptance!.accept(), accepted);
          return { type: 'infrastructure' };
        },
      },
      kind,
    );
    const id = await f.add();
    await f.parked(id);
    const association = await f.controller.inspectWorkerAssociation(id, request.actionId);
    assert.equal(association.state, 'matched');
    if (association.state !== 'matched' || association.run.state !== 'accepted')
      return assert.fail('acceptance missing');
    assert.deepEqual(association.run, {
      kind: 'offline-acceptance',
      state: 'accepted',
      ...accepted!,
    });
    assert.deepEqual(association.intent, sources(f.directory)[0].workerIntent);
    assert.deepEqual(association.run.request, association.intent.request);
    assert.equal(association.run.request.role, kind === 'baseline' ? 'baseline' : 'candidate');
    const view = (await f.controller.snapshot({ selected: id })).selected!;
    assert.deepEqual(view.checks, []);
    assert.deepEqual(view.artifacts, []);
    assert.equal(view.case.simulated, true);
    assert.equal(journalRows(f.journalDirectory).meta.attempts, 0);
    assert.equal(journalRows(f.journalDirectory).meta.contribution, 0);
    await assert.rejects(scope.workerAcceptance!.accept(), /action-source-revoked/);
    await f.close();
    await f.reopen();
    assert.deepEqual(
      await f.controller.inspectWorkerAssociation(id, request.actionId),
      association,
    );
  });

test('callback entry never automatically accepts and unsupported or disabled checks have no capability', async (t) => {
  for (const [enabled, kind] of [
    [true, 'unit'],
    [false, 'browser'],
    [true, 'browser'],
  ] as const)
    await t.test(`${enabled} ${kind}`, async (t) => {
      let scope!: OfflineActionWorkspace;
      const f = await fixture(
        t,
        {
          offlineWorkerAcceptance: enabled ? true : undefined,
          check: async (_r, source) => {
            scope = source!;
            return { type: 'infrastructure' };
          },
        },
        kind,
      );
      const id = await f.add();
      await f.parked(id);
      assert.equal('workerAcceptance' in scope, enabled && kind === 'browser');
      assert.deepEqual(journalRows(f.journalDirectory).runs, []);
      assert.equal(journalRows(f.journalDirectory).meta.version, 1);
    });
});

test('acceptance opt-in is absent or literal true with both prerequisites, snapshotted before awaits', async (t) => {
  const f = await fixture(t);
  await f.close();
  for (const value of [false, null, 0, 1, 'true', {}, Promise.resolve(true)]) {
    const options = { ...f.options };
    Reflect.set(options, 'offlineWorkerAcceptance', value);
    await assert.rejects(Controller.open(options), /invalid-offline-worker-acceptance/);
  }
  for (const change of [{ offlineWorkspace: undefined }, { offlineWorkerJournal: undefined }])
    await assert.rejects(
      Controller.open({ ...f.options, ...change, offlineWorkerAcceptance: true }),
      /offline-worker-acceptance-configuration-required/,
    );
  let controller!: Controller;
  let enabled = false;
  const options = {
    ...f.options,
    offlineWorkerAcceptance: true as const,
    providerForCase: providerFor(() => controller),
    check: async (_request: AdmittedCheckRequest, source?: OfflineActionWorkspace) => {
      enabled = source?.workerAcceptance !== undefined;
      return { type: 'infrastructure' as const };
    },
  };
  const opening = Controller.open(options);
  Reflect.set(options, 'offlineWorkerAcceptance', false);
  controller = await opening;
  try {
    const id = (await controller.command(investigate())).caseId!;
    await until(
      async () => (await controller.snapshot()).cases.find((c) => c.id === id)!,
      (c) => c.status === 'needs-attention',
    );
    assert.equal(enabled, true);
  } finally {
    await controller.close();
  }
});

function mutateCatalogue(
  directory: string,
  table: 'actions' | 'action_sources' | 'cases',
  change: (value: Record<string, unknown>) => void,
) {
  const db = new DatabaseSync(join(directory, 'catalogue.sqlite'));
  try {
    const row = db.prepare(`SELECT rowid,value FROM ${table} ORDER BY rowid DESC LIMIT 1`).get()!;
    const value = JSON.parse(String(row.value));
    change(value);
    db.prepare(`UPDATE ${table} SET value=? WHERE rowid=?`).run(
      JSON.stringify(value),
      row.rowid as number,
    );
  } finally {
    db.close();
  }
}

for (const revoke of [
  'pause',
  'allowance',
  'case-budget',
  'epoch',
  'delete-action',
  'mutate-action',
  'change-source',
  'settle',
  'close',
] as const)
  test(`authority revoked by ${revoke} during journal open cannot accept and close drains the operation`, async (t) => {
    const opened = gate();
    const release = gate();
    const entered = gate();
    const finish = gate();
    t.after(() => {
      release.resolve();
      finish.resolve();
    });
    const original = FrozenBrowserValidator.open;
    FrozenBrowserValidator.open = (async (
      options: Parameters<typeof original>[0] & { mode?: string },
    ) => {
      const journal = await Reflect.apply(original, FrozenBrowserValidator, [options]);
      if (options.mode === 'acceptance-only') {
        opened.resolve();
        await release.promise;
      }
      return journal;
    }) as typeof original;
    t.after(() => {
      FrozenBrowserValidator.open = original;
    });
    let now = 1000;
    let pending!: Promise<unknown>;
    let scope!: OfflineActionWorkspace;
    const f = await fixture(t, {
      clock: () => now,
      offlineWorkerAcceptance: true,
      check: async (_r, source) => {
        scope = source!;
        pending = source!.workerAcceptance!.accept();
        void pending.catch(() => {});
        entered.resolve();
        await finish.promise;
        return { type: 'infrastructure' };
      },
    });
    const id = await f.add();
    await entered.promise;
    await opened.promise;
    const savedSources = sources(f.directory);
    let closing: Promise<void> | undefined;
    let pausing: Promise<unknown> | undefined;
    if (revoke === 'pause') {
      pausing = f.controller.command(command({ type: 'pause', caseId: id }));
      await until(
        async () => (await f.controller.snapshot()).cases[0],
        (c) => c.status === 'pause-requested',
      );
    }
    if (revoke === 'allowance') now += 60000;
    if (revoke === 'case-budget')
      mutateCatalogue(f.directory, 'cases', (value) => {
        value.remainingMs = 0;
      });
    if (revoke === 'epoch')
      mutateCatalogue(f.directory, 'cases', (value) => {
        value.epoch = Number(value.epoch) + 1;
      });
    if (revoke === 'delete-action') {
      const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
      db.prepare('DELETE FROM actions WHERE case_id=?').run(id);
      db.close();
    }
    if (revoke === 'mutate-action')
      mutateCatalogue(f.directory, 'actions', (value) => {
        value.limitMs = Number(value.limitMs) - 1;
      });
    if (revoke === 'change-source')
      mutateCatalogue(f.directory, 'action_sources', (value) => {
        value.state = 'settled';
      });
    if (revoke === 'settle') {
      finish.resolve();
      await f.parked(id);
    }
    if (revoke === 'close') closing = f.close();
    release.resolve();
    await assert.rejects(
      pending,
      /action-source-revoked|check-dispatch-denied|check-allowance-exhausted|worker-acceptance-source-changed/,
    );
    if (revoke === 'epoch')
      mutateCatalogue(f.directory, 'cases', (value) => {
        value.epoch = savedSources[0].action.epoch;
      });
    finish.resolve();
    await pausing;
    if (closing) await closing;
    assert.equal(journalRows(f.journalDirectory).meta.version, 1);
    assert.deepEqual(journalRows(f.journalDirectory).runs, []);
    if (revoke === 'mutate-action' || revoke === 'delete-action' || revoke === 'change-source') {
      const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
      const source = savedSources[0];
      db.prepare(
        'INSERT INTO actions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      ).run(source.action.id, id, JSON.stringify(source.action));
      db.prepare('UPDATE action_sources SET value=? WHERE action_id=?').run(
        JSON.stringify(source),
        source.action.id,
      );
      db.close();
    }
    if (!closing)
      await until(
        async () => (await f.controller.snapshot()).cases[0],
        (c) => ['needs-attention', 'paused'].includes(c.status),
      );
    await assert.rejects(
      scope.workerAcceptance!.accept(),
      /action-source-revoked|controller-closed/,
    );
  });

test(
  'signal timeout during acceptance await rejects without accepting and Retry cannot revive old capability',
  { timeout: 10000 },
  async (t) => {
    const entered = gate();
    const release = gate();
    t.after(() => release.resolve());
    const original = FrozenBrowserValidator.open;
    FrozenBrowserValidator.open = (async (
      options: Parameters<typeof original>[0] & { mode?: string },
    ) => {
      const journal = await Reflect.apply(original, FrozenBrowserValidator, [options]);
      if (options.mode === 'acceptance-only') {
        entered.resolve();
        await release.promise;
      }
      return journal;
    }) as typeof original;
    t.after(() => {
      FrozenBrowserValidator.open = original;
    });
    let pending!: Promise<unknown>;
    let signal!: AbortSignal;
    let scope!: OfflineActionWorkspace;
    const f = await fixture(t, {
      allowanceMs: 1500,
      offlineWorkerAcceptance: true,
      check: async (r, source) => {
        signal = r.signal;
        scope = source!;
        pending = source!.workerAcceptance!.accept();
        void pending.catch(() => {});
        await pending;
        return { type: 'infrastructure' };
      },
    });
    const id = await f.add();
    await entered.promise;
    if (!signal.aborted) await once(signal, 'abort');
    release.resolve();
    await assert.rejects(
      pending,
      /action-source-revoked|check-dispatch-denied|check-cancelled|check-allowance-exhausted/,
    );
    const parked = await f.parked(id);
    f.options.check = async () => ({ type: 'infrastructure' });
    await f.controller.command(
      command({ type: 'retry', caseId: id, note: 'Explicit retry' }, parked.version),
    );
    await f.parked(id);
    await assert.rejects(scope.workerAcceptance!.accept(), /action-source-revoked/);
    assert.deepEqual(journalRows(f.journalDirectory).runs, []);
  },
);

test('the final synchronous guard denies revocation after candidate preparation and preserves a reusable journal', async (t) => {
  let now = 1000;
  let denied = false;
  const original = DatabaseSync.prototype.exec;
  const f = await fixture(t, {
    clock: () => now,
    offlineWorkerAcceptance: true,
    check: async (_r, source) => {
      DatabaseSync.prototype.exec = function (sql) {
        const result = Reflect.apply(original, this, [sql]);
        if (sql === 'BEGIN IMMEDIATE') now += 60000;
        return result;
      };
      try {
        await assert.rejects(source!.workerAcceptance!.accept(), /check-allowance-exhausted/);
        denied = true;
      } finally {
        DatabaseSync.prototype.exec = original;
      }
      return { type: 'infrastructure' };
    },
  });
  const id = await f.add();
  await f.parked(id);
  assert.equal(denied, true);
  assert.deepEqual(journalRows(f.journalDirectory).runs, []);
  assert.equal(journalRows(f.journalDirectory).meta.version, 1);
  const journal = await FrozenBrowserValidator.open({
    directory: f.journalDirectory,
    workspace: {} as never,
    mode: 'journal-only',
  });
  assert.equal((await journal.inventory()).attempts, 0);
  await journal.close();
});

test('revocation after COMMIT rejects delivery but leaves matched historical acceptance without native evidence', async (t) => {
  const original = FrozenBrowserValidator.open;
  let id = '';
  let actionId = '';
  let rejected = false;
  let f: Awaited<ReturnType<typeof fixture>>;
  FrozenBrowserValidator.open = (async (
    options: Parameters<typeof original>[0] & { mode?: string },
  ) => {
    const journal = await Reflect.apply(original, FrozenBrowserValidator, [options]);
    if (options.mode !== 'acceptance-only') return journal;
    const acceptance = journal as unknown as FrozenBrowserAcceptanceJournal;
    return Object.freeze({
      ...acceptance,
      accept: async (...args: Parameters<typeof acceptance.accept>) => {
        const result = await acceptance.accept(...args);
        void f.controller.command(command({ type: 'pause', caseId: id }));
        await until(
          async () => (await f.controller.snapshot()).cases[0],
          (c) => c.status === 'pause-requested',
        );
        return result;
      },
    });
  }) as typeof original;
  t.after(() => {
    FrozenBrowserValidator.open = original;
  });
  f = await fixture(t, {
    offlineWorkerAcceptance: true,
    check: async (r, source) => {
      id = r.caseId;
      actionId = r.actionId;
      await assert.rejects(source!.workerAcceptance!.accept(), /check-dispatch-denied/);
      rejected = true;
      return { type: 'infrastructure' };
    },
  });
  await f.add();
  await until(
    async () => (await f.controller.snapshot()).cases[0],
    (c) => c.status === 'paused',
  );
  assert.equal(rejected, true);
  const association = await f.controller.inspectWorkerAssociation(id, actionId);
  assert.equal(association.state, 'matched');
  if (association.state !== 'matched') return assert.fail('lost acceptance');
  assert.equal(association.run.state, 'accepted');
  const view = (await f.controller.snapshot({ selected: id })).selected!;
  assert.deepEqual(view.checks, []);
  assert.deepEqual(view.artifacts, []);
});

for (const point of ['before', 'after'] as const)
  test(
    `SIGKILL ${point} worker COMMIT recovers controller association without replay or new permission`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t);
      await f.close();
      const child = fork(
        new URL('./controller-worker-acceptance-crash-worker.ts', import.meta.url),
        [f.directory, JSON.stringify(f.options.offlineWorkerJournal), point],
        { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
      );
      let errors = '';
      child.stderr!.on('data', (b) => {
        errors += b;
      });
      t.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      });
      const message = await Promise.race([
        once(child, 'message').then(
          ([m]) => m as { id: string; actionId: string; callbacks: number },
        ),
        once(child, 'exit').then(() => {
          throw Error(errors);
        }),
      ]);
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      assert.deepEqual(await exited, [null, 'SIGKILL']);
      assert.equal(message.callbacks, 1);
      let callbacks = 0;
      f.options.check = async () => {
        callbacks++;
        return { type: 'infrastructure' };
      };
      const before = journalRows(f.journalDirectory);
      const intent = sources(f.directory)[0].workerIntent;
      await f.reopen();
      await f.parked(message.id);
      const association = await f.controller.inspectWorkerAssociation(message.id, message.actionId);
      assert.equal(association.state, point === 'after' ? 'matched' : 'absent');
      if (association.state === 'matched') {
        assert.equal(association.run.state, 'accepted');
        assert.deepEqual(association.intent, intent);
      }
      assert.equal(callbacks, 0);
      assert.deepEqual(journalRows(f.journalDirectory), before);
      const view = (await f.controller.snapshot({ selected: message.id })).selected!;
      assert.deepEqual(view.checks, []);
      assert.deepEqual(view.artifacts, []);
      assert.equal(view.case.status, 'needs-attention');
    },
  );
