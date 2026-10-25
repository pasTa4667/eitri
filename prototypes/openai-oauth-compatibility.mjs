import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';

// Disposable offline experiment only. Never install these transport replacements in the controller.
const originalFetch = globalThis.fetch;
const originalCreateServer = http.createServer;
const packageRoot = new URL('../node_modules/@earendil-works/pi-ai/', import.meta.url);
const hostId = '00000000-0000-4000-8000-000000000001';
const planScope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const token = (suffix = '') => ({
  access_token: `synthetic-access${suffix}`,
  refresh_token: `synthetic-refresh${suffix}`,
  id_token: 'synthetic-invalid-id-token',
  expires_in: 3600,
  scope: planScope,
});

async function probe() {
  const metadata = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
  assert.equal(metadata.version, '1.3.0');
  const hash = async (path) =>
    createHash('sha256')
      .update(await readFile(new URL(path, packageRoot)))
      .digest('hex');
  const sourceIdentity = {
    name: metadata.name,
    version: metadata.version,
    oauthSourceSha256: await hash('dist/auth/oauth/openai-chatgpt.js'),
    modelsSourceSha256: await hash('dist/models.js'),
  };
  let listeners = 0;
  let closedListeners = 0;
  http.createServer = () => {
    listeners++;
    const server = new EventEmitter();
    server.listen = (_port, _host, callback) => callback();
    server.close = () => closedListeners++;
    server.closeAllConnections = () => {};
    return server;
  };
  syncBuiltinESMExports();
  const exchanges = [];
  let responseToken = token();
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://auth.openai.com/api/accounts/oauth/token');
    assert.equal(options.method, 'POST');
    assert.ok(options.body instanceof URLSearchParams);
    exchanges.push(new URLSearchParams(options.body));
    return Response.json(responseToken);
  };

  const { createModels, InMemoryCredentialStore } = await import('@earendil-works/pi-ai');
  const { openaiProvider } = await import('@earendil-works/pi-ai/providers/openai');
  const credentials = new InMemoryCredentialStore();
  const models = createModels({
    credentials,
    authContext: { env: async () => undefined, fileExists: async () => false },
  });
  models.setProvider(openaiProvider());
  const authorizeUrls = [];
  async function login(wrongState = false) {
    let authorization;
    return models.login(
      'openai',
      'oauth',
      {
        signal: AbortSignal.timeout(5_000),
        notify(event) {
          if (event.type !== 'auth_url') return;
          authorization = new URL(event.url);
          assert.equal(authorization.origin, 'https://auth.openai.com');
          authorizeUrls.push(authorization);
        },
        async prompt() {
          const callback = new URL(authorization.searchParams.get('redirect_uri'));
          callback.search = new URLSearchParams({
            code: 'synthetic-code',
            state: wrongState ? 'wrong-state' : authorization.searchParams.get('state'),
            client_id: 'oaiapp_synthetic',
          }).toString();
          return callback.toString();
        },
      },
      { agentName: 'Eitri', getDeviceId: () => hostId },
    );
  }

  const first = await login();
  const firstExchange = exchanges[0];
  const second = await login();
  const secondExchange = exchanges[1];
  const beforeWrongState = exchanges.length;
  await assert.rejects(login(true), /OAuth state mismatch/);
  assert.equal(exchanges.length, beforeWrongState);
  responseToken = { ...token(), scope: 'openid profile email' };
  await assert.rejects(login(), /OAuth grant did not include chatgpt.tokens.use.direct/);
  assert.deepEqual(await credentials.read('openai'), second);

  await credentials.modify('openai', async () => ({ ...second, expires: 0 }));
  responseToken = token('-refreshed');
  await models.getAuth('openai');
  const refreshed = await credentials.read('openai');
  const refreshExchange = exchanges.at(-1);
  assert.equal(refreshExchange.get('grant_type'), 'refresh_token');
  assert.equal(listeners, closedListeners);

  const observations = {
    actualAppName: authorizeUrls.every(
      (url) => url.searchParams.get('agent_name_hint') === 'Eitri',
    ),
    stableHostId: authorizeUrls.every(
      (url) => url.searchParams.get('ext_agent_host_id') === `urn:uuid:${hostId}`,
    ),
    pkceMatchesExchange: [firstExchange, secondExchange].every(
      (exchange, index) =>
        authorizeUrls[index].searchParams.get('code_challenge_method') === 'S256' &&
        createHash('sha256').update(exchange.get('code_verifier')).digest('base64url') ===
          authorizeUrls[index].searchParams.get('code_challenge'),
    ),
    exchangesIssuedClientId: firstExchange.get('client_id') === 'oaiapp_synthetic',
    reusesIssuedClientIdOnSignIn: authorizeUrls[1].searchParams.get('client_id') === first.clientId,
    rejectsMalformedIdToken: false,
    retainsIdToken: Object.values(first).includes(token().id_token),
    rejectsWrongState: true,
    rejectsMissingPlanScope: true,
    refreshUsesIssuedClientId: refreshExchange.get('client_id') === second.clientId,
    refreshPersistsReplacementTokens:
      refreshed.access === responseToken.access_token &&
      refreshed.refresh === responseToken.refresh_token &&
      refreshed.expires > Date.now() &&
      refreshed.clientId === second.clientId,
  };
  // A successful exchange above accepted a deliberately malformed ID token. These are gap
  // reproductions, not a complete OAuth certification; even all-green observations need review.
  const blockers = [
    ['returning-client-registration', observations.reusesIssuedClientIdOnSignIn],
    ['id-token-validation', observations.rejectsMalformedIdToken],
    ['id-token-retention', observations.retainsIdToken],
  ]
    .filter(([, satisfied]) => !satisfied)
    .map(([name]) => name);
  return {
    scope: 'offline-sdk-characterization',
    verdict: blockers.length ? 'blocked' : 'review-required',
    package: sourceIdentity,
    transport: 'synthetic-fetch-and-callback-listener',
    hostedVerification: 'not-performed',
    observations,
    blockers,
  };
}

try {
  const report = await probe();
  console.log(JSON.stringify(report));
  process.exitCode = 1;
} catch {
  console.log(JSON.stringify({ verdict: 'probe-error', hostedVerification: 'not-performed' }));
  process.exitCode = 2;
} finally {
  globalThis.fetch = originalFetch;
  http.createServer = originalCreateServer;
  syncBuiltinESMExports();
}
