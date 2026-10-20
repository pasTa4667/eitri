import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FrozenBrowserValidator } from '../src/frozen-browser.ts';
import { journalRows } from './controller-worker-association-fixture.ts';
import { consumptionFixture, deferred } from './frozen-browser-consumption-fixture.ts';

const prototype = FrozenBrowserValidator.prototype;
const signal = () => new AbortController().signal;

for (const point of ['staging', 'forward', 'after-observation'] as const)
  test(`consumption charges nonzero ${point} sampler latency without denying live authority`, async (t) => {
    const f = await consumptionFixture(t);
    const originalNow = Date.now;
    let worker = 8000000;
    let controller = 2000;
    let samples = 0;
    let inClient = false;
    const clientEndpoints: number[] = [];
    const originalClient = Reflect.get(prototype, 'client');
    Date.now = () => worker;
    t.after(() => {
      Date.now = originalNow;
      Reflect.set(prototype, 'client', originalClient);
    });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const timeout = globalThis.setTimeout;
    t.mock.method(globalThis, 'setTimeout', (...args: Parameters<typeof setTimeout>) => {
      if (inClient) clientEndpoints.push(worker + Number(args[1]));
      return Reflect.apply(timeout, globalThis, args);
    });
    Reflect.set(prototype, 'client', function (this: FrozenBrowserValidator, ...args: unknown[]) {
      inClient = args[2] !== undefined;
      try {
        return Reflect.apply(originalClient, this, args);
      } finally {
        inClient = false;
      }
    });
    const advance = (ms: number) => {
      worker += ms;
      controller += ms;
    };
    const sample = () => {
      samples++;
      if (samples >= 3) advance(samples === 3 || (point === 'forward' && samples === 4) ? 2 : 5);
      const remaining = 62000 - controller;
      if (point === 'after-observation' && samples >= 4) advance(3);
      return remaining;
    };
    const result = await f.journal.consume(f.accepted, sample, signal());
    assert.equal(result.run.state, 'settled');
    assert.deepEqual(result.run.outcome, { kind: 'baseline-reproduced' });
    assert.deepEqual(result.run.cleanup, { kind: 'owned-removed', cache: 'retained' });
    assert.equal(result.run.admittedAt, 8000000);
    assert.equal(result.run.deadline, 8059998);
    assert.deepEqual([...new Set(clientEndpoints)], [8059995]);
    const rows = journalRows(f.directory);
    assert.equal(rows.meta.attempts, 1);
    assert.equal(rows.meta.contribution, 41943040);
    assert.deepEqual(rows.runs[0].acceptance, { kind: 'offline-acceptance', ...f.accepted });
    assert.equal(rows.runs[0].execution.run.intent.deadline, 8059998);
    const state = await f.state();
    assert.equal(state.calls.filter((c) => c[0] === 'build').length, 1);
    assert.equal(state.calls.filter((c) => c[0] === 'start').length, 1);
    assert.equal(state.image, false);
    assert.equal(state.container, null);
  });

for (const elapsed of [9, 10, 11])
  test(`post-staging sampler return at effective endpoint ${elapsed - 10}ms preserves exclusive expiry`, async (t) => {
    const f = await consumptionFixture(t);
    const before = journalRows(f.directory);
    const originalNow = Date.now;
    const originalExec = DatabaseSync.prototype.exec;
    let now = 1000;
    let staged = false;
    let sampled = false;
    Date.now = () => now;
    t.mock.timers.enable({ apis: ['setTimeout'] });
    DatabaseSync.prototype.exec = function (sql) {
      const result = Reflect.apply(originalExec, this, [sql]);
      if (sql === 'BEGIN IMMEDIATE') staged = true;
      return result;
    };
    t.after(() => {
      Date.now = originalNow;
      DatabaseSync.prototype.exec = originalExec;
    });
    const pending = f.journal.consume(
      f.accepted,
      () => {
        if (staged && !sampled) {
          sampled = true;
          now += elapsed;
        }
        return 10;
      },
      signal(),
    );
    if (elapsed < 10) {
      const result = await pending;
      assert.deepEqual(result.run.outcome, { kind: 'baseline-reproduced' });
      assert.equal(result.run.deadline, 1010);
      assert.equal(journalRows(f.directory).meta.attempts, 1);
    } else {
      await assert.rejects(pending, /worker-authority-denied/);
      assert.deepEqual(journalRows(f.directory), before);
      assert.deepEqual((await f.state()).calls, []);
      assert.deepEqual(await f.journal.accept(f.request, () => true), f.accepted);
    }
  });

for (const invalid of ['backward', 'fractional', 'nonfinite', 'unsafe', 'overflow'] as const)
  test(`ordered post-staging bracket rejects ${invalid} worker time without charge`, async (t) => {
    const f = await consumptionFixture(t);
    const before = journalRows(f.directory);
    const originalNow = Date.now;
    const originalExec = DatabaseSync.prototype.exec;
    let now = 1000;
    let staged = false;
    Date.now = () => now;
    DatabaseSync.prototype.exec = function (sql) {
      const result = Reflect.apply(originalExec, this, [sql]);
      if (sql === 'BEGIN IMMEDIATE') staged = true;
      return result;
    };
    t.after(() => {
      Date.now = originalNow;
      DatabaseSync.prototype.exec = originalExec;
    });
    await assert.rejects(
      f.journal.consume(
        f.accepted,
        () => {
          if (staged) {
            if (invalid === 'backward') now--;
            if (invalid === 'fractional') now = 1000.5;
            if (invalid === 'nonfinite') now = Infinity;
            if (invalid === 'unsafe') now = Number.MAX_SAFE_INTEGER + 1;
            if (invalid === 'overflow') return Number.MAX_SAFE_INTEGER;
          }
          return 100;
        },
        signal(),
      ),
    );
    assert.deepEqual(journalRows(f.directory), before);
    assert.deepEqual((await f.state()).calls, []);
    Date.now = originalNow;
    DatabaseSync.prototype.exec = originalExec;
    assert.deepEqual(await f.journal.accept(f.request, () => true), f.accepted);
  });

for (const grow of [false, true])
  test(
    `shortened allowance bounds actual held clients and cancellation${grow ? ' despite later larger allowance' : ''}`,
    { timeout: 30000 },
    async (t) => {
      const f = await consumptionFixture(t);
      const script = join(f.root, 'bin', 'transcript.mjs');
      await writeFile(
        script,
        (await readFile(script, 'utf8')).replace(
          'plain(wire);',
          'save(); setInterval(() => {}, 1000);',
        ),
      );
      const originalNow = Date.now;
      const originalClient = Reflect.get(prototype, 'client');
      let now = 1000;
      let remaining = 60000;
      let inClient = false;
      const clientEndpoints: number[] = [];
      const held = deferred();
      Date.now = () => now;
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const timeout = globalThis.setTimeout;
      t.mock.method(globalThis, 'setTimeout', (...args: Parameters<typeof setTimeout>) => {
        if (inClient) clientEndpoints.push(now + Number(args[1]));
        return Reflect.apply(timeout, globalThis, args);
      });
      Reflect.set(prototype, 'client', function (this: FrozenBrowserValidator, ...args: unknown[]) {
        const words = args[0] as string[];
        if (args[2]) {
          if (words[0] === 'version') remaining = 200;
          if (grow && words[0] === 'info') {
            now = 1050;
            t.mock.timers.tick(50);
            remaining = 60000;
          }
          inClient = true;
        }
        try {
          const result = Reflect.apply(originalClient, this, args);
          if (words[0] === 'start') held.resolve();
          return result;
        } finally {
          inClient = false;
        }
      });
      t.after(() => {
        Date.now = originalNow;
        Reflect.set(prototype, 'client', originalClient);
      });
      const pending = f.journal.consume(f.accepted, () => remaining, signal());
      const rejected = assert.rejects(pending);
      await held.promise;
      const state = await f.state();
      assert.equal(state.calls.filter((c) => c[0] === 'build').length, 1);
      assert.equal(clientEndpoints.length > 5, true);
      assert.deepEqual([...new Set(clientEndpoints)], [1200]);
      const elapsed = 1199 - now;
      now = 1199;
      t.mock.timers.tick(elapsed);
      assert.equal(journalRows(f.directory).runs[0].execution.run.result.kind, 'pending');
      now = 1200;
      t.mock.timers.tick(1);
      await rejected;
      const rows = journalRows(f.directory);
      assert.equal(rows.meta.attempts, 1);
      assert.equal(rows.runs[0].execution.run.intent.deadline, 61000);
      assert.deepEqual(rows.runs[0].execution.run.result.report.outcome, {
        kind: 'cancelled',
        code: 'cancelled-or-allowance-exhausted',
      });
      assert.deepEqual(rows.runs[0].execution.run.result.report.cleanup, {
        kind: 'owned-removed',
        cache: 'retained',
      });
      assert.deepEqual(rows.runs[0].acceptance, { kind: 'offline-acceptance', ...f.accepted });
      const cleaned = await f.state();
      assert.equal(cleaned.image, false);
      assert.equal(cleaned.container, null);
    },
  );

test('positive post-staging allowance shrink admits without rewriting the durable ceiling', async (t) => {
  const f = await consumptionFixture(t);
  const originalNow = Date.now;
  const originalExec = DatabaseSync.prototype.exec;
  let remaining = 100;
  Date.now = () => 1000;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  DatabaseSync.prototype.exec = function (sql) {
    const result = Reflect.apply(originalExec, this, [sql]);
    if (sql === 'BEGIN IMMEDIATE') remaining = 99;
    return result;
  };
  t.after(() => {
    Date.now = originalNow;
    DatabaseSync.prototype.exec = originalExec;
  });
  const result = await f.journal.consume(f.accepted, () => remaining, signal());
  assert.deepEqual(result.run.outcome, { kind: 'baseline-reproduced' });
  assert.equal(result.run.deadline, 1100);
  assert.deepEqual(result.run.cleanup, { kind: 'owned-removed', cache: 'retained' });
  assert.equal(journalRows(f.directory).meta.attempts, 1);
  assert.deepEqual(journalRows(f.directory).runs[0].acceptance, {
    kind: 'offline-acceptance',
    ...f.accepted,
  });
});

for (const grow of [false, true])
  test(
    `consumption cancellation timer survives client completion${grow ? ' and cannot extend for larger authority' : ''}`,
    { timeout: 30000 },
    async (t) => {
      const f = await consumptionFixture(t);
      const originalNow = Date.now;
      const originalClient = Reflect.get(prototype, 'client');
      const held = deferred();
      let now = 1000;
      let remaining = 60000;
      let aborted = false;
      Date.now = () => now;
      t.mock.timers.enable({ apis: ['setTimeout'] });
      Reflect.set(
        prototype,
        'client',
        async function (this: FrozenBrowserValidator, ...args: unknown[]) {
          const words = args[0] as string[];
          if (words[0] === 'version') remaining = 200;
          if (grow && words[0] === 'info') {
            now = 1050;
            t.mock.timers.tick(50);
            remaining = 60000;
          }
          const result = await Reflect.apply(originalClient, this, args);
          if (words[0] === 'start') {
            const signal = args[2] as AbortSignal;
            await new Promise<void>((resolve) => {
              signal.addEventListener(
                'abort',
                () => {
                  aborted = true;
                  resolve();
                },
                { once: true },
              );
              held.resolve();
            });
          }
          return result;
        },
      );
      t.after(() => {
        Date.now = originalNow;
        Reflect.set(prototype, 'client', originalClient);
      });
      const pending = f.journal.consume(f.accepted, () => remaining, signal());
      const rejected = assert.rejects(pending);
      await held.promise;
      const elapsed = 1199 - now;
      now = 1199;
      t.mock.timers.tick(elapsed);
      assert.equal(aborted, false);
      now = 1200;
      t.mock.timers.tick(1);
      assert.equal(aborted, true);
      await rejected;
      const rows = journalRows(f.directory);
      assert.equal(rows.meta.attempts, 1);
      assert.equal(rows.runs[0].execution.run.intent.deadline, 61000);
      assert.deepEqual(rows.runs[0].execution.run.result.report.outcome, {
        kind: 'cancelled',
        code: 'cancelled-or-allowance-exhausted',
      });
      assert.deepEqual(rows.runs[0].execution.run.result.report.cleanup, {
        kind: 'owned-removed',
        cache: 'retained',
      });
      const state = await f.state();
      assert.equal(state.calls.filter((c) => c[0] === 'build').length, 1);
      assert.equal(state.calls.filter((c) => c[0] === 'start').length, 1);
      assert.equal(state.image, false);
      assert.equal(state.container, null);
    },
  );

test('client setup exhausting H stops immediately instead of extending its timeout', async (t) => {
  const f = await consumptionFixture(t);
  const originalNow = Date.now;
  const originalClient = Reflect.get(prototype, 'client');
  let now = 1000;
  let inClient = false;
  let reads = 0;
  let observed: unknown = 'client-not-entered';
  const endpoints: number[] = [];
  Date.now = () => {
    if (inClient && ++reads === 4) now = 1200;
    return now;
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (...args: Parameters<typeof setTimeout>) => {
    if (inClient) endpoints.push(now + Number(args[1]));
    return Reflect.apply(timeout, globalThis, args);
  });
  let remaining = 60000;
  Reflect.set(prototype, 'client', function (this: FrozenBrowserValidator, ...args: unknown[]) {
    if ((args[0] as string[])[0] !== 'version') return Reflect.apply(originalClient, this, args);
    remaining = 200;
    inClient = true;
    try {
      return Promise.resolve(Reflect.apply(originalClient, this, args)).then((result) => {
        observed = result;
        return result;
      });
    } finally {
      inClient = false;
    }
  });
  t.after(() => {
    Date.now = originalNow;
    Reflect.set(prototype, 'client', originalClient);
  });
  await assert.rejects(f.journal.consume(f.accepted, () => remaining, signal()));
  assert.deepEqual(observed, { kind: 'lost', code: 'client-timeout' });
  assert.deepEqual(endpoints, [1200]);
  const rows = journalRows(f.directory);
  assert.equal(rows.meta.attempts, 1);
  assert.equal(rows.runs[0].execution.run.intent.deadline, 61000);
  assert.deepEqual(rows.runs[0].execution.run.result.report.outcome, {
    kind: 'cancelled',
    code: 'cancelled-or-allowance-exhausted',
  });
  assert.deepEqual(rows.runs[0].execution.run.result.report.cleanup, {
    kind: 'not-needed',
    cache: 'retained',
  });
});
