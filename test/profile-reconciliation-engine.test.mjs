import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readFixturePolicy } from '../scripts/profile-reconciliation/engine.mjs';
import { namespaceRules, sha256 } from '../prototypes/chromium/policy.mjs';

const server = { Version: '29.8.2', Arch: 'arm64', GitCommit: '8af9fe3' };

test('fixture engine admits only the reviewed engine and preserves the current seccomp baseline plus seven ARM64 rules', async () => {
  const result = await readFixturePolicy(server);
  assert.equal(result.reviewed.commit, '8af9fe3a36bab3e039862a2ab1cef1880c9b4d03');
  assert.equal(
    sha256(result.policy),
    '1ccf001ef888765cf5e09948c6060646e88391517f8261bbb2781096a5e1bfce',
  );
  const baseline = JSON.parse(
    await readFile(
      new URL('../scripts/profile-reconciliation/seccomp/docker-29.8.2.json', import.meta.url),
    ),
  );
  const policy = JSON.parse(result.policy);
  assert.deepEqual(policy.syscalls.splice(baseline.syscalls.length), [
    ...namespaceRules,
    { names: ['chroot'], action: 'SCMP_ACT_ALLOW', includes: { arches: ['arm64'] } },
  ]);
  assert.deepEqual(policy, baseline);
  assert.deepEqual(
    baseline.syscalls.filter((rule) => rule.names.includes('socket')),
    [
      {
        names: ['socket'],
        action: 'SCMP_ACT_ALLOW',
        args: [{ index: 0, value: 38, op: 'SCMP_CMP_LT' }],
      },
      {
        names: ['socket'],
        action: 'SCMP_ACT_ALLOW',
        args: [{ index: 0, value: 39, op: 'SCMP_CMP_EQ' }],
      },
      {
        names: ['socket'],
        action: 'SCMP_ACT_ALLOW',
        args: [{ index: 0, value: 40, op: 'SCMP_CMP_GT' }],
      },
    ],
  );
  assert.deepEqual(
    await readFixturePolicy({ ...server, GitCommit: result.reviewed.commit }),
    result,
  );
  for (const invalid of [
    { Version: '29.4.0' },
    { Version: '29.8.3' },
    { Arch: 'amd64' },
    { GitCommit: '8af9fe' },
    { GitCommit: '8af9fe0' },
    { GitCommit: '8af9fe3fffffffffffffffffffffffffffffffff' },
    { GitCommit: undefined },
  ]) {
    await assert.rejects(readFixturePolicy({ ...server, ...invalid }), /Unreviewed fixture engine/);
  }
  result.reviewed.commit = 'modified';
  assert.equal(
    (await readFixturePolicy(server)).reviewed.commit,
    '8af9fe3a36bab3e039862a2ab1cef1880c9b4d03',
  );
});
