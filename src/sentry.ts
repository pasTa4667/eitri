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

export type SentryObservation = Readonly<{
  source: Readonly<{
    provider: 'sentry';
    organization: 'pasta-re';
    projectId: '4512275993002064';
    issueId: string;
  }>;
  classification: Readonly<{
    origin: 'sentry';
    priority: 'high' | 'medium' | 'low' | 'unknown';
    status: 'unresolved' | 'resolved' | 'ignored' | 'unknown';
  }>;
  event:
    | Readonly<{
        kind: 'available';
        eventId: string;
        occurredAt: string;
        evidence: Readonly<{
          reportedExceptionCount: number;
          reportedStackFrameCount: number;
        }>;
      }>
    | Readonly<{
        kind: 'unavailable';
        reason: 'latest-event-not-found';
      }>;
}>;

function sentryObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
}

function sentryIdentity(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value);
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value)) throw new Error();
  return value;
}

function sentryClassification(value: unknown): string {
  if (value === undefined || value === null) return 'unknown';
  if (typeof value !== 'string' || value.length > 64) throw new Error();
  return value;
}

function parseSentryIssue(value: unknown, issueId: string): SentryObservation['classification'] {
  const issue = sentryObject(value);
  if (
    sentryIdentity(issue.id) !== issueId ||
    sentryIdentity(sentryObject(issue.project).id) !== sentryTarget.projectId
  )
    throw new Error();
  const priority = sentryClassification(issue.priority);
  const status = sentryClassification(issue.status);
  return {
    origin: 'sentry',
    priority:
      priority === 'high' || priority === 'medium' || priority === 'low' ? priority : 'unknown',
    status:
      status === 'unresolved' || status === 'resolved' || status === 'ignored' ? status : 'unknown',
  };
}

function sentryTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 35) throw new Error();
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!parts) throw new Error();
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = parts;
  const leap = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    Number(month) < 1 ||
    Number(month) > 12 ||
    Number(day) < 1 ||
    Number(day) > days[Number(month) - 1] ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    Number(offsetHour ?? 0) > 23 ||
    Number(offsetMinute ?? 0) > 59
  )
    throw new Error();
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) throw new Error();
  return timestamp.toISOString();
}

function parseSentryEvent(
  value: unknown,
  issueId: string,
): Extract<SentryObservation['event'], { kind: 'available' }> {
  const event = sentryObject(value);
  if (
    sentryIdentity(event.groupID) !== issueId ||
    sentryIdentity(event.projectID) !== sentryTarget.projectId ||
    typeof event.eventID !== 'string' ||
    !/^[a-fA-F0-9]{32}$/.test(event.eventID)
  )
    throw new Error();
  const occurredAt = sentryTimestamp(event.dateCreated);
  if (!Array.isArray(event.entries) || event.entries.length > 32) throw new Error();
  let reportedExceptionCount = 0;
  let reportedStackFrameCount = 0;
  for (const value of event.entries) {
    const entry = sentryObject(value);
    if (typeof entry.type !== 'string' || entry.type.length > 64) throw new Error();
    if (entry.type !== 'exception') continue;
    const values = sentryObject(entry.data).values;
    if (!Array.isArray(values)) throw new Error();
    reportedExceptionCount += values.length;
    if (reportedExceptionCount > 8) throw new Error();
    for (const value of values) {
      const exception = sentryObject(value);
      if (exception.stacktrace === undefined || exception.stacktrace === null) continue;
      const frames = sentryObject(exception.stacktrace).frames;
      if (!Array.isArray(frames) || frames.length > 128) throw new Error();
      reportedStackFrameCount += frames.length;
      if (reportedStackFrameCount > 1024) throw new Error();
      for (const frame of frames) sentryObject(frame);
    }
  }
  return {
    kind: 'available',
    eventId: event.eventID.toLowerCase(),
    occurredAt,
    evidence: { reportedExceptionCount, reportedStackFrameCount },
  };
}

function cancelSentryBody(body: ReadableStream<Uint8Array> | null): void {
  try {
    void body?.cancel().catch(() => {});
  } catch {}
}

async function withSentryRead<T>(
  token: string,
  signal: AbortSignal | undefined,
  read: (scope: {
    readJson(url: string, latest: boolean): Promise<unknown>;
    checkLifetime(): void;
  }) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const deadline = Date.now() + 15_000;
  let finished = false;
  const stopped = Promise.withResolvers<never>();
  const stop = () => {
    controller.abort();
    stopped.reject(new Error());
  };
  void stopped.promise.catch(() => {});
  const timer = setTimeout(stop, 15_000);
  function checkLifetime(): void {
    if (Date.now() >= deadline) stop();
    if (controller.signal.aborted) throw new Error();
  }

  async function readJson(url: string, latest: boolean): Promise<unknown> {
    checkLifetime();
    const pending = fetch(new URL(url), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      redirect: 'error',
      credentials: 'omit',
      signal: controller.signal,
    }).then((response) => {
      if (finished || controller.signal.aborted) {
        cancelSentryBody(response.body);
        throw new Error();
      }
      return response;
    });
    const response = await Promise.race([pending, stopped.promise]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let consumed = false;
    try {
      checkLifetime();
      if (response.redirected || response.url !== url) throw new Error();
      if (latest && response.status === 404) return undefined;
      if (response.status !== 200 || !response.body) throw new Error();
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        checkLifetime();
        const chunk = await Promise.race([reader.read(), stopped.promise]);
        checkLifetime();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 1_048_576) throw new Error();
        chunks.push(chunk.value);
      }
      consumed = true;
      const value: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
      );
      checkLifetime();
      return value;
    } finally {
      if (reader) {
        if (!consumed) {
          try {
            void reader.cancel().catch(() => {});
          } catch {}
        }
        reader.releaseLock();
      } else {
        cancelSentryBody(response.body);
      }
    }
  }

  try {
    signal?.addEventListener('abort', stop, { once: true });
    checkLifetime();
    return await read({ readJson, checkLifetime });
  } catch {
    controller.abort();
    throw new Error();
  } finally {
    finished = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

export async function observeSentryIssue(
  token: string,
  issueId: string,
  options?: Readonly<{ signal?: AbortSignal }>,
): Promise<SentryObservation> {
  try {
    if (
      typeof token !== 'string' ||
      !token ||
      token.length > 8192 ||
      /\s|[^\x21-\x7e]/.test(token) ||
      typeof issueId !== 'string' ||
      !/^[1-9][0-9]{0,19}$/.test(issueId) ||
      options?.signal?.aborted
    )
      throw new Error();

    return await withSentryRead(token, options?.signal, async ({ readJson, checkLifetime }) => {
      const url = `https://sentry.io/api/0/organizations/${sentryTarget.organization}/issues/${issueId}/`;
      const classification = parseSentryIssue(await readJson(url, false), issueId);
      checkLifetime();
      const value = await readJson(`${url}events/latest/`, true);
      const event: SentryObservation['event'] =
        value === undefined
          ? { kind: 'unavailable', reason: 'latest-event-not-found' }
          : parseSentryEvent(value, issueId);
      const observation: SentryObservation = {
        source: {
          provider: 'sentry',
          organization: sentryTarget.organization,
          projectId: sentryTarget.projectId,
          issueId,
        },
        classification,
        event,
      };
      if (Buffer.byteLength(JSON.stringify(observation), 'utf8') > 2048) throw new Error();
      checkLifetime();
      return observation;
    });
  } catch {
    throw new Error('Sentry observation failed.');
  }
}

const sentryDiscoveryScope = Object.freeze({
  coverage: 'single-page-only',
  statsPeriod: '14d',
  query: '',
  sort: 'date',
  maxResults: 25,
} as const);

export type SentryIssuePage = Readonly<{
  source: Omit<SentryObservation['source'], 'issueId'>;
  scope: typeof sentryDiscoveryScope;
  items: readonly Readonly<{
    issueId: string;
    classification: SentryObservation['classification'];
  }>[];
}>;

function discoveryIdentity(value: unknown): string {
  const id = sentryIdentity(value);
  if (!/^[1-9][0-9]{0,19}(?![\s\S])/.test(id)) throw new Error();
  return id;
}

function parseSentryIssuePage(value: unknown): SentryIssuePage {
  if (!Array.isArray(value) || value.length > sentryDiscoveryScope.maxResults) throw new Error();
  const ids = new Set<string>();
  const items = value.map((value) => {
    const issue = sentryObject(value);
    const issueId = discoveryIdentity(issue.id);
    if (
      ids.has(issueId) ||
      discoveryIdentity(sentryObject(issue.project).id) !== sentryTarget.projectId
    )
      throw new Error();
    ids.add(issueId);
    return { issueId, classification: parseSentryIssue(issue, issueId) };
  });
  return {
    source: {
      provider: 'sentry',
      organization: sentryTarget.organization,
      projectId: sentryTarget.projectId,
    },
    scope: sentryDiscoveryScope,
    items,
  };
}

export async function listSentryIssues(
  token: string,
  options?: Readonly<{ signal?: AbortSignal }>,
): Promise<SentryIssuePage> {
  try {
    if (
      typeof token !== 'string' ||
      !token ||
      token.length > 8192 ||
      /\s|[^\x21-\x7e]/.test(token) ||
      options?.signal?.aborted
    )
      throw new Error();
    return await withSentryRead(token, options?.signal, async ({ readJson, checkLifetime }) => {
      const url = new URL(
        `https://sentry.io/api/0/organizations/${sentryTarget.organization}/issues/`,
      );
      url.search = new URLSearchParams({
        project: sentryTarget.projectId,
        query: sentryDiscoveryScope.query,
        statsPeriod: sentryDiscoveryScope.statsPeriod,
        limit: String(sentryDiscoveryScope.maxResults),
        sort: sentryDiscoveryScope.sort,
      }).toString();
      const page = parseSentryIssuePage(await readJson(url.href, false));
      if (Buffer.byteLength(JSON.stringify(page), 'utf8') > 8192) throw new Error();
      checkLifetime();
      return page;
    });
  } catch {
    throw new Error('Sentry discovery failed.');
  }
}
