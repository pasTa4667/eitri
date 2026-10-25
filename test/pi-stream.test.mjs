import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { probePiStream, observations } from '../prototypes/pi-stream.mjs';

const command = new URL('../prototypes/pi-stream.mjs', import.meta.url).pathname;
const run = promisify(execFile);

for (const args of [[], ['--help']]) {
  test(`Pi stream ${JSON.stringify(args)} is help-only even with poisoned runtime paths`, async () => {
    const result = await run(process.execPath, [command, ...args], {
      env: { HOME: '/nonexistent/eitri-home', PI_CODING_AGENT_DIR: '/nonexistent/eitri-agent' },
    });
    assert.match(result.stdout, /--offline/);
    assert.equal(result.stderr, '');
  });
}

test('Pi stream refuses unknown or combined activation without SDK execution', async () => {
  for (const args of [['--run'], ['--offline', '--help'], ['--offline', 'extra']]) {
    await assert.rejects(run(process.execPath, [command, ...args]), (error) => {
      assert.equal(error.code, 2);
      assert.equal(error.stderr, 'Invalid arguments. Use --help.\n');
      return true;
    });
  }
});

test('actual installed SDK handles two explicitly requested synthetic streams, not an agent loop', async () => {
  const result = await probePiStream();
  assert.deepEqual(result, observations);
  assert.equal(result.status, 'offline-seam-pass');
  assert.equal(result.requests, 2);
  assert.equal(result.refreshes, 1);
  assert.equal(result.toolExecutions, 0);
});

test('actual offline CLI strips ambient key/config/Node injection and never uses the supplied home', async () => {
  const home = await mkdtemp(join(tmpdir(), 'eitri-pi-poison-'));
  try {
    const sentinel = join(home, 'sentinel');
    await writeFile(sentinel, 'unchanged');
    const result = await run(process.execPath, [command, '--offline'], {
      env: {
        HOME: home,
        PI_CODING_AGENT_DIR: home,
        OPENAI_API_KEY: 'synthetic-poison-key',
        ANTHROPIC_API_KEY: 'synthetic-poison-key',
        NODE_OPTIONS: '--no-warnings',
      },
      timeout: 15_000,
    });
    assert.deepEqual(JSON.parse(result.stdout), observations);
    assert.equal(result.stderr, '');
    assert.equal(await readFile(sentinel, 'utf8'), 'unchanged');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

async function fixture(t, source) {
  const root = await mkdtemp(join(tmpdir(), 'eitri-pi-stream-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const childPath = join(root, 'child.mjs');
  await writeFile(childPath, source);
  return { root, childPath };
}

for (const [name, source] of [
  ['empty EOF', ''],
  ['partial JSON', 'process.stdout.write("{ ");'],
  [
    'extra terminal',
    `console.log(${JSON.stringify(JSON.stringify(observations))}); console.log('{}');`,
  ],
  [
    'diagnostics',
    `console.error('synthetic-private-diagnostic'); console.log(${JSON.stringify(JSON.stringify(observations))});`,
  ],
  ['oversize', `process.stdout.write('x'.repeat(8192));`],
  [
    'wrong outcome',
    `console.log(JSON.stringify({ ...${JSON.stringify(observations)}, requests: 3 }));`,
  ],
  [
    'nonzero exit',
    `console.log(${JSON.stringify(JSON.stringify(observations))}); process.exitCode = 1;`,
  ],
]) {
  test(`offline child ${name} cannot become success or leak raw output`, async (t) => {
    const { childPath } = await fixture(t, source);
    await assert.rejects(probePiStream({ childPath }), { message: 'pi-stream-offline-failed' });
  });
}

test('timeout kills and reaps an uncooperative subprocess before returning', async (t) => {
  const { root, childPath } = await fixture(t, '');
  const pidPath = join(root, 'pid');
  await writeFile(
    childPath,
    `import { writeFileSync } from 'node:fs';
    writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
    process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`,
  );
  await assert.rejects(probePiStream({ childPath, timeoutMs: 1000 }), {
    message: 'pi-stream-offline-failed',
  });
  const pid = Number(await readFile(pidPath, 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('caller cancellation reaps the started child before returning and removes its synthetic home', async (t) => {
  const { root, childPath } = await fixture(t, '');
  const readyPath = join(root, 'ready');
  await writeFile(
    childPath,
    `import { writeFileSync } from 'node:fs';
    writeFileSync(${JSON.stringify(readyPath)}, JSON.stringify({ pid: process.pid, home: process.cwd() }));
    process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`,
  );
  const controller = new AbortController();
  const outcome = assert.rejects(probePiStream({ childPath, signal: controller.signal }), {
    message: 'pi-stream-offline-failed',
  });
  t.after(() => controller.abort());
  let ready;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      ready = JSON.parse(await readFile(readyPath, 'utf8'));
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assert.ok(ready, 'fixture started before cancellation');
  controller.abort();
  await outcome;
  assert.throws(() => process.kill(ready.pid, 0), { code: 'ESRCH' });
  await assert.rejects(stat(ready.home), { code: 'ENOENT' });
});

test('an already canceled probe never launches its fixture', async (t) => {
  const { root, childPath } = await fixture(t, '');
  const sentinel = join(root, 'started');
  await writeFile(
    childPath,
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'bad');`,
  );
  await assert.rejects(probePiStream({ childPath, signal: AbortSignal.abort() }), {
    message: 'pi-stream-offline-failed',
  });
  await assert.rejects(readFile(sentinel), { code: 'ENOENT' });
});
