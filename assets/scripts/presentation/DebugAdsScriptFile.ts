/**
 * AUT-055 DEBUG / capture-only rewarded-ad script file (pure, engine-free). The Cocos side (FactoryWorldBootstrap) reads `debug_ads.json`
 * from the app files dir ONCE at session start, only when `DEBUG === true` AND device diagnostics are enabled, deletes it, and feeds the
 * parsed script to the DEBUG mock ads provider (BuildPlatformServices). Release builds never read the file.
 *
 *   { "offlineDouble": ["closed", "rewarded"], "duplicateCallback": true }
 *
 * Only allow-listed outcomes are accepted (at most 4); anything else yields null (ignored, never executed).
 */
export const DEBUG_ADS_FILE = 'debug_ads.json';
export const DEBUG_ADS_MAX_STEPS = 4;
export const DEBUG_ADS_OUTCOMES = ['rewarded', 'closed', 'failed', 'unavailable', 'timeout'] as const;
export type DebugAdsOutcome = typeof DEBUG_ADS_OUTCOMES[number];

export interface DebugAdsScript {
    readonly offlineDouble: readonly DebugAdsOutcome[];
    readonly duplicateCallback: boolean;
}

export function parseDebugAdsScriptFile(text: string | undefined): DebugAdsScript | null {
    if (text === undefined) return null;
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return null; }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const { offlineDouble, duplicateCallback } = raw as { offlineDouble?: unknown; duplicateCallback?: unknown };
    if (!Array.isArray(offlineDouble) || offlineDouble.length > DEBUG_ADS_MAX_STEPS) return null;
    if (duplicateCallback !== undefined && typeof duplicateCallback !== 'boolean') return null;
    const outcomes: DebugAdsOutcome[] = [];
    for (const item of offlineDouble) {
        if (typeof item !== 'string' || !(DEBUG_ADS_OUTCOMES as readonly string[]).includes(item)) return null;
        outcomes.push(item as DebugAdsOutcome);
    }
    return Object.freeze({ offlineDouble: Object.freeze(outcomes), duplicateCallback: duplicateCallback === true });
}
