import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { Controller } from '../src/controller.ts';
import { serve, controllerPort } from '../src/http.ts';

const port = controllerPort;
test('authenticated HTTP/SSE, singleton-before-storage, idempotency and hostile input', { timeout: 15000 }, async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-http-test-')));
  const faux = fauxProvider({ tokensPerSecond: 100000 }); faux.setResponses([fauxAssistantMessage('Scripted attention')]);
  const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
  const application = await serve(() => Controller.open({ directory, policy, providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }) }));
  t.after(async () => { await application.close(); await rm(directory, { recursive: true }); });
  const connection = JSON.parse(await readFile(join(directory, 'connection.json'), 'utf8'));
  assert.equal((await lstat(join(directory, 'connection.json'))).mode & 0o777, 0o600);
  const base = `http://127.0.0.1:${port}`;
  const headers = { authorization: `Bearer ${connection.capability}`, 'content-type': 'application/json' };
  assert.equal((await fetch(`${base}/v1/snapshot`)).status, 401);
  assert.equal((await fetch(`${base}/v1/snapshot`, { headers: { ...headers, origin: 'https://hostile.example' } })).status, 403);
  assert.equal((await fetch(`${base}/v1/events?capability=${connection.capability}`, { headers })).status, 400);
  assert.equal((await fetch(`${base}/v1/snapshot?selected=../../home`, { headers })).status, 400);
  const hostileHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(`${base}/v1/snapshot`, { headers: { ...headers, host: 'hostile.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal((await fetch(`${base}/v1/commands`, { method: 'POST', headers: { authorization: headers.authorization }, body: '{}' })).status, 415);
  assert.equal((await fetch(`${base}/v1/commands`, { method: 'POST', headers, body: 'x'.repeat(33000) })).status, 413);
  assert.equal((await fetch(`${base}/v1/commands`, { method: 'POST', headers, body: '{' })).status, 400);
  let opened = false;
  await assert.rejects(serve(async () => { opened = true; throw new Error('Must not open'); }), { code: 'EADDRINUSE' });
  assert.equal(opened, false);
  const abort = new AbortController();
  const stream = await fetch(`${base}/v1/events`, { headers, signal: abort.signal });
  const reader = stream.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /^event: snapshot\ndata: /);
  const frame = JSON.parse(first.split('data: ')[1].trim());
  assert.equal(frame.protocol, 1); assert.equal(frame.bootId, connection.bootId); assert.equal(frame.snapshot.cases.length, 0);
  const input = { requestId: randomUUID(), intent: { type: 'investigate', issue: { ...policy, id: 'one', title: 'One', priority: 'high', status: 'unresolved', regressed: false, escalating: false } } };
  const post = (body: unknown) => fetch(`${base}/v1/commands`, { method: 'POST', headers, body: JSON.stringify(body) });
  const receipt = await (await post(input)).json();
  assert.deepEqual(await (await post(input)).json(), receipt);
  assert.equal((await post({ ...input, intent: { type: 'check-now' } })).status, 409);
  assert.equal((await post({ requestId: randomUUID(), expectedControlVersion: 9999, intent: { type: 'retry', caseId: receipt.caseId, note: 'Stale intervention' } })).status, 409);
  let last = frame.sequence;
  for (let n = 0; n < 20; n++) {
    const chunk = new TextDecoder().decode((await reader.read()).value);
    for (const part of chunk.split('\n\n').filter(p => p.startsWith('event: snapshot'))) {
      const update = JSON.parse(part.split('data: ')[1]); assert.ok(update.sequence > last); last = update.sequence;
      assert.equal(update.bootId, connection.bootId);
      if (update.snapshot.cases.some((c: { status: string }) => c.status === 'needs-attention')) { abort.abort(); await reader.cancel().catch(() => {}); assert.equal(faux.state.callCount, 1); return; }
    }
  }
  assert.fail('No committed completion update received');
});
