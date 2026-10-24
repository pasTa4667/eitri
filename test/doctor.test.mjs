import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function doctor(t, failedProbe = '') {
  const directory = await mkdtemp(join(tmpdir(), 'eitri-doctor-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'eitri');
  await mkdir(join(root, 'scripts'), { recursive: true });
  await mkdir(join(directory, 'eitri-test-web-app'));
  await writeFile(
    join(root, 'scripts/doctor.mjs'),
    await readFile(new URL('../scripts/doctor.mjs', import.meta.url)),
  );
  for (const name of ['pi-durable', 'pi-ai', 'chord']) {
    const path = join(root, 'node_modules/@earendil-works', name);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'package.json'), JSON.stringify({ version: '1.3.0' }));
  }
  const preload = join(directory, 'preload.mjs');
  await writeFile(
    preload,
    `import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { writeSync } from 'node:fs';
const versions = {
  [process.execPath]: 'v26.5.0', rustc: 'rustc 1.97.1',
  '/usr/bin/xcodebuild': 'Xcode 27.1', op: '2.30.3',
  docker: '"aarch64" 8 17179869184', git: '## master',
};
childProcess.spawnSync = (program, args) => {
  writeSync(3, JSON.stringify({ program, args }) + '\\n');
  if (!(program in versions)) throw new Error('Unexpected subprocess');
  return { status: 0, stdout: program === ${JSON.stringify(failedProbe)} ? 'wrong-version' : versions[program], stderr: '' };
};
globalThis.fetch = () => { throw new Error('Unexpected network access'); };
syncBuiltinESMExports();
`,
  );
  const result = spawnSync(process.execPath, ['--import', preload, 'scripts/doctor.mjs'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    timeout: 10_000,
  });
  assert.equal(result.signal, null);
  assert.equal(result.error, undefined);
  assert.equal(result.stderr, '');
  const report = JSON.parse(await readFile(join(root, 'docs/evidence/prerequisites.json'), 'utf8'));
  const calls = result.output[3].trim().split('\n').map(JSON.parse);
  return { result, report, calls };
}

test('hosted prerequisites need no installer Bash and do not claim live Sentry verification', async (t) => {
  const { result, report, calls } = await doctor(t);
  assert.equal(result.status, 0);
  assert.deepEqual(report.sentry, { hosting: 'hosted', verification: 'not-checked' });
  assert.deepEqual(
    report.checks.map((check) => check.name),
    [
      'node',
      'rust',
      'xcode',
      'onepassword-cli',
      'orbstack',
      'fixture-git',
      'fixture-environment-file',
      'pi-durable',
      'pi-ai',
      'chord',
    ],
  );
  assert.deepEqual(calls, [
    { program: process.execPath, args: ['--version'] },
    { program: 'rustc', args: ['--version'] },
    { program: '/usr/bin/xcodebuild', args: ['-version'] },
    { program: 'op', args: ['--version'] },
    {
      program: 'docker',
      args: [
        '--context',
        'orbstack',
        'info',
        '--format',
        '{{json .Architecture}} {{json .NCPU}} {{json .MemTotal}}',
      ],
    },
    { program: 'git', args: ['status', '--short', '--branch'] },
  ]);
  assert.ok(result.stdout.includes('hosted-sentry: not-checked (manual verification required).\n'));
  assert.equal(
    report.manualGates.some((gate) => gate.includes('local Sentry')),
    false,
  );
  assert.ok(report.manualGates.some((gate) => gate.includes('hosted Sentry')));
  assert.ok(report.manualGates.some((gate) => gate.includes('live-remediation')));
});

test('hosted selection preserves failure for an incompatible local tool', async (t) => {
  const { result, report } = await doctor(t, 'rustc');
  assert.equal(result.status, 1);
  assert.equal(report.checks.find((check) => check.name === 'rust').status, 'needs-attention');
});
