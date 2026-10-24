import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportingMetadata, variants, variantExpectation } from './scenarios.mjs';
import { sha256 } from '../../prototypes/chromium/policy.mjs';
import { readFixturePolicy } from './engine.mjs';

const installed = process.argv.length === 5 && process.argv[4] === '--installed';
assert.ok(
  process.argv.length === 4 || installed,
  'Usage: node scripts/profile-reconciliation/verify.mjs ABSOLUTE_FIXTURE NEW_EVIDENCE_DIRECTORY [--installed]',
);
const source = process.argv[2];
assert.ok(isAbsolute(source));
assert.equal(await realpath(source), source, 'Use a canonical, quiescent operator-owned directory');
const here = dirname(fileURLToPath(import.meta.url));
const runtimeAssets = [
  { path: 'run.mjs', destination: 'verify/run.mjs' },
  { path: 'scenarios.mjs', destination: 'verify/scenarios.mjs' },
  { path: 'unit-witness.mjs', destination: 'verify/unit-witness.mjs' },
  { path: 'playwright.config.mjs', destination: 'verify/playwright.config.mjs' },
  { path: 'built-assets.spec.js', destination: 'verify/built-assets.spec.js' },
];
const overlayPaths = [
  'src/lib/cart.js',
  'src/lib/cart.test.js',
  'src/lib/transient-upstream.js',
  'src/lib/transient-upstream.test.js',
  'src/pages/CartPage.jsx',
  'src/pages/ValidationPage.jsx',
  'src/pages/TransientPage.jsx',
  'src/scenario-reporting.js',
  'src/scenario-reporting.test.js',
  'src/scenarios.test.jsx',
  'e2e/scenarios.spec.js',
];
const regressionAssets = {
  'profile-name': [
    ['profile-name.test.js', 'src/regression/profile-name.test.js'],
    ['profile-name.test.jsx', 'src/regression/profile-name.test.jsx'],
    ['profile-name.spec.js', 'e2e/profile-name.spec.js'],
  ],
  'cart-total': [
    ['cart-total.test.js', 'src/regression/cart-total.test.js'],
    ['cart-total.test.jsx', 'src/regression/cart-total.test.jsx'],
    ['cart-total.spec.js', 'e2e/cart-total.spec.js'],
  ],
};
const inventory = installed
  ? JSON.parse(await readFile(join(here, 'installed-inputs.json'), 'utf8')).map(
      ({ path, size, sha256 }) => ({ path, before: { size, sha256 }, baseline: { size, sha256 } }),
    )
  : JSON.parse(await readFile(join(here, 'inputs.json'), 'utf8'));
assert.equal(inventory.length, installed ? 28 : 16);
assert.equal(new Set(inventory.map((item) => item.path)).size, inventory.length);
const original = new Map();
for (const item of inventory) {
  const path = join(source, item.path);
  let route = path;
  while (route !== parse(route).root) {
    const stat = await lstat(route);
    assert.ok(!stat.isSymbolicLink(), `Symlink route rejected: ${item.path}`);
    if (route === path)
      assert.ok(
        stat.isFile() && stat.nlink === 1 && stat.size === item.before.size,
        `Unsafe or wrong-size preimage: ${item.path}`,
      );
    else assert.ok(stat.isDirectory());
    route = dirname(route);
  }
  const bytes = await readFile(path);
  assert.equal(bytes.length, item.before.size, `Preimage size: ${item.path}`);
  assert.equal(sha256(bytes), item.before.sha256, `Preimage hash: ${item.path}`);
  original.set(item.path, bytes);
}
const output = resolve(process.argv[3]);
assert.equal(
  await realpath(dirname(output)),
  dirname(output),
  'Use a canonical existing output parent',
);
assert.ok(
  output !== source && !output.startsWith(`${source}/`) && !source.startsWith(`${output}/`),
);
await mkdir(output, { mode: 0o700 });
const scratch = join(output, 'scratch');
await mkdir(scratch);
const owner = `eitri-profile-${randomUUID()}`;
const baseId = 'sha256:57911b2d47725e1d19e25203b82d7c90a3160da1815f78a9c66b42a89dd1ddff';
const baseTag = `${owner}-base:local`;
const images = [];
const containers = [];
const report = {
  owner,
  sourceKind: 'operator-approved-uncommitted-copy',
  sourceLayout: installed ? 'installed-scenarios-v1' : 'pre-reconciliation-v1',
  verdict: 'blocked',
  commands: [],
  variants: {},
  cleanup: [],
  buildCache: 'retained-no-global-prune',
};
const command = (program, args, options = {}) => {
  const result = spawnSync(program, args, {
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  report.commands.push({
    program,
    args,
    exit: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  if (result.error) report.commands.at(-1).error = result.error.message;
  return result;
};
const docker = (args) => command('docker', ['--context', 'orbstack', ...args]);
const checked = (args) => {
  const result = docker(args);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null);
  return result.stdout.trim();
};
const inspectImage = (id) => JSON.parse(checked(['image', 'inspect', id]))[0];
const baseIdentity = (image) => ({
  Id: image.Id,
  Os: image.Os,
  Architecture: image.Architecture,
  RootFS: image.RootFS,
  Config: image.Config,
});
const put = async (root, path, bytes) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), bytes, { flag: 'wx', mode: 0o644 });
};
try {
  const context = join(scratch, 'runtime');
  const baseline = join(scratch, 'reconciled');
  for (const [path, bytes] of original) await put(baseline, path, bytes);
  const patch = await readFile(join(here, 'fixture.patch'));
  report.patchSha256 = sha256(patch);
  report.assets = [];
  for (const path of [
    'inputs.json',
    'installed-inputs.json',
    'fixture.patch',
    'scenarios.patch',
    'verify.mjs',
    'engine.mjs',
    'seccomp/docker-29.8.2.json',
    ...overlayPaths.map((path) => `overlay/${path}`),
    ...regressionAssets['cart-total'].map(([asset]) => `regressions/${asset}`),
    ...runtimeAssets.map((asset) => asset.path),
    'regressions/profile-name.test.js',
    'regressions/profile-name.test.jsx',
    'regressions/profile-name.spec.js',
  ]) {
    const bytes = await readFile(join(here, path));
    report.assets.push({ path, size: bytes.length, sha256: sha256(bytes) });
  }
  for (const args of installed
    ? []
    : [
        ['apply', '--check', join(here, 'fixture.patch')],
        ['apply', join(here, 'fixture.patch')],
      ]) {
    const result = command('git', args, {
      cwd: baseline,
      env: {
        PATH: process.env.PATH,
        HOME: scratch,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CEILING_DIRECTORIES: dirname(baseline),
      },
    });
    assert.equal(result.status, 0, result.stderr);
  }
  const extended = new Map();
  report.reconciledFiles = [];
  for (const item of inventory) {
    const bytes = await readFile(join(baseline, item.path));
    assert.equal(bytes.length, item.baseline.size);
    assert.equal(sha256(bytes), item.baseline.sha256);
    report.reconciledFiles.push({ path: item.path, ...item.baseline });
  }
  for (const args of installed
    ? []
    : [
        ['apply', '--check', join(here, 'scenarios.patch')],
        ['apply', join(here, 'scenarios.patch')],
      ]) {
    const result = command('git', args, {
      cwd: baseline,
      env: {
        PATH: process.env.PATH,
        HOME: scratch,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CEILING_DIRECTORIES: dirname(baseline),
      },
    });
    assert.equal(result.status, 0, result.stderr);
  }
  for (const item of inventory) extended.set(item.path, await readFile(join(baseline, item.path)));
  if (!installed) {
    for (const path of overlayPaths) {
      assert.ok(!extended.has(path), `Duplicate overlay destination: ${path}`);
      extended.set(path, await readFile(join(here, 'overlay', path)));
    }
    assert.ok(!extended.has('src/scenario-metadata.js'));
    extended.set(
      'src/scenario-metadata.js',
      Buffer.from(`export default ${JSON.stringify(reportingMetadata())}\n`),
    );
  }
  const candidates = {
    'profile-name': {
      path: 'src/lib/errors.js',
      before: "return user.profile.name?.trim() || 'Anonymous'",
      after: "return user?.profile?.name?.trim() || 'Anonymous'",
    },
    'cart-total': {
      path: 'src/lib/cart.js',
      before: 'return amounts.reduce((total, amount) => total + amount)',
      after: 'return amounts.reduce((total, amount) => total + amount, 0)',
    },
  };
  for (const { id } of variants) {
    const expected = variantExpectation(id);
    const root = join(context, 'inputs', id);
    const sourceFiles = new Map(extended);
    if (expected.target) {
      for (const [asset, path] of regressionAssets[expected.target]) {
        assert.ok(!sourceFiles.has(path), `Duplicate regression destination: ${path}`);
        sourceFiles.set(path, await readFile(join(here, 'regressions', asset)));
      }
    }
    let candidateChange;
    if (expected.revision === 'candidate') {
      const { path, before, after } = candidates[expected.target];
      const bytes = sourceFiles.get(path);
      const text = bytes.toString('utf8');
      assert.equal(text.split(before).length, 2, 'Exact candidate preimage required');
      const changed = Buffer.from(text.replace(before, after));
      sourceFiles.set(path, changed);
      candidateChange = {
        path,
        before: { size: bytes.length, sha256: sha256(bytes) },
        after: { size: changed.length, sha256: sha256(changed) },
      };
    }
    const files = [];
    for (const [path, bytes] of [...sourceFiles].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (path !== candidates[expected.target]?.path || expected.revision !== 'candidate') {
        if (extended.has(path))
          assert.deepEqual(bytes, extended.get(path), `Unaffected file changed: ${path}`);
      }
      await put(root, path, bytes);
      files.push({ path, size: bytes.length, sha256: sha256(bytes) });
    }
    const helper = files.find((file) => file.path === 'src/lib/errors.js');
    if (expected.target !== 'profile-name' || expected.revision !== 'candidate') {
      assert.equal(
        helper.sha256,
        inventory.find((item) => item.path === helper.path).baseline.sha256,
      );
    }
    report.variants[id] = {
      files,
      sha256: sha256(JSON.stringify(files)),
      ...(candidateChange ? { candidateChange } : {}),
    };
  }
  for (const [red, candidate, target] of [
    ['baseline-with-regressions', 'scripted-candidate', 'profile-name'],
    ['cart-baseline-with-regressions', 'cart-scripted-candidate', 'cart-total'],
  ]) {
    for (const [, path] of regressionAssets[target])
      assert.deepEqual(
        report.variants[red].files.find((file) => file.path === path),
        report.variants[candidate].files.find((file) => file.path === path),
        'Identical paired regressions required',
      );
  }
  report.inputs = inventory;
  const preparation = join(scratch, 'dependencies');
  for (const path of ['package.json', 'package-lock.json'])
    await put(preparation, path, original.get(path));
  const lock = JSON.parse(original.get('package-lock.json'));
  for (const entry of Object.values(lock.packages)) {
    if (entry.resolved) {
      assert.ok(
        entry.resolved.startsWith('https://registry.npmjs.org/'),
        'Only the locked npm registry is permitted',
      );
      assert.match(entry.integrity, /^sha512-/);
    }
  }
  await writeFile(
    join(output, 'ownership.json'),
    `${JSON.stringify({ owner, baseTag, images: [`${owner}-dependencies:local`, `${owner}-runtime:local`], containers: Object.keys(report.variants).map((variant) => `${owner}-${variant}`) }, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  const base = inspectImage(baseId);
  assert.equal(base.Id, baseId);
  assert.equal(base.Os, 'linux');
  assert.equal(base.Architecture, 'arm64');
  assert.ok(!base.Config.OnBuild?.length);
  report.base = base;
  const server = JSON.parse(checked(['version', '--format', '{{json .Server}}']));
  const { policy, reviewed } = await readFixturePolicy(server);
  report.server = server;
  report.reviewedEngine = reviewed;
  const security = JSON.parse(checked(['info', '--format', '{{json .SecurityOptions}}']));
  assert.ok(security.includes('name=seccomp,profile=builtin'));
  const policyPath = join(scratch, 'seccomp.json');
  await writeFile(policyPath, policy);
  report.policySha256 = sha256(policy);
  checked(['tag', baseId, baseTag]);
  await put(
    preparation,
    'Dockerfile',
    `FROM ${baseTag}\nUSER 1001:1001\nWORKDIR /home/pwuser\nCOPY --chown=1001:1001 package.json package-lock.json ./\nRUN npm ci --ignore-scripts --no-audit --no-fund --cache=/tmp/npm-cache && rm -rf /tmp/npm-cache\n`,
  );
  const build = (tag, directory, network) => {
    images.push(tag);
    checked([
      'build',
      '--pull=false',
      '--no-cache',
      '--force-rm',
      '--platform',
      'linux/arm64',
      '--network',
      network,
      '--label',
      `eitri.profile.owner=${owner}`,
      '-t',
      tag,
      directory,
    ]);
    const image = inspectImage(tag);
    assert.equal(image.Config.Labels['eitri.profile.owner'], owner);
    assert.deepEqual(image.RootFS.Layers.slice(0, base.RootFS.Layers.length), base.RootFS.Layers);
    assert.deepEqual(baseIdentity(inspectImage(baseId)), baseIdentity(base));
    return image.Id;
  };
  const dependencyTag = `${owner}-dependencies:local`;
  report.dependencyImage = build(dependencyTag, preparation, 'default');
  for (const asset of runtimeAssets)
    await put(context, asset.destination, await readFile(join(here, asset.path)));
  await put(
    context,
    'Dockerfile',
    `FROM ${dependencyTag}\nCOPY inputs /opt/inputs\nCOPY verify /opt/verify\nUSER 1001:1001\nENV HOME=/tmp\nENTRYPOINT ["node", "/opt/verify/run.mjs"]\n`,
  );
  const runtimeTag = `${owner}-runtime:local`;
  const runtimeId = build(runtimeTag, context, 'none');
  report.runtimeImage = runtimeId;
  const dependencyLayers = inspectImage(report.dependencyImage).RootFS.Layers;
  assert.deepEqual(
    inspectImage(runtimeId).RootFS.Layers.slice(0, dependencyLayers.length),
    dependencyLayers,
  );
  for (const variant of Object.keys(report.variants)) {
    const name = `${owner}-${variant}`;
    containers.push(name);
    const id = checked([
      'create',
      '--name',
      name,
      '--label',
      `eitri.profile.owner=${owner}`,
      '--platform',
      'linux/arm64',
      '--user',
      '1001:1001',
      '--read-only',
      '--network',
      'none',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--security-opt',
      `seccomp=${policyPath}`,
      '--cpus',
      '2',
      '--memory',
      '4g',
      '--memory-swap',
      '4g',
      '--pids-limit',
      '256',
      '--ipc',
      'private',
      '--shm-size',
      '256m',
      '--tmpfs',
      '/tmp:rw,exec,nosuid,size=256m,uid=1001,gid=1001',
      '--ulimit',
      'core=0',
      runtimeId,
      variant,
    ]);
    const container = JSON.parse(checked(['inspect', id]))[0];
    const h = container.HostConfig;
    assert.equal(container.Image, runtimeId);
    assert.equal(container.Config.User, '1001:1001');
    assert.equal(container.Config.Labels['eitri.profile.owner'], owner);
    assert.deepEqual(container.Mounts, []);
    assert.equal(h.NetworkMode, 'none');
    assert.equal(h.ReadonlyRootfs, true);
    assert.equal(h.Privileged, false);
    assert.ok(!h.CapAdd?.length);
    assert.deepEqual(h.CapDrop, ['ALL']);
    assert.equal(h.SecurityOpt.length, 2);
    assert.ok(
      h.SecurityOpt.includes('no-new-privileges') ||
        h.SecurityOpt.includes('no-new-privileges=true'),
    );
    assert.deepEqual(
      JSON.parse(h.SecurityOpt.find((value) => value.startsWith('seccomp=')).slice(8)),
      JSON.parse(policy),
    );
    assert.equal(h.Memory, 4 * 1024 ** 3);
    assert.equal(h.MemorySwap, h.Memory);
    assert.equal(h.NanoCpus, 2e9);
    assert.equal(h.PidsLimit, 256);
    assert.equal(h.IpcMode, 'private');
    assert.equal(h.ShmSize, 256 * 1024 ** 2);
    assert.deepEqual(h.Tmpfs, { '/tmp': 'rw,exec,nosuid,size=256m,uid=1001,gid=1001' });
    assert.deepEqual(h.Ulimits, [{ Name: 'core', Hard: 0, Soft: 0 }]);
    report.variants[variant].containment = container;
    const result = docker(['start', '-a', id]);
    const state = JSON.parse(checked(['inspect', id]))[0].State;
    report.variants[variant].state = state;
    report.variants[variant].result = JSON.parse(result.stdout);
    assert.equal(state.OOMKilled, false);
    assert.equal(state.ExitCode, 0);
    assert.equal(result.status, 0);
    assert.equal(report.variants[variant].result.verdict, 'passed');
  }
  assert.deepEqual(baseIdentity(inspectImage(baseId)), baseIdentity(base));
  for (const [path, bytes] of original)
    assert.deepEqual(await readFile(join(source, path)), bytes, `Original changed: ${path}`);
  report.originalUnchanged = true;
  report.verdict = 'passed';
} catch (error) {
  report.error = error.stack;
} finally {
  for (const name of containers.reverse()) {
    const result = docker(['inspect', name]);
    if (result.status !== 0) {
      const absent = /No such (object|container)/i.test(result.stderr ?? '');
      report.cleanup.push({ name, absent });
      if (!absent) report.verdict = 'blocked';
      continue;
    }
    const container = JSON.parse(result.stdout)[0];
    if (container.Config.Labels['eitri.profile.owner'] !== owner) {
      report.cleanup.push({ name, refused: true });
      report.verdict = 'blocked';
      continue;
    }
    const removed = docker(['rm', '-f', container.Id]).status === 0;
    report.cleanup.push({ name, removed });
    if (!removed) report.verdict = 'blocked';
  }
  for (const tag of images.reverse()) {
    const result = docker(['image', 'inspect', tag]);
    if (result.status !== 0) {
      const absent = /No such (object|image)/i.test(result.stderr ?? '');
      report.cleanup.push({ tag, absent });
      if (!absent) report.verdict = 'blocked';
      continue;
    }
    const image = JSON.parse(result.stdout)[0];
    if (image.Config.Labels['eitri.profile.owner'] !== owner) {
      report.cleanup.push({ tag, refused: true });
      report.verdict = 'blocked';
      continue;
    }
    const removed = docker(['image', 'rm', tag]).status === 0;
    report.cleanup.push({ tag, removed });
    if (!removed) report.verdict = 'blocked';
  }
  const tagged = docker(['image', 'inspect', baseTag]);
  if (tagged.status === 0) {
    const removed =
      JSON.parse(tagged.stdout)[0].Id === baseId && docker(['image', 'rm', baseTag]).status === 0;
    report.cleanup.push({ tag: baseTag, removed });
    if (!removed) report.verdict = 'blocked';
  } else {
    const absent = /No such (object|image)/i.test(tagged.stderr ?? '');
    report.cleanup.push({ tag: baseTag, absent });
    if (!absent) report.verdict = 'blocked';
  }
  try {
    await rm(scratch, { recursive: true, force: true });
    report.cleanup.push({ scratchRemoved: true });
  } catch (error) {
    report.cleanup.push({ scratchRemoved: false, error: error.message });
    report.verdict = 'blocked';
  }
  await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
}
console.log(`${report.verdict}. Evidence in ${output}/report.json`);
if (report.verdict !== 'passed') process.exitCode = 1;
