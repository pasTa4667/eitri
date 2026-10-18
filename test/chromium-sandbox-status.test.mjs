import test from 'node:test';
import assert from 'node:assert/strict';
import { isSandboxStatusVerified } from '../prototypes/chromium/sandbox-status.mjs';

const sandboxPage = `Sandbox Status
Layer 1 Sandbox\tNamespace
PID namespaces\tYes
Network namespaces\tYes
Seccomp-BPF sandbox\tYes
Seccomp-BPF sandbox supports TSYNC\tYes
Ptrace Protection with Yama LSM (Broker)\tNo
Ptrace Protection with Yama LSM (Non-broker)\tNo

You are adequately sandboxed.`;

const requiredRows = [
  'Layer 1 Sandbox\tNamespace',
  'PID namespaces\tYes',
  'Network namespaces\tYes',
  'Seccomp-BPF sandbox\tYes',
];

test('captured Chromium 156 sandbox status is positively verified', () => {
  assert.equal(isSandboxStatusVerified(sandboxPage), true);
});

test('sandbox status accepts multiple-space columns and CRLF line endings', () => {
  assert.equal(
    isSandboxStatusVerified(sandboxPage.replaceAll('\t', '    ').replaceAll('\n', '\r\n')),
    true,
  );
});

test('sandbox status requires the rows rather than the summary or optional protections', () => {
  assert.equal(isSandboxStatusVerified(requiredRows.join('\n')), true);
  assert.equal(
    isSandboxStatusVerified(
      sandboxPage.replace(
        'Seccomp-BPF sandbox supports TSYNC\tYes',
        'Seccomp-BPF sandbox supports TSYNC\tNo',
      ),
    ),
    true,
  );
});

for (const row of requiredRows) {
  const name = row.split('\t')[0];
  test(`sandbox status rejects missing ${name}`, () => {
    assert.equal(isSandboxStatusVerified(sandboxPage.replace(`${row}\n`, '')), false);
  });

  test(`sandbox status rejects negative ${name}`, () => {
    assert.equal(isSandboxStatusVerified(sandboxPage.replace(row, `${name}\tNo`)), false);
  });

  test(`sandbox status rejects duplicate ${name}`, () => {
    assert.equal(isSandboxStatusVerified(`${sandboxPage}\n${row}`), false);
  });

  test(`sandbox status rejects conflicting ${name} in either order`, () => {
    assert.equal(isSandboxStatusVerified(`${sandboxPage}\n${name}\tNo`), false);
    assert.equal(isSandboxStatusVerified(`${name}\tNo\n${sandboxPage}`), false);
  });

  test(`sandbox status rejects ambiguous ${name} values`, () => {
    assert.equal(isSandboxStatusVerified(sandboxPage.replace(row, `${row}\tNo`)), false);
    assert.equal(isSandboxStatusVerified(`${sandboxPage}\n${row}\tNo`), false);
  });
}

test('sandbox status rejects nonexact positive values', () => {
  assert.equal(isSandboxStatusVerified(sandboxPage.replace('Namespace', 'namespace')), false);
  assert.equal(
    isSandboxStatusVerified(sandboxPage.replace('Namespace', 'Namespace enabled')),
    false,
  );
  assert.equal(
    isSandboxStatusVerified(
      sandboxPage.replace('PID namespaces\tYes', 'PID namespaces\tYesterday'),
    ),
    false,
  );
});

test('summary and kernel seccomp evidence cannot establish Chromium sandbox status', () => {
  assert.equal(isSandboxStatusVerified(''), false);
  assert.equal(isSandboxStatusVerified('You are adequately sandboxed.'), false);
  assert.equal(isSandboxStatusVerified('Seccomp:\t2'), false);
  assert.equal(isSandboxStatusVerified('You are adequately sandboxed.\nSeccomp:\t2'), false);
  assert.equal(
    isSandboxStatusVerified(
      `${sandboxPage.replace('Seccomp-BPF sandbox\tYes', 'Seccomp-BPF sandbox\tNo')}\nSeccomp:\t2`,
    ),
    false,
  );
  assert.equal(isSandboxStatusVerified('Namespace Sandbox\tYes\nSeccomp-BPF sandbox\tYes'), false);
});
