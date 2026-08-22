export interface DirtySavePolicy {
    readonly debounceSeconds: number;
    readonly periodicSeconds: number;
}

export interface DirtySaveDecisionInput {
    readonly dirty: boolean;
    readonly critical?: boolean;
    readonly elapsedSinceLastSuccessfulSaveSeconds: number;
    readonly elapsedSinceDirtySeconds: number;
}

export type DirtySaveDecisionReason =
    | 'critical'
    | 'not_dirty'
    | 'debounce_elapsed'
    | 'periodic_elapsed'
    | 'waiting';

export interface DirtySaveDecision {
    readonly shouldSave: boolean;
    readonly reason: DirtySaveDecisionReason;
}

export interface DirtySaveTrackerSnapshot {
    readonly dirty: boolean;
    readonly lastDirtyElapsedSeconds: number | null;
    readonly lastSuccessfulSaveElapsedSeconds: number;
}

export const DEFAULT_DIRTY_SAVE_POLICY: DirtySavePolicy = Object.freeze({
    debounceSeconds: 5,
    periodicSeconds: 25,
});

export function shouldSaveDirtyState(input: DirtySaveDecisionInput, policy: DirtySavePolicy): DirtySaveDecision {
    assertValidPolicy(policy);

    if (input.critical === true) {
        return Object.freeze({
            shouldSave: true,
            reason: 'critical',
        });
    }

    if (!input.dirty) {
        return Object.freeze({
            shouldSave: false,
            reason: 'not_dirty',
        });
    }

    const elapsedSinceDirty = requireNonNegativeFinite(input.elapsedSinceDirtySeconds, 'elapsedSinceDirtySeconds');
    const elapsedSinceLastSave = requireNonNegativeFinite(
        input.elapsedSinceLastSuccessfulSaveSeconds,
        'elapsedSinceLastSuccessfulSaveSeconds',
    );

    if (elapsedSinceDirty >= policy.debounceSeconds) {
        return Object.freeze({
            shouldSave: true,
            reason: 'debounce_elapsed',
        });
    }

    if (elapsedSinceLastSave >= policy.periodicSeconds) {
        return Object.freeze({
            shouldSave: true,
            reason: 'periodic_elapsed',
        });
    }

    return Object.freeze({
        shouldSave: false,
        reason: 'waiting',
    });
}

export class DirtySaveTracker {
    private dirty = false;
    private lastDirtyElapsedSeconds: number | null = null;
    private lastSuccessfulSaveElapsedSeconds: number;

    constructor(initialElapsedSeconds = 0) {
        this.lastSuccessfulSaveElapsedSeconds = requireNonNegativeFinite(initialElapsedSeconds, 'initialElapsedSeconds');
    }

    isDirty(): boolean {
        return this.dirty;
    }

    markDirty(currentElapsedSeconds: number): DirtySaveTrackerSnapshot {
        const elapsed = requireNonNegativeFinite(currentElapsedSeconds, 'currentElapsedSeconds');
        if (!this.dirty) {
            this.dirty = true;
            this.lastDirtyElapsedSeconds = elapsed;
        }

        return this.getSnapshot();
    }

    recordSaveSucceeded(currentElapsedSeconds: number): DirtySaveTrackerSnapshot {
        this.lastSuccessfulSaveElapsedSeconds = requireNonNegativeFinite(currentElapsedSeconds, 'currentElapsedSeconds');
        this.dirty = false;
        this.lastDirtyElapsedSeconds = null;
        return this.getSnapshot();
    }

    recordSaveFailed(): DirtySaveTrackerSnapshot {
        return this.getSnapshot();
    }

    shouldSave(
        currentElapsedSeconds: number,
        policy: DirtySavePolicy = DEFAULT_DIRTY_SAVE_POLICY,
        options: { readonly critical?: boolean } = {},
    ): DirtySaveDecision {
        const elapsed = requireNonNegativeFinite(currentElapsedSeconds, 'currentElapsedSeconds');
        return shouldSaveDirtyState({
            dirty: this.dirty,
            critical: options.critical,
            elapsedSinceLastSuccessfulSaveSeconds: Math.max(0, elapsed - this.lastSuccessfulSaveElapsedSeconds),
            elapsedSinceDirtySeconds: this.lastDirtyElapsedSeconds === null
                ? 0
                : Math.max(0, elapsed - this.lastDirtyElapsedSeconds),
        }, policy);
    }

    getSnapshot(): DirtySaveTrackerSnapshot {
        return Object.freeze({
            dirty: this.dirty,
            lastDirtyElapsedSeconds: this.lastDirtyElapsedSeconds,
            lastSuccessfulSaveElapsedSeconds: this.lastSuccessfulSaveElapsedSeconds,
        });
    }
}

function assertValidPolicy(policy: DirtySavePolicy): void {
    requireNonNegativeFinite(policy.debounceSeconds, 'policy.debounceSeconds');
    requireNonNegativeFinite(policy.periodicSeconds, 'policy.periodicSeconds');
}

function requireNonNegativeFinite(value: number, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new RangeError(`${label} must be a non-negative finite number.`);
    }

    return value;
}
