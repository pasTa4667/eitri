import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WorkspaceStore,
  caseId,
  repositoryId,
  requestId,
  virtualPath,
} from '../../src/workspace.ts';
import {
  engineCommit,
  baselineSha256,
  namespaceChrootPolicy,
  sha256,
} from '../chromium/policy.mjs';
import { isSandboxStatusVerified } from '../chromium/sandbox-status.mjs';

if (process.argv.length !== 2) throw new Error('This throwaway instrument accepts no arguments');

const baseTag = 'eitri-chromium-probe:1.64.1-node26.5.0';
const baseId = 'sha256:57911b2d47725e1d19e25203b82d7c90a3160da1815f78a9c66b42a89dd1ddff';
const runId = randomUUID();
const label = 'eitri.frozen-browser-copy.run';
const imageTag = `eitri-frozen-browser-copy:${runId}`;
const containerName = `eitri-frozen-browser-copy-${runId}`;
const htmlA =
  '<button id="run">Run</button><output id="result"></output><script>run.onclick=()=>result.textContent="A"</script>\n';
const htmlB =
  '<button id="run">Run</button><output id="result"></output><script>run.onclick=()=>result.textContent="B"</script>\n';
const baseline = [
  { path: 'src/index.html', literal: htmlA },
  {
    path: 'package.json',
    literal:
      '{"private":true,"scripts":{"preinstall":"node poison.cjs","install":"node poison.cjs","postinstall":"node poison.cjs"}}\n',
  },
  {
    path: 'poison.cjs',
    literal:
      'require("node:fs").writeFileSync("/tmp/project-node-executed", "project Node executed\\n");\n',
  },
];
const report = {
  protocol: 1,
  runId,
  checkedAt: new Date().toISOString(),
  scope:
    'Pure throwaway COPY instrument with synthetic bytes. Not a production validator or receipt.',
  status: 'blocked',
  observationOutcome: 'blocked',
  resources: { containerName, imageTag },
  cleanup: {
    container: 'not-created',
    image: 'not-created',
    store: 'not-opened',
    scratch: 'not-created',
    buildCache:
      'Not pruned. Docker may retain synthetic COPY bytes and trusted driver in build cache.',
  },
};
let privateRoot;
let store;
let containerId;
let derivedImageId;
let buildAttempted = false;
let createAttempted = false;
let exportRoot;
let exportBefore;
let workspaceCase;

function docker(args, timeout = 15000) {
  const result = spawnSync('docker', ['--context', 'orbstack', ...args], {
    encoding: 'utf8',
    timeout,
    maxBuffer: 48000,
    killSignal: 'SIGKILL',
  });
  if (result.error) {
    report.dockerClientFailure ??= {
      operation: args[0],
      stdout: result.stdout?.slice(0, 16000),
      stderr: result.stderr?.slice(0, 16000),
    };
    throw new Error(`Docker client failed: ${String(result.error.message).slice(0, 512)}`);
  }
  return result;
}

function checked(args, timeout) {
  const result = docker(args, timeout);
  assert.equal(result.status, 0, `Docker ${args[0]} failed: ${result.stderr.slice(0, 2048)}`);
  return result.stdout;
}

function inspectImage(reference) {
  const entries = JSON.parse(checked(['image', 'inspect', reference]));
  assert.equal(entries.length, 1);
  return entries[0];
}

function verifyBase() {
  const image = inspectImage(baseTag);
  assert.equal(image.Id, baseId);
  assert.equal(image.Architecture, 'arm64');
  assert.equal(image.Os, 'linux');
  assert.ok(!image.Config.OnBuild?.length, 'Base image must not have ONBUILD instructions');
  assert.equal(image.RootFS.Type, 'layers');
  assert.ok(Array.isArray(image.RootFS.Layers) && image.RootFS.Layers.length > 0);
  return { id: image.Id, architecture: image.Architecture, os: image.Os, rootFS: image.RootFS };
}

async function readExport() {
  // Throwaway coupling to WorkspaceStore's private physical export layout, not a shipping API.
  const directories = [];
  for (const path of ['', 'src']) {
    const stat = await lstat(join(exportRoot, path));
    assert.ok(stat.isDirectory());
    assert.equal(stat.mode & 0o7777, 0o500);
    directories.push({ path, mode: stat.mode & 0o7777 });
  }
  assert.deepEqual((await readdir(exportRoot)).sort(), ['package.json', 'poison.cjs', 'src']);
  assert.deepEqual(await readdir(join(exportRoot, 'src')), ['index.html']);
  const files = [];
  for (const { path, literal } of baseline) {
    const stat = await lstat(join(exportRoot, path));
    assert.ok(stat.isFile() && stat.nlink === 1 && stat.size <= 4096);
    assert.equal(stat.mode & 0o7777, 0o400);
    const bytes = await readFile(join(exportRoot, path));
    assert.equal(bytes.toString('utf8'), literal);
    files.push({
      path,
      literal: bytes.toString('utf8'),
      sha256: sha256(bytes),
      size: bytes.length,
      mode: stat.mode & 0o7777,
    });
  }
  return { directories, files };
}

async function verifyPreserved() {
  if (exportBefore) {
    report.exportAfter = await readExport();
    assert.deepEqual(report.exportAfter, exportBefore);
    report.exportPreserved = true;
  }
  if (report.workspaceB) {
    const current = await store.read(workspaceCase, virtualPath('src/index.html'));
    report.workspaceAfter = {
      literal: Buffer.from(current.bytes).toString('utf8'),
      sha256: current.sha256,
    };
    assert.equal(report.workspaceAfter.literal, htmlB);
    assert.equal(report.workspaceAfter.sha256, report.workspaceB.sha256);
  }
}

async function removeOwnScratch(path) {
  const stat = await lstat(path);
  if (stat.isDirectory()) {
    await chmod(path, 0o700);
    for (const name of await readdir(path)) await removeOwnScratch(join(path, name));
    await rmdir(path);
  } else {
    await rm(path, { force: true });
  }
}

function isBrowserProcessSecurityVerified(status, initialUserNamespace) {
  if (
    !Array.isArray(status.uid) ||
    status.uid.length !== 4 ||
    !status.uid.every((uid) => uid === 1001) ||
    status.noNewPrivileges !== '1' ||
    status.seccomp !== '2'
  )
    return false;
  const knownNamespace = (namespace) =>
    typeof namespace?.identity === 'string' &&
    namespace.identity.length < 64 &&
    namespace.identity.match(/^user:\[[1-9]\d*\]$/)?.[0] === namespace.identity &&
    namespace.unavailable !== true &&
    namespace.truncated !== true;
  const sameInitialNamespace =
    knownNamespace(initialUserNamespace) &&
    knownNamespace(status.userNamespace) &&
    status.userNamespace.identity === initialUserNamespace.identity;
  if (sameInitialNamespace && status.capBnd != null && !/^0+$/.test(status.capBnd)) return false;
  if (
    typeof status.capEff === 'string' &&
    /^0+$/.test(status.capEff) &&
    typeof status.capPrm === 'string' &&
    /^0+$/.test(status.capPrm)
  )
    return true;
  // Chromium's zygote retains only CAP_SYS_ADMIN in its child user namespace, not the container's.
  return (
    status.role === 'zygote' &&
    status.capEff === '0000000000200000' &&
    status.capPrm === '0000000000200000' &&
    knownNamespace(initialUserNamespace) &&
    knownNamespace(status.userNamespace) &&
    !sameInitialNamespace &&
    ['uid_map', 'gid_map'].every((name) => {
      const map = status.idMaps?.[name];
      return (
        map?.unavailable !== true &&
        map?.truncated === false &&
        typeof map.text === 'string' &&
        map.text.length <= 256 &&
        /^1001[ \t]+1001[ \t]+1$/.test(map.text.trim())
      );
    }) &&
    typeof status.nspid === 'string' &&
    status.nspid.length < 64 &&
    /^[1-9]\d*(?:[ \t]+[1-9]\d*)+$/.test(status.nspid) &&
    status.nspid.split(/[ \t]+/)[0] === status.pid
  );
}

function verifyObservations(observations) {
  assert.equal(observations.protocol, 1);
  assert.equal(observations.driverSha256, report.provenance.driverSha256);
  assert.equal(observations.error, undefined);
  assert.equal(observations.teardownError, undefined);
  assert.deepEqual(observations.runtime, { node: 'v26.5.0', arch: 'arm64', uid: 1001 });
  assert.deepEqual(observations.security.uid, [1001, 1001, 1001, 1001]);
  assert.match(observations.security.capEff, /^0+$/);
  assert.equal(observations.security.noNewPrivileges, '1');
  assert.equal(observations.security.seccomp, '2');
  for (const status of observations.processes)
    assert.equal(isBrowserProcessSecurityVerified(status, observations.initialUserNamespace), true);
  assert.ok(observations.processes.length > 0 && observations.processes.length <= 64);
  const flags = observations.processes.flatMap((entry) => entry.sandboxAndDebuggingFlags);
  assert.ok(!flags.some((flag) => /^(--no-sandbox|--disable-.*sandbox)(=|$)/.test(flag)));
  assert.ok(!flags.some((flag) => flag.startsWith('--remote-debugging-port')));
  assert.ok(flags.includes('--remote-debugging-pipe'));
  assert.deepEqual(observations.nodeExecArgv, []);
  assert.ok(isSandboxStatusVerified(observations.sandboxText));
  assert.equal(observations.budgets['memory.max'], String(4 * 1024 ** 3));
  assert.equal(observations.budgets['memory.swap.max'], '0');
  assert.equal(observations.budgets['pids.max'], '256');
  const [quota, period] = observations.budgets['cpu.max'].split(/\s+/).map(Number);
  assert.ok(quota > 0 && period > 0 && quota / period === 2);
  assert.equal(observations.readOnly.root, 'EROFS');
  assert.ok(['EROFS', 'EACCES'].includes(observations.readOnly.snapshot));
  assert.deepEqual(observations.unavailable, {
    dockerSocket: 'ENOENT',
    hostSentinel: 'ENOENT',
    hostController: 'ENOENT',
    projectNodeCanary: 'ENOENT',
  });
  assert.equal(observations.canaryAfter, 'ENOENT');
  assert.ok(['ENETUNREACH', 'EHOSTUNREACH', 'EACCES', 'EPERM'].includes(observations.egress));
  assert.deepEqual(
    observations.directories,
    ['/snapshot', '/snapshot/src'].map((path) => ({ path, mode: 0o555, uid: 1001 })),
  );
  assert.deepEqual(
    observations.snapshot,
    exportBefore.files.map(({ path, sha256: digest, size }) => ({
      path,
      sha256: digest,
      size,
      mode: 0o444,
      uid: 1001,
    })),
  );
  assert.equal(observations.staticServer.address, '127.0.0.1');
  assert.ok(
    Number.isInteger(observations.staticServer.port) &&
      observations.staticServer.port > 0 &&
      observations.staticServer.port <= 65535,
  );
  assert.equal(observations.served.literal, htmlA);
  assert.equal(observations.served.sha256, sha256(htmlA));
  assert.equal(observations.literalOutput, 'A');
  assert.notEqual(observations.literalOutput, 'B');
}

try {
  privateRoot = await realpath(await mkdtemp(join(tmpdir(), 'eitri-frozen-copy-')));
  report.resources.privateRoot = privateRoot;
  report.cleanup.scratch = 'pending';
  const storeRoot = join(privateRoot, 'store');
  await mkdir(storeRoot, { mode: 0o700 });
  store = await WorkspaceStore.open({
    directory: storeRoot,
    regressionDirectory: virtualPath('test/regression'),
  });
  report.cleanup.store = 'pending';
  workspaceCase = caseId(randomUUID());
  const workspace = await store.provision({
    caseId: workspaceCase,
    repositoryId: repositoryId(randomUUID()),
    baseline: baseline.map(({ path, literal }) => ({
      virtualPath: virtualPath(path),
      bytes: Buffer.from(literal),
    })),
  });
  assert.equal(workspace.state, 'ready');
  const frozen = await store.freeze(workspaceCase, workspace.checkpoint.revision);
  const exported = await store.exportRevision(frozen);
  assert.equal(exported.revision, frozen.revision);
  assert.equal(exported.manifestDigest, frozen.manifestDigest);
  exportRoot = join(storeRoot, 'exports', exported.exportId);
  exportBefore = await readExport();
  report.exportBefore = exportBefore;
  const edited = await store.edit(workspaceCase, frozen.revision, {
    requestId: requestId(randomUUID()),
    virtualPath: virtualPath('src/index.html'),
    expectedHash: (await store.read(workspaceCase, virtualPath('src/index.html'))).sha256,
    bytes: Buffer.from(htmlB),
  });
  const current = await store.read(workspaceCase, virtualPath('src/index.html'));
  report.workspaceB = {
    revision: edited.checkpoint.revision,
    literal: Buffer.from(current.bytes).toString('utf8'),
    sha256: current.sha256,
  };
  assert.equal(report.workspaceB.literal, htmlB);
  assert.notEqual(report.workspaceB.revision, frozen.revision);
  report.provenance = {
    frozen,
    exported,
    transferredBytesSha256: sha256(
      JSON.stringify(
        exportBefore.files.map(({ path, sha256: digest, size }) => ({
          path,
          sha256: digest,
          size,
        })),
      ),
    ),
  };

  const context = join(privateRoot, 'context');
  const snapshot = join(context, 'rootfs', 'snapshot');
  await mkdir(join(snapshot, 'src'), { recursive: true, mode: 0o700 });
  const dockerfile = await readFile(new URL('Dockerfile', import.meta.url));
  const driver = await readFile(new URL('driver.mjs', import.meta.url));
  assert.ok(dockerfile.length <= 2048 && driver.length <= 20000);
  await writeFile(join(context, 'Dockerfile'), dockerfile, { flag: 'wx', mode: 0o400 });
  await writeFile(join(context, 'driver.mjs'), driver, { flag: 'wx', mode: 0o400 });
  for (const { path, literal } of exportBefore.files) {
    await writeFile(join(snapshot, path), literal, { flag: 'wx', mode: 0o444 });
    await chmod(join(snapshot, path), 0o444);
  }
  await chmod(join(snapshot, 'src'), 0o555);
  await chmod(snapshot, 0o555);
  report.provenance.driverSha256 = sha256(driver);
  report.provenance.dockerfileSha256 = sha256(dockerfile);
  report.provenance.contextFiles = [
    'Dockerfile',
    'driver.mjs',
    ...baseline.map(({ path }) => `rootfs/snapshot/${path}`),
  ];
  const sentinel = join(privateRoot, 'host-sentinel');
  await writeFile(sentinel, 'Synthetic non-secret host sentinel\n', { flag: 'wx', mode: 0o600 });
  const controller = fileURLToPath(new URL('../../src/controller.ts', import.meta.url));

  const server = JSON.parse(checked(['version', '--format', '{{json .Server}}']));
  assert.equal(server.Version, '29.4.0');
  assert.equal(server.Arch, 'arm64');
  assert.ok(
    typeof server.GitCommit === 'string' &&
      /^[0-9a-f]{8,40}$/.test(server.GitCommit) &&
      engineCommit.startsWith(server.GitCommit),
  );
  report.daemon = {
    version: server.Version,
    gitCommit: server.GitCommit,
    architecture: server.Arch,
  };
  const security = JSON.parse(checked(['info', '--format', '{{json .SecurityOptions}}']));
  assert.ok(security.includes('name=seccomp,profile=builtin'));
  report.daemonSecurity = security;
  const policy = namespaceChrootPolicy(
    await readFile(new URL('../chromium/seccomp/docker-29.4.0.json', import.meta.url)),
  );
  const policyPath = join(privateRoot, 'seccomp.json');
  await writeFile(policyPath, policy, { flag: 'wx', mode: 0o600 });
  report.policy = { engineCommit, baselineSha256, sha256: sha256(policy), addedRules: 7 };
  report.baseBefore = verifyBase();
  buildAttempted = true;
  report.cleanup.image = 'pending';
  const build = docker(
    [
      'build',
      '--pull=false',
      '--network=none',
      '--progress=plain',
      '--platform=linux/arm64',
      '--label',
      `${label}=${runId}`,
      '--tag',
      imageTag,
      context,
    ],
    60000,
  );
  report.build = {
    exitCode: build.status,
    stdout: build.stdout.slice(0, 16000),
    stderr: build.stderr.slice(0, 16000),
    offlineGuarantee: false,
  };
  assert.ok(
    Buffer.byteLength(build.stdout) <= 16000 && Buffer.byteLength(build.stderr) <= 16000,
    'Build diagnostics exceeded limit',
  );
  report.baseAfterBuild = verifyBase();
  assert.equal(build.status, 0, 'Fixed local-tag COPY build failed. No fallback attempted');
  assert.ok(
    !/\[auth\]|\bpulling\b|pull access|\b(?:HEAD|GET|POST|PUT|PATCH|DELETE|CONNECT)\s+["']?https?:\/\/|failed to do request|failed to (?:authorize|fetch (?:anonymous|oauth) token)|(?:proxyconnect|dial) tcp|TLS handshake timeout|network is unreachable|connection (?:refused|reset)|no such host|i\/o timeout/i.test(
      `${build.stdout}\n${build.stderr}`,
    ),
    'Explicit request, auth, pull, or network failure observed. No fallback allowed',
  );
  const image = inspectImage(imageTag);
  assert.equal(image.Config.Labels?.[label], runId);
  assert.notEqual(image.Id, baseId);
  assert.match(image.Id, /^sha256:[0-9a-f]{64}$/);
  derivedImageId = image.Id;
  report.resources.imageId = derivedImageId;
  assert.equal(image.Architecture, 'arm64');
  assert.equal(image.Os, 'linux');
  report.derivedRootFS = image.RootFS;
  assert.equal(image.RootFS.Type, report.baseBefore.rootFS.Type);
  assert.deepEqual(
    image.RootFS.Layers.slice(0, report.baseBefore.rootFS.Layers.length),
    report.baseBefore.rootFS.Layers,
    'Derived image must retain the exact base layer prefix',
  );
  const entrypoint = ['/usr/local/bin/node', '/opt/eitri/frozen-driver.mjs'];
  assert.deepEqual(image.Config.Entrypoint, entrypoint);
  assert.ok(!image.Config.Cmd?.length && !image.Config.Healthcheck);
  assert.ok(
    !image.Config.Env.some((value) =>
      /^(NODE_OPTIONS|NODE_INSPECT_RESUME_ON_START|DEBUG)=/.test(value),
    ),
  );
  createAttempted = true;
  report.cleanup.container = 'pending';
  const created = checked([
    'create',
    '--name',
    containerName,
    '--label',
    `${label}=${runId}`,
    '--platform',
    'linux/arm64',
    '--user',
    'pwuser',
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
    '--stop-timeout',
    '2',
    '--env',
    `EITRI_HOST_SENTINEL=${sentinel}`,
    '--env',
    `EITRI_HOST_CONTROLLER=${controller}`,
    derivedImageId,
  ]);
  assert.match(created, /^[0-9a-f]{64}\s*$/);
  containerId = created.trim();
  report.resources.containerId = containerId;
  report.cleanup.container = 'pending';
  const [container] = JSON.parse(checked(['inspect', containerId]));
  const config = container.HostConfig;
  report.applied = {
    image: container.Image,
    config: container.Config,
    hostConfig: config,
    mounts: container.Mounts,
  };
  assert.equal(container.Id, containerId);
  assert.equal(container.Config.Labels?.[label], runId);
  assert.equal(container.Image, derivedImageId);
  assert.equal(container.State.Status, 'created');
  assert.equal(container.Config.User, 'pwuser');
  assert.deepEqual(container.Config.Entrypoint, entrypoint);
  assert.ok(!container.Config.Cmd?.length && !container.Config.Healthcheck);
  const actualEnv = [...container.Config.Env].sort();
  const expectedEnv = [
    ...image.Config.Env,
    `EITRI_HOST_SENTINEL=${sentinel}`,
    `EITRI_HOST_CONTROLLER=${controller}`,
  ].sort();
  for (const env of [actualEnv, expectedEnv]) {
    const keys = env.map((binding) => {
      assert.ok(
        typeof binding === 'string' && binding.indexOf('=') > 0,
        'Environment binding must contain a nonempty key and "="',
      );
      return binding.slice(0, binding.indexOf('='));
    });
    assert.equal(new Set(keys).size, keys.length, 'Environment keys must be unique');
  }
  assert.deepEqual(actualEnv, expectedEnv);
  assert.equal(container.Config.StopTimeout, 2);
  assert.deepEqual(container.Mounts, []);
  assert.ok(
    !config.Binds?.length &&
      !config.Mounts?.length &&
      !config.VolumesFrom?.length &&
      !config.Devices?.length &&
      !config.DeviceRequests?.length,
  );
  assert.equal(config.NetworkMode, 'none');
  assert.equal(config.ReadonlyRootfs, true);
  assert.equal(config.Privileged, false);
  assert.ok(!config.CapAdd?.length);
  assert.deepEqual(config.CapDrop, ['ALL']);
  assert.equal(config.SecurityOpt.length, 2);
  assert.ok(
    config.SecurityOpt.some(
      (value) => value === 'no-new-privileges' || value === 'no-new-privileges=true',
    ),
  );
  const appliedPolicy = config.SecurityOpt.filter((value) => value.startsWith('seccomp='));
  assert.equal(appliedPolicy.length, 1);
  assert.deepEqual(JSON.parse(appliedPolicy[0].slice(8)), JSON.parse(policy));
  assert.equal(config.Memory, 4 * 1024 ** 3);
  assert.equal(config.MemorySwap, 4 * 1024 ** 3);
  assert.equal(config.NanoCpus, 2e9);
  assert.equal(config.PidsLimit, 256);
  assert.equal(config.IpcMode, 'private');
  assert.equal(config.ShmSize, 256 * 1024 ** 2);
  assert.deepEqual(config.Tmpfs, { '/tmp': 'rw,exec,nosuid,size=256m,uid=1001,gid=1001' });
  assert.deepEqual(config.Ulimits, [{ Name: 'core', Hard: 0, Soft: 0 }]);
  assert.ok(!config.PidMode && !config.UTSMode && !config.UsernsMode && !config.CgroupParent);
  assert.equal(config.PublishAllPorts, false);
  assert.ok(!config.PortBindings || Object.keys(config.PortBindings).length === 0);
  report.appliedVerified = true;
  const execution = docker(['start', '-a', containerId], 65000);
  report.execution = { exitCode: execution.status, stderr: execution.stderr };
  assert.ok(
    Buffer.byteLength(execution.stdout) <= 24000 && Buffer.byteLength(execution.stderr) <= 8000,
  );
  report.observations = JSON.parse(execution.stdout);
  assert.equal(execution.status, 0, 'Driver did not complete normally');
  const [stopped] = JSON.parse(checked(['inspect', containerId]));
  assert.equal(stopped.State.Status, 'exited');
  assert.equal(stopped.State.ExitCode, 0);
  assert.equal(stopped.State.OOMKilled, false);
  verifyObservations(report.observations);
  await verifyPreserved();
  report.observationOutcome = 'observed-frozen-a';
  report.status = 'observed-frozen-a';
} catch (error) {
  report.error = String(error.message).slice(0, 4096);
} finally {
  if (store) {
    try {
      await verifyPreserved();
    } catch (error) {
      report.preservationError = String(error.message).slice(0, 1024);
      report.status = 'blocked';
    }
  }
  if (buildAttempted) {
    try {
      report.baseFinally = verifyBase();
    } catch (error) {
      report.baseVerificationError = String(error.message).slice(0, 1024);
      report.status = 'blocked';
    }
  }
  if (createAttempted) {
    try {
      const inspected = docker(['inspect', containerId ?? containerName]);
      if (inspected.status !== 0) {
        assert.match(inspected.stderr, /No such (object|container)/i);
        report.cleanup.container =
          report.dockerClientFailure?.operation === 'create'
            ? 'uncertain: create client failed; no container found by owned name'
            : 'not-created';
      } else {
        const [owned] = JSON.parse(inspected.stdout);
        assert.equal(owned.Config.Labels?.[label], runId);
        assert.match(owned.Id, /^[0-9a-f]{64}$/);
        if (containerId) assert.equal(owned.Id, containerId);
        containerId = owned.Id;
        report.resources.containerId = containerId;
        checked(['rm', '-f', containerId]);
        report.cleanup.container = 'removed';
      }
    } catch (error) {
      report.cleanup.container = `failed: ${String(error.message).slice(0, 512)}`;
    }
  }
  if (buildAttempted) {
    try {
      const result = docker(['image', 'inspect', imageTag]);
      if (result.status !== 0) {
        assert.match(result.stderr, /No such image/i);
        report.cleanup.image =
          report.dockerClientFailure?.operation === 'build'
            ? 'uncertain: build client failed; daemon may finish later'
            : 'not-created';
      } else {
        const [owned] = JSON.parse(result.stdout);
        assert.equal(owned.Config.Labels?.[label], runId);
        assert.notEqual(owned.Id, baseId);
        assert.match(owned.Id, /^sha256:[0-9a-f]{64}$/);
        if (derivedImageId) assert.equal(owned.Id, derivedImageId);
        derivedImageId = owned.Id;
        report.resources.imageId = derivedImageId;
        assert.deepEqual(owned.RepoTags, [imageTag]);
        checked(['image', 'rm', imageTag]);
        const after = docker(['image', 'inspect', derivedImageId]);
        assert.ok(after.status !== 0 && /No such image/i.test(after.stderr));
        report.cleanup.image = 'removed';
      }
    } catch (error) {
      report.cleanup.image = `failed: ${String(error.message).slice(0, 512)}`;
    }
  }
  if (store) {
    try {
      await store.close();
      report.cleanup.store = 'closed';
    } catch (error) {
      report.cleanup.store = `failed: ${String(error.message).slice(0, 512)}`;
    }
  }
  if (privateRoot && (!store || report.cleanup.store === 'closed')) {
    try {
      await removeOwnScratch(privateRoot);
      report.cleanup.scratch = 'removed';
    } catch (error) {
      report.cleanup.scratch = `failed: ${String(error.message).slice(0, 512)}`;
    }
  }
  if (
    Object.entries(report.cleanup).some(
      ([key, value]) =>
        key !== 'buildCache' &&
        (value === 'pending' || value.startsWith('failed:') || value.startsWith('uncertain:')),
    )
  )
    report.status = 'uncertain';
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(output) > 160000) {
    console.log(
      JSON.stringify({
        protocol: 1,
        runId,
        status: 'blocked',
        error: 'Report limit exceeded',
        resources: report.resources,
        cleanup: report.cleanup,
      }),
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(output);
    if (report.status !== 'observed-frozen-a') process.exitCode = 1;
  }
}
