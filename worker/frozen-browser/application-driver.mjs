import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { applicationVariant, admitApplicationResult } from '/opt/verify/application.mjs';

export async function runApplication(scenarioId, manifest) {
  const variant = applicationVariant(scenarioId, manifest);
  const result = spawnSync(
    '/usr/bin/python3',
    ['-I', '/opt/verify/application-supervisor.py', variant],
    {
      cwd: '/opt/verify',
      env: {
        PATH: '/usr/local/bin:/usr/bin:/bin',
        HOME: '/tmp',
        PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright',
        EITRI_FROZEN_APPLICATION: '1',
      },
      encoding: 'utf8',
      timeout: 55000,
      maxBuffer: 192 * 1024,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout.slice(0, 8192) + result.stderr.slice(0, 8192));
  const application = JSON.parse(result.stdout);
  admitApplicationResult(scenarioId, manifest, application);
  const stat = await lstat('/tmp/application.png');
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  assert.ok(stat.size > 0 && stat.size <= 4 * 1024 ** 2);
  const png = await readFile('/tmp/application.png');
  assert.equal(png.length, stat.size);
  return { application, png };
}
