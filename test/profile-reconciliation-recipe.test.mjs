import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { profileNameDefinition } from '../src/profile-name-definition.ts';
import { digest } from '../src/domain.ts';

const recipe = new URL('../scripts/profile-reconciliation/', import.meta.url);

test('profile reconciliation inventory binds exactly the approved env-free inputs and four edits', async () => {
  const inventory = JSON.parse(await readFile(new URL('inputs.json', recipe), 'utf8'));
  assert.deepEqual(
    inventory.map((item) => item.path),
    [
      'package.json',
      'package-lock.json',
      'index.html',
      'vite.config.js',
      'playwright.config.js',
      'src/main.jsx',
      'src/instrument.js',
      'src/App.jsx',
      'src/App.test.jsx',
      'src/setupTests.js',
      'src/lib/errors.js',
      'src/lib/errors.test.js',
      'src/pages/RenderErrorPage.jsx',
      'src/pages/ClickErrorPage.jsx',
      'src/pages/AsyncErrorPage.jsx',
      'e2e/errors.spec.js',
    ],
  );
  const changed = inventory
    .filter((item) => item.before.sha256 !== item.baseline.sha256)
    .map((item) => item.path)
    .sort();
  assert.deepEqual(changed, [
    'e2e/errors.spec.js',
    'src/App.test.jsx',
    'src/lib/errors.js',
    'src/lib/errors.test.js',
  ]);
  const patch = await readFile(new URL('fixture.patch', recipe));
  const parsed = spawnSync('git', ['apply', '--numstat', '-'], { input: patch, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.deepEqual(
    parsed.stdout
      .trim()
      .split('\n')
      .map((line) => line.split('\t')[2])
      .sort(),
    changed,
  );
  for (const item of inventory) {
    for (const version of [item.before, item.baseline]) {
      assert.ok(Number.isSafeInteger(version.size) && version.size > 0);
      assert.match(version.sha256, /^[0-9a-f]{64}$/);
    }
  }
});

test('profile reconciliation baseline identity agrees with the protected capture descriptor', async () => {
  const inventory = JSON.parse(await readFile(new URL('inputs.json', recipe), 'utf8'));
  const helper = inventory.find((item) => item.path === 'src/lib/errors.js').baseline;
  const { captureDigest, ...descriptor } = profileNameDefinition.reviewedCapture;
  assert.deepEqual(helper, { size: descriptor.source.size, sha256: descriptor.source.sha256 });
  assert.equal(digest(descriptor), captureDigest);
  assert.notEqual(helper.size, 535, 'Admission wrong-size adversary must remain different');
});
