import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import type { ConversationId, EntryDraft } from '@earendil-works/pi-durable';
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import type { FauxResponseStep } from '@earendil-works/pi-ai/providers/faux';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { AssistantMessageEventStream, AssistantMessageEvent } from '@earendil-works/pi-ai';
import { Controller } from '../src/controller.ts';
import { NativeCase } from '../src/native.ts';
import type { RuntimeHost } from '../src/native.ts';
import { actionDeadlineAt } from '../src/domain.ts';
import type { Action, Case } from '../src/domain.ts';

const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
const issue = {
  ...policy,
  id: 'deadline',
  title: 'Deadline',
  priority: 'high',
  status: 'unresolved',
  regressed: false,
  escalating: false,
} as const;
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const end = Date.now() + 5000;
  while (true) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() >= end) assert.fail(`Timed out ${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
function scheduler() {
  const wakes: { delay: number; callback: () => void; cancelled: boolean }[] = [];
  return {
    wakes,
    wakeup(delay: number, callback: () => void) {
      const wake = { delay, callback, cancelled: false };
      wakes.push(wake);
      return () => {
        wake.cancelled = true;
      };
    },
  };
}
const call = (name: string, args = {}) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' });
async function fixture(
  t: test.TestContext,
  extra: Partial<Parameters<typeof Controller.open>[0]>,
  responses: FauxResponseStep[],
) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-action-deadline-')));
  const faux = fauxProvider({ tokensPerSecond: 100000 });
  faux.setResponses(responses);
  const options = {
    directory,
    policy,
    providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
    ...extra,
  };
  let controller = await Controller.open(options);
  t.after(async () => {
    await controller.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    get controller() {
      return controller;
    },
    async restart(change: () => void) {
      await controller.close();
      change();
      controller = await Controller.open(options);
    },
    directory,
    faux,
    async add() {
      return (
        await controller.command({
          requestId: randomUUID(),
          intent: { type: 'investigate', issue },
        })
      ).caseId!;
    },
    async view(id: string) {
      return (await controller.snapshot({ selected: id })).selected!;
    },
    async parked(id: string) {
      return until(
        () => this.view(id),
        (v) => ['needs-attention', 'paused', 'terminal'].includes(v.case.status),
      );
    },
  };
}

for (const kind of ['model', 'tool'] as const)
  for (const offset of [75, 100])
    test(`${kind} delayed wakeup registration at ${offset} never renews the admitted endpoint`, async (t) => {
      let now = 1000;
      let entries = 0;
      const scheduled = scheduler();
      const entered = gate(),
        release = gate();
      t.after(() => release.resolve());
      let delayed = false;
      const f = await fixture(
        t,
        {
          clock: () => now,
          allowanceMs: 100,
          actionWakeup: (delay, callback) => {
            if (!delayed && (kind === 'model' || entries === 1)) {
              delayed = true;
              now += offset;
            }
            return scheduled.wakeup(delay, callback);
          },
          probe: async () => {
            entries++;
            entered.resolve();
            await release.promise;
            return 'Bounded tool';
          },
        },
        [
          async () => {
            entries++;
            if (kind === 'tool') return call('probe');
            entered.resolve();
            await release.promise;
            return fauxAssistantMessage('Bounded model');
          },
        ],
      );
      const id = await f.add();
      if (offset === 75) {
        await entered.promise;
        assert.equal(scheduled.wakes.at(-1)!.delay, 25);
        assert.equal(entries, kind === 'model' ? 1 : 2);
        now = 1100;
        scheduled.wakes.at(-1)!.callback();
      }
      const view = await f.parked(id);
      assert.equal(view.case.remainingMs, 0);
      assert.equal(view.case.usedMs, 100);
      assert.equal(entries, offset === 100 ? (kind === 'model' ? 0 : 1) : kind === 'model' ? 1 : 2);
      assert.equal(view.messages.filter((m) => m.kind === 'eitri.action-result').length, 0);
      const before = view.case;
      for (const wake of scheduled.wakes) {
        wake.callback();
        wake.callback();
      }
      assert.deepEqual((await f.view(id)).case, before);
    });

for (const kind of ['model', 'tool'] as const)
  for (const delta of [-1, 0, 1])
    test(`${kind} completion at D${delta < 0 ? delta : `+${delta}`} with withheld wakeups`, async (t) => {
      let now = 1000;
      const scheduled = scheduler();
      const f = await fixture(
        t,
        {
          clock: () => now,
          actionWakeup: scheduled.wakeup,
          probe: async () => {
            now = 61000 + delta;
            return 'Deadline result';
          },
        },
        kind === 'model'
          ? [
              async () => {
                now = 121000 + delta;
                return fauxAssistantMessage('Deadline result');
              },
            ]
          : [call('probe'), fauxAssistantMessage('Done')],
      );
      const id = await f.add();
      const view = await f.parked(id);
      assert.equal(
        view.case.reason,
        delta < 0 ? 'assessment-required' : `${kind}-action-timed-out`,
      );
      assert.equal(
        view.messages.filter((m) => m.kind === 'eitri.action-result').length,
        kind === 'tool' && delta < 0 ? 1 : 0,
      );
      assert.equal(f.faux.state.callCount, kind === 'tool' && delta < 0 ? 2 : 1);
      assert.equal(
        scheduled.wakes.every((w) => w.cancelled),
        true,
      );
    });

for (const kind of ['model', 'tool'] as const)
  test(`${kind} early wakeup rearms against controller time and old canceled delivery cannot affect Retry`, async (t) => {
    let now = 1000;
    const entered = gate(),
      release = gate();
    t.after(() => release.resolve());
    const scheduled = scheduler();
    const f = await fixture(
      t,
      {
        clock: () => now,
        allowanceMs: 100,
        actionWakeup: scheduled.wakeup,
        probe: async () => {
          entered.resolve();
          await release.promise;
          return 'old';
        },
      },
      [
        async () => {
          if (kind === 'tool') return call('probe');
          entered.resolve();
          await release.promise;
          return fauxAssistantMessage('old');
        },
        fauxAssistantMessage('new'),
      ],
    );
    const id = await f.add();
    await entered.promise;
    const early = scheduled.wakes.at(-1)!;
    early.callback();
    assert.equal(scheduled.wakes.at(-1)!.delay, 100);
    assert.equal((await f.view(id)).case.status, 'running');
    now = 1100;
    scheduled.wakes.at(-1)!.callback();
    const stopped = await f.parked(id);
    assert.equal(
      stopped.case.reason,
      kind === 'tool' ? 'tool-action-timed-out' : 'model-action-timed-out',
    );
    await f.controller.command({
      requestId: randomUUID(),
      expectedControlVersion: stopped.case.version,
      intent: { type: 'retry', caseId: id, note: 'Fresh bounded attempt' },
    });
    const newer = await until(
      () => f.view(id),
      (v) => v.case.attempt === 2 && v.case.status === 'needs-attention',
    );
    release.resolve();
    for (const wake of scheduled.wakes) wake.callback();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual((await f.view(id)).case, newer.case);
    assert.equal(newer.case.usedMs, 100);
    assert.equal(newer.case.remainingMs, 100);
  });

for (const conclusion of ['progress', 'no-fix'] as const)
  for (const expired of [false, true])
    test(`${conclusion} assessment ${expired ? 'denies expiry during metadata' : 'allows confirmed self-transition bookkeeping'}`, async (t) => {
      let now = 1000;
      const original = NativeCase.prototype.metadata;
      t.mock.method(NativeCase.prototype, 'metadata', async function (this: NativeCase) {
        const result = await original.call(this);
        if (expired && this.host.current().status === 'running') {
          const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'), { readOnly: true });
          try {
            const row = db
              .prepare('SELECT value FROM actions WHERE case_id=?')
              .get(this.host.current().id);
            const action: Action | undefined = row && JSON.parse(String(row.value));
            if (action?.kind === 'tool') now = action.startedAt + action.limitMs;
          } finally {
            db.close();
          }
        }
        return result;
      });
      const f = await fixture(t, { clock: () => now, actionWakeup: scheduler().wakeup }, [
        async () => {
          const c = (await f.controller.snapshot()).cases[0];
          return call('complete_assessment', {
            phase: c.phase,
            expectedControlVersion: c.version,
            conclusion,
            reason: 'Confirmed assessment',
            evidenceIds: [],
          });
        },
        fauxAssistantMessage('Next phase'),
      ]);
      const id = await f.add();
      const view = await f.parked(id);
      assert.equal(
        view.case.phase,
        !expired && conclusion === 'progress' ? 'investigation' : 'triage',
      );
      assert.equal(view.case.outcome, !expired && conclusion === 'no-fix' ? 'no-fix' : null);
      assert.equal(
        view.messages.filter((m) => m.kind === 'eitri.action-result').length,
        expired ? 0 : 1,
      );
      assert.equal(
        view.case.reason,
        expired
          ? 'tool-action-timed-out'
          : conclusion === 'no-fix'
            ? 'Confirmed assessment'
            : 'assessment-required',
      );
    });

for (const invalid of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, 999])
  test(`invalid or backward controller clock ${invalid} denies new effects`, async (t) => {
    let now = 1000;
    const f = await fixture(t, { clock: () => now, actionWakeup: scheduler().wakeup }, [
      fauxAssistantMessage('Done'),
    ]);
    const id = await f.add();
    await f.parked(id);
    now = invalid;
    await assert.rejects(
      f.controller.command({
        requestId: randomUUID(),
        expectedControlVersion: (await f.view(id)).case.version,
        intent: { type: 'dismiss', caseId: id, note: 'Invalid clock' },
      }),
      { code: 'invalid-clock' },
    );
    now = 1000;
    assert.equal((await f.view(id)).case.status, 'needs-attention');
  });

for (const transition of ['assessment', 'baseline-stop'] as const)
  test(`Retry supersedes confirmed ${transition} before old bookkeeping and retirement`, async (t) => {
    let now = 1000;
    const confirmed = gate(),
      release = gate();
    t.after(() => release.resolve());
    const scheduled = scheduler();
    if (transition === 'assessment') {
      const original = NativeCase.prototype.metadata;
      let wrapped = false;
      t.mock.method(NativeCase.prototype, 'metadata', async function (this: NativeCase) {
        if (!wrapped && this.host.current().status === 'running') {
          wrapped = true;
          const assess = this.host.assess;
          this.host.assess = async (...args) => {
            await assess(...args);
            confirmed.resolve();
            await release.promise;
          };
        }
        return original.call(this);
      });
    } else {
      const original = NativeCase.prototype.recordCheck;
      t.mock.method(
        NativeCase.prototype,
        'recordCheck',
        async function (this: NativeCase, ...args: Parameters<typeof original>) {
          const result = await original.apply(this, args);
          confirmed.resolve();
          await release.promise;
          return result;
        },
      );
    }
    const f = await fixture(
      t,
      {
        clock: () => now,
        actionWakeup: scheduled.wakeup,
        check: async ({ kind }) => ({
          type: 'completed',
          check: {
            kind,
            candidate: 'a'.repeat(40),
            configuration: 'b'.repeat(64),
            passed: false,
            simulated: true,
            outputs: [],
          },
        }),
      },
      [
        async () => {
          if (transition === 'baseline-stop') return call('run_check', { kind: 'baseline' });
          const c = (await f.controller.snapshot()).cases[0];
          return call('complete_assessment', {
            phase: c.phase,
            expectedControlVersion: c.version,
            conclusion: 'attention',
            reason: 'Explicit attention',
            evidenceIds: [],
          });
        },
        fauxAssistantMessage('New attempt'),
      ],
    );
    const id = await f.add();
    await confirmed.promise;
    const stopped = await f.parked(id);
    assert.equal(
      stopped.case.reason,
      transition === 'assessment' ? 'Explicit attention' : 'baseline-not-reproduced-or-changed',
    );
    await f.controller.command({
      requestId: randomUUID(),
      expectedControlVersion: stopped.case.version,
      intent: { type: 'retry', caseId: id, note: 'Supersede old cleanup' },
    });
    now = 1100;
    const queued = (await f.view(id)).case;
    assert.equal(queued.status, 'queued');
    assert.equal(queued.remainingMs, 600000);
    const oldWake = scheduled.wakes.at(-1)!;
    oldWake.callback();
    assert.deepEqual((await f.view(id)).case, queued);
    release.resolve();
    const newer = await until(
      () => f.view(id),
      (v) => v.case.attempt === 2 && v.case.status === 'needs-attention',
    );
    assert.equal(newer.case.reason, 'assessment-required');
    assert.equal(newer.case.remainingMs, 600000);
    assert.equal(newer.case.usedMs, 0);
    assert.equal(newer.messages.filter((m) => m.kind === 'eitri.action-result').length, 0);
    assert.equal(f.faux.state.callCount, 2);
    oldWake.callback();
    assert.deepEqual((await f.view(id)).case, newer.case);
  });

for (const retry of [false, true])
  test(`queued action-result admission ${retry ? 'rejects persisted Retry revocation' : 'preserves confirmed completion without Retry'}`, async (t) => {
    const blocked = gate(),
      queued = gate(),
      release = gate(),
      retried = gate();
    t.after(() => release.resolve());
    let retryArmed = false;
    let actionId = '';
    let barrier: Promise<void> | undefined;
    let native!: Pick<NativeCase, 'root' | 'host'>;
    const original = NativeCase.prototype.metadata;
    let wrapped = false;
    t.mock.method(NativeCase.prototype, 'metadata', async function (this: NativeCase) {
      if (!wrapped) {
        wrapped = true;
        const mayRecordCompletion = this.host.mayRecordCompletion;
        this.host.mayRecordCompletion = (action) => {
          const confirmed = mayRecordCompletion(action);
          if (confirmed && !actionId) {
            native = { root: this.root, host: this.host };
            actionId = action.id;
            barrier = this.root.commit(async () => {
              blocked.resolve();
              await release.promise;
            }, context);
            queueMicrotask(() => queued.resolve());
          }
          return confirmed;
        };
      }
      return original.call(this);
    });
    const f = await fixture(
      t,
      {
        clock: () => 1000,
        actionWakeup: scheduler().wakeup,
        fault: (point) => {
          if (retryArmed && point === 'after-command-commit') retried.resolve();
        },
      },
      [
        async () => {
          const c = (await f.controller.snapshot()).cases[0];
          return call('complete_assessment', {
            phase: c.phase,
            expectedControlVersion: c.version,
            conclusion: 'attention',
            reason: 'Confirmed before native admission',
            evidenceIds: [],
          });
        },
        fauxAssistantMessage('New attempt'),
      ],
    );
    const id = await f.add();
    await queued.promise;
    await blocked.promise;
    assert.equal(native.host.current().reason, 'Confirmed before native admission');
    const durableResults = () => {
      const db = new DatabaseSync(join(f.directory, 'cases', id, 'session.sqlite'), {
        readOnly: true,
      });
      try {
        return db
          .prepare(
            "SELECT record FROM entries WHERE json_extract(record, '$.kind')='eitri.action-result'",
          )
          .all()
          .map((row) => JSON.parse(String(row.record)));
      } finally {
        db.close();
      }
    };
    assert.deepEqual(durableResults(), []);
    let retryCommand: Promise<unknown> | undefined;
    if (retry) {
      retryArmed = true;
      retryCommand = f.controller.command({
        requestId: randomUUID(),
        expectedControlVersion: native.host.current().version,
        intent: { type: 'retry', caseId: id, note: 'Revoke queued old result' },
      });
      await retried.promise;
      const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'), { readOnly: true });
      try {
        const c: Case = JSON.parse(
          String(db.prepare('SELECT value FROM cases WHERE id=?').get(id)!.value),
        );
        assert.equal(c.status, 'queued');
        assert.equal(c.attempt, 2);
        assert.equal(c.usedMs, 0);
        assert.equal(c.remainingMs, 600000);
      } finally {
        db.close();
      }
    }
    release.resolve();
    await barrier;
    await retryCommand;
    const view = await until(
      () => f.view(id),
      (v) =>
        v.case.status === 'needs-attention' &&
        (retry
          ? v.case.attempt === 2 && v.case.reason === 'assessment-required'
          : v.messages.some((m) => m.kind === 'eitri.action-result')),
    );
    assert.equal(
      view.case.reason,
      retry ? 'assessment-required' : 'Confirmed before native admission',
    );
    assert.equal(view.case.usedMs, 0);
    assert.equal(view.case.remainingMs, 600000);
    assert.deepEqual(
      durableResults().map((entry) => entry.data.payload),
      retry ? [] : [{ actionId, result: null }],
    );
    assert.equal(f.faux.state.callCount, retry ? 2 : 1);
    if (!retry) {
      const entry = durableResults()[0];
      assert.equal(typeof entry.data.timestamp, 'number');
      const draft = {
        type: 'write' as const,
        requestId: `action-result-${actionId}`,
        entry: { kind: 'eitri.action-result', data: { payload: 'Must not replace result' } },
      };
      const replay = await native.root.submit(draft, context);
      assert.deepEqual(await replay.status(context), {
        id: replay.id,
        conversationId: native.root.id,
        requestId: draft.requestId,
        type: 'write',
        status: 'done',
        entry: entry.id,
      });
      assert.equal((await native.root.submit(draft, context)).id, replay.id);
      assert.deepEqual(durableResults(), [entry]);
    }
  });

for (const retry of [false, true])
  test(`staged action-result transaction ${retry ? 'rolls back after persisted Retry' : 'commits without Retry'}`, async (t) => {
    const staged = gate(),
      release = gate(),
      retried = gate();
    t.after(() => release.resolve());
    let retryArmed = false;
    let actionId = '';
    let wrapped = false;
    const metadata = NativeCase.prototype.metadata;
    t.mock.method(NativeCase.prototype, 'metadata', async function (this: NativeCase) {
      if (!wrapped) {
        wrapped = true;
        const commit = this.root.commit.bind(this.root);
        t.mock.method(this.root, 'commit', (...[change, ctx]: Parameters<typeof commit>) =>
          commit(async (tx) => {
            const appendEntry = tx.appendEntry.bind(tx);
            t.mock.method(
              tx,
              'appendEntry',
              async (conversationId: ConversationId, draft: EntryDraft) => {
                const entry = await appendEntry(conversationId, draft);
                if (draft.kind === 'eitri.action-result') {
                  actionId = (draft.data as { payload: { actionId: string } }).payload.actionId;
                  staged.resolve();
                  await release.promise;
                }
                return entry;
              },
            );
            return change(tx);
          }, ctx),
        );
      }
      return metadata.call(this);
    });
    const f = await fixture(
      t,
      {
        clock: () => 1000,
        actionWakeup: scheduler().wakeup,
        fault: (point) => {
          if (retryArmed && point === 'after-command-commit') retried.resolve();
        },
      },
      [
        async () => {
          const c = (await f.controller.snapshot()).cases[0];
          return call('complete_assessment', {
            phase: c.phase,
            expectedControlVersion: c.version,
            conclusion: 'attention',
            reason: 'Confirmed before staged result',
            evidenceIds: [],
          });
        },
        fauxAssistantMessage('New attempt'),
      ],
    );
    const id = await f.add();
    await staged.promise;
    const records = () => {
      const db = new DatabaseSync(join(f.directory, 'cases', id, 'session.sqlite'), {
        readOnly: true,
      });
      try {
        return {
          entries: db
            .prepare(
              "SELECT record FROM entries WHERE json_extract(record, '$.kind')='eitri.action-result'",
            )
            .all()
            .map((row) => JSON.parse(String(row.record)).data.payload),
          submissions: db
            .prepare("SELECT record FROM submissions WHERE json_extract(record, '$.requestId')=?")
            .all(`action-result-${actionId}`)
            .map((row) => JSON.parse(String(row.record)).status),
        };
      } finally {
        db.close();
      }
    };
    assert.deepEqual(records(), { entries: [], submissions: [] });
    const stopped = (await f.controller.snapshot()).cases[0];
    assert.equal(stopped.reason, 'Confirmed before staged result');
    let retryCommand: Promise<unknown> | undefined;
    if (retry) {
      retryArmed = true;
      retryCommand = f.controller.command({
        requestId: randomUUID(),
        expectedControlVersion: stopped.version,
        intent: { type: 'retry', caseId: id, note: 'Revoke staged result before native commit' },
      });
      await retried.promise;
      const newer = (await f.controller.snapshot()).cases[0];
      assert.equal(newer.attempt, 2);
      assert.equal(newer.status, 'queued');
    }
    release.resolve();
    await retryCommand;
    const view = await until(
      () => f.view(id),
      (v) =>
        v.case.status === 'needs-attention' &&
        (retry
          ? v.case.attempt === 2 && v.case.reason === 'assessment-required'
          : v.messages.some((m) => m.kind === 'eitri.action-result')),
    );
    assert.deepEqual(
      records(),
      retry
        ? { entries: [], submissions: [] }
        : {
            entries: [{ actionId, result: null }],
            submissions: ['done'],
          },
    );
    assert.equal(view.case.usedMs, 0);
    assert.equal(view.case.remainingMs, 600000);
    assert.equal(f.faux.state.callCount, retry ? 2 : 1);
  });

for (const kind of ['model', 'tool'] as const)
  for (const delta of [-1, 0, 1])
    test(`${kind} final retirement sample at D${delta < 0 ? delta : `+${delta}`} rejects late success`, async (t) => {
      let now = 1000;
      const original = NativeCase.prototype.metadata;
      let wrapped = false;
      t.mock.method(NativeCase.prototype, 'metadata', async function (this: NativeCase) {
        if (!wrapped) {
          wrapped = true;
          const finish = this.host.finish;
          this.host.finish = (action, ...args) => {
            if (action.kind === kind) now = action.startedAt + action.limitMs + delta;
            return finish(action, ...args);
          };
        }
        return original.call(this);
      });
      const f = await fixture(
        t,
        {
          clock: () => now,
          actionWakeup: scheduler().wakeup,
          probe: async () => 'Admitted result',
        },
        kind === 'model'
          ? [fauxAssistantMessage('Terminal result')]
          : [call('probe'), fauxAssistantMessage('Done')],
      );
      const id = await f.add();
      const view = await f.parked(id);
      assert.equal(
        view.case.reason,
        delta < 0 ? 'assessment-required' : `${kind}-action-timed-out`,
      );
      assert.equal(f.faux.state.callCount, kind === 'tool' && delta < 0 ? 2 : 1);
    });

test('derived action endpoint validates safe integer addition without changing the persisted tuple', () => {
  assert.equal(actionDeadlineAt({ startedAt: 1250, limitMs: 60000 }), 61250);
  assert.equal(
    actionDeadlineAt({ startedAt: Number.MAX_SAFE_INTEGER - 100, limitMs: 100 }),
    Number.MAX_SAFE_INTEGER,
  );
  for (const action of [
    { startedAt: -1, limitMs: 1 },
    { startedAt: 0.5, limitMs: 1 },
    { startedAt: 1000, limitMs: 0 },
    { startedAt: 1000, limitMs: 1.5 },
    { startedAt: Number.MAX_SAFE_INTEGER, limitMs: 1 },
  ])
    assert.throws(() => actionDeadlineAt(action), { code: 'invalid-action-state' });
});

for (const advancing of [false, true])
  for (const allowanceMs of [200, 600000])
    test(`admission uses one charge/start sample with ${allowanceMs} case allowance and ${advancing ? 'advancing' : 'fixed'} clock`, async (t) => {
      let now = 1000;
      const admitted: { action: Action; c: Case }[] = [];
      const original = NativeCase.prototype.metadata;
      let wrapped = false;
      t.mock.method(NativeCase.prototype, 'metadata', async function (this: NativeCase) {
        if (!wrapped) {
          wrapped = true;
          const admit = this.host.admit;
          this.host.admit = (...args) => {
            const action = admit(...args);
            admitted.push({ action, c: this.host.current() });
            return action;
          };
        }
        return original.call(this);
      });
      const f = await fixture(
        t,
        {
          clock: () => (advancing ? now++ : now),
          allowanceMs,
          actionWakeup: scheduler().wakeup,
          probe: async () => 'One bounded operation',
        },
        [call('probe'), fauxAssistantMessage('Done')],
      );
      const id = await f.add();
      await f.parked(id);
      assert.deepEqual(
        admitted.map(({ action }) => action.kind),
        ['model', 'tool', 'model'],
      );
      for (const { action, c } of admitted) {
        assert.equal(action.startedAt, c.accountedAt);
        assert.equal(action.usedAtStart, c.usedMs);
        assert.equal(
          action.limitMs,
          Math.min(action.kind === 'model' ? 120000 : 60000, c.remainingMs),
        );
        assert.equal(c.usedMs + c.remainingMs, allowanceMs);
      }
      if (!advancing)
        assert.deepEqual(
          admitted.map(({ action }) => action.limitMs),
          allowanceMs === 200 ? [200, 200, 200] : [120000, 60000, 120000],
        );
    });

for (const kind of ['model', 'tool'] as const)
  for (const reopenedAt of [500, 61000, 999999])
    test(`legacy ${kind} action conservatively recovers at ${reopenedAt} without reconstructing a lifetime`, async (t) => {
      let now = 1000;
      const f = await fixture(t, { clock: () => now, actionWakeup: scheduler().wakeup }, [
        fauxAssistantMessage('Parked'),
      ]);
      const id = await f.add();
      await f.parked(id);
      let actionBytes = '';
      await f.restart(() => {
        const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
        try {
          const c: Case = JSON.parse(
            String(db.prepare('SELECT value FROM cases WHERE id=?').get(id)!.value),
          );
          Object.assign(c, {
            status: 'pause-requested',
            epoch: 10,
            usedMs: 250,
            remainingMs: 599750,
            accountedAt: 1250,
          });
          const action: Action = {
            id: randomUUID(),
            caseId: id,
            epoch: 10,
            kind,
            startedAt: 1000,
            limitMs: kind === 'model' ? 120000 : 60000,
            usedAtStart: 200,
          };
          actionBytes = JSON.stringify(action);
          db.prepare('UPDATE cases SET value=? WHERE id=?').run(JSON.stringify(c), id);
          db.prepare('INSERT INTO actions VALUES(?,?,?)').run(action.id, id, actionBytes);
        } finally {
          db.close();
        }
        now = reopenedAt;
      });
      const c = (await f.view(id)).case;
      assert.equal(c.status, 'paused');
      assert.equal(c.native, 'ready');
      assert.equal(c.epoch, 11);
      assert.equal(c.usedMs, kind === 'model' ? 120200 : 60200);
      assert.equal(c.remainingMs, kind === 'model' ? 479800 : 539800);
      assert.equal(c.accountedAt, null);
      assert.equal(f.faux.state.callCount, 1);
      const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'), { readOnly: true });
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM actions').get()!.n, 0);
      db.close();
      assert.equal(JSON.parse(actionBytes).startedAt, 1000);
    });

test('unsafe recovered endpoint fails closed without replay or rewriting the legacy action', async (t) => {
  const f = await fixture(t, { clock: () => 1000, actionWakeup: scheduler().wakeup }, [
    fauxAssistantMessage('Parked'),
  ]);
  const id = await f.add();
  await f.parked(id);
  let bytes = '';
  await f.restart(() => {
    const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
    const c = JSON.parse(String(db.prepare('SELECT value FROM cases WHERE id=?').get(id)!.value));
    const action: Action = {
      id: randomUUID(),
      caseId: id,
      epoch: c.epoch,
      kind: 'tool',
      startedAt: Number.MAX_SAFE_INTEGER,
      limitMs: 60000,
      usedAtStart: 0,
    };
    bytes = JSON.stringify(action);
    db.prepare('INSERT INTO actions VALUES(?,?,?)').run(action.id, id, bytes);
    db.close();
  });
  const c = (await f.controller.snapshot()).cases[0];
  assert.equal(c.status, 'needs-attention');
  assert.equal(c.native, 'missing');
  assert.equal(c.reason, 'invalid-action-state');
  assert.equal(f.faux.state.callCount, 1);
  const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'), { readOnly: true });
  assert.equal(db.prepare('SELECT value FROM actions WHERE case_id=?').get(id)!.value, bytes);
  db.close();
});

for (const delta of [-1, 0, 1])
  test(`provider permission at D${delta < 0 ? delta : `+${delta}`} is checked after native setup`, async (t) => {
    let now = 1000;
    const original = NativeCase.prototype.metadata;
    let wrapped = false;
    t.mock.method(NativeCase.prototype, 'metadata', async function (this: NativeCase) {
      if (!wrapped) {
        wrapped = true;
        const permit = this.host.permit;
        this.host.permit = (action) => {
          now = action!.startedAt + action!.limitMs + delta;
          permit(action);
        };
      }
      return original.call(this);
    });
    const f = await fixture(t, { clock: () => now, actionWakeup: scheduler().wakeup }, [
      fauxAssistantMessage('Provider result'),
    ]);
    const id = await f.add();
    const view = await f.parked(id);
    assert.equal(view.case.reason, delta < 0 ? 'assessment-required' : 'model-action-timed-out');
    assert.equal(f.faux.state.callCount, delta < 0 ? 1 : 0);
  });

test('run_check invalid-clock subprocess detects deferred abort exceptions and hanging interruption controls', () => {
  const helper = fileURLToPath(
    new URL('./helpers/action-deadline-invalid-clock.ts', import.meta.url),
  );
  const run = (mode: string, timeout = 10000) =>
    spawnSync(process.execPath, [helper, mode], {
      encoding: 'utf8',
      timeout,
      env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    });
  const uncaught = run('uncaught-control');
  assert.equal(uncaught.error, undefined);
  assert.equal(uncaught.status, 1);
  assert.match(uncaught.stderr, /deferred-abort-positive-control/);
  const hanging = run('hang-control', 1000);
  assert.equal((hanging.error as NodeJS.ErrnoException).code, 'ETIMEDOUT');
  assert.match(hanging.stdout, /hanging-interruption-positive-control/);
  const actual = run('run-check');
  assert.equal(actual.error, undefined);
  assert.equal(actual.signal, null);
  assert.equal(actual.status, 0, actual.stdout + actual.stderr);
  assert.match(actual.stdout, /interruption settled with persistently invalid clock/);
});

for (const kind of ['model', 'tool'] as const)
  test(`${kind} asynchronous wakeup sampling errors abort only that lifetime`, async (t) => {
    let now = 1000;
    const entered = gate(),
      release = gate();
    t.after(() => release.resolve());
    const scheduled = scheduler();
    const f = await fixture(
      t,
      {
        clock: () => now,
        actionWakeup: scheduled.wakeup,
        probe: async () => {
          entered.resolve();
          await release.promise;
          return 'late';
        },
      },
      [
        async () => {
          if (kind === 'tool') return call('probe');
          entered.resolve();
          await release.promise;
          return fauxAssistantMessage('late');
        },
      ],
    );
    const id = await f.add();
    await entered.promise;
    now = -1;
    assert.doesNotThrow(() => scheduled.wakes.at(-1)!.callback());
    now = 1000;
    const stopped = await f.parked(id);
    assert.equal(stopped.case.reason, `${kind}-action-timed-out`);
    assert.equal(stopped.case.usedMs, 0);
    assert.equal(stopped.case.remainingMs, 600000);
    const count = scheduled.wakes.length;
    for (const wake of scheduled.wakes) wake.callback();
    assert.equal(scheduled.wakes.length, count);
  });

for (const revoke of ['deadline', 'epoch'] as const)
  test(`model receipt notification follows terminal publication before ${revoke} revocation`, async (t) => {
    let now = 1000;
    const terminals: string[] = [];
    let atReceipt: string[] = [];
    const prototype = Object.getPrototypeOf(
      createAssistantMessageEventStream(),
    ) as AssistantMessageEventStream;
    const push = prototype.push;
    t.mock.method(
      prototype,
      'push',
      function (this: AssistantMessageEventStream, event: AssistantMessageEvent) {
        if (event.type === 'done')
          terminals.push(
            event.message.content.map((c) => (c.type === 'text' ? c.text : c.type)).join(''),
          );
        if (event.type === 'error') terminals.push('controlled-error');
        return push.call(this, event);
      },
    );
    const f = await fixture(
      t,
      {
        clock: () => now,
        actionWakeup: scheduler().wakeup,
        fault: (point, id) => {
          if (point !== 'after-model-action-receipt') return;
          atReceipt = [...terminals];
          if (revoke === 'deadline') now = 121000;
          else {
            const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
            const c = JSON.parse(
              String(db.prepare('SELECT value FROM cases WHERE id=?').get(id)!.value),
            );
            Object.assign(c, {
              epoch: c.epoch + 1,
              status: 'needs-attention',
              accountedAt: null,
              reason: 'Revoked after publication',
            });
            db.prepare('UPDATE cases SET value=? WHERE id=?').run(JSON.stringify(c), id);
            db.close();
          }
        },
      },
      [fauxAssistantMessage('Publication result')],
    );
    const id = await f.add();
    const view = await f.parked(id);
    assert.deepEqual(atReceipt, ['Publication result', 'Publication result', 'Publication result']);
    assert.deepEqual(terminals, ['Publication result', 'Publication result', 'Publication result']);
    assert.equal(
      view.case.reason,
      revoke === 'deadline' ? 'assessment-required' : 'Revoked after publication',
    );
    assert.equal(f.faux.state.callCount, 1);
  });

for (const field of [
  'id',
  'caseId',
  'epoch',
  'kind',
  'startedAt',
  'limitMs',
  'usedAtStart',
  'case-epoch',
] as const)
  test(`${field} mismatch denies permission, sampling, stop and finish before charging`, async (t) => {
    let now = 1000;
    const entered = gate(),
      release = gate();
    t.after(() => release.resolve());
    let host!: RuntimeHost;
    let action!: Action;
    let callbacks = 0;
    const original = NativeCase.prototype.metadata;
    let wrapped = false;
    t.mock.method(NativeCase.prototype, 'metadata', async function (this: NativeCase) {
      if (!wrapped) {
        wrapped = true;
        host = this.host;
        const admit = host.admit;
        host.admit = (...args) => {
          const result = admit(...args);
          if (result.kind === 'tool') action = result;
          return result;
        };
      }
      return original.call(this);
    });
    const f = await fixture(
      t,
      {
        clock: () => now,
        actionWakeup: scheduler().wakeup,
        check: async () => {
          callbacks++;
          entered.resolve();
          await release.promise;
          return { type: 'infrastructure' };
        },
      },
      [call('run_check', { kind: 'browser' })],
    );
    const id = await f.add();
    await entered.promise;
    const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
    const originalCase = host.current();
    const changedAction = { ...action };
    if (field === 'case-epoch') {
      db.prepare('UPDATE cases SET value=? WHERE id=?').run(
        JSON.stringify({ ...originalCase, epoch: originalCase.epoch + 1 }),
        id,
      );
    } else {
      Reflect.set(
        changedAction,
        field,
        typeof action[field] === 'number'
          ? Number(action[field]) + 1
          : field === 'kind'
            ? 'model'
            : randomUUID(),
      );
      db.prepare('UPDATE actions SET value=? WHERE id=?').run(
        JSON.stringify(changedAction),
        action.id,
      );
    }
    const before = host.current();
    now = 1075;
    assert.throws(() => host.permit(action), { code: 'check-dispatch-denied' });
    assert.throws(() => host.remaining(action), { code: 'check-dispatch-denied' });
    assert.throws(() => host.validateCheckAction(action), { code: 'check-dispatch-denied' });
    assert.deepEqual(await host.check(action, 'browser', new AbortController().signal), {
      type: 'uncertain',
    });
    host.finish(action, true, true);
    assert.deepEqual(host.current(), before);
    assert.equal(host.current().usedMs, 0);
    assert.equal(host.current().remainingMs, 600000);
    assert.equal(callbacks, 1);
    const row = db.prepare('SELECT value FROM actions WHERE id=?').get(action.id);
    if (field === 'case-epoch') assert.equal(row, undefined);
    else assert.equal(row!.value, JSON.stringify(changedAction));
    db.prepare(
      'INSERT INTO actions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
    ).run(action.id, id, JSON.stringify(action));
    db.prepare('UPDATE cases SET value=? WHERE id=?').run(JSON.stringify(originalCase), id);
    db.close();
    release.resolve();
    const view = await f.parked(id);
    assert.equal(view.case.reason, 'check-infrastructure');
    assert.equal(view.case.usedMs, 75);
  });

for (const transition of ['progress', 'no-fix', 'baseline-stop'] as const)
  test(`confirmed ${transition} cancels its execution wakeup while only bookkeeping remains`, async (t) => {
    let now = 1000;
    const confirmed = gate(),
      release = gate(),
      retired = gate();
    t.after(() => release.resolve());
    const scheduled = scheduler();
    if (transition === 'baseline-stop') {
      const original = NativeCase.prototype.recordCheck;
      t.mock.method(
        NativeCase.prototype,
        'recordCheck',
        async function (this: NativeCase, ...args: Parameters<typeof original>) {
          const result = await original.apply(this, args);
          confirmed.resolve();
          await release.promise;
          return result;
        },
      );
    } else {
      const original = NativeCase.prototype.metadata;
      let wrapped = false;
      t.mock.method(NativeCase.prototype, 'metadata', async function (this: NativeCase) {
        if (!wrapped) {
          wrapped = true;
          const assess = this.host.assess;
          this.host.assess = async (...args) => {
            await assess(...args);
            confirmed.resolve();
            await release.promise;
          };
        }
        return original.call(this);
      });
    }
    const f = await fixture(
      t,
      {
        clock: () => now,
        actionWakeup: scheduled.wakeup,
        fault: (point) => {
          if (point === 'after-tool-action-receipt') retired.resolve();
        },
        check: async ({ kind }) => ({
          type: 'completed',
          check: {
            kind,
            candidate: 'a'.repeat(40),
            configuration: 'b'.repeat(64),
            passed: false,
            simulated: true,
            outputs: [],
          },
        }),
      },
      [
        async () => {
          if (transition === 'baseline-stop') return call('run_check', { kind: 'baseline' });
          const c = (await f.controller.snapshot()).cases[0];
          return call('complete_assessment', {
            phase: c.phase,
            expectedControlVersion: c.version,
            conclusion: transition,
            reason: 'Confirmed before expiry',
            evidenceIds: [],
          });
        },
        fauxAssistantMessage('Next phase'),
      ],
    );
    const id = await f.add();
    await confirmed.promise;
    now = 61000;
    const wake = scheduled.wakes.at(-1)!;
    const wakeCount = scheduled.wakes.length;
    wake.callback();
    assert.equal(wake.cancelled, true);
    assert.equal(scheduled.wakes.length, wakeCount);
    wake.callback();
    assert.equal(scheduled.wakes.length, wakeCount);
    release.resolve();
    await retired.promise;
    const view = await f.parked(id);
    assert.equal(wake.cancelled, true);
    assert.equal(view.messages.filter((m) => m.kind === 'eitri.action-result').length, 1);
    assert.equal(view.case.usedMs, 0);
    assert.equal(view.case.remainingMs, 600000);
    assert.equal(view.case.phase, transition === 'progress' ? 'investigation' : 'triage');
    assert.equal(view.case.outcome, transition === 'no-fix' ? 'no-fix' : null);
    assert.equal(f.faux.state.callCount, transition === 'progress' ? 2 : 1);
  });
