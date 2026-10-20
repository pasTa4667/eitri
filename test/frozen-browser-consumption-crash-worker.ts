import { DatabaseSync } from 'node:sqlite';
import { FrozenBrowserValidator } from '../src/frozen-browser.ts';
import { forbiddenWorkspace } from './controller-worker-association-fixture.ts';
import { WorkspaceStore, virtualPath } from '../src/workspace.ts';
import { join } from 'node:path';

const [directory, identity, accepted, point] = process.argv.slice(2);
const workspace =
  point === 'execution' || point === 'recorded'
    ? await WorkspaceStore.open({
        directory: join(directory, '..', 'workspace'),
        regressionDirectory: virtualPath('test/regression'),
      })
    : forbiddenWorkspace;
const journal = await FrozenBrowserValidator.open({
  directory,
  workspace,
  mode: 'consumption-only',
  expectedIdentity: JSON.parse(identity),
});
const original = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function (sql) {
  if (sql !== 'COMMIT' || point === 'execution') return Reflect.apply(original, this, [sql]);
  if (point === 'recorded') {
    const row = this.prepare('SELECT body FROM runs WHERE id=1').get();
    const result = Reflect.apply(original, this, [sql]);
    if (JSON.parse(String(row?.body)).execution.run.result.kind !== 'recorded') return result;
  } else if (point === 'after') Reflect.apply(original, this, [sql]);
  process.send?.('consumption-staged');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};
if (point === 'execution') {
  const client = Reflect.get(FrozenBrowserValidator.prototype, 'client');
  Reflect.set(
    FrozenBrowserValidator.prototype,
    'client',
    async function (this: FrozenBrowserValidator, ...args: unknown[]) {
      const result = await Reflect.apply(client, this, args);
      if ((args[0] as string[])[0] === 'start') {
        process.send?.('consumption-executed');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      }
      return result;
    },
  );
}
await journal.consume(JSON.parse(accepted), () => 60000, new AbortController().signal);
throw Error('missed-consumption-checkpoint');
