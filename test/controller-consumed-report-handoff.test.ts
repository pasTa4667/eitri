import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import type { FauxResponseStep } from '@earendil-works/pi-ai/providers/faux';
import { FrozenBrowserValidator } from '../src/frozen-browser.ts';
import type { FrozenBrowserConsumptionJournal } from '../src/frozen-browser.ts';
import type { AdmittedCheckRequest, CheckCallbackResult } from '../src/domain.ts';
import type { OfflineActionWorkspace } from '../src/controller.ts';
import { consumptionController, gateClient } from './controller-worker-consumption-fixture.ts';
import {
  command,
  gate,
  sources,
  journalRows,
  until,
} from './controller-worker-association-fixture.ts';

const png = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c6360000200000500017a5eab3f0000000049454e44ae426082',
  'hex',
);
const consume = async (
  _request: AdmittedCheckRequest,
  source?: OfflineActionWorkspace,
): Promise<CheckCallbackResult> => {
  await source!.workerAcceptance!.accept();
  await source!.workerConsumption!.consume();
  return { type: 'consumed-browser' };
};

async function scriptLiteral(root: string, literal: 'A' | 'B') {
  const path = join(root, 'transcript.mjs');
  const script = await readFile(path, 'utf8');
  await writeFile(path, script.replace("literal:'A'", `literal:'${literal}'`));
}

function holdRead(t: TestContext) {
  const entered = gate(),
    release = gate();
  const original = FrozenBrowserValidator.readConsumedReport;
  FrozenBrowserValidator.readConsumedReport = async (options) => {
    const history = await original.call(FrozenBrowserValidator, options);
    entered.resolve();
    await release.promise;
    return history;
  };
  t.after(() => {
    release.resolve();
    FrozenBrowserValidator.readConsumedReport = original;
  });
  return { entered: entered.promise, release: release.resolve };
}

for (const literal of ['A', 'B'] as const)
  test(
    `run_check publishes baseline ${literal === 'A' ? 'reproduction' : 'nonreproduction'} and reopens literal PNG bytes`,
    { timeout: 30000 },
    async (t) => {
      const f = await consumptionController(t, { check: consume });
      await scriptLiteral(f.root, literal);
      const id = await f.add();
      const parked = await f.parked(id);
      await until(
        async () => (await f.controller.snapshot({ selected: id })).selected!.messages,
        (messages) => messages.some((m) => m.kind === 'eitri.action-result'),
      );
      const view = (await f.controller.snapshot({ selected: id })).selected!;
      assert.equal(view.case.simulated, true);
      assert.equal(view.checks.length, 1, JSON.stringify(view));
      const check = view.checks[0];
      assert.equal(check.simulated, false);
      if (check.simulated) return assert.fail('real receipt required');
      assert.equal(check.kind, 'baseline');
      assert.equal(check.passed, literal === 'A');
      assert.equal(check.provenance.kind, 'frozen-browser-consumed-v1');
      assert.equal(
        check.provenance.outcome,
        literal === 'A' ? 'baseline-reproduced' : 'baseline-not-reproduced',
      );
      const source = sources(f.directory)[0];
      assert.equal(check.candidate, source.frozen.revision);
      assert.equal(check.provenance.runId, source.workerExecutionFacts.consumedRun.runId);
      assert.equal(
        check.provenance.acceptanceId,
        source.workerExecutionFacts.consumedRun.acceptanceId,
      );
      assert.equal(check.provenance.admittedAt, source.workerExecutionFacts.admittedAt);
      assert.equal(check.provenance.deadline, source.workerExecutionFacts.deadline);
      assert.equal(parked.base, literal === 'A' ? source.frozen.revision : null);
      assert.equal(view.artifacts.length, 1);
      assert.equal(view.artifacts[0].label, 'Frozen browser screenshot');
      assert.equal(view.artifacts[0].mime, 'image/png');
      assert.equal(view.artifacts[0].simulated, false);
      assert.deepEqual((await f.controller.artifact(id, check.artifacts[0])).bytes, png);
      const results = view.messages.filter((m) => m.kind === 'eitri.action-result');
      assert.equal(results.length, 1);
      assert.deepEqual((results[0].data as { result: unknown }).result, check);
      await f.close();
      await f.reopen();
      const reopened = (await f.controller.snapshot({ selected: id })).selected!;
      assert.deepEqual(reopened.checks, view.checks);
      assert.deepEqual(reopened.artifacts, view.artifacts);
      assert.deepEqual((await f.controller.artifact(id, check.artifacts[0])).bytes, png);
      assert.equal(journalRows(f.journalDirectory).meta.attempts, 1);
    },
  );

for (const literal of ['A', 'B'] as const)
  test(
    `candidate ${literal === 'B' ? 'success' : 'failure'} uses its retained exact key after a different baseline run`,
    { timeout: 30000 },
    async (t) => {
      let f: Awaited<ReturnType<typeof consumptionController>>;
      const requests: unknown[] = [];
      const original = FrozenBrowserValidator.readConsumedReport;
      FrozenBrowserValidator.readConsumedReport = async (options) => {
        requests.push(structuredClone(options.consumedRun));
        return original.call(FrozenBrowserValidator, options);
      };
      t.after(() => {
        FrozenBrowserValidator.readConsumedReport = original;
      });
      f = await consumptionController(t, {
        check: async (r, source) => {
          if (r.kind === 'checkpoint')
            return {
              type: 'completed',
              check: {
                kind: 'checkpoint',
                candidate: source!.selection.revision,
                configuration: 'b'.repeat(64),
                passed: true,
                simulated: true,
                outputs: [],
              },
            };
          if (r.kind === 'browser') await scriptLiteral(f.root, literal);
          return consume(r, source);
        },
        providerForCase: (id) => {
          const faux = fauxProvider({ tokensPerSecond: 100000 });
          const respond: FauxResponseStep = async () => {
            const view = (await f.controller.snapshot({ selected: id })).selected!;
            const c = view.case;
            if (c.phase === 'triage' || (c.phase === 'investigation' && c.base))
              return fauxAssistantMessage(
                fauxToolCall('complete_assessment', {
                  phase: c.phase,
                  expectedControlVersion: c.version,
                  conclusion: 'progress',
                  reason: 'Offline progression',
                  evidenceIds: view.checks.map((c) => c.id),
                  proposal: 'Synthetic candidate',
                  paths: ['src/value.ts'],
                }),
                { stopReason: 'toolUse' },
              );
            const kind =
              c.phase === 'investigation' ? 'baseline' : !c.candidate ? 'checkpoint' : 'browser';
            if (view.checks.some((c) => c.kind === 'browser')) return fauxAssistantMessage('Done');
            return fauxAssistantMessage(fauxToolCall('run_check', { kind }), {
              stopReason: 'toolUse',
            });
          };
          faux.setResponses(Array.from({ length: 12 }, () => respond));
          return { provider: faux.provider, modelId: faux.getModel().id };
        },
      });
      const id = await f.add();
      await f.parked(id);
      const view = (await f.controller.snapshot({ selected: id })).selected!;
      assert.equal(view.checks.length, 3, JSON.stringify(view));
      assert.deepEqual(
        view.checks.map((c) => c.kind),
        ['baseline', 'checkpoint', 'browser'],
      );
      const candidate = view.checks[2];
      assert.equal(candidate.simulated, false);
      if (candidate.simulated) return assert.fail('real candidate required');
      assert.equal(candidate.passed, literal === 'B');
      assert.equal(
        candidate.provenance.outcome,
        literal === 'B' ? 'candidate-passed' : 'candidate-failed',
      );
      assert.equal(candidate.candidate, view.case.candidate);
      const retained = sources(f.directory).filter((s) => s.workerExecutionFacts);
      assert.deepEqual(
        requests,
        retained.map((s) => s.workerExecutionFacts.consumedRun),
      );
      assert.notEqual(
        retained[0].workerExecutionFacts.consumedRun.runId,
        candidate.provenance.runId,
      );
      assert.deepEqual((await f.controller.artifact(id, candidate.artifacts[0])).bytes, png);
      assert.equal(journalRows(f.journalDirectory).meta.attempts, 2);
    },
  );

for (const mode of ['infrastructure', 'cleanup-incomplete'] as const)
  test(
    `native ${mode} fails retirement and denies a subsequent provider action`,
    { timeout: 30000 },
    async (t) => {
      let subsequentTurns = 0;
      const f = await consumptionController(t, {
        check: consume,
        providerForCase: () => {
          const faux = fauxProvider({ tokensPerSecond: 100000 });
          faux.setResponses([
            fauxAssistantMessage(fauxToolCall('run_check', { kind: 'baseline' }), {
              stopReason: 'toolUse',
            }),
            () => {
              subsequentTurns++;
              return fauxAssistantMessage(fauxToolCall('probe', {}), { stopReason: 'toolUse' });
            },
          ]);
          return { provider: faux.provider, modelId: faux.getModel().id };
        },
      });
      if (mode === 'cleanup-incomplete')
        await writeFile(
          join(f.root, 'transcript.json'),
          JSON.stringify({ mode: 'cleanup-fail', calls: [] }),
        );
      else {
        const path = join(f.root, 'transcript.mjs');
        await writeFile(
          path,
          (await readFile(path, 'utf8')).replace(
            "if (args[0] === 'version') output",
            "if (args[0] === 'version') process.exitCode=97; else if (false) output",
          ),
        );
      }
      const id = await f.add();
      const parked = await f.parked(id);
      assert.equal(parked.reason, 'tool-action-failed');
      await f.close();
      await f.reopen();
      const view = (await f.controller.snapshot({ selected: id })).selected!;
      assert.equal(subsequentTurns, 0);
      assert.deepEqual(view.checks, []);
      assert.deepEqual(view.artifacts, []);
      assert.equal(view.case.base, null);
      assert.equal(sources(f.directory)[0].state, 'interrupted');
      assert.deepEqual(
        view.messages.filter((m) => m.kind === 'eitri.action-result'),
        [],
      );
      assert.equal(
        journalRows(f.journalDirectory).runs[0].execution.run.result.report.outcome.kind,
        mode === 'infrastructure' ? 'infrastructure-failed' : 'baseline-reproduced',
      );
    },
  );

for (const invalid of ['none', 'accept-only', 'extra', 'symbol', 'unit', 'not-real'] as const)
  test(`marker rejects ${invalid} without publication`, { timeout: 30000 }, async (t) => {
    const f = await consumptionController(t, {
      check: async (r, source) => {
        if (invalid === 'accept-only') await source!.workerAcceptance!.accept();
        if (invalid === 'extra')
          return { type: 'consumed-browser', history: {} } as CheckCallbackResult;
        if (invalid === 'symbol') return { type: 'consumed-browser', [Symbol('history')]: {} };
        if (invalid === 'not-real')
          return {
            type: 'completed',
            check: {
              kind: r.kind,
              candidate: 'a'.repeat(40),
              configuration: 'b'.repeat(64),
              passed: true,
              simulated: false,
              outputs: [],
            },
          } as unknown as CheckCallbackResult;
        return { type: 'consumed-browser' };
      },
      ...(invalid === 'unit'
        ? {
            providerForCase: () => {
              const faux = fauxProvider({ tokensPerSecond: 100000 });
              faux.setResponses([
                fauxAssistantMessage(fauxToolCall('run_check', { kind: 'unit' }), {
                  stopReason: 'toolUse',
                }),
              ]);
              return { provider: faux.provider, modelId: faux.getModel().id };
            },
          }
        : {}),
    });
    const id = await f.add();
    const parked = await f.parked(id);
    assert.equal(
      parked.reason,
      ['none', 'accept-only'].includes(invalid)
        ? 'consumed-check-consumption-required'
        : 'invalid-check-execution',
    );
    const view = (await f.controller.snapshot({ selected: id })).selected!;
    assert.deepEqual(view.checks, []);
    assert.deepEqual(view.artifacts, []);
    assert.equal(journalRows(f.journalDirectory).meta.attempts, 0);
  });

test(
  'fulfilled unawaited and repeated consumption join one run, then wait for successful journal release',
  { timeout: 30000 },
  async (t) => {
    const closing = gate(),
      release = gate(),
      delivered = gate();
    t.after(() => release.resolve());
    let released = false,
      reads = 0;
    const originalOpen = FrozenBrowserValidator.open;
    FrozenBrowserValidator.open = (async (
      options: Parameters<typeof originalOpen>[0] & { mode?: string },
    ) => {
      const journal = await originalOpen(options);
      if (options.mode !== 'consumption-only') return journal;
      const held = journal as unknown as FrozenBrowserConsumptionJournal;
      return {
        ...held,
        close: async () => {
          closing.resolve();
          await release.promise;
          await held.close();
          released = true;
        },
      };
    }) as typeof originalOpen;
    const originalRead = FrozenBrowserValidator.readConsumedReport;
    FrozenBrowserValidator.readConsumedReport = async (options) => {
      assert.equal(released, true);
      reads++;
      return originalRead.call(FrozenBrowserValidator, options);
    };
    t.after(() => {
      FrozenBrowserValidator.open = originalOpen;
      FrozenBrowserValidator.readConsumedReport = originalRead;
    });
    const f = await consumptionController(t, {
      check: async (_r, source) => {
        await source!.workerAcceptance!.accept();
        const first = source!.workerConsumption!.consume();
        const second = source!.workerConsumption!.consume();
        let firstValue: unknown;
        void first.then((value) => {
          firstValue = value;
        });
        void second.then((value) => {
          assert.deepEqual(value, firstValue);
          delivered.resolve();
        });
        await delivered.promise;
        return { type: 'consumed-browser' };
      },
    });
    const id = await f.add();
    await closing.promise;
    assert.equal(reads, 0);
    assert.deepEqual((await f.controller.snapshot({ selected: id })).selected!.checks, []);
    release.resolve();
    await f.parked(id);
    const view = (await f.controller.snapshot({ selected: id })).selected!;
    assert.equal(view.checks.length, 1);
    assert.equal(view.checks[0].simulated, false);
    assert.equal(reads, 1);
    assert.equal(journalRows(f.journalDirectory).meta.attempts, 1);
  },
);

test(
  'outstanding unawaited consumption drains before rejection and cannot publish settled history',
  { timeout: 30000 },
  async (t) => {
    const client = gateClient(t);
    const returnCallback = gate();
    t.after(() => returnCallback.resolve());
    let pending!: Promise<unknown>;
    const f = await consumptionController(t, {
      check: async (_r, source) => {
        await source!.workerAcceptance!.accept();
        pending = source!.workerConsumption!.consume();
        await returnCallback.promise;
        return { type: 'consumed-browser' };
      },
    });
    const id = await f.add();
    await client.entered;
    returnCallback.resolve();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal((await f.controller.snapshot()).cases[0].status, 'running');
    client.release();
    await assert.rejects(pending, /revoked|aborted|cancelled/i);
    const parked = await f.parked(id);
    assert.equal(parked.reason, 'consumed-check-consumption-required');
    assert.deepEqual((await f.controller.snapshot({ selected: id })).selected!.checks, []);
    assert.equal(
      journalRows(f.journalDirectory).runs[0].execution.run.result.report.outcome.kind,
      'cancelled',
    );
  },
);

for (const race of ['pause', 'expire', 'epoch', 'revision', 'retire', 'shutdown'] as const)
  test(
    `fresh authority after historical acquisition handles ${race}`,
    { timeout: 30000 },
    async (t) => {
      const read = holdRead(t);
      let now = 1000;
      let request!: AdmittedCheckRequest;
      const f = await consumptionController(t, {
        clock: () => now,
        check: (r, source) => {
          request = r;
          return consume(r, source);
        },
      });
      const id = await f.add();
      await read.entered;
      let closing: Promise<void> | undefined;
      let pausing: Promise<unknown> | undefined;
      if (race === 'pause') {
        pausing = f.controller.command(command({ type: 'pause', caseId: id }));
        await until(
          async () => (await f.controller.snapshot()).cases[0],
          (c) => c.status === 'pause-requested',
        );
      } else if (race === 'expire') now = request.deadlineAt;
      else if (race === 'shutdown') {
        closing = f.controller.close();
        let closed = false;
        void closing.then(() => {
          closed = true;
        });
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(closed, false);
      } else {
        const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
        try {
          if (race === 'retire') db.prepare('DELETE FROM actions WHERE id=?').run(request.actionId);
          else {
            const row = db.prepare('SELECT value FROM cases WHERE id=?').get(id)!;
            const c = JSON.parse(String(row.value));
            if (race === 'epoch') {
              c.epoch++;
              c.status = 'needs-attention';
              c.reason = 'test-epoch-changed';
            } else c.base = 'f'.repeat(40);
            db.prepare('UPDATE cases SET value=? WHERE id=?').run(JSON.stringify(c), id);
          }
        } finally {
          db.close();
        }
      }
      read.release();
      await pausing;
      if (closing) {
        await closing;
        await f.close();
        await f.reopen();
      }
      await until(
        async () => (await f.controller.snapshot()).cases[0],
        (c) => ['needs-attention', 'paused'].includes(c.status),
      );
      const view = (await f.controller.snapshot({ selected: id })).selected!;
      if (race === 'pause') {
        assert.equal(view.case.status, 'paused');
        assert.equal(view.checks.length, 1);
        assert.equal(view.checks[0].simulated, false);
        assert.deepEqual((await f.controller.artifact(id, view.checks[0].artifacts[0])).bytes, png);
      } else {
        assert.deepEqual(view.checks, []);
        assert.deepEqual(view.artifacts, []);
        assert.equal(journalRows(f.journalDirectory).meta.attempts, 1);
      }
    },
  );
