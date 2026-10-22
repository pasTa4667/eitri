import { execFile, type ExecFileOptionsWithStringEncoding } from 'node:child_process';
import { promisify } from 'node:util';

export const sentryTarget = Object.freeze({
  organization: 'pasta-re',
  projectId: '4512275993002064',
  tokenReference: 'op://Eitri/Sentry/password',
});

const execute = promisify(execFile);

export async function loadSentryToken(
  account: string,
  run: (
    file: string,
    args: string[],
    options: ExecFileOptionsWithStringEncoding,
  ) => Promise<{ stdout: string; stderr: string }> = execute,
): Promise<string> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(account))
    throw new Error('Select an explicit 1Password account UUID or sign-in hostname.');
  const env: NodeJS.ProcessEnv = {};
  for (const name of ['HOME', 'PATH', 'USER', 'TMPDIR']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  let token: string;
  try {
    const { stdout } = await run(
      '/opt/homebrew/bin/op',
      ['read', sentryTarget.tokenReference, '--account', account, '--no-newline'],
      { env, timeout: 60_000, maxBuffer: 16_384, encoding: 'utf8' },
    );
    token = String(stdout);
  } catch {
    throw new Error('1Password read failed. Check desktop approval, account, vault and item.');
  }
  if (!token || token.length > 8192 || /\s|[^\x21-\x7e]/.test(token))
    throw new Error('The Sentry password field is not a valid API token.');
  return token;
}

export async function checkSentry(token: string, request: typeof fetch = fetch) {
  const url = new URL(`https://sentry.io/api/0/organizations/${sentryTarget.organization}/issues/`);
  url.search = new URLSearchParams({
    project: sentryTarget.projectId,
    query: '',
    limit: '1',
    statsPeriod: '14d',
  }).toString();
  let response: Response;
  try {
    response = await request(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('Sentry connection failed (network, timeout or redirect).');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Sentry connection rejected (HTTP ${response.status}).`);
  }
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    if (!response.body) throw new Error();
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 1_048_576) throw new Error();
      chunks.push(chunk);
    }
    const issues: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (
      !Array.isArray(issues) ||
      issues.length > 1 ||
      issues.some(
        (issue) =>
          !issue || typeof issue !== 'object' || issue.project?.id !== sentryTarget.projectId,
      )
    )
      throw new Error();
    return {
      connected: true,
      organization: sentryTarget.organization,
      projectId: sentryTarget.projectId,
      sampledIssues: issues.length,
      liveRemediation: false,
    };
  } catch {
    throw new Error('Sentry returned an invalid, oversized or out-of-project response.');
  }
}
