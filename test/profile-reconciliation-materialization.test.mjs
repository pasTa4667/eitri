import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as vm from 'node:vm';
import { reportingMetadata } from '../scripts/profile-reconciliation/scenarios.mjs';

const recipe = new URL('../scripts/profile-reconciliation/', import.meta.url);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const identity = (bytes) => ({ size: bytes.length, sha256: hash(bytes) });

function patchPreimages(patch, files) {
  let path;
  let index;
  for (const line of patch.split('\n')) {
    if (line.startsWith('--- a/')) path = line.slice(6);
    else if (line.startsWith('@@')) {
      index = Number(line.match(/^@@ -(\d+)/)[1]) - 1;
    } else if (
      path &&
      (line.startsWith(' ') || (line.startsWith('-') && !line.startsWith('---')))
    ) {
      const lines = files.get(path) ?? [];
      lines[index++] = line.slice(1);
      files.set(path, lines);
    }
  }
}

async function materialize(root, control) {
  const original = join(root, 'original');
  const output = join(root, 'evidence');
  await fs.mkdir(original);
  const files = new Map();
  patchPreimages(await fs.readFile(new URL('fixture.patch', recipe), 'utf8'), files);
  patchPreimages(await fs.readFile(new URL('scenarios.patch', recipe), 'utf8'), files);
  const inventory = JSON.parse(await fs.readFile(new URL('inputs.json', recipe), 'utf8'));
  for (const item of inventory) {
    const text =
      item.path === 'package-lock.json'
        ? '{"packages":{}}\n'
        : item.path === 'package.json'
          ? '{"type":"module"}\n'
          : files.has(item.path)
            ? `${Array.from(files.get(item.path), (line) => line ?? '').join('\n')}\n`
            : 'synthetic input\n';
    const bytes = Buffer.from(text);
    await fs.mkdir(dirname(join(original, item.path)), { recursive: true });
    await fs.writeFile(join(original, item.path), bytes);
    item.before = identity(bytes);
  }
  const reconciled = join(root, 'expected-reconciled');
  await fs.cp(original, reconciled, { recursive: true });
  const applied = spawnSync('git', ['apply', fileURLToPath(new URL('fixture.patch', recipe))], {
    cwd: reconciled,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: root,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CEILING_DIRECTORIES: root,
    },
  });
  assert.equal(applied.status, 0, applied.stderr);
  for (const item of inventory)
    item.baseline = identity(await fs.readFile(join(reconciled, item.path)));
  let installedInventory;
  const installed = control?.startsWith('installed');
  if (installed) {
    const appliedScenarios = spawnSync(
      'git',
      ['apply', fileURLToPath(new URL('scenarios.patch', recipe))],
      {
        cwd: reconciled,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          HOME: root,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CEILING_DIRECTORIES: root,
        },
      },
    );
    assert.equal(appliedScenarios.status, 0, appliedScenarios.stderr);
    await fs.cp(new URL('overlay/', recipe), reconciled, { recursive: true });
    await fs.writeFile(
      join(reconciled, 'src/scenario-metadata.js'),
      `export default ${JSON.stringify(reportingMetadata())}\n`,
    );
    const paths = (await fs.readdir(reconciled, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(reconciled.length + 1))
      .sort();
    installedInventory = await Promise.all(
      paths.map(async (path) => ({ path, ...identity(await fs.readFile(join(reconciled, path))) })),
    );
    assert.equal(installedInventory.length, 28);
    if (control === 'installed-tampered')
      await fs.appendFile(join(reconciled, 'src/lib/cart.js'), '// changed\n');
    if (control === 'installed-same-size') {
      const path = join(reconciled, 'src/lib/cart.js');
      await fs.writeFile(path, (await fs.readFile(path, 'utf8')).replace('total', 'TOTAL'));
    }
    if (control === 'installed-hardlink')
      await fs.link(join(reconciled, 'src/lib/cart.js'), join(root, 'cart.js'));
    if (control === 'installed-missing') await fs.unlink(join(reconciled, 'src/lib/cart.js'));
    if (control === 'installed-symlink') {
      await fs.rename(join(reconciled, 'src/lib/cart.js'), join(root, 'cart.js'));
      await fs.symlink(join(root, 'cart.js'), join(reconciled, 'src/lib/cart.js'));
    }
    await fs.writeFile(join(reconciled, '.env'), 'DO NOT ACQUIRE\n');
  }
  const runtime = {
    argv: [
      'node',
      'verify.mjs',
      installed ? reconciled : original,
      output,
      ...(installed ? ['--installed'] : []),
    ],
    env: { PATH: process.env.PATH },
  };
  const context = vm.createContext({ process: runtime, console: { log() {} }, Buffer });
  const subject = new vm.SourceTextModule(
    await fs.readFile(new URL('verify.mjs', recipe), 'utf8'),
    {
      context,
      initializeImportMeta(meta) {
        meta.url = new URL('verify.mjs', recipe).href;
      },
    },
  );
  let dockerCalls = 0;
  const linker = async (specifier) => {
    if (specifier === './scenarios.mjs') {
      const module = new vm.SourceTextModule(
        await fs.readFile(new URL('scenarios.mjs', recipe), 'utf8'),
        { context },
      );
      await module.link(linker);
      return module;
    }
    const exports =
      specifier === 'node:fs/promises'
        ? {
            ...fs,
            readFile: async (path, ...args) => {
              if (String(path) === fileURLToPath(new URL('inputs.json', recipe)))
                return JSON.stringify(inventory);
              if (
                installed &&
                String(path) === fileURLToPath(new URL('installed-inputs.json', recipe))
              )
                return JSON.stringify(installedInventory);
              if (installed && String(path).startsWith(`${reconciled}/`))
                assert.ok(
                  installedInventory.some((item) => join(reconciled, item.path) === String(path)),
                  'Only allowlisted installed inputs may be acquired',
                );
              if (String(path) === fileURLToPath(new URL('overlay/src/lib/cart.js', recipe))) {
                if (control === 'missing-overlay') throw new Error('Missing overlay control');
                if (control === 'candidate-preimage')
                  return Buffer.from('export const getCartTotal = () => 42;\n');
              }
              return fs.readFile(path, ...args);
            },
          }
        : specifier === 'node:child_process'
          ? {
              spawnSync: (program, args, options) => {
                if (program === 'git') return spawnSync(program, args, options);
                assert.equal(program, 'docker');
                dockerCalls++;
                return {
                  status: 1,
                  signal: null,
                  stdout: '',
                  stderr: 'No such image (test stops before Docker)',
                };
              },
            }
          : await import(
              specifier.startsWith('.')
                ? new URL(specifier, new URL('verify.mjs', recipe)).href
                : specifier
            );
    return new vm.SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
      },
      { context },
    );
  };
  await subject.link(linker);
  try {
    await subject.evaluate();
  } catch (error) {
    assert.ok(installed);
    assert.equal(dockerCalls, 0);
    return { preflightError: error.message };
  }
  assert.equal(dockerCalls, control && !installed ? 1 : 2);
  assert.equal(runtime.exitCode, 1);
  return JSON.parse(await fs.readFile(join(output, 'report.json'), 'utf8'));
}

if (process.argv[2] === '--materialize') {
  console.log(JSON.stringify(await materialize(process.argv[3], process.argv[4])));
} else {
  test('installed inventory pins the exact previously reviewed 28-file scenario baseline', async () => {
    const installed = JSON.parse(
      await fs.readFile(new URL('installed-inputs.json', recipe), 'utf8'),
    );
    const reviewed = JSON.parse(
      await fs.readFile(
        new URL('../docs/evidence/fixture-scenarios/observations.json', import.meta.url),
        'utf8',
      ),
    );
    assert.deepEqual(installed, reviewed.variants.baseline.files);
    assert.equal(installed.length, 28);
    assert.equal(new Set(installed.map((item) => item.path)).size, 28);
    for (const item of installed) {
      assert.deepEqual(Object.keys(item).sort(), ['path', 'sha256', 'size']);
      if (item.path === 'src/scenario-metadata.js')
        assert.deepEqual(
          identityRecord(item),
          identity(Buffer.from(`export default ${JSON.stringify(reportingMetadata())}\n`)),
        );
      else if (reviewed.assets.some((asset) => asset.path === `overlay/${item.path}`))
        assert.deepEqual(
          identityRecord(item),
          identity(await fs.readFile(new URL(`overlay/${item.path}`, recipe))),
        );
    }
  });
  test('installed recipe rejects unknown modes before acquiring any source', () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('verify.mjs', recipe)),
        '/nonexistent-fixture',
        '/nonexistent-evidence',
        '--instaled',
      ],
      { encoding: 'utf8', timeout: 10000 },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
    assert.doesNotMatch(result.stderr, /ENOENT/);
  });
  test('installed recipe verifies exact scenario bytes without reapplying patches or acquiring ambient files', async () => {
    for (const control of [
      'installed',
      'installed-tampered',
      'installed-same-size',
      'installed-hardlink',
      'installed-missing',
      'installed-symlink',
    ]) {
      const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'fixture-installed-')));
      try {
        const result = spawnSync(
          process.execPath,
          [
            '--experimental-vm-modules',
            fileURLToPath(import.meta.url),
            '--materialize',
            root,
            control,
          ],
          { encoding: 'utf8', timeout: 30000 },
        );
        assert.equal(result.status, 0, result.stderr);
        const report = JSON.parse(result.stdout);
        if (control !== 'installed') {
          assert.match(report.preflightError, /preimage|Symlink route rejected|ENOENT/i);
        } else {
          assert.equal(report.preflightError, undefined);
          assert.equal(report.sourceLayout, 'installed-scenarios-v1');
          assert.equal(report.commands.filter((command) => command.program === 'git').length, 0);
          assert.equal(report.inputs.length, 28);
          assert.match(report.error, /No such image/);
          assert.equal(report.variants.baseline.files.length, 28);
          assert.equal(report.variants['scripted-candidate'].files.length, 31);
          assert.equal(report.variants['cart-scripted-candidate'].files.length, 31);
          assert.deepEqual(report.cleanup.at(-1), { scratchRemoved: true });
        }
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    }
  });
  test('guarded recipe materializes independent candidates, paired regressions and complete asset identities without running fixture programs', async () => {
    const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'fixture-materialization-')));
    try {
      const result = spawnSync(
        process.execPath,
        ['--experimental-vm-modules', fileURLToPath(import.meta.url), '--materialize', root],
        { encoding: 'utf8', timeout: 30000 },
      );
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.verdict, 'blocked');
      assert.match(report.error, /No such image/);
      const variants = report.variants;
      assert.deepEqual(Object.keys(variants), [
        'baseline',
        'baseline-with-regressions',
        'scripted-candidate',
        'cart-baseline-with-regressions',
        'cart-scripted-candidate',
      ]);
      const base = variants.baseline.files;
      for (const [red, candidate, changed] of [
        ['baseline-with-regressions', 'scripted-candidate', 'src/lib/errors.js'],
        ['cart-baseline-with-regressions', 'cart-scripted-candidate', 'src/lib/cart.js'],
      ]) {
        const before = variants[red].files;
        const after = variants[candidate].files;
        assert.deepEqual(
          before.map((file) => file.path),
          after.map((file) => file.path),
        );
        assert.deepEqual(
          before
            .filter((file, index) => file.sha256 !== after[index].sha256)
            .map((file) => file.path),
          [changed],
        );
        assert.deepEqual(variants[candidate].candidateChange, {
          path: changed,
          before: identityRecord(before.find((file) => file.path === changed)),
          after: identityRecord(after.find((file) => file.path === changed)),
        });
        assert.equal(before.length, base.length + 3);
        assert.deepEqual(
          before.filter(
            (file) =>
              file.path.includes('/regression/') ||
              file.path ===
                `e2e/${changed.includes('cart') ? 'cart-total' : 'profile-name'}.spec.js`,
          ),
          after.filter(
            (file) =>
              file.path.includes('/regression/') ||
              file.path ===
                `e2e/${changed.includes('cart') ? 'cart-total' : 'profile-name'}.spec.js`,
          ),
        );
      }
      for (const asset of report.assets.filter((asset) => asset.path !== 'inputs.json')) {
        const bytes = await fs.readFile(new URL(asset.path, recipe));
        assert.deepEqual(identityRecord(asset), identity(bytes));
      }
      for (const path of [
        'scenarios.mjs',
        'unit-witness.mjs',
        'scenarios.patch',
        'overlay/src/lib/cart.js',
        'regressions/cart-total.spec.js',
      ])
        assert.ok(report.assets.some((asset) => asset.path === path));
      assert.equal(base.length, 28);
      const metadata = base.find((file) => file.path === 'src/scenario-metadata.js');
      assert.ok(metadata.size > 0);
      assert.deepEqual(report.cleanup.at(-1), { scratchRemoved: true });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  test('guarded recipe blocks missing overlays and candidate preimage substitution before container creation', async () => {
    for (const control of ['missing-overlay', 'candidate-preimage']) {
      const root = await fs.realpath(
        await fs.mkdtemp(join(tmpdir(), 'fixture-materialization-negative-')),
      );
      try {
        const result = spawnSync(
          process.execPath,
          [
            '--experimental-vm-modules',
            fileURLToPath(import.meta.url),
            '--materialize',
            root,
            control,
          ],
          { encoding: 'utf8', timeout: 30000 },
        );
        assert.equal(result.status, 0, result.stderr);
        const report = JSON.parse(result.stdout);
        assert.equal(report.verdict, 'blocked');
        assert.match(
          report.error,
          control === 'missing-overlay'
            ? /Missing overlay control/
            : /Exact candidate preimage required/,
        );
        assert.equal(report.variants['cart-scripted-candidate'], undefined);
        assert.deepEqual(report.cleanup.at(-1), { scratchRemoved: true });
        if (control === 'candidate-preimage') {
          const recorded = report.assets.find((asset) => asset.path === 'overlay/src/lib/cart.js');
          assert.notEqual(recorded.sha256, hash(await fs.readFile(new URL(recorded.path, recipe))));
        }
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    }
  });
}

function identityRecord({ size, sha256 }) {
  return { size, sha256 };
}
