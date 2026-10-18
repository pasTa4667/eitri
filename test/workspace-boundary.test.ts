import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { WorkspaceStore, caseId, repositoryId, requestId, virtualPath } from '../src/workspace.ts';

test('workspace boundary accepts copied bytes and one edit only, never source paths or extra operations', async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-workspace-boundary-')));
  const store = await WorkspaceStore.open({
    directory,
    regressionDirectory: virtualPath('test/regression'),
  });
  t.after(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const id = caseId(randomUUID()),
    repo = repositoryId(randomUUID());
  const baseline = [{ virtualPath: virtualPath('src/main.ts'), bytes: Buffer.from('A') }];
  const extraSource = { caseId: id, repositoryId: repo, baseline, sourcePath: '/unowned' };
  await assert.rejects(store.provision(extraSource), /invalid-workspace-fields/);
  const extraFile = [{ ...baseline[0], sourcePath: '/unowned' }];
  await assert.rejects(
    store.provision({ caseId: id, repositoryId: repo, baseline: extraFile }),
    /invalid-workspace-fields/,
  );
  assert.deepEqual(await readdir(join(directory, 'cases')), []);
  const workspace = await store.provision({ caseId: id, repositoryId: repo, baseline });
  assert.equal(workspace.state, 'ready');
  if (workspace.state !== 'ready') throw new Error('not ready');
  const old = await store.read(id, baseline[0].virtualPath);
  const extraEdit = {
    requestId: requestId(randomUUID()),
    virtualPath: baseline[0].virtualPath,
    expectedHash: old.sha256,
    bytes: Buffer.from('B'),
    delete: ['README.md'],
  };
  await assert.rejects(
    store.edit(id, workspace.checkpoint.revision, extraEdit),
    /invalid-workspace-fields/,
  );
  assert.equal((await store.read(id, baseline[0].virtualPath)).bytes.toString(), 'A');
});
