import type { AdsService } from '../services/AdsService';
import { EXTENDED_OVERCLOCK_CLAIM_KEY, OFFLINE_DOUBLE_CLAIM_KEY } from '../monetization/RewardedEligibility.ts';
import { AndroidAdsService, type AndroidAdsDiagnostic, type AndroidAdsTransport } from '../platform/android/AndroidAdsService.ts';
import { MockAdsService } from '../platform/mock/MockPlatformProviders.ts';
import { NoOpAdsService } from '../platform/noop/NoOpPlatformProviders.ts';
import type { PlatformOverlayTracker } from '../services/PlatformOverlay';
import { DEBUG_ADS_PROVIDER_ADMOB_TEST, type DebugAdsScript } from './DebugAdsScriptFile.ts';

/**
 * AUT-055 build-time ads provider selection (pure, engine-free). The ONLY presentation file that references MockAdsService.
 *
 * - DEBUG build (`debug === true`): a MockAdsService, initialised, with the Offline Double and Extended Overclock (AUT-056) placements available. The outcomes come from the
 *   optional DEBUG script (`debug_ads.json`); with none, every ad completes immediately as a verified 'rewarded'.
 * - Anything else (release): the Android AdMob provider (AUT-057) when the native transport is available, otherwise NoOpAdsService (always
 *   unavailable, so the x2 / Extended actions stay hidden). An unconfigured release build (no injected AdMob IDs) answers 'unavailable' natively,
 *   so it behaves like the no-op. No mock ad ever ships.
 * - AUT-057 DEBUG: the mock stays the default; the per-launch DEBUG script key `provider: "admob_test"` selects the real Android provider (Google
 *   sample IDs are forced natively in debuggable builds). No build flag.
 */
export interface BuildAdsDeps {
    /** The native transport (null / undefined outside an Android native build). */
    readonly androidTransport?: AndroidAdsTransport | null;
    /** ONE tracker shared with the lifecycle consumer (overlay-vs-absence). */
    readonly overlay?: PlatformOverlayTracker;
    readonly onDiagnostic?: AndroidAdsDiagnostic;
}

export function createBuildAdsService(debug: boolean, script?: DebugAdsScript, deps?: BuildAdsDeps): AdsService {
    const transport = deps?.androidTransport ?? null;
    const android = (): AdsService | null => transport === null ? null : new AndroidAdsService({ transport, overlay: deps?.overlay, onDiagnostic: deps?.onDiagnostic });
    if (debug !== true) return android() ?? new NoOpAdsService();
    if (script?.provider === DEBUG_ADS_PROVIDER_ADMOB_TEST) {
        const real = android();
        if (real !== null) return real;
    }
    const ads = new MockAdsService({ initialStatus: 'ready', placements: { [OFFLINE_DOUBLE_CLAIM_KEY]: { available: true }, [EXTENDED_OVERCLOCK_CLAIM_KEY]: { available: true } } });
    const steps = (script?.offlineDouble ?? []).map((outcome) => ({ outcome, duplicateCallback: script?.duplicateCallback === true }));
    if (steps.length > 0) ads.enqueueOutcomes(OFFLINE_DOUBLE_CLAIM_KEY, ...steps);
    const extendedSteps = (script?.extendedOverclock ?? []).map((outcome) => ({ outcome, duplicateCallback: script?.duplicateCallback === true }));
    if (extendedSteps.length > 0) ads.enqueueOutcomes(EXTENDED_OVERCLOCK_CLAIM_KEY, ...extendedSteps);
    return ads;
}
