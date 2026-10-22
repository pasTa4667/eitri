import childProcess from 'node:child_process';
import { writeSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';

const scenario = new URL(import.meta.url).searchParams.get('scenario');
const scenarios = [
  'available',
  'unavailable',
  'loader-rejection',
  'empty-token',
  'invalid-token',
  'oversized-token',
  'issue-auth',
  'event-auth',
  'issue-network',
  'event-network',
  'invalid-json',
  'malformed-event',
];
if (!scenarios.includes(scenario)) throw new Error('Unknown offline Sentry scenario.');

const token = 'private-token-canary';
const telemetry = 'private-telemetry-canary';
const exception = 'private-exception-canary';
const record = (call) => writeSync(3, `${JSON.stringify(call)}\n`);

function execFile() {
  throw new Error('Unexpected unpromisified subprocess call.');
}
execFile[promisify.custom] = async (file, args, options) => {
  record({ kind: 'execFile', file, args, options });
  if (
    file !== '/opt/homebrew/bin/op' ||
    args.length !== 5 ||
    args[0] !== 'read' ||
    args[1] !== 'op://Eitri/Sentry/password' ||
    args[2] !== '--account' ||
    args[4] !== '--no-newline'
  )
    throw new Error('Unexpected offline credential request.');
  if (scenario === 'loader-rejection') throw new Error(`${exception} ${token} ${telemetry}`);
  const stdout =
    scenario === 'empty-token'
      ? ''
      : scenario === 'invalid-token'
        ? `${token}\n`
        : scenario === 'oversized-token'
          ? 'x'.repeat(8193)
          : token;
  return { stdout, stderr: telemetry };
};
childProcess.execFile = execFile;
syncBuiltinESMExports();

let requests = 0;
globalThis.fetch = async (input, options) => {
  const url = String(input);
  record({
    kind: 'fetch',
    url,
    options: {
      ...options,
      signal: {
        isAbortSignal: options?.signal instanceof AbortSignal,
        aborted: options?.signal?.aborted,
      },
    },
  });
  const match =
    /^https:\/\/sentry\.io\/api\/0\/organizations\/pasta-re\/issues\/([1-9][0-9]{0,19})\/(events\/latest\/)?$/.exec(
      url,
    );
  const latest = Boolean(match?.[2]);
  requests += 1;
  if (!match || requests !== (latest ? 2 : 1))
    throw new Error('Unexpected offline Sentry request.');
  if (scenario === (latest ? 'event-network' : 'issue-network'))
    throw new Error(`${exception} ${token} ${telemetry}`);
  const auth = scenario === (latest ? 'event-auth' : 'issue-auth');
  const unavailable = latest && scenario === 'unavailable';
  const status = auth ? (latest ? 403 : 401) : unavailable ? 404 : 200;
  const body =
    auth || unavailable
      ? { detail: telemetry }
      : latest
        ? {
            groupID: match[1],
            projectID: '4512275993002064',
            eventID: 'ABCDEF0123456789ABCDEF0123456789',
            dateCreated: '2026-06-01T12:34:56+02:00',
            message: telemetry,
            entries: [
              {
                type: 'exception',
                data: {
                  values: [
                    { value: telemetry, stacktrace: { frames: [{ filename: telemetry }, {}] } },
                    { value: telemetry },
                  ],
                },
              },
            ],
            ...(scenario === 'malformed-event' ? { groupID: '999' } : {}),
          }
        : {
            id: match[1],
            project: { id: '4512275993002064' },
            priority: 'high',
            status: 'unresolved',
            title: telemetry,
          };
  const response = new Response(scenario === 'invalid-json' ? telemetry : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
  Object.defineProperty(response, 'url', { value: url });
  return response;
};
