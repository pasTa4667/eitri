import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as vm from 'node:vm';

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
  const runtime = {
    argv: ['node', 'verify.mjs', original, output],
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
  await subject.evaluate();
  assert.equal(dockerCalls, control ? 1 : 2);
  assert.equal(runtime.exitCode, 1);
  return JSON.parse(await fs.readFile(join(output, 'report.json'), 'utf8'));
}

if (process.argv[2] === '--materialize') {
  console.log(JSON.stringify(await materialize(process.argv[3], process.argv[4])));
} else {
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
