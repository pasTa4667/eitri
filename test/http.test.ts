import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  realpath,
  rm,
  readFile,
  lstat,
  chmod,
  writeFile,
  readdir,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import { Controller } from '../src/controller.ts';
import { serve, controllerPort } from '../src/http.ts';

const port = controllerPort;
test(
  'authenticated HTTP/SSE, singleton-before-storage, idempotency and hostile input',
  { timeout: 15000 },
  async (t) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-http-test-')));
    const faux = fauxProvider({ tokensPerSecond: 100000 });
    faux.setResponses([fauxAssistantMessage('Scripted attention')]);
    const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
    const application = await serve(() =>
      Controller.open({
        directory,
        policy,
        providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
      }),
    );
    t.after(async () => {
      await application.close();
      await rm(directory, { recursive: true });
    });
    const connection = JSON.parse(await readFile(join(directory, 'connection.json'), 'utf8'));
    assert.equal((await lstat(join(directory, 'connection.json'))).mode & 0o777, 0o600);
    const base = `http://127.0.0.1:${port}`;
    const headers = {
      authorization: `Bearer ${connection.capability}`,
      'content-type': 'application/json',
    };
    assert.equal((await fetch(`${base}/v1/snapshot`)).status, 401);
    assert.equal(
      (
        await fetch(`${base}/v1/snapshot`, {
          headers: { ...headers, origin: 'https://hostile.example' },
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(`${base}/v1/events?capability=${connection.capability}`, { headers })).status,
      400,
    );
    assert.equal((await fetch(`${base}/v1/snapshot?selected=../../home`, { headers })).status, 400);
    const hostileHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        `${base}/v1/snapshot`,
        { headers: { ...headers, host: 'hostile.example' } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on('error', reject);
      request.end();
    });
    assert.equal(hostileHostStatus, 403);
    assert.equal(
      (
        await fetch(`${base}/v1/commands`, {
          method: 'POST',
          headers: { authorization: headers.authorization },
          body: '{}',
        })
      ).status,
      415,
    );
    assert.equal(
      (await fetch(`${base}/v1/commands`, { method: 'POST', headers, body: 'x'.repeat(33000) }))
        .status,
      413,
    );
    assert.equal(
      (await fetch(`${base}/v1/commands`, { method: 'POST', headers, body: '{' })).status,
      400,
    );
    let opened = false;
    await assert.rejects(
      serve(async () => {
        opened = true;
        throw new Error('Must not open');
      }),
      { code: 'EADDRINUSE' },
    );
    assert.equal(opened, false);
    const abort = new AbortController();
    const stream = await fetch(`${base}/v1/events`, { headers, signal: abort.signal });
    const reader = stream.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /^event: snapshot\ndata: /);
    const frame = JSON.parse(first.split('data: ')[1].trim());
    assert.equal(frame.protocol, 1);
    assert.equal(frame.bootId, connection.bootId);
    assert.equal(frame.snapshot.cases.length, 0);
    const input = {
      requestId: randomUUID(),
      intent: {
        type: 'investigate',
        issue: {
          ...policy,
          id: 'one',
          title: 'One',
          priority: 'high',
          status: 'unresolved',
          regressed: false,
          escalating: false,
        },
      },
    };
    const post = (body: unknown) =>
      fetch(`${base}/v1/commands`, { method: 'POST', headers, body: JSON.stringify(body) });
    const receipt = await (await post(input)).json();
    assert.deepEqual(await (await post(input)).json(), receipt);
    assert.equal((await post({ ...input, intent: { type: 'check-now' } })).status, 409);
    assert.equal(
      (
        await post({
          requestId: randomUUID(),
          expectedControlVersion: 9999,
          intent: { type: 'retry', caseId: receipt.caseId, note: 'Stale intervention' },
        })
      ).status,
      409,
    );
    let last = frame.sequence;
    for (let n = 0; n < 20; n++) {
      const chunk = new TextDecoder().decode((await reader.read()).value);
      for (const part of chunk.split('\n\n').filter((p) => p.startsWith('event: snapshot'))) {
        const update = JSON.parse(part.split('data: ')[1]);
        assert.ok(update.sequence > last);
        last = update.sequence;
        assert.equal(update.bootId, connection.bootId);
        if (update.snapshot.cases.some((c: { status: string }) => c.status === 'needs-attention')) {
          abort.abort();
          await reader.cancel().catch(() => {});
          assert.equal(faux.state.callCount, 1);
          return;
        }
      }
    }
    assert.fail('No committed completion update received');
  },
);

test(
  'authenticated strict artifact resources return verified exact bytes and honest unavailable states',
  { timeout: 15000 },
  async (t) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-http-artifact-')));
    const faux = fauxProvider({ tokensPerSecond: 100000 });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('run_check', { kind: 'browser' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('Scripted check complete'),
    ]);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
      'base64',
    );
    const text = Buffer.from('Scripted browser assertions passed.\n');
    const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
    const application = await serve(() =>
      Controller.open({
        directory,
        policy,
        providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
        check: async ({ kind }) => ({
          type: 'completed',
          check: {
            kind,
            candidate: 'a'.repeat(40),
            configuration: 'b'.repeat(64),
            simulated: true,
            passed: true,
            outputs: [
              { label: 'Screenshot', mime: 'image/png', bytes: png },
              { label: 'Assertions', mime: 'text/plain', bytes: text },
            ],
          },
        }),
      }),
    );
    t.after(async () => {
      await application.close();
      await rm(directory, { recursive: true, force: true });
    });
    const connection = JSON.parse(await readFile(join(directory, 'connection.json'), 'utf8'));
    const base = `http://127.0.0.1:${port}`;
    const headers = { authorization: `Bearer ${connection.capability}` };
    const receipt = await application.controller.command({
      requestId: randomUUID(),
      intent: {
        type: 'investigate',
        issue: {
          ...policy,
          id: 'artifact',
          title: 'Scripted screenshot',
          priority: 'high',
          status: 'unresolved',
          regressed: false,
          escalating: false,
        },
      },
    });
    const caseId = receipt.caseId!;
    const deadline = Date.now() + 4000;
    while ((await application.controller.snapshot()).cases[0].status !== 'needs-attention') {
      assert.ok(Date.now() < deadline);
      await new Promise((r) => setTimeout(r, 5));
    }
    const projection = await (
      await fetch(`${base}/v1/snapshot?selected=${caseId}&limit=1`, { headers })
    ).json();
    assert.equal(projection.selected.artifacts.length, 2);
    assert.equal(projection.selected.checks.length, 1);
    assert.equal(JSON.stringify(projection).includes('iVBOR'), false);
    assert.equal(JSON.stringify(projection).includes('"bytes"'), false);
    const image = projection.selected.artifacts.find(
      (artifact: { mime: string }) => artifact.mime === 'image/png',
    );
    const log = projection.selected.artifacts.find(
      (artifact: { mime: string }) => artifact.mime === 'text/plain',
    );
    const path = `/v1/cases/${caseId}/artifacts/${image.id}`;
    const calls = faux.state.callCount;
    for (const artifact of [image, log]) {
      const response = await fetch(`${base}/v1/cases/${caseId}/artifacts/${artifact.id}`, {
        headers,
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), artifact.mime);
      assert.equal(response.headers.get('content-length'), String(artifact.size));
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('accept-ranges'), null);
      assert.deepEqual(
        Buffer.from(await response.arrayBuffer()),
        artifact.id === image.id ? png : text,
      );
    }
    assert.equal((await fetch(`${base}${path}`)).status, 401);
    assert.equal(
      (
        await fetch(`${base}${path}`, {
          headers: { ...headers, origin: 'https://hostile.example' },
        })
      ).status,
      403,
    );
    const hostile = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        `${base}${path}`,
        { headers: { ...headers, host: 'hostile.example' } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on('error', reject);
      request.end();
    });
    assert.equal(hostile, 403);
    for (const route of [
      `${path}?selected=${caseId}`,
      `${path}?`,
      `${path}/`,
      `${path}/more`,
      path.replace(image.id, '%2e%2e'),
      path.replace(caseId, 'not-a-uuid'),
      path.replace(image.id, 'g'.repeat(36)),
      path.replace(image.id, `%${image.id.charCodeAt(0).toString(16)}${image.id.slice(1)}`),
    ])
      assert.equal((await fetch(`${base}${route}`, { headers })).status, 400, route);
    assert.equal((await fetch(`${base}${path}`, { headers, method: 'POST' })).status, 405);
    assert.equal(
      (await fetch(`${base}/v1/cases/${randomUUID()}/artifacts/${image.id}`, { headers })).status,
      404,
    );
    assert.equal(
      (await fetch(`${base}/v1/cases/${caseId}/artifacts/${randomUUID()}`, { headers })).status,
      404,
    );
    assert.equal((await readdir(join(directory, 'cases'))).length, 1);
    const blob = join(directory, 'cases', caseId, 'artifacts', image.id);
    await chmod(blob, 0o600);
    await writeFile(blob, Buffer.alloc(image.size));
    const corrupted = await fetch(`${base}${path}`, { headers });
    assert.equal(corrupted.status, 400);
    assert.deepEqual(await corrupted.json(), { error: 'artifact-integrity' });
    const c = (await application.controller.snapshot()).cases[0];
    await application.controller.command({
      requestId: randomUUID(),
      expectedControlVersion: c.version,
      intent: { type: 'dismiss', caseId, note: 'Finished' },
    });
    const terminal = (await application.controller.snapshot()).cases[0];
    await application.controller.command({
      requestId: randomUUID(),
      expectedControlVersion: terminal.version,
      intent: { type: 'details-cleanup', caseId, confirmed: true },
    });
    assert.equal((await fetch(`${base}${path}`, { headers })).status, 410);
    assert.equal(faux.state.callCount, calls);
    await assert.rejects(lstat(join(directory, 'cases', caseId)), { code: 'ENOENT' });
  },
);
