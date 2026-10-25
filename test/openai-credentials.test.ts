import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import type { OAuthCredential } from '@earendil-works/pi-ai';
import { OpenAICredentialStore, createOpenAIOAuthAccess } from '../src/openai-credentials.ts';

const credential = (suffix = '', expires = Date.now() + 3_600_000): OAuthCredential => ({
  type: 'oauth',
  access: `synthetic-access${suffix}`,
  refresh: `synthetic-refresh${suffix}`,
  expires,
  clientId: 'oaiapp_synthetic',
  scopes: ['openid', 'chatgpt.tokens.use.direct'],
});

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eitri-oauth-test-'));
  const directory = join(root, 'private');
  const stores: OpenAICredentialStore[] = [];
  t.after(async () => {
    await Promise.all(stores.map((store) => store.close()));
    await rm(root, { recursive: true, force: true });
  });
  const open = async () => {
    const store = await OpenAICredentialStore.open(directory);
    stores.push(store);
    return store;
  };
  return { root, directory, open };
}

test('private atomic store reopens with host, issued client and detached credentials; logout retains identity', async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  const first = await store.identity();
  assert.equal(first.agentName, 'Eitri');
  assert.match(first.installationId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(await store.list(), []);
  const input = credential();
  await store.modify('openai', async () => input);
  input.access = 'not-persisted';
  const read = await store.read('openai');
  assert.equal(read?.access, 'synthetic-access');
  if (read) read.access = 'also-not-persisted';
  assert.equal((await store.read('openai'))?.access, 'synthetic-access');
  assert.deepEqual(await store.list(), [{ providerId: 'openai', type: 'oauth' }]);
  assert.equal((await lstat(f.directory)).mode & 0o7777, 0o700);
  assert.equal((await lstat(join(f.directory, 'credentials.sqlite'))).mode & 0o7777, 0o600);
  await store.close();
  const reopened = await f.open();
  assert.equal((await reopened.identity()).installationId, first.installationId);
  assert.equal((await reopened.read('openai'))?.refresh, 'synthetic-refresh');
  await reopened.delete('openai');
  assert.equal(await reopened.read('openai'), undefined);
  assert.deepEqual(await reopened.identity(), { ...first, clientId: 'oaiapp_synthetic' });
  await reopened.close();
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { OpenAICredentialStore } from './src/openai-credentials.ts';
    const store = await OpenAICredentialStore.open(process.argv[1]);
    console.log(JSON.stringify(await store.identity()));
    await store.close();
  `,
      f.directory,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { ...first, clientId: 'oaiapp_synthetic' });
});

test('mutations serialize across instances; contention fails closed and callback failures roll back', async (t) => {
  const f = await fixture(t);
  const a = await f.open();
  const b = await f.open();
  await a.modify('openai', async () => credential());
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const active = a.modify('openai', async () => {
    started();
    await wait;
    return credential('-new');
  });
  await ready;
  await assert.rejects(
    b.modify('openai', async () => credential('-competing')),
    /credential-store-unavailable/,
  );
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import { OpenAICredentialStore } from './src/openai-credentials.ts';
    const store = await OpenAICredentialStore.open(process.argv[1]);
    await assert.rejects(store.delete('openai'), /^Error: credential-store-unavailable$/);
    await store.close();
  `,
      f.directory,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
  const abort = new AbortController();
  const cancelled = a.modify(
    'openai',
    async () => {
      throw new Error('must-not-run');
    },
    { signal: abort.signal },
  );
  const cancelledCheck = assert.rejects(cancelled, /credential-store-unavailable/);
  abort.abort();
  const queued = a.modify('openai', async (current) => {
    assert.equal(current?.refresh, 'synthetic-refresh-new');
    return undefined;
  });
  release();
  await Promise.all([active, queued, cancelledCheck]);
  const callbackError = new Error('synthetic-callback-error');
  await assert.rejects(
    a.modify('openai', async (current) => {
      if (current) current.refresh = 'not-committed';
      throw callbackError;
    }),
    (error) => error === callbackError,
  );
  assert.equal((await b.read('openai'))?.refresh, 'synthetic-refresh-new');
});

test('cancellation before and during mutation cannot commit; close drains pending writes', async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  let calls = 0;
  await assert.rejects(
    store.modify(
      'openai',
      async () => {
        calls++;
        return credential();
      },
      { signal: AbortSignal.abort() },
    ),
  );
  assert.equal(calls, 0);
  const abort = new AbortController();
  await assert.rejects(
    store.modify(
      'openai',
      async () => {
        abort.abort();
        return credential();
      },
      { signal: abort.signal },
    ),
  );
  assert.equal(await store.read('openai'), undefined);
  const write = store.modify('openai', async () => credential());
  const close = store.close();
  await write;
  await close;
  await assert.rejects(store.read('openai'), /credential-store-unavailable/);
  assert.equal((await (await f.open()).read('openai'))?.access, 'synthetic-access');
});

for (const invalid of [
  { type: 'api_key', key: 'synthetic-key' },
  { ...credential(), clientId: '' },
  { ...credential(), access: '' },
  { ...credential(), expires: Number.NaN },
  { ...credential(), scopes: ['openid'] },
  { ...credential(), extraSecret: 'not-allowed' },
])
  test('invalid or non-OAuth credentials fail closed', async (t) => {
    const store = await (await fixture(t)).open();
    await assert.rejects(store.modify('openai', async () => invalid as OAuthCredential));
    assert.equal(await store.read('openai'), undefined);
    await assert.rejects(store.modify('anthropic', async () => credential()));
  });

for (const unsafe of [
  'directory-mode',
  'directory-link',
  'file-mode',
  'file-link',
  'file-hardlink',
  'repository',
]) {
  test(`refuses unsafe storage: ${unsafe}`, async (t) => {
    const f = await fixture(t);
    if (unsafe === 'repository') {
      await mkdir(join(f.root, '.git'));
    } else {
      const store = await f.open();
      await store.close();
      const file = join(f.directory, 'credentials.sqlite');
      if (unsafe === 'directory-mode') await chmod(f.directory, 0o755);
      if (unsafe === 'file-mode') await chmod(file, 0o644);
      if (unsafe === 'file-hardlink') await link(file, join(f.root, 'linked'));
      if (unsafe === 'file-link') {
        await rm(file);
        await symlink(join(f.root, 'absent'), file);
      }
      if (unsafe === 'directory-link') {
        await rm(f.directory, { recursive: true });
        await mkdir(join(f.root, 'target'), { mode: 0o700 });
        await symlink(join(f.root, 'target'), f.directory);
      }
    }
    await assert.rejects(f.open(), /^Error: credential-store-unavailable$/);
  });
}

test('corruption and SQLite write failure never return usable auth or erase prior committed credentials', async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  await store.modify('openai', async () => credential());
  const db = new DatabaseSync(join(f.directory, 'credentials.sqlite'));
  t.after(() => db.close());
  db.exec(
    "CREATE TRIGGER fail_write BEFORE UPDATE ON private_state BEGIN SELECT RAISE(ABORT, 'synthetic-secret'); END",
  );
  assert.equal((await store.modify('openai', async () => undefined))?.type, 'oauth');
  await assert.rejects(
    store.modify('openai', async () => credential('-lost')),
    /^Error: credential-store-unavailable$/,
  );
  assert.equal((await store.read('openai'))?.refresh, 'synthetic-refresh');
  db.exec('DROP TRIGGER fail_write');
  db.prepare('UPDATE private_state SET data = ?').run('synthetic-corrupt-secret');
  await assert.rejects(
    createOpenAIOAuthAccess(store).resolve(),
    /^Error: openai-oauth-unavailable$/,
  );
  await store.close();
  await assert.rejects(f.open(), /^Error: credential-store-unavailable$/);
  assert.ok((await readFile(join(f.directory, 'credentials.sqlite'))).length > 0);
});

test('OAuth-only boundary ignores ambient keys and cannot resolve absent, other-provider or cancelled auth', async (t) => {
  const store = await (await fixture(t)).open();
  const access = createOpenAIOAuthAccess(store);
  const old = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'synthetic-ambient-billed-key';
  t.after(() => {
    if (old === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = old;
  });
  await assert.rejects(access.resolve(), /^Error: openai-oauth-unavailable$/);
  await store.modify('openai', async () => credential());
  assert.equal((await access.resolve()).source, 'OAuth');
  await assert.rejects(
    access.resolve({ signal: AbortSignal.abort() }),
    /^Error: openai-oauth-unavailable$/,
  );
  assert.deepEqual(Object.keys(access), ['resolve']);
});

test('real pinned SDK refresh rotates once across concurrent requests and persists despite caller cancellation', async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  await store.modify('openai', async () => credential('', 0));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let calls = 0;
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://auth.openai.com/api/accounts/oauth/token');
    assert.ok(init?.body instanceof URLSearchParams);
    assert.equal(init.body.get('client_id'), 'oaiapp_synthetic');
    assert.equal(init.body.get('refresh_token'), 'synthetic-refresh');
    assert.equal(init.body.get('grant_type'), 'refresh_token');
    started();
    await wait;
    assert.equal(init.signal?.aborted, false);
    return Response.json({
      access_token: 'synthetic-rotated-access',
      refresh_token: 'synthetic-rotated-refresh',
      expires_in: 3600,
      scope: 'openid chatgpt.tokens.use.direct',
    });
  };
  const access = createOpenAIOAuthAccess(store);
  const abort = new AbortController();
  const cancelled = access.resolve({ signal: abort.signal });
  await ready;
  const concurrent = Array.from({ length: 5 }, () => access.resolve());
  abort.abort();
  await assert.rejects(cancelled, /^Error: openai-oauth-unavailable$/);
  release();
  for (const result of await Promise.all(concurrent))
    assert.equal(result.auth.apiKey, 'synthetic-rotated-access');
  assert.equal(calls, 1);
  await store.close();
  assert.equal((await (await f.open()).read('openai'))?.refresh, 'synthetic-rotated-refresh');
});

for (const failure of ['rejected', 'malformed', 'network', 'write'])
  test(`refresh ${failure} fails closed without paid fallback`, async (t) => {
    const f = await fixture(t);
    const store = await f.open();
    await store.modify('openai', async () => credential('', 0));
    const oldKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'synthetic-billed-key';
    t.after(() => {
      if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = oldKey;
    });
    const originalFetch = globalThis.fetch;
    t.after(() => {
      globalThis.fetch = originalFetch;
    });
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (failure === 'network') throw new Error('synthetic-sensitive-network-error');
      return failure === 'rejected'
        ? new Response('synthetic-sensitive-response', { status: 401 })
        : Response.json({
            access_token: 'synthetic-new',
            refresh_token: 'synthetic-new-refresh',
            expires_in: 3600,
            scope: failure === 'malformed' ? 'openid' : 'openid chatgpt.tokens.use.direct',
          });
    };
    if (failure === 'write') {
      const db = new DatabaseSync(join(f.directory, 'credentials.sqlite'));
      db.exec(
        "CREATE TRIGGER fail_write BEFORE UPDATE ON private_state BEGIN SELECT RAISE(ABORT, 'synthetic-secret'); END",
      );
      t.after(() => db.close());
    }
    await assert.rejects(
      createOpenAIOAuthAccess(store).resolve(),
      /^Error: openai-oauth-unavailable$/,
    );
    assert.equal(calls, 1);
    assert.equal((await store.read('openai'))?.refresh, 'synthetic-refresh');
  });
