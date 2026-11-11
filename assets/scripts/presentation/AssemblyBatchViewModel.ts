import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import type { LaunchAssemblyBatchCommand } from '../domain/Commands.ts';
import {
    ASSEMBLY_STATION_PRODUCER_ID,
    calculateAssistedBatchPayoutForState,
    resolveAssistedBatchAvailability,
} from '../progression/index.ts';
import type { GameState } from '../state/GameState.ts';
import { formatCompactNumber } from './NumberFormatter.ts';

/**
 * AUT-GP-001 pure projection of the Assembly batch action on the Producer Panel (bottom thumb zone).
 *
 * - Visible only while the Assembly Station is selected and assisted (built, not automated): hidden at
 *   level 0, after Worker Bot and when A3 Inherited Automation makes it start automated.
 * - `ready`: enabled, emits `launchAssemblyBatch`, shows the payout the batch would pay now.
 * - `running`: visible-disabled with progress (elapsed fraction) and remaining seconds; no command, so a
 *   second tap never queues a batch. The runtime still validates every command.
 *
 * It never mutates the supplied authoritative state.
 */
export type AssemblyBatchActionState = 'hidden' | 'ready' | 'running';

export interface AssemblyBatchViewModel {
    readonly state: AssemblyBatchActionState;
    readonly visible: boolean;
    readonly enabled: boolean;
    /** 0..1 elapsed fraction of the in-flight batch; 0 unless running. */
    readonly progress: number;
    /** Whole seconds left (rounded up) while running, else null. */
    readonly remainingSeconds: number | null;
    /** Payout of a batch completing at the current rate (incl. boosts); 0 while hidden. */
    readonly payout: number;
    readonly payoutFormatted: string;
    readonly command: LaunchAssemblyBatchCommand | null;
}

const HIDDEN: AssemblyBatchViewModel = Object.freeze({
    state: 'hidden',
    visible: false,
    enabled: false,
    progress: 0,
    remainingSeconds: null,
    payout: 0,
    payoutFormatted: formatCompactNumber(0),
    command: null,
});

const LAUNCH_COMMAND: LaunchAssemblyBatchCommand = Object.freeze({ type: 'launchAssemblyBatch' });

export function createAssemblyBatchViewModel(
    repository: GameConfigRepository,
    state: GameState,
    selectedProducerId: string | null,
): AssemblyBatchViewModel {
    if (selectedProducerId !== ASSEMBLY_STATION_PRODUCER_ID) return HIDDEN;
    const availability = resolveAssistedBatchAvailability(repository, state, ASSEMBLY_STATION_PRODUCER_ID);
    if ((availability.status !== 'available' && availability.status !== 'running') || availability.config === null) return HIDDEN;

    const batch = availability.batch;
    const durationSeconds = batch?.durationSeconds ?? availability.config.batchDurationSeconds;
    const payout = calculateAssistedBatchPayoutForState(repository, state, ASSEMBLY_STATION_PRODUCER_ID, durationSeconds, 'include');
    if (availability.status === 'available' || batch === null) {
        return Object.freeze({
            state: 'ready',
            visible: true,
            enabled: true,
            progress: 0,
            remainingSeconds: null,
            payout,
            payoutFormatted: formatCompactNumber(payout),
            command: LAUNCH_COMMAND,
        });
    }

    const progress = Math.min(1, Math.max(0, 1 - batch.remainingSeconds / batch.durationSeconds));
    return Object.freeze({
        state: 'running',
        visible: true,
        enabled: false,
        progress,
        remainingSeconds: Math.max(0, Math.ceil(batch.remainingSeconds)),
        payout,
        payoutFormatted: formatCompactNumber(payout),
        command: null,
    });
}
