import { DatabaseSync } from 'node:sqlite';
import { FrozenBrowserValidator } from '../src/frozen-browser.ts';
import { forbiddenWorkspace } from './controller-worker-association-fixture.ts';

const [encoded, point] = process.argv.slice(2);
const options = { ...JSON.parse(encoded), workspace: forbiddenWorkspace };
const checkpoint = () => {
  process.send?.('cleanup-checkpoint');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};
const originalExec = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function (sql) {
  if (sql === 'COMMIT') {
    const run = JSON.parse(String(this.prepare('SELECT body FROM runs WHERE id=1').get()?.body))
      .execution.run;
    const match =
      point === 'normalized'
        ? run.result.kind === 'recorded' && run.ledger.container.kind === 'intent'
        : point === 'acquired'
          ? run.result.kind === 'recorded' && run.ledger.container.kind === 'acquired'
          : point === 'settlement-before' || point === 'settlement-after'
            ? run.result.kind === 'settled'
            : false;
    if (match) {
      if (point !== 'settlement-before') Reflect.apply(originalExec, this, [sql]);
      checkpoint();
    }
  }
  return Reflect.apply(originalExec, this, [sql]);
};
if (point === 'removed') {
  const originalClient = Reflect.get(FrozenBrowserValidator.prototype, 'client');
  Reflect.set(
    FrozenBrowserValidator.prototype,
    'client',
    async function (this: FrozenBrowserValidator, ...args: unknown[]) {
      const result = await Reflect.apply(originalClient, this, args);
      const words = args[0] as string[];
      if (words[0] === 'container' && words[1] === 'rm') checkpoint();
      return result;
    },
  );
}
await FrozenBrowserValidator.reconcileConsumed(options);
throw Error('missed-cleanup-checkpoint');
