import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { Type } from '@earendil-works/pi-ai';
import { Harness, createRegistry, defineExtension, defineTool, defineDoc, GenerationTask, hook } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';

const directory = await mkdtemp(join(tmpdir(), 'eitri-sdk-probe-'));
const file = join(directory, 'session.sqlite');
const observations = [];
const faux = fauxProvider({ tokensPerSecond: 100000 });
let permitted = true;
let dispatches = 0;
let toolExecutions = 0;
const models = createModels();
models.setProvider({
  ...faux.provider,
  streamSimple(...args) {
    if (!permitted) throw new Error('controller denies dispatch');
    dispatches++;
    return faux.provider.streamSimple(...args);
  },
});
const registry = createRegistry();
const State = defineDoc({ kind: 'eitri.probe', version: 1, scope: 'conversation', history: 'latest', fork: 'initial', initial: () => ({ marker: '' }) });
registry.install(defineExtension({ name: 'probe', tools: [defineTool({
  name: 'probe', description: 'Observe permission at execution.', parameters: Type.Object({}),
  execute: async () => {
    if (!permitted) throw new Error('controller denies tool');
    toolExecutions++;
    return { output: [{ type: 'text', text: 'executed' }] };
  },
})], hooks: [hook(GenerationTask, { beforeRequest: () => { throw new Error('deliberately broken hook'); } })] }));
const options = { models, registry, settings: { compaction: { enabled: false, backgroundTokens: 0 }, retry: { enabled: false }, toolExecution: 'sequential' }, onReport: () => {} };
let harness;
try {
  harness = await Harness.open(await openNodeSqliteStorage(file), options, context);
  const root = await harness.root(context, { agent: { model: { provider: faux.provider.id, modelId: faux.getModel().id } } });
  await root.commit(async tx => { (await tx.doc(State, root.id)).marker = 'native-document'; }, context);
  await root.submit({ type: 'write', requestId: 'passive-note', entry: { kind: 'eitri.note', data: { text: 'no inference' } } }, context);
  observations.push({ operation: 'passive-note', dispatches, toolExecutions, marker: (await harness.snapshot(State, root.id, context)).marker });
  faux.setResponses([fauxAssistantMessage(fauxToolCall('probe', {}), { stopReason: 'toolUse' }), fauxAssistantMessage('done')]);
  const submission = await root.submit({ type: 'input', content: 'Run the probe.', requestId: 'first' }, context);
  const settled = await submission.wait(context);
  observations.push({ operation: 'tool-turn-with-throwing-hook', status: settled.status, dispatches, toolExecutions });
  permitted = false;
  const denied = await root.submit({ type: 'input', content: 'Must not dispatch.', requestId: 'denied' }, context);
  const deniedResult = await Promise.race([denied.wait(context), new Promise((_, reject) => setTimeout(() => reject(new Error('denied wait timeout')), 3000).unref())]);
  observations.push({ operation: 'denied-result', status: deniedResult.status, reason: deniedResult.reason ?? null });
  observations.push({ operation: 'denied-dispatch', dispatches, toolExecutions });
  await harness.close(context);
  harness = await Harness.open(await openNodeSqliteStorage(file), options, context);
  const reopened = await harness.root(context);
  const entries = await reopened.entries({ order: 'ascending' }, 100, undefined, context);
  observations.push({ operation: 'reopen-without-resume', marker: (await harness.snapshot(State, reopened.id, context)).marker, noteCount: entries.items.filter(e => e.kind === 'eitri.note').length, dispatches, toolExecutions });
} finally {
  await harness?.close(context);
  await rm(directory, { recursive: true });
}
console.log(JSON.stringify(observations, null, 2));
