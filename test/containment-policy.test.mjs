import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  baselineSha256,
  namespacePolicy,
  namespaceChrootPolicy,
  sha256,
} from '../prototypes/chromium/policy.mjs';

test('namespace candidate preserves the pinned daemon baseline and adds only six exact ARM64 rules', async () => {
  const bytes = await readFile(
    new URL('../prototypes/chromium/seccomp/docker-29.4.0.json', import.meta.url),
  );
  assert.equal(sha256(bytes), baselineSha256);
  const baseline = JSON.parse(bytes);
  const candidate = JSON.parse(namespacePolicy(bytes));
  const additions = candidate.syscalls.splice(baseline.syscalls.length);
  assert.deepEqual(candidate, baseline);
  assert.deepEqual(
    additions.map((rule) => [rule.names, rule.args]),
    [
      ...[268435473, 805306385, 1342177297, 1879048209, 536870929].map((value) => [
        ['clone'],
        [{ index: 0, value, op: 'SCMP_CMP_EQ' }],
      ]),
      [['unshare'], [{ index: 0, value: 268435456, op: 'SCMP_CMP_EQ' }]],
    ],
  );
  for (const rule of additions) {
    assert.equal(rule.action, 'SCMP_ACT_ALLOW');
    assert.deepEqual(rule.includes, { arches: ['arm64'] });
    assert.deepEqual(Object.keys(rule).sort(), ['action', 'args', 'includes', 'names']);
  }
  assert.throws(() => namespacePolicy(Buffer.concat([bytes, Buffer.from('\n')])), /Unreviewed/);
  assert.throws(() => namespacePolicy(Buffer.from('{}')), /Unreviewed/);
});

test('modern namespace chroot policy preserves every baseline rule including AF_ALG denial', async () => {
  const bytes = await readFile(
    new URL('../scripts/profile-reconciliation/seccomp/docker-29.8.2.json', import.meta.url),
  );
  assert.equal(sha256(bytes), '536529b665dd0972c37bfb569f5d4ac8a53592e7b00752bc39ff063ca9864c74');
  const baseline = JSON.parse(bytes);
  const candidate = JSON.parse(namespaceChrootPolicy(bytes));
  assert.equal(
    sha256(namespaceChrootPolicy(bytes)),
    '1ccf001ef888765cf5e09948c6060646e88391517f8261bbb2781096a5e1bfce',
  );
  const additions = candidate.syscalls.splice(baseline.syscalls.length);
  assert.deepEqual(candidate, baseline);
  const legacy = JSON.parse(
    namespaceChrootPolicy(
      await readFile(new URL('../prototypes/chromium/seccomp/docker-29.4.0.json', import.meta.url)),
    ),
  );
  assert.deepEqual(additions, legacy.syscalls.slice(-7));
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
  assert.throws(
    () => namespaceChrootPolicy(Buffer.concat([bytes, Buffer.from('\n')])),
    /Unreviewed/,
  );
});

test('namespace chroot candidate adds only one ARM64 chroot rule to the six-rule namespace candidate', async () => {
  const bytes = await readFile(
    new URL('../prototypes/chromium/seccomp/docker-29.4.0.json', import.meta.url),
  );
  const original = Buffer.from(bytes);
  const namespaces = namespacePolicy(bytes);
  const candidate = JSON.parse(namespaceChrootPolicy(bytes));
  assert.equal(candidate.syscalls.length, JSON.parse(bytes).syscalls.length + 7);
  assert.deepEqual(candidate.syscalls.pop(), {
    names: ['chroot'],
    action: 'SCMP_ACT_ALLOW',
    includes: { arches: ['arm64'] },
  });
  assert.equal(`${JSON.stringify(candidate, null, 2)}\n`, namespaces);
  assert.deepEqual(bytes, original);
  assert.equal(sha256(bytes), baselineSha256);
  assert.equal(namespacePolicy(bytes), namespaces);
  assert.throws(
    () => namespaceChrootPolicy(Buffer.concat([bytes, Buffer.from('\n')])),
    /Unreviewed/,
  );
  assert.throws(() => namespaceChrootPolicy(Buffer.from('{}')), /Unreviewed/);
});
