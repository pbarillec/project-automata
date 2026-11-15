import type { AdsService } from '../services/AdsService';
import { PRODUCTS } from '../services/PlatformServiceTypes.ts';
import type { PurchaseService } from '../services/PurchaseService';
import { EXTENDED_OVERCLOCK_CLAIM_KEY, OFFLINE_DOUBLE_CLAIM_KEY } from '../monetization/RewardedEligibility.ts';
import { AndroidAdsService, type AndroidAdsDiagnostic, type AndroidAdsTransport } from '../platform/android/AndroidAdsService.ts';
import { AndroidPurchaseService, type AndroidBillingDiagnostic, type AndroidBillingTransport } from '../platform/android/AndroidPurchaseService.ts';
import { MockAdsService, MockPurchaseService } from '../platform/mock/MockPlatformProviders.ts';
import { DebugAnalyticsService } from '../platform/mock/DebugAnalyticsService.ts';
import { NoOpAnalyticsService } from '../platform/noop/NoOpAnalyticsService.ts';
import { MockConsentTransport } from '../platform/mock/MockConsentTransport.ts';
import { NoOpConsentService } from '../platform/noop/NoOpConsentService.ts';
import { ConsentCoordinator, type ConsentDiagnostic, type ConsentTransport } from '../services/ConsentCoordinator.ts';
import { ConsentGatedAdsService } from '../services/ConsentGatedAdsService.ts';
import type { ConsentGate, ConsentService } from '../services/ConsentService.ts';
import { AnalyticsTracker } from '../services/AnalyticsTracker.ts';
import { NoOpAdsService, NoOpPurchaseService } from '../platform/noop/NoOpPlatformProviders.ts';
import type { PlatformOverlayTracker } from '../services/PlatformOverlay';
import { DEBUG_ADS_PROVIDER_ADMOB_TEST, type DebugAdsScript } from './DebugAdsScriptFile.ts';
import { DEBUG_PURCHASE_PROVIDER_PLAY_BILLING, type DebugPurchaseScript } from './DebugPurchaseScriptFile.ts';
import { DEBUG_CONSENT_PROVIDER_UMP_TEST, type DebugConsentScript } from './DebugConsentScriptFile.ts';

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
    /** AUT-065: when given, EVERY provider (real, mock, no-op) is wrapped so nothing reaches it until `canRequestAds()` (fail-closed for ads). */
    readonly consent?: ConsentGate;
}

export function createBuildAdsService(debug: boolean, script?: DebugAdsScript, deps?: BuildAdsDeps): AdsService {
    const inner = createUngatedBuildAdsService(debug, script, deps);
    return deps?.consent ? new ConsentGatedAdsService(inner, deps.consent) : inner;
}

function createUngatedBuildAdsService(debug: boolean, script?: DebugAdsScript, deps?: BuildAdsDeps): AdsService {
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

/**
 * AUT-059 build-time purchase provider selection (pure, engine-free). The ONLY presentation file that references MockPurchaseService.
 *
 * - DEBUG build (`debug === true`) WITH a parsed `debug_purchase.json` script: a MockPurchaseService (initialised) whose Founder product carries the
 *   scripted STORE metadata (price text, or missing), with the scripted outcomes. Entitlement source `mock`.
 * - AUT-060 release build: the Google Play Billing provider (AndroidPurchaseService) when the Android native transport exists, otherwise
 *   NoOpPurchaseService (the Founder entry stays hidden). No mock purchase ever ships; the script file is never read in release.
 * - AUT-060 DEBUG: a script with `provider: "play_billing"` (and no mock field) selects the real provider for that launch (license-tester runs);
 *   the mock script takes precedence when it carries mock fields. A DEBUG build without any script stays NoOp, so other captures are unaffected.
 */
export interface BuildPurchaseSelection {
    readonly service: PurchaseService;
    readonly source: 'store' | 'mock';
}

export interface BuildPurchaseDeps {
    /** The native transport (null / undefined outside an Android native build). */
    readonly androidTransport?: AndroidBillingTransport | null;
    /** ONE tracker shared with the lifecycle consumer (overlay-vs-absence). */
    readonly overlay?: PlatformOverlayTracker;
    readonly onDiagnostic?: AndroidBillingDiagnostic;
}

/** True when the DEBUG script carries any mock field (the mock then takes precedence over the real provider). */
function scriptHasMockFields(script: DebugPurchaseScript): boolean {
    return script.price !== null || script.metadataMissing || script.outcomes.length > 0 || script.duplicateCallback || script.restore !== undefined;
}

export function createBuildPurchaseService(debug: boolean, script?: DebugPurchaseScript, deps?: BuildPurchaseDeps): BuildPurchaseSelection {
    const transport = deps?.androidTransport ?? null;
    const android = (): BuildPurchaseSelection | null => transport === null
        ? null
        : { service: new AndroidPurchaseService({ transport, overlay: deps?.overlay, onDiagnostic: deps?.onDiagnostic }), source: 'store' };
    if (debug !== true) return android() ?? { service: new NoOpPurchaseService(), source: 'store' };
    if (script?.provider === DEBUG_PURCHASE_PROVIDER_PLAY_BILLING && !scriptHasMockFields(script)) {
        return android() ?? { service: new NoOpPurchaseService(), source: 'store' };
    }
    if (script === undefined) return { service: new NoOpPurchaseService(), source: 'store' };
    const products = script.metadataMissing
        ? []
        : [{ productId: PRODUCTS.founderPack, type: 'durable' as const, available: true, ...(script.price !== null ? { localizedPrice: script.price } : {}) }];
    const purchases = new MockPurchaseService({ initialStatus: 'uninitialized', products, ...(script.restore !== undefined ? { restore: script.restore, restoreProductId: PRODUCTS.founderPack } : {}) });
    const steps = script.outcomes.map((outcome) => ({ outcome }));
    if (steps.length > 0) purchases.enqueueOutcomes(PRODUCTS.founderPack, ...steps);
    return { service: purchases, source: 'mock' };
}

/**
 * AUT-063 build-time analytics selection (pure, engine-free). DEBUG: the Debug (logging) provider with STRICT catalogue validation, diagnostics forwarded to `onDiagnostic`.
 * Release: the NoOp provider (no vendor SDK is bundled yet; the production provider is a release-stage decision) with validation off. Either way the tracker is non-authoritative.
 */
export function createBuildAnalyticsTracker(debug: boolean, onDiagnostic?: (phase: string, payload: Record<string, unknown>) => void): AnalyticsTracker {
    const startTimer = (ms: number, onFire: () => void): (() => void) => { const handle = setTimeout(onFire, ms); return () => clearTimeout(handle); };
    if (debug !== true) return new AnalyticsTracker(new NoOpAnalyticsService(), { validation: 'off', startTimer });
    return new AnalyticsTracker(new DebugAnalyticsService(), {
        validation: 'strict',
        startTimer,
        onDiagnostic: (diagnostic) => {
            const { kind, ...rest } = diagnostic;
            onDiagnostic?.(kind, rest);
        },
    });
}

/**
 * AUT-065 build-time consent selection (pure, engine-free). The consent provider decides whether ads may be requested; it never gates gameplay.
 *
 * - Release: the Google UMP provider (ConsentCoordinator over the native transport) when the Android bridge exists, otherwise NoOpConsentService
 *   (`unavailable`, ads fail-closed, no privacy options entry). The DEBUG script is never read in release.
 * - DEBUG, no script: a mock `not_required` (every other capture unaffected) UNLESS the ads script selects the real provider (`admob_test`), which needs a
 *   real consent state: then the real UMP runs with the device's own geography.
 * - DEBUG script mock fields (`state` / `privacyOptions`): the scripted mock transport under the real coordinator (takes precedence).
 * - DEBUG script `provider: "ump_test"`: the real UMP with the scripted debug geography (the native side ignores it unless the app is debuggable).
 */
export interface BuildConsentDeps {
    /** The native transport (null / undefined outside an Android native build). */
    readonly androidTransport?: ConsentTransport | null;
    /** ONE tracker shared with the lifecycle consumer (overlay-vs-absence). */
    readonly overlay?: PlatformOverlayTracker;
    readonly onDiagnostic?: ConsentDiagnostic;
}

/** Mock transports answer in microtasks; a scripted `timeout` must not make a capture wait the production 20 s. */
export const MOCK_CONSENT_START_TIMEOUT_MS = 4_000;

export function createBuildConsentService(debug: boolean, script?: DebugConsentScript, deps?: BuildConsentDeps, adsScript?: DebugAdsScript): ConsentService {
    const transport = deps?.androidTransport ?? null;
    const schedule = (callback: () => void, ms: number): (() => void) => { const handle = setTimeout(callback, ms); return () => clearTimeout(handle); };
    const real = (nativeOptions?: Record<string, string | boolean>): ConsentService | null => transport === null
        ? null
        : new ConsentCoordinator({ transport, overlay: deps?.overlay, schedule, onDiagnostic: deps?.onDiagnostic, nativeOptions });
    if (debug !== true) return real() ?? new NoOpConsentService();
    const mock = (state: NonNullable<DebugConsentScript['state']>, privacyOptions?: boolean): ConsentService => new ConsentCoordinator({
        transport: new MockConsentTransport({ state, ...(privacyOptions !== undefined ? { privacyOptions } : {}) }),
        overlay: deps?.overlay,
        schedule,
        onDiagnostic: deps?.onDiagnostic,
        startTimeoutMs: MOCK_CONSENT_START_TIMEOUT_MS,
    });
    if (script !== undefined && (script.state !== undefined || script.privacyOptions !== undefined)) return mock(script.state ?? 'not_required', script.privacyOptions);
    if (script?.provider === DEBUG_CONSENT_PROVIDER_UMP_TEST) {
        const provider = real({ debugGeography: script.geography ?? 'eea' });
        if (provider !== null) return provider;
    }
    if (adsScript?.provider === DEBUG_ADS_PROVIDER_ADMOB_TEST) {
        const provider = real();
        if (provider !== null) return provider;
    }
    return mock('not_required');
}
