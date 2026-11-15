import { MOCK_CONSENT_STATES, type MockConsentStateName } from '../platform/mock/MockConsentTransport.ts';

/**
 * AUT-065 DEBUG / capture-only consent script file (pure, engine-free). The Cocos side (FactoryWorldBootstrap) reads `debug_consent.json` from the app
 * files dir ONCE at session start, only when `DEBUG === true` AND device diagnostics are enabled, deletes it, and feeds the parsed script to the DEBUG
 * consent selection (BuildPlatformServices). Release builds never read the file. Without the file a DEBUG build behaves as `not_required` (mock),
 * so every other capture is unaffected.
 *
 *   { "state": "required_obtained", "privacyOptions": true }              MOCK path (scripted transport under the real ConsentCoordinator)
 *   { "provider": "ump_test", "geography": "eea" }                       REAL Google UMP with debug geography (debuggable builds only, native-side guard)
 *
 * `state` is one of not_required | required_obtained | required_declined | error | timeout; `privacyOptions` (boolean) overrides whether the
 * privacy options entry is required. `provider: "ump_test"` selects the real UMP provider for that launch; `geography` (eea | not_eea | us_state,
 * default eea) is then passed to the native debug settings, which the native side ignores unless the app is debuggable. A mock field (`state` /
 * `privacyOptions`) next to `provider` wins (the mock takes precedence). Anything else yields null (ignored, never executed).
 */
export const DEBUG_CONSENT_FILE = 'debug_consent.json';
export const DEBUG_CONSENT_PROVIDER_UMP_TEST = 'ump_test';
export const DEBUG_CONSENT_GEOGRAPHIES = ['eea', 'not_eea', 'us_state'] as const;
export type DebugConsentGeography = typeof DEBUG_CONSENT_GEOGRAPHIES[number];

export interface DebugConsentScript {
    /** Mock state, or absent (provider-only script). */
    readonly state?: MockConsentStateName;
    readonly privacyOptions?: boolean;
    /** Present only for `ump_test` (real UMP with debug geography); absent = the mock. */
    readonly provider?: typeof DEBUG_CONSENT_PROVIDER_UMP_TEST;
    readonly geography?: DebugConsentGeography;
}

export function parseDebugConsentScriptFile(text: string | undefined): DebugConsentScript | null {
    if (text === undefined) return null;
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return null; }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const { state, privacyOptions, provider, geography } = raw as { state?: unknown; privacyOptions?: unknown; provider?: unknown; geography?: unknown };
    if (state === undefined && privacyOptions === undefined && provider === undefined) return null;
    if (state !== undefined && (typeof state !== 'string' || !(MOCK_CONSENT_STATES as readonly string[]).includes(state))) return null;
    if (privacyOptions !== undefined && typeof privacyOptions !== 'boolean') return null;
    if (provider !== undefined && provider !== DEBUG_CONSENT_PROVIDER_UMP_TEST) return null;
    if (geography !== undefined && (provider !== DEBUG_CONSENT_PROVIDER_UMP_TEST || typeof geography !== 'string' || !(DEBUG_CONSENT_GEOGRAPHIES as readonly string[]).includes(geography))) return null;
    return Object.freeze({
        ...(state !== undefined ? { state: state as MockConsentStateName } : {}),
        ...(privacyOptions !== undefined ? { privacyOptions } : {}),
        ...(provider === DEBUG_CONSENT_PROVIDER_UMP_TEST ? { provider: DEBUG_CONSENT_PROVIDER_UMP_TEST, geography: (geography as DebugConsentGeography | undefined) ?? 'eea' } : {}),
    });
}
