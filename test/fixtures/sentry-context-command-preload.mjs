import childProcess from 'node:child_process';
import { writeSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';

const scenario = new URL(import.meta.url).searchParams.get('scenario');
if (!['available', 'unavailable', 'malformed'].includes(scenario))
  throw new Error('Unknown offline Sentry context scenario.');

const record = (value) => writeSync(3, `${JSON.stringify(value)}\n`);
const token = 'private-context-token';
function execFile() {
  throw new Error('Unexpected subprocess call.');
}
execFile[promisify.custom] = async (file, args, options) => {
  record({ kind: 'execFile', file, args, options });
  if (
    file !== '/opt/homebrew/bin/op' ||
    args.join('\0') !== 'read\0op://Eitri/Sentry/password\0--account\0company\0--no-newline'
  )
    throw new Error('Unexpected credential request.');
  return { stdout: token, stderr: 'private-loader-detail' };
};
childProcess.execFile = execFile;
syncBuiltinESMExports();

let count = 0;
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
  const root = 'https://sentry.io/api/0/organizations/pasta-re/issues/42/';
  if (url !== root && url !== `${root}events/latest/`) throw new Error('Unexpected request URL.');
  count++;
  if (count > 2) throw new Error('Unexpected extra request.');
  const latest = url.endsWith('events/latest/');
  if (latest && scenario === 'unavailable') {
    const missing = new Response(null, { status: 404 });
    Object.defineProperty(missing, 'url', { value: url });
    return missing;
  }
  const body = latest
    ? {
        groupID: '42',
        projectID: '4512275993002064',
        eventID: 'ABCDEF0123456789ABCDEF0123456789',
        dateCreated: '2026-06-01T10:34:56Z',
        entries: [],
        tags:
          scenario === 'malformed'
            ? [{ key: 'environment', value: 'private\n' }]
            : [{ key: 'environment', value: 'production' }],
        release: { version: 'release-1+build@prod', repository: 'private-repository' },
      }
    : { id: '42', project: { id: '4512275993002064' }, priority: 'high', status: 'unresolved' };
  const response = new Response(JSON.stringify(body), { status: 200 });
  Object.defineProperty(response, 'url', { value: url });
  return response;
};
