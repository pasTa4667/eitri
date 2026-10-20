import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import type { FauxResponseStep } from '@earendil-works/pi-ai/providers/faux';
import { Controller } from '../src/controller.ts';
import { NativeCase } from '../src/native.ts';
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
        actionWakeup: scheduler().wakeup,
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
