import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptanceFixture } from './frozen-browser-acceptance-fixture.ts';
import { journalRows } from './controller-worker-association-fixture.ts';

const [guardKind, keyState] = process.argv.slice(2);

test(`rejecting ${guardKind} authority for ${keyState} acceptance is handled without changing history`, async (t) => {
  const f = await acceptanceFixture(t);
  const journal = await f.open();
  const authority = (): true => true;
  const original = keyState === 'existing' ? await journal.accept(f.request, authority) : undefined;
  const before = journalRows(f.directory);
  const inventory = await journal.inventory();
  const unhandled: unknown[] = [];
  const observe = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', observe);
  t.after(() => process.removeListener('unhandledRejection', observe));
  const invalid =
    guardKind === 'async'
      ? async () => {
          throw Error('revoked-async-guard');
        }
      : () => Promise.reject(Error('revoked-promise-guard'));
  await assert.rejects(
    journal.accept(f.request, invalid as unknown as () => true),
    /worker-authority-denied/,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(unhandled, []);
  assert.deepEqual(journalRows(f.directory), before);
  assert.deepEqual(await journal.inventory(), inventory);
  const accepted = await journal.accept(f.request, authority);
  assert.deepEqual(accepted.request, f.request);
  if (original) assert.deepEqual(accepted, original);
  assert.deepEqual(await journal.inventory(), {
    ownerId: f.options.expectedIdentity.ownerId,
    configurationDigest: f.options.expectedIdentity.configurationDigest,
    attempts: 0,
    contribution: 0,
    runs: [{ kind: 'offline-acceptance', state: 'accepted', ...accepted }],
  });
});
