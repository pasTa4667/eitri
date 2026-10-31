import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sdkRoot, verifyInstalledSources } from '../../prototypes/pi-stream.mjs';
import { validateAssistant } from '../../prototypes/pi-stream-protocol.mjs';

// Fixed test scenarios, not a credential/stream interface. No real fetch is retained.
const timer = setTimeout(() => process.exit(1), 10_000);
try {
  const scenario = process.argv[2];
  assert.equal(process.argv.length, 3);
  assert.equal(process.env.EITRI_PI_AUTH_CHILD, 'synthetic-only');
  assert.equal(process.env.HOME, process.cwd());
  assert.equal(process.env.PI_CODING_AGENT_DIR, join(process.cwd(), 'agent'));
  assert.equal(process.env.PI_OFFLINE, '1');
  assert.deepEqual(
    Object.keys(process.env)
      .filter((key) => key !== '__CF_USER_TEXT_ENCODING')
      .sort(),
    [
      'EITRI_PI_AUTH_CHILD',
      'HOME',
      'PI_CODING_AGENT_DIR',
      'PI_OFFLINE',
      'PI_SKIP_VERSION_CHECK',
      'PI_TELEMETRY',
    ],
  );
  await verifyInstalledSources();
  const provider = 'openai-codex';
  const privateText = 'synthetic-private-provider-body';
  const expired = {
    type: 'oauth',
    access: 'synthetic-expired',
    refresh: 'synthetic-refresh',
    expires: 0,
    accountId: 'synthetic-account',
  };
  // The built-in decoder needs a JWT-shaped access value, not a genuine signed token.
  const access = `synthetic.${Buffer.from(
    JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_account_id: expired.accountId },
    }),
  ).toString('base64')}.synthetic`;
  const current = {
    ...expired,
    access,
    refresh: 'synthetic-rotated',
    expires: Date.now() + 3_600_000,
  };
  const refreshEntered = Promise.withResolvers();
  const releaseRefresh = Promise.withResolvers();
  const lockQueued = Promise.withResolvers();
  const providerEntered = Promise.withResolvers();
  let refreshes = 0;
  let requests = 0;
  let unexpectedFetches = 0;
  let refreshSignal;
  let contractFailures = 0;
  let deliveredFaults = 0;
  // SDK error handling must not turn a broken fixture assertion into an expected failure.
  const checkFixture = (check) => {
    try {
      check();
    } catch {
      contractFailures++;
      throw new Error('offline-fixture-contract-failed');
    }
  };
  globalThis.fetch = async (url, init) => {
    if (url === 'https://auth.openai.com/oauth/token') {
      refreshes++;
      checkFixture(() => {
        assert.equal(refreshes, 1, 'no refresh retry or competing rotation');
        assert.equal(init.method, 'POST');
        const body = new URLSearchParams(init.body);
        assert.deepEqual([...body.keys()].sort(), ['client_id', 'grant_type', 'refresh_token']);
        assert.equal(body.get('grant_type'), 'refresh_token');
        assert.equal(body.get('refresh_token'), expired.refresh);
        assert.equal(body.get('client_id'), 'app_EMoamEEZ73f0CkXaXp7hrann');
      });
      refreshSignal = init.signal;
      refreshEntered.resolve();
      if (['serialized-refresh', 'cancel-lock-wait', 'cancel-active-refresh'].includes(scenario)) {
        await releaseRefresh.promise;
      }
      init.signal.throwIfAborted();
      if (scenario === 'refresh-rejected') {
        deliveredFaults++;
        return new Response(privateText, { status: 401 });
      }
      if (scenario === 'refresh-malformed') {
        deliveredFaults++;
        return Response.json({ access_token: privateText });
      }
      return Response.json({
        access_token: access,
        refresh_token: current.refresh,
        expires_in: 3600,
      });
    }
    if (url === 'https://chatgpt.com/backend-api/codex/responses') {
      requests++;
      checkFixture(() => {
        assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${access}`);
        assert.equal(new Headers(init.headers).get('chatgpt-account-id'), expired.accountId);
      });
      providerEntered.resolve();
      if (scenario === 'provider-rejected') {
        deliveredFaults++;
        return new Response(privateText, { status: 401 });
      }
      if (scenario === 'cancel-provider') {
        return new Promise((_resolve, reject) => {
          init.signal.throwIfAborted();
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        });
      }
      return new Response(
        `data: ${JSON.stringify({
          type: 'response.completed',
          response: { id: 'synthetic-response', status: 'completed', output: [] },
        })}\n\n`,
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }
    unexpectedFetches++;
    throw new Error('offline-network-forbidden');
  };
  // Deliberately poison ambient keys *inside* the otherwise sanitized child.
  process.env.OPENAI_API_KEY = 'synthetic-poison-key';
  process.env.ANTHROPIC_API_KEY = 'synthetic-poison-key';
  const { ModelRuntime } = await import(pathToFileURL(join(sdkRoot, 'dist/index.js')).href);
  const { InMemoryCredentialStore } = await import(
    pathToFileURL(join(sdkRoot, 'node_modules/@earendil-works/pi-ai/dist/index.js')).href
  );
  const store = new InMemoryCredentialStore();
  const valid = ['provider-rejected', 'cancel-provider'].includes(scenario);
  const initial =
    scenario === 'stored-api-key'
      ? { type: 'api_key', key: 'synthetic-poison-key' }
      : scenario === 'missing-oauth'
        ? undefined
        : valid
          ? current
          : expired;
  if (initial) await store.modify(provider, async () => structuredClone(initial));
  let reads = 0;
  let modifications = 0;
  let callbacks = 0;
  let settled = 0;
  const credentials = {
    read: async (id, options) => {
      checkFixture(() => assert.equal(id, provider));
      reads++;
      if (scenario === 'store-read-failed') {
        deliveredFaults++;
        throw new Error(privateText);
      }
      return store.read(id, options);
    },
    list: (options) => store.list(options),
    modify: (id, fn, options) => {
      checkFixture(() => assert.equal(id, provider));
      if (++modifications === 2) lockQueued.resolve();
      return store
        .modify(
          id,
          async (credential) => {
            callbacks++;
            const next = await fn(structuredClone(credential));
            if (scenario === 'store-write-failed') {
              deliveredFaults++;
              throw new Error(privateText);
            }
            return next;
          },
          options,
        )
        .finally(() => {
          settled++;
        });
    },
    delete: async () => checkFixture(() => assert.fail('deletion forbidden')),
  };
  const runtime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  // Keep the actual built-in provider/OAuth/stream implementation; no provider override.
  const model = runtime.getPhysicalModel(provider, 'gpt-6.1-sol');
  assert.ok(model);
  assert.equal(model.provider, provider);
  assert.equal(model.api, 'openai-codex-responses');
  assert.equal(model.baseUrl, 'https://chatgpt.com/backend-api');
  const start = async (signal) => {
    const events = runtime.streamSimple(
      model,
      {
        messages: [{ role: 'user', content: 'Synthetic auth check only', timestamp: 1 }],
      },
      { signal, transport: 'sse', maxRetries: 0, maxTokens: 16 },
    );
    const terminals = [];
    for await (const event of events) {
      if (event.type === 'done' || event.type === 'error') terminals.push(event);
    }
    assert.equal(terminals.length, 1);
    const result = await events.result();
    assert.deepEqual(result, terminals[0].message ?? terminals[0].error);
    return result;
  };
  const failure = (result, reason = 'error') => {
    assert.equal(result.stopReason, reason);
    assert.deepEqual(result.content, []);
    // Built-in errorMessage/diagnostics are intentionally unsupported by the wire subset.
    assert.throws(() => validateAssistant(result), { message: 'pi-stream-protocol-invalid' });
  };
  if (['serialized-refresh', 'cancel-lock-wait', 'cancel-active-refresh'].includes(scenario)) {
    const firstControl = new AbortController();
    const secondControl = new AbortController();
    const first = start(firstControl.signal);
    await refreshEntered.promise;
    const second = start(secondControl.signal);
    await lockQueued.promise;
    assert.equal(callbacks, 1);
    assert.equal(settled, 0);
    assert.equal(requests, 0);
    if (scenario === 'cancel-lock-wait') {
      secondControl.abort();
      failure(await second);
      assert.equal(callbacks, 1, 'cancelled waiter cannot enter refresh');
    }
    if (scenario === 'cancel-active-refresh') {
      firstControl.abort();
      failure(await first);
      assert.equal(settled, 0, 'cancelled caller is not refresh disposal');
      assert.equal(refreshSignal.aborted, false, 'rotation must survive caller cancellation');
      assert.equal(requests, 0, 'cancelled caller cannot dispatch inference');
      assert.deepEqual(await store.read(provider), initial);
    }
    releaseRefresh.resolve();
    if (scenario !== 'cancel-active-refresh') assert.equal((await first).stopReason, 'stop');
    if (scenario !== 'cancel-lock-wait') assert.equal((await second).stopReason, 'stop');
    assert.equal((await store.read(provider)).refresh, current.refresh);
    assert.equal((await store.read(provider)).access, access);
    assert.equal(settled, 2);
    assert.equal(callbacks, scenario === 'cancel-lock-wait' ? 1 : 2);
    assert.equal(
      (await start()).stopReason,
      'stop',
      'explicit next call reuses rotated credential',
    );
    assert.equal(modifications, 2);
    assert.equal(refreshes, 1);
    assert.equal(requests, scenario === 'serialized-refresh' ? 3 : 2);
  } else if (scenario === 'cancel-before-auth') {
    const control = new AbortController();
    control.abort();
    failure(await start(control.signal));
    assert.equal(reads, 0);
    assert.equal(modifications, 0);
    assert.equal(refreshes, 0);
    assert.equal(requests, 0);
  } else if (scenario === 'cancel-provider') {
    const control = new AbortController();
    const pending = start(control.signal);
    await providerEntered.promise;
    control.abort();
    failure(await pending, 'aborted');
    assert.equal(requests, 1);
    assert.equal(refreshes, 0);
    assert.equal(modifications, 0);
  } else {
    assert.ok(
      [
        'refresh-rejected',
        'refresh-malformed',
        'store-read-failed',
        'store-write-failed',
        'missing-oauth',
        'stored-api-key',
        'provider-rejected',
      ].includes(scenario),
    );
    failure(await start());
    assert.equal(requests, scenario === 'provider-rejected' ? 1 : 0);
    assert.equal(
      refreshes,
      ['refresh-rejected', 'refresh-malformed', 'store-write-failed'].includes(scenario) ? 1 : 0,
    );
  }
  if (!['serialized-refresh', 'cancel-lock-wait', 'cancel-active-refresh'].includes(scenario)) {
    assert.deepEqual(
      await store.read(provider),
      initial,
      'failed auth must not replace credential',
    );
  }
  assert.equal(contractFailures, 0, 'fixture contracts must hold outside SDK error handling');
  assert.equal(
    deliveredFaults,
    [
      'refresh-rejected',
      'refresh-malformed',
      'store-read-failed',
      'store-write-failed',
      'provider-rejected',
    ].includes(scenario)
      ? 1
      : 0,
    'the intended fault must actually reach the SDK',
  );
  assert.equal(unexpectedFetches, 0);
  assert.deepEqual(await readdir(process.cwd()), []);
  console.log(JSON.stringify({ status: 'offline-auth-pass', scenario }));
} catch {
  // Never print assertions, SDK diagnostics, credential values or provider bodies.
  console.error('pi-stream-auth-offline-failed');
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
