import type { TestContext } from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { FrozenBrowserValidator } from '../src/frozen-browser.ts';
import { WorkspaceStore } from '../src/workspace.ts';

export function traceAdmissionEffects(
  t: TestContext,
  beforeExecution?: () => Promise<void> | void,
) {
  const counts = { executions: 0, reads: 0, commands: 0, saves: 0, cleanups: 0 };
  const execution = new AsyncLocalStorage<boolean>();
  const prototype = FrozenBrowserValidator.prototype;
  for (const [method, counter] of [
    ['executeAdmitted', 'executions'],
    ['client', 'commands'],
    ['save', 'saves'],
    ['finalize', 'cleanups'],
  ] as const) {
    const original = Reflect.get(prototype, method);
    Reflect.set(
      prototype,
      method,
      async function (this: FrozenBrowserValidator, ...args: unknown[]) {
        counts[counter]++;
        if (method === 'executeAdmitted') {
          await beforeExecution?.();
          return execution.run(true, () => Reflect.apply(original, this, args));
        }
        return Reflect.apply(original, this, args);
      },
    );
    t.after(() => Reflect.set(prototype, method, original));
  }
  const read = WorkspaceStore.prototype.readFrozen;
  t.mock.method(
    WorkspaceStore.prototype,
    'readFrozen',
    function (this: WorkspaceStore, ...args: Parameters<typeof read>) {
      if (execution.getStore()) counts.reads++;
      return Reflect.apply(read, this, args);
    },
  );
  return { counts };
}
