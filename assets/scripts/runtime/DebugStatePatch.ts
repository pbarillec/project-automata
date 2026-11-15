/**
 * AUT-069 DEBUG / QA state patch (pure, engine-free). The ONE place a debug-only state edit exists. It is never a `GameCommand`: it is not in the
 * command union, the UI cannot submit it, and every entry point demands a `DebugGate` that is only enabled when the Cocos `DEBUG` build flag is
 * true AND device diagnostics are enabled (`createDebugGate`). Release builds never construct an enabled gate, so a patch is rejected with
 * `debug_disabled` and nothing is written.
 *
 * Every accepted patch reports `source: 'debug'` (so logs / diagnostics mark it) and emits no domain event, so no event observer ever sees it.
 * Patches are strict: exact keys, known type, finite / integer / bounded numbers, ids that exist in the economy config. The resulting state
 * is validated like any other state; a patch never edits statistics that feed Prestige / progression pacing beyond the minimum that keeps the
 * state consistent (documented per type below). Reuses the normal era transition rule (forward only).
 */
import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import { applyEraTransition } from '../progression/index.ts';
import type { GameState } from '../state/GameState.ts';
import { cloneGameState } from '../state/StateClone.ts';
import { validateGameState } from '../state/StateValidation.ts';

export const DEBUG_SOURCE = 'debug' as const;

/** Bounds shared by the command-file parser and the runtime validator (one definition). */
export const DEBUG_LIMITS = Object.freeze({
    maxIndustrialOutputGrant: 1e15,
    maxProducerLevel: 1000,
    maxRobotsBuilt: 1e9,
    maxAiCoresGrant: 1000,
    /** Largest simulated absence (the offline engine caps the credited time itself). */
    maxOfflineSeconds: 14 * 86400,
    minOfflineSeconds: 1,
});

/** Only an enabled gate lets a debug entry execute. `enabled` is true only for `DEBUG === true` AND diagnostics enabled. */
export interface DebugGate {
    readonly enabled: boolean;
}

export function createDebugGate(debugBuild: boolean, diagnosticsEnabled: boolean): DebugGate {
    return Object.freeze({ enabled: debugBuild === true && diagnosticsEnabled === true });
}

export function isDebugGateEnabled(gate: unknown): boolean {
    return typeof gate === 'object' && gate !== null && (gate as DebugGate).enabled === true;
}

export type DebugStatePatch =
    /** Adds Industrial Output to the balance only (earned statistics untouched: no pacing pollution). */
    | { readonly type: 'grantIndustrialOutput'; readonly amount: number }
    /** Sets one producer's level; level >= 1 = unlocked + built, level 0 = unlocked, not built. Automation stays with the Breakthroughs. */
    | { readonly type: 'setProducerLevel'; readonly producerId: string; readonly level: number }
    /** Forward-only era change through the normal `applyEraTransition` rule. */
    | { readonly type: 'setEra'; readonly eraId: string }
    /** Sets Robots Built (run); the run peak and the lifetime counter are raised to stay consistent, never lowered. */
    | { readonly type: 'setRobotsBuilt'; readonly amount: number }
    /** Adds AI Cores to the wallet and to the lifetime-earned counter (keeps wallet <= lifetime earned). */
    | { readonly type: 'grantAiCores'; readonly amount: number };

export type DebugStatePatchType = DebugStatePatch['type'];
export const DEBUG_STATE_PATCH_TYPES: readonly DebugStatePatchType[] = Object.freeze(['grantIndustrialOutput', 'setProducerLevel', 'setEra', 'setRobotsBuilt', 'grantAiCores']);

export type DebugPatchRejectionReason =
    | 'debug_disabled'
    | 'malformed_patch'
    | 'unknown_producer'
    | 'unknown_era'
    | 'era_not_forward'
    | 'invalid_resulting_state'
    | 'execution_error';

export interface DebugPatchSuccess {
    readonly ok: true;
    readonly source: typeof DEBUG_SOURCE;
    readonly patch: DebugStatePatch;
    readonly state: GameState;
}

export interface DebugPatchRejection {
    readonly ok: false;
    readonly source: typeof DEBUG_SOURCE;
    readonly reason: DebugPatchRejectionReason;
    readonly message: string;
}

export type DebugPatchResult = DebugPatchSuccess | DebugPatchRejection;

const ID_PATTERN = /^[a-z0-9_]{1,64}$/;

function isBoundedNumber(value: unknown, min: number, max: number, integer: boolean): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const actual = Object.keys(value);
    return actual.length === keys.length && keys.every((key) => key in value);
}

/** Strict parse of an unknown value into a patch (null = not a valid patch). Used by both the command-file parser and the runtime. */
export function parseDebugStatePatch(raw: unknown): DebugStatePatch | null {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    switch (value.type) {
        case 'grantIndustrialOutput':
            if (!hasExactKeys(value, ['type', 'amount']) || !isBoundedNumber(value.amount, 1, DEBUG_LIMITS.maxIndustrialOutputGrant, false)) return null;
            return Object.freeze({ type: 'grantIndustrialOutput', amount: value.amount });
        case 'setProducerLevel':
            if (!hasExactKeys(value, ['type', 'producerId', 'level']) || typeof value.producerId !== 'string' || !ID_PATTERN.test(value.producerId)
                || !isBoundedNumber(value.level, 0, DEBUG_LIMITS.maxProducerLevel, true)) return null;
            return Object.freeze({ type: 'setProducerLevel', producerId: value.producerId, level: value.level });
        case 'setEra':
            if (!hasExactKeys(value, ['type', 'eraId']) || typeof value.eraId !== 'string' || !ID_PATTERN.test(value.eraId)) return null;
            return Object.freeze({ type: 'setEra', eraId: value.eraId });
        case 'setRobotsBuilt':
            if (!hasExactKeys(value, ['type', 'amount']) || !isBoundedNumber(value.amount, 0, DEBUG_LIMITS.maxRobotsBuilt, true)) return null;
            return Object.freeze({ type: 'setRobotsBuilt', amount: value.amount });
        case 'grantAiCores':
            if (!hasExactKeys(value, ['type', 'amount']) || !isBoundedNumber(value.amount, 1, DEBUG_LIMITS.maxAiCoresGrant, true)) return null;
            return Object.freeze({ type: 'grantAiCores', amount: value.amount });
        default:
            return null;
    }
}

function reject(reason: DebugPatchRejectionReason, message: string): DebugPatchRejection {
    return Object.freeze({ ok: false as const, source: DEBUG_SOURCE, reason, message });
}

/** Pure patch executor: validates the gate and the patch, edits a CLONE, validates the result. Never mutates `state`. */
export function executeDebugStatePatch(repository: GameConfigRepository, state: GameState, rawPatch: unknown, gate: DebugGate): DebugPatchResult {
    if (!isDebugGateEnabled(gate)) return reject('debug_disabled', 'Debug state patches are only available in DEBUG builds with diagnostics enabled.');
    const patch = parseDebugStatePatch(rawPatch);
    if (patch === null) return reject('malformed_patch', 'The debug patch is not an allow-listed, in-range shape.');
    try {
        const draft = cloneGameState(state);
        switch (patch.type) {
            case 'grantIndustrialOutput':
                draft.run.industrialOutput += patch.amount;
                break;
            case 'setProducerLevel':
                if (repository.getProducer(patch.producerId) === undefined) return reject('unknown_producer', `Unknown producer "${patch.producerId}".`);
                draft.run.producers[patch.producerId] = { level: patch.level, isUnlocked: true, isBuilt: patch.level >= 1 };
                break;
            case 'setEra': {
                if (repository.getEra(patch.eraId) === undefined) return reject('unknown_era', `Unknown era "${patch.eraId}".`);
                if (!applyEraTransition(repository, draft, patch.eraId).changed) return reject('era_not_forward', 'The era transition rule only moves forward.');
                break;
            }
            case 'setRobotsBuilt':
                draft.run.robotsBuilt = patch.amount;
                draft.run.statistics.robotsBuiltPeak = Math.max(draft.run.statistics.robotsBuiltPeak, patch.amount);
                draft.lifetime.robotsBuilt = Math.max(draft.lifetime.robotsBuilt, patch.amount);
                break;
            case 'grantAiCores':
                draft.meta.aiCores += patch.amount;
                draft.meta.lifetimeAiCoresEarned += patch.amount;
                break;
        }
        const validation = validateGameState(draft);
        if (validation.value === undefined) return reject('invalid_resulting_state', `The patch would leave an invalid state (${validation.diagnostics[0]?.code ?? 'unknown'}).`);
        return Object.freeze({ ok: true as const, source: DEBUG_SOURCE, patch, state: draft });
    } catch (error) {
        return reject('execution_error', error instanceof Error ? error.message : 'Debug patch failed.');
    }
}
