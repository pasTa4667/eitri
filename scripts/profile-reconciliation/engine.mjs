import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { namespaceRules, sha256 } from '../../prototypes/chromium/policy.mjs';

const reviewed = {
  version: '29.8.2',
  commit: '8af9fe3a36bab3e039862a2ab1cef1880c9b4d03',
  baselineSha256: '536529b665dd0972c37bfb569f5d4ac8a53592e7b00752bc39ff063ca9864c74',
  policySha256: '1ccf001ef888765cf5e09948c6060646e88391517f8261bbb2781096a5e1bfce',
};

export async function readFixturePolicy(server) {
  assert.equal(server.Version, reviewed.version, 'Unreviewed fixture engine version');
  assert.equal(server.Arch, 'arm64', 'Unreviewed fixture engine architecture');
  assert.ok(
    [reviewed.commit, reviewed.commit.slice(0, 7)].includes(server.GitCommit),
    'Unreviewed fixture engine commit',
  );
  const bytes = await readFile(new URL('seccomp/docker-29.8.2.json', import.meta.url));
  assert.equal(sha256(bytes), reviewed.baselineSha256, 'Unreviewed fixture seccomp baseline');
  const policy = JSON.parse(bytes);
  policy.syscalls.push(...structuredClone(namespaceRules), {
    names: ['chroot'],
    action: 'SCMP_ACT_ALLOW',
    includes: { arches: ['arm64'] },
  });
  const text = `${JSON.stringify(policy, null, 2)}\n`;
  assert.equal(sha256(text), reviewed.policySha256, 'Unreviewed fixture seccomp policy');
  return { policy: text, reviewed: { ...reviewed } };
}
