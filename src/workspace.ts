import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, chmod } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { digest, fail, uuid } from './domain.ts';

type Brand<T extends string> = string & { readonly __brand: T };
export type CaseId = Brand<'WorkspaceCaseId'>;
export type RepositoryId = Brand<'RepositoryId'>;
export type RequestId = Brand<'WorkspaceRequestId'>;
export type ExportId = Brand<'ExportId'>;
export type GitObjectId = Brand<'GitObjectId'>;
export type GitRevision = Brand<'GitRevision'>;
export type Sha256 = Brand<'Sha256'>;
export type VirtualPath = Brand<'VirtualPath'>;

function identifier<T extends string>(value: unknown): Brand<T> {
  if (!uuid(value) || value !== value.toLowerCase()) return fail('invalid-workspace-id');
  return value as Brand<T>;
}
export const caseId = (v: unknown) => identifier<'WorkspaceCaseId'>(v);
export const repositoryId = (v: unknown) => identifier<'RepositoryId'>(v);
export const requestId = (v: unknown) => identifier<'WorkspaceRequestId'>(v);
function hexadecimal<T extends string>(v: unknown, length: number): Brand<T> {
  if (typeof v !== 'string' || v.length !== length || !/^[0-9a-f]+$/.test(v))
    return fail('invalid-workspace-hash');
  return v as Brand<T>;
}
export const sha256 = (v: unknown) => hexadecimal<'Sha256'>(v, 64);
export const gitRevision = (v: unknown) => hexadecimal<'GitRevision'>(v, 40);
const objectId = (v: unknown) => hexadecimal<'GitObjectId'>(v, 40);
const hash = (bytes: Uint8Array) => sha256(createHash('sha256').update(bytes).digest('hex'));
const blobId = (bytes: Uint8Array) =>
  objectId(createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex'));
const fold = (v: string) => v.normalize('NFKC').toUpperCase().toLowerCase();
const hasControls = (v: string) => /\p{C}/u.test(v);
export function virtualPath(v: unknown): VirtualPath {
  if (
    typeof v !== 'string' ||
    !v.isWellFormed() ||
    v.normalize('NFC') !== v ||
    Buffer.byteLength(v) > 512 ||
    hasControls(v) ||
    /[\\:]/u.test(v) ||
    v.split('/').length > 16 ||
    v.split('/').some((p) => !p || p === '.' || p === '..' || /[. ]$/.test(p) || fold(p) === '.git')
  )
    return fail('invalid-workspace-path');
  return v as VirtualPath;
}

export const workspaceLimits = Object.freeze({
  fileBytes: 1024 * 1024,
  files: 1024,
  workspaceBytes: 32 * 1024 * 1024,
  cases: 8,
  repositories: 4,
  receipts: 128,
  attempts: 128,
  repositoryBytes: 512 * 1024 * 1024,
  journalBytes: 64 * 1024 * 1024,
  metadataFiles: 65536,
  gitOutputBytes: 2 * 1024 * 1024,
  exports: 16,
  freezes: 64,
});
export type WorkspaceCheckpoint = Readonly<{
  revision: GitRevision;
  tree: GitObjectId;
  manifestDigest: Sha256;
  sequence: number;
}>;
export type BaselineFile = Readonly<{ virtualPath: VirtualPath; bytes: Uint8Array }>;
export type BrokerEdit = Readonly<{
  requestId: RequestId;
  virtualPath: VirtualPath;
  expectedHash: Sha256 | null;
  bytes: Uint8Array;
}>;
export type PendingEdit = Readonly<{
  requestId: RequestId;
  requestDigest: Sha256;
  previousCheckpoint: WorkspaceCheckpoint;
  virtualPath: VirtualPath;
  beforeHash: Sha256 | null;
  afterHash: Sha256;
  payloadObject: GitObjectId;
}>;
export type SavedReceipt = Readonly<{
  requestId: RequestId;
  virtualPath: VirtualPath;
  sha256: Sha256;
  checkpoint: WorkspaceCheckpoint;
}>;
export type FrozenRevision = Readonly<{
  caseId: CaseId;
  revision: GitRevision;
  manifestDigest: Sha256;
}>;
type Identity = { dev: string; ino: string; mode: number };
type Node =
  | { path: string; identity: Identity; kind: 'directory' }
  | { path: string; identity: Identity; kind: 'file'; size: number; hash: Sha256 };
type File = {
  path: VirtualPath;
  size: number;
  hash: Sha256;
  object: GitObjectId;
  baseline: boolean;
};
type Materialized = { files: File[]; nodes: Node[] };
type Provisioning = { state: 'provisioning' };
type Ready = {
  state: 'ready';
  baseRevision: GitRevision;
  checkpoint: WorkspaceCheckpoint;
  materialized: Materialized;
};
type Editing = {
  state: 'editing';
  baseRevision: GitRevision;
  checkpoint: WorkspaceCheckpoint;
  materialized: Materialized;
  pending: PendingEdit;
  payload: string;
};
type Uncertain = { state: 'uncertain'; reason: string; previous: Provisioning | Ready | Editing };
type CaseRecord = {
  caseId: CaseId;
  repositoryId: RepositoryId;
  status: Provisioning | Ready | Editing | Uncertain;
  receipts: { digest: Sha256; receipt: SavedReceipt }[];
};
export type Workspace = Readonly<{ caseId: CaseId; repositoryId: RepositoryId }> &
  (
    | Readonly<{ state: 'provisioning' }>
    | Readonly<{ state: 'ready'; baseRevision: GitRevision; checkpoint: WorkspaceCheckpoint }>
    | Readonly<{
        state: 'editing';
        baseRevision: GitRevision;
        checkpoint: WorkspaceCheckpoint;
        pendingEdit: PendingEdit;
      }>
    | Readonly<{
        state: 'uncertain';
        reason: string;
        previous:
          | Readonly<{ state: 'provisioning' }>
          | Readonly<{
              state: 'checkpoint';
              baseRevision: GitRevision;
              checkpoint: WorkspaceCheckpoint;
              pendingEdit: PendingEdit | null;
            }>;
      }>
  );
type Repository = {
  id: RepositoryId;
  state: 'provisioning' | 'ready';
  reservedBytes: number;
  attempts: number;
};
type FrozenRecord = { frozen: FrozenRevision; checkpoint: WorkspaceCheckpoint; files: File[] };
type ExportRecord = { id: ExportId; frozen: FrozenRevision; state: 'provisioning' | 'ready' };
type Journal = {
  version: 1;
  regressionDirectory: VirtualPath;
  journalIdentity: Identity;
  inventory: Node[];
  cases: CaseRecord[];
  repositories: Repository[];
  frozen: FrozenRecord[];
  exports: ExportRecord[];
};
export type WorkspaceFaultPoint =
  | 'after-provision-intent'
  | 'after-provision-repository'
  | 'after-provision-worktree'
  | 'after-intent'
  | 'after-file'
  | 'after-commit'
  | 'after-ref'
  | 'after-checkpoint'
  | 'before-response';
type Options = {
  directory: string;
  regressionDirectory: VirtualPath;
  fault?: (point: WorkspaceFaultPoint, id: CaseId) => void | Promise<void>;
};

type OwnerMarker = { version: 1; root: string; rootIdentity: Identity; journalIdentity: Identity };
const config =
  '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = true\n\tlogallrefupdates = false\n[gc]\n\tauto = 0\n[maintenance]\n\tauto = false\n';
const owners = new Set<string>();
const same = (a: unknown, b: unknown) => digest(a) === digest(b);
const manifestDigest = (files: File[]) =>
  sha256(
    digest(
      files.map(({ path, size, hash, object }) => ({ path, size, hash, object, mode: '100644' })),
    ),
  );
function ordered<T extends { path: string }>(entries: T[]): T[] {
  return entries.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}
function checkPaths(paths: string[]) {
  const names = new Map<string, string>();
  const files = new Set(paths);
  for (const path of paths) {
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/');
      const key = fold(prefix);
      if ((names.has(key) && names.get(key) !== prefix) || (i < parts.length && files.has(prefix)))
        fail('workspace-path-collision');
      names.set(key, prefix);
    }
  }
  if (files.size !== paths.length) fail('workspace-path-collision');
}
function boundedFiles(files: File[]) {
  if (
    files.length > workspaceLimits.files ||
    files.reduce((n, f) => n + f.size, 0) > workspaceLimits.workspaceBytes
  )
    fail('workspace-size-limit');
  checkPaths(files.map((f) => f.path));
}
function copiedBytes(bytes: Uint8Array): Buffer {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > workspaceLimits.fileBytes)
    return fail('workspace-file-size-limit');
  return Buffer.from(bytes);
}
function importable(path: VirtualPath) {
  if (
    path
      .split('/')
      .some((p) =>
        /^(\.env(?:\.|$)|oauth(?:\.|$)|connection(?:\.|$)|credentials?(?:\.|$)|\.(?:npmrc|netrc|ssh|aws)$|id_(?:rsa|ed25519)(?:\.|$)|\.envrc$|\.pypirc$|\.git(?:config|-credentials|modules)$)/i.test(
          p,
        ),
      )
  )
    fail('workspace-sensitive-path');
}
function allowed(path: VirtualPath, existing: File | undefined, regression: VirtualPath) {
  importable(path);
  const parts = path.split('/');
  if (
    parts.some(
      (part) =>
        part.startsWith('.') ||
        /^(readme|package|config(?:\.|$)|.*lock(?:file)?(?:\.|$)|build|workflow|polic(?:y|ies)|env(?:\.|$)|docker|tsconfig|(?:gnu)?makefile$|cmakelists\.txt$|justfile$|gruntfile|gulpfile|.*\.config(?:\.|$))/i.test(
          part,
        ),
    )
  )
    fail('workspace-protected-path');
  const test =
    parts.some((p) => /^(tests?|specs?|fixtures?|__tests__|__specs__)$/i.test(p)) ||
    /(?:^|[/._-])(?:tests?|specs?|e2e)(?:[/._-]|$)/i.test(path);
  if (
    (existing?.baseline && (test || path.startsWith(`${regression}/`))) ||
    !(path.startsWith('src/') || (path.startsWith(`${regression}/`) && !existing?.baseline))
  )
    fail('workspace-protected-path');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('corrupt-workspace-journal');
  return value as Record<string, unknown>;
}
function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  const r = record(value);
  if (Object.keys(r).length !== names.length || Object.keys(r).some((k) => !names.includes(k)))
    return fail('invalid-workspace-fields');
  return r;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return fail('corrupt-workspace-journal');
  return value;
}
function integer(v: unknown, max: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > max)
    return fail('corrupt-workspace-journal');
  return v;
}
function string(v: unknown, max = 4096): string {
  if (typeof v !== 'string' || Buffer.byteLength(v) > max) return fail('corrupt-workspace-journal');
  return v;
}
function parseCheckpoint(v: unknown): WorkspaceCheckpoint {
  const r = record(v);
  const sequence = integer(r.sequence, workspaceLimits.receipts);
  return {
    revision: gitRevision(r.revision),
    tree: objectId(r.tree),
    manifestDigest: sha256(r.manifestDigest),
    sequence,
  };
}
function parseFile(v: unknown): File {
  const r = record(v);
  importable(virtualPath(r.path));
  if (typeof r.baseline !== 'boolean') return fail('corrupt-workspace-journal');
  return {
    path: virtualPath(r.path),
    size: integer(r.size, workspaceLimits.fileBytes),
    hash: sha256(r.hash),
    object: objectId(r.object),
    baseline: r.baseline,
  };
}
function parseIdentity(v: unknown): Identity {
  const id = record(v);
  if (!/^\d+$/.test(string(id.dev, 32)) || !/^\d+$/.test(string(id.ino, 32)))
    return fail('corrupt-workspace-journal');
  return { dev: string(id.dev), ino: string(id.ino), mode: integer(id.mode, 0o7777) };
}
function parseNodes(v: unknown): Node[] {
  const nodes = array(v, workspaceLimits.metadataFiles).map((v): Node => {
    const r = record(v);
    const path = string(r.path);
    if (
      path &&
      (path.startsWith('/') ||
        path.split('/').some((p) => !p || p === '.' || p === '..') ||
        path.includes('\\') ||
        hasControls(path))
    )
      return fail('corrupt-workspace-journal');
    const identity = parseIdentity(r.identity);
    if (r.kind === 'directory') return { path, identity, kind: 'directory' };
    if (r.kind !== 'file') return fail('corrupt-workspace-journal');
    return {
      path,
      identity,
      kind: 'file',
      size: integer(r.size, workspaceLimits.repositoryBytes),
      hash: sha256(r.hash),
    };
  });
  if (!same(nodes, ordered([...nodes])) || new Set(nodes.map((n) => n.path)).size !== nodes.length)
    fail('corrupt-workspace-journal');
  return nodes;
}
function parsePending(v: unknown): PendingEdit {
  const r = record(v);
  return {
    requestId: requestId(r.requestId),
    requestDigest: sha256(r.requestDigest),
    previousCheckpoint: parseCheckpoint(r.previousCheckpoint),
    virtualPath: virtualPath(r.virtualPath),
    beforeHash: r.beforeHash === null ? null : sha256(r.beforeHash),
    afterHash: sha256(r.afterHash),
    payloadObject: objectId(r.payloadObject),
  };
}
function parseReceipt(v: unknown): SavedReceipt {
  const r = record(v);
  return {
    requestId: requestId(r.requestId),
    virtualPath: virtualPath(r.virtualPath),
    sha256: sha256(r.sha256),
    checkpoint: parseCheckpoint(r.checkpoint),
  };
}
function parseStatus(v: unknown): CaseRecord['status'] {
  const r = record(v);
  if (r.state === 'provisioning') return { state: 'provisioning' };
  if (r.state === 'uncertain') {
    const previous = parseStatus(r.previous);
    if (previous.state === 'uncertain') return fail('corrupt-workspace-journal');
    return { state: 'uncertain', previous, reason: string(r.reason, 512) };
  }
  const m = record(r.materialized);
  const files = array(m.files, workspaceLimits.files).map(parseFile);
  boundedFiles(files);
  const materialized = { files, nodes: parseNodes(m.nodes) };
  const checkpoint = parseCheckpoint(r.checkpoint),
    baseRevision = gitRevision(r.baseRevision);
  if (
    (checkpoint.sequence === 0 && baseRevision !== checkpoint.revision) ||
    manifestDigest(files) !== checkpoint.manifestDigest
  )
    return fail('corrupt-workspace-journal');
  if (r.state === 'ready') return { state: 'ready', baseRevision, checkpoint, materialized };
  if (r.state !== 'editing') return fail('corrupt-workspace-journal');
  const pending = parsePending(r.pending),
    payload = string(r.payload, 2 * workspaceLimits.fileBytes);
  const bytes = Buffer.from(payload, 'base64');
  if (
    bytes.toString('base64') !== payload ||
    bytes.length > workspaceLimits.fileBytes ||
    hash(bytes) !== pending.afterHash ||
    blobId(bytes) !== pending.payloadObject ||
    !same(checkpoint, pending.previousCheckpoint)
  )
    return fail('corrupt-workspace-journal');
  return { state: 'editing', baseRevision, checkpoint, materialized, pending, payload };
}
function parseFrozen(v: unknown): FrozenRevision {
  const r = record(v);
  return {
    caseId: caseId(r.caseId),
    revision: gitRevision(r.revision),
    manifestDigest: sha256(r.manifestDigest),
  };
}
function parseJournal(value: unknown): Journal {
  const r = record(value);
  if (r.version !== 1) return fail('corrupt-workspace-journal');
  const cases = array(r.cases, workspaceLimits.cases).map((v): CaseRecord => {
    const c = record(v);
    const receipts = array(c.receipts, workspaceLimits.receipts).map((v) => {
      const r = record(v);
      return { digest: sha256(r.digest), receipt: parseReceipt(r.receipt) };
    });
    if (new Set(receipts.map((r) => r.receipt.requestId)).size !== receipts.length)
      fail('corrupt-workspace-journal');
    return {
      caseId: caseId(c.caseId),
      repositoryId: repositoryId(c.repositoryId),
      status: parseStatus(c.status),
      receipts,
    };
  });
  const repositories = array(r.repositories, workspaceLimits.repositories).map((v): Repository => {
    const r = record(v);
    if (r.state !== 'provisioning' && r.state !== 'ready') return fail('corrupt-workspace-journal');
    return {
      id: repositoryId(r.id),
      state: r.state,
      reservedBytes: integer(r.reservedBytes, workspaceLimits.repositoryBytes),
      attempts: integer(r.attempts, workspaceLimits.attempts),
    };
  });
  if (
    new Set(cases.map((c) => c.caseId)).size !== cases.length ||
    new Set(repositories.map((r) => r.id)).size !== repositories.length ||
    cases.some((c) => !repositories.some((r) => r.id === c.repositoryId))
  )
    fail('corrupt-workspace-journal');
  const frozen = array(r.frozen, workspaceLimits.freezes).map((v): FrozenRecord => {
    const r = record(v),
      frozen = parseFrozen(r.frozen),
      checkpoint = parseCheckpoint(r.checkpoint);
    const files = array(r.files, workspaceLimits.files).map(parseFile);
    boundedFiles(files);
    if (
      frozen.revision !== checkpoint.revision ||
      frozen.manifestDigest !== checkpoint.manifestDigest ||
      manifestDigest(files) !== frozen.manifestDigest ||
      !cases.some((c) => c.caseId === frozen.caseId)
    )
      fail('corrupt-workspace-journal');
    return { frozen, checkpoint, files };
  });
  const exports = array(r.exports, workspaceLimits.exports).map((v): ExportRecord => {
    const r = record(v);
    if (r.state !== 'provisioning' && r.state !== 'ready') return fail('corrupt-workspace-journal');
    return { id: identifier<'ExportId'>(r.id), frozen: parseFrozen(r.frozen), state: r.state };
  });
  return {
    version: 1,
    journalIdentity: parseIdentity(r.journalIdentity),
    regressionDirectory: virtualPath(r.regressionDirectory),
    inventory: parseNodes(r.inventory),
    cases,
    repositories,
    frozen,
    exports,
  };
}

async function identity(path: string): Promise<Identity> {
  const s = await lstat(path, { bigint: true });
  return { dev: String(s.dev), ino: String(s.ino), mode: Number(s.mode & 0o7777n) };
}
async function readRegular(path: string, max: number) {
  const before = await lstat(path, { bigint: true });
  if (
    !before.isFile() ||
    before.nlink !== 1n ||
    before.uid !== BigInt(process.getuid?.() ?? -1) ||
    before.size > BigInt(max)
  )
    return fail('unsafe-workspace-file');
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await fd.stat({ bigint: true });
    if (opened.ino !== before.ino || opened.dev !== before.dev) fail('workspace-file-replaced');
    const bytes = await fd.readFile();
    const after = await fd.stat({ bigint: true }),
      named = await lstat(path, { bigint: true });
    if (
      bytes.length > max ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      before.ino !== named.ino ||
      before.dev !== named.dev ||
      after.nlink !== 1n
    )
      fail('workspace-file-replaced');
    return bytes;
  } finally {
    await fd.close();
  }
}
async function writePrivate(path: string, bytes: Uint8Array) {
  const fd = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await fd.writeFile(bytes);
    await fd.sync();
  } finally {
    await fd.close();
  }
}
async function scan(root: string, mode: 'metadata' | 'workspace'): Promise<Node[]> {
  const result: Node[] = [];
  let total = 0;
  async function walk(relative: string) {
    if (result.length >= workspaceLimits.metadataFiles) fail('workspace-metadata-limit');
    const path = join(root, relative),
      s = await lstat(path);
    const id = await identity(path);
    if (s.isDirectory()) {
      if (mode === 'workspace' ? id.mode !== 0o700 : (id.mode & 0o7022) !== 0)
        fail('unsafe-workspace-mode');
      result.push({ path: relative, identity: id, kind: 'directory' });
      for (const name of (await readdir(path)).sort())
        await walk(relative ? `${relative}/${name}` : name);
      if (!same(id, await identity(path))) fail('workspace-directory-replaced');
    } else {
      if (mode === 'workspace' && relative !== '.git') virtualPath(relative);
      if (mode === 'workspace' ? id.mode !== 0o600 : (id.mode & 0o7133) !== 0)
        fail('unsafe-workspace-mode');
      const bytes = await readRegular(
        path,
        mode === 'workspace' ? workspaceLimits.fileBytes : workspaceLimits.gitOutputBytes,
      );
      total += bytes.length;
      if (
        total >
        (mode === 'workspace'
          ? workspaceLimits.workspaceBytes + 4096
          : workspaceLimits.repositoryBytes)
      )
        fail('workspace-size-limit');
      result.push({
        path: relative,
        identity: id,
        kind: 'file',
        size: bytes.length,
        hash: hash(bytes),
      });
    }
  }
  await walk('');
  return ordered(result);
}

type GitOperation =
  | { kind: 'init'; repository: RepositoryId }
  | { kind: 'worktree'; caseId: CaseId; revision: GitRevision }
  | { kind: 'blob'; bytes: Buffer }
  | { kind: 'tree'; bytes: Buffer }
  | { kind: 'commit'; tree: GitObjectId; parent: GitRevision | null; sequence: number }
  | { kind: 'read'; type: 'blob' | 'tree' | 'commit'; object: GitObjectId | GitRevision }
  | { kind: 'ref'; caseId: CaseId }
  | { kind: 'cas'; caseId: CaseId; revision: GitRevision; previous: GitRevision | null };

/** One private owner is required. Node path checks do not exclude malicious same-UID races.
 * Exports are commit bytes, not containment. Workers still require a read-only container mount.
 * Known environment and credential paths are rejected. Arbitrary source is not secret-scanned.
 * The root must be fresh and empty or have this store's inode-bound marker and catalogue.
 * Interrupted initial store creation is rejected, not adopted. SQLite may roll back its own journal.
 * Reopening interrupted intents preserves files and parks uncertainty without replay or repair.
 */
export class WorkspaceStore {
  private db: DatabaseSync;
  private data: Journal;
  private options: Options;
  private directory: string;
  private queue: Promise<unknown> = Promise.resolve();
  private closing = false;
  private broken = false;
  private constructor(directory: string, db: DatabaseSync, data: Journal, options: Options) {
    this.directory = directory;
    this.db = db;
    this.data = data;
    this.options = options;
  }
  static async open(options: Options): Promise<WorkspaceStore> {
    const directory = resolve(options.directory),
      regressionDirectory = virtualPath(options.regressionDirectory);
    if (
      regressionDirectory.startsWith('src/') ||
      regressionDirectory === 'src' ||
      regressionDirectory.split('/').some((s) => s.startsWith('.'))
    )
      fail('invalid-regression-directory');
    if (owners.has(directory)) fail('workspace-already-open');
    owners.add(directory);
    let db: DatabaseSync | undefined;
    try {
      const stat = await lstat(directory);
      if (
        hasControls(directory) ||
        !stat.isDirectory() ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o7777) !== 0o700 ||
        (await realpath(directory)) !== directory
      )
        fail('unsafe-workspace-root');
      const names = await readdir(directory),
        fresh = names.length === 0;
      const journal = join(directory, 'journal.sqlite');
      const markerPath = join(directory, 'workspace-owner');
      if (!fresh && (!names.includes('workspace-owner') || !names.includes('journal.sqlite')))
        fail('unowned-workspace-store');
      if (fresh) {
        for (const name of ['repositories', 'cases', 'exports', 'home', 'xdg', 'empty'])
          await mkdir(join(directory, name), { mode: 0o700 });
        await writePrivate(journal, Buffer.alloc(0));
      }
      const owner: OwnerMarker = {
        version: 1,
        root: directory,
        rootIdentity: await identity(directory),
        journalIdentity: await identity(journal),
      };
      if (fresh) {
        await writePrivate(markerPath, Buffer.from(JSON.stringify(owner)));
        const fd = await open(
          directory,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        try {
          await fd.sync();
        } finally {
          await fd.close();
        }
      } else {
        const parsed: unknown = JSON.parse((await readRegular(markerPath, 4096)).toString());
        if (!same(parsed, owner)) fail('workspace-owner-mismatch');
      }
      const permitted = [
        'cases',
        'empty',
        'exports',
        'home',
        'journal.sqlite',
        'repositories',
        'workspace-owner',
        'xdg',
        'journal.sqlite-journal',
      ];
      if (names.some((name) => !permitted.includes(name))) fail('unexpected-workspace-metadata');
      const hotJournal = names.includes('journal.sqlite-journal');
      if (hotJournal) {
        const rollback = join(directory, 'journal.sqlite-journal');
        await readRegular(rollback, workspaceLimits.journalBytes * 2);
        if ((await identity(rollback)).mode !== 0o600) fail('unsafe-workspace-journal');
      }
      await readRegular(journal, workspaceLimits.journalBytes);
      if ((await identity(journal)).mode !== 0o600 || (await identity(markerPath)).mode !== 0o600)
        fail('unsafe-workspace-journal');
      db = new DatabaseSync(journal, { readOnly: !fresh && !hotJournal });
      db.exec('PRAGMA trusted_schema=OFF;');
      if (Object.values(db.prepare('PRAGMA page_size').get() ?? {})[0] !== 4096)
        fail('corrupt-workspace-journal');
      if (fresh)
        db.exec(
          'PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA max_page_count=16384;',
        );
      if (Object.values(db.prepare('PRAGMA integrity_check').get() ?? {})[0] !== 'ok')
        fail('corrupt-workspace-journal');
      if (fresh)
        db.exec(
          'CREATE TABLE journal (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL, digest TEXT NOT NULL) STRICT;',
        );
      let data: Journal;
      if (fresh)
        data = {
          version: 1,
          journalIdentity: await identity(journal),
          regressionDirectory,
          inventory: [],
          cases: [],
          repositories: [],
          frozen: [],
          exports: [],
        };
      else {
        const row =
          db.prepare('SELECT body, digest FROM journal WHERE id=1').get() ??
          fail('corrupt-workspace-journal');
        const body = string(row.body, workspaceLimits.journalBytes);
        const parsed: unknown = JSON.parse(body);
        if (digest(parsed) !== row.digest) fail('corrupt-workspace-journal');
        data = parseJournal(parsed);
        if (!same(data.journalIdentity, await identity(journal)))
          fail('workspace-journal-replaced');
        if (data.regressionDirectory !== regressionDirectory) fail('workspace-policy-changed');
      }
      const store = new WorkspaceStore(directory, db, data, { ...options, regressionDirectory });
      if (fresh) {
        data.inventory = await store.inventory();
        store.save();
      } else {
        const interrupted = data.cases.some(
          (c) =>
            c.status.state === 'editing' ||
            c.status.state === 'provisioning' ||
            (c.status.state === 'uncertain' &&
              (c.status.previous.state === 'editing' ||
                c.status.previous.state === 'provisioning')),
        );
        if (interrupted) {
          for (const node of data.inventory.filter((n) => n.kind === 'directory')) {
            if (!same(node.identity, await identity(join(directory, node.path))))
              fail('workspace-directory-replaced');
          }
        } else await store.verifyInventory();
        db.close();
        db = new DatabaseSync(journal);
        store.db = db;
        db.exec(
          'PRAGMA trusted_schema=OFF; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA max_page_count=16384;',
        );
        for (const c of data.cases) {
          if (c.status.state === 'editing' || c.status.state === 'provisioning') {
            c.status = {
              state: 'uncertain',
              previous: c.status,
              reason: 'interrupted-workspace-intent',
            };
          } else if (c.status.state === 'ready') {
            if (interrupted) {
              c.status = {
                state: 'uncertain',
                previous: c.status,
                reason: 'shared-workspace-intent-unresolved',
              };
              continue;
            }
            try {
              await store.verify(c, c.status);
            } catch {
              c.status = {
                state: 'uncertain',
                previous: c.status,
                reason: 'workspace-integrity-mismatch',
              };
            }
          }
        }
        store.save();
      }
      return store;
    } catch (error) {
      db?.close();
      owners.delete(directory);
      throw error;
    }
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('workspace-store-closed'));
    const result = this.queue.then(() => {
      if (this.broken) return fail('workspace-journal-failed');
      return fn();
    });
    this.queue = result.catch(() => {});
    return result;
  }
  private save() {
    try {
      const body = JSON.stringify(this.data);
      if (Buffer.byteLength(body) > workspaceLimits.journalBytes / 2)
        fail('workspace-journal-limit');
      this.db.exec('BEGIN IMMEDIATE');
      this.db
        .prepare(
          'INSERT INTO journal VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,digest=excluded.digest',
        )
        .run(body, digest(this.data));
      this.db.exec('COMMIT');
    } catch (e) {
      this.broken = true;
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw e;
    }
  }
  private path(id: CaseId) {
    return join(this.directory, 'cases', id);
  }
  private repo(id: RepositoryId) {
    return join(this.directory, 'repositories', `${id}.git`);
  }
  private get(id: CaseId): CaseRecord {
    return this.data.cases.find((c) => c.caseId === id) ?? fail('workspace-not-found');
  }
  private snapshot(c: CaseRecord): Workspace {
    const identity = { caseId: c.caseId, repositoryId: c.repositoryId },
      s = c.status;
    if (s.state === 'provisioning') return { ...identity, state: 'provisioning' };
    if (s.state === 'ready')
      return structuredClone({
        ...identity,
        state: 'ready',
        baseRevision: s.baseRevision,
        checkpoint: s.checkpoint,
      });
    if (s.state === 'editing')
      return structuredClone({
        ...identity,
        state: 'editing',
        baseRevision: s.baseRevision,
        checkpoint: s.checkpoint,
        pendingEdit: s.pending,
      });
    return structuredClone({
      ...identity,
      state: 'uncertain',
      reason: s.reason,
      previous:
        s.previous.state === 'provisioning'
          ? { state: 'provisioning' }
          : {
              state: 'checkpoint',
              baseRevision: s.previous.baseRevision,
              checkpoint: s.previous.checkpoint,
              pendingEdit: s.previous.state === 'editing' ? s.previous.pending : null,
            },
    });
  }
  private async inventory(): Promise<Node[]> {
    const nodes: Node[] = [
      { path: '', identity: await identity(this.directory), kind: 'directory' },
    ];
    const expected = [
      'cases',
      'empty',
      'exports',
      'home',
      'journal.sqlite',
      'repositories',
      'workspace-owner',
      'xdg',
    ];
    const markerPath = join(this.directory, 'workspace-owner');
    const markerBytes = await readRegular(markerPath, 4096);
    const parsed: unknown = JSON.parse(markerBytes.toString());
    if (
      !same(parsed, {
        version: 1,
        root: this.directory,
        rootIdentity: await identity(this.directory),
        journalIdentity: this.data.journalIdentity,
      }) ||
      (await identity(markerPath)).mode !== 0o600
    )
      fail('workspace-owner-changed');
    nodes.push({
      path: 'workspace-owner',
      identity: await identity(markerPath),
      kind: 'file',
      size: markerBytes.length,
      hash: hash(markerBytes),
    });
    if (!same((await readdir(this.directory)).sort(), expected))
      fail('unexpected-workspace-metadata');
    for (const name of ['cases', 'exports']) {
      const path = join(this.directory, name);
      if (!(await lstat(path)).isDirectory() || (await identity(path)).mode !== 0o700)
        fail('unsafe-workspace-directory');
      nodes.push({ path: name, identity: await identity(path), kind: 'directory' });
      const known: string[] =
        name === 'cases'
          ? this.data.cases.map((c) => c.caseId)
          : this.data.exports.map((e) => e.id);
      if ((await readdir(path)).some((entry) => !known.includes(entry)))
        fail('unexpected-workspace-directory');
    }
    for (const name of ['repositories', 'home', 'xdg', 'empty']) {
      if (name !== 'repositories' && (await readdir(join(this.directory, name))).length)
        fail('unexpected-workspace-metadata');
      for (const node of await scan(join(this.directory, name), 'metadata'))
        nodes.push({ ...node, path: node.path ? `${name}/${node.path}` : name });
    }
    return ordered(nodes);
  }
  private async verifyInventory() {
    if (!same(this.data.inventory, await this.inventory())) fail('workspace-metadata-changed');
    await readRegular(join(this.directory, 'journal.sqlite'), workspaceLimits.journalBytes);
    if (!same(this.data.journalIdentity, await identity(join(this.directory, 'journal.sqlite'))))
      fail('workspace-journal-replaced');
  }
  private async git(repository: RepositoryId, op: GitOperation): Promise<Buffer> {
    const repo = this.repo(repository);
    if (op.kind !== 'init') {
      if ((await readRegular(join(repo, 'config'), 4096)).toString() !== config)
        fail('workspace-config-changed');
      for (const c of this.data.cases.filter(
        (c) =>
          c.repositoryId === repository &&
          (c.status.state === 'ready' || c.status.state === 'editing'),
      ))
        await this.pointer(c);
      for (const node of this.data.inventory.filter(
        (n) => n.kind === 'directory' && (n.path === '' || n.path.startsWith('repositories')),
      )) {
        if (!same(node.identity, await identity(join(this.directory, node.path))))
          fail('workspace-directory-replaced');
      }
    }
    const args = [
      '-c',
      'protocol.allow=never',
      '-c',
      'core.hooksPath=' + join(this.directory, 'empty'),
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.attributesFile=/dev/null',
      '-c',
      'credential.helper=',
      '-c',
      'commit.gpgSign=false',
      '-c',
      'tag.gpgSign=false',
      '-c',
      'gc.auto=0',
      '-c',
      'maintenance.auto=false',
    ];
    if (op.kind !== 'init') args.push('--git-dir=' + repo);
    let input: Buffer = Buffer.alloc(0);
    switch (op.kind) {
      case 'init':
        args.push(
          'init',
          '--bare',
          '--object-format=sha1',
          '--template=' + join(this.directory, 'empty'),
          repo,
        );
        break;
      case 'worktree':
        args.push(
          'worktree',
          'add',
          '--no-checkout',
          '--detach',
          this.path(op.caseId),
          op.revision,
        );
        break;
      case 'blob':
        args.push('hash-object', '-w', '--stdin', '--no-filters');
        input = op.bytes;
        break;
      case 'tree':
        args.push('mktree', '-z');
        input = op.bytes;
        break;
      case 'commit':
        args.push('commit-tree', op.tree, ...(op.parent ? ['-p', op.parent] : []));
        input = Buffer.from(`Workspace checkpoint ${op.sequence}\n`);
        break;
      case 'read':
        args.push('cat-file', op.type, op.object);
        break;
      case 'ref':
        args.push('show-ref', '--verify', '--hash', `refs/heads/cases/${op.caseId}`);
        break;
      case 'cas':
        args.push(
          'update-ref',
          '--no-deref',
          `refs/heads/cases/${op.caseId}`,
          op.revision,
          op.previous ?? '0'.repeat(40),
        );
        break;
      default: {
        const exhaustive: never = op;
        return exhaustive;
      }
    }
    const env = {
      PATH: '/usr/bin:/bin',
      HOME: join(this.directory, 'home'),
      XDG_CONFIG_HOME: join(this.directory, 'xdg'),
      LC_ALL: 'C',
      TZ: 'UTC',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '/usr/bin/false',
      SSH_ASKPASS: '/usr/bin/false',
      GIT_SSH_COMMAND: '/usr/bin/false',
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_ATTR_NOSYSTEM: '1',
      GIT_ALLOW_PROTOCOL: '',
      GIT_PROTOCOL_FROM_USER: '0',
      GIT_AUTHOR_NAME: 'Workspace broker',
      GIT_AUTHOR_EMAIL: 'workspace@invalid',
      GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
      GIT_COMMITTER_NAME: 'Workspace broker',
      GIT_COMMITTER_EMAIL: 'workspace@invalid',
      GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
    };
    return new Promise<Buffer>((resolve, reject) => {
      const child = spawn('/usr/bin/git', args, {
        cwd: this.directory,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
      const output: Buffer[] = [];
      let bytes = 0,
        failed = false;
      const timer = setTimeout(() => {
        failed = true;
        child.kill('SIGKILL');
      }, 10000);
      child.on('error', reject);
      for (const stream of [child.stdout, child.stderr])
        stream.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > workspaceLimits.gitOutputBytes) {
            failed = true;
            child.kill('SIGKILL');
          } else if (stream === child.stdout) output.push(chunk);
        });
      child.stdin.on('error', () => {});
      child.stdin.end(input);
      child.on('close', (code) => {
        clearTimeout(timer);
        if (failed || code !== 0) reject(new Error('workspace-git-failed'));
        else resolve(Buffer.concat(output));
      });
    });
  }
  private async pointer(c: CaseRecord) {
    const expected = `gitdir: ${join(this.repo(c.repositoryId), 'worktrees', c.caseId)}\n`;
    const path = join(this.path(c.caseId), '.git');
    if ((await readRegular(path, 4096)).toString() !== expected) fail('workspace-pointer-changed');
    const s = c.status;
    if (
      (s.state === 'ready' || s.state === 'editing') &&
      !same(s.materialized.nodes.find((n) => n.path === '.git')?.identity, await identity(path))
    )
      fail('workspace-pointer-changed');
  }
  private async materialized(c: CaseRecord, files: File[]): Promise<Materialized> {
    await this.pointer(c);
    const nodes = await scan(this.path(c.caseId), 'workspace');
    const actual = nodes.filter((n) => n.kind === 'file' && n.path !== '.git');
    if (actual.length > workspaceLimits.files) fail('workspace-size-limit');
    checkPaths(actual.map((n) => n.path));
    if (
      actual.length !== files.length ||
      files.some(
        (f) =>
          !actual.some(
            (n) => n.kind === 'file' && n.path === f.path && n.hash === f.hash && n.size === f.size,
          ),
      )
    )
      fail('workspace-manifest-changed');
    return { files, nodes };
  }
  private async verifyCommit(c: CaseRecord, checkpoint: WorkspaceCheckpoint, files: File[]) {
    const commit = await this.git(c.repositoryId, {
      kind: 'read',
      type: 'commit',
      object: checkpoint.revision,
    });
    if (
      createHash('sha1').update(`commit ${commit.length}\0`).update(commit).digest('hex') !==
        checkpoint.revision ||
      !commit.toString().startsWith(`tree ${checkpoint.tree}\n`)
    )
      fail('workspace-commit-mismatch');
    const tree = await this.buildTree(c.repositoryId, files, false);
    if (tree !== checkpoint.tree || manifestDigest(files) !== checkpoint.manifestDigest)
      fail('workspace-tree-mismatch');
    const verified = new Set<GitObjectId>();
    for (const f of files) {
      if (verified.has(f.object)) continue;
      const bytes = await this.git(c.repositoryId, {
        kind: 'read',
        type: 'blob',
        object: f.object,
      });
      verified.add(f.object);
      if (bytes.length !== f.size || hash(bytes) !== f.hash || blobId(bytes) !== f.object)
        fail('workspace-blob-mismatch');
    }
  }
  private async verify(c: CaseRecord, status: Ready) {
    await this.verifyInventory();
    if (!same(status.materialized, await this.materialized(c, status.materialized.files)))
      fail('workspace-manifest-changed');
    const ref = (await this.git(c.repositoryId, { kind: 'ref', caseId: c.caseId }))
      .toString()
      .trim();
    if (ref !== status.checkpoint.revision) fail('workspace-ref-changed');
    await this.verifyCommit(c, status.checkpoint, status.materialized.files);
  }
  private async ready(c: CaseRecord): Promise<Ready> {
    if (c.status.state !== 'ready') return fail('workspace-not-ready');
    const status = c.status;
    try {
      await this.verify(c, status);
      return status;
    } catch (e) {
      c.status = { state: 'uncertain', previous: status, reason: 'workspace-integrity-mismatch' };
      this.save();
      throw e;
    }
  }
  private reserve(repository: Repository, bytes: number) {
    const amount = bytes + 8 * 1024 * 1024;
    if (
      repository.attempts >= workspaceLimits.attempts ||
      repository.reservedBytes + amount > workspaceLimits.repositoryBytes
    )
      fail('workspace-object-budget');
    repository.attempts++;
    repository.reservedBytes += amount;
  }
  private async buildTree(repo: RepositoryId, files: File[], write: boolean): Promise<GitObjectId> {
    async function tree(store: WorkspaceStore, prefix: string): Promise<GitObjectId> {
      const entries = new Map<string, { mode: string; type: string; object: GitObjectId }>();
      for (const f of files.filter((f) => f.path.startsWith(prefix))) {
        const rest = f.path.slice(prefix.length),
          slash = rest.indexOf('/');
        if (slash === -1) entries.set(rest, { mode: '100644', type: 'blob', object: f.object });
        else {
          const name = rest.slice(0, slash);
          if (!entries.has(name))
            entries.set(name, {
              mode: '40000',
              type: 'tree',
              object: await tree(store, `${prefix}${name}/`),
            });
        }
      }
      const sorted = [...entries].sort(([a, x], [b, y]) =>
        Buffer.compare(
          Buffer.from(a + (x.type === 'tree' ? '/' : '\0')),
          Buffer.from(b + (y.type === 'tree' ? '/' : '\0')),
        ),
      );
      const raw = Buffer.concat(
        sorted.map(([name, e]) =>
          Buffer.concat([Buffer.from(`${e.mode} ${name}\0`), Buffer.from(e.object, 'hex')]),
        ),
      );
      const expected = objectId(
        createHash('sha1').update(`tree ${raw.length}\0`).update(raw).digest('hex'),
      );
      if (write) {
        const input = Buffer.concat(
          sorted.map(([name, e]) => Buffer.from(`${e.mode} ${e.type} ${e.object}\t${name}\0`)),
        );
        if (
          objectId((await store.git(repo, { kind: 'tree', bytes: input })).toString().trim()) !==
          expected
        )
          fail('workspace-tree-mismatch');
      } else if (
        !(await store.git(repo, { kind: 'read', type: 'tree', object: expected })).equals(raw)
      )
        fail('workspace-tree-mismatch');
      return expected;
    }
    return tree(this, '');
  }
  private async checkpoint(
    c: CaseRecord,
    files: File[],
    previous: GitRevision | null,
    sequence: number,
  ): Promise<WorkspaceCheckpoint> {
    const tree = await this.buildTree(c.repositoryId, files, true);
    const revision = gitRevision(
      (await this.git(c.repositoryId, { kind: 'commit', tree, parent: previous, sequence }))
        .toString()
        .trim(),
    );
    const checkpoint = { revision, tree, manifestDigest: manifestDigest(files), sequence };
    await this.verifyCommit(c, checkpoint, files);
    return checkpoint;
  }
  private async directories(root: string, path: VirtualPath) {
    let current = root;
    for (const part of path.split('/').slice(0, -1)) {
      current = join(current, part);
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (e) {
        if (!(e instanceof Error && 'code' in e && e.code === 'EEXIST')) throw e;
      }
      const s = await lstat(current);
      if (!s.isDirectory() || (s.mode & 0o7777) !== 0o700) fail('unsafe-workspace-directory');
    }
  }
  async provision(input: {
    caseId: CaseId;
    repositoryId: RepositoryId;
    baseline: readonly BaselineFile[];
  }): Promise<Workspace> {
    fields(input, ['caseId', 'repositoryId', 'baseline']);
    const id = caseId(input.caseId),
      repoId = repositoryId(input.repositoryId);
    if (!Array.isArray(input.baseline) || input.baseline.length > workspaceLimits.files)
      fail('workspace-size-limit');
    let total = 0;
    const copied = input.baseline.map((f) => {
      fields(f, ['virtualPath', 'bytes']);
      const path = virtualPath(f.virtualPath);
      importable(path);
      if (
        !(f.bytes instanceof Uint8Array) ||
        (total += f.bytes.length) > workspaceLimits.workspaceBytes
      )
        return fail('workspace-size-limit');
      const bytes = copiedBytes(f.bytes);
      return { path, bytes };
    });
    const files = ordered(
      copied.map(({ path, bytes }): File => ({
        path,
        hash: hash(bytes),
        size: bytes.length,
        object: blobId(bytes),
        baseline: true,
      })),
    );
    boundedFiles(files);
    return this.serial(async () => {
      await this.verifyInventory();
      if (this.data.cases.some((c) => c.caseId === id)) fail('workspace-already-exists');
      if (this.data.cases.length >= workspaceLimits.cases) fail('workspace-case-limit');
      let repository = this.data.repositories.find((r) => r.id === repoId);
      const fresh = !repository;
      if (!repository) {
        if (this.data.repositories.length >= workspaceLimits.repositories)
          fail('workspace-repository-limit');
        repository = { id: repoId, state: 'provisioning', reservedBytes: 0, attempts: 0 };
      } else if (repository.state !== 'ready') fail('workspace-repository-not-ready');
      this.reserve(repository, total);
      if (fresh) this.data.repositories.push(repository);
      const c: CaseRecord = {
        caseId: id,
        repositoryId: repoId,
        status: { state: 'provisioning' },
        receipts: [],
      };
      this.data.cases.push(c);
      this.save();
      await this.options.fault?.('after-provision-intent', id);
      try {
        if (fresh) {
          await this.git(repoId, { kind: 'init', repository: repoId });
          await chmod(this.repo(repoId), 0o700);
          await this.privateMetadata(this.repo(repoId));
          const path = join(this.repo(repoId), 'config');
          const fd = await open(
            path,
            constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW,
          );
          try {
            await fd.writeFile(config);
            await fd.sync();
          } finally {
            await fd.close();
          }
        }
        await this.options.fault?.('after-provision-repository', id);
        const written = new Set<GitObjectId>();
        for (const { bytes } of copied) {
          const object = blobId(bytes);
          if (!written.has(object)) {
            if (
              objectId((await this.git(repoId, { kind: 'blob', bytes })).toString().trim()) !==
              object
            )
              fail('workspace-blob-mismatch');
            written.add(object);
          }
        }
        const checkpoint = await this.checkpoint(c, files, null, 0);
        await this.git(repoId, {
          kind: 'cas',
          caseId: id,
          revision: checkpoint.revision,
          previous: null,
        });
        await this.git(repoId, { kind: 'worktree', caseId: id, revision: checkpoint.revision });
        await chmod(this.path(id), 0o700);
        await chmod(join(this.path(id), '.git'), 0o600);
        const head = join(this.repo(repoId), 'worktrees', id, 'HEAD');
        const fd = await open(head, constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW);
        try {
          await fd.writeFile(`ref: refs/heads/cases/${id}\n`);
          await fd.sync();
        } finally {
          await fd.close();
        }
        await this.options.fault?.('after-provision-worktree', id);
        for (const { path, bytes } of copied) {
          await this.directories(this.path(id), path);
          await writePrivate(join(this.path(id), path), bytes);
        }
        await this.privateMetadata(this.repo(repoId));
        c.status = {
          state: 'ready',
          baseRevision: checkpoint.revision,
          checkpoint,
          materialized: await this.materialized(c, files),
        };
        repository.state = 'ready';
        this.data.inventory = await this.inventory();
        this.save();
        return this.snapshot(c);
      } catch (e) {
        c.status = {
          state: 'uncertain',
          previous: { state: 'provisioning' },
          reason: 'workspace-provisioning-failed',
        };
        if (!this.broken) this.save();
        throw e;
      }
    });
  }
  private async privateMetadata(root: string) {
    const s = await lstat(root);
    if (s.isDirectory()) {
      await chmod(root, 0o700);
      for (const p of await readdir(root)) await this.privateMetadata(join(root, p));
    } else {
      if (!s.isFile() || s.nlink !== 1) fail('unsafe-workspace-metadata');
      await chmod(root, 0o600);
    }
  }
  async inspect(value: CaseId): Promise<Workspace> {
    const id = caseId(value);
    return this.serial(async () => {
      const c = this.get(id);
      if (c.status.state === 'ready') {
        try {
          await this.ready(c);
        } catch {
          if (this.snapshot(c).state !== 'uncertain')
            throw new Error('workspace-inspection-failed');
        }
      }
      return this.snapshot(c);
    });
  }
  async read(
    value: CaseId,
    valuePath: VirtualPath,
  ): Promise<Readonly<{ bytes: Uint8Array; sha256: Sha256 }>> {
    const id = caseId(value),
      path = virtualPath(valuePath);
    return this.serial(async () => {
      const c = this.get(id),
        status = await this.ready(c);
      const f =
        status.materialized.files.find((f) => f.path === path) ?? fail('workspace-file-not-found');
      const bytes = await readRegular(join(this.path(id), path), workspaceLimits.fileBytes);
      if (hash(bytes) !== f.hash) fail('workspace-manifest-changed');
      return { bytes, sha256: f.hash };
    });
  }
  async edit(value: CaseId, expected: GitRevision, input: BrokerEdit): Promise<SavedReceipt> {
    fields(input, ['requestId', 'virtualPath', 'expectedHash', 'bytes']);
    const id = caseId(value),
      revision = gitRevision(expected);
    const edit = {
      requestId: requestId(input.requestId),
      virtualPath: virtualPath(input.virtualPath),
      expectedHash: input.expectedHash === null ? null : sha256(input.expectedHash),
      bytes: copiedBytes(input.bytes),
    };
    const requestDigest = sha256(
      digest({
        revision,
        requestId: edit.requestId,
        path: edit.virtualPath,
        before: edit.expectedHash,
        after: hash(edit.bytes),
      }),
    );
    return this.serial(async () => {
      const c = this.get(id),
        saved = c.receipts.find((r) => r.receipt.requestId === edit.requestId);
      if (saved) {
        if (saved.digest !== requestDigest) fail('workspace-request-conflict');
        return structuredClone(saved.receipt);
      }
      const old = c.status.state === 'ready' ? c.status : fail('workspace-not-ready');
      if (old.checkpoint.revision !== revision) fail('workspace-stale-checkpoint');
      const existing = old.materialized.files.find((f) => f.path === edit.virtualPath);
      if ((existing?.hash ?? null) !== edit.expectedHash) fail('workspace-stale-hash');
      allowed(edit.virtualPath, existing, this.data.regressionDirectory);
      if (c.receipts.length >= workspaceLimits.receipts) fail('workspace-receipt-limit');
      const replacement: File = {
        path: edit.virtualPath,
        size: edit.bytes.length,
        hash: hash(edit.bytes),
        object: blobId(edit.bytes),
        baseline: existing?.baseline ?? false,
      };
      const files = ordered([
        ...old.materialized.files.filter((f) => f.path !== edit.virtualPath),
        replacement,
      ]);
      boundedFiles(files);
      await this.ready(c);
      const repository =
        this.data.repositories.find((r) => r.id === c.repositoryId) ??
        fail('workspace-repository-not-found');
      this.reserve(repository, edit.bytes.length);
      const pending: PendingEdit = {
        requestId: edit.requestId,
        requestDigest,
        previousCheckpoint: old.checkpoint,
        virtualPath: edit.virtualPath,
        beforeHash: edit.expectedHash,
        afterHash: replacement.hash,
        payloadObject: replacement.object,
      };
      const editing: Editing = {
        ...old,
        state: 'editing',
        pending,
        payload: edit.bytes.toString('base64'),
      };
      c.status = editing;
      this.save();
      let durable = false;
      try {
        await this.options.fault?.('after-intent', id);
        await this.directories(this.path(id), edit.virtualPath);
        const temporary = join(
          dirname(join(this.path(id), edit.virtualPath)),
          `.broker-${edit.requestId}`,
        );
        await writePrivate(temporary, edit.bytes);
        await rename(temporary, join(this.path(id), edit.virtualPath));
        await this.options.fault?.('after-file', id);
        if (
          objectId(
            (await this.git(c.repositoryId, { kind: 'blob', bytes: edit.bytes })).toString().trim(),
          ) !== replacement.object
        )
          fail('workspace-blob-mismatch');
        const checkpoint = await this.checkpoint(c, files, revision, old.checkpoint.sequence + 1);
        await this.options.fault?.('after-commit', id);
        await this.git(c.repositoryId, {
          kind: 'cas',
          caseId: id,
          revision: checkpoint.revision,
          previous: revision,
        });
        await this.options.fault?.('after-ref', id);
        await this.privateMetadata(this.repo(c.repositoryId));
        const materialized = await this.materialized(c, files);
        const receipt: SavedReceipt = {
          requestId: edit.requestId,
          virtualPath: edit.virtualPath,
          sha256: replacement.hash,
          checkpoint,
        };
        c.status = { state: 'ready', baseRevision: old.baseRevision, checkpoint, materialized };
        c.receipts.push({ digest: requestDigest, receipt });
        this.data.inventory = await this.inventory();
        this.save();
        durable = true;
        await this.options.fault?.('after-checkpoint', id);
        await this.options.fault?.('before-response', id);
        return structuredClone(receipt);
      } catch (e) {
        if (!durable) {
          c.status = { state: 'uncertain', previous: editing, reason: 'workspace-edit-failed' };
          c.receipts = c.receipts.filter((r) => r.receipt.requestId !== edit.requestId);
          if (!this.broken) this.save();
        }
        throw e;
      }
    });
  }
  async freeze(value: CaseId, expected: GitRevision): Promise<FrozenRevision> {
    const id = caseId(value),
      revision = gitRevision(expected);
    return this.serial(async () => {
      const c = this.get(id);
      const current = c.status.state === 'ready' ? c.status : fail('workspace-not-ready');
      if (current.checkpoint.revision !== revision) fail('workspace-stale-checkpoint');
      const status = await this.ready(c);
      const frozen: FrozenRevision = {
        caseId: id,
        revision,
        manifestDigest: status.checkpoint.manifestDigest,
      };
      if (!this.data.frozen.some((r) => same(r.frozen, frozen))) {
        if (this.data.frozen.length >= workspaceLimits.freezes) fail('workspace-freeze-limit');
        this.data.frozen.push({
          frozen,
          checkpoint: status.checkpoint,
          files: status.materialized.files,
        });
        this.save();
      }
      return structuredClone(frozen);
    });
  }
  async exportRevision(
    input: FrozenRevision,
  ): Promise<Readonly<{ exportId: ExportId; revision: GitRevision; manifestDigest: Sha256 }>> {
    fields(input, ['caseId', 'revision', 'manifestDigest']);
    const frozen = parseFrozen(input);
    return this.serial(async () => {
      await this.verifyInventory();
      const record =
        this.data.frozen.find((r) => same(r.frozen, frozen)) ??
        fail('workspace-revision-not-frozen');
      const c = this.get(frozen.caseId);
      if (this.data.exports.length >= workspaceLimits.exports) fail('workspace-export-limit');
      await this.verifyCommit(c, record.checkpoint, record.files);
      const id = identifier<'ExportId'>(randomUUID()),
        root = join(this.directory, 'exports', id);
      const exported: ExportRecord = { id, frozen, state: 'provisioning' };
      this.data.exports.push(exported);
      this.save();
      await mkdir(root, { mode: 0o700 });
      for (const f of record.files) {
        const bytes = await this.git(c.repositoryId, {
          kind: 'read',
          type: 'blob',
          object: f.object,
        });
        if (hash(bytes) !== f.hash || bytes.length !== f.size || blobId(bytes) !== f.object)
          fail('workspace-blob-mismatch');
        await this.directories(root, f.path);
        await writePrivate(join(root, f.path), bytes);
      }
      const nodes = await scan(root, 'workspace');
      if (nodes.filter((n) => n.kind === 'file').length !== record.files.length)
        fail('workspace-export-mismatch');
      for (const node of [...nodes].reverse())
        await chmod(join(root, node.path), node.kind === 'directory' ? 0o500 : 0o400);
      exported.state = 'ready';
      this.save();
      return { exportId: id, revision: frozen.revision, manifestDigest: frozen.manifestDigest };
    });
  }
  async close(): Promise<void> {
    if (this.closing) {
      await this.queue;
      return;
    }
    this.closing = true;
    await this.queue;
    this.db.close();
    owners.delete(this.directory);
  }
}
