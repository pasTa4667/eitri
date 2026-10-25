import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function probe(nodeOptions = []) {
  const result = spawnSync(
    process.execPath,
    [...nodeOptions, 'prototypes/openai-oauth-compatibility.mjs'],
    {
      cwd: new URL('../', import.meta.url),
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 64 * 1024,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  return { result, report: JSON.parse(result.stdout) };
}

test('offline OAuth probe blocks M4 on the pinned SDK registration and identity gaps', () => {
  const { result, report } = probe();
  assert.equal(result.status, 1);
  assert.equal(report.verdict, 'blocked');
  assert.equal(report.scope, 'offline-sdk-characterization');
  assert.equal(report.package.name, '@earendil-works/pi-ai');
  assert.equal(report.package.version, '1.3.0');
  assert.match(report.package.oauthSourceSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(report.observations, {
    actualAppName: true,
    stableHostId: true,
    pkceMatchesExchange: true,
    exchangesIssuedClientId: true,
    reusesIssuedClientIdOnSignIn: false,
    rejectsMalformedIdToken: false,
    retainsIdToken: false,
    rejectsWrongState: true,
    rejectsMissingPlanScope: true,
    refreshUsesIssuedClientId: true,
    refreshPersistsReplacementTokens: true,
  });
  assert.deepEqual(report.blockers, [
    'returning-client-registration',
    'id-token-validation',
    'id-token-retention',
  ]);
  assert.equal(report.transport, 'synthetic-fetch-and-callback-listener');
  assert.equal(report.hostedVerification, 'not-performed');
  for (const forbidden of [
    'synthetic-access',
    'synthetic-refresh',
    'synthetic-invalid-id-token',
    'code_verifier',
    'code_challenge',
    'auth.openai.com/api/accounts/authorize?',
  ]) {
    assert.equal(result.stdout.includes(forbidden), false, forbidden);
  }
});

test('a probe failure is not reported as an observed SDK gap and exposes no diagnostics', () => {
  const { result, report } = probe([
    '--import',
    `data:text/javascript,${encodeURIComponent("Response.json = () => { throw new Error('synthetic-sensitive-diagnostic'); };")}`,
  ]);
  assert.equal(result.status, 2);
  assert.deepEqual(report, { verdict: 'probe-error', hostedVerification: 'not-performed' });
  assert.equal(result.stdout.includes('synthetic-sensitive-diagnostic'), false);
});
