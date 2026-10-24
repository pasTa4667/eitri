import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Controller } from '../src/controller.ts';
import type { OfflineWorkspaceOptions } from '../src/controller.ts';
import { digest } from '../src/domain.ts';
import type { AdmittedCheckRequest } from '../src/domain.ts';
import {
  fixture,
  offline,
  receipt,
  sources,
  journalRows,
  seedRun,
  providerFor,
  investigate,
  until,
} from './controller-worker-association-fixture.ts';

function workspaceMetadata(directory: string) {
  const db = new DatabaseSync(join(directory, 'catalogue.sqlite'), { readOnly: true });
  try {
    return JSON.parse(
      String(db.prepare("SELECT value FROM metadata WHERE key='offline_workspace'").get()?.value),
    );
  } finally {
    db.close();
  }
}

for (const workerScenarioId of [
  undefined,
  'synthetic-click-v1',
  'profile-name-v1',
  'fixture-profile-v1',
  'fixture-cart-v1',
] as const)
  for (const kind of ['baseline', 'browser'] as const)
    test(`${workerScenarioId ?? 'omitted'} routes ${kind} and preserves detached historical requests`, async (t) => {
      let admitted!: AdmittedCheckRequest;
      let callbacks = 0;
      const f = await fixture(
        t,
        {
          offlineWorkspace: {
            ...offline(),
            ...(workerScenarioId === undefined ? {} : { workerScenarioId }),
          },
          clock: () => 1000,
          check: async (request) => {
            callbacks++;
            admitted = request;
            return receipt(request.kind);
          },
        },
        kind,
      );
      const beforeJournal = journalRows(f.journalDirectory);
      assert.deepEqual(beforeJournal, {
        meta: {
          version: 1,
          owner: f.options.offlineWorkerJournal!.ownerId,
          configurationDigest: f.options.offlineWorkerJournal!.configurationDigest,
          attempts: 0,
          contribution: 0,
        },
        runs: [],
      });
      const id = await f.add();
      await f.parked(id);
      const observed = await f.controller.inspectWorkerAssociation(id, admitted.actionId);
      assert.equal(observed.state, 'absent');
      if (observed.state !== 'absent') return assert.fail('Expected persisted worker request');
      const expected = {
        frozen: sources(f.directory)[0].frozen,
        action: { caseId: id, actionId: admitted.actionId, epoch: admitted.epoch },
        scenarioId: workerScenarioId ?? 'synthetic-click-v1',
        role: kind === 'baseline' ? 'baseline' : 'candidate',
        allowanceMs: 60000,
      };
      assert.deepEqual(observed.intent, { request: expected, requestDigest: digest(expected) });
      assert.deepEqual(journalRows(f.journalDirectory), beforeJournal);
      if (workerScenarioId === undefined || workerScenarioId === 'synthetic-click-v1')
        assert.deepEqual(workspaceMetadata(f.directory), {
          version: 1,
          sourceDigest: 'bb068ea61113578ffd05d60a573ef9acbf07bab9eec3728dba7f568e493ebede',
          state: 'ready',
        });
      seedRun(f.journalDirectory, observed.intent.request);
      const history = await f.controller.inspectWorkerAssociation(id, admitted.actionId);
      const saved = structuredClone(history);
      if (history.state !== 'matched') return assert.fail('Expected exact journal match');
      Object.assign(history.intent.request, { scenarioId: 'forged' });
      Object.assign(history.run.request.action, { epoch: 999 });
      assert.deepEqual(await f.controller.inspectWorkerAssociation(id, admitted.actionId), saved);
      const savedJournal = journalRows(f.journalDirectory);
      const savedSources = sources(f.directory);
      await f.close();
      await assert.rejects(
        Controller.open({
          ...f.options,
          offlineWorkspace: {
            ...offline(),
            workerScenarioId:
              workerScenarioId === 'profile-name-v1' ? 'synthetic-click-v1' : 'profile-name-v1',
          },
        }),
        { code: 'offline-workspace-configuration-mismatch' },
      );
      if (workerScenarioId === undefined)
        Object.assign(f.options.offlineWorkspace!, { workerScenarioId: 'synthetic-click-v1' });
      await f.reopen();
      assert.deepEqual(await f.controller.inspectWorkerAssociation(id, admitted.actionId), saved);
      assert.deepEqual(sources(f.directory), savedSources);
      assert.deepEqual(journalRows(f.journalDirectory), savedJournal);
      assert.equal(callbacks, 1);
    });

test('one selector read and baseline copy before the first await resist immediate caller mutation', async (t) => {
  let reads = 0;
  let selected: NonNullable<OfflineWorkspaceOptions['workerScenarioId']> = 'profile-name-v1';
  const config = offline();
  const f = await fixture(t);
  await f.close();
  const opening = Controller.open({
    ...f.options,
    directory: join(f.root, 'captured-controller'),
    offlineWorkspace: {
      ...config,
      get workerScenarioId(): NonNullable<OfflineWorkspaceOptions['workerScenarioId']> {
        reads++;
        return selected;
      },
    },
    clock: () => 1000,
    providerForCase: providerFor(() => controller),
    check: async (request, source) => {
      assert.equal(Buffer.from((await source!.readSelected())[0].bytes).toString(), 'literal A\n');
      return receipt(request.kind);
    },
  });
  selected = 'synthetic-click-v1';
  config.baseline[0].bytes.fill(0);
  const controller = await opening;
  t.after(() => controller.close());
  const id = (await controller.command(investigate())).caseId!;
  const view = await until(
    async () => (await controller.snapshot({ selected: id })).selected!,
    (view) => view.case.status === 'needs-attention',
  );
  assert.equal(view.checks.length, 1);
  assert.equal(view.checks[0].kind, 'browser');
  const saved = sources(join(f.root, 'captured-controller'))[0];
  assert.equal(saved.workerIntent.request.scenarioId, 'profile-name-v1');
  assert.equal(reads, 1);
});

for (const value of [null, '', 'other', 1, true, {}, [], new String('profile-name-v1')])
  test(`rejects malformed scenario ${JSON.stringify(value)} without coercion`, async (t) => {
    const f = await fixture(t);
    await f.close();
    await assert.rejects(
      Controller.open({
        ...f.options,
        offlineWorkspace: {
          ...offline(),
          workerScenarioId: value,
        } as unknown as OfflineWorkspaceOptions,
      }),
      { code: 'invalid-offline-worker-scenario' },
    );
  });

for (const workerScenarioId of [
  'synthetic-click-v1',
  'profile-name-v1',
  'fixture-profile-v1',
  'fixture-cart-v1',
] as const)
  test(`explicit ${workerScenarioId} requires a journal even on an empty catalogue`, async (t) => {
    const f = await fixture(t);
    await f.close();
    await assert.rejects(
      Controller.open({
        ...f.options,
        offlineWorkspace: { ...offline(), workerScenarioId },
        offlineWorkerJournal: undefined,
      }),
      { code: 'offline-worker-scenario-journal-required' },
    );
  });

test('source-only omission and explicit undefined remain valid and default-equivalent on reopen', async (t) => {
  const f = await fixture(t, { offlineWorkerJournal: undefined });
  assert.equal(
    workspaceMetadata(f.directory).sourceDigest,
    'bb068ea61113578ffd05d60a573ef9acbf07bab9eec3728dba7f568e493ebede',
  );
  await f.close();
  const controller = await Controller.open({
    ...f.options,
    offlineWorkspace: { ...offline(), workerScenarioId: undefined },
  });
  await controller.close();
});

for (const initial of [undefined, 'profile-name-v1'] as const)
  test(`empty established ${initial ?? 'default'} catalogue rejects scenario switching`, async (t) => {
    const f = await fixture(t, { offlineWorkspace: { ...offline(), workerScenarioId: initial } });
    await f.close();
    await assert.rejects(
      Controller.open({
        ...f.options,
        offlineWorkspace: {
          ...offline(),
          workerScenarioId: initial === undefined ? 'profile-name-v1' : 'synthetic-click-v1',
        },
      }),
      { code: 'offline-workspace-configuration-mismatch' },
    );
    await f.reopen();
    assert.equal((await f.controller.snapshot()).cases.length, 0);
  });

test('omitted, undefined and explicit synthetic share an established source identity', async (t) => {
  const f = await fixture(t);
  await f.close();
  for (const workerScenarioId of [undefined, 'synthetic-click-v1'] as const) {
    const controller = await Controller.open({
      ...f.options,
      offlineWorkspace: { ...offline(), workerScenarioId },
    });
    assert.equal((await controller.snapshot()).cases.length, 0);
    await controller.close();
  }
});

for (const kind of ['checkpoint', 'unit', 'regression', 'build'] as const)
  test(`profile selection does not add a worker intent to ${kind}`, async (t) => {
    const f = await fixture(
      t,
      {
        offlineWorkspace: { ...offline(), workerScenarioId: 'profile-name-v1' },
        check: async (request) => receipt(request.kind),
      },
      kind,
    );
    const id = await f.add();
    await f.parked(id);
    const saved = sources(f.directory)[0];
    assert.equal(saved.kind, kind);
    assert.equal(Object.hasOwn(saved, 'workerIntent'), false);
    assert.equal((await f.controller.snapshot({ selected: id })).selected!.checks[0].kind, kind);
  });

test('interrupted profile intent is historical authority and is never replayed after reopen', async (t) => {
  let callbacks = 0;
  let action = '';
  const f = await fixture(t, {
    offlineWorkspace: { ...offline(), workerScenarioId: 'profile-name-v1' },
    check: async (request) => {
      callbacks++;
      action = request.actionId;
      return { type: 'infrastructure' };
    },
  });
  const id = await f.add();
  await f.parked(id);
  const original = await f.controller.inspectWorkerAssociation(id, action);
  assert.equal(original.state, 'absent');
  if (original.state !== 'absent') return assert.fail('Expected retained intent');
  assert.equal(original.intent.request.scenarioId, 'profile-name-v1');
  await f.close();
  const savedJournal = journalRows(f.journalDirectory);
  await f.reopen();
  assert.deepEqual(await f.controller.inspectWorkerAssociation(id, action), original);
  const saved = sources(f.directory)[0];
  assert.equal(saved.state, 'interrupted');
  assert.deepEqual(saved.workerIntent, original.intent);
  assert.equal(callbacks, 1);
  assert.deepEqual(journalRows(f.journalDirectory), savedJournal);
});
