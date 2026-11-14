import type { RewardedAdResultStatus } from '../../services/AdsService';
import type { PurchaseResultStatus } from '../../services/PurchaseService';

export type MockAdOutcome = RewardedAdResultStatus;
export type MockPurchaseOutcome = PurchaseResultStatus;

export interface MockScriptStepBase {
    reason?: string;
    /**
     * Hold the call open until MockCallGate.release(requestId) is called. Lets tests drive a
     * deterministic timeout (or any outcome) with no real timers.
     */
    manual?: boolean;
}

export interface MockAdScriptStep extends MockScriptStepBase {
    outcome: MockAdOutcome;
    /** Simulate a provider that fires its completion callback twice. */
    duplicateCallback?: boolean;
}

export interface MockPurchaseScriptStep extends MockScriptStepBase {
    outcome: MockPurchaseOutcome;
    transactionId?: string;
    duplicateCallback?: boolean;
}

export interface MockCallRecord {
    service: 'ads' | 'purchases';
    method: string;
    requestId?: string;
    key?: string;
}

/** Ordered per-key outcome queue. Empty queue means "fall back to option behaviour". */
export class MockScriptQueue<TStep> {
    private readonly queues = new Map<string, TStep[]>();

    public enqueue(key: string, ...steps: TStep[]): void {
        const queue = this.queues.get(key) ?? [];
        queue.push(...steps);
        this.queues.set(key, queue);
    }

    public next(key: string): TStep | undefined {
        return this.queues.get(key)?.shift();
    }

    public pending(key: string): number {
        return this.queues.get(key)?.length ?? 0;
    }

    public clear(): void {
        this.queues.clear();
    }
}

/** Manual resolver: holds promises by requestId until released. No timers involved. */
export class MockCallGate {
    private readonly waiters = new Map<string, () => void>();

    public hold(requestId: string): Promise<void> {
        return new Promise<void>((resolve) => {
            this.waiters.set(requestId, resolve);
        });
    }

    public isHeld(requestId: string): boolean {
        return this.waiters.has(requestId);
    }

    public release(requestId: string): boolean {
        const resolve = this.waiters.get(requestId);
        if (resolve === undefined) {
            return false;
        }

        this.waiters.delete(requestId);
        resolve();
        return true;
    }
}
