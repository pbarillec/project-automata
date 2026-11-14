/**
 * AUT-055 DEBUG / capture-only rewarded-ad script file (pure, engine-free). The Cocos side (FactoryWorldBootstrap) reads `debug_ads.json`
 * from the app files dir ONCE at session start, only when `DEBUG === true` AND device diagnostics are enabled, deletes it, and feeds the
 * parsed script to the DEBUG mock ads provider (BuildPlatformServices). Release builds never read the file.
 *
 *   { "offlineDouble": ["closed", "rewarded"], "extendedOverclock": ["rewarded"], "duplicateCallback": true }
 *
 * AUT-056: `extendedOverclock` is optional (default []); `offlineDouble` is optional too, but at least one of the two arrays must be present
 * (old offlineDouble-only files still parse). Only allow-listed outcomes are accepted (at most 4 per array); anything else yields null
 * (ignored, never executed). `duplicateCallback` applies to both placements.
 */
export const DEBUG_ADS_FILE = 'debug_ads.json';
export const DEBUG_ADS_MAX_STEPS = 4;
export const DEBUG_ADS_OUTCOMES = ['rewarded', 'closed', 'failed', 'unavailable', 'timeout'] as const;
export type DebugAdsOutcome = typeof DEBUG_ADS_OUTCOMES[number];

export interface DebugAdsScript {
    readonly offlineDouble: readonly DebugAdsOutcome[];
    readonly extendedOverclock: readonly DebugAdsOutcome[];
    readonly duplicateCallback: boolean;
}

export function parseDebugAdsScriptFile(text: string | undefined): DebugAdsScript | null {
    if (text === undefined) return null;
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return null; }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const { offlineDouble, extendedOverclock, duplicateCallback } = raw as { offlineDouble?: unknown; extendedOverclock?: unknown; duplicateCallback?: unknown };
    if (offlineDouble === undefined && extendedOverclock === undefined) return null;
    if (duplicateCallback !== undefined && typeof duplicateCallback !== 'boolean') return null;
    const offlineOutcomes = parseOutcomes(offlineDouble);
    const extendedOutcomes = parseOutcomes(extendedOverclock);
    if (offlineOutcomes === null || extendedOutcomes === null) return null;
    return Object.freeze({
        offlineDouble: offlineOutcomes,
        extendedOverclock: extendedOutcomes,
        duplicateCallback: duplicateCallback === true,
    });
}

function parseOutcomes(value: unknown): readonly DebugAdsOutcome[] | null {
    if (value === undefined) return Object.freeze([]);
    if (!Array.isArray(value) || value.length > DEBUG_ADS_MAX_STEPS) return null;
    const outcomes: DebugAdsOutcome[] = [];
    for (const item of value) {
        if (typeof item !== 'string' || !(DEBUG_ADS_OUTCOMES as readonly string[]).includes(item)) return null;
        outcomes.push(item as DebugAdsOutcome);
    }
    return Object.freeze(outcomes);
}
