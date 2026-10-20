import { DatabaseSync } from 'node:sqlite';
import { Controller } from '../src/controller.ts';
import {
  offline,
  policy,
  providerFor,
  investigate,
} from './controller-worker-association-fixture.ts';

const [directory, binding, point] = process.argv.slice(2);
let callbacks = 0;
const original = DatabaseSync.prototype.exec;
const controller: Controller = await Controller.open({
  directory,
  policy,
  offlineWorkspace: offline(),
  offlineWorkerJournal: JSON.parse(binding),
  offlineWorkerAcceptance: true,
  providerForCase: providerFor(() => controller),
  check: async (request, source) => {
    callbacks++;
    DatabaseSync.prototype.exec = function (sql) {
      if (sql !== 'COMMIT') return Reflect.apply(original, this, [sql]);
      if (point === 'after') Reflect.apply(original, this, [sql]);
      process.send?.({ id: request.caseId, actionId: request.actionId, callbacks });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    };
    await source!.workerAcceptance!.accept();
    throw Error('missed-checkpoint');
  },
});
setInterval(() => {}, 1000);
await controller.command(investigate());
