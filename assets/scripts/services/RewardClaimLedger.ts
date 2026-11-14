/**
 * Pure, in-memory request-id guard. Holds no game state and is not persisted.
 * tryConsume returns true only the first time a requestId is seen.
 */
export class RewardClaimLedger {
    private readonly consumed = new Set<string>();

    public tryConsume(requestId: string): boolean {
        if (this.consumed.has(requestId)) {
            return false;
        }

        this.consumed.add(requestId);
        return true;
    }

    public has(requestId: string): boolean {
        return this.consumed.has(requestId);
    }

    public get size(): number {
        return this.consumed.size;
    }
}

export function createIdempotentRewardGuard(): (requestId: string) => boolean {
    const ledger = new RewardClaimLedger();
    return (requestId: string) => ledger.tryConsume(requestId);
}
