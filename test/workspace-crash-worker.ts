import { WorkspaceStore, caseId, repositoryId, requestId, virtualPath } from '../src/workspace.ts';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const [directory, point, caseValue, repositoryValue, requestValue] = process.argv.slice(2);
const id = caseId(caseValue),
  repo = repositoryId(repositoryValue),
  request = requestId(requestValue);
let previous = '';
const store = await WorkspaceStore.open({
  directory,
  regressionDirectory: virtualPath('test/regression'),
  fault: async (current) => {
    let transaction: DatabaseSync | undefined;
    if (point === 'inside-journal-transaction' && current === 'after-intent') {
      transaction = new DatabaseSync(join(directory, 'journal.sqlite'));
      transaction.exec('PRAGMA cache_size=1; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;');
      transaction.prepare('UPDATE journal SET body=?').run('uncommitted'.repeat(400000));
    } else if (current !== point) return;
    const keepAlive = setInterval(() => {}, 1000);
    process.send?.({ point, previous });
    await new Promise<void>(() => {});
    clearInterval(keepAlive);
    transaction?.close();
  },
});
const workspace = await store.provision({
  caseId: id,
  repositoryId: repo,
  baseline: [{ virtualPath: virtualPath('src/main.ts'), bytes: Buffer.from('A') }],
});
if (workspace.state !== 'ready') throw new Error('provision did not become ready');
previous = workspace.checkpoint.revision;
const initial = await store.read(id, virtualPath('src/main.ts'));
await store.edit(id, workspace.checkpoint.revision, {
  requestId: request,
  virtualPath: virtualPath('src/main.ts'),
  expectedHash: initial.sha256,
  bytes: Buffer.from('B'),
});
throw new Error('crash boundary not reached');
