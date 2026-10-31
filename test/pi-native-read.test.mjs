import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtemp,
  realpath,
  rm,
  mkdir,
  writeFile,
  readFile,
  readdir,
  lstat,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  runNativeLiveReadProbe,
  nativeLiveReadResult,
  runNativeLiveProbe,
} from '../prototypes/pi-native-live.mjs';
import {
  captureNativeReadFixture,
  validateNativeReadResult,
} from '../prototypes/pi-native-read.mjs';
import { streamNativeLiveProbe } from '../prototypes/pi-native-stream.mjs';
import { syntheticProfile } from './helpers/pi-profile.mjs';

const source = "export const displayName = (name) => name?.trim() || 'Anonymous'; // Ω\n";
async function fixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-native-read-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixtureDirectory = join(directory, 'fixture');
  await mkdir(join(fixtureDirectory, 'src/lib'), { recursive: true });
  const path = join(fixtureDirectory, 'src/lib/errors.js');
  await writeFile(path, source);
  const runDirectory = join(directory, 'run');
  await mkdir(runDirectory, { mode: 0o700 });
  return { fixtureDirectory, path, runDirectory };
}
async function profile(t) {
  const p = await syntheticProfile(t);
  const payload = Buffer.from(
    JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account' },
    }),
  ).toString('base64url');
  await writeFile(
    p.authPath,
    JSON.stringify({
      'openai-codex': {
        type: 'oauth',
        access: `synthetic.${payload}.signature`,
        refresh: 'private-refresh',
        expires: Date.now() + 3_600_000,
        accountId: 'synthetic-account',
      },
    }),
  );
  return p;
}

test('fixed capture returns detached UTF-8 source and verifies its exact digest without executing it', async (t) => {
  const f = await fixture(t);
  const result = await captureNativeReadFixture(f.fixtureDirectory);
  assert.deepEqual(JSON.parse(result), {
    path: 'src/lib/errors.js',
    sha256: createHash('sha256').update(source).digest('hex'),
    content: source,
  });
  assert.equal(validateNativeReadResult(result), JSON.parse(result).sha256);
  await writeFile(f.path, 'changed');
  assert.equal(JSON.parse(result).content, source);
});
for (const kind of ['missing', 'symlink', 'oversized', 'invalid-utf8', 'empty'])
  test(`fixed capture refuses ${kind} source`, async (t) => {
    const f = await fixture(t);
    if (kind === 'missing') await rm(f.path);
    if (kind === 'symlink') {
      await rm(f.path);
      await symlink('/etc/hosts', f.path);
    }
    if (kind === 'oversized') await writeFile(f.path, 'x'.repeat(4097));
    if (kind === 'invalid-utf8') await writeFile(f.path, Buffer.from([0xff]));
    if (kind === 'empty') await writeFile(f.path, '');
    await assert.rejects(captureNativeReadFixture(f.fixtureDirectory));
  });
test('read result validator refuses forged hashes, paths, extra fields and oversized content', async (t) => {
  const f = await fixture(t);
  const value = JSON.parse(await captureNativeReadFixture(f.fixtureDirectory));
  for (const changed of [
    { ...value, sha256: '0'.repeat(64) },
    { ...value, path: '../auth.json' },
    { ...value, extra: 'private' },
    { ...value, content: 'x'.repeat(4097) },
    { ...value, content: '\ud800' },
  ])
    assert.throws(() => validateNativeReadResult(JSON.stringify(changed)));
});
for (const scenario of ['read-success', 'bad-tool', 'bad-arguments', 'bad-result'])
  test(
    `native read ${scenario} uses admitted read-only source and disposes helpers before returning`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t),
        p = await profile(t);
      const progress = [],
        helpers = [],
        requests = [];
      const preload = new URL(
        `./fixtures/pi-tool-preload.mjs?native=1&scenario=${scenario}`,
        import.meta.url,
      );
      const options = {
        directory: f.runDirectory,
        fixtureDirectory: f.fixtureDirectory,
        onProgress: (v) => progress.push(v),
        onSpawn: (v) => helpers.push(v),
        stream: (request, options) => {
          requests.push(request);
          return streamNativeLiveProbe(request, { ...options, profileHome: p.home, preload });
        },
      };
      if (scenario === 'read-success') {
        assert.deepEqual(await runNativeLiveReadProbe(options), nativeLiveReadResult);
        assert.deepEqual(progress, ['model', 'tool', 'model']);
        assert.deepEqual(await readdir(f.runDirectory), []);
        const result = requests[1].context.messages.find((m) => m.role === 'toolResult');
        assert.equal(result.toolName, 'read_fixture');
        assert.equal(JSON.parse(result.content[0].text).content, source);
        assert.ok(!JSON.stringify(requests[0]).includes(source));
        assert.deepEqual(await readdir(p.profile), ['auth.json']);
      } else {
        await assert.rejects(runNativeLiveReadProbe(options));
        assert.deepEqual(
          progress,
          scenario === 'bad-result' ? ['model', 'tool', 'model'] : ['model'],
        );
        assert.ok((await readdir(f.runDirectory)).includes('native'));
        assert.ok((await readdir(p.profile)).includes('eitri-use'));
      }
      assert.equal(await readFile(f.path, 'utf8'), source);
      for (const helper of helpers) {
        assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
        await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
      }
    },
  );
test(
  'ordinary native probe does not register a fixture reader without trusted configuration',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t),
      p = await profile(t);
    const preload = new URL(
      './fixtures/pi-tool-preload.mjs?native=1&scenario=success',
      import.meta.url,
    );
    let requests = 0;
    await runNativeLiveProbe({
      directory: f.runDirectory,
      stream: (request, options) => {
        requests++;
        assert.ok(
          !request.context.messages
            .flatMap((m) => m.toolsAdded ?? [])
            .some((tool) => tool.name === 'read_fixture'),
        );
        return streamNativeLiveProbe(request, { ...options, profileHome: p.home, preload });
      },
    });
    assert.equal(requests, 2);
  },
);

test(
  'native read capture failure retains the case without a second inference or source effects',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t),
      p = await profile(t);
    await rm(f.path);
    const progress = [],
      helpers = [];
    const preload = new URL(
      './fixtures/pi-tool-preload.mjs?native=1&scenario=read-success',
      import.meta.url,
    );
    await assert.rejects(
      runNativeLiveReadProbe({
        directory: f.runDirectory,
        fixtureDirectory: f.fixtureDirectory,
        onProgress: (v) => progress.push(v),
        onSpawn: (v) => helpers.push(v),
        stream: (request, options) =>
          streamNativeLiveProbe(request, { ...options, profileHome: p.home, preload }),
      }),
    );
    assert.deepEqual(progress, ['model']);
    assert.equal(helpers.length, 1);
    assert.ok((await readdir(f.runDirectory)).includes('native'));
    await assert.rejects(lstat(f.path), { code: 'ENOENT' });
    assert.throws(() => process.kill(helpers[0].pid, 0), { code: 'ESRCH' });
    await assert.rejects(lstat(helpers[0].home), { code: 'ENOENT' });
  },
);

test(
  'native read cancellation during the model stream cannot execute the read tool or redispatch',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t),
      p = await profile(t);
    const control = new AbortController(),
      progress = [],
      helpers = [];
    const preload = new URL(
      './fixtures/pi-tool-preload.mjs?native=1&scenario=paced-toolcall',
      import.meta.url,
    );
    await assert.rejects(
      runNativeLiveReadProbe({
        directory: f.runDirectory,
        fixtureDirectory: f.fixtureDirectory,
        signal: control.signal,
        onProgress: (v) => progress.push(v),
        onSpawn: (v) => helpers.push(v),
        stream: (request, options) =>
          streamNativeLiveProbe(request, {
            ...options,
            profileHome: p.home,
            preload,
            onEvent: (event) => {
              options.onEvent?.(event);
              if (event.type === 'toolcall_start') control.abort();
            },
          }),
      }),
    );
    assert.deepEqual(progress, ['model']);
    assert.equal(helpers.length, 1);
    assert.equal(await readFile(f.path, 'utf8'), source);
    assert.throws(() => process.kill(helpers[0].pid, 0), { code: 'ESRCH' });
    await assert.rejects(lstat(helpers[0].home), { code: 'ENOENT' });
    assert.ok((await readdir(p.profile)).includes('eitri-use'));
  },
);

for (const args of [['--native-read'], ['--native-read', '--help']])
  test(`native read ${args.join(' ')} stays effect-free without opt-in`, () => {
    const result = spawnSync(process.execPath, ['scripts/test-pi-tool.mjs', ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
      timeout: 10000,
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage: npm run test:pi-native-read/);
    assert.doesNotMatch(result.stdout, /native-read-pass/);
  });
for (const scenario of ['launcher', 'launcher-private', 'launcher-diagnostic-success'])
  test(`native read launcher ${scenario} enforces finite output and clean environment`, () => {
    const preload = new URL(`./fixtures/pi-tool-preload.mjs?scenario=${scenario}`, import.meta.url);
    const result = spawnSync(
      process.execPath,
      ['--import', preload.href, 'scripts/test-pi-tool.mjs', '--native-read', '--run'],
      {
        encoding: 'utf8',
        timeout: 15000,
        stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH, OPENAI_API_KEY: 'private-ambient' },
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, scenario === 'launcher' ? 0 : 1);
    assert.doesNotMatch(result.stdout + result.stderr, /private-|export const|src\/lib/);
    assert.deepEqual(
      JSON.parse(result.stdout),
      scenario === 'launcher'
        ? nativeLiveReadResult
        : {
            scope: 'dedicated-pi-native-read',
            verdict: 'sign-in-required',
          },
    );
  });
