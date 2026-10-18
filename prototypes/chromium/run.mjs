import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { engineCommit, baselineSha256, namespacePolicy, sha256 } from './policy.mjs';

const modes = new Map([
  ['', 'builtin'],
  ['--pinned-policy', 'pinned'],
  ['--namespace-policy', 'namespaces'],
]);
const mode = modes.get(process.argv[2] ?? '');
if (!mode || process.argv.length > 3) throw new Error('Unknown containment probe mode');

const root = new URL('../../', import.meta.url);
const sentinel = new URL('.audit/containment-sentinel.txt', root);
await mkdir(new URL('.audit/', root), { recursive: true });
await writeFile(sentinel, 'Non-secret Eitri containment sentinel\n', { mode: 0o600 });
const docker = (args) =>
  spawnSync('docker', ['--context', 'orbstack', ...args], {
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 64000,
  });
const name = `eitri-chromium-probe-${randomUUID()}`;
const report = {
  checkedAt: new Date().toISOString(),
  simulatedAgent: true,
  scope:
    'Standalone trusted containment probe. No repository or credential mounts; not a generated-code worker.',
  verdict: 'blocked',
  policyMode: mode,
};
let id;
let policyFile;
let policy;
const securityOptions = [];
try {
  if (mode !== 'builtin') {
    const version = docker(['version', '--format', '{{json .Server}}']);
    if (version.status !== 0) throw new Error('Could not inspect daemon version');
    const server = JSON.parse(version.stdout);
    if (
      server.Version !== '29.4.0' ||
      typeof server.GitCommit !== 'string' ||
      !/^[0-9a-f]{8,40}$/.test(server.GitCommit) ||
      !engineCommit.startsWith(server.GitCommit) ||
      server.Arch !== 'arm64'
    )
      throw new Error('Daemon differs from the reviewed seccomp baseline');
    report.daemonVersion = server;
    const baseline = await readFile(new URL('seccomp/docker-29.4.0.json', import.meta.url));
    if (sha256(baseline) !== baselineSha256) throw new Error('Unreviewed seccomp baseline');
    policy = mode === 'namespaces' ? namespacePolicy(baseline) : baseline.toString('utf8');
    policyFile = new URL(`.audit/seccomp-${randomUUID()}.json`, root);
    await writeFile(policyFile, policy, { mode: 0o600, flag: 'wx' });
    report.policy = {
      engineCommit,
      baselineSha256,
      sha256: sha256(policy),
      addedRules: mode === 'namespaces' ? 6 : 0,
    };
    securityOptions.push('--security-opt', `seccomp=${fileURLToPath(policyFile)}`);
  }
  const security = docker(['info', '--format', '{{json .SecurityOptions}}']);
  if (security.status !== 0) throw new Error('Could not inspect daemon security');
  report.daemonSecurity = JSON.parse(security.stdout);
  if (!report.daemonSecurity.some((value) => value === 'name=seccomp,profile=builtin'))
    throw new Error('The probe requires the observed built-in Docker seccomp profile');
  const created = docker([
    'create',
    '--name',
    name,
    '--label',
    'eitri.prototype=chromium-containment',
    '--platform',
    'linux/arm64',
    '--read-only',
    '--network',
    'none',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    ...securityOptions,
    '--cpus',
    '2',
    '--memory',
    '4g',
    '--memory-swap',
    '4g',
    '--pids-limit',
    '128',
    '--ipc',
    'private',
    '--shm-size',
    '256m',
    '--tmpfs',
    '/tmp:rw,exec,nosuid,size=256m,uid=1001,gid=1001',
    '--ulimit',
    'core=0',
    '--env',
    `EITRI_POLICY_MODE=${mode}`,
    '--env',
    `EITRI_HOST_SENTINEL=${fileURLToPath(sentinel)}`,
    '--env',
    `EITRI_HOST_SOURCE=${fileURLToPath(new URL('package.json', root))}`,
    'eitri-chromium-probe:1.64.1-node26.5.0',
  ]);
  if (created.status !== 0 || !/^[0-9a-f]{64}\s*$/.test(created.stdout))
    throw new Error(`Container creation failed: ${created.stderr}`);
  id = created.stdout.trim();
  const inspection = docker(['inspect', id]);
  if (inspection.status !== 0) throw new Error('Could not inspect the created container');
  const container = JSON.parse(inspection.stdout)[0];
  const config = container.HostConfig;
  report.applied = {
    imageId: container.Image,
    user: container.Config.User,
    mounts: container.Mounts,
    network: config.NetworkMode,
    readOnly: config.ReadonlyRootfs,
    privileged: config.Privileged,
    capabilitiesAdded: config.CapAdd,
    capabilitiesDropped: config.CapDrop,
    security: config.SecurityOpt,
    memoryBytes: config.Memory,
    cpuNano: config.NanoCpus,
    pids: config.PidsLimit,
    ipc: config.IpcMode,
    shmBytes: config.ShmSize,
    scratch: config.Tmpfs,
  };
  if (policy) {
    const applied = config.SecurityOpt.filter((value) => value.startsWith('seccomp='));
    if (
      applied.length !== 1 ||
      JSON.stringify(JSON.parse(applied[0].slice(8))) !== JSON.stringify(JSON.parse(policy))
    )
      throw new Error('Applied seccomp policy differs from the reviewed candidate');
    report.policy.appliedVerified = true;
  } else if (config.SecurityOpt.some((value) => value.startsWith('seccomp='))) {
    throw new Error('Unexpected custom seccomp policy');
  }
  if (
    container.Config.User !== 'pwuser' ||
    container.Mounts.length !== 0 ||
    config.NetworkMode !== 'none' ||
    !config.ReadonlyRootfs ||
    config.Privileged ||
    config.CapAdd?.length ||
    !config.CapDrop.includes('ALL') ||
    !config.SecurityOpt.some((v) => v === 'no-new-privileges' || v === 'no-new-privileges=true') ||
    config.SecurityOpt.length !== (policy ? 2 : 1) ||
    config.Memory !== 4 * 1024 ** 3 ||
    config.MemorySwap !== 4 * 1024 ** 3 ||
    config.NanoCpus !== 2e9 ||
    config.PidsLimit !== 128 ||
    config.IpcMode !== 'private' ||
    config.ShmSize !== 256 * 1024 ** 2 ||
    JSON.stringify(config.Tmpfs) !==
      JSON.stringify({ '/tmp': 'rw,exec,nosuid,size=256m,uid=1001,gid=1001' })
  )
    throw new Error('Applied containment differs from the requested contract');
  const run = docker(['start', '-a', id]);
  report.exitCode = run.status;
  report.stderr = run.stderr;
  report.observation = JSON.parse(run.stdout);
  if (run.status === 0 && report.observation.verdict === 'supported') report.verdict = 'supported';
} catch (error) {
  report.error = error.message;
} finally {
  if (id) {
    const cleanup = docker(['rm', '-f', id]);
    report.containerRemoved = cleanup.status === 0;
    if (cleanup.status !== 0) report.verdict = 'blocked';
  }
  if (policyFile) await unlink(policyFile);
  const evidence =
    mode === 'builtin' ? 'chromium-containment.json' : `chromium-containment-${mode}.json`;
  const destination = new URL(`docs/evidence/${evidence}`, root);
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`${report.verdict}. Evidence: docs/evidence/${evidence}`);
  if (report.verdict !== 'supported') process.exitCode = 1;
}
