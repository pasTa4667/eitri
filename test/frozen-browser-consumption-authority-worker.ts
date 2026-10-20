import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { consumptionFixture } from './frozen-browser-consumption-fixture.ts';
import { journalRows } from './controller-worker-association-fixture.ts';

const [kind] = process.argv.slice(2);
test(`rejecting ${kind} sampler never leaks an unhandled rejection`, async (t) => {
  const f = await consumptionFixture(t);
  const before = journalRows(f.directory);
  const unhandled: unknown[] = [];
  const observe = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', observe);
  t.after(() => process.removeListener('unhandledRejection', observe));
  const invalid =
    kind === 'async'
      ? async () => {
          throw Error('revoked');
        }
      : () => Promise.reject(Error('revoked'));
  for (const staged of [false, true]) {
    const original = DatabaseSync.prototype.exec;
    let inTransaction = false;
    DatabaseSync.prototype.exec = function (sql) {
      const result = Reflect.apply(original, this, [sql]);
      if (sql === 'BEGIN IMMEDIATE') inTransaction = true;
      return result;
    };
    try {
      await assert.rejects(
        f.journal.consume(
          f.accepted,
          (() => (!staged || inTransaction ? invalid() : 10)) as () => number,
          new AbortController().signal,
        ),
        /worker-authority-denied/,
      );
    } finally {
      DatabaseSync.prototype.exec = original;
    }
    await new Promise<void>((r) => setImmediate(r));
    assert.deepEqual(unhandled, []);
    assert.deepEqual(journalRows(f.directory), before);
  }
});
