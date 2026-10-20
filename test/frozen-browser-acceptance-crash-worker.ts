import { DatabaseSync } from 'node:sqlite';
import { FrozenBrowserValidator } from '../src/frozen-browser.ts';
import { forbiddenWorkspace } from './controller-worker-association-fixture.ts';

const [directory, identity, request, point] = process.argv.slice(2);
const journal = await FrozenBrowserValidator.open({
  directory,
  workspace: forbiddenWorkspace,
  mode: 'acceptance-only',
  expectedIdentity: JSON.parse(identity),
});
const original = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function (sql) {
  if (sql !== 'COMMIT') return Reflect.apply(original, this, [sql]);
  const row = this.prepare('SELECT body FROM runs ORDER BY id DESC LIMIT 1').get();
  const record = JSON.parse(String(row?.body));
  if (point === 'after') Reflect.apply(original, this, [sql]);
  process.send?.({ record });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};
await journal.accept(JSON.parse(request), () => true);
throw Error('missed-checkpoint');
