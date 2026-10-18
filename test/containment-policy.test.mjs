import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { baselineSha256, namespacePolicy, sha256 } from '../prototypes/chromium/policy.mjs';

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
