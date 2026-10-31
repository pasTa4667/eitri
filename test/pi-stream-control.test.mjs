import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { probePiStream, observations } from '../prototypes/pi-stream.mjs';

async function fixture(t, body = '') {
  const root = await mkdtemp(join(tmpdir(), 'eitri-pi-control-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const childPath = join(root, 'child.mjs');
  const readyPath = join(root, 'ready');
  const countPath = join(root, 'count');
  await writeFile(
    childPath,
    `import { writeFileSync } from 'node:fs';
    writeFileSync(${JSON.stringify(readyPath)}, JSON.stringify({pid: process.pid, home: process.cwd()}));
    let count = 0;
    let pending = '';
    process.stdin.on('data', (chunk) => {
      const lines = (pending + chunk.toString()).split('\\n');
      pending = lines.pop();
      count += lines.length;
      writeFileSync(${JSON.stringify(countPath)}, String(count));
    });
    process.stdin.pause();
    ${body}`,
  );
  return { root, childPath, readyPath, countPath };
}
const sdkChild = `await import(${JSON.stringify(new URL('../prototypes/pi-stream-child.mjs', import.meta.url).href)});`;
async function reaped(f) {
  const ready = JSON.parse(await readFile(f.readyPath, 'utf8'));
  assert.throws(() => process.kill(ready.pid, 0), { code: 'ESRCH' });
  await assert.rejects(stat(ready.home), { code: 'ENOENT' });
}
const failed = { message: 'pi-stream-offline-failed' };

for (const control of [null, {}, { admit: () => {} }, { remaining: () => 1000 }]) {
  test(`incomplete caller control ${JSON.stringify(control)} fails before helper startup`, async (t) => {
    const f = await fixture(t);
    await assert.rejects(probePiStream({ childPath: f.childPath, control }), failed);
    await assert.rejects(readFile(f.readyPath), { code: 'ENOENT' });
  });
}

test('startup and synchronous admission consume the original timeout before spawn', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    probePiStream({
      childPath: f.childPath,
      timeoutMs: 50,
      control: {
        remaining: () => 10_000,
        admit: () => {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 75);
        },
      },
    }),
    failed,
  );
  await assert.rejects(readFile(f.readyPath), { code: 'ENOENT' });
});

test('caller allowance exhausted during preparation starts no helper', async (t) => {
  const f = await fixture(t);
  let first = true;
  await assert.rejects(
    probePiStream({
      childPath: f.childPath,
      control: {
        remaining: () => {
          if (first) {
            first = false;
            return 10_000;
          }
          return 0;
        },
        admit: () => assert.fail('preparation consumed allowance'),
      },
    }),
    failed,
  );
  await assert.rejects(readFile(f.readyPath), { code: 'ENOENT' });
});

test('explicit caller admission precedes each model request and fixture tool-result handoff', async () => {
  const admissions = [];
  const result = await probePiStream({
    control: {
      remaining: () => 10_000,
      admit: (kind) => {
        admissions.push(kind);
      },
    },
  });
  assert.deepEqual(result, observations);
  assert.deepEqual(admissions, ['model', 'tool', 'model']);
});

test('pause after the first model terminal denies tool admission and reaps without another dispatch', async (t) => {
  const f = await fixture(t, sdkChild);
  const admissions = [];
  await assert.rejects(
    probePiStream({
      childPath: f.childPath,
      control: {
        remaining: () => 10_000,
        admit: (kind) => {
          admissions.push(kind);
          if (kind === 'tool') throw new Error('synthetic-private-pause');
        },
      },
    }),
    failed,
  );
  assert.deepEqual(admissions, ['model', 'tool']);
  assert.equal(await readFile(f.countPath, 'utf8'), '1');
  await reaped(f);
});

test('caller cancellation at tool admission reaps before any next model dispatch', async (t) => {
  const f = await fixture(t, sdkChild);
  const abort = new AbortController();
  const admissions = [];
  await assert.rejects(
    probePiStream({
      childPath: f.childPath,
      signal: abort.signal,
      control: {
        remaining: () => 10_000,
        admit: (kind) => {
          admissions.push(kind);
          if (kind === 'tool') abort.abort();
        },
      },
    }),
    failed,
  );
  assert.deepEqual(admissions, ['model', 'tool']);
  assert.equal(await readFile(f.countPath, 'utf8'), '1');
  await reaped(f);
});

test('a pause after final admission lets that admitted model settle without admitting more work', async () => {
  let paused = false;
  const admissions = [];
  const result = await probePiStream({
    control: {
      remaining: () => 10_000,
      admit: (kind) => {
        assert.equal(paused, false);
        admissions.push(kind);
        if (admissions.length === 3)
          queueMicrotask(() => {
            paused = true;
          });
      },
    },
  });
  assert.equal(paused, true);
  assert.deepEqual(result, observations);
  assert.deepEqual(admissions, ['model', 'tool', 'model']);
});

test('pause after fixture tool admission denies the next model request without replay', async (t) => {
  const f = await fixture(t, sdkChild);
  const admissions = [];
  await assert.rejects(
    probePiStream({
      childPath: f.childPath,
      control: {
        remaining: () => 10_000,
        admit: (kind) => {
          admissions.push(kind);
          if (admissions.length === 3) throw new Error('paused');
        },
      },
    }),
    failed,
  );
  assert.deepEqual(admissions, ['model', 'tool', 'model']);
  assert.equal(await readFile(f.countPath, 'utf8'), '1');
  await reaped(f);
});

for (const remaining of [0, -1, NaN, Infinity, '100', undefined]) {
  test(`invalid/exhausted caller allowance ${String(remaining)} cannot launch a helper`, async (t) => {
    const f = await fixture(t);
    await assert.rejects(
      probePiStream({
        childPath: f.childPath,
        control: { remaining: () => remaining, admit: () => assert.fail('no admission') },
      }),
      failed,
    );
    await assert.rejects(readFile(f.readyPath), { code: 'ENOENT' });
  });
}

test('denied initial model admission starts no helper', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    probePiStream({
      childPath: f.childPath,
      control: {
        remaining: () => 10_000,
        admit: () => {
          throw new Error('paused');
        },
      },
    }),
    failed,
  );
  await assert.rejects(readFile(f.readyPath), { code: 'ENOENT' });
});

test('an increased caller allowance cannot extend the original helper deadline', async (t) => {
  const f = await fixture(t, `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`);
  let reads = 0;
  const started = performance.now();
  await assert.rejects(
    probePiStream({
      childPath: f.childPath,
      timeoutMs: 10_000,
      control: { remaining: () => (++reads === 1 ? 1000 : 10_000), admit: () => {} },
    }),
    failed,
  );
  assert.ok(performance.now() - started < 5000, 'initial allowance is not renewed');
  await reaped(f);
});

test('a smaller observed caller allowance cannot be renewed by a later larger reading', async (t) => {
  const f = await fixture(t, `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`);
  let allowance = 10_000;
  const started = performance.now();
  await assert.rejects(
    probePiStream({
      childPath: f.childPath,
      timeoutMs: 5000,
      control: {
        remaining: () => {
          const value = allowance;
          allowance = 10_000;
          return value;
        },
        admit: () => {
          allowance = 1000;
        },
      },
    }),
    failed,
  );
  assert.ok(
    performance.now() - started < 3500,
    'smaller observed allowance is a permanent ceiling',
  );
  await reaped(f);
});

test('a model terminal delivered after caller expiry cannot authorize a tool or become success', async (t) => {
  const f = await fixture(t);
  const expiredPath = join(f.root, 'expired');
  const source = await readFile(f.childPath, 'utf8');
  await writeFile(
    f.childPath,
    `${source}
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (line, ...args) => {
      if (JSON.parse(line).event.type === 'done') writeFileSync(${JSON.stringify(expiredPath)}, 'expired');
      return write(line, ...args);
    };
    ${sdkChild}`,
  );
  const admissions = [];
  await assert.rejects(
    probePiStream({
      childPath: f.childPath,
      control: {
        remaining: () => (existsSync(expiredPath) ? 0 : 10_000),
        admit: (kind) => {
          admissions.push(kind);
        },
      },
    }),
    failed,
  );
  assert.deepEqual(admissions, ['model']);
  assert.equal(await readFile(f.countPath, 'utf8'), '1');
  await reaped(f);
});

test('exhaustion during tool admission prevents the next model request', async (t) => {
  const f = await fixture(t, sdkChild);
  let remaining = 10_000;
  const admissions = [];
  await assert.rejects(
    probePiStream({
      childPath: f.childPath,
      control: {
        remaining: () => remaining,
        admit: (kind) => {
          admissions.push(kind);
          if (kind === 'tool') remaining = 0;
        },
      },
    }),
    failed,
  );
  assert.deepEqual(admissions, ['model', 'tool']);
  assert.equal(await readFile(f.countPath, 'utf8'), '1');
  await reaped(f);
});

test('helper restart uses a persisted caller deadline, never a fresh default timeout', async (t) => {
  const f = await fixture(t, `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`);
  const statePath = join(f.root, 'caller-state.json');
  await writeFile(statePath, JSON.stringify({ deadline: Date.now() + 2000 }));
  const reopenControl = async () => {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    return { remaining: () => Math.max(0, state.deadline - Date.now()), admit: () => {} };
  };
  await assert.rejects(
    probePiStream({ childPath: f.childPath, control: await reopenControl() }),
    failed,
  );
  await reaped(f);
  await rm(f.readyPath);
  await assert.rejects(
    probePiStream({ childPath: f.childPath, control: await reopenControl() }),
    failed,
  );
  await assert.rejects(readFile(f.readyPath), { code: 'ENOENT' });
});
