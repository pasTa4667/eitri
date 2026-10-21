import { DatabaseSync } from 'node:sqlite';
import { mkdir, chmod, lstat, open, realpath, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Provider } from '@earendil-works/pi-ai/models';
import {
  WorkspaceStore,
  workspaceLimits,
  caseId,
  repositoryId,
  requestId,
  virtualPath,
  gitRevision,
  sha256,
} from './workspace.ts';
import type {
  RepositoryId,
  VirtualPath,
  BaselineFile,
  BrokerEdit,
  GitRevision,
  SavedReceipt,
  FrozenRevision,
  WorkspaceCheckpoint,
} from './workspace.ts';
import {
  FrozenBrowserValidator,
  frozenBrowserRequest,
  admitFrozenBrowserConsumedReport,
} from './frozen-browser.ts';
import type {
  FrozenBrowserRequest,
  RecoveryInventory,
  RecoveryRecord,
  FrozenBrowserAcceptance,
  FrozenBrowserAdmissionObservation,
  FrozenBrowserConsumption,
  FrozenBrowserConsumedRunKey,
  FrozenBrowserConsumedReport,
  FrozenBrowserConsumedExpectation,
  FrozenBrowserAdmission,
  HistoricalWorkerSelection,
} from './frozen-browser.ts';
import { NativeCase } from './native.ts';
import type { DispatchedCheckExecution } from './native.ts';
import type { NativeExecutionAnchor } from './native-browser-check.ts';
import { WorkerExecutionScope } from './worker-execution-scope.ts';
import { ArtifactStore, artifactLimits, validateOutput } from './artifacts.ts';
import {
  ControlError,
  actionDeadlineAt,
  digest,
  fail,
  issueKey,
  parseCommand,
  phases,
  statuses,
  nativeStates,
  text,
  uuid,
} from './domain.ts';
import type {
  Action,
  AdmittedCheckRequest,
  ArtifactOutput,
  Assessment,
  Case,
  Check,
  CheckExecution,
  CheckCallbackResult,
  Issue,
  Receipt,
  Selection,
  Snapshot,
} from './domain.ts';

export type OfflineWorkspaceOptions = Readonly<{
  repositoryId: RepositoryId;
  regressionDirectory: VirtualPath;
  baseline: readonly BaselineFile[];
}>;
export type OfflineActionWorkspace = Readonly<{
  workerAcceptance?: Readonly<{ accept(): Promise<FrozenBrowserAcceptance> }>;
  workerConsumption?: Readonly<{ consume(): Promise<FrozenBrowserConsumption> }>;
  selection: FrozenRevision;
  readSelected(): Promise<readonly BaselineFile[]>;
  edit(expectedRevision: GitRevision, input: Omit<BrokerEdit, 'requestId'>): Promise<SavedReceipt>;
}>;
export type OfflineWorkerJournalOptions = Readonly<{
  directory: string;
  ownerId: string;
  configurationDigest: string;
}>;
type WorkerJournalBinding = OfflineWorkerJournalOptions & Readonly<{ version: 1 }>;
type WorkerIntent = Readonly<{ request: FrozenBrowserRequest; requestDigest: string }>;
export type WorkerAssociationObservation =
  | Readonly<{ state: 'unrecorded' }>
  | Readonly<{ state: 'absent'; intent: WorkerIntent }>
  | Readonly<{ state: 'conflict'; intent: WorkerIntent; runs: readonly RecoveryRecord[] }>
  | Readonly<{ state: 'matched'; intent: WorkerIntent; run: RecoveryRecord }>;
type Historical<T> = Readonly<{ provenance: 'worker-journal'; value: T }>;
type WorkerExecutionFacts = Readonly<{
  consumedRun: FrozenBrowserConsumedRunKey;
  admittedAt: number;
  deadline: number;
}>;
export type WorkerExecutionFactsObservation =
  | Readonly<{
      state: 'unavailable';
      reason: 'no-worker-intent' | 'not-retained-by-controller';
    }>
  | Readonly<{
      state: 'retained';
      provenance: 'controller-live-consumption';
      intent: WorkerIntent;
      binding: WorkerJournalBinding;
      facts: WorkerExecutionFacts;
    }>;
type IndependentExecutionPins = WorkerExecutionFactsObservation;
export type WorkerConsumedHistoryObservation =
  | Readonly<{ state: 'unrecorded' }>
  | Readonly<{ state: 'absent'; intent: WorkerIntent }>
  | Readonly<{
      state: 'conflict';
      intent: WorkerIntent;
      reason: 'request-mismatch' | 'legacy-execution';
      observed: Historical<HistoricalWorkerSelection>;
    }>
  | Readonly<{
      state: 'accepted-unconsumed';
      intent: WorkerIntent;
      acceptance: Historical<FrozenBrowserAcceptance>;
      independentExecutionPins: IndependentExecutionPins;
    }>
  | Readonly<{
      state: 'consumed';
      intent: WorkerIntent;
      acceptance: Historical<FrozenBrowserAcceptance>;
      history: Historical<FrozenBrowserConsumedReport>;
      independentExecutionPins: IndependentExecutionPins;
    }>;
type ConsumedObservation = Extract<WorkerConsumedHistoryObservation, { state: 'consumed' }>;
type SettledHistory = Extract<FrozenBrowserConsumedReport, { state: 'settled' }>;
type UnsettledHistory = Exclude<FrozenBrowserConsumedReport, { state: 'settled' }>;
type RetainedPins = Extract<IndependentExecutionPins, { state: 'retained' }>;
type UnavailablePins = Extract<IndependentExecutionPins, { state: 'unavailable' }>;
type ConsumedWith<H extends FrozenBrowserConsumedReport, P extends IndependentExecutionPins> = Omit<
  ConsumedObservation,
  'history' | 'independentExecutionPins'
> &
  Readonly<{ history: Historical<H>; independentExecutionPins: P }>;
export type WorkerConsumedAdmissionObservation =
  | Exclude<WorkerConsumedHistoryObservation, { state: 'consumed' }>
  | (ConsumedWith<UnsettledHistory, IndependentExecutionPins> &
      Readonly<{ conversion: Readonly<{ state: 'not-settled' }> }>)
  | (ConsumedWith<SettledHistory, UnavailablePins> &
      Readonly<{ conversion: Readonly<{ state: 'independent-pins-unavailable' }> }>)
  | (ConsumedWith<SettledHistory, RetainedPins> &
      Readonly<{
        conversion: Readonly<{ state: 'converted'; admission: FrozenBrowserAdmission }>;
      }>);
type WorkspaceBinding = Readonly<{
  caseId: string;
  repositoryId: RepositoryId;
  sourceDigest: string;
}> &
  (
    | Readonly<{ state: 'planned' }>
    | Readonly<{ state: 'provisioning' }>
    | Readonly<{ state: 'ready'; baseRevision: GitRevision }>
    | Readonly<{ state: 'uncertain'; reason: string }>
  );
type ActionSourceAuthority = Readonly<{
  action: Readonly<Action>;
  kind: Check['kind'];
  workerIntent?: WorkerIntent;
}> &
  (
    | Readonly<{ state: 'selecting'; expected: WorkspaceCheckpoint }>
    | Readonly<{ state: 'selected'; frozen: FrozenRevision }>
    | Readonly<{ state: 'settled'; frozen: FrozenRevision }>
    | Readonly<{ state: 'interrupted'; reason: string; frozen: FrozenRevision | null }>
  );
type ActionSource = ActionSourceAuthority &
  Readonly<{
    workerExecutionFacts?: WorkerExecutionFacts;
  }>;
type WorkerExecutionCapture = Readonly<{
  source: Extract<ActionSourceAuthority, { state: 'selected' }> &
    Readonly<{ workerIntent: WorkerIntent }>;
  binding: WorkerJournalBinding;
}>;
type Options = {
  directory: string;
  policy: { project: string; environment: string; repository: string };
  providerForCase(id: string): { provider: Provider; modelId: string };
  clock?: () => number;
  actionWakeup?: (delayMs: number, callback: () => void) => () => void;
  capacity?: number;
  allowanceMs?: number;
  probe?: (id: string, signal: AbortSignal) => Promise<string>;
  offlineWorkspace?: OfflineWorkspaceOptions;
  offlineWorkerJournal?: OfflineWorkerJournalOptions;
  offlineWorkerAcceptance?: true;
  offlineWorkerConsumption?: true;
  check?: (
    request: AdmittedCheckRequest,
    source?: OfflineActionWorkspace,
  ) => Promise<CheckCallbackResult>;
  issues?: () => Promise<Issue[]>;
  fault?: (point: string, caseId: string) => void;
};
const openDirectories = new Set<string>();
const terminalRetentionMs = 30 * 24 * 60 * 60 * 1000;

export class Controller {
  directory: string;
  bootId = randomUUID();
  private db: DatabaseSync;
  private options: Options;
  private clock: () => number;
  private runtimes = new Map<string, Promise<NativeCase>>();
  private runners = new Map<string, Promise<void>>();
  private watchers = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private closing = false;
  private closure?: Promise<void>;
  private workerScopes = new Map<Action, WorkerExecutionScope>();
  private workerDrains = new Set<Promise<void>>();
  private workerDrainFailed = false;
  private workerInspections = new Set<Promise<unknown>>();
  private starting = true;
  private tickScheduled = false;
  private polling = false;
  private sequence = 0;
  private allowance: number;
  private workspaces?: WorkspaceStore;
  private workspaceQueue: Promise<unknown> = Promise.resolve();
  private sourceDigest?: string;
  private completions = new WeakMap<
    Action,
    Pick<Case, 'epoch' | 'attempt' | 'status' | 'version'>
  >();

  private constructor(directory: string, db: DatabaseSync, options: Options) {
    this.directory = directory;
    this.db = db;
    this.options = options;
    let last = 0;
    this.clock = () => {
      const now = options.clock
        ? options.clock()
        : Math.floor(performance.timeOrigin + performance.now());
      if (!Number.isSafeInteger(now) || now < last) return fail('invalid-clock');
      last = now;
      return now;
    };
    this.allowance = Math.min(options.allowanceMs ?? 600_000, 600_000);
  }
  static async open(options: Options) {
    options = { ...options };
    if (options.offlineWorkerConsumption !== undefined && options.offlineWorkerConsumption !== true)
      fail('invalid-offline-worker-consumption');
    if (
      options.offlineWorkerConsumption &&
      (!options.offlineWorkspace ||
        !options.offlineWorkerJournal ||
        !options.offlineWorkerAcceptance)
    )
      fail('offline-worker-consumption-configuration-required');
    if (options.offlineWorkerAcceptance !== undefined && options.offlineWorkerAcceptance !== true)
      fail('invalid-offline-worker-acceptance');
    if (
      options.offlineWorkerAcceptance &&
      (!options.offlineWorkspace || !options.offlineWorkerJournal)
    )
      fail('offline-worker-acceptance-configuration-required');
    if (options.offlineWorkerJournal !== undefined) {
      const journal = options.offlineWorkerJournal;
      if (
        !journal ||
        typeof journal !== 'object' ||
        Array.isArray(journal) ||
        !options.offlineWorkspace ||
        !hasFields(journal, ['directory', 'ownerId', 'configurationDigest']) ||
        !text(journal.directory, 4096) ||
        !uuid(journal.ownerId) ||
        journal.ownerId !== journal.ownerId.toLowerCase()
      )
        fail('invalid-offline-worker-journal');
      options.offlineWorkerJournal = {
        directory: resolve(journal.directory),
        ownerId: journal.ownerId,
        configurationDigest: sha256(journal.configurationDigest),
      };
    }
    if (options.offlineWorkspace) {
      const offline = options.offlineWorkspace;
      if (!Array.isArray(offline.baseline) || offline.baseline.length > workspaceLimits.files)
        fail('workspace-size-limit');
      options = {
        ...options,
        offlineWorkspace: {
          repositoryId: repositoryId(offline.repositoryId),
          regressionDirectory: virtualPath(offline.regressionDirectory),
          baseline: offline.baseline.map((file) => {
            if (
              !file ||
              !hasFields(file, ['virtualPath', 'bytes']) ||
              !(file.bytes instanceof Uint8Array) ||
              file.bytes.byteLength > workspaceLimits.fileBytes
            )
              return fail('workspace-file-size-limit');
            return { virtualPath: virtualPath(file.virtualPath), bytes: Buffer.from(file.bytes) };
          }),
        },
      };
    }
    const directory = resolve(options.directory);
    if (
      !Number.isSafeInteger(options.capacity ?? 1) ||
      (options.capacity ?? 1) < 1 ||
      (options.capacity ?? 1) > 2 ||
      !Number.isSafeInteger(options.allowanceMs ?? 600_000) ||
      (options.allowanceMs ?? 600_000) < 1 ||
      (options.allowanceMs ?? 600_000) > 600_000
    )
      fail('invalid-runtime-limits');
    if (openDirectories.has(directory)) fail('controller-already-open');
    openDirectories.add(directory);
    let controller: Controller | undefined;
    let db: DatabaseSync | undefined;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if ((await lstat(directory)).isSymbolicLink() || (await realpath(directory)) !== directory)
        fail('unsafe-data-directory');
      await chmod(directory, 0o700);
      await mkdir(join(directory, 'cases'), { mode: 0o700 }).catch((error) => {
        if (error.code !== 'EEXIST') throw error;
      });
      if (
        !(await lstat(join(directory, 'cases'))).isDirectory() ||
        (await lstat(join(directory, 'cases'))).isSymbolicLink()
      )
        fail('unsafe-cases-directory');
      const catalogue = join(directory, 'catalogue.sqlite');
      await open(catalogue, 'wx', 0o600)
        .then((f) => f.close())
        .catch((error) => {
          if (error.code !== 'EEXIST') throw error;
        });
      if (!(await lstat(catalogue)).isFile() || (await lstat(catalogue)).isSymbolicLink())
        fail('unsafe-catalogue');
      db = new DatabaseSync(catalogue);
      db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT OR IGNORE INTO metadata VALUES ('schema', '1');
        CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, issue_key TEXT NOT NULL, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS guards (issue_key TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES cases(id));
        CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, digest TEXT NOT NULL, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), text TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, case_id TEXT NOT NULL UNIQUE REFERENCES cases(id), value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS workspace_bindings (case_id TEXT PRIMARY KEY REFERENCES cases(id), value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS action_sources (action_id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), value TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS action_sources_case ON action_sources(case_id);
      `);
      if (db.prepare("SELECT value FROM metadata WHERE key='schema'").get()?.value !== '1')
        fail('unsupported-schema');
      controller = new Controller(directory, db, options);
      await controller.openWorkspaces();
      await controller.openWorkerJournalBinding();
      await controller.recover();
      controller.starting = false;
      controller.schedule();
      return controller;
    } catch (error) {
      if (controller)
        await Promise.allSettled(
          [...controller.runtimes.values()].map(async (p) => (await p).close()),
        );
      await Promise.allSettled([controller?.workspaces?.close()]);
      db?.close();
      openDirectories.delete(directory);
      throw error;
    }
  }
  private async openWorkspaces() {
    const row = this.db.prepare("SELECT value FROM metadata WHERE key='offline_workspace'").get();
    const offline = this.options.offlineWorkspace;
    if (!offline) {
      if (
        row ||
        this.db.prepare('SELECT case_id FROM workspace_bindings LIMIT 1').get() ||
        this.db.prepare('SELECT action_id FROM action_sources LIMIT 1').get()
      )
        fail('offline-workspace-required');
      return;
    }
    this.sourceDigest = offlineSourceDigest(offline);
    if (row) {
      const saved = JSON.parse(String(row.value));
      if (
        !saved ||
        !hasFields(saved, ['version', 'sourceDigest', 'state']) ||
        saved.version !== 1 ||
        saved.sourceDigest !== this.sourceDigest ||
        !['opening', 'ready'].includes(saved.state)
      )
        fail('offline-workspace-configuration-mismatch');
    } else {
      if (this.db.prepare('SELECT id FROM cases LIMIT 1').get())
        fail('offline-workspace-migration-required');
      this.db.prepare('INSERT INTO metadata VALUES (?,?)').run(
        'offline_workspace',
        JSON.stringify({
          version: 1,
          sourceDigest: this.sourceDigest,
          state: 'opening',
        }),
      );
    }
    const directory = join(this.directory, 'workspaces');
    if (!row) await mkdir(directory, { mode: 0o700 });
    else {
      for (const name of ['workspace-owner', 'journal.sqlite']) {
        const stat = await lstat(join(directory, name));
        if (!stat.isFile() || stat.isSymbolicLink()) fail('offline-workspace-store-missing');
      }
    }
    this.workspaces = await WorkspaceStore.open({
      directory,
      regressionDirectory: offline.regressionDirectory,
      fault: (point, id) => this.options.fault?.(`workspace-${point}`, id),
    });
    this.db.prepare("UPDATE metadata SET value=? WHERE key='offline_workspace'").run(
      JSON.stringify({
        version: 1,
        sourceDigest: this.sourceDigest,
        state: 'ready',
      }),
    );
  }
  private async workerInventory(binding: WorkerJournalBinding): Promise<RecoveryInventory> {
    const journal = await FrozenBrowserValidator.open({
      directory: binding.directory,
      workspace: this.workspaces!,
      mode: 'journal-only',
      expectedIdentity: {
        ownerId: binding.ownerId,
        configurationDigest: sha256(binding.configurationDigest),
      },
    });
    try {
      return await journal.inventory();
    } finally {
      await journal.close();
    }
  }
  private async openWorkerJournalBinding() {
    const row = this.db
      .prepare("SELECT value FROM metadata WHERE key='offline_worker_journal'")
      .get();
    const configured = this.options.offlineWorkerJournal;
    if (!configured) {
      if (row) fail('offline-worker-journal-required');
      return;
    }
    const binding: WorkerJournalBinding = { version: 1, ...configured };
    if (row && digest(JSON.parse(String(row.value))) !== digest(binding))
      fail('offline-worker-journal-configuration-mismatch');
    await this.workerInventory(binding);
    if (!row)
      this.db
        .prepare('INSERT INTO metadata VALUES (?,?)')
        .run('offline_worker_journal', JSON.stringify(binding));
  }
  inspectWorkerAssociation(id: string, actionId: string): Promise<WorkerAssociationObservation> {
    const inspection = this.readWorkerAssociation(id, actionId);
    this.workerInspections.add(inspection);
    void inspection.finally(() => this.workerInspections.delete(inspection)).catch(() => {});
    return inspection;
  }
  private async readWorkerAssociation(
    id: string,
    actionId: string,
  ): Promise<WorkerAssociationObservation> {
    if (!uuid(id) || !uuid(actionId)) fail('invalid-worker-association-id');
    if (this.closing) fail('controller-closed');
    const configured = this.options.offlineWorkerJournal ?? fail('offline-worker-journal-required');
    const reading = await this.workspaceSerial(async () => {
      for (const scope of this.workerScopes.values()) {
        const inventory = scope.inventory();
        if (inventory) return { inventory };
      }
      return {
        inventory: Promise.resolve(await this.workerInventory({ version: 1, ...configured })),
      };
    });
    const inventory = await reading.inventory;
    const source = this.source(id, actionId);
    const intent = source.workerIntent;
    if (!intent) return { state: 'unrecorded' };
    const runs = inventory.runs.filter(
      (run) =>
        run.request.action.caseId === intent.request.action.caseId &&
        run.request.action.actionId === intent.request.action.actionId &&
        run.request.action.epoch === intent.request.action.epoch,
    );
    if (runs.length === 0) return structuredClone({ state: 'absent', intent });
    const run = runs[0];
    if (
      runs.length !== 1 ||
      !isDeepStrictEqual(run.request, intent.request) ||
      digest(run.request) !== intent.requestDigest ||
      digest(intent.request) !== intent.requestDigest ||
      run.requestDigest !== intent.requestDigest ||
      run.configurationDigest !== configured.configurationDigest
    )
      return structuredClone({ state: 'conflict', intent, runs });
    return structuredClone({ state: 'matched', intent, run });
  }
  private workerJournalBinding(): WorkerJournalBinding {
    const row = this.db
      .prepare("SELECT value FROM metadata WHERE key='offline_worker_journal'")
      .get();
    const configured = this.options.offlineWorkerJournal ?? fail('offline-worker-journal-required');
    const binding = row ? JSON.parse(String(row.value)) : fail('invalid-worker-journal-binding');
    if (
      !binding ||
      !hasFields(binding, ['version', 'directory', 'ownerId', 'configurationDigest']) ||
      !isDeepStrictEqual(binding, { version: 1, ...configured })
    )
      fail('invalid-worker-journal-binding');
    return binding;
  }
  private retainWorkerExecutionFacts(
    capture: WorkerExecutionCapture,
    observation: FrozenBrowserAdmissionObservation,
  ): undefined {
    this.transaction(() => {
      const original = capture.source;
      const current = this.source(original.action.caseId, original.action.id);
      const binding = this.workerJournalBinding();
      if (
        !isDeepStrictEqual(binding, capture.binding) ||
        current.state === 'selecting' ||
        !current.frozen ||
        !isDeepStrictEqual(current.action, original.action) ||
        current.kind !== original.kind ||
        !isDeepStrictEqual(current.frozen, original.frozen) ||
        !isDeepStrictEqual(current.workerIntent, original.workerIntent)
      )
        fail('worker-execution-facts-conflict');
      const facts = validateLiveWorkerExecutionFacts(capture, observation);
      if (current.workerExecutionFacts) {
        if (!isDeepStrictEqual(current.workerExecutionFacts, facts))
          fail('worker-execution-facts-conflict');
        return;
      }
      this.db
        .prepare('UPDATE action_sources SET value=? WHERE action_id=?')
        .run(JSON.stringify({ ...current, workerExecutionFacts: facts }), original.action.id);
    });
  }
  inspectWorkerExecutionFacts(id: string, actionId: string): WorkerExecutionFactsObservation {
    if (!uuid(id) || !uuid(actionId)) fail('invalid-worker-association-id');
    if (this.closing) fail('controller-closed');
    const source = this.source(id, actionId);
    if (!source.workerIntent) return { state: 'unavailable', reason: 'no-worker-intent' };
    return this.workerExecutionFactsObservation(source, this.workerJournalBinding());
  }
  private workerExecutionFactsObservation(
    source: ActionSource,
    binding: WorkerJournalBinding,
  ): WorkerExecutionFactsObservation {
    if (!source.workerIntent) return { state: 'unavailable', reason: 'no-worker-intent' };
    if (!source.workerExecutionFacts)
      return { state: 'unavailable', reason: 'not-retained-by-controller' };
    return structuredClone({
      state: 'retained',
      provenance: 'controller-live-consumption',
      intent: source.workerIntent,
      binding,
      facts: source.workerExecutionFacts,
    });
  }
  /** Correlates retained intent with historical data, not independent execution authority. */
  inspectWorkerConsumedHistory(
    id: string,
    actionId: string,
  ): Promise<WorkerConsumedHistoryObservation> {
    const inspection = this.readWorkerConsumedHistory(id, actionId);
    this.workerInspections.add(inspection);
    void inspection.finally(() => this.workerInspections.delete(inspection)).catch(() => {});
    return inspection;
  }
  /** Offline scenario observations, never a receipt or current authority. */
  inspectWorkerConsumedAdmission(
    id: string,
    actionId: string,
  ): Promise<WorkerConsumedAdmissionObservation> {
    const history = this.inspectWorkerConsumedHistory(id, actionId);
    const inspection = history.then(consumedAdmissionObservation);
    this.workerInspections.add(inspection);
    void inspection.finally(() => this.workerInspections.delete(inspection)).catch(() => {});
    return inspection;
  }
  private async readWorkerConsumedHistory(
    id: string,
    actionId: string,
  ): Promise<WorkerConsumedHistoryObservation> {
    if (!uuid(id) || !uuid(actionId)) fail('invalid-worker-association-id');
    if (this.closing) fail('controller-closed');
    const configured = this.options.offlineWorkerJournal ?? fail('offline-worker-journal-required');
    const binding = { ...configured };
    const source = this.source(id, actionId);
    if (!source.workerIntent) return { state: 'unrecorded' };
    const intent = structuredClone(source.workerIntent);
    const independentExecutionPins = this.workerExecutionFactsObservation(
      source,
      this.workerJournalBinding(),
    );
    return this.workspaceSerial(async (): Promise<WorkerConsumedHistoryObservation> => {
      if (this.workerScopes.size !== 0) fail('worker-history-busy');
      const selected = await FrozenBrowserValidator.readHistoricalSelection({
        directory: binding.directory,
        expectedIdentity: {
          ownerId: binding.ownerId,
          configurationDigest: sha256(binding.configurationDigest),
        },
        action: intent.request.action,
      });
      if (!selected) return structuredClone({ state: 'absent', intent });
      const observed = selected.kind === 'legacy-execution' ? selected : selected.acceptance;
      if (
        !isDeepStrictEqual(observed.request, intent.request) ||
        digest(observed.request) !== intent.requestDigest ||
        digest(intent.request) !== intent.requestDigest ||
        observed.requestDigest !== intent.requestDigest ||
        observed.configurationDigest !== binding.configurationDigest
      )
        return structuredClone({
          state: 'conflict',
          intent,
          reason: 'request-mismatch',
          observed: { provenance: 'worker-journal', value: selected },
        });
      if (selected.kind === 'legacy-execution')
        return structuredClone({
          state: 'conflict',
          intent,
          reason: 'legacy-execution',
          observed: { provenance: 'worker-journal', value: selected },
        });
      return structuredClone({
        intent,
        acceptance: { provenance: 'worker-journal', value: selected.acceptance },
        independentExecutionPins,
        ...(selected.kind === 'consumed'
          ? {
              state: 'consumed',
              history: { provenance: 'worker-journal' as const, value: selected.history },
            }
          : { state: 'accepted-unconsumed' }),
      });
    });
  }
  private workspaceSerial<T>(work: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new ControlError('controller-closed'));
    const next = this.workspaceQueue.then(work);
    this.workspaceQueue = next.catch(() => {});
    return next;
  }
  private saveBinding(binding: WorkspaceBinding) {
    this.db
      .prepare(
        'INSERT INTO workspace_bindings VALUES (?,?) ON CONFLICT(case_id) DO UPDATE SET value=excluded.value',
      )
      .run(binding.caseId, JSON.stringify(binding));
  }
  private binding(id: string): WorkspaceBinding {
    const row = this.db.prepare('SELECT value FROM workspace_bindings WHERE case_id=?').get(id);
    const b: WorkspaceBinding = row
      ? JSON.parse(String(row.value))
      : fail('workspace-binding-missing');
    if (
      !b ||
      b.caseId !== id ||
      !uuid(b.caseId) ||
      b.repositoryId !== this.options.offlineWorkspace?.repositoryId ||
      b.sourceDigest !== this.sourceDigest ||
      !['planned', 'provisioning', 'ready', 'uncertain'].includes(b.state)
    )
      fail('invalid-workspace-binding');
    repositoryId(b.repositoryId);
    if (
      !hasFields(b, [
        'caseId',
        'repositoryId',
        'sourceDigest',
        'state',
        ...(b.state === 'ready' ? ['baseRevision'] : b.state === 'uncertain' ? ['reason'] : []),
      ])
    )
      fail('invalid-workspace-binding');
    if (b.state === 'ready') gitRevision(b.baseRevision);
    if (b.state === 'uncertain' && !text(b.reason, 512)) fail('invalid-workspace-binding');
    return b;
  }
  private workspaceReady(id: string): boolean {
    return !this.options.offlineWorkspace || this.binding(id).state === 'ready';
  }
  private parkWorkspace(id: string, error: unknown) {
    const reason = error instanceof ControlError ? error.code : 'workspace-recovery-failed';
    this.transaction(() => {
      this.saveBinding({
        caseId: id,
        repositoryId: this.options.offlineWorkspace!.repositoryId,
        sourceDigest: this.sourceDigest!,
        state: 'uncertain',
        reason,
      });
      const c = this.get(id);
      if (c.status === 'terminal') {
        c.warning = reason;
        c.version++;
      } else if (c.status === 'paused' || c.status === 'pause-requested') {
        c.reason = reason;
        c.version++;
      } else this.attention(c, reason);
      this.save(c);
    });
  }
  private async ensureWorkspace(id: string) {
    if (!this.options.offlineWorkspace) return;
    await this.workspaceSerial(async () => {
      try {
        const binding = this.binding(id);
        if (binding.state === 'uncertain') return;
        let workspace;
        if (binding.state === 'planned') {
          this.saveBinding({ ...binding, state: 'provisioning' });
          this.options.fault?.('after-workspace-provision-intent', id);
          workspace = await this.workspaces!.provision({
            caseId: caseId(id),
            repositoryId: binding.repositoryId,
            baseline: this.options.offlineWorkspace!.baseline,
          });
          this.options.fault?.('after-workspace-provision-effect', id);
        } else workspace = await this.workspaces!.inspect(caseId(id));
        if (
          workspace.caseId !== id ||
          workspace.repositoryId !== binding.repositoryId ||
          workspace.state !== 'ready'
        )
          return fail('workspace-binding-not-ready');
        if (binding.state === 'ready') {
          if (workspace.baseRevision !== binding.baseRevision) fail('workspace-base-mismatch');
        } else {
          if (
            workspace.checkpoint.revision !== workspace.baseRevision ||
            workspace.checkpoint.sequence !== 0
          )
            fail('workspace-provisioning-uncertain');
          const frozen = await this.workspaces!.freeze(caseId(id), workspace.baseRevision);
          const baseline = await this.workspaces!.readFrozen(frozen, new AbortController().signal);
          if (
            offlineSourceDigest({ ...this.options.offlineWorkspace!, baseline }) !==
            binding.sourceDigest
          )
            fail('workspace-initial-source-mismatch');
          this.saveBinding({ ...binding, state: 'ready', baseRevision: workspace.baseRevision });
        }
      } catch (error) {
        this.parkWorkspace(id, error);
      }
    });
  }
  private saveSource(source: ActionSource) {
    this.db
      .prepare(
        'INSERT INTO action_sources VALUES (?,?,?) ON CONFLICT(action_id) DO UPDATE SET value=excluded.value',
      )
      .run(source.action.id, source.action.caseId, JSON.stringify(source));
  }
  private source(id: string, actionId: string): ActionSource {
    const row = this.db
      .prepare('SELECT case_id,value FROM action_sources WHERE action_id=?')
      .get(actionId);
    const s: ActionSource = row ? JSON.parse(String(row.value)) : fail('action-source-missing');
    if (
      !s ||
      row!.case_id !== id ||
      s.action?.caseId !== id ||
      s.action.id !== actionId ||
      !['baseline', 'checkpoint', 'unit', 'regression', 'build', 'browser'].includes(s.kind) ||
      !['selecting', 'selected', 'settled', 'interrupted'].includes(s.state)
    )
      fail('invalid-action-source');
    if (
      !hasFields(s, [
        'action',
        'kind',
        'state',
        ...(s.workerIntent === undefined ? [] : ['workerIntent']),
        ...(Object.hasOwn(s, 'workerExecutionFacts') ? ['workerExecutionFacts'] : []),
        ...(s.state === 'selecting'
          ? ['expected']
          : s.state === 'interrupted'
            ? ['reason', 'frozen']
            : ['frozen']),
      ])
    )
      fail('invalid-action-source');
    validateSourceAction(s.action, this.get(id));
    if (s.state === 'selecting') {
      const e = s.expected;
      if (
        !e ||
        !hasFields(e, ['revision', 'tree', 'manifestDigest', 'sequence']) ||
        !Number.isSafeInteger(e.sequence) ||
        e.sequence < 0 ||
        e.sequence > workspaceLimits.receipts
      )
        fail('invalid-action-source');
      gitRevision(e.revision);
      gitRevision(e.tree);
      sha256(e.manifestDigest);
    } else if (s.frozen !== null) {
      if (s.frozen?.caseId !== id || !hasFields(s.frozen, ['caseId', 'revision', 'manifestDigest']))
        fail('foreign-action-source');
      gitRevision(s.frozen.revision);
      sha256(s.frozen.manifestDigest);
    } else if (s.state !== 'interrupted') fail('invalid-action-source');
    if (s.state === 'interrupted' && !text(s.reason, 512)) fail('invalid-action-source');
    if (s.workerIntent !== undefined) {
      const intent = s.workerIntent;
      if (
        !this.options.offlineWorkerJournal ||
        !intent ||
        !hasFields(intent, ['request', 'requestDigest']) ||
        s.state === 'selecting' ||
        !s.frozen ||
        (s.kind !== 'baseline' && s.kind !== 'browser')
      )
        return fail('invalid-worker-intent');
      const request = frozenBrowserRequest(intent.request);
      if (
        digest(request) !== intent.requestDigest ||
        digest(request.frozen) !== digest(s.frozen) ||
        request.action.caseId !== s.action.caseId ||
        request.action.actionId !== s.action.id ||
        request.action.epoch !== s.action.epoch ||
        request.role !== (s.kind === 'baseline' ? 'baseline' : 'candidate') ||
        request.allowanceMs > s.action.limitMs
      )
        fail('invalid-worker-intent');
    }
    if (Object.hasOwn(s, 'workerExecutionFacts')) {
      if (!s.workerIntent) return fail('invalid-worker-execution-facts');
      validateRetainedWorkerExecutionFacts(s.workerExecutionFacts, s.workerIntent);
    }
    return s;
  }
  private captureConsumedCheckAuthority(id: string, supplied: Action, signal: AbortSignal) {
    const action = structuredClone(supplied);
    const capture = () => {
      const { c } = this.checkAllowance(id, action, signal);
      const source = this.source(id, action.id);
      if (
        source.state !== 'selected' ||
        !sameAction(source.action, action) ||
        (source.kind !== 'baseline' && source.kind !== 'browser') ||
        !source.workerIntent ||
        !source.workerExecutionFacts
      )
        return fail('consumed-check-authority-unavailable');
      const workspace = this.binding(id);
      const revision =
        source.kind === 'baseline'
          ? (c.base ?? (workspace.state === 'ready' ? workspace.baseRevision : null))
          : c.candidate;
      if (!revision || source.frozen.revision !== revision) fail('consumed-check-revision-changed');
      const binding = this.workerJournalBinding();
      const anchor: NativeExecutionAnchor = {
        action,
        kind: source.kind,
        frozen: source.frozen,
        intent: source.workerIntent,
        binding: {
          version: 1,
          ownerId: binding.ownerId,
          configurationDigest: binding.configurationDigest,
        },
        facts: source.workerExecutionFacts,
      };
      return structuredClone({ anchor, source, binding });
    };
    const original = capture();
    return {
      anchor: structuredClone(original.anchor),
      assertCurrent: () => {
        if (!isDeepStrictEqual(capture(), original)) fail('consumed-check-authority-changed');
      },
    };
  }
  private sourceAuthority(id: string, action: Action, signal: AbortSignal, live: () => boolean) {
    if (!live()) fail('action-source-revoked');
    const { c } = this.checkAllowance(id, action, signal);
    if (c.status !== 'running') fail('check-dispatch-denied');
    return c;
  }
  private async selectActionSource(
    id: string,
    action: Action,
    kind: Check['kind'],
    signal: AbortSignal,
    live: () => boolean,
  ): Promise<OfflineActionWorkspace> {
    return this.workspaceSerial(async () => {
      this.sourceAuthority(id, action, signal, live);
      if (this.db.prepare('SELECT action_id FROM action_sources WHERE action_id=?').get(action.id))
        fail('action-source-already-selected');
      const workspace = await this.workspaces!.inspect(caseId(id)).catch((error) => {
        this.parkWorkspace(id, error);
        throw error;
      });
      this.sourceAuthority(id, action, signal, live);
      const binding = this.binding(id);
      if (
        binding.state !== 'ready' ||
        workspace.state !== 'ready' ||
        workspace.repositoryId !== binding.repositoryId ||
        workspace.baseRevision !== binding.baseRevision
      ) {
        this.parkWorkspace(id, new ControlError('workspace-binding-not-ready'));
        return fail('workspace-binding-not-ready');
      }
      this.saveSource({
        action: { ...action },
        kind,
        state: 'selecting',
        expected: workspace.checkpoint,
      });
      this.options.fault?.('after-source-selection-intent', id);
      const frozen = await this.workspaces!.freeze(caseId(id), workspace.checkpoint.revision).catch(
        (error) => {
          this.parkWorkspace(id, error);
          throw error;
        },
      );
      this.options.fault?.('after-source-freeze', id);
      this.sourceAuthority(id, action, signal, live);
      this.saveSource({ action: { ...action }, kind, state: 'selected', frozen });
      this.options.fault?.('after-source-selection-receipt', id);
      return Object.freeze({
        selection: Object.freeze({ ...frozen }),
        readSelected: () => this.readSelectedSource(id, action, kind, signal, live),
        edit: (expected: GitRevision, input: Omit<BrokerEdit, 'requestId'>) =>
          this.editActionSource(id, action, kind, expected, input, signal, live),
      });
    });
  }
  private selectedSource(id: string, action: Action, kind: Check['kind']) {
    const source = this.source(id, action.id);
    if (source.state !== 'selected' || source.kind !== kind || !sameAction(source.action, action))
      return fail('action-source-not-selected');
    return source.frozen;
  }
  private async readSelectedSource(
    id: string,
    action: Action,
    kind: Check['kind'],
    signal: AbortSignal,
    live: () => boolean,
  ): Promise<readonly BaselineFile[]> {
    return this.workspaceSerial(async () => {
      this.sourceAuthority(id, action, signal, live);
      let files: readonly BaselineFile[];
      try {
        files = await this.workspaces!.readFrozen(this.selectedSource(id, action, kind), signal);
      } catch (error) {
        if (!signal.aborted && !this.closing) this.parkWorkspace(id, error);
        throw error;
      }
      this.sourceAuthority(id, action, signal, live);
      return files;
    });
  }
  private async editActionSource(
    id: string,
    action: Action,
    kind: Check['kind'],
    expected: GitRevision,
    input: Omit<BrokerEdit, 'requestId'>,
    signal: AbortSignal,
    live: () => boolean,
  ): Promise<SavedReceipt> {
    if (
      !input ||
      !hasFields(input, ['virtualPath', 'expectedHash', 'bytes']) ||
      !(input.bytes instanceof Uint8Array) ||
      input.bytes.byteLength > workspaceLimits.fileBytes
    )
      return fail('workspace-file-size-limit');
    const copied: BrokerEdit = {
      virtualPath: input.virtualPath,
      expectedHash: input.expectedHash,
      bytes: Buffer.from(input.bytes),
      requestId: requestId(randomUUID()),
    };
    return this.workspaceSerial(async () => {
      if (this.sourceAuthority(id, action, signal, live).phase !== 'implementation')
        fail('workspace-edit-phase-denied');
      this.selectedSource(id, action, kind);
      let receipt: SavedReceipt;
      try {
        receipt = await this.workspaces!.edit(caseId(id), expected, copied);
      } catch (error) {
        const workspace = await this.workspaces!.inspect(caseId(id)).catch(() => null);
        if (!workspace || workspace.state !== 'ready') this.parkWorkspace(id, error);
        throw error;
      }
      this.options.fault?.('after-source-edit-effect', id);
      this.sourceAuthority(id, action, signal, live);
      return receipt;
    });
  }
  private async recoverSources(id: string) {
    if (!this.options.offlineWorkspace) return;
    try {
      for (const row of this.db
        .prepare('SELECT action_id FROM action_sources WHERE case_id=?')
        .all(id)) {
        const s = this.source(id, String(row.action_id));
        const live = this.db
          .prepare('SELECT value FROM actions WHERE id=? AND case_id=?')
          .get(s.action.id, id);
        if (s.state === 'selecting' || s.state === 'selected')
          this.saveSource({
            action: s.action,
            kind: s.kind,
            ...(s.workerIntent ? { workerIntent: s.workerIntent } : {}),
            ...(s.workerExecutionFacts ? { workerExecutionFacts: s.workerExecutionFacts } : {}),
            state: 'interrupted',
            reason: 'interrupted-source-selection',
            frozen: s.state === 'selected' ? s.frozen : null,
          });
        if (live && !sameAction(s.action, JSON.parse(String(live.value))))
          fail('invalid-action-source');
        if ((s.state === 'selecting' || s.state === 'selected') && !live)
          fail('orphan-action-source');
      }
      for (const row of this.db
        .prepare('SELECT action_id FROM action_sources WHERE case_id=?')
        .all(id)) {
        const s = this.source(id, String(row.action_id));
        if (s.state !== 'selecting' && s.frozen)
          await this.workspaces!.readFrozen(s.frozen, new AbortController().signal);
      }
    } catch (error) {
      this.parkWorkspace(id, error);
    }
  }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = work();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private all(): Case[] {
    return this.db
      .prepare('SELECT value FROM cases ORDER BY rowid')
      .all()
      .map((row) => this.decode(String(row.value)));
  }
  private decode(value: string): Case {
    const c: Case = JSON.parse(value);
    if (
      !c ||
      !uuid(c.id) ||
      !phases.includes(c.phase) ||
      !statuses.includes(c.status) ||
      !nativeStates.includes(c.native) ||
      ![c.version, c.epoch, c.remainingMs, c.usedMs, c.attempt, c.repairs].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      ) ||
      c.version < 1 ||
      c.attempt < 1 ||
      c.remainingMs > 600_000 ||
      c.repairs > 3 ||
      (c.repairs > 2 && c.status !== 'needs-attention' && c.status !== 'terminal') ||
      ![c.accountedAt, c.terminalAt].every(
        (n) => n === null || (Number.isSafeInteger(n) && n >= 0),
      ) ||
      typeof c.reason !== 'string' ||
      Buffer.byteLength(c.reason) > 2048 ||
      c.simulated !== true ||
      (c.warning !== undefined && !text(c.warning, 512)) ||
      ![c.base, c.candidate, c.failedCandidate].every(
        (sha) => sha === null || /^[0-9a-f]{40,64}$/.test(sha),
      ) ||
      ![null, 'no-fix', 'dismissed', 'merged'].includes(c.outcome) ||
      (c.status === 'terminal'
        ? c.terminalAt === null || c.outcome === null
        : c.terminalAt !== null || c.outcome !== null)
    )
      return fail('invalid-control-state');
    parseCommand({ requestId: c.id, intent: { type: 'investigate', issue: c.issue } });
    if (c.issueKey !== issueKey(c.issue)) return fail('invalid-control-state');
    return c;
  }
  private get(id: string): Case {
    const row = this.db.prepare('SELECT value FROM cases WHERE id=?').get(id);
    return row ? this.decode(String(row.value)) : fail('case-not-found');
  }
  private save(c: Case) {
    this.db
      .prepare(
        'INSERT INTO cases VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run(c.id, c.issueKey, JSON.stringify(c));
    for (const [action, scope] of this.workerScopes)
      if (
        action.caseId === c.id &&
        (c.status !== 'running' ||
          c.epoch !== action.epoch ||
          c.native !== 'ready' ||
          c.remainingMs <= 0)
      )
        this.revokeWorkerScope(action, scope);
  }
  private charge(c: Case, now = this.clock()) {
    if (c.accountedAt !== null) {
      const elapsed = Math.max(0, now - c.accountedAt);
      const cost = Math.min(c.remainingMs, elapsed);
      c.remainingMs -= cost;
      c.usedMs += cost;
      c.accountedAt = now;
    }
  }
  private attention(c: Case, reason: string) {
    this.charge(c);
    c.accountedAt = null;
    c.status = 'needs-attention';
    c.reason = reason;
    c.epoch++;
    c.version++;
  }
  private changed = () => {
    if (this.closing) return;
    this.sequence++;
    for (const watcher of this.watchers) watcher();
  };
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => {
      if (this.closing) return fail('controller-closed');
      return work();
    });
    this.queue = next.catch(() => {});
    return next;
  }
  private admit(issue: Issue, previousId: string | null = null): Case {
    if (
      issue.project !== this.options.policy.project ||
      issue.environment !== this.options.policy.environment ||
      issue.repository !== this.options.policy.repository
    )
      fail('issue-policy-denied');
    if (issue.status !== 'unresolved') fail('issue-not-unresolved');
    const key = issueKey(issue);
    const c: Case = {
      id: randomUUID(),
      issueKey: key,
      issue,
      previousId,
      phase: 'triage',
      status: 'provisioning',
      version: 1,
      epoch: 0,
      native: 'provisioning',
      remainingMs: this.allowance,
      usedMs: 0,
      attempt: 1,
      repairs: 0,
      accountedAt: null,
      terminalAt: null,
      outcome: null,
      reason: '',
      base: null,
      candidate: null,
      failedCandidate: null,
      simulated: true,
    };
    this.save(c);
    if (this.options.offlineWorkspace)
      this.saveBinding({
        caseId: c.id,
        repositoryId: this.options.offlineWorkspace.repositoryId,
        sourceDigest: this.sourceDigest!,
        state: 'planned',
      });
    this.db
      .prepare(
        'INSERT INTO guards VALUES (?,?) ON CONFLICT(issue_key) DO UPDATE SET owner=excluded.owner',
      )
      .run(key, c.id);
    return c;
  }

  async command(input: unknown): Promise<Receipt> {
    const command = parseCommand(input);
    return this.serial(async () => {
      const hash = digest(command);
      const result = this.transaction(() => {
        const old = this.db
          .prepare('SELECT digest,value FROM receipts WHERE id=?')
          .get(command.requestId);
        if (old) {
          if (old.digest !== hash) fail('request-id-conflict');
          return JSON.parse(String(old.value)) as Receipt;
        }
        const i = command.intent;
        let c: Case | undefined;
        let disposition: Receipt['disposition'] = 'accepted';
        if (i.type === 'investigate') {
          const guard = this.db
            .prepare('SELECT owner FROM guards WHERE issue_key=?')
            .get(issueKey(i.issue));
          if (guard) {
            c = this.get(String(guard.owner));
            disposition = 'existing';
          } else c = this.admit(i.issue);
        } else if (i.type !== 'check-now') {
          c = this.get(i.caseId);
          if (
            !['pause', 'post-message'].includes(i.type) &&
            command.expectedControlVersion !== c.version
          )
            fail('stale-control-version');
          if (i.type === 'pause') {
            if (c.status === 'running') {
              c.status = 'pause-requested';
              c.version++;
            } else if (c.status === 'queued' || c.status === 'provisioning') {
              c.status = 'paused';
              c.version++;
            }
          } else if (i.type === 'continue') {
            if (
              c.status !== 'paused' ||
              c.native !== 'ready' ||
              !this.workspaceReady(c.id) ||
              c.remainingMs <= 0
            )
              fail('cannot-continue');
            c.status = 'queued';
            c.reason = '';
            c.version++;
          } else if (i.type === 'retry') {
            if (
              c.status !== 'needs-attention' ||
              c.native !== 'ready' ||
              !this.workspaceReady(c.id)
            )
              fail('cannot-retry');
            c.status = 'queued';
            c.reason = '';
            c.remainingMs = this.allowance;
            c.repairs = 0;
            c.failedCandidate = null;
            c.attempt++;
            c.version++;
            c.epoch++;
          } else if (i.type === 'dismiss') {
            if (!['paused', 'needs-attention', 'queued'].includes(c.status)) fail('cannot-dismiss');
            c.status = 'terminal';
            c.outcome = 'dismissed';
            c.reason = i.note!;
            c.terminalAt = this.clock();
            c.version++;
            c.epoch++;
          } else if (i.type === 'requeue') {
            if (c.status !== 'terminal') fail('cannot-requeue');
            const guard = this.db
              .prepare('SELECT owner FROM guards WHERE issue_key=?')
              .get(c.issueKey);
            if (guard?.owner !== c.id) fail('issue-already-owned');
            c = this.admit(c.issue, c.id);
          } else if (i.type === 'post-message') {
            if (c.native === 'expired' || c.native === 'deleting' || c.native === 'missing')
              fail('details-unavailable');
          } else if (i.type === 'details-cleanup') {
            if (c.status !== 'terminal') fail('unfinished-case-protected');
            if (c.native !== 'expired') {
              c.native = 'deleting';
              c.version++;
            }
          }
          this.save(c);
          if (i.type === 'post-message' || i.type === 'retry' || i.type === 'requeue')
            this.db
              .prepare('INSERT INTO deliveries VALUES (?,?,?)')
              .run(command.requestId, c.id, i.type === 'post-message' ? i.text : i.note!);
        }
        const receipt: Receipt = {
          requestId: command.requestId,
          caseId: c?.id ?? null,
          version: c?.version ?? null,
          disposition,
        };
        this.db
          .prepare('INSERT INTO receipts VALUES (?,?,?)')
          .run(command.requestId, hash, JSON.stringify(receipt));
        return receipt;
      });
      if (result.caseId) {
        this.options.fault?.('after-command-commit', result.caseId);
        await this.provision(result.caseId);
        await this.deliver(result.caseId);
        if (this.get(result.caseId).native === 'deleting') await this.expire(result.caseId);
      }
      this.changed();
      this.schedule();
      if (command.intent.type === 'check-now') void this.poll();
      return result;
    });
  }

  private async casePath(id: string) {
    if (!uuid(id)) fail('unsafe-case-id');
    const directory = join(this.directory, 'cases', id);
    await mkdir(directory, { mode: 0o700 }).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
    if ((await lstat(directory)).isSymbolicLink() || (await realpath(directory)) !== directory)
      fail('unsafe-case-directory');
    return directory;
  }
  private async runtime(id: string): Promise<NativeCase> {
    if (!this.runtimes.has(id)) {
      const pending = (async () => {
        const c = this.get(id);
        if (!['ready', 'provisioning'].includes(c.native)) fail('details-unavailable');
        const directory = await this.casePath(id);
        const path = join(directory, 'session.sqlite');
        const existing = await lstat(path).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
          return null;
        });
        if (existing && (!existing.isFile() || existing.isSymbolicLink()))
          fail('unsafe-native-file');
        if (!existing) {
          if (c.native !== 'provisioning') fail('native-file-missing');
          await (await open(path, 'wx', 0o600)).close();
        }
        const store = await ArtifactStore.open(this.directory, id);
        return NativeCase.open(
          path,
          c,
          this.options.providerForCase(id),
          {
            current: () => this.get(id),
            admit: (kind, limit) => this.admitAction(id, kind, limit),
            permit: (action) => this.permitAction(id, action),
            remaining: (action) => this.actionAllowance(id, action).remainingMs,
            mayRecordCompletion: (action) => this.mayRecordCompletion(action),
            wakeup: (delay, callback) => {
              if (this.options.actionWakeup) return this.options.actionWakeup(delay, callback);
              const timer = setTimeout(callback, delay);
              return () => clearTimeout(timer);
            },
            finish: (action, uncertain, failed) => this.finishAction(action, uncertain, failed),
            receipt: (action) => this.actionReceipt(action),
            assess: (action, assessment, checks) => this.assess(id, action, assessment, checks),
            checkpoint: (action, check) => this.checkpoint(id, action, check),
            probe: (signal) =>
              this.options.probe?.(id, signal) ??
              Promise.resolve('Scripted probe; no external effect.'),
            check: (action, kind, signal) => this.dispatchCheck(id, action, kind, signal),
            validateCheckAction: (action) => this.validateCheckAction(id, action),
            captureConsumedCheckAuthority: (action, signal) =>
              this.captureConsumedCheckAuthority(id, action, signal),
            fault: (point) => this.options.fault?.(point, id),
            changed: this.changed,
          },
          store,
        );
      })();
      this.runtimes.set(id, pending);
      void pending.catch(() => {
        this.runtimes.delete(id);
      });
    }
    return this.runtimes.get(id)!;
  }
  private async provision(id: string) {
    await this.ensureWorkspace(id);
    const c = this.get(id);
    if (c.native !== 'provisioning') return;
    this.options.fault?.('before-native-provision', id);
    await this.runtime(id);
    this.options.fault?.('after-native-provision', id);
    this.transaction(() => {
      const latest = this.get(id);
      latest.native = 'ready';
      if (latest.status === 'provisioning') latest.status = 'queued';
      this.save(latest);
    });
  }
  private async deliver(id: string) {
    if (this.get(id).native !== 'ready') return;
    const rows = this.db
      .prepare('SELECT id,text FROM deliveries WHERE case_id=? ORDER BY rowid')
      .all(id);
    if (!rows.length) return;
    const native = await this.runtime(id);
    for (const row of rows) {
      await native.note(String(row.id), 'eitri.note', {
        text: String(row.text),
        origin: 'operator',
      });
      this.options.fault?.('after-note-delivery', id);
      this.db.prepare('DELETE FROM deliveries WHERE id=?').run(String(row.id));
    }
  }
  private admitAction(id: string, kind: 'model' | 'tool', maxMs: number): Action {
    if (this.closing || this.starting) fail('dispatch-disabled');
    return this.transaction(() => {
      const c = this.get(id);
      const now = this.clock();
      this.charge(c, now);
      if (
        c.status !== 'running' ||
        c.native !== 'ready' ||
        !this.workspaceReady(id) ||
        c.remainingMs <= 0
      )
        fail('dispatch-denied');
      if (this.db.prepare('SELECT id FROM actions WHERE case_id=?').get(id))
        fail('action-already-running');
      const action: Action = {
        id: randomUUID(),
        caseId: id,
        epoch: c.epoch,
        kind,
        startedAt: now,
        limitMs: Math.min(maxMs, c.remainingMs),
        usedAtStart: c.usedMs,
      };
      if (
        !Number.isSafeInteger(maxMs) ||
        maxMs < 1 ||
        maxMs > (kind === 'model' ? 120_000 : 60_000)
      )
        fail('invalid-action-state');
      actionDeadlineAt(action);
      this.save(c);
      this.db
        .prepare('INSERT INTO actions VALUES (?,?,?)')
        .run(action.id, id, JSON.stringify(action));
      return action;
    });
  }
  private authenticatedAction(id: string, action: Action): Case | undefined {
    const c = this.get(id);
    const row = this.db
      .prepare('SELECT value FROM actions WHERE id=? AND case_id=?')
      .get(action.id, id);
    if (action.caseId !== id || !row || !isDeepStrictEqual(action, JSON.parse(String(row.value))))
      return undefined;
    return c;
  }
  private actionAllowance(id: string, action: Action) {
    if (this.closing || this.starting) fail('check-dispatch-denied');
    const c = this.authenticatedAction(id, action);
    if (
      !c ||
      c.epoch !== action.epoch ||
      !['running', 'pause-requested'].includes(c.status) ||
      c.native !== 'ready' ||
      !this.workspaceReady(id)
    )
      return fail('check-dispatch-denied');
    const deadlineAt = actionDeadlineAt(action);
    const now = this.clock();
    this.charge(c, now);
    this.save(c);
    return { c, deadlineAt, remainingMs: Math.max(0, Math.min(c.remainingMs, deadlineAt - now)) };
  }
  private permitAction(id: string, action: Action | undefined) {
    const admitted = action ?? fail('dispatch-disabled');
    const { c, remainingMs } = this.actionAllowance(id, admitted);
    if (c.status !== 'running' || remainingMs <= 0) fail('dispatch-denied');
  }
  private checkAllowance(id: string, action: Action, signal?: AbortSignal) {
    if (action.kind !== 'tool') fail('check-dispatch-denied');
    const allowance = this.actionAllowance(id, action);
    if (allowance.remainingMs <= 0) fail('check-allowance-exhausted');
    if (signal?.aborted) fail('check-cancelled');
    return allowance;
  }
  private confirmCompletion(action: Action, c: Case) {
    if (c.epoch !== action.epoch)
      this.completions.set(action, {
        epoch: c.epoch,
        attempt: c.attempt,
        status: c.status,
        version: c.version,
      });
  }
  private mayRecordCompletion(action: Action): boolean {
    const completion = this.completions.get(action);
    if (!completion || this.closing) return false;
    const c = this.authenticatedAction(action.caseId, action);
    return (
      !!c &&
      c.epoch === completion.epoch &&
      c.attempt === completion.attempt &&
      c.status === completion.status &&
      c.version === completion.version
    );
  }
  private validateCheckAction(id: string, action: Action) {
    try {
      this.checkAllowance(id, action);
    } catch (error) {
      this.stopCheck(
        id,
        action,
        error instanceof ControlError ? error.code : 'check-dispatch-denied',
      );
      throw error;
    }
  }
  private stopCheck(id: string, action: Action, reason: string): CheckExecution {
    if (this.closing) return { type: 'uncertain' };
    const stopped = this.transaction(() => {
      const c = this.authenticatedAction(id, action);
      if (!c || c.epoch !== action.epoch || !['running', 'pause-requested'].includes(c.status))
        return;
      if (c.status === 'pause-requested') {
        this.charge(c);
        c.reason = reason;
        c.version++;
      } else this.attention(c, reason);
      this.save(c);
      return c;
    });
    if (stopped) {
      this.confirmCompletion(action, stopped);
      this.changed();
      this.options.fault?.('after-check-stop', id);
    }
    return { type: 'uncertain' };
  }
  private async dispatchCheck(
    id: string,
    action: Action,
    kind: Check['kind'],
    signal: AbortSignal,
  ): Promise<DispatchedCheckExecution> {
    let request: AdmittedCheckRequest;
    let source: OfflineActionWorkspace | undefined;
    let live = true;
    let workerScope: WorkerExecutionScope | undefined;
    let callbackSettled = false;
    const consumption: {
      observation:
        | { state: 'not-completed' | 'failed' }
        | { state: 'completed'; value: FrozenBrowserConsumption };
    } = { observation: { state: 'not-completed' } };
    const callback = this.options.check;
    const revoke = () => {
      live = false;
      if (workerScope) this.revokeWorkerScope(action, workerScope);
    };
    try {
      this.options.fault?.('before-check-dispatch', id);
      let allowance = this.checkAllowance(id, action, signal);
      if (allowance.c.status !== 'running') fail('check-dispatch-denied');
      if (!callback) return this.stopCheck(id, action, 'validation-not-configured');
      if (this.options.offlineWorkspace) {
        source = await this.selectActionSource(id, action, kind, signal, () => live);
        allowance = this.checkAllowance(id, action, signal);
      }
      const { c, remainingMs } = allowance;
      if (c.status !== 'running') fail('check-dispatch-denied');
      if (this.options.offlineWorkerJournal && (kind === 'baseline' || kind === 'browser')) {
        const selected = this.source(id, action.id);
        if (selected.state !== 'selected' || selected.workerIntent)
          return fail('invalid-worker-intent');
        const workerRequest = frozenBrowserRequest({
          frozen: selected.frozen,
          action: { caseId: id, actionId: action.id, epoch: action.epoch },
          scenarioId: 'synthetic-click-v1',
          role: kind === 'baseline' ? 'baseline' : 'candidate',
          allowanceMs: Math.min(60_000, remainingMs),
        });
        this.saveSource({
          ...selected,
          workerIntent: { request: workerRequest, requestDigest: digest(workerRequest) },
        });
        this.options.fault?.('after-worker-intent', id);
        if (this.options.offlineWorkerAcceptance) {
          const retained = sourceAuthorityValue(this.source(id, action.id));
          const assertCurrentAuthority = (): true => {
            this.sourceAuthority(id, action, signal, () => live);
            if (!isDeepStrictEqual(sourceAuthorityValue(this.source(id, action.id)), retained))
              fail('worker-acceptance-source-changed');
            return true;
          };
          if (this.options.offlineWorkerConsumption) {
            const capture = captureWorkerExecutionAnchor(
              this.source(id, action.id),
              this.workerJournalBinding(),
            );
            workerScope = new WorkerExecutionScope(
              workerRequest,
              () =>
                this.workspaceSerial(async () => {
                  assertCurrentAuthority();
                  const binding = this.options.offlineWorkerJournal!;
                  return FrozenBrowserValidator.open({
                    directory: binding.directory,
                    workspace: this.workspaces!,
                    mode: 'consumption-only',
                    expectedIdentity: {
                      ownerId: binding.ownerId,
                      configurationDigest: sha256(binding.configurationDigest),
                    },
                  });
                }),
              () => {
                assertCurrentAuthority();
                return this.checkAllowance(id, action, signal).remainingMs;
              },
              (observation) => this.retainWorkerExecutionFacts(capture, observation),
            );
            this.workerScopes.set(action, workerScope);
            source = Object.freeze({
              ...source!,
              workerAcceptance: Object.freeze({ accept: workerScope.accept }),
              workerConsumption: Object.freeze({
                consume: () => {
                  const observed = workerScope!.consume().then(
                    (value) => {
                      if (consumption.observation.state !== 'failed')
                        consumption.observation = {
                          state: 'completed',
                          value: structuredClone(value),
                        };
                      return value;
                    },
                    (error: unknown) => {
                      consumption.observation = { state: 'failed' };
                      throw error;
                    },
                  );
                  void observed.catch(() => {});
                  return observed;
                },
              }),
            });
          } else
            source = Object.freeze({
              ...source!,
              workerAcceptance: Object.freeze({
                accept: () =>
                  this.workspaceSerial(async () => {
                    assertCurrentAuthority();
                    const binding = this.options.offlineWorkerJournal!;
                    const journal = await FrozenBrowserValidator.open({
                      directory: binding.directory,
                      workspace: this.workspaces!,
                      mode: 'acceptance-only',
                      expectedIdentity: {
                        ownerId: binding.ownerId,
                        configurationDigest: sha256(binding.configurationDigest),
                      },
                    });
                    let accepted: FrozenBrowserAcceptance;
                    try {
                      assertCurrentAuthority();
                      accepted = await journal.accept(workerRequest, assertCurrentAuthority);
                      assertCurrentAuthority();
                    } finally {
                      await journal.close();
                    }
                    assertCurrentAuthority();
                    return accepted;
                  }),
              }),
            });
        }
      }
      const entry = this.checkAllowance(id, action, signal);
      if (entry.c.status !== 'running') fail('check-dispatch-denied');
      request = Object.freeze({
        caseId: id,
        actionId: action.id,
        epoch: action.epoch,
        kind,
        deadlineAt: entry.deadlineAt,
        remainingMs: entry.remainingMs,
        signal,
      });
    } catch (error) {
      revoke();
      return this.stopCheck(
        id,
        action,
        error instanceof ControlError ? error.code : 'check-dispatch-denied',
      );
    }
    let execution: CheckCallbackResult;
    let abort!: () => void;
    let workerAbort!: () => void;
    try {
      const interrupted = new Promise<never>((_resolve, reject) => {
        abort = () => {
          if (callbackSettled) return;
          revoke();
          try {
            this.stopCheck(id, action, 'check-allowance-exhausted');
          } catch (error) {
            reject(error);
            return;
          }
          reject(new ControlError('check-allowance-exhausted'));
        };
        workerAbort = () => {
          if (callbackSettled) return;
          live = false;
          reject(new ControlError('action-source-revoked'));
        };
        signal.addEventListener('abort', abort, { once: true });
        workerScope?.signal.addEventListener('abort', workerAbort, { once: true });
      });
      if (signal.aborted) {
        abort();
        await interrupted;
      }
      const result: unknown = await Promise.race([
        (async () => {
          try {
            if (!live) fail('action-source-revoked');
            return await (source ? callback(request, source) : callback(request));
          } finally {
            callbackSettled = true;
            revoke();
          }
        })(),
        interrupted,
      ]);
      try {
        execution = parseCheckExecution(result, kind);
      } catch {
        return this.stopCheck(id, action, 'invalid-check-execution');
      }
    } catch {
      return signal.aborted
        ? { type: 'uncertain' }
        : this.stopCheck(id, action, 'check-callback-failed');
    } finally {
      revoke();
      signal.removeEventListener('abort', abort);
      workerScope?.signal.removeEventListener('abort', workerAbort);
    }
    try {
      this.checkAllowance(id, action, signal);
    } catch (error) {
      return this.stopCheck(
        id,
        action,
        error instanceof ControlError ? error.code : 'check-dispatch-denied',
      );
    }
    switch (execution.type) {
      case 'consumed-browser': {
        try {
          if (!workerScope) return fail('consumed-check-scope-required');
          await this.revokeWorkerScope(action, workerScope);
          if (consumption.observation.state !== 'completed')
            return fail('consumed-check-consumption-required');
          const authority = this.captureConsumedCheckAuthority(id, action, signal);
          const delivered = consumption.observation.value;
          if (
            !isDeepStrictEqual(authority.anchor.facts.consumedRun, {
              acceptanceId: delivered.acceptanceId,
              runId: delivered.run.runId,
              requestDigest: delivered.run.requestDigest,
            })
          )
            fail('consumed-check-consumption-mismatch');
          const binding = this.workerJournalBinding();
          const acquisition = this.workspaceSerial(async () => {
            authority.assertCurrent();
            if (this.workerScopes.size !== 0) fail('worker-history-busy');
            const history = await FrozenBrowserValidator.readConsumedReport({
              directory: binding.directory,
              expectedIdentity: {
                ownerId: binding.ownerId,
                configurationDigest: sha256(binding.configurationDigest),
              },
              consumedRun: {
                ...authority.anchor.facts.consumedRun,
                requestDigest: sha256(authority.anchor.facts.consumedRun.requestDigest),
              },
            });
            authority.assertCurrent();
            if (history.state !== 'settled') fail('consumed-check-not-settled');
            return history;
          });
          this.workerInspections.add(acquisition);
          void acquisition
            .finally(() => this.workerInspections.delete(acquisition))
            .catch(() => {});
          const history = await acquisition;
          authority.assertCurrent();
          return { type: 'consumed-browser', history: structuredClone(history) };
        } catch (error) {
          return this.stopCheck(
            id,
            action,
            error instanceof ControlError ? error.code : 'consumed-check-handoff-failed',
          );
        }
      }
      case 'completed':
        return execution;
      case 'infrastructure':
      case 'unrelated-failure':
      case 'cancelled':
      case 'uncertain':
      case 'cleanup-incomplete':
        this.stopCheck(id, action, `check-${execution.type}`);
        return execution;
    }
  }
  private finishAction(action: Action, uncertain: boolean, failed = false) {
    const expired = this.transaction(() => {
      const c = this.authenticatedAction(action.caseId, action);
      if (!c) return;
      const current = c.epoch === action.epoch;
      let expired = false;
      if (current) {
        const now = this.clock();
        this.charge(c, now);
        expired = c.remainingMs <= 0 || now >= actionDeadlineAt(action);
      }
      if ((uncertain || expired) && c.status === 'running' && current)
        this.attention(c, `${action.kind}-action-timed-out`);
      else if (failed && c.status === 'running' && c.epoch === action.epoch)
        this.attention(c, `${action.kind}-action-failed`);
      if (current) this.save(c);
      if (
        this.options.offlineWorkspace &&
        this.db.prepare('SELECT action_id FROM action_sources WHERE action_id=?').get(action.id)
      ) {
        const s = this.source(action.caseId, action.id);
        if (s.state === 'selecting' || s.state === 'selected') {
          if (
            !uncertain &&
            !failed &&
            c.epoch === action.epoch &&
            ['running', 'pause-requested'].includes(c.status) &&
            s.state === 'selected'
          )
            this.saveSource({ ...s, state: 'settled' });
          else
            this.saveSource({
              action: s.action,
              kind: s.kind,
              ...(s.workerIntent ? { workerIntent: s.workerIntent } : {}),
              ...(s.workerExecutionFacts ? { workerExecutionFacts: s.workerExecutionFacts } : {}),
              state: 'interrupted',
              reason: 'source-action-interrupted',
              frozen: s.state === 'selected' ? s.frozen : null,
            });
        }
      }
      this.db.prepare('DELETE FROM actions WHERE id=?').run(action.id);
      return expired;
    });
    this.completions.delete(action);
    if (expired && !uncertain && !failed) fail('action-timed-out');
  }
  private actionReceipt(action: Action) {
    this.changed();
    this.options.fault?.(`after-${action.kind}-action-receipt`, action.caseId);
  }
  private checkpoint(id: string, action: Action, check: Check) {
    const committed = this.transaction(() => {
      const { c } = this.checkAllowance(id, action);
      if (check.actionId !== action.id || check.caseId !== id) fail('checkpoint-control-changed');
      if (!['running', 'pause-requested'].includes(c.status)) fail('checkpoint-control-changed');
      if (check.kind === 'baseline') {
        if (check.passed && (!c.base || c.base === check.candidate)) c.base = check.candidate;
        else this.attention(c, 'baseline-not-reproduced-or-changed');
      } else if (check.kind === 'checkpoint') {
        if (c.phase !== 'implementation' || !check.passed) fail('checkpoint-not-allowed');
        if (c.failedCandidate && check.candidate !== c.failedCandidate) {
          c.repairs++;
          c.failedCandidate = null;
        }
        if (c.repairs > 2) this.attention(c, 'repair-budget-exhausted');
        else {
          c.candidate = check.candidate;
          c.version++;
        }
      } else if (!check.passed) {
        c.failedCandidate = check.candidate;
        if (c.repairs >= 2) this.attention(c, 'repair-budget-exhausted');
        else {
          c.phase = 'implementation';
          c.version++;
        }
      }
      this.save(c);
      return c;
    });
    this.confirmCompletion(action, committed);
  }
  private async assess(id: string, action: Action, a: Assessment, checks: Check[]) {
    if (a.conclusion === 'progress') {
      const native = (await this.runtimes.get(id)) ?? fail('details-unavailable');
      for (const check of checks.filter((check) => a.evidenceIds.includes(check.id)))
        await native.verifyArtifacts(check);
    }
    const committed = this.transaction(() => {
      const { c } = this.checkAllowance(id, action);
      if (
        c.status !== 'running' ||
        c.phase !== a.phase ||
        c.version !== a.expectedControlVersion ||
        c.remainingMs <= 0
      )
        fail('stale-phase-result');
      if (!text(a.reason, 512)) fail('assessment-reason-required');
      if (a.conclusion === 'attention') this.attention(c, a.reason);
      else if (a.conclusion === 'no-fix') {
        if (c.phase !== 'triage' && c.phase !== 'investigation') fail('no-fix-not-allowed');
        c.status = 'terminal';
        c.outcome = 'no-fix';
        c.reason = a.reason;
        c.terminalAt = this.clock();
        c.accountedAt = null;
        c.epoch++;
        c.version++;
      } else {
        const evidence = checks.filter((check) => a.evidenceIds.includes(check.id));
        if (evidence.length !== a.evidenceIds.length) fail('unknown-evidence');
        if (
          c.phase === 'investigation' &&
          (!text(a.proposal, 8000) ||
            !a.paths?.length ||
            a.paths.some(
              (p) => !/^(src|test)\/[a-zA-Z0-9_./-]+$/.test(p) || p.split('/').includes('..'),
            ) ||
            !evidence.some((e) => e.kind === 'baseline' && e.passed))
        )
          fail('investigation-evidence-required');
        if (['implementation', 'testing', 'publication'].includes(c.phase)) {
          if (
            !c.candidate ||
            a.candidate !== c.candidate ||
            !evidence.length ||
            evidence.some(
              (e) => e.candidate !== (e.kind === 'baseline' ? c.base : c.candidate) || !e.passed,
            )
          )
            fail('stale-candidate-evidence');
          if (new Set(evidence.map((e) => e.configuration)).size !== 1)
            fail('configuration-mismatch');
          const required: Check['kind'][] =
            c.phase === 'implementation'
              ? ['checkpoint', 'regression']
              : ['baseline', 'unit', 'regression', 'build', 'browser'];
          if (required.some((kind) => !evidence.some((e) => e.kind === kind)))
            fail('missing-required-check');
          if (
            c.phase !== 'implementation' &&
            !evidence.some((e) => e.kind === 'browser' && e.artifacts.length > 0)
          )
            fail('browser-artifact-required');
        }
        if (c.phase === 'publication' || c.phase === 'pr-created') fail('publication-not-enabled');
        c.phase = phases[phases.indexOf(c.phase) + 1];
        c.status = 'queued';
        c.accountedAt = null;
        c.reason = '';
        c.epoch++;
        c.version++;
      }
      this.save(c);
      return c;
    });
    this.confirmCompletion(action, committed);
    this.changed();
  }
  private schedule() {
    if (this.closing || this.starting || this.tickScheduled) return;
    this.tickScheduled = true;
    setImmediate(() => {
      this.tickScheduled = false;
      if (!this.closing) void this.tick();
    });
  }
  private async tick() {
    for (const c of this.all()) {
      if (this.closing || this.runners.size >= (this.options.capacity ?? 1)) break;
      if (
        c.status !== 'queued' ||
        c.native !== 'ready' ||
        !this.workspaceReady(c.id) ||
        this.runners.has(c.id)
      )
        continue;
      const runner = this.execute(c.id).finally(() => {
        this.runners.delete(c.id);
        this.changed();
        this.schedule();
      });
      this.runners.set(c.id, runner);
      void runner.catch(() => {});
    }
  }
  private async execute(id: string) {
    let epoch = -1;
    try {
      const native = await this.runtime(id);
      const c = this.transaction(() => {
        const c = this.get(id);
        if (this.closing || c.status !== 'queued' || !this.workspaceReady(id))
          fail('run-not-queued');
        if (c.remainingMs <= 0) {
          this.attention(c, 'allowance-exhausted');
          this.save(c);
          return null;
        }
        c.status = 'running';
        c.epoch++;
        c.accountedAt = this.clock();
        c.version++;
        this.save(c);
        return c;
      });
      if (!c) return;
      epoch = c.epoch;
      this.changed();
      await this.deliver(id);
      const result = await native.run(c);
      if (this.closing) return;
      this.transaction(() => {
        const latest = this.get(id);
        if (latest.epoch !== epoch) return;
        this.charge(latest);
        if (latest.status === 'pause-requested') {
          latest.status = 'paused';
          latest.accountedAt = null;
          latest.epoch++;
          latest.version++;
        } else if (latest.status === 'running' && latest.epoch === epoch)
          this.attention(
            latest,
            result.status === 'unanswered'
              ? 'model-error-or-dispatch-denied'
              : 'assessment-required',
          );
        if (latest.status !== 'running') latest.accountedAt = null;
        this.save(latest);
      });
      if (this.get(id).status === 'paused') await native.reconcile();
    } catch (error) {
      if (this.closing) return;
      this.transaction(() => {
        const c = this.get(id);
        if (c.epoch !== epoch) return;
        if (c.status === 'pause-requested') {
          this.charge(c);
          c.status = 'paused';
          c.accountedAt = null;
          c.version++;
          c.epoch++;
        } else if (c.status === 'running' || c.status === 'queued')
          this.attention(c, error instanceof ControlError ? error.code : 'native-execution-error');
        this.save(c);
      });
    }
  }
  private async recover() {
    for (const original of this.all()) {
      let c = original;
      if (
        c.native === 'deleting' ||
        (c.status === 'terminal' &&
          c.terminalAt !== null &&
          this.clock() - c.terminalAt >= terminalRetentionMs &&
          c.native !== 'expired')
      ) {
        await this.expire(c.id);
        c = this.get(c.id);
      }
      if (c.native === 'expired' || c.native === 'missing') {
        await this.ensureWorkspace(c.id);
        await this.recoverSources(c.id);
        continue;
      }
      try {
        await this.provision(c.id);
        await this.recoverSources(c.id);
        c = this.get(c.id);
        const actionRow = this.db.prepare('SELECT value FROM actions WHERE case_id=?').get(c.id);
        this.transaction(() => {
          c = this.get(c.id);
          if (actionRow) {
            const action: Action = JSON.parse(String(actionRow.value));
            if (
              !action ||
              !uuid(action.id) ||
              action.caseId !== c.id ||
              !['model', 'tool'].includes(action.kind) ||
              ![action.limitMs, action.startedAt, action.epoch, action.usedAtStart].every(
                (n) => Number.isSafeInteger(n) && n >= 0,
              ) ||
              action.limitMs < 1 ||
              action.limitMs > (action.kind === 'model' ? 120_000 : 60_000) ||
              action.epoch > c.epoch ||
              action.usedAtStart > c.usedMs
            )
              fail('invalid-action-state');
            actionDeadlineAt(action);
            const cost = Math.min(
              c.remainingMs,
              Math.max(0, action.limitMs - (c.usedMs - action.usedAtStart)),
            );
            c.remainingMs -= cost;
            c.usedMs += cost;
            c.accountedAt = null;
            if (action.kind === 'tool' && c.status === 'running')
              this.attention(c, 'interrupted-tool-effect-uncertain');
            this.db.prepare('DELETE FROM actions WHERE case_id=?').run(c.id);
          } else if (c.status === 'running' || c.status === 'pause-requested') this.charge(c);
          if (c.status === 'pause-requested') {
            c.status = 'paused';
            c.version++;
          } else if (c.status === 'running') {
            c.status = c.remainingMs > 0 ? 'queued' : 'needs-attention';
            c.reason = c.remainingMs > 0 ? '' : 'allowance-exhausted';
            c.version++;
          }
          c.accountedAt = null;
          c.epoch++;
          this.save(c);
        });
        const native = await this.runtime(c.id);
        if (await native.hasUnsettledTool())
          this.transaction(() => {
            const latest = this.get(c.id);
            if (
              !['terminal', 'needs-attention', 'paused', 'pause-requested'].includes(latest.status)
            ) {
              this.attention(latest, 'incomplete-native-tool-checkpoint');
              this.save(latest);
            }
          });
        await native.reconcile();
        await this.deliver(c.id);
      } catch (error) {
        this.transaction(() => {
          c = this.get(c.id);
          c.native = 'missing';
          const reason = error instanceof ControlError ? error.code : 'native-recovery-failed';
          if (c.status === 'terminal') {
            c.warning = reason;
            c.version++;
          } else this.attention(c, reason);
          this.save(c);
        });
      }
    }
  }
  private async expire(id: string) {
    let c = this.get(id);
    if (c.status !== 'terminal') fail('unfinished-case-protected');
    this.transaction(() => {
      c = this.get(id);
      c.native = 'deleting';
      this.save(c);
    });
    try {
      const runtime = this.runtimes.get(id);
      if (runtime) {
        await (await runtime).close();
        this.runtimes.delete(id);
      }
      const directory = join(this.directory, 'cases', id);
      const stat = await lstat(directory).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (stat) {
        if (stat.isSymbolicLink() || (await realpath(directory)) !== directory)
          fail('unsafe-cleanup-directory');
        this.options.fault?.('before-details-delete', id);
        await rm(directory, { recursive: true });
      }
      this.transaction(() => {
        c = this.get(id);
        c.native = 'expired';
        delete c.warning;
        c.version++;
        this.save(c);
        this.db.prepare('DELETE FROM deliveries WHERE case_id=?').run(id);
      });
    } catch (error) {
      c = this.get(id);
      c.warning = error instanceof ControlError ? error.code : 'details-cleanup-failed';
      this.save(c);
      throw error;
    }
    this.changed();
  }
  async maintain() {
    return this.serial(async () => {
      for (const c of this.all())
        if (
          c.status === 'terminal' &&
          c.terminalAt !== null &&
          this.clock() - c.terminalAt >= terminalRetentionMs &&
          c.native !== 'expired'
        )
          await this.expire(c.id);
      this.changed();
    });
  }
  async poll() {
    if (this.polling || this.closing || !this.options.issues) return;
    this.polling = true;
    try {
      const issues = await this.options.issues();
      for (const issue of issues)
        if (
          issue.status === 'unresolved' &&
          (issue.priority === 'high' || issue.regressed || issue.escalating)
        )
          await this.command({ requestId: randomUUID(), intent: { type: 'investigate', issue } });
    } finally {
      this.polling = false;
    }
  }
  async artifact(caseId: string, artifactId: string) {
    if (!uuid(caseId) || !uuid(artifactId)) fail('invalid-artifact-id');
    return this.serial(async () => {
      const c = this.get(caseId);
      if (c.native !== 'ready') fail('details-unavailable');
      const pending = this.runtimes.get(caseId) ?? fail('details-unavailable');
      const path = join(this.directory, 'cases', caseId, 'session.sqlite');
      try {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
          fail('details-unavailable');
        return await (await pending).readArtifact(artifactId);
      } catch (error) {
        if (error instanceof ControlError) throw error;
        return fail('artifact-unavailable');
      }
    });
  }
  async snapshot(selection: Selection = {}): Promise<Snapshot> {
    if (selection.selected !== undefined && !uuid(selection.selected)) fail('invalid-selection');
    if (
      selection.limit !== undefined &&
      (!Number.isInteger(selection.limit) || selection.limit < 1 || selection.limit > 100)
    )
      fail('invalid-page-size');
    if (selection.before !== undefined && !uuid(selection.before)) fail('invalid-cursor');
    const cases = this.all();
    let selected: Snapshot['selected'] = null;
    if (selection.selected) {
      const c = this.get(selection.selected);
      const page =
        c.native === 'ready'
          ? await (await this.runtime(c.id)).messages(selection.limit ?? 100, selection.before)
          : { messages: [], more: false };
      const metadata =
        c.native === 'ready'
          ? await (await this.runtime(c.id)).metadata()
          : { checks: [], artifacts: [] };
      selected = { case: c, ...page, ...metadata };
    }
    return {
      protocol: 1,
      bootId: this.bootId,
      sequence: this.sequence,
      mode: 'scripted',
      cases,
      selected,
    };
  }
  watch(
    selection: Selection,
    notify: (snapshot: Snapshot) => void,
    error: (error: unknown) => void = () => {},
  ) {
    let closed = false,
      pending = false,
      dirty = false;
    const update = () => {
      if (closed) return;
      dirty = true;
      if (pending) return;
      pending = true;
      void (async () => {
        try {
          while (dirty && !closed) {
            dirty = false;
            const view = await this.snapshot(selection);
            if (!closed) notify(view);
          }
        } catch (e) {
          error(e);
        } finally {
          pending = false;
        }
      })();
    };
    this.watchers.add(update);
    update();
    return () => {
      closed = true;
      this.watchers.delete(update);
    };
  }
  private revokeWorkerScope(action: Action, scope: WorkerExecutionScope): Promise<void> {
    scope.revoke();
    const drainage = scope.close();
    if (this.workerDrains.has(drainage)) return drainage;
    this.workerDrains.add(drainage);
    const cleanup = () => {
      if (this.workerScopes.get(action) === scope) this.workerScopes.delete(action);
      this.workerDrains.delete(drainage);
    };
    void drainage
      .then(cleanup, () => {
        this.workerDrainFailed = true;
        cleanup();
      })
      .catch(() => {});
    return drainage;
  }
  close(): Promise<void> {
    if (this.closure) return this.closure;
    this.closing = true;
    for (const [action, scope] of this.workerScopes) this.revokeWorkerScope(action, scope);
    return (this.closure = this.drainClose());
  }
  private async drainClose() {
    await this.queue;
    const closed = await Promise.allSettled(
      [...this.runtimes.values()].map(async (p) => (await p).close()),
    );
    await Promise.allSettled(this.runners.values());
    await this.workspaceQueue;
    const workersClosed = await Promise.allSettled(this.workerDrains);
    await Promise.allSettled(this.workerInspections);
    const workspaceClosed = await Promise.allSettled([this.workspaces?.close()]);
    this.watchers.clear();
    this.db.close();
    openDirectories.delete(this.directory);
    if (closed.some((result) => result.status === 'rejected')) fail('native-close-failed');
    if (this.workerDrainFailed || workersClosed.some((result) => result.status === 'rejected'))
      fail('worker-close-failed');
    if (workspaceClosed.some((result) => result.status === 'rejected'))
      fail('workspace-close-failed');
  }
}

function consumedAdmissionObservation(
  observed: WorkerConsumedHistoryObservation,
): WorkerConsumedAdmissionObservation {
  if (observed.state !== 'consumed') return observed;
  const { history, independentExecutionPins } = observed;
  if (history.value.state !== 'settled')
    return {
      ...observed,
      history: { ...history, value: history.value },
      conversion: { state: 'not-settled' },
    };
  const settledHistory = { ...history, value: history.value };
  if (independentExecutionPins.state === 'unavailable')
    return {
      ...observed,
      history: settledHistory,
      independentExecutionPins,
      conversion: { state: 'independent-pins-unavailable' },
    };
  return {
    ...observed,
    history: settledHistory,
    independentExecutionPins,
    conversion: {
      state: 'converted',
      admission: admitFrozenBrowserConsumedReport(
        consumedExpectation(independentExecutionPins),
        history.value,
      ),
    },
  };
}
function consumedExpectation(pins: RetainedPins): FrozenBrowserConsumedExpectation {
  const request = pins.intent.request;
  const expected = {
    configurationDigest: sha256(pins.binding.configurationDigest),
    consumedRun: pins.facts.consumedRun,
    admittedAt: pins.facts.admittedAt,
    deadline: pins.facts.deadline,
  };
  return request.role === 'baseline'
    ? { ...expected, kind: 'baseline', request: { ...request, role: request.role } }
    : { ...expected, kind: 'browser', request: { ...request, role: request.role } };
}

function sourceAuthorityValue(source: ActionSource): ActionSourceAuthority {
  const { workerExecutionFacts: _facts, ...authority } = source;
  return authority;
}
function captureWorkerExecutionAnchor(
  source: ActionSource,
  binding: WorkerJournalBinding,
): WorkerExecutionCapture {
  const authority = sourceAuthorityValue(source);
  if (
    authority.state !== 'selected' ||
    !authority.workerIntent ||
    (authority.kind !== 'baseline' && authority.kind !== 'browser')
  )
    return fail('invalid-worker-execution-facts');
  return structuredClone({
    source: { ...authority, workerIntent: authority.workerIntent },
    binding,
  });
}
function validateLiveWorkerExecutionFacts(
  capture: WorkerExecutionCapture,
  observation: FrozenBrowserAdmissionObservation,
): WorkerExecutionFacts {
  try {
    if (
      !observation ||
      !hasFields(observation, ['acceptance', 'consumedRun', 'admittedAt', 'deadline'])
    )
      return fail('invalid-worker-execution-facts');
    const accepted = observation.acceptance;
    const { request, requestDigest } = capture.source.workerIntent;
    const { binding } = capture;
    if (
      !accepted ||
      !hasFields(accepted, [
        'acceptanceId',
        'request',
        'requestDigest',
        'configurationDigest',
        'ownerId',
        'acceptedAt',
        'deadline',
      ]) ||
      !workerIdentifier(accepted.acceptanceId) ||
      !workerIdentifier(accepted.ownerId) ||
      !isDeepStrictEqual(frozenBrowserRequest(accepted.request), request) ||
      digest(accepted.request) !== requestDigest ||
      digest(request) !== requestDigest ||
      accepted.requestDigest !== requestDigest ||
      accepted.configurationDigest !== binding.configurationDigest ||
      accepted.ownerId !== binding.ownerId ||
      ![accepted.acceptedAt, accepted.deadline].every((n) => Number.isSafeInteger(n) && n >= 0) ||
      accepted.deadline - accepted.acceptedAt !== request.allowanceMs ||
      observation.consumedRun?.acceptanceId !== accepted.acceptanceId
    )
      return fail('invalid-worker-execution-facts');
    return validateRetainedWorkerExecutionFacts(
      {
        consumedRun: observation.consumedRun,
        admittedAt: observation.admittedAt,
        deadline: observation.deadline,
      },
      capture.source.workerIntent,
    );
  } catch {
    return fail('invalid-worker-execution-facts');
  }
}
function validateRetainedWorkerExecutionFacts(
  value: unknown,
  intent: WorkerIntent,
): WorkerExecutionFacts {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !hasFields(value, ['consumedRun', 'admittedAt', 'deadline'])
  )
    return fail('invalid-worker-execution-facts');
  const facts = value as WorkerExecutionFacts;
  const key = facts.consumedRun;
  if (
    !key ||
    typeof key !== 'object' ||
    Array.isArray(key) ||
    !hasFields(key, ['acceptanceId', 'runId', 'requestDigest']) ||
    !workerIdentifier(key.acceptanceId) ||
    !workerIdentifier(key.runId) ||
    key.requestDigest !== intent.requestDigest ||
    !/^[0-9a-f]{64}$/.test(key.requestDigest) ||
    ![facts.admittedAt, facts.deadline].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    facts.deadline <= facts.admittedAt ||
    facts.deadline - facts.admittedAt > intent.request.allowanceMs
  )
    return fail('invalid-worker-execution-facts');
  return structuredClone(facts);
}
function workerIdentifier(value: unknown): value is string {
  return typeof value === 'string' && uuid(value) && value === value.toLowerCase();
}

function offlineSourceDigest(offline: OfflineWorkspaceOptions): string {
  return digest({
    version: 1,
    repositoryId: offline.repositoryId,
    regressionDirectory: offline.regressionDirectory,
    baseline: offline.baseline
      .map((file) => ({
        path: file.virtualPath,
        size: file.bytes.byteLength,
        hash: createHash('sha256').update(file.bytes).digest('hex'),
      }))
      .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path))),
  });
}
function hasFields(value: object, fields: string[]): boolean {
  return (
    Object.keys(value).length === fields.length &&
    Object.keys(value).every((key) => fields.includes(key))
  );
}
function sameAction(a: Readonly<Action>, b: Readonly<Action>): boolean {
  return (['id', 'caseId', 'epoch', 'kind', 'startedAt', 'limitMs', 'usedAtStart'] as const).every(
    (key) => a[key] === b[key],
  );
}
function validateSourceAction(action: Readonly<Action>, c: Case) {
  if (
    !action ||
    Object.keys(action).sort().join(',') !== 'caseId,epoch,id,kind,limitMs,startedAt,usedAtStart' ||
    !uuid(action.id) ||
    action.caseId !== c.id ||
    action.kind !== 'tool' ||
    ![action.epoch, action.startedAt, action.limitMs, action.usedAtStart].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    action.limitMs < 1 ||
    action.limitMs > 60000 ||
    action.epoch > c.epoch ||
    action.usedAtStart > c.usedMs
  )
    fail('invalid-action-source');
  actionDeadlineAt(action);
}
function parseCheckExecution(value: unknown, kind: Check['kind']): CheckCallbackResult {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('invalid-check-execution');
  const record = value as Record<string, unknown>;
  const type = record.type;
  const keys = Reflect.ownKeys(record);
  if (type !== 'completed') {
    if (keys.length !== 1 || keys[0] !== 'type') return fail('invalid-check-execution');
    switch (type) {
      case 'consumed-browser':
        if (kind !== 'baseline' && kind !== 'browser') return fail('invalid-check-execution');
        return { type };
      case 'infrastructure':
      case 'unrelated-failure':
      case 'cancelled':
      case 'uncertain':
      case 'cleanup-incomplete':
        return { type };
      default:
        return fail('invalid-check-execution');
    }
  }
  if (keys.length !== 2 || !keys.includes('check') || !keys.includes('type'))
    return fail('invalid-check-execution');
  const receipt = record.check;
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt))
    return fail('invalid-check-execution');
  const check = { ...receipt } as Record<string, unknown>;
  const receiptKeys = Reflect.ownKeys(receipt);
  if (
    receiptKeys.length !== 6 ||
    !['candidate', 'configuration', 'kind', 'outputs', 'passed', 'simulated'].every((key) =>
      receiptKeys.includes(key),
    ) ||
    check.kind !== kind ||
    typeof check.candidate !== 'string' ||
    !/^[0-9a-f]{40,64}$/.test(check.candidate) ||
    typeof check.configuration !== 'string' ||
    !/^[0-9a-f]{64}$/.test(check.configuration) ||
    typeof check.passed !== 'boolean' ||
    check.simulated !== true ||
    !Array.isArray(check.outputs) ||
    check.outputs.length > artifactLimits.checkCount
  )
    return fail('invalid-check-execution');
  const outputs: ArtifactOutput[] = [];
  for (const value of check.outputs) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return fail('invalid-check-execution');
    const output = { ...value } as Record<string, unknown>;
    const outputKeys = Reflect.ownKeys(value);
    if (
      outputKeys.length !== 3 ||
      !['bytes', 'label', 'mime'].every((key) => outputKeys.includes(key)) ||
      typeof output.label !== 'string' ||
      (output.mime !== 'text/plain' && output.mime !== 'image/png') ||
      !(output.bytes instanceof Uint8Array)
    )
      return fail('invalid-check-execution');
    const copied: ArtifactOutput = { label: output.label, mime: output.mime, bytes: output.bytes };
    outputs.push({ ...copied, bytes: validateOutput(copied) });
  }
  if (outputs.reduce((sum, output) => sum + output.bytes.byteLength, 0) > artifactLimits.checkBytes)
    return fail('invalid-check-execution');
  return {
    type: 'completed',
    check: {
      kind,
      candidate: check.candidate,
      configuration: check.configuration,
      passed: check.passed,
      simulated: true,
      outputs,
    },
  };
}
