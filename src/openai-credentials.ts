import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createModels } from '@earendil-works/pi-ai';
import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
  OAuthCredential,
} from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';

const applicationId = 0x45495452;
const unavailable = () => new Error('credential-store-unavailable');
// The SDK contract preserves caller callback rejections, unlike storage failures.
class CallbackFailure {
  reason: unknown;
  constructor(reason: unknown) {
    this.reason = reason;
  }
}
const defaultDirectory = () => join(homedir(), '.eitri-oauth');
type State = {
  version: 1;
  installationId: string;
  clientId?: string;
  credential?: OAuthCredential;
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 64_000;
}
function validCredential(value: unknown): value is OAuthCredential {
  return (
    object(value) &&
    Object.keys(value).every((key) =>
      ['type', 'access', 'refresh', 'expires', 'clientId', 'scopes'].includes(key),
    ) &&
    value.type === 'oauth' &&
    text(value.access) &&
    text(value.refresh) &&
    text(value.clientId) &&
    typeof value.expires === 'number' &&
    Number.isFinite(value.expires) &&
    value.expires >= 0 &&
    Array.isArray(value.scopes) &&
    value.scopes.length <= 100 &&
    value.scopes.every(text) &&
    value.scopes.includes('chatgpt.tokens.use.direct')
  );
}
function parseState(data: unknown): State {
  if (typeof data !== 'string' || data.length > 256_000) throw unavailable();
  const state: unknown = JSON.parse(data);
  if (
    !object(state) ||
    !Object.keys(state).every((key) =>
      ['version', 'installationId', 'clientId', 'credential'].includes(key),
    ) ||
    state.version !== 1 ||
    typeof state.installationId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      state.installationId,
    ) ||
    (state.clientId !== undefined && !text(state.clientId)) ||
    (state.credential !== undefined &&
      (!validCredential(state.credential) || state.credential.clientId !== state.clientId))
  )
    throw unavailable();
  return state as State;
}

async function privatePath(path: string, directory: boolean) {
  const stat = await lstat(path);
  if (
    (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o7777) !== (directory ? 0o700 : 0o600)
  )
    throw unavailable();
  return stat;
}

/** Trusted controller-only store. No credentials are written to case data or worker mounts.
 * SQLite DELETE-journal transactions are atomic, including across processes. Busy owners fail
 * closed rather than blocking Node during an async refresh; callers may explicitly retry later.
 * Custom directories are for isolated tests; production uses the separate global default.
 * Same-UID malicious filesystem replacement and filesystem/host compromise are outside this boundary.
 */
export class OpenAICredentialStore implements CredentialStore {
  private db: DatabaseSync;
  private directory: string;
  private file: string;
  private inode: number;
  private device: number;
  private queue: Promise<unknown> = Promise.resolve();
  private closing = false;
  private closed?: Promise<void>;

  private constructor(db: DatabaseSync, directory: string, inode: number, device: number) {
    this.db = db;
    this.directory = directory;
    this.file = join(directory, 'credentials.sqlite');
    this.inode = inode;
    this.device = device;
  }

  static async open(directory = defaultDirectory()): Promise<OpenAICredentialStore> {
    let db: DatabaseSync | undefined;
    try {
      if (!isAbsolute(directory)) throw unavailable();
      // Do not chmod existing paths or silently repair unsafe/corrupt stores.
      await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
      await privatePath(directory, true);
      directory = await realpath(directory);
      for (let parent = directory; ; parent = dirname(parent)) {
        const git = await lstat(join(parent, '.git')).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
        if (git) throw unavailable();
        if (dirname(parent) === parent) break;
      }
      const file = join(directory, 'credentials.sqlite');
      let created = false;
      const fd = await open(
        file,
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      )
        .then((handle) => {
          created = true;
          return handle;
        })
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error;
          return open(file, constants.O_RDWR | constants.O_NOFOLLOW);
        });
      await fd.close();
      const stat = await privatePath(file, false);
      db = new DatabaseSync(file);
      db.exec('PRAGMA busy_timeout = 0; PRAGMA secure_delete = ON; PRAGMA synchronous = FULL');
      if (
        !created &&
        (db.prepare('PRAGMA application_id').get()?.application_id !== applicationId ||
          db.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'delete')
      )
        throw unavailable();
      if (created) {
        db.exec(`BEGIN IMMEDIATE; PRAGMA application_id = ${applicationId};
          CREATE TABLE private_state (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)`);
        db.prepare('INSERT INTO private_state VALUES (1, ?)').run(
          JSON.stringify({ version: 1, installationId: randomUUID() }),
        );
        db.exec('COMMIT');
        // Persist the directory entry as well as SQLite's transaction contents.
        const dir = await open(
          directory,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        try {
          await dir.sync();
        } finally {
          await dir.close();
        }
      }
      const store = new OpenAICredentialStore(db, directory, stat.ino, stat.dev);
      store.state();
      return store;
    } catch {
      db?.close();
      throw unavailable();
    }
  }

  private state(): State {
    return parseState(this.db.prepare('SELECT data FROM private_state WHERE id = 1').get()?.data);
  }

  private serial<T>(operation: () => Promise<T>, options?: AuthOperationOptions): Promise<T> {
    if (this.closing) return Promise.reject(unavailable());
    const next = this.queue
      .then(async () => {
        options?.signal?.throwIfAborted();
        await privatePath(this.directory, true);
        const stat = await privatePath(this.file, false);
        if (stat.ino !== this.inode || stat.dev !== this.device) throw unavailable();
        options?.signal?.throwIfAborted();
        return operation();
      })
      .catch((error) => {
        if (error instanceof CallbackFailure) throw error.reason;
        throw unavailable();
      });
    this.queue = next.catch(() => {});
    return next;
  }

  identity(options?: AuthOperationOptions) {
    return this.serial(async () => {
      const { installationId, clientId } = this.state();
      return { agentName: 'Eitri' as const, installationId, ...(clientId ? { clientId } : {}) };
    }, options);
  }

  read(providerId: string, options?: AuthOperationOptions): Promise<OAuthCredential | undefined> {
    return this.serial(async () => {
      if (providerId !== 'openai') throw unavailable();
      return this.state().credential;
    }, options);
  }

  list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    return this.serial(
      async () => (this.state().credential ? [{ providerId: 'openai', type: 'oauth' }] : []),
      options,
    );
  }

  private mutate(
    providerId: string,
    update: (state: State) => Promise<boolean>,
    options?: AuthOperationOptions,
  ) {
    return this.serial(async () => {
      if (providerId !== 'openai') throw unavailable();
      options?.signal?.throwIfAborted();
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const state = this.state();
        const changed = await update(state);
        options?.signal?.throwIfAborted();
        const data = JSON.stringify(state);
        const persisted = parseState(data);
        if (changed) this.db.prepare('UPDATE private_state SET data = ? WHERE id = 1').run(data);
        this.db.exec('COMMIT');
        return persisted.credential;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }, options);
  }

  modify(
    providerId: string,
    fn: (current: OAuthCredential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    return this.mutate(
      providerId,
      async (state) => {
        let next: Credential | undefined;
        try {
          next = await fn(structuredClone(state.credential));
        } catch (error) {
          throw new CallbackFailure(error);
        }
        if (next !== undefined) {
          if (!validCredential(next)) throw unavailable();
          state.credential = structuredClone(next);
          state.clientId = next.clientId as string;
        }
        return next !== undefined;
      },
      options,
    );
  }

  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return this.mutate(
      providerId,
      async (state) => {
        const changed = state.credential !== undefined;
        delete state.credential;
        return changed;
      },
      options,
    ).then(() => {});
  }

  close(): Promise<void> {
    if (!this.closed) {
      this.closing = true;
      this.closed = this.queue.then(() => {
        this.db.close();
      });
    }
    return this.closed;
  }
}

/** Offline integration building block, not production dispatch or a login/inference command.
 * Only the SDK's OpenAI OAuth refresh is reachable. No provider mutation, request overrides,
 * API-key handlers, ambient credentials, login, model execution or fallback is exposed.
 * Auth results remain controller-private; do not serialize them into logs, messages or GPUI.
 */
export function createOpenAIOAuthAccess(credentials: OpenAICredentialStore) {
  const models = createModels({
    credentials,
    authContext: { env: async () => undefined, fileExists: async () => false },
  });
  const provider = openaiProvider();
  models.setProvider({ ...provider, auth: { oauth: provider.auth.oauth } });
  return {
    async resolve(options?: AuthOperationOptions) {
      try {
        const result = await models.getAuth('openai', { signal: options?.signal });
        if (!result || result.source !== 'OAuth') throw unavailable();
        return result;
      } catch {
        // Provider errors may contain token endpoint bodies. Never expose causes/raw errors.
        throw new Error('openai-oauth-unavailable');
      }
    },
  };
}
