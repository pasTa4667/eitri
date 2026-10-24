import { spawnSync } from 'node:child_process';
import { access, readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const probes = [
  { name: 'node', program: process.execPath, args: ['--version'], expected: 'v26.5.0' },
  { name: 'rust', program: 'rustc', args: ['--version'], expected: 'rustc 1.97.1' },
  { name: 'xcode', program: '/usr/bin/xcodebuild', args: ['-version'], expected: 'Xcode 27.1' },
  { name: 'onepassword-cli', program: 'op', args: ['--version'], expected: '2.30.3' },
  {
    name: 'orbstack',
    program: 'docker',
    args: [
      '--context',
      'orbstack',
      'info',
      '--format',
      '{{json .Architecture}} {{json .NCPU}} {{json .MemTotal}}',
    ],
    expected: '"aarch64"',
  },
];
const checks = [];
for (const probe of probes) {
  const result = spawnSync(probe.program, probe.args, {
    env: { ...process.env, DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer' },
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 16_384,
  });
  checks.push({
    name: probe.name,
    status:
      result.status === 0 && result.stdout.startsWith(probe.expected)
        ? 'observed'
        : 'needs-attention',
    output: result.stdout?.trim() ?? '',
    error: result.error?.code ?? (result.status === 0 ? undefined : result.stderr?.trim()),
  });
}

const fixture = new URL('../eitri-test-web-app/', root);
const fixtureGit = spawnSync('git', ['status', '--short', '--branch'], {
  cwd: fileURLToPath(fixture),
  encoding: 'utf8',
  timeout: 10_000,
  maxBuffer: 16_384,
});
checks.push({
  name: 'fixture-git',
  status: fixtureGit.status === 0 ? 'observed' : 'needs-attention',
  output: fixtureGit.stdout?.trim() ?? '',
});
try {
  await access(new URL('.env', fixture));
  checks.push({
    name: 'fixture-environment-file',
    status: 'present-unread',
    output: 'Not inspected. Preserve this file and do not commit it.',
  });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  checks.push({
    name: 'fixture-environment-file',
    status: 'absent',
    output: 'No local .env found.',
  });
}
for (const name of ['pi-durable', 'pi-ai', 'chord']) {
  const metadata = JSON.parse(
    await readFile(new URL(`node_modules/@earendil-works/${name}/package.json`, root), 'utf8'),
  );
  checks.push({
    name,
    status: metadata.version === '1.3.0' ? 'observed' : 'needs-attention',
    output: metadata.version,
  });
}
const manualGates = [
  'Explicit company-account selection and vault permissions approval before vault or item creation.',
  'GitHub repository-restricted token and hosted Sentry API token stored directly in 1Password.',
  'Verify hosted Sentry project/event access, synthetic grouping and review/assignment behavior before enabling intake or updates.',
  'GitHub privacy and baseline branch confirmation before the first push.',
  'Supported OpenAI sign-in and approval of the first real tool-using inference.',
  'Explicit live-remediation enablement after readiness checks.',
];
const report = {
  checkedAt: new Date().toISOString(),
  scope: 'Read-only prerequisites. Does not read secrets or authenticate provider accounts.',
  checks,
  sentry: { hosting: 'hosted', verification: 'not-checked' },
  manualGates,
};
const destination = new URL('docs/evidence/prerequisites.json', root);
await mkdir(new URL('./', destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
for (const check of checks) console.log(`${check.name}: ${check.status}`);
console.log('hosted-sentry: not-checked (manual verification required).');
console.log(`Evidence saved to ${fileURLToPath(destination)}.`);
if (checks.some((check) => check.status === 'needs-attention')) process.exitCode = 1;
