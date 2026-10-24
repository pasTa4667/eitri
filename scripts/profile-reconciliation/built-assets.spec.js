import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('built assets serve the rendered application', async ({ page, baseURL }) => {
  test.setTimeout(25000);
  const stat = await lstat('/tmp/built-manifest.json');
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  assert.ok(stat.size > 0 && stat.size <= 64 * 1024);
  const bytes = await readFile('/tmp/built-manifest.json');
  assert.equal(bytes.length, stat.size);
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.version, 1);
  assert.ok(Array.isArray(manifest.files) && manifest.files.length <= 128);
  assert.equal(manifest.digest, sha256(JSON.stringify(manifest.files)));
  const files = new Map();
  let manifestSize = 0;
  for (const file of manifest.files) {
    assert.match(file.path, /^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/);
    assert.ok(!files.has(file.path));
    assert.ok(Number.isSafeInteger(file.size) && file.size > 0 && file.size <= 8 * 1024 ** 2);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    manifestSize += file.size;
    assert.ok(manifestSize <= 32 * 1024 ** 2);
    files.set(file.path, file);
  }
  assert.equal(baseURL, 'http://127.0.0.1:4173');
  const observed = [];
  const pending = [];
  let failure;
  let requests = 0;
  let responses = 0;
  let total = 0;
  const checkURL = (value) => {
    const url = new URL(value);
    assert.equal(url.origin, baseURL, 'Unexpected application origin');
    assert.doesNotMatch(
      decodeURIComponent(url.pathname),
      /^\/(?:src|@vite|@react-refresh|@fs|@id|node_modules)(?:\/|$)/,
      'Source or development traffic rejected',
    );
    return url;
  };
  const onRequest = (request) => {
    try {
      assert.ok(++requests <= 256, 'Browser request count exceeded');
      checkURL(request.url());
    } catch (error) {
      failure ??= error;
    }
  };
  const onResponse = (response) => {
    if (++responses > 128) {
      failure ??= new Error('Browser response count exceeded');
      return;
    }
    const collect = async () => {
      const url = checkURL(response.url());
      const request = response.request();
      const contentType = (await response.headerValue('content-type')) ?? '';
      const resourceType = request.resourceType();
      const kind =
        resourceType === 'document'
          ? 'document'
          : resourceType === 'script' || /(?:java|ecma)script/i.test(contentType)
            ? 'javascript'
            : resourceType === 'stylesheet' || /text\/css/i.test(contentType)
              ? 'stylesheet'
              : undefined;
      if (!kind) return;
      assert.equal(response.status(), 200);
      assert.equal(response.fromServiceWorker(), false);
      assert.match(
        contentType,
        kind === 'document'
          ? /^text\/html\b/i
          : kind === 'javascript'
            ? /^(?:text|application)\/(?:java|ecma)script\b/i
            : /^text\/css\b/i,
        'Unexpected executable/style content type',
      );
      let path = decodeURIComponent(url.pathname).slice(1);
      if (kind === 'document') {
        assert.equal(request.frame(), page.mainFrame());
        assert.equal(url.pathname, '/render-error');
        path = 'index.html';
      }
      const file = files.get(path);
      assert.ok(file, `Response absent from fresh build: ${path}`);
      const length = await response.headerValue('content-length');
      if (length !== null) {
        assert.match(length, /^\d+$/);
        assert.ok(Number(length) <= 8 * 1024 ** 2, 'Response body size exceeded');
      }
      const body = await response.body();
      assert.ok(body.length <= 8 * 1024 ** 2, 'Response body size exceeded');
      total += body.length;
      assert.ok(total <= 32 * 1024 ** 2, 'Response aggregate size exceeded');
      assert.equal(body.length, file.size, `Built response size: ${path}`);
      const hash = sha256(body);
      assert.equal(hash, file.sha256, `Built response SHA-256: ${path}`);
      observed.push({ path, status: 200, size: body.length, sha256: hash, kind });
    };
    pending.push(
      collect().catch((error) => {
        failure ??= error;
      }),
    );
  };
  const onPageError = (error) => {
    failure ??= error;
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('pageerror', onPageError);
  let deadline;
  try {
    await Promise.race([
      (async () => {
        const navigation = await page.goto('/render-error', {
          waitUntil: 'networkidle',
          timeout: 15000,
        });
        assert.equal(navigation.status(), 200);
        await expect(page.getByTestId('badge')).toHaveText('Hello, ada', { timeout: 10000 });
        const scripts = await page
          .locator('script[type="module"][src]')
          .evaluateAll((nodes) => nodes.map((node) => node.src));
        await Promise.all(pending);
        if (failure) throw failure;
        assert.equal(observed.filter((response) => response.kind === 'document').length, 1);
        assert.ok(scripts.length > 0 && scripts.length <= 128, 'Compiled module entry required');
        for (const script of scripts) {
          const url = checkURL(script);
          assert.match(url.pathname, /^\/assets\/.+\.js$/);
          assert.ok(
            observed.some(
              (response) =>
                response.kind === 'javascript' &&
                response.path === decodeURIComponent(url.pathname).slice(1),
            ),
            'Compiled entry response required',
          );
        }
      })(),
      new Promise((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error('Built response observation deadline exceeded')),
          20000,
        );
      }),
    ]);
  } finally {
    clearTimeout(deadline);
    page.off('request', onRequest);
    page.off('response', onResponse);
    page.off('pageerror', onPageError);
  }
  if (process.env.EITRI_APPLICATION_SCREENSHOT === '1')
    await page.screenshot({ path: '/tmp/application.png', type: 'png', timeout: 5000 });
  const proof = JSON.stringify({
    version: 1,
    server: 'vite-preview',
    origin: baseURL,
    manifestDigest: manifest.digest,
    observed,
    proofPassed: true,
  });
  assert.ok(Buffer.byteLength(proof) <= 64 * 1024, 'Built proof size exceeded');
  await writeFile('/tmp/built-proof.json', proof, { flag: 'wx' });
});
