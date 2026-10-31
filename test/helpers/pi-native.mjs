import { streamNativeFixture } from '../../prototypes/pi-native-stream.mjs';
import { nativeProbeProvider } from '../../prototypes/pi-native-provider.mjs';
import { reconcileNativeResources } from '../../prototypes/pi-native-resources.mjs';
import { Controller } from '../../src/controller.ts';

// Reconcile before Controller.open can recover or schedule any native work.
export async function openNativeFixtureController(options, recovery) {
  await reconcileNativeResources(options.directory, recovery);
  return Controller.open(options);
}

// Offline only; the opt-in live harness uses its own separate stream entry.
export function nativeFixtureProvider(directory, caseId, requests, hooks = {}) {
  return nativeProbeProvider(directory, caseId, requests, streamNativeFixture, hooks);
}
