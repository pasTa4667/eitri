import { createHash } from 'node:crypto';

export const engineCommit = 'daa0cb7f23594cdbcce5002e370027d3fd36ffd7';
export const baselineSha256 = '01536f1d1df938ae611eba20d6349e0de7a99b6ecdee1549427a0b01b8301e28';
export const baselineUrl = `https://raw.githubusercontent.com/moby/moby/${engineCommit}/vendor/github.com/moby/profiles/seccomp/default.json`;
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const namespaceRules = [
  ...[268435473, 805306385, 1342177297, 1879048209, 536870929].map((value) => ({
    names: ['clone'],
    action: 'SCMP_ACT_ALLOW',
    args: [{ index: 0, value, op: 'SCMP_CMP_EQ' }],
    includes: { arches: ['arm64'] },
  })),
  {
    names: ['unshare'],
    action: 'SCMP_ACT_ALLOW',
    args: [{ index: 0, value: 268435456, op: 'SCMP_CMP_EQ' }],
    includes: { arches: ['arm64'] },
  },
];

export function namespacePolicy(baseline) {
  if (
    ![baselineSha256, '536529b665dd0972c37bfb569f5d4ac8a53592e7b00752bc39ff063ca9864c74'].includes(
      sha256(baseline),
    )
  )
    throw new Error('Unreviewed seccomp baseline');
  const policy = JSON.parse(baseline.toString('utf8'));
  policy.syscalls.push(...structuredClone(namespaceRules));
  return `${JSON.stringify(policy, null, 2)}\n`;
}

export function namespaceChrootPolicy(baseline) {
  const policy = JSON.parse(namespacePolicy(baseline));
  policy.syscalls.push({
    names: ['chroot'],
    action: 'SCMP_ACT_ALLOW',
    includes: { arches: ['arm64'] },
  });
  return `${JSON.stringify(policy, null, 2)}\n`;
}
