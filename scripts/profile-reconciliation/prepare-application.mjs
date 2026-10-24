import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { captureFixtureApplicationInput } from '../../src/fixture-profile-name.ts';
import { applicationVariant } from './application.mjs';

assert.equal(
  process.argv.length,
  4,
  'Usage: node scripts/profile-reconciliation/prepare-application.mjs CANONICAL_FIXTURE NEW_BUILD_DIRECTORY',
);
const [source, output] = process.argv.slice(2);
assert.ok(isAbsolute(output));
assert.equal(await realpath(dirname(output)), dirname(output));
assert.ok(
  output !== source && !output.startsWith(`${source}/`) && !source.startsWith(`${output}/`),
);
const capture = await captureFixtureApplicationInput(source);
assert.equal(
  applicationVariant(
    'fixture-profile-v1',
    capture.files.map(({ virtualPath: path, size, sha256 }) => ({ path, size, sha256 })),
  ),
  'baseline-with-regressions',
);
const base = 'sha256:57911b2d47725e1d19e25203b82d7c90a3160da1815f78a9c66b42a89dd1ddff';
const tag = 'eitri-application-dependencies:v1';
const docker = (args) =>
  execFileSync('docker', ['--context', 'orbstack', ...args], {
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 4 * 1024 ** 2,
  });
const inspect = (name) => JSON.parse(docker(['image', 'inspect', name]))[0];
const before = inspect('eitri-chromium-probe:1.64.1-node26.5.0');
assert.equal(before.Id, base);
assert.equal(before.Architecture, 'arm64');
assert.equal(before.Os, 'linux');
assert.ok(!before.Config.OnBuild?.length);
// Never replace an established preparation image implicitly.
assert.equal(docker(['image', 'ls', '-q', '--filter', `reference=${tag}`]).trim(), '');
await mkdir(output, { mode: 0o700 });
for (const path of ['package.json', 'package-lock.json']) {
  const input = capture.files.find((file) => file.virtualPath === path);
  await writeFile(join(output, path), input.bytes, { flag: 'wx', mode: 0o600 });
}
const lock = JSON.parse(
  capture.files.find((file) => file.virtualPath === 'package-lock.json').bytes,
);
for (const entry of Object.values(lock.packages))
  if (entry.resolved) {
    assert.ok(entry.resolved.startsWith('https://registry.npmjs.org/'));
    assert.match(entry.integrity, /^sha512-/);
  }
await writeFile(
  join(output, 'Dockerfile'),
  `FROM eitri-chromium-probe:1.64.1-node26.5.0\nUSER 1001:1001\nWORKDIR /home/pwuser\nCOPY --chown=1001:1001 package.json package-lock.json ./\nRUN npm ci --ignore-scripts --no-audit --no-fund --cache=/tmp/npm-cache && rm -rf /tmp/npm-cache\n`,
  { flag: 'wx', mode: 0o600 },
);
const log = docker([
  'build',
  '--pull=false',
  '--platform=linux/arm64',
  '--label',
  'eitri.application.dependencies=v1',
  '--tag',
  tag,
  output,
]);
await writeFile(join(output, 'build.log'), log, { flag: 'wx', mode: 0o600 });
const image = inspect(tag);
assert.deepEqual(inspect('eitri-chromium-probe:1.64.1-node26.5.0'), before);
assert.deepEqual(image.RootFS.Layers.slice(0, before.RootFS.Layers.length), before.RootFS.Layers);
assert.equal(image.Architecture, 'arm64');
assert.equal(image.Os, 'linux');
const identity = { tag, id: image.Id };
await writeFile(join(output, 'identity.json'), JSON.stringify(identity, null, 2) + '\n', {
  flag: 'wx',
  mode: 0o600,
});
console.log(JSON.stringify(identity));
