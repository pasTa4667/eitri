import { Controller } from '../src/controller.ts';
import { FrozenBrowserValidator } from '../src/frozen-browser.ts';
import {
  offline,
  policy,
  providerFor,
  investigate,
} from './controller-worker-association-fixture.ts';

const [directory, binding, point] = process.argv.slice(2);
let identity: { id: string; actionId: string };
const stop = () => {
  process.send?.(identity);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};
const controller: Controller = await Controller.open({
  directory,
  policy,
  offlineWorkspace: offline(),
  offlineWorkerJournal: JSON.parse(binding),
  offlineWorkerAcceptance: true,
  offlineWorkerConsumption: true,
  providerForCase: providerFor(() => controller, 'baseline'),
  check: async (request, source) => {
    identity = { id: request.caseId, actionId: request.actionId };
    await source!.workerAcceptance!.accept();
    await source!.workerConsumption!.consume();
    throw Error('missed-admission-checkpoint');
  },
});
const retain = Reflect.get(controller, 'retainWorkerExecutionFacts');
Reflect.set(controller, 'retainWorkerExecutionFacts', (...args: unknown[]) => {
  if (point === 'before-facts') stop();
  const result = Reflect.apply(retain, controller, args);
  if (point === 'after-facts') stop();
  return result;
});
if (point === 'execution') Reflect.set(FrozenBrowserValidator.prototype, 'executeAdmitted', stop);
setInterval(() => {}, 1000);
await controller.command(investigate());
