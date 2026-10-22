import childProcess from 'node:child_process';
import { writeSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';

const scenario = new URL(import.meta.url).searchParams.get('scenario');
const scenarios = [
  'available',
  'empty',
  'loader-rejection',
  'empty-token',
  'invalid-token',
  'oversized-token',
  'issue-auth',
  'issue-network',
  'invalid-json',
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
  if (
    ++requests !== 1 ||
    url !==
      'https://sentry.io/api/0/organizations/pasta-re/issues/?project=4512275993002064&query=&statsPeriod=14d&limit=25&sort=date'
  )
    throw new Error('Unexpected offline Sentry request.');
  if (scenario === 'issue-network') throw new Error(`${exception} ${token} ${telemetry}`);
  const body =
    scenario === 'empty'
      ? []
      : [
          {
            id: '42',
            project: { id: '4512275993002064' },
            priority: 'high',
            status: 'unresolved',
            title: telemetry,
          },
        ];
  const response = new Response(scenario === 'invalid-json' ? telemetry : JSON.stringify(body), {
    status: scenario === 'issue-auth' ? 401 : 200,
    headers: { 'Content-Type': 'application/json', Link: '<https://private.invalid/>; rel="next"' },
  });
  Object.defineProperty(response, 'url', { value: url });
  return response;
};
