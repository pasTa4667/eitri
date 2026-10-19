import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import ts from 'typescript';

const checkout = await realpath(process.argv[2]);
const source = await readFile(join(checkout, 'test/integration/frozen-browser.test.ts'), 'utf8');
const start = source.indexOf('  const cleanups:');
assert.notEqual(start, -1, 'fixture must expose its local finalizer implementation');
const end = source.indexOf('  console.log(', start);
assert.ok(end > start);
const lifecycle = ts.transpile(source.slice(start, end));
function fixtureLifecycle() {
  let finalize;
  const defer = new Function('t', `${lifecycle}\nreturn defer;`)({
    after: (hook) => {
      assert.equal(finalize, undefined);
      finalize = hook;
    },
  });
  assert.equal(typeof finalize, 'function');
  return { defer, finalize };
}
const owner = fixtureLifecycle();
const calls = [];
const validatorFailure = new Error('validator-close-failure');
const childFailure = new Error('child-teardown-failure');
owner.defer(async () => {
  calls.push('store');
});
owner.defer(async () => {
  calls.push('validator');
  throw validatorFailure;
});
owner.defer(async () => {
  calls.push('child');
  throw childFailure;
});
await assert.rejects(owner.finalize(), (error) => {
  assert.ok(error instanceof AggregateError);
  assert.deepEqual(error.errors, [childFailure, validatorFailure]);
  return true;
});
assert.deepEqual(calls, ['child', 'validator', 'store']);
const partial = fixtureLifecycle();
let storeClosed = false;
partial.defer(async () => {
  storeClosed = true;
});
await partial.finalize();
assert.equal(storeClosed, true);
console.log('Verified all fixture cleanup attempts, both failures, and partial-setup closure.');

const childStart = source.indexOf("    const childClosed = once(child, 'close');");
assert.notEqual(childStart, -1);
const childEnd = source.indexOf("    await once(child.stdout, 'data');", childStart);
assert.ok(childEnd > childStart);
const childCleanup = ts.transpile(source.slice(childStart, childEnd));
const child = spawn(
  process.execPath,
  ['-e', "process.stdout.write('ready'); process.kill(process.pid, 'SIGSTOP');"],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
let cleanup;
try {
  new Function('child', 'once', 'f', childCleanup)(child, once, {
    defer: (callback) => {
      cleanup = callback;
    },
  });
  await once(child.stdout, 'data');
  assert.equal(typeof cleanup, 'function');
  await cleanup();
  assert.equal(child.signalCode, 'SIGKILL');
  console.log('Verified fixture child cleanup kills and awaits a real stopped helper.');
} finally {
  clearTimeout(timer);
  child.kill('SIGKILL');
}
