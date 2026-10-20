import { Controller } from '../src/controller.ts';
import {
  offline,
  policy,
  providerFor,
  investigate,
} from './controller-worker-association-fixture.ts';

const [directory, binding, point] = process.argv.slice(2);
let callbacks = 0;
const controller: Controller = await Controller.open({
  directory,
  policy,
  offlineWorkspace: offline(),
  offlineWorkerJournal: JSON.parse(binding),
  providerForCase: providerFor(() => controller),
  check: async () => {
    callbacks++;
    return { type: 'infrastructure' };
  },
  fault: (actual, id) => {
    if (actual !== point) return;
    process.send?.({ id, callbacks });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  },
});
setInterval(() => {}, 1000);
await controller.command(investigate());
