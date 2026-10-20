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
import { phases, fail, uuid, ControlError } from './domain.ts';
import type {
  Action,
  Artifact,
  Assessment,
  Case,
  Check,
  CheckResult,
  CheckExecution,
  Message,
} from './domain.ts';
import {
  ArtifactStore,
  artifactLimits,
  checksum,
  validateArtifact,
  validateOutput,
} from './artifacts.ts';

export type RuntimeHost = {
  current(): Case;
  admit(kind: 'model' | 'tool', limit: number): Action;
  permit(action: Action | undefined): void;
  remaining(action: Action): number;
  mayRecordCompletion(action: Action): boolean;
  wakeup(delayMs: number, callback: () => void): () => void;
  finish(action: Action, uncertain: boolean, failed?: boolean): void;
  receipt(action: Action): void;
  assess(action: Action, assessment: Assessment, checks: Check[]): Promise<void>;
  checkpoint(action: Action, check: Check): void;
  probe(signal: AbortSignal): Promise<string>;
  check(action: Action, kind: Check['kind'], signal: AbortSignal): Promise<CheckExecution>;
  validateCheckAction(action: Action): void;
  fault(point: string): void;
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
type EvidenceDocument = {
  caseId: string;
  artifacts: Record<string, Artifact>;
  checks: Record<string, Check>;
};
const Evidence = defineDoc({
  kind: 'eitri.artifacts',
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  initial: (): EvidenceDocument => ({ caseId: '', artifacts: {}, checks: {} }),
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
  private store: ArtifactStore;
  constructor(harness: Harness, root: Conversation, host: RuntimeHost, store: ArtifactStore) {
    this.harness = harness;
    this.root = root;
    this.host = host;
    this.store = store;
  }

  static async open(
    path: string,
    identity: Case,
    route: { provider: Provider; modelId: string },
    host: RuntimeHost,
    store: ArtifactStore,
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
      const lifetime = actionLifetime(host, action);
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
        let retirementAttempted = false;
        try {
          lifetime.check();
          const stream = scope.run(action, () => invoke(lifetime.signal));
          const iterator = stream[Symbol.asyncIterator]();
          while (true) {
            const next = await abortable(iterator.next(), lifetime.signal);
            if (next.done) throw new Error('Stream ended without a terminal event');
            if (next.value.type === 'done' || next.value.type === 'error') {
              lifetime.check();
              retirementAttempted = true;
              host.finish(action, false);
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
          if (!retirementAttempted) {
            try {
              host.finish(action, lifetime.signal.aborted);
            } catch {}
          }
          output.push({ type: 'error', reason: 'error', error: errorMessage() });
          output.end();
        } finally {
          lifetime.dispose();
          try {
            host.receipt(action);
          } catch {}
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
    const tool = async <T>(operation: (signal: AbortSignal, action: Action) => Promise<T>) => {
      const action = host.admit('tool', 60_000);
      const lifetime = actionLifetime(host, action);
      const signal = lifetime.signal;
      let retirementAttempted = false;
      try {
        lifetime.check();
        const result = await abortable(operation(signal, action), signal);
        const guard = () => {
          if (!host.mayRecordCompletion(action)) lifetime.check();
        };
        guard();
        const requestId = `action-result-${action.id}`;
        const data = JSON.parse(
          JSON.stringify({
            payload: { actionId: action.id, result: result ?? null },
            timestamp: Date.now(),
          }),
        );
        await native.root.commit(async (tx) => {
          const existing = await tx.submissionByRequest(native.root.id, requestId);
          if (existing) {
            if (existing.type !== 'write')
              throw new Error(
                `Request ${requestId} already identifies a submission of type ${existing.type}`,
              );
            return;
          }
          guard();
          const entry = await tx.appendEntry(native.root.id, {
            kind: 'eitri.action-result',
            data,
          });
          await tx.createSubmission({
            conversationId: native.root.id,
            requestId,
            type: 'write',
            status: 'done',
            entry: entry.id,
          });
        }, context);
        host.changed();
        guard();
        retirementAttempted = true;
        host.finish(action, false);
        return result;
      } catch (error) {
        if (!retirementAttempted) {
          try {
            if (!host.mayRecordCompletion(action)) lifetime.check();
          } catch {}
          host.finish(action, signal.aborted, true);
        }
        throw error;
      } finally {
        lifetime.dispose();
        host.receipt(action);
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
              await tool(async (_signal, action) => {
                const assessment = args as Assessment;
                await native.note(`assessment-${randomUUID()}`, 'eitri.assessment', assessment);
                const { checks } = await native.metadata();
                await host.assess(action, assessment, checks);
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
              const check = await tool(async (signal, action) => {
                const checkId = randomUUID();
                const kind = args.kind as Check['kind'];
                const result = await host.check(action, kind, signal);
                if (result.type !== 'completed') return result;
                return native.recordCheck(action, checkId, result.check, signal);
              });
              if ('type' in check)
                return {
                  output: [{ type: 'text', text: 'Validation unavailable.' }],
                  control: { terminate: true },
                };
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
      native = new NativeCase(harness, root, host, store);
      await root.commit(async (tx) => {
        const doc = await tx.doc(Identity, root.id);
        if (
          (!doc.caseId && identity.native !== 'provisioning') ||
          (doc.caseId && (doc.caseId !== identity.id || doc.issueKey !== identity.issueKey))
        )
          fail('native-identity-mismatch');
        doc.caseId = identity.id;
        doc.issueKey = identity.issueKey;
        const evidence = await tx.doc(Evidence, root.id);
        if (evidence.caseId && evidence.caseId !== identity.id) fail('native-identity-mismatch');
        evidence.caseId = identity.id;
      }, context);
      await native.metadata();
      return native;
    } catch (error) {
      await harness.close(context);
      throw error;
    }
  }

  async metadata(): Promise<{ checks: Check[]; artifacts: Artifact[] }> {
    let value!: EvidenceDocument;
    await this.root.commit(async (tx) => {
      value = JSON.parse(JSON.stringify(await tx.doc(Evidence, this.root.id)));
    }, context);
    const caseId = this.host.current().id;
    if (value.caseId !== caseId || !value.artifacts || !value.checks)
      fail('invalid-artifact-document');
    const artifacts = Object.values(value.artifacts);
    const checks = Object.values(value.checks);
    if (
      artifacts.length > artifactLimits.caseCount ||
      checks.length > artifactLimits.checks ||
      artifacts.reduce((sum, artifact) => sum + artifact.size, 0) > artifactLimits.caseBytes
    )
      fail('artifact-case-limit');
    for (const [id, artifact] of Object.entries(value.artifacts)) {
      validateArtifact(artifact, caseId);
      if (id !== artifact.id) fail('invalid-artifact-document');
    }
    for (const [id, check] of Object.entries(value.checks)) {
      if (
        Object.keys(check).some(
          (key) =>
            ![
              'id',
              'caseId',
              'actionId',
              'kind',
              'candidate',
              'configuration',
              'passed',
              'simulated',
              'artifacts',
            ].includes(key),
        ) ||
        id !== check.id ||
        !uuid(id) ||
        check.caseId !== caseId ||
        !uuid(check.actionId) ||
        !['baseline', 'checkpoint', 'unit', 'regression', 'build', 'browser'].includes(
          check.kind,
        ) ||
        typeof check.candidate !== 'string' ||
        !/^[0-9a-f]{40,64}$/.test(check.candidate) ||
        typeof check.configuration !== 'string' ||
        !/^[0-9a-f]{64}$/.test(check.configuration) ||
        typeof check.passed !== 'boolean' ||
        check.simulated !== true ||
        !Array.isArray(check.artifacts) ||
        check.artifacts.length > artifactLimits.checkCount ||
        !check.artifacts.every(uuid) ||
        new Set(check.artifacts).size !== check.artifacts.length
      )
        fail('invalid-check-receipt');
    }
    return { checks, artifacts };
  }
  async artifact(id: string): Promise<Artifact | undefined> {
    if (!uuid(id)) fail('invalid-artifact-id');
    let artifact: Artifact | undefined;
    await this.root.commit(async (tx) => {
      const doc = await tx.doc(Evidence, this.root.id);
      if (doc.caseId !== this.host.current().id) fail('invalid-artifact-document');
      const found = doc.artifacts[id];
      if (found) artifact = JSON.parse(JSON.stringify(found));
    }, context);
    if (artifact) {
      validateArtifact(artifact, this.host.current().id);
      if (artifact.id !== id) fail('invalid-artifact-document');
    }
    return artifact;
  }
  async readArtifact(id: string) {
    const artifact = (await this.artifact(id)) ?? fail('artifact-not-found');
    return { artifact, bytes: await this.store.read(artifact) };
  }
  async verifyArtifacts(check: Check) {
    let total = 0;
    for (const id of check.artifacts) {
      const { artifact } = await this.readArtifact(id);
      if (
        artifact.checkId !== check.id ||
        artifact.actionId !== check.actionId ||
        artifact.caseId !== check.caseId ||
        artifact.revision !== check.candidate ||
        artifact.configuration !== check.configuration ||
        artifact.simulated !== check.simulated
      )
        fail('artifact-provenance-mismatch');
      total += artifact.size;
    }
    if (total > artifactLimits.checkBytes) fail('artifact-check-limit');
  }
  async recordCheck(action: Action, checkId: string, result: CheckResult, signal: AbortSignal) {
    const guard = () => {
      signal.throwIfAborted();
      this.host.validateCheckAction(action);
    };
    guard();
    if (
      !result ||
      Object.keys(result).some(
        (key) =>
          !['kind', 'candidate', 'configuration', 'passed', 'simulated', 'outputs'].includes(key),
      ) ||
      typeof result.candidate !== 'string' ||
      !/^[0-9a-f]{40,64}$/.test(result.candidate) ||
      typeof result.configuration !== 'string' ||
      !/^[0-9a-f]{64}$/.test(result.configuration) ||
      typeof result.passed !== 'boolean' ||
      result.simulated !== true ||
      !Array.isArray(result.outputs) ||
      result.outputs.length > artifactLimits.checkCount
    )
      fail('invalid-check-receipt');
    if (
      result.outputs.reduce((sum, output) => sum + (output?.bytes?.byteLength ?? Infinity), 0) >
      artifactLimits.checkBytes
    )
      fail('artifact-check-limit');
    const outputs = result.outputs.map((output) => {
      const bytes = validateOutput(output);
      return { label: output.label, mime: output.mime, bytes };
    });
    const check: Check = {
      id: checkId,
      caseId: action.caseId,
      actionId: action.id,
      kind: result.kind,
      candidate: result.candidate,
      configuration: result.configuration,
      passed: result.passed,
      simulated: this.host.current().simulated,
      artifacts: [],
    };
    const artifacts: Artifact[] = outputs.map((output) => ({
      id: randomUUID(),
      caseId: action.caseId,
      actionId: action.id,
      checkId,
      revision: check.candidate,
      configuration: check.configuration,
      simulated: check.simulated,
      createdAt: Date.now(),
      label: output.label,
      mime: output.mime,
      size: output.bytes.length,
      sha256: checksum(output.bytes),
    }));
    const existing = await this.metadata();
    const total = artifacts.reduce((sum, artifact) => sum + artifact.size, 0);
    if (total > artifactLimits.checkBytes) fail('artifact-check-limit');
    if (
      existing.checks.length >= artifactLimits.checks ||
      artifacts.length + existing.artifacts.length > artifactLimits.caseCount ||
      total + existing.artifacts.reduce((sum, artifact) => sum + artifact.size, 0) >
        artifactLimits.caseBytes
    )
      fail('artifact-case-limit');
    for (let i = 0; i < artifacts.length; i++) {
      guard();
      await this.store.write(artifacts[i], outputs[i].bytes);
    }
    this.host.fault('after-artifact-blobs');
    await this.root.commit(async (tx) => {
      const doc = await tx.doc(Evidence, this.root.id);
      guard();
      for (const artifact of artifacts) doc.artifacts[artifact.id] = artifact;
    }, context);
    this.host.fault('after-artifact-manifests');
    check.artifacts = artifacts.map((artifact) => artifact.id);
    await this.root.commit(async (tx) => {
      const doc = await tx.doc(Evidence, this.root.id);
      guard();
      doc.checks[check.id] = check;
    }, context);
    await this.note(`check-${check.id}`, 'eitri.check', check);
    this.host.fault('after-check-receipt');
    guard();
    this.host.checkpoint(action, check);
    return check;
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
function actionLifetime(host: RuntimeHost, action: Action) {
  const abort = new AbortController();
  let cancel: (() => void) | undefined;
  let disposed = false;
  let generation = 0;
  const clear = () => {
    generation++;
    cancel?.();
    cancel = undefined;
  };
  const remaining = () => {
    abort.signal.throwIfAborted();
    try {
      const value = host.remaining(action);
      if (value <= 0) throw new ControlError('action-timed-out');
      return value;
    } catch (error) {
      clear();
      abort.abort(error);
      throw error;
    }
  };
  const arm = (delay: number) => {
    clear();
    const expected = generation;
    cancel = host.wakeup(delay, () => {
      if (disposed || expected !== generation || abort.signal.aborted) return;
      try {
        if (host.mayRecordCompletion(action)) {
          clear();
          return;
        }
        arm(remaining());
      } catch (error) {
        clear();
        abort.abort(error);
      }
    });
  };
  return {
    signal: abort.signal,
    check() {
      const allowance = remaining();
      arm(allowance);
      const fresh = remaining();
      if (fresh < allowance) arm(fresh);
      remaining();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
    },
  };
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
