import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fork } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../../../', import.meta.url)));
const { Controller } = await import(pathToFileURL(join(root, 'src/controller.ts')).href);
const { WorkspaceStore, caseId, repositoryId, virtualPath } = await import(
  pathToFileURL(join(root, 'src/workspace.ts')).href
);
const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import(
  pathToFileURL(join(root, 'node_modules/@earendil-works/pi-ai/dist/providers/faux.js')).href
);
const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-foreign-provision-parent-')));
const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
const repo = repositoryId('11111111-1111-4111-8111-111111111111');
const regressionDirectory = virtualPath('regression');
const path = virtualPath('src/value.ts');
let child;
let store;
let controller;
let stopped = false;
try {
  child = fork(
    join(root, 'test/controller-workspace-crash-worker.ts'),
    [directory, 'after-workspace-provision-intent'],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const event = await Promise.race([
    once(child, 'message', { signal: AbortSignal.timeout(15000) }).then(([value]) => value),
    once(child, 'exit').then(() => {
      throw new Error('Crash child exited early ' + stderr);
    }),
  ]);
  assert.equal(event.point, 'after-workspace-provision-intent');
  const exit = once(child, 'exit');
  child.kill('SIGKILL');
  await exit;
  stopped = true;
  store = await WorkspaceStore.open({
    directory: join(directory, 'workspaces'),
    regressionDirectory,
  });
  const replacement = await store.provision({
    caseId: caseId(event.id),
    repositoryId: repo,
    baseline: [{ virtualPath: path, bytes: Buffer.from('literal C\n') }],
  });
  assert.equal(replacement.state, 'ready');
  assert.equal(replacement.checkpoint.sequence, 0);
  await store.close();
  store = undefined;
  const faux = fauxProvider({ tokensPerSecond: 100000 });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('run_check', { kind: 'browser' }), { stopReason: 'toolUse' }),
  ]);
  let callbacks = 0;
  let observed = '';
  controller = await Controller.open({
    directory,
    policy,
    offlineWorkspace: {
      repositoryId: repo,
      regressionDirectory,
      baseline: [{ virtualPath: path, bytes: Buffer.from('literal A\n') }],
    },
    providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
    check: async (_request, source) => {
      callbacks++;
      observed = Buffer.from((await source.readSelected())[0].bytes).toString();
      return { type: 'infrastructure' };
    },
  });
  let c;
  const deadline = Date.now() + 10000;
  do {
    c = (await controller.snapshot()).cases[0];
    if (c.status === 'needs-attention') break;
    assert(Date.now() < deadline, 'Recovery did not settle');
    await new Promise((r) => setTimeout(r, 5));
  } while (Date.now() <= deadline);
  assert.equal(c.status, 'needs-attention', 'Recovery did not settle');
  const db = new DatabaseSync(join(directory, 'catalogue.sqlite'), { readOnly: true });
  let binding;
  try {
    binding = JSON.parse(db.prepare('SELECT value FROM workspace_bindings').get().value);
  } finally {
    db.close();
  }
  console.log(
    JSON.stringify(
      {
        configured: 'literal A\n',
        replacement: 'literal C\n',
        callbacks,
        observed,
        status: c.status,
        reason: c.reason,
        native: c.native,
        binding: binding.state,
      },
      null,
      2,
    ),
  );
  assert.equal(callbacks, 0, 'Foreign initial source must not reach callback');
  assert.equal(binding.state, 'uncertain', 'Foreign initial source must park the binding');
  assert.equal(c.native, 'ready');
} finally {
  if (child && !stopped && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
  await controller?.close();
  await store?.close();
  await rm(directory, { recursive: true, force: true });
}
