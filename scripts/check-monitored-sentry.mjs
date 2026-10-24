import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { loadSentryToken, listSentryIssues, observeSentryIssue } from '../src/sentry.ts';

// One opt-in acceptance instrument, not production dispatch or a general deployment command.
const root = fileURLToPath(new URL('../', import.meta.url));
const revision = 'ee9e4ce173ca7eb1f9a0237af36cdc77c0e07a7b';
const projectId = '4512275993002064';
const account = 'aurumcars.1password.eu';
const scenarios = ['profile-name', 'cart-total', 'expected-validation', 'transient-upstream'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function validateDsn(value) {
  assert.ok(typeof value === 'string' && !/\s/.test(value));
  const url = new URL(value);
  assert.equal(url.protocol, 'https:');
  assert.match(url.hostname, /^o[0-9]+\.ingest(?:\.[a-z]+)?\.sentry\.io$/);
  assert.ok(url.username && !url.password && !url.port && !url.search && !url.hash);
  assert.equal(url.pathname, `/${projectId}`);
  return url;
}

export function validateEnvelope(bytes, release, scenario) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length <= 16384);
  const lines = bytes.toString('utf8').split('\n');
  assert.equal(lines.length, 3);
  const [header, item, event] = lines.map((line) => JSON.parse(line));
  assert.equal(item.type, 'event');
  assert.match(event.event_id, /^[a-f0-9]{32}$/);
  assert.equal(header.event_id, event.event_id);
  assert.ok(Object.keys(header).every((key) => ['event_id', 'sent_at', 'sdk'].includes(key)));
  assert.ok(
    Object.keys(event).every((key) =>
      [
        'event_id',
        'timestamp',
        'platform',
        'level',
        'environment',
        'release',
        'tags',
        'fingerprint',
        'exception',
        'sdk',
      ].includes(key),
    ),
  );
  assert.ok(scenarios.includes(scenario));
  assert.equal(event.release, release);
  assert.equal(event.environment, 'demo');
  assert.equal(event.platform, 'javascript');
  assert.equal(event.level, 'error');
  assert.ok(Number.isFinite(event.timestamp));
  assert.deepEqual(event.tags, { 'fixture.scenario': scenario });
  assert.deepEqual(event.fingerprint, ['eitri-fixture-v1', scenario]);
  assert.deepEqual(event.exception, {
    values: [{ type: 'Error', value: `Synthetic fixture scenario: ${scenario}` }],
  });
  return { eventId: event.event_id, scenario };
}

export async function deliverEnvelope(route, receipt, receipts) {
  const response = await route.fetch({ maxRedirects: 0, timeout: 15000 });
  try {
    assert.ok(response.status() >= 200 && response.status() < 300);
    // Retain the remote effect even when browser fulfillment fails afterward.
    receipts.push({ ...receipt, status: response.status() });
    await route.fulfill({ response });
  } finally {
    await response.dispose();
  }
}

async function serve(directory) {
  const files = new Map();
  const manifest = [];
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(html|js|css)$/.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    const relative = path.slice(directory.length + 1);
    const bytes = await readFile(path);
    assert.ok(bytes.length <= 8 * 1024 ** 2);
    files.set(`/${relative}`, bytes);
    manifest.push({ path: relative, size: bytes.length, sha256: sha256(bytes) });
  }
  assert.ok(files.has('/index.html') && manifest.length <= 128);
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    const route = [
      '/',
      '/render-error',
      '/cart-total',
      '/expected-validation',
      '/transient-upstream',
    ].includes(path)
      ? '/index.html'
      : path;
    const bytes = files.get(route);
    if (request.method !== 'GET' || !bytes) {
      response.writeHead(404).end();
      return;
    }
    response
      .writeHead(200, {
        'Content-Type': route.endsWith('.js')
          ? 'text/javascript'
          : route.endsWith('.css')
            ? 'text/css'
            : 'text/html',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .end(bytes);
  });
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    manifest,
    close: () =>
      new Promise((accept, reject) => {
        server.close((error) => (error ? reject(error) : accept()));
        server.closeAllConnections();
      }),
  };
}

async function exercise(page, origin, scenario) {
  const routes = {
    'profile-name': '/render-error',
    'cart-total': '/cart-total',
    'expected-validation': '/expected-validation',
    'transient-upstream': '/transient-upstream',
  };
  await page.goto(`${origin}${routes[scenario]}`);
  if (scenario === 'profile-name') {
    await page.getByRole('button', { name: 'Trigger render error' }).click();
    await page.getByRole('alert').waitFor();
  } else if (scenario === 'cart-total') {
    await page.getByRole('button', { name: 'Empty cart' }).click();
    await page.getByRole('alert').waitFor();
  } else if (scenario === 'expected-validation') {
    await page.getByRole('textbox', { name: 'Configuration' }).fill('invalid');
    await page.getByRole('button', { name: 'Validate configuration' }).click();
    assert.equal(await page.getByRole('alert').textContent(), 'Enter valid JSON.');
  } else {
    await page.getByRole('button', { name: 'Load order' }).click();
    assert.equal(
      await page.getByRole('alert').textContent(),
      'Order service temporarily unavailable. Try again.',
    );
  }
}

export async function confirmGroupedEvent(token, issueId, eventId, request = fetch) {
  // A second receipt must join the same issue; HTTP ingestion alone is not grouping proof.
  const url = `https://sentry.io/api/0/organizations/pasta-re/issues/${issueId}/events/${eventId}/`;
  const response = await request(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  const chunks = [];
  let size = 0;
  try {
    assert.equal(response.status, 200);
    assert.ok(response.body);
    for await (const chunk of response.body) {
      size += chunk.length;
      assert.ok(size <= 1048576);
      chunks.push(chunk);
    }
    const event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(event.eventID, eventId);
    assert.equal(event.groupID, issueId);
    assert.equal(event.projectID, projectId);
  } finally {
    await response.body?.cancel().catch(() => {});
  }
}

export async function observeDelivered(receipts) {
  assert.equal(receipts.length, 8);
  assert.equal(new Set(receipts.map((item) => item.eventId)).size, 8);
  for (const scenario of scenarios)
    for (const repeat of [0, 1]) {
      const receipt = receipts.find((item) => item.scenario === scenario && item.repeat === repeat);
      assert.ok(receipt && receipt.status === 200);
      assert.match(receipt.eventId, /^[a-f0-9]{32}$/);
    }
  const token = await loadSentryToken(account);
  // Four bounded read-only snapshots permit hosted ingestion lag, not controller polling.
  for (let attempt = 0; attempt < 4; attempt++) {
    const page = await listSentryIssues(token);
    const observations = [];
    for (const item of page.items) {
      const observation = await observeSentryIssue(token, item.issueId, {
        eventContext: 'reported-environment-release',
      });
      if (observation.event.kind !== 'available') continue;
      const receipt = receipts.find(
        (entry) => entry.repeat === 1 && entry.eventId === observation.event.eventId,
      );
      if (!receipt) continue;
      assert.deepEqual(observation.event.context, {
        environment: { kind: 'reported', value: 'demo' },
        release: { kind: 'reported', value: revision },
      });
      const earlier = receipts.find(
        (entry) => entry.repeat === 0 && entry.scenario === receipt.scenario,
      );
      await confirmGroupedEvent(token, item.issueId, earlier.eventId);
      observations.push({
        scenario: receipt.scenario,
        earlierEventId: earlier.eventId,
        observation,
      });
    }
    if (observations.length === 4) {
      assert.equal(new Set(observations.map((item) => item.scenario)).size, 4);
      return observations;
    }
    if (attempt < 3) await new Promise((accept) => setTimeout(accept, 5000));
  }
  throw new Error('Delivered events are not yet observable.');
}

async function main() {
  if (process.argv.length !== 3 || !['--validate', '--activate'].includes(process.argv[2])) {
    console.error('Usage: node scripts/check-monitored-sentry.mjs --validate|--activate');
    process.exitCode = 1;
    return;
  }
  const activate = process.argv[2] === '--activate';
  let stage = 'source';
  const result = { revision, activated: activate, validation: null, demo: null, observations: [] };
  const fixture = join(root, '.audit/hosted-monitored/fixture');
  const original = resolve(root, '../eitri-test-web-app');
  const git = (args) =>
    execFileSync('git', ['-C', fixture, ...args], { maxBuffer: 4 * 1024 ** 2, encoding: 'utf8' });
  let output;
  try {
    assert.equal(git(['rev-parse', 'HEAD']).trim(), revision);
    assert.equal(git(['status', '--porcelain']), '');
    assert.equal(git(['rev-parse', 'HEAD^']).trim(), '103db4755657e9a1595120164242a7b9323defcd');
    assert.equal(
      sha256(await readFile(join(original, 'package-lock.json'))),
      '54feec3ed89c934178637a54a07f97a3cac5b1bb997acd1b946ea1bcb861a610',
    );
    const base = join(root, '.audit/hosted-monitored');
    output = await mkdtemp(join(base, 'run-'));
    await mkdir(join(output, 'source'), { mode: 0o700 });
    const source = join(output, 'source');
    const archive = execFileSync('git', ['-C', fixture, 'archive', revision], {
      maxBuffer: 4 * 1024 ** 2,
    });
    execFileSync('tar', ['-xf', '-', '-C', source], { input: archive });
    await symlink(join(original, 'node_modules'), join(source, 'node_modules'));
    stage = 'dsn';
    const dsn = parseEnv(await readFile(join(original, '.env'), 'utf8')).VITE_SENTRY_DSN;
    const destination = validateDsn(dsn);
    const { chromium } = await import(
      pathToFileURL(join(original, 'node_modules/playwright/index.mjs')).href
    );
    for (const mode of ['validation', 'demo']) {
      stage = `${mode}-build`;
      const env = {
        NODE_ENV: 'production',
        VITE_FIXTURE_ENV: mode,
        VITE_FIXTURE_RELEASE: revision,
        VITE_SENTRY_DSN: dsn,
      };
      for (const key of ['HOME', 'PATH', 'USER', 'TMPDIR'])
        if (process.env[key]) env[key] = process.env[key];
      const directory = join(output, mode);
      execFileSync(
        process.execPath,
        [
          join(original, 'node_modules/vite/bin/vite.js'),
          'build',
          '--outDir',
          directory,
          '--emptyOutDir',
        ],
        {
          cwd: source,
          env,
          timeout: 120000,
          maxBuffer: 4 * 1024 ** 2,
          stdio: 'pipe',
        },
      );
      const server = await serve(directory);
      let browser;
      const receipts = [];
      const settled = new Set();
      const violations = [];
      const observedAssets = new Map();
      let externalRequests = 0;
      try {
        stage = `${mode}-browser`;
        browser = await chromium.launch({ headless: true, chromiumSandbox: true, env });
        for (let repeat = 0; repeat < (mode === 'demo' ? 2 : 1); repeat++) {
          for (const scenario of scenarios) {
            const context = await browser.newContext({ serviceWorkers: 'block' });
            try {
              const page = await context.newPage();
              page.setDefaultTimeout(15000);
              const pendingAssets = [];
              page.on('response', (response) => {
                pendingAssets.push(
                  (async () => {
                    try {
                      const url = new URL(response.url());
                      if (url.origin !== server.origin || response.status() !== 200) return;
                      const bytes = await response.body();
                      const path = url.pathname.startsWith('/assets/')
                        ? url.pathname.slice(1)
                        : 'index.html';
                      const asset = { path, size: bytes.length, sha256: sha256(bytes) };
                      assert.deepEqual(
                        asset,
                        server.manifest.find((item) => item.path === path),
                      );
                      observedAssets.set(path, asset);
                    } catch {
                      violations.push('asset-mismatch');
                    }
                  })(),
                );
              });
              await page.route('**/*', async (route) => {
                let requestStage = 'destination';
                try {
                  const request = route.request();
                  const url = new URL(request.url());
                  if (url.origin === server.origin) return await route.continue();
                  externalRequests++;
                  assert.equal(mode, 'demo');
                  assert.equal(url.origin, destination.origin);
                  assert.equal(url.pathname, `/api/${projectId}/envelope/`);
                  assert.equal(request.method(), 'POST');
                  requestStage = 'envelope';
                  const receipt = validateEnvelope(request.postDataBuffer(), revision, scenario);
                  assert.ok(
                    !receipts.some((item) => item.scenario === scenario && item.repeat === repeat),
                  );
                  requestStage = 'delivery';
                  // Offline validation exercises the same browser settlement without remote effects.
                  const transport = activate
                    ? route
                    : {
                        fetch: async () => ({ status: () => 200, dispose: async () => {} }),
                        fulfill: async () => route.fulfill({ status: 200, body: '{}' }),
                      };
                  await deliverEnvelope(transport, { ...receipt, repeat }, receipts);
                  settled.add(receipt.eventId);
                } catch {
                  violations.push(`request-refused-${requestStage}`);
                  await route.abort().catch(() => {});
                }
              });
              await exercise(page, server.origin, scenario);
              if (mode === 'demo') {
                const deadline = Date.now() + 20000;
                while (
                  !receipts.some(
                    (item) =>
                      item.scenario === scenario &&
                      item.repeat === repeat &&
                      settled.has(item.eventId),
                  )
                ) {
                  assert.equal(violations.length, 0);
                  assert.ok(Date.now() < deadline);
                  await new Promise((accept) => setTimeout(accept, 50));
                }
              } else await page.waitForTimeout(1200);
              if (repeat === 0)
                await page.screenshot({ path: join(output, `${mode}-${scenario}.png`) });
              await Promise.all(pendingAssets);
            } finally {
              await context.close();
            }
          }
        }
        assert.deepEqual(violations, []);
        assert.equal(externalRequests, mode === 'demo' ? 8 : 0);
        assert.ok(observedAssets.has('index.html'));
        assert.ok([...observedAssets.keys()].some((path) => path.endsWith('.js')));
      } finally {
        try {
          await browser?.close();
        } finally {
          await server.close();
          result[mode] = {
            externalRequests,
            transport: activate && mode === 'demo' ? 'hosted' : 'offline',
            receipts,
            violations,
            manifest: server.manifest,
            observedAssets: [...observedAssets.values()],
          };
        }
      }
    }
    if (activate) {
      stage = 'hosted-observation';
      result.observations = await observeDelivered(result.demo.receipts);
    }
    assert.equal(git(['rev-parse', 'HEAD']).trim(), revision);
    assert.equal(git(['status', '--porcelain']), '');
    result.verdict = 'passed';
    console.log(JSON.stringify({ verdict: 'passed', activated: activate, revision, output }));
  } catch {
    result.verdict = 'failed';
    result.failedStage = stage;
    console.error(
      `Monitored Sentry verification failed at ${stage}. No credentials or raw responses logged.`,
    );
    process.exitCode = 1;
  } finally {
    if (output)
      await writeFile(join(output, 'verification.json'), JSON.stringify(result, null, 2) + '\n', {
        mode: 0o600,
      });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
