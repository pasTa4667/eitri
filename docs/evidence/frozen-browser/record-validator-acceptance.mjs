import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const checkout = await realpath(process.argv[2]);
const logPath = await realpath(process.argv[3]);
assert.ok(process.argv[4], 'supply the tested source revision explicitly');
const destination = dirname(fileURLToPath(import.meta.url));
const git = (args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim();
const sourceRevision = git(['rev-parse', '--verify', `${process.argv[4]}^{commit}`]);
const checkoutRevision = git(['rev-parse', 'HEAD']);
const sourcePaths = [
  'src',
  'worker',
  'test',
  'prototypes',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
];
git(['diff', '--exit-code', sourceRevision, 'HEAD', '--', ...sourcePaths]);
git(['diff', '--exit-code', 'HEAD', '--', ...sourcePaths]);
const log = await readFile(logPath, 'utf8');
assert.match(log, /ℹ tests 20\n/);
assert.match(log, /ℹ pass 20\n/);
assert.match(log, /ℹ fail 0\n/);
assert.match(log, /ℹ skipped 0\n/);
const names = [
  ...new Set([...log.matchAll(/Fixture state retained at (\S+) \(validator:/g)].map((m) => m[1])),
];
assert.equal(names.length, 13);
const fixtures = [];
let sample;
let png;
for (const name of names) {
  const root = await realpath(name);
  const marker = JSON.parse(await readFile(join(root, 'validator/owner.json'), 'utf8'));
  const db = new DatabaseSync(join(root, 'validator/journal.sqlite'), { readOnly: true });
  let meta;
  let runs;
  try {
    db.exec('PRAGMA trusted_schema=OFF');
    meta = JSON.parse(String(db.prepare('SELECT body FROM meta').get().body));
    runs = db
      .prepare('SELECT body FROM runs ORDER BY id')
      .all()
      .map((r) => JSON.parse(String(r.body)));
  } finally {
    db.close();
  }
  assert.equal(meta.owner, marker.owner);
  assert.equal(marker.root, join(root, 'validator'));
  assert.equal(meta.attempts, runs.length);
  assert.equal(
    runs.every((r) => r.result.kind === 'settled'),
    true,
  );
  fixtures.push({
    root,
    owner: meta.owner,
    attempts: meta.attempts,
    runs: runs.map((r) => ({
      runId: r.intent.runId,
      role: r.intent.request.role,
      result: r.result.kind,
      build: r.ledger.build,
      outcome: r.result.report.outcome,
      cleanup: r.result.report.cleanup,
    })),
  });
  if (!sample) {
    const report = runs[0].result.report;
    assert.equal(report.outcome.kind, 'baseline-reproduced');
    assert.equal(report.evidence.observations.literal, 'A');
    sample = {
      request: report.request,
      outcome: report.outcome,
      cleanup: report.cleanup,
      provenance: report.evidence.provenance,
      observations: report.evidence.observations,
      png: Object.fromEntries(
        Object.entries(report.evidence.png).filter(([key]) => key !== 'base64'),
      ),
    };
    png = Buffer.from(report.evidence.png.base64, 'base64');
  }
}
const runs = fixtures.flatMap((f) => f.runs);
assert.equal(runs.length, 39);
assert.equal(runs.filter((r) => r.build === 'unknown').length, 1);
assert.equal(runs.filter((r) => r.cleanup.kind === 'incomplete').length, 1);
const unknown = runs.find((r) => r.build === 'unknown');
assert.deepEqual(unknown.outcome, { kind: 'uncertain', code: 'daemon-build-unresolved' });
assert.equal(unknown.cleanup.code, 'daemon-build-unresolved');
const { checksum, validateOutput } = await import(
  pathToFileURL(join(checkout, 'src/artifacts.ts'))
);
assert.ok(sample);
assert.ok(png);
validateOutput({ label: 'Final actual-Docker frozen A', mime: 'image/png', bytes: png });
assert.equal(checksum(png), sample.png.sha256);
assert.equal(png.length, sample.png.size);

function docker(args) {
  const command = ['--context', 'orbstack', ...args];
  const result = spawnSync('docker', command, {
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const record = [
    `$ docker ${command.map((a) => JSON.stringify(a)).join(' ')}`,
    `exit=${result.status} signal=${result.signal ?? 'none'}`,
    `stdout:\n${result.stdout || '<empty>\n'}`,
    `stderr:\n${result.stderr || '<empty>\n'}`,
  ]
    .join('\n')
    .trimEnd();
  assert.ifError(result.error);
  assert.equal(result.status, 0, record);
  return { record, stdout: result.stdout };
}
const capturedAt = new Date().toISOString();
const containers = docker([
  'container',
  'ls',
  '--all',
  '--no-trunc',
  '--filter',
  'name=eitri-frozen',
  '--format',
  '{{.ID}} {{.Names}} {{.Status}}',
]);
const images = docker([
  'image',
  'ls',
  '--all',
  '--no-trunc',
  '--filter',
  'reference=eitri-frozen-browser:*',
  '--format',
  '{{.ID}} {{.Repository}}:{{.Tag}}',
]);
const server = docker(['version', '--format', '{{json .Server}}']);
const security = docker(['info', '--format', '{{json .SecurityOptions}}']);
const base = docker([
  'image',
  'inspect',
  'eitri-chromium-probe:1.64.1-node26.5.0',
  '--format',
  '{"Id":{{json .Id}},"Os":{{json .Os}},"Architecture":{{json .Architecture}}}',
]);
const engine = JSON.parse(server.stdout);
assert.equal(engine.Version, sample.provenance.engine.version);
assert.equal(engine.Arch, sample.provenance.engine.arch);
assert.equal(engine.GitCommit, sample.provenance.engine.commit);
assert.equal(JSON.parse(base.stdout).Id, sample.provenance.baseBefore.id);
const heading = `Captured ${capturedAt}\nCheckout ${checkoutRevision}\nTested source ${sourceRevision}\n`;
await writeFile(
  join(destination, 'validator-final-stores.json'),
  JSON.stringify({ sourceRevision, fixtures }, null, 2) + '\n',
);
await writeFile(
  join(destination, 'validator-final-observation.json'),
  JSON.stringify(sample, null, 2) + '\n',
);
await writeFile(join(destination, 'validator-final-A.png'), png);
await writeFile(
  join(destination, 'validator-final-resources.txt'),
  heading + containers.record + '\n' + images.record + '\n',
);
await writeFile(
  join(destination, 'validator-environment.txt'),
  heading +
    `Node ${process.version}\n` +
    server.record +
    '\n' +
    security.record +
    '\n' +
    base.record +
    '\n',
);
const message =
  [
    `Verified executable identity against supplied tested source ${sourceRevision}; current checkout ${checkoutRevision} differs only outside executable source.`,
    'Verified exported PNG byte integrity, literal A, 13 retained fixtures and 39 settled runs.',
    'Exactly one deliberate unknown-build case retains incomplete cleanup and ownership accounting.',
    'Current Docker engine and base image match the saved observation provenance.',
  ].join('\n') + '\n';
await writeFile(join(destination, 'validator-artifact-check.txt'), message);
process.stdout.write(message);
