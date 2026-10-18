import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { Type, createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Model,
  Api,
} from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import type { Provider } from '@earendil-works/pi-ai/models';
import {
  Harness,
  createRegistry,
  defineDoc,
  defineExtension,
  defineTool,
} from '@earendil-works/pi-durable';
import type { Conversation } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { randomUUID, createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { phases, fail } from './domain.ts';
import type { Action, Assessment, Case, Check, Message } from './domain.ts';

export type RuntimeHost = {
  current(): Case;
  admit(kind: 'model' | 'tool', limit: number): Action;
  permit(action: Action | undefined): void;
  finish(action: Action, uncertain: boolean, failed?: boolean): void;
  assess(assessment: Assessment, checks: Check[]): Promise<void>;
  checkpoint(check: Check): void;
  probe(signal: AbortSignal): Promise<string>;
  check(kind: Check['kind'], signal: AbortSignal): Promise<Omit<Check, 'id'>>;
  changed(): void;
};
const Identity = defineDoc({
  kind: 'eitri.identity',
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  initial: () => ({ caseId: '', issueKey: '' }),
});
const assessmentSchema = Type.Object(
  {
    phase: Type.Union(phases.map((p) => Type.Literal(p))),
    expectedControlVersion: Type.Integer({ minimum: 1 }),
    conclusion: Type.Union(['progress', 'no-fix', 'attention'].map((v) => Type.Literal(v))),
    reason: Type.String({ minLength: 1, maxLength: 512 }),
    evidenceIds: Type.Array(Type.String({ format: 'uuid' }), { maxItems: 64 }),
    proposal: Type.Optional(Type.String({ maxLength: 8000 })),
    paths: Type.Optional(Type.Array(Type.String({ maxLength: 512 }), { maxItems: 64 })),
    candidate: Type.Optional(Type.String({ pattern: '^[0-9a-f]{40,64}$' })),
  },
  { additionalProperties: false },
);

export class NativeCase {
  harness: Harness;
  root: Conversation;
  host: RuntimeHost;
  constructor(harness: Harness, root: Conversation, host: RuntimeHost) {
    this.harness = harness;
    this.root = root;
    this.host = host;
  }

  static async open(
    path: string,
    identity: Case,
    route: { provider: Provider; modelId: string },
    host: RuntimeHost,
  ): Promise<NativeCase> {
    const models = createModels({
      authContext: { env: async () => undefined, fileExists: async () => false },
    });
    const provider = route.provider;
    if (provider.id !== 'faux') fail('live-provider-disabled');
    const scope = new AsyncLocalStorage<Action>();
    const guarded = (
      model: Model<Api>,
      invoke: (signal: AbortSignal) => AssistantMessageEventStream,
    ) => {
      const action = host.admit('model', 120_000);
      const output = createAssistantMessageEventStream();
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), action.limitMs);
      const errorMessage = (): AssistantMessage => ({
        role: 'assistant',
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'error',
        errorMessage: 'Controlled inference failed or timed out.',
        timestamp: Date.now(),
      });
      void (async () => {
        let finished = false;
        try {
          const stream = scope.run(action, () => invoke(abort.signal));
          const iterator = stream[Symbol.asyncIterator]();
          while (true) {
            const next = await abortable(iterator.next(), abort.signal);
            if (next.done) throw new Error('Stream ended without a terminal event');
            if (next.value.type === 'done' || next.value.type === 'error') {
              host.finish(action, false);
              finished = true;
              output.push(
                next.value.type === 'error'
                  ? { type: 'error', reason: 'error', error: errorMessage() }
                  : next.value,
              );
              output.end();
              break;
            }
            output.push(next.value);
            host.changed();
          }
        } catch {
          if (!finished) host.finish(action, abort.signal.aborted);
          output.push({ type: 'error', reason: 'error', error: errorMessage() });
          output.end();
        } finally {
          clearTimeout(timeout);
        }
      })();
      return output;
    };
    models.setProvider({
      ...provider,
      stream: (model, transcript, options) => {
        host.permit(scope.getStore());
        return provider.stream(model, transcript, options);
      },
      streamSimple: (model, transcript, options) => {
        host.permit(scope.getStore());
        return provider.streamSimple(model, transcript, options);
      },
      fetchDeferred: undefined,
      cancelDeferred: undefined,
      generateImages: undefined,
      classify: undefined,
    });
    const simple = models.streamSimple.bind(models),
      stream = models.stream.bind(models);
    models.streamSimple = (model, transcript, options) =>
      guarded(model, (signal) =>
        simple(model, transcript, { ...options, signal: combine(signal, options?.signal) }),
      );
    models.stream = (model, transcript, options) =>
      guarded(model, (signal) =>
        stream(
          model,
          transcript,
          Object.assign({}, options, { signal: combine(signal, options?.signal) }),
        ),
      );
    const registry = createRegistry();
    let native: NativeCase;
    const tool = async <T>(operation: (signal: AbortSignal) => Promise<T>) => {
      const action = host.admit('tool', 60_000);
      const signal = AbortSignal.timeout(action.limitMs);
      try {
        const result = await abortable(operation(signal), signal);
        await native.note(`action-result-${action.id}`, 'eitri.action-result', {
          actionId: action.id,
          result: result ?? null,
        });
        host.finish(action, false);
        return result;
      } catch (error) {
        host.finish(action, signal.aborted, true);
        throw error;
      }
    };
    registry.install(
      defineExtension({
        name: 'eitri',
        tools: [
          defineTool({
            name: 'complete_assessment',
            description:
              'Record a phase assessment. The controller validates evidence and decides the next state.',
            parameters: assessmentSchema,
            execute: async (args) => {
              await tool(async () => {
                const assessment = args as Assessment;
                await native.note(`assessment-${randomUUID()}`, 'eitri.assessment', assessment);
                const entries = await native.messages(1000);
                await host.assess(
                  assessment,
                  entries.messages
                    .filter((e) => e.kind === 'eitri.check')
                    .map((e) => e.data as Check),
                );
              });
              return {
                output: [{ type: 'text', text: 'Assessment recorded.' }],
                control: { terminate: true },
              };
            },
          }),
          defineTool({
            name: 'probe',
            description: 'Scripted execution probe; not a shell or live integration.',
            parameters: Type.Object({}, { additionalProperties: false }),
            execute: async () => ({
              output: [{ type: 'text', text: await tool((signal) => host.probe(signal)) }],
            }),
          }),
          defineTool({
            name: 'run_check',
            description:
              'Run a configured trusted validation check. No check can be supplied by the model.',
            parameters: Type.Object(
              {
                kind: Type.Union(
                  ['baseline', 'checkpoint', 'unit', 'regression', 'build', 'browser'].map((v) =>
                    Type.Literal(v),
                  ),
                ),
              },
              { additionalProperties: false },
            ),
            execute: async (args) => {
              const check = await tool(async (signal) => {
                const result: Check = {
                  ...(await host.check(args.kind as Check['kind'], signal)),
                  id: randomUUID(),
                };
                if (
                  result.kind !== args.kind ||
                  !/^[0-9a-f]{40,64}$/.test(result.candidate) ||
                  !/^[0-9a-f]{64}$/.test(result.configuration) ||
                  !Array.isArray(result.artifacts) ||
                  typeof result.passed !== 'boolean' ||
                  result.simulated !== true
                )
                  fail('invalid-check-receipt');
                await native.note(`check-${result.id}`, 'eitri.check', result);
                host.checkpoint(result);
                return result;
              });
              return {
                output: [
                  {
                    type: 'text',
                    text: JSON.stringify({ ...check, controlVersion: host.current().version }),
                  },
                ],
              };
            },
          }),
        ],
      }),
    );
    const storage = await openNodeSqliteStorage(path);
    let harness: Harness;
    try {
      harness = await Harness.open(
        storage,
        {
          models,
          registry,
          settings: {
            compaction: { enabled: false, backgroundTokens: 0 },
            retry: { enabled: false },
            toolExecution: 'sequential',
          },
          onReport: () => host.changed(),
        },
        context,
      );
    } catch (error) {
      await storage.close(context);
      throw error;
    }
    try {
      const root = await harness.root(context, {
        agent: {
          model: { provider: provider.id, modelId: route.modelId },
          tools: registry
            .snapshot()
            .tools()
            .map((item) => item.tool),
        },
      });
      native = new NativeCase(harness, root, host);
      await root.commit(async (tx) => {
        const doc = await tx.doc(Identity, root.id);
        if (
          (!doc.caseId && identity.native !== 'provisioning') ||
          (doc.caseId && (doc.caseId !== identity.id || doc.issueKey !== identity.issueKey))
        )
          fail('native-identity-mismatch');
        doc.caseId = identity.id;
        doc.issueKey = identity.issueKey;
      }, context);
      return native;
    } catch (error) {
      await harness.close(context);
      throw error;
    }
  }

  async note(requestId: string, kind: string, data: unknown) {
    const steering = kind === 'eitri.note' && this.host.current().status === 'running';
    await this.root.submit(
      {
        type: 'write',
        requestId,
        entry: {
          kind,
          data: JSON.parse(JSON.stringify({ payload: data, timestamp: Date.now() })),
          ...(steering
            ? {
                model: [
                  {
                    role: 'user' as const,
                    content: `Operator note: ${JSON.stringify(data)}`,
                    timestamp: Date.now(),
                  },
                ],
              }
            : {}),
        },
      },
      context,
    );
    this.host.changed();
  }
  async messages(limit = 100, before?: string): Promise<{ messages: Message[]; more: boolean }> {
    let cursor;
    let found = before === undefined;
    const messages: Message[] = [];
    do {
      const page = await this.root.entries(
        { order: 'descending' },
        Math.min(1000, limit + 1),
        cursor,
        context,
      );
      cursor = page.next;
      for (const entry of page.items) {
        const hash = createHash('sha256')
          .update(`${this.host.current().id}:${entry.id}`)
          .digest('hex')
          .slice(0, 32);
        const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
        if (!found) {
          if (id === before) found = true;
          continue;
        }
        const data = entry.data as Record<string, unknown> | undefined;
        messages.push({
          id,
          kind: entry.kind,
          data: data?.payload ?? { application: entry.data ?? null, messages: entry.model ?? [] },
          timestamp:
            typeof data?.timestamp === 'number'
              ? data.timestamp
              : (entry.model?.[0]?.timestamp ?? 0),
        });
        if (messages.length > limit)
          return { messages: messages.slice(0, limit).reverse(), more: true };
      }
    } while (cursor);
    if (!found) fail('invalid-cursor');
    return { messages: messages.reverse(), more: false };
  }
  async run(c: Case) {
    const notes = await this.messages(100);
    const input = JSON.stringify({
      mode: 'scripted',
      caseId: c.id,
      issue: c.issue,
      phase: c.phase,
      expectedControlVersion: c.version,
      candidate: c.candidate,
      remainingMs: c.remainingMs,
      notes: notes.messages.filter((e) => e.kind === 'eitri.note').map((e) => e.data),
      instruction:
        'Assess this phase using complete_assessment. Do not claim a live fix or infer check outcomes. Missing prerequisites require attention.',
    });
    const submission = await this.root.submit(
      { type: 'input', requestId: `run-${c.id}-${c.epoch}`, content: input, whenBusy: 'reject' },
      context,
    );
    return submission.wait(context);
  }
  async hasUnsettledTool() {
    return (await this.harness.inspect(context)).tasks.some(
      (task) => task.record.kind === 'pi.tool',
    );
  }
  async reconcile() {
    await this.root.abort(context, { background: true });
  }
  async close() {
    await this.harness.close(context);
  }
}
function combine(signal: AbortSignal, other?: AbortSignal) {
  return other ? AbortSignal.any([signal, other]) : signal;
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Action timed out'));
      return;
    }
    const abort = () => reject(new Error('Action timed out'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
