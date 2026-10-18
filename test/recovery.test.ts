import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Controller } from '../src/controller.ts';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';

for (const mode of ['model', 'paused-model', 'tool', 'tool-receipt'])
  test(
    `SIGKILL during ${mode} conservatively preserves allowance and intent`,
    { timeout: 15000 },
    async (t) => {
      const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-kill-test-')));
      const child = fork(
        new URL('./crash-worker.ts', import.meta.url),
        [directory, mode.startsWith('tool') ? mode : 'model'],
        {
          env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        },
      );
      let errors = '';
      child.stderr!.on('data', (chunk) => {
        errors += chunk.toString();
      });
      let controller: Controller | undefined;
      t.after(async () => {
        child.kill('SIGKILL');
        await controller?.close();
        await rm(directory, { recursive: true, force: true });
      });
      const message = await Promise.race([
        once(child, 'message').then(([message]) => message as { id: string; stage: string }),
        once(child, 'exit').then(() => {
          throw new Error(`Child exited early: ${errors}`);
        }),
      ]);
      assert.equal(message.stage, 'admitted');
      if (mode === 'paused-model') {
        const ack = once(child, 'message');
        child.send('pause');
        assert.equal((await ack)[0].stage, 'pause-persisted');
      }
      const exit = once(child, 'exit');
      child.kill('SIGKILL');
      await exit;
      const faux = fauxProvider({ tokensPerSecond: 100000 });
      faux.setResponses([fauxAssistantMessage('Recovered without fabricated progress')]);
      controller = await Controller.open({
        directory,
        policy: { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' },
        providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
      });
      const deadline = Date.now() + 3000;
      let c;
      do {
        c = (await controller.snapshot()).cases[0];
        if (c.status === 'needs-attention' || c.status === 'paused') break;
        await new Promise((r) => setTimeout(r, 10));
      } while (Date.now() < deadline);
      assert.equal(c.id, message.id);
      if (mode !== 'tool-receipt') {
        assert.ok(c.usedMs >= (mode === 'tool' ? 60000 : 120000));
        assert.ok(c.remainingMs <= (mode === 'tool' ? 540000 : 480000));
      } else {
        assert.equal(c.reason, 'incomplete-native-tool-checkpoint');
        assert.ok(
          (await controller.snapshot({ selected: c.id })).selected!.messages.some(
            (m) =>
              m.kind === 'eitri.action-result' &&
              JSON.stringify(m.data).includes('Effect saved before SDK receipt'),
          ),
        );
      }
      assert.equal(c.attempt, 1);
      assert.equal(c.status, mode === 'paused-model' ? 'paused' : 'needs-attention');
      assert.equal(faux.state.callCount, mode === 'model' ? 1 : 0);
      if (mode === 'tool') assert.equal(c.reason, 'interrupted-tool-effect-uncertain');
    },
  );
