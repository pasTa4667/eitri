import { ControlError } from './domain.ts';
import type {
  FrozenBrowserAcceptance,
  FrozenBrowserConsumption,
  FrozenBrowserConsumptionJournal,
  FrozenBrowserRequest,
  RecoveryInventory,
} from './frozen-browser.ts';

type RetainConsumedExecution = (
  acceptance: FrozenBrowserAcceptance,
  consumption: FrozenBrowserConsumption,
) => void;

export class WorkerExecutionScope {
  private live = true;
  private controller = new AbortController();
  private journal?: Promise<FrozenBrowserConsumptionJournal>;
  private acceptance?: FrozenBrowserAcceptance;
  private consumption?: Promise<FrozenBrowserConsumption>;
  private operations = new Set<Promise<unknown>>();
  private drainage?: Promise<void>;
  private retentionFailure?: { error: unknown };
  readonly signal = this.controller.signal;

  private request: FrozenBrowserRequest;
  private open: () => Promise<FrozenBrowserConsumptionJournal>;
  private sample: () => number;
  private retain: RetainConsumedExecution;

  constructor(
    request: FrozenBrowserRequest,
    open: () => Promise<FrozenBrowserConsumptionJournal>,
    sample: () => number,
    retain: RetainConsumedExecution,
  ) {
    this.request = structuredClone(request);
    this.open = open;
    this.sample = sample;
    this.retain = retain;
  }

  currentAllowance = (): number => {
    if (!this.live) throw new ControlError('action-source-revoked');
    try {
      return this.sample();
    } catch (error) {
      this.revoke();
      throw error;
    }
  };

  private ownedJournal() {
    this.currentAllowance();
    return (this.journal ??= this.open());
  }

  private observe<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation);
    void operation.finally(() => this.operations.delete(operation)).catch(() => {});
    return operation;
  }

  accept = (): Promise<FrozenBrowserAcceptance> =>
    this.observe(
      (async () => {
        const journal = await this.ownedJournal();
        this.currentAllowance();
        const accepted = await journal.accept(structuredClone(this.request), () => {
          this.currentAllowance();
          return true;
        });
        this.currentAllowance();
        this.acceptance = structuredClone(accepted);
        return structuredClone(accepted);
      })(),
    );

  consume = (): Promise<FrozenBrowserConsumption> =>
    this.observe(
      (async () => {
        this.currentAllowance();
        if (!this.acceptance) throw new ControlError('worker-acceptance-required');
        const accepted = this.acceptance;
        this.consumption ??= (async () => {
          const journal = await this.ownedJournal();
          this.currentAllowance();
          const result = await journal.consume(
            structuredClone(accepted),
            this.currentAllowance,
            this.signal,
          );
          try {
            this.retain(structuredClone(accepted), structuredClone(result));
          } catch (error) {
            this.retentionFailure = { error };
            throw error;
          }
          return result;
        })();
        const result = await this.consumption;
        this.currentAllowance();
        return structuredClone(result);
      })(),
    );

  inventory(): Promise<RecoveryInventory> | undefined {
    return this.journal?.then((journal) => journal.inventory());
  }

  revoke() {
    this.live = false;
    if (!this.signal.aborted) this.controller.abort(new ControlError('action-source-revoked'));
  }

  close(): Promise<void> {
    this.revoke();
    return (this.drainage ??= (async () => {
      await Promise.allSettled(this.operations);
      const journal = await this.journal?.catch((error: unknown) => {
        if (
          error instanceof ControlError &&
          [
            'action-source-revoked',
            'check-dispatch-denied',
            'check-allowance-exhausted',
            'check-cancelled',
          ].includes(error.code)
        )
          return undefined;
        throw error;
      });
      await journal?.close();
      if (this.retentionFailure) throw this.retentionFailure.error;
    })());
  }
}
