import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';

const checkout = await realpath(process.argv[2] ?? process.cwd());
const { Controller } = await import(pathToFileURL(join(checkout, 'src/controller.ts')));
const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-key-collision-')));
const policy = { project: 'demo', environment: 'demo', repository: 'eitri-test-web-app' };
const faux = fauxProvider({ tokensPerSecond: 100000 });
faux.setResponses([
  fauxAssistantMessage(fauxToolCall('run_check', { kind: 'browser' }), { stopReason: 'toolUse' }),
  fauxAssistantMessage('Done'),
]);
const controller = await Controller.open({
  directory,
  policy,
  providerForCase: () => ({ provider: faux.provider, modelId: faux.getModel().id }),
  check: async ({ kind }) =>
    Object.assign(
      Object.create({
        type: 'completed',
        check: {
          kind,
          candidate: 'a'.repeat(40),
          configuration: 'b'.repeat(64),
          passed: false,
          simulated: true,
          outputs: [],
        },
      }),
      { 'check,type': true },
    ),
});
try {
  const receipt = await controller.command({
    requestId: randomUUID(),
    intent: {
      type: 'investigate',
      issue: {
        ...policy,
        id: 'key-collision',
        title: 'Malformed envelope',
        priority: 'high',
        status: 'unresolved',
        regressed: false,
        escalating: false,
      },
    },
  });
  const deadline = Date.now() + 5000;
  let selected;
  do {
    selected = (await controller.snapshot({ selected: receipt.caseId })).selected;
    if (selected.case.status === 'needs-attention') break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  } while (Date.now() < deadline);
  const actual = {
    status: selected.case.status,
    reason: selected.case.reason,
    phase: selected.case.phase,
    failedCandidate: selected.case.failedCandidate,
    repairs: selected.case.repairs,
    checks: selected.checks.length,
    artifacts: selected.artifacts.length,
  };
  process.stdout.write(JSON.stringify(actual) + '\n');
  assert.deepEqual(actual, {
    status: 'needs-attention',
    reason: 'invalid-check-execution',
    phase: 'triage',
    failedCandidate: null,
    repairs: 0,
    checks: 0,
    artifacts: 0,
  });
  process.stdout.write('PASS. Malformed envelope rejected without evidence or repair.\n');
} finally {
  await controller.close();
  await rm(directory, { recursive: true });
}
