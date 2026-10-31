import assert from 'node:assert/strict';
import test from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, realpath, rm, readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { syntheticProfile } from './helpers/pi-profile.mjs';
import { nativeFixtureProvider, openNativeFixtureController } from './helpers/pi-native.mjs';
import { withDedicatedProfile } from '../prototypes/pi-profile.mjs';

const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
async function parked(controller, id) {
  const deadline = performance.now() + 8000;
  while (performance.now() < deadline) {
    const view = (await controller.snapshot({ selected: id })).selected;
    if (['paused', 'needs-attention'].includes(view.case.status)) return view;
    await delay(10);
  }
  assert.fail('Codex crash recovery did not park');
}

for (const boundary of ['refresh-response', 'provider-request'])
  for (const pause of [false, true])
    test(
      `Codex file parent SIGKILL at ${boundary}, pause=${pause}, reconciles orphan before refusing auth`,
      { timeout: 25000 },
      async (t) => {
        const profile = await syntheticProfile(t);
        await writeFile(
          profile.authPath,
          JSON.stringify({
            'openai-codex': {
              type: 'oauth',
              access: 'synthetic-expired',
              refresh: 'synthetic-refresh',
              expires: 0,
              accountId: 'synthetic-private-account',
            },
          }),
        );
        const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-codex-crash-')));
        const child = fork(
          new URL('./helpers/pi-native-crash.mjs', import.meta.url),
          [directory, `codex-${boundary}${pause ? '-paused' : ''}`, profile.home],
          {
            env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR },
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          },
        );
        let controller, helper, opening;
        t.after(async () => {
          const exited =
            child.exitCode === null && child.signalCode === null ? once(child, 'exit') : null;
          child.kill('SIGKILL');
          if (exited) await exited;
          if (helper) {
            try {
              process.kill(helper.pid, 'SIGKILL');
            } catch {}
          }
          await opening?.catch(() => {});
          await controller?.close();
          await rm(directory, { recursive: true, force: true });
        });
        const [message] = await Promise.race([
          once(child, 'message', { signal: AbortSignal.timeout(8000) }),
          once(child, 'exit').then(() =>
            assert.fail('Codex fixture exited before refresh checkpoint'),
          ),
        ]);
        helper = message.helper;
        assert.equal(message.stage, 'admitted');
        assert.equal(message.checkpoint, boundary);
        const resourceRoot = join(directory, 'pi-offline-resources');
        const [resource] = await readdir(resourceRoot);
        const ownerPath = join(resourceRoot, resource, 'owner.json');
        const ownerBytes = await readFile(ownerPath);
        assert.deepEqual(JSON.parse(ownerBytes), {
          version: 1,
          caseId: message.id,
          actionId: message.admission.actionId,
          epoch: message.admission.epoch,
          controllerPid: child.pid,
          pid: helper.pid,
        });
        assert.deepEqual(await readdir(helper.home), []);
        const authBytes = await readFile(profile.authPath);
        assert.equal(
          JSON.parse(authBytes)['openai-codex'].refresh,
          boundary === 'refresh-response' ? 'synthetic-refresh' : 'synthetic-rotated',
        );
        const lease = join(profile.profile, 'eitri-use');
        const leaseBytes = await readFile(join(lease, 'owner.json'));
        assert.equal(JSON.parse(leaseBytes).pid, child.pid);
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        assert.deepEqual(await exited, [null, 'SIGKILL']);
        process.kill(helper.pid, 0);

        const requests = [],
          spawned = [],
          boundaryChecks = [];
        let effects = 0;
        const options = {
          directory,
          policy,
          clock: () => 1000,
          providerForCase: (id) =>
            nativeFixtureProvider(directory, id, requests, {
              fixture: 'codex-profile',
              profileHome: profile.home,
              before: async () => {
                assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
                await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
                boundaryChecks.push(true);
              },
              onSpawn: (value) => spawned.push(value),
            }),
          probe: async () => {
            effects++;
            return 'Must not execute';
          },
        };
        const catalogueBytes = await readFile(join(directory, 'catalogue.sqlite'));
        await assert.rejects(
          openNativeFixtureController(options, { timeoutMs: 50 }).then((value) => {
            controller = value; // Also close an unexpectedly successful open on assertion failure.
            return value;
          }),
          { message: 'pi-native-resource-reconciliation-failed' },
        );
        assert.deepEqual(await readFile(join(directory, 'catalogue.sqlite')), catalogueBytes);
        assert.deepEqual(await readFile(ownerPath), ownerBytes);
        assert.deepEqual(await readFile(profile.authPath), authBytes);
        assert.deepEqual(await readFile(join(lease, 'owner.json')), leaseBytes);
        assert.equal(requests.length, 0);
        assert.equal(effects, 0);
        assert.ok((await lstat(helper.home)).isDirectory());

        let opened = false;
        opening = openNativeFixtureController(options).then((value) => {
          controller = value;
          opened = true;
        });
        void opening.catch(() => {});
        await delay(50);
        assert.equal(opened, false);
        assert.equal(requests.length, 0);
        process.kill(helper.pid, 'SIGCONT'); // Only the test resumes it; recovery never signals PIDs.
        await opening;
        assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' });
        await assert.rejects(lstat(helper.home), { code: 'ENOENT' });
        assert.deepEqual(await readdir(resourceRoot), []);
        await assert.rejects(
          withDedicatedProfile(profile.home, () => assert.fail('stale lease reused')),
          { message: 'sign-in-required' },
        );
        let view = await parked(controller, message.id);
        assert.equal(view.case.status, pause ? 'paused' : 'needs-attention');
        assert.equal(requests.length, pause ? 0 : 1);
        if (pause) {
          await controller.command({
            requestId: randomUUID(),
            expectedControlVersion: view.case.version,
            intent: { type: 'continue', caseId: message.id },
          });
          view = await parked(controller, message.id);
        }
        assert.equal(view.case.reason, 'sign-in-required');
        assert.equal(view.case.usedMs, 120000);
        assert.equal(view.case.remainingMs, 480000);
        assert.equal(view.case.attempt, 1);
        assert.equal(view.case.repairs, 0);
        assert.equal(requests.length, 1);
        assert.notEqual(requests[0].actionId, message.admission.actionId);
        assert.ok(requests[0].epoch > message.admission.epoch);
        assert.deepEqual(boundaryChecks, [true]);
        assert.deepEqual(spawned, []);
        assert.equal(effects, 0);
        assert.ok(!view.messages.some((m) => m.kind === 'eitri.action-result'));
        assert.ok(
          !view.messages
            .flatMap((m) => m.data?.messages ?? [])
            .some((m) => m.role === 'toolResult'),
        );
        assert.ok(!JSON.stringify(view).includes('synthetic-private'));
        assert.ok(!JSON.stringify(requests).includes(profile.authPath));
        for (let i = 0; i < 2; i++) {
          await controller.close();
          controller = await openNativeFixtureController(options);
          const reopened = (await controller.snapshot({ selected: message.id })).selected;
          assert.deepEqual(reopened.messages, view.messages);
          for (const key of ['status', 'reason', 'usedMs', 'remainingMs', 'attempt', 'repairs'])
            assert.equal(reopened.case[key], view.case[key]);
          assert.equal(requests.length, 1);
          assert.equal(effects, 0);
          assert.deepEqual(spawned, []);
          assert.deepEqual(await readFile(profile.authPath), authBytes);
          assert.deepEqual(await readFile(join(lease, 'owner.json')), leaseBytes);
          assert.deepEqual(await readdir(lease), ['owner.json']);
        }
      },
    );
