import type { TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from '../src/domain.ts';
import { FrozenBrowserValidator, frozenBrowserRequest } from '../src/frozen-browser.ts';
import type {
  FrozenBrowserAcceptance,
  FrozenBrowserConsumedRunKey,
} from '../src/frozen-browser.ts';
import { sha256 } from '../src/workspace.ts';
import { consumptionFixture } from './frozen-browser-consumption-fixture.ts';
import { forbiddenWorkspace, journalRows } from './controller-worker-association-fixture.ts';

export function writeRows(directory: string, rows: ReturnType<typeof journalRows>) {
  const db = new DatabaseSync(join(directory, 'journal.sqlite'));
  try {
    db.exec('BEGIN IMMEDIATE; DELETE FROM runs;');
    db.prepare('UPDATE meta SET body=?,digest=?').run(JSON.stringify(rows.meta), digest(rows.meta));
    rows.runs.forEach((row: unknown, index: number) =>
      db.prepare('INSERT INTO runs VALUES(?,?,?)').run(index + 1, JSON.stringify(row), digest(row)),
    );
    db.exec('COMMIT');
  } finally {
    db.close();
  }
}

export function consumedRecord(accepted: FrozenBrowserAcceptance, pending = false) {
  const runId = randomUUID();
  return {
    kind: 'consumed-acceptance',
    acceptance: { kind: 'offline-acceptance', ...structuredClone(accepted) },
    execution: {
      admission: {
        kind: 'current-action-allowance',
        translatedAt: 1000,
        translatedAllowanceMs: 12345,
      },
      run: {
        intent: {
          runId,
          request: structuredClone(accepted.request),
          requestDigest: accepted.requestDigest,
          configurationDigest: accepted.configurationDigest,
          owner: accepted.ownerId,
          nonce: 'c'.repeat(64),
          imageTag: `eitri-frozen-browser:${runId}`,
          containerName: `eitri-frozen-browser-${runId}`,
          admittedAt: 1000,
          deadline: 13345,
          reservation: 41943040,
        },
        ledger: {
          build: 'completed',
          image: { kind: 'acquired', id: 'sha256:' + 'd'.repeat(64) },
          container: { kind: 'acquired', id: 'c'.repeat(64) },
        },
        result: pending
          ? { kind: 'pending' }
          : {
              kind: 'recorded',
              outcome: { kind: 'uncertain', code: 'fixture-uncertain' },
              evidence: null,
            },
      },
    },
  };
}

export function selector(record: ReturnType<typeof consumedRecord>): FrozenBrowserConsumedRunKey {
  return {
    acceptanceId: record.acceptance.acceptanceId,
    runId: record.execution.run.intent.runId,
    requestDigest: record.acceptance.requestDigest,
  };
}

export function otherAcceptance(accepted: FrozenBrowserAcceptance): FrozenBrowserAcceptance {
  const request = frozenBrowserRequest({
    ...accepted.request,
    action: { ...accepted.request.action, actionId: randomUUID() },
  });
  return {
    ...accepted,
    acceptanceId: randomUUID(),
    request,
    requestDigest: sha256(digest(request)),
  };
}

export async function cleanupFixture(t: TestContext, pending = false) {
  const f = await consumptionFixture(t);
  await f.journal.close();
  const rows = journalRows(f.directory);
  const record = consumedRecord(f.accepted, pending);
  rows.meta.version = 3;
  rows.meta.attempts = 1;
  rows.meta.contribution = 41943040;
  rows.runs = [record];
  writeRows(f.directory, rows);
  const statePath = join(f.root, 'transcript.json');
  const { intent } = record.execution.run;
  await writeFile(
    statePath,
    JSON.stringify({
      mode: 'normal',
      calls: [],
      image: true,
      tag: intent.imageTag,
      labels: {
        'eitri.frozen-browser.owner': f.accepted.ownerId,
        'eitri.frozen-browser.run': intent.runId,
      },
      container: {
        Id: 'c'.repeat(64),
        Name: '/' + intent.containerName,
        Config: {
          Labels: {
            'eitri.frozen-browser.owner': f.accepted.ownerId,
            'eitri.frozen-browser.run': intent.runId,
          },
        },
        State: { Status: 'exited' },
      },
    }),
  );
  const options = {
    directory: f.directory,
    workspace: forbiddenWorkspace,
    expectedIdentity: { ...f.options.expectedIdentity },
    consumedRun: selector(record),
  };
  return {
    ...f,
    rows,
    record,
    cleanupOptions: options,
    reconcile: () => FrozenBrowserValidator.reconcileConsumed(options),
  };
}
