import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { captureProfileNameFixture } from '../../src/fixture-profile-name.ts';
import { checksum, validateOutput } from '../../src/artifacts.ts';
import {
  FrozenBrowserValidator,
  frozenBrowserRequest,
  admitFrozenBrowserReport,
} from '../../src/frozen-browser.ts';
import type { FrozenBrowserReport } from '../../src/frozen-browser.ts';
import {
  WorkspaceStore,
  caseId,
  repositoryId,
  requestId,
  virtualPath,
} from '../../src/workspace.ts';

if (
  process.env.EITRI_FROZEN_DOCKER_ACCEPTANCE !== '1' ||
  !process.env.EITRI_PROFILE_NAME_FIXTURE_DIRECTORY
)
  throw new Error(
    'Profile Docker acceptance requires fresh parent review, EITRI_FROZEN_DOCKER_ACCEPTANCE=1 and an explicit EITRI_PROFILE_NAME_FIXTURE_DIRECTORY. No skips or substitutes.',
  );

const helper = virtualPath('src/lib/errors.js');
const fixed = `export function getUserDisplayName(user) {
  const name = user?.profile?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : 'Anonymous';
}`;
const expectedStrings = [
  'Anonymous',
  'Ada Lovelace',
  'gRaCe Hopper',
  'Anonymous',
  'Anonymous',
  'Anonymous',
  'Anonymous',
  'Anonymous',
  'Anonymous',
];
const signal = () => new AbortController().signal;
async function docker(args: string[]) {
  const child = spawn('docker', ['--context', 'orbstack', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [],
    stderr: Buffer[] = [];
  child.stdout.on('data', (b: Buffer) => stdout.push(b));
  child.stderr.on('data', (b: Buffer) => stderr.push(b));
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  try {
    const [code] = await once(child, 'close');
    assert.equal(code, 0, Buffer.concat(stderr).toString());
    return Buffer.concat(stdout).toString();
  } finally {
    clearTimeout(timer);
  }
}
async function fixture(t: TestContext) {
  const captured = await captureProfileNameFixture(
    process.env.EITRI_PROFILE_NAME_FIXTURE_DIRECTORY!,
  );
  assert.equal(captured.source.size, 534);
  assert.equal(
    captured.source.sha256,
    'cd69431e5b7fda7ec116377d033d192a7b214a9c42a8101bd8c809c862af80f4',
  );
  assert.equal(
    captured.captureDigest,
    '709e1a12ba7bfd02a33adb2d12b9f13c2cf5c831b1c224943b10bee111b65fe0',
  );
  const root = await realpath(await mkdtemp(join(tmpdir(), 'eitri-profile-docker-')));
  console.log(`Profile forensic root retained at ${root}`);
  const directory = join(root, 'validator'),
    workspaceDirectory = join(root, 'workspace');
  await mkdir(directory, { mode: 0o700 });
  await mkdir(workspaceDirectory, { mode: 0o700 });
  const store = await WorkspaceStore.open({
    directory: workspaceDirectory,
    regressionDirectory: virtualPath('test/regression'),
  });
  t.after(() => store.close());
  const cid = caseId(randomUUID());
  const workspace = await store.provision({
    caseId: cid,
    repositoryId: repositoryId(randomUUID()),
    baseline: [
      { virtualPath: captured.source.virtualPath, bytes: captured.source.bytes },
      {
        virtualPath: virtualPath('src/index.html'),
        bytes: Buffer.from('<script>throw Error("snapshot HTML executed")</script>'),
      },
      {
        virtualPath: virtualPath('__eitri_profile.mjs'),
        bytes: Buffer.from('throw Error("snapshot wrapper executed")'),
      },
      {
        virtualPath: virtualPath('__eitri_profile.html'),
        bytes: Buffer.from('<script>throw Error("snapshot probe HTML executed")</script>'),
      },
    ],
  });
  if (workspace.state !== 'ready') throw Error('workspace-not-ready');
  const frozen = await store.freeze(cid, workspace.checkpoint.revision);
  let validator = await FrozenBrowserValidator.open({ workspace: store, directory });
  await validator.close();
  const history = await FrozenBrowserValidator.open({
    workspace: store,
    directory,
    mode: 'journal-only',
  });
  const inventory = await history.inventory();
  await history.close();
  const identity = {
    ownerId: inventory.ownerId,
    configurationDigest: inventory.configurationDigest,
  };
  validator = await FrozenBrowserValidator.open({
    workspace: store,
    directory,
    expectedIdentity: identity,
  });
  t.after(() => validator.close());
  const request = frozenBrowserRequest({
    frozen,
    action: { caseId: cid, actionId: randomUUID(), epoch: 0 },
    scenarioId: 'profile-name-v1',
    role: 'baseline',
    allowanceMs: 60000,
  });
  async function currentResources() {
    for (const kind of ['container', 'image'])
      assert.equal(
        await docker([
          kind,
          'ls',
          '--all',
          '--no-trunc',
          '--quiet',
          '--filter',
          `label=eitri.frozen-browser.owner=${identity.ownerId}`,
        ]),
        '',
        `${kind} currently owned, forensic root ${root}`,
      );
  }
  async function run(
    bytes: string | null,
    expected: FrozenBrowserReport['outcome']['kind'],
    role: 'baseline' | 'candidate' = 'candidate',
  ) {
    let selected = frozen;
    if (bytes !== null) {
      const before = await store.read(cid, helper);
      const current = await store.inspect(cid);
      if (current.state !== 'ready') throw Error('workspace-not-ready');
      const edit = await store.edit(cid, current.checkpoint.revision, {
        requestId: requestId(randomUUID()),
        virtualPath: helper,
        expectedHash: before.sha256,
        bytes: Buffer.from(bytes),
      });
      selected = await store.freeze(cid, edit.checkpoint.revision);
    }
    const admittedRequest = frozenBrowserRequest({
      ...request,
      frozen: selected,
      role,
      action: { ...request.action, actionId: randomUUID() },
    });
    const report = await validator.validate(admittedRequest, signal());
    assert.equal(report.outcome.kind, expected, JSON.stringify(report));
    assert.deepEqual(report.cleanup, { kind: 'owned-removed', cache: 'retained' });
    assert.ok(report.evidence);
    const evidence = report.evidence;
    assert.deepEqual(evidence.provenance.frozen, selected);
    assert.equal(evidence.observations.scenarioId, 'profile-name-v1');
    assert.equal(Object.hasOwn(evidence.observations, 'literal'), false);
    const transfer = evidence.provenance.transfer.find((entry) => entry.path === helper);
    assert.equal(
      transfer?.sha256,
      bytes === null ? captured.source.sha256 : checksum(Buffer.from(bytes)),
    );
    assert.equal(transfer?.size, bytes === null ? 534 : Buffer.byteLength(bytes));
    const png = validateOutput({
      label: 'Profile screenshot',
      mime: 'image/png',
      bytes: Buffer.from(evidence.png.base64, 'base64'),
    });
    assert.equal(checksum(png), evidence.png.sha256);
    assert.equal(png.length, evidence.png.size);
    const admission = admitFrozenBrowserReport(
      role === 'baseline'
        ? {
            kind: 'baseline',
            request: { ...admittedRequest, role },
            configurationDigest: identity.configurationDigest,
          }
        : {
            kind: 'browser',
            request: { ...admittedRequest, role },
            configurationDigest: identity.configurationDigest,
          },
      report,
    );
    assert.equal(admission.type, expected === 'unrelated-failure' ? 'blocked' : 'behavioral');
    await currentResources();
    return report;
  }
  return { captured, store, validator, directory, identity, frozen, run, currentResources };
}

test(
  'actual profile helper baseline, managed fix, exact vector, PNG, cleanup and reopen',
  { timeout: 900000 },
  async (t) => {
    const f = await fixture(t);
    const originalFrozen = await f.store.readFrozen(f.frozen, signal());
    const candidate = await f.run(fixed, 'candidate-passed');
    const baseline = await f.run(null, 'baseline-reproduced', 'baseline');
    const vector = (
      candidate.evidence!.observations.profile as { actuals: { kind: string; value: string }[] }
    ).actuals;
    assert.deepEqual(
      vector.map((actual) => actual.kind),
      Array(9).fill('returned'),
    );
    assert.deepEqual(
      vector.map((actual) => actual.value),
      expectedStrings,
    );
    const p = baseline.evidence!.observations.profile as {
      actuals: { caseId: string; kind: string; value?: string }[];
      diagnostic: unknown;
    };
    assert.deepEqual(p.actuals, [
      { caseId: 'missing-profile', kind: 'threw' },
      { caseId: 'trimmed-name', kind: 'returned', value: 'Ada Lovelace' },
      { caseId: 'second-name', kind: 'returned', value: 'gRaCe Hopper' },
      { caseId: 'blank-name', kind: 'returned', value: 'Anonymous' },
      { caseId: 'missing-name', kind: 'returned', value: 'Anonymous' },
      { caseId: 'null-name', kind: 'returned', value: 'Anonymous' },
      ...['null-profile', 'null-user', 'undefined-user'].map((caseId) => ({
        caseId,
        kind: 'threw',
      })),
    ]);
    assert.deepEqual(p.diagnostic, {
      caseId: 'missing-profile',
      nativeTypeError: true,
      name: 'TypeError',
      message: "Cannot read properties of undefined (reading 'name')",
      firstFrame: 'at getUserDisplayName (/src/lib/errors.js:5:23)',
    });
    for (const [source, outcome] of [
      [fixed.replace('name.trim() :', 'name.trim().toUpperCase() :'), 'candidate-failed'],
      ['export function getUserDisplayName() { return "Anonymous"; }', 'candidate-failed'],
      [
        'export function getUserDisplayName(user) { return user?.profile ? user.profile.name : "Anonymous"; }',
        'candidate-failed',
      ],
      ['export function getUserDisplayName(', 'unrelated-failure'],
      ['export function other() {}', 'unrelated-failure'],
      ['export function getUserDisplayName() { throw Error("arbitrary"); }', 'candidate-failed'],
      [fixed, 'unrelated-failure'],
    ] as const)
      await f.run(
        source,
        outcome,
        outcome === 'unrelated-failure' && source === fixed ? 'baseline' : 'candidate',
      );
    assert.deepEqual(await f.store.readFrozen(f.frozen, signal()), originalFrozen);
    await f.validator.close();
    const journal = await FrozenBrowserValidator.open({
      workspace: f.store,
      directory: f.directory,
      mode: 'journal-only',
      expectedIdentity: f.identity,
    });
    const inventory = await journal.inventory();
    assert.equal(inventory.runs.length, 9);
    assert.equal(
      inventory.runs.every((run) => run.request.scenarioId === 'profile-name-v1'),
      true,
    );
    await journal.close();
    const reopened = await FrozenBrowserValidator.open({
      workspace: f.store,
      directory: f.directory,
      mode: 'journal-only',
      expectedIdentity: f.identity,
    });
    try {
      assert.deepEqual(await reopened.inventory(), inventory);
    } finally {
      await reopened.close();
    }
    await f.currentResources();
    const after = await captureProfileNameFixture(
      process.env.EITRI_PROFILE_NAME_FIXTURE_DIRECTORY!,
    );
    assert.deepEqual(after, f.captured);
  },
);

test(
  'actual profile invocation rejects a trailing high surrogate without reading a prototype getter',
  { timeout: 900000 },
  async (t) => {
    const f = await fixture(t);
    const report = await f.run(
      String.raw`Object.defineProperty(String.prototype, '1', {
      get() { console.error('surrogate getter read'); return '\udc00'; }
    });
    export function getUserDisplayName() { return '\ud800'; }`,
      'candidate-failed',
    );
    const profile = report.evidence!.observations.profile as { actuals: { kind: string }[] };
    assert.deepEqual(
      profile.actuals.map((actual) => actual.kind),
      [
        'invalid-return',
        'invalid-return',
        'invalid-return',
        'invalid-return',
        'invalid-return',
        'invalid-return',
        'invalid-return',
        'invalid-return',
        'invalid-return',
      ],
    );
    assert.deepEqual(report.evidence!.observations.events, []);
  },
);

test(
  'actual profile protocol rejects substitution, serialization, poisoned intrinsics and DOM authority',
  { timeout: 900000 },
  async (t) => {
    const f = await fixture(t);
    const cases = [
      [
        'export function getUserDisplayName() { return "wrong"; } export function then(resolve) { resolve({probe:()=>"Anonymous"}); }',
        'candidate-failed',
      ],
      [
        fixed + '\nexport function then() { throw Error("exported then invoked"); }',
        'candidate-passed',
      ],
      [
        'export function getUserDisplayName() { return { get then() { console.error("then getter read"); throw Error("serialized"); } }; }',
        'candidate-failed',
      ],
      [
        'Function.prototype.call = () => "Anonymous"; Reflect.apply = () => "Anonymous"; JSON.stringify = () => "forged"; export function getUserDisplayName() { return "Anonymous"; }',
        'candidate-failed',
      ],
      [
        'export function getUserDisplayName() { throw { get name() { console.error("name getter read"); }, get message() { console.error("message getter read"); }, get stack() { console.error("stack getter read"); } }; }',
        'candidate-failed',
      ],
      [
        'document.body.innerHTML = \'<output id="result">B</output>\'; export function getUserDisplayName() { return "B"; }',
        'candidate-failed',
      ],
      [
        'export function getUserDisplayName() { location.href="/src/index.html"; return "Anonymous"; }',
        'unrelated-failure',
      ],
    ] as const;
    for (const [source, outcome] of cases) {
      const report = await f.run(source, outcome);
      if (outcome !== 'unrelated-failure')
        assert.deepEqual(report.evidence!.observations.events, []);
      assert.equal(
        JSON.stringify(report.evidence!.observations.events).includes('getter read'),
        false,
      );
    }
  },
);
