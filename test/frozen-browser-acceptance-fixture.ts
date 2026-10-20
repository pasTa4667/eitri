import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FrozenBrowserValidator, frozenBrowserRequest } from '../src/frozen-browser.ts';
import { sha256 } from '../src/workspace.ts';
import type { WorkspaceStore } from '../src/workspace.ts';
import { journalRows } from './controller-worker-association-fixture.ts';

export async function acceptanceFixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'eitri-worker-acceptance-')));
  const directory = join(root, 'journal');
  await mkdir(directory, { mode: 0o700 });
  let reads = 0;
  let clients = 0;
  const workspace = new Proxy({} as WorkspaceStore, {
    get() {
      reads++;
      throw Error('forbidden-frozen-read');
    },
  });
  const prototype = FrozenBrowserValidator.prototype;
  const client = Reflect.get(prototype, 'client');
  Reflect.set(prototype, 'client', () => {
    clients++;
    throw Error('forbidden-client');
  });
  const raw = await FrozenBrowserValidator.open({ directory, workspace });
  assert.throws(() => Reflect.get(workspace, 'readFrozen'), /forbidden-frozen-read/);
  assert.throws(() => Reflect.get(raw, 'client')(), /forbidden-client/);
  assert.deepEqual({ reads, clients }, { reads: 1, clients: 1 });
  reads = clients = 0;
  await raw.close();
  const { meta } = journalRows(directory);
  const expectedIdentity = {
    ownerId: meta.owner as string,
    configurationDigest: sha256(meta.configurationDigest),
  };
  const options = { directory, workspace, expectedIdentity, mode: 'acceptance-only' as const };
  const caseId = randomUUID();
  const request = frozenBrowserRequest({
    frozen: { caseId, revision: 'a'.repeat(40), manifestDigest: 'b'.repeat(64) },
    action: { caseId, actionId: randomUUID(), epoch: 1 },
    scenarioId: 'synthetic-click-v1',
    role: 'baseline',
    allowanceMs: 60000,
  });
  const handles: { close(): Promise<void> }[] = [];
  t.after(async () => {
    try {
      await Promise.all(handles.map((h) => h.close()));
      assert.deepEqual({ reads, clients }, { reads: 0, clients: 0 });
    } finally {
      Reflect.set(prototype, 'client', client);
      await rm(root, { recursive: true, force: true });
    }
  });
  return {
    root,
    directory,
    options,
    request,
    async open() {
      const handle = await FrozenBrowserValidator.open(options);
      handles.push(handle);
      return handle;
    },
  };
}
