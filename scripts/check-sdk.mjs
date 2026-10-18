import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const commit = '8efd314fa3d3232ce197d8d7a6a5660530b9d83e';
const inputs = [
  ['pi-durable', 'durable', 'harness/types'],
  ['pi-durable', 'durable', 'harness/generation'],
  ['pi-durable', 'durable', 'harness/compaction'],
  ['pi-durable', 'durable', 'storage/sqlite/node'],
  ['pi-ai', 'ai', 'models'],
];
const files = [];

for (const [npmName, directory, module] of inputs) {
  const packageRoot = new URL(`node_modules/@earendil-works/${npmName}/`, root);
  const metadata = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
  if (metadata.version !== '1.3.0') throw new Error(`Unexpected ${npmName} version`);
  const map = JSON.parse(await readFile(new URL(`dist/${module}.js.map`, packageRoot), 'utf8'));
  if (map.sourcesContent?.length !== 1 || typeof map.sourcesContent[0] !== 'string') {
    throw new Error(`Cannot identify the published source for ${npmName}/${module}`);
  }
  const url = `https://raw.githubusercontent.com/earendil-works/pi/${commit}/packages/${directory}/src/${module}.ts`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
  if (!response.ok) throw new Error(`Source fetch failed with HTTP ${response.status}`);
  const inspected = await response.text();
  const published = map.sourcesContent[0];
  const record = {
    package: metadata.name,
    version: metadata.version,
    module,
    url,
    identical: inspected === published,
    inspectedSha256: createHash('sha256').update(inspected).digest('hex'),
    publishedSha256: createHash('sha256').update(published).digest('hex'),
  };
  if (module === 'harness/types') {
    record.contracts = {
      replaceableModels: {
        inspected: inspected.includes('readonly models: Models | (() => Models)'),
        published: published.includes('readonly models: Models | (() => Models)'),
      },
      replaceableSettings: {
        inspected: inspected.includes('readonly settings?: HarnessSettings | (() => HarnessSettings | undefined)'),
        published: published.includes('readonly settings?: HarnessSettings | (() => HarnessSettings | undefined)'),
      },
      perModelCompaction: {
        inspected: inspected.includes('export type CompactionSettings ='),
        published: published.includes('export type CompactionSettings ='),
      },
      terminationType: {
        inspected: inspected.includes('readonly terminate?: boolean'),
        published: published.includes('readonly terminate?: boolean'),
      },
    };
  }
  files.push(record);
}

const approved = JSON.parse(await readFile(new URL('docs/evidence/sdk-approved.json', root), 'utf8'));
const reviewed = approved.commit === commit && files.every(file => approved.files.some(known =>
  known.package === file.package && known.module === file.module
  && known.inspectedSha256 === file.inspectedSha256 && known.publishedSha256 === file.publishedSha256));
const report = {
  checkedAt: new Date().toISOString(),
  inspectedCommit: commit,
  verdict: files.every(file => file.identical) ? 'source-match' : reviewed ? 'approved-differences' : 'review-required',
  scope: 'Selected SDK source and public type comparison. This does not verify runtime dispatch safety.',
  files,
};
const destination = new URL('docs/evidence/sdk-compatibility.json', root);
await mkdir(new URL('./', destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(`${report.verdict}. Evidence saved to ${fileURLToPath(destination)}.`);
for (const file of files) console.log(`${file.identical ? 'MATCH' : 'MISMATCH'} ${file.package}/${file.module}`);
if (report.verdict === 'review-required') process.exitCode = 1;
