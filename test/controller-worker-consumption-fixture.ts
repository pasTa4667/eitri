import type { TestContext } from 'node:test';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Controller } from '../src/controller.ts';
import { FrozenBrowserValidator } from '../src/frozen-browser.ts';
import { fixture, gate } from './controller-worker-association-fixture.ts';
import { transcript } from './frozen-browser-consumption-fixture.ts';

export async function consumptionController(
  t: TestContext,
  extra: Partial<Parameters<typeof Controller.open>[0]> = {},
  kind: 'baseline' | 'browser' = 'baseline',
) {
  const f = await fixture(
    t,
    {
      offlineWorkerAcceptance: true,
      offlineWorkerConsumption: true,
      ...extra,
    },
    kind,
  );
  const statePath = join(f.root, 'transcript.json');
  const script = join(f.root, 'transcript.mjs');
  await writeFile(statePath, JSON.stringify({ mode: 'normal', calls: [] }));
  await writeFile(script, transcript);
  await writeFile(
    join(f.root, 'bin', 'docker'),
    `#!${process.execPath}\nprocess.argv.splice(2,0,${JSON.stringify(statePath)});await import(${JSON.stringify(new URL(`file://${script}`).href)});\n`,
    { mode: 0o700 },
  );
  return {
    ...f,
    get controller() {
      return f.controller;
    },
    async state(): Promise<{ calls: string[][]; image?: boolean; container?: unknown }> {
      return JSON.parse(await readFile(statePath, 'utf8'));
    },
  };
}

export function gateClient(t: TestContext, command = 'version') {
  const entered = gate();
  const release = gate();
  const prototype = FrozenBrowserValidator.prototype;
  const original = Reflect.get(prototype, 'client');
  Reflect.set(
    prototype,
    'client',
    async function (this: FrozenBrowserValidator, ...args: unknown[]) {
      const words = args[0] as string[];
      if (
        command === 'cleanup' ? words[0] === 'container' && words[1] === 'rm' : words[0] === command
      ) {
        entered.resolve();
        await release.promise;
      }
      return Reflect.apply(original, this, args);
    },
  );
  t.after(() => {
    release.resolve();
    Reflect.set(prototype, 'client', original);
  });
  return { entered: entered.promise, release: () => release.resolve() };
}
