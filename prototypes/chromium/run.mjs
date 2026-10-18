import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

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
};
let id;
try {
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
  if (
    container.Config.User !== 'pwuser' ||
    container.Mounts.length !== 0 ||
    config.NetworkMode !== 'none' ||
    !config.ReadonlyRootfs ||
    config.Privileged ||
    config.CapAdd?.length ||
    !config.CapDrop.includes('ALL') ||
    !config.SecurityOpt.some((v) => v.startsWith('no-new-privileges')) ||
    config.Memory !== 4 * 1024 ** 3 ||
    config.NanoCpus !== 2e9 ||
    config.PidsLimit !== 128 ||
    config.IpcMode !== 'private'
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
  const destination = new URL('docs/evidence/chromium-containment.json', root);
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`${report.verdict}. Evidence: docs/evidence/chromium-containment.json`);
  if (report.verdict !== 'supported') process.exitCode = 1;
}
