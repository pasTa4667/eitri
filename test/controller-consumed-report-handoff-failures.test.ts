import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { FrozenBrowserValidator } from '../src/frozen-browser.ts';
import type {
  FrozenBrowserConsumptionJournal,
  FrozenBrowserConsumedReport,
} from '../src/frozen-browser.ts';
import { NativeCase } from '../src/native.ts';
import { Controller } from '../src/controller.ts';
import type { OfflineActionWorkspace } from '../src/controller.ts';
import type { AdmittedCheckRequest, CheckCallbackResult } from '../src/domain.ts';
import { consumptionController } from './controller-worker-consumption-fixture.ts';
import { command, gate, journalRows, until } from './controller-worker-association-fixture.ts';

const consume = async (
  _r: AdmittedCheckRequest,
  source?: OfflineActionWorkspace,
): Promise<CheckCallbackResult> => {
  await source!.workerAcceptance!.accept();
  await source!.workerConsumption!.consume();
  return { type: 'consumed-browser' };
};

for (const failure of ['retention', 'close'] as const)
  test(
    `${failure} rejection remains sticky, releases the journal and is reported at shutdown`,
    { timeout: 30000 },
    async (t) => {
      const original = FrozenBrowserValidator.open;
      const retain = Reflect.get(Controller.prototype, 'retainWorkerExecutionFacts');
      if (failure === 'retention')
        Reflect.set(Controller.prototype, 'retainWorkerExecutionFacts', () => {
          throw Error('test-retention-failed');
        });
      t.after(() => Reflect.set(Controller.prototype, 'retainWorkerExecutionFacts', retain));
      let closes = 0,
        reads = 0;
      FrozenBrowserValidator.open = (async (
        options: Parameters<typeof original>[0] & { mode?: string },
      ) => {
        const journal = await original(options);
        if (options.mode !== 'consumption-only') return journal;
        const held = journal as unknown as FrozenBrowserConsumptionJournal;
        return {
          ...held,
          close: async () => {
            closes++;
            await held.close();
            if (failure === 'close') throw Error('test-close-failed');
          },
        };
      }) as typeof original;
      const originalRead = FrozenBrowserValidator.readConsumedReport;
      FrozenBrowserValidator.readConsumedReport = async (options) => {
        reads++;
        return originalRead.call(FrozenBrowserValidator, options);
      };
      t.after(() => {
        FrozenBrowserValidator.open = original;
        FrozenBrowserValidator.readConsumedReport = originalRead;
      });
      const f = await consumptionController(t, {
        check: async (r, source) => {
          if (failure === 'close') return consume(r, source);
          await source!.workerAcceptance!.accept();
          await assert.rejects(source!.workerConsumption!.consume(), /test-retention-failed/);
          await assert.rejects(source!.workerConsumption!.consume(), /test-retention-failed/);
          return { type: 'consumed-browser' };
        },
      });
      const id = await f.add();
      const parked = await f.parked(id);
      assert.equal(parked.reason, 'consumed-check-handoff-failed');
      assert.equal(reads, 0);
      assert.equal(closes, 1);
      const view = (await f.controller.snapshot({ selected: id })).selected!;
      assert.deepEqual(view.checks, []);
      assert.deepEqual(view.artifacts, []);
      await assert.rejects(f.close(), /worker-close-failed/);
      await assert.rejects(f.close(), /worker-close-failed/);
      await f.reopen();
      await f.close();
      assert.equal(journalRows(f.journalDirectory).meta.attempts, 1);
    },
  );

for (const malformed of [
  'pending',
  'recorded',
  'key',
  'role',
  'identity',
  'interval',
  'report',
] as const)
  test(
    `acquired ${malformed} history cannot become a behavioral receipt`,
    { timeout: 30000 },
    async (t) => {
      const original = FrozenBrowserValidator.readConsumedReport;
      FrozenBrowserValidator.readConsumedReport = async (options) => {
        const history = await original.call(FrozenBrowserValidator, options);
        if (malformed === 'pending' || malformed === 'recorded')
          return {
            state: malformed,
            consumedRun: history.consumedRun,
            admittedAt: history.admittedAt,
            deadline: history.deadline,
          };
        const value = structuredClone(history) as unknown as {
          consumedRun: { runId: string };
          admittedAt: number;
          report: {
            extra?: boolean;
            request: { role: string };
            evidence: { provenance: { configurationDigest: string } };
          };
        };
        if (malformed === 'key') value.consumedRun.runId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
        if (malformed === 'interval') value.admittedAt++;
        if (malformed === 'report') value.report.extra = true;
        if (malformed === 'role') value.report.request.role = 'candidate';
        if (malformed === 'identity')
          value.report.evidence.provenance.configurationDigest = 'f'.repeat(64);
        return value as unknown as FrozenBrowserConsumedReport;
      };
      t.after(() => {
        FrozenBrowserValidator.readConsumedReport = original;
      });
      const f = await consumptionController(t, { check: consume });
      const id = await f.add();
      const parked = await f.parked(id);
      assert.equal(
        parked.reason,
        malformed === 'pending' || malformed === 'recorded'
          ? 'consumed-check-not-settled'
          : 'tool-action-failed',
      );
      const view = (await f.controller.snapshot({ selected: id })).selected!;
      assert.deepEqual(view.checks, []);
      assert.deepEqual(view.artifacts, []);
      assert.equal(view.case.base, null);
      assert.equal(journalRows(f.journalDirectory).meta.attempts, 1);
    },
  );

test(
  'reacquisition contention fails closed and releases the workspace queue',
  { timeout: 30000 },
  async (t) => {
    const original = FrozenBrowserValidator.readConsumedReport;
    FrozenBrowserValidator.readConsumedReport = async (options) => {
      const other = await FrozenBrowserValidator.open({
        directory: options.directory,
        workspace: {} as never,
        mode: 'journal-only',
        expectedIdentity: options.expectedIdentity,
      });
      try {
        return await original.call(FrozenBrowserValidator, options);
      } finally {
        await other.close();
      }
    };
    t.after(() => {
      FrozenBrowserValidator.readConsumedReport = original;
    });
    const f = await consumptionController(t, { check: consume });
    const id = await f.add();
    const parked = await f.parked(id);
    assert.equal(parked.reason, 'validator-already-open');
    assert.equal(
      (
        await f.controller.inspectWorkerConsumedHistory(
          id,
          journalRows(f.journalDirectory).runs[0].acceptance.request.action.actionId,
        )
      ).state,
      'consumed',
    );
    const view = (await f.controller.snapshot({ selected: id })).selected!;
    assert.deepEqual(view.checks, []);
    assert.deepEqual(view.artifacts, []);
    await f.close();
  },
);

for (const race of ['pause', 'expire', 'shutdown'] as const)
  test(
    `native publication independently checks ${race} after controller handoff`,
    { timeout: 30000 },
    async (t) => {
      const entered = gate(),
        release = gate();
      t.after(() => release.resolve());
      let now = 1000;
      let request!: AdmittedCheckRequest;
      const original = NativeCase.prototype.recordConsumedBrowserCheck;
      NativeCase.prototype.recordConsumedBrowserCheck = async function (...args) {
        entered.resolve();
        await release.promise;
        return original.apply(this, args);
      };
      t.after(() => {
        NativeCase.prototype.recordConsumedBrowserCheck = original;
      });
      const f = await consumptionController(t, {
        clock: () => now,
        check: (r, source) => {
          request = r;
          return consume(r, source);
        },
      });
      const id = await f.add();
      await entered.promise;
      let closing: Promise<void> | undefined;
      if (race === 'pause') await f.controller.command(command({ type: 'pause', caseId: id }));
      else if (race === 'expire') now = request.deadlineAt;
      else closing = f.controller.close();
      release.resolve();
      if (closing) {
        await closing;
        await f.close();
        await f.reopen();
      }
      await until(
        async () => (await f.controller.snapshot()).cases[0],
        (c) => ['paused', 'needs-attention'].includes(c.status),
      );
      const view = (await f.controller.snapshot({ selected: id })).selected!;
      assert.equal(view.checks.length, race === 'pause' ? 1 : 0);
      assert.equal(view.artifacts.length, race === 'pause' ? 1 : 0);
      if (race === 'pause') {
        assert.equal(view.checks[0].simulated, false);
        assert.equal(view.case.status, 'paused');
      }
      assert.equal(journalRows(f.journalDirectory).meta.attempts, 1);
    },
  );

for (const mutation of ['missing-pins', 'wrong-key', 'failed-then-fulfilled'] as const)
  test(`controller cannot substitute history for ${mutation}`, { timeout: 30000 }, async (t) => {
    let f: Awaited<ReturnType<typeof consumptionController>>;
    f = await consumptionController(t, {
      check: async (r, source) => {
        if (mutation === 'failed-then-fulfilled')
          await assert.rejects(source!.workerConsumption!.consume(), /worker-acceptance-required/);
        await consume(r, source);
        if (mutation !== 'failed-then-fulfilled') {
          const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
          try {
            const row = db
              .prepare('SELECT value FROM action_sources WHERE action_id=?')
              .get(r.actionId)!;
            const selected = JSON.parse(String(row.value));
            if (mutation === 'missing-pins') delete selected.workerExecutionFacts;
            else
              selected.workerExecutionFacts.consumedRun.runId =
                'ffffffff-ffff-4fff-8fff-ffffffffffff';
            db.prepare('UPDATE action_sources SET value=? WHERE action_id=?').run(
              JSON.stringify(selected),
              r.actionId,
            );
          } finally {
            db.close();
          }
        }
        return { type: 'consumed-browser' };
      },
    });
    const id = await f.add();
    const parked = await f.parked(id);
    assert.equal(
      parked.reason,
      mutation === 'missing-pins'
        ? 'consumed-check-authority-unavailable'
        : mutation === 'wrong-key'
          ? 'consumed-check-consumption-mismatch'
          : 'consumed-check-consumption-required',
    );
    const view = (await f.controller.snapshot({ selected: id })).selected!;
    assert.deepEqual(view.checks, []);
    assert.deepEqual(view.artifacts, []);
    assert.equal(
      journalRows(f.journalDirectory).runs[0].execution.run.result.report.outcome.kind,
      'baseline-reproduced',
    );
  });

test(
  'simulated completion after consumption never acquires history',
  { timeout: 30000 },
  async (t) => {
    const original = FrozenBrowserValidator.readConsumedReport;
    FrozenBrowserValidator.readConsumedReport = async () => {
      throw Error('unexpected-history-read');
    };
    t.after(() => {
      FrozenBrowserValidator.readConsumedReport = original;
    });
    const f = await consumptionController(t, {
      check: async (r, source) => {
        await consume(r, source);
        return {
          type: 'completed',
          check: {
            kind: r.kind,
            candidate: source!.selection.revision,
            configuration: 'b'.repeat(64),
            passed: true,
            simulated: true,
            outputs: [],
          },
        };
      },
    });
    const id = await f.add();
    await f.parked(id);
    const view = (await f.controller.snapshot({ selected: id })).selected!;
    assert.equal(view.checks.length, 1);
    assert.equal(view.checks[0].simulated, true);
    assert.equal(view.checks[0].passed, true);
    assert.deepEqual(view.artifacts, []);
    assert.equal(journalRows(f.journalDirectory).meta.attempts, 1);
  },
);

test(
  'duplicate publication during the same run_check leaves exactly one receipt',
  { timeout: 30000 },
  async (t) => {
    const original = NativeCase.prototype.recordConsumedBrowserCheck;
    let duplicates = 0;
    NativeCase.prototype.recordConsumedBrowserCheck = async function (...args) {
      const result = await original.apply(this, args);
      assert.equal(result.type, 'recorded');
      await assert.rejects(original.apply(this, args), /duplicate-check-receipt/);
      duplicates++;
      return result;
    };
    t.after(() => {
      NativeCase.prototype.recordConsumedBrowserCheck = original;
    });
    const f = await consumptionController(t, { check: consume });
    const id = await f.add();
    await f.parked(id);
    const view = (await f.controller.snapshot({ selected: id })).selected!;
    assert.equal(duplicates, 1);
    assert.equal(view.checks.length, 1);
    assert.equal(view.checks[0].simulated, false);
    assert.equal(view.checks[0].passed, true);
    assert.equal(view.artifacts.length, 1);
  },
);

test('handoff without consumption configuration cannot publish', { timeout: 30000 }, async (t) => {
  const f = await consumptionController(t, {
    offlineWorkerConsumption: undefined,
    check: async () => ({ type: 'consumed-browser' }),
  });
  const id = await f.add();
  assert.equal((await f.parked(id)).reason, 'consumed-check-scope-required');
  assert.deepEqual((await f.controller.snapshot({ selected: id })).selected!.checks, []);
  assert.equal(journalRows(f.journalDirectory).meta.attempts, 0);
});
