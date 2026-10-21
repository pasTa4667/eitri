import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { consumptionController } from './controller-worker-consumption-fixture.ts';
import { gate, sources } from './controller-worker-association-fixture.ts';
import { traceAdmissionEffects } from './worker-admission-fixture.ts';
import type { Action, Case } from '../src/domain.ts';
import type { NativeCase } from '../src/native.ts';

for (const kind of ['baseline', 'browser'] as const)
  test(`actual controller authority after synchronous retention for ${kind}; scripted worker claims`, async (t) => {
    let now = 1000;
    let assertions = 0;
    let retainedAssert!: () => void;
    const done = gate();
    const release = gate();
    t.after(() => release.resolve());
    let observedError: unknown;
    const f = await consumptionController(
      t,
      {
        clock: () => now,
        actionWakeup: () => () => {},
        check: async (request, source) => {
          try {
            await source!.workerAcceptance!.accept();
            await source!.workerConsumption!.consume();
            const native = await (
              Reflect.get(f.controller, 'runtimes') as Map<string, Promise<NativeCase>>
            ).get(request.caseId)!;
            const original = sources(f.directory)[0];
            const action = original.action as Action;
            const db = new DatabaseSync(join(f.directory, 'catalogue.sqlite'));
            try {
              const readCase = (): Case =>
                JSON.parse(
                  String(
                    db.prepare('SELECT value FROM cases WHERE id=?').get(action.caseId)!.value,
                  ),
                );
              const saveCase = (c: Case) =>
                db
                  .prepare('UPDATE cases SET value=? WHERE id=?')
                  .run(JSON.stringify(c), action.caseId);
              const saveSource = (s: object) =>
                db
                  .prepare('UPDATE action_sources SET value=? WHERE action_id=?')
                  .run(JSON.stringify(s), action.id);
              const originalCase = readCase();
              if (kind === 'browser')
                saveCase({ ...originalCase, candidate: original.frozen.revision });
              const capture = () =>
                native.host.captureConsumedCheckAuthority!(action, request.signal);
              const authority = capture();
              retainedAssert = authority.assertCurrent;
              assert.deepEqual(authority.anchor.facts, original.workerExecutionFacts);
              assert.equal(
                authority.anchor.binding.ownerId,
                f.options.offlineWorkerJournal.ownerId,
              );
              assert.equal(authority.anchor.frozen.revision, original.frozen.revision);
              assert.equal(originalCase.base, null);
              authority.assertCurrent();
              assertions++;
              saveCase({
                ...readCase(),
                status: 'pause-requested',
                version: originalCase.version + 3,
              });
              authority.assertCurrent();
              assertions++;
              saveCase({ ...readCase(), status: 'running' });
              for (const field of ['ownerId', 'configurationDigest', 'directory'] as const) {
                const binding = Reflect.get(f.controller, 'options').offlineWorkerJournal;
                const old = binding[field];
                Reflect.set(
                  binding,
                  field,
                  field === 'ownerId'
                    ? randomUUID()
                    : field === 'configurationDigest'
                      ? 'f'.repeat(64)
                      : `${old}/changed`,
                );
                assert.throws(capture, /binding/);
                assert.throws(() => authority.assertCurrent(), /binding/);
                Reflect.set(binding, field, old);
                assertions++;
              }
              for (const replacement of [
                { ...original, state: 'settled' },
                { ...original, kind: 'unit' },
                { ...original, workerExecutionFacts: undefined },
                { ...original, workerIntent: undefined },
                { ...original, action: { ...action, startedAt: action.startedAt + 1 } },
                { ...original, frozen: { ...original.frozen, manifestDigest: 'e'.repeat(64) } },
              ]) {
                saveSource(replacement);
                assert.throws(capture);
                assert.throws(() => authority.assertCurrent());
                saveSource(original);
                assertions++;
              }
              const current = readCase();
              for (const changed of [
                { ...current, epoch: current.epoch + 1 },
                { ...current, remainingMs: 0 },
                { ...current, status: 'paused' },
                {
                  ...current,
                  ...(kind === 'baseline' ? { base: 'e'.repeat(40) } : { candidate: null }),
                },
                {
                  ...current,
                  ...(kind === 'baseline'
                    ? { base: 'f'.repeat(40) }
                    : { candidate: 'f'.repeat(40) }),
                },
              ]) {
                saveCase(changed as Case);
                assert.throws(capture);
                saveCase(current);
                assertions++;
              }
              const cancelled = new AbortController();
              cancelled.abort();
              assert.throws(
                () => native.host.captureConsumedCheckAuthority!(action, cancelled.signal),
                /cancelled/,
              );
              assertions++;
              assert.throws(
                () =>
                  native.host.captureConsumedCheckAuthority!(
                    { ...action, limitMs: action.limitMs - 1 },
                    request.signal,
                  ),
                /denied/,
              );
              assertions++;
              now = action.startedAt + action.limitMs;
              assert.throws(capture, /exhausted/);
              now = 1000;
              assertions++;
              db.prepare('DELETE FROM actions WHERE id=?').run(action.id);
              assert.throws(capture, /denied/);
              assertions++;
              db.prepare('INSERT INTO actions VALUES(?,?,?)').run(
                action.id,
                action.caseId,
                JSON.stringify(action),
              );
              saveSource(original);
              saveCase(originalCase);
            } finally {
              db.close();
            }
          } catch (error) {
            observedError = error;
          } finally {
            done.resolve();
          }
          await release.promise;
          return { type: 'infrastructure' };
        },
      },
      kind,
    );
    const effects = traceAdmissionEffects(t, () => {
      const retained = sources(f.directory)[0];
      assert.equal(
        retained.workerExecutionFacts.consumedRun.requestDigest,
        retained.workerIntent.requestDigest,
      );
    });
    await f.add();
    await done.promise;
    assert.equal(observedError, undefined);
    assert.equal(assertions, 20);
    assert.equal(effects.counts.executions, 1);
    release.resolve();
    await f.close();
    assert.throws(retainedAssert, /denied/);
    assert.equal(
      (await f.state()).calls.some((words) => words[0] === 'build'),
      true,
    );
  });
