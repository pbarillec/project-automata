/**
 * AUT-069 DEBUG / QA command executor (pure, engine-free, unit-tested with a fake port). `FactoryWorldBootstrap` builds the port and calls
 * `runDebugCommands` from its single guarded entry (`DEBUG === true` AND device diagnostics enabled); this module adds no player-facing path.
 *
 * Preference order (TECHNICAL_DESIGN: gameplay debug should use commands where feasible):
 *   - `purchaseBreakthrough` / `rebootCivilization` -> the normal command path (a GameCommand through the binding), tagged `source: 'debug'`
 *   - `mockFounderOwned` -> the real Founder grant / reconcile paths (source `mock`), never a raw state edit
 *   - `createPendingOffline` -> the coordinator's pending-offline mechanism (rewound absence cursor)
 *   - `previewReboot` -> opens the Reboot modal (the player's own chip handler); nothing is committed
 *   - grant IO / producer level / era / Robots Built / AI Cores -> the ONE DEBUG state patch entry (`DebugStatePatch`), gate-protected
 *
 * Every step emits `debug_command` diagnostics carrying `source: 'debug'`; debug-sourced events are not forwarded to analytics (the bootstrap
 * tags them, see FactoryWorldStateBinding `source`). The executor also refuses to run without an enabled gate (defence in depth).
 */
import type { GameCommand } from '../domain/Commands.ts';
import { DEBUG_SOURCE, createDebugGate, isDebugGateEnabled, type DebugGate, type DebugStatePatch } from '../runtime/DebugStatePatch.ts';

/** Re-exported so the bootstrap builds its gate without importing the runtime layer (it never touches game state). */
export { createDebugGate };
import type { DebugCommand, DebugCommandRequest } from './DebugCommandFile.ts';

export interface DebugOutcome {
    readonly ok: boolean;
    readonly reason?: string;
}

export interface DebugCommandPort {
    readonly gate: DebugGate;
    /** Resolves after `delayMs` (the bootstrap schedules it on the engine clock). */
    wait(delayMs: number): Promise<void>;
    /** A GameCommand through the normal binding path, tagged as debug-sourced. */
    submit(command: GameCommand): Promise<DebugOutcome>;
    applyStatePatch(patch: DebugStatePatch): Promise<DebugOutcome>;
    createPendingOffline(seconds: number): Promise<DebugOutcome>;
    previewReboot(): Promise<DebugOutcome>;
    setFounderOwned(owned: boolean): Promise<DebugOutcome>;
    emit(phase: string, payload: Record<string, unknown>): void;
}

export interface DebugCommandRecord {
    readonly index: number;
    readonly type: string;
    readonly ok: boolean;
    readonly reason: string | null;
    readonly source: typeof DEBUG_SOURCE;
}

async function execute(port: DebugCommandPort, command: DebugCommand): Promise<DebugOutcome> {
    switch (command.type) {
        case 'purchaseBreakthrough':
            return port.submit({ type: 'purchaseBreakthrough', breakthroughId: command.breakthroughId });
        case 'rebootCivilization':
            return port.submit({ type: 'rebootCivilization', confirmed: true });
        case 'createPendingOffline':
            return port.createPendingOffline(command.seconds);
        case 'previewReboot':
            return port.previewReboot();
        case 'mockFounderOwned':
            return port.setFounderOwned(command.owned);
        default:
            return port.applyStatePatch(command);
    }
}

/** Runs the requests in order (each `delayMs` after the previous finished). Returns one record per attempted command. */
export async function runDebugCommands(port: DebugCommandPort, requests: readonly DebugCommandRequest[]): Promise<readonly DebugCommandRecord[]> {
    const records: DebugCommandRecord[] = [];
    if (!isDebugGateEnabled(port.gate)) {
        port.emit('rejected', { source: DEBUG_SOURCE, reason: 'debug_disabled', count: requests.length });
        return records;
    }
    for (let index = 0; index < requests.length; index += 1) {
        const { command, delayMs } = requests[index];
        port.emit('scheduled', { source: DEBUG_SOURCE, index, command, delayMs });
        try {
            await port.wait(delayMs);
            port.emit('submitted', { source: DEBUG_SOURCE, index, command });
            const outcome = await execute(port, command);
            const record: DebugCommandRecord = Object.freeze({ index, type: command.type, ok: outcome.ok, reason: outcome.reason ?? null, source: DEBUG_SOURCE });
            records.push(record);
            port.emit('applied', { ...record });
        } catch (error) {
            const record: DebugCommandRecord = Object.freeze({ index, type: command.type, ok: false, reason: error instanceof Error ? error.message : 'exception', source: DEBUG_SOURCE });
            records.push(record);
            port.emit('applied', { ...record });
        }
    }
    return records;
}
