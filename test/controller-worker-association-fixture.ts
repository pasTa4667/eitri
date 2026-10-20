import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import type { FauxResponseStep } from '@earendil-works/pi-ai/providers/faux';
import { Controller } from '../src/controller.ts';
import { FrozenBrowserValidator } from '../src/frozen-browser.ts';
import type { FrozenBrowserRequest } from '../src/frozen-browser.ts';
import { digest } from '../src/domain.ts';
import type { Check, CheckExecution, Intent } from '../src/domain.ts';
import { repositoryId, virtualPath, WorkspaceStore } from '../src/workspace.ts';

export const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
export const offline = () => ({
  repositoryId: repositoryId('11111111-1111-4111-8111-111111111111'),
  regressionDirectory: virtualPath('regression'),
  baseline: [{ virtualPath: virtualPath('src/value.ts'), bytes: Buffer.from('literal A\n') }],
});
export const command = (intent: Intent, expectedControlVersion?: number) => ({
  requestId: randomUUID(),
  intent,
  expectedControlVersion,
});
export const investigate = () =>
  command({
    type: 'investigate',
    issue: {
      ...policy,
      id: 'association',
      title: 'Offline association',
      priority: 'high',
      status: 'unresolved',
      regressed: false,
      escalating: false,
    },
  });
export const receipt = (kind: Check['kind']): CheckExecution => ({
  type: 'completed',
  check: {
    kind,
    candidate: 'a'.repeat(40),
    configuration: 'b'.repeat(64),
    passed: true,
    simulated: true,
    outputs: [],
  },
});
export const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
export async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 15000;
  while (true) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline) assert.fail(`Timed out ${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
export function sources(directory: string) {
  const db = new DatabaseSync(join(directory, 'catalogue.sqlite'), { readOnly: true });
  try {
    return db
      .prepare('SELECT value FROM action_sources ORDER BY rowid')
      .all()
      .map((r) => JSON.parse(String(r.value)));
  } finally {
    db.close();
  }
}
export function journalRows(directory: string) {
  const db = new DatabaseSync(join(directory, 'journal.sqlite'), { readOnly: true });
  try {
    return {
      meta: JSON.parse(String(db.prepare('SELECT body FROM meta').get()?.body)),
      runs: db
        .prepare('SELECT body FROM runs ORDER BY id')
        .all()
        .map((r) => JSON.parse(String(r.body))),
    };
  } finally {
    db.close();
  }
}
export function seedRun(directory: string, request: FrozenBrowserRequest, pending = false) {
  request = structuredClone(request);
  const { meta } = journalRows(directory);
  const runId = '22222222-2222-4222-8222-222222222222';
  const run = {
    intent: {
      runId,
      request,
      requestDigest: digest(request),
      configurationDigest: meta.configurationDigest,
      nonce: 'c'.repeat(64),
      owner: meta.owner,
      imageTag: `eitri-frozen-browser:${runId}`,
      containerName: `eitri-frozen-browser-${runId}`,
      admittedAt: 1000,
      deadline: 1000 + request.allowanceMs,
      reservation: 41943040,
    },
    ledger: { build: 'not-started', image: { kind: 'none' }, container: { kind: 'none' } },
    result: pending
      ? { kind: 'pending' }
      : {
          kind: 'recorded',
          outcome: { kind: 'uncertain', code: 'fixture-uncertain' },
          evidence: null,
        },
  };
  const db = new DatabaseSync(join(directory, 'journal.sqlite'));
  try {
    db.exec('BEGIN IMMEDIATE; DELETE FROM runs;');
    meta.attempts = 1;
    meta.contribution = 41943040;
    db.prepare('UPDATE meta SET body=?,digest=?').run(JSON.stringify(meta), digest(meta));
    db.prepare('INSERT INTO runs VALUES(1,?,?)').run(JSON.stringify(run), digest(run));
    db.exec('COMMIT');
  } finally {
    db.close();
  }
  return run;
}
export const forbiddenWorkspace = new Proxy({} as WorkspaceStore, {
  get() {
    throw Error('worker-touched-workspace');
  },
});
export function providerFor(
  controller: () => Controller,
  kind: Check['kind'] = 'browser',
  implementation = false,
) {
  return (id: string) => {
    const faux = fauxProvider({ tokensPerSecond: 100000 });
    const respond: FauxResponseStep = async () => {
      const view = (await controller().snapshot({ selected: id })).selected!;
      const c = view.case;
      if (implementation && (c.phase === 'triage' || (c.phase === 'investigation' && c.base)))
        return fauxAssistantMessage(
          fauxToolCall('complete_assessment', {
            phase: c.phase,
            expectedControlVersion: c.version,
            conclusion: 'progress',
            reason: 'Synthetic offline progression',
            evidenceIds: view.checks.map((c) => c.id),
            proposal: 'Change synthetic value',
            paths: ['src/value.ts'],
          }),
          { stopReason: 'toolUse' },
        );
      return fauxAssistantMessage(
        fauxToolCall('run_check', {
          kind: implementation && c.phase === 'investigation' ? 'baseline' : kind,
        }),
        { stopReason: 'toolUse' },
      );
    };
    faux.setResponses(
      implementation
        ? Array.from({ length: 20 }, () => respond)
        : [respond, fauxAssistantMessage('Done')],
    );
    return { provider: faux.provider, modelId: faux.getModel().id };
  };
}
export async function fixture(
  t: TestContext,
  extra: Partial<Parameters<typeof Controller.open>[0]> = {},
  kind: Check['kind'] = 'browser',
  implementation = false,
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'eitri-worker-association-')));
  const directory = join(root, 'controller');
  const journalDirectory = join(root, 'journal');
  await mkdir(journalDirectory, { mode: 0o700 });
  const validator = await FrozenBrowserValidator.open({
    directory: journalDirectory,
    workspace: forbiddenWorkspace,
  });
  await validator.close();
  const { meta } = journalRows(journalDirectory);
  const bin = join(root, 'bin');
  await mkdir(bin);
  const log = join(root, 'worker-called');
  await writeFile(
    join(bin, 'docker'),
    `#!${process.execPath}\nimport {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(log)},'worker-called'); process.exitCode=97;\n`,
    { mode: 0o700 },
  );
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  const validate = FrozenBrowserValidator.prototype.validate;
  let workerCalls = 0;
  FrozenBrowserValidator.prototype.validate = async function () {
    workerCalls++;
    throw Error('forbidden-worker-invocation');
  };
  let controller: Controller;
  let closed = false;
  const options = {
    directory,
    policy,
    offlineWorkspace: offline(),
    offlineWorkerJournal: {
      directory: journalDirectory,
      ownerId: meta.owner as string,
      configurationDigest: meta.configurationDigest as string,
    },
    providerForCase: providerFor(() => controller, kind, implementation),
    ...extra,
  };
  t.after(async () => {
    try {
      if (!closed) await controller?.close();
      assert.equal(workerCalls, 0);
      await assert.rejects(readFile(log), { code: 'ENOENT' });
    } finally {
      FrozenBrowserValidator.prototype.validate = validate;
      process.env.PATH = oldPath;
      await rm(root, { recursive: true, force: true });
    }
  });
  controller = await Controller.open(options);
  return {
    root,
    directory,
    journalDirectory,
    options,
    get controller() {
      return controller;
    },
    async close() {
      await controller.close();
      closed = true;
    },
    async reopen() {
      controller = await Controller.open(options);
      closed = false;
    },
    async add() {
      return (await controller.command(investigate())).caseId!;
    },
    async parked(id: string) {
      return until(
        async () => (await controller.snapshot()).cases.find((c) => c.id === id)!,
        (c) => c.status === 'needs-attention',
      );
    },
  };
}
