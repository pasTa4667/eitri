import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Fixed synthetic file-store fixture only; no credential store implementation or real fetch.
export async function codexProfileFixture(authPath, access, denied) {
  const read = async () => JSON.parse(await readFile(authPath, 'utf8'));
  const saved = await read();
  const credential = saved['openai-codex'];
  const expired = credential?.expires === 0;
  assert.deepEqual(saved, {
    'openai-codex': {
      type: 'oauth',
      access: expired ? 'synthetic-expired' : access,
      refresh: expired ? 'synthetic-refresh' : 'synthetic-rotated',
      expires: expired ? 0 : credential.expires,
      accountId: 'synthetic-private-account',
    },
  });
  if (!expired) assert.ok(Number.isFinite(credential.expires) && credential.expires > Date.now());
  let refreshes = 0;
  const checkpoint = (point) =>
    new Promise((resolve, reject) => {
      process.once('message', (reply) => {
        try {
          assert.equal(reply, point);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      process.send(point, (error) => {
        if (error) reject(error);
      });
    });
  return {
    async refresh(init) {
      assert.equal(++refreshes, 1);
      assert.ok(expired);
      assert.equal(init.method, 'POST');
      assert.deepEqual(Object.fromEntries(new URLSearchParams(init.body)), {
        grant_type: 'refresh_token',
        refresh_token: 'synthetic-refresh',
        client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
      });
      // Synthetic remote rotation has happened; Pi has not received/persisted its response yet.
      await checkpoint('refresh-response');
      init.signal.throwIfAborted();
      if (denied) return new Response('synthetic-private-refresh-denied', { status: 401 });
      return Response.json({
        access_token: access,
        refresh_token: 'synthetic-rotated',
        expires_in: 3600,
      });
    },
    async provider() {
      const current = (await read())['openai-codex'];
      assert.equal(current.access, access);
      assert.equal(current.refresh, 'synthetic-rotated');
      assert.ok(current.expires > Date.now());
      // Pi's built-in file store has persisted rotation before the provider boundary.
      await checkpoint('provider-request');
    },
    verify() {
      assert.equal(refreshes, expired ? 1 : 0);
    },
  };
}
