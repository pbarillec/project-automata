import type { AdsService } from '../services/AdsService';
import { OFFLINE_DOUBLE_CLAIM_KEY } from '../monetization/RewardedEligibility.ts';
import { MockAdsService } from '../platform/mock/MockPlatformProviders.ts';
import { NoOpAdsService } from '../platform/noop/NoOpPlatformProviders.ts';
import type { DebugAdsScript } from './DebugAdsScriptFile.ts';

/**
 * AUT-055 build-time ads provider selection (pure, engine-free). The ONLY presentation file that references MockAdsService.
 *
 * - DEBUG build (`debug === true`): a MockAdsService, initialised, with the Offline Double placement available. The outcomes come from the
 *   optional DEBUG script (`debug_ads.json`); with none, every ad completes immediately as a verified 'rewarded'.
 * - Anything else (release): NoOpAdsService (always unavailable, so the x2 action is hidden). No mock ad ever ships. AUT-057 swaps this
 *   for the Android AdMob provider.
 */
export function createBuildAdsService(debug: boolean, script?: DebugAdsScript): AdsService {
    if (debug !== true) return new NoOpAdsService();
    const ads = new MockAdsService({ initialStatus: 'ready', placements: { [OFFLINE_DOUBLE_CLAIM_KEY]: { available: true } } });
    const steps = (script?.offlineDouble ?? []).map((outcome) => ({ outcome, duplicateCallback: script?.duplicateCallback === true }));
    if (steps.length > 0) ads.enqueueOutcomes(OFFLINE_DOUBLE_CLAIM_KEY, ...steps);
    return ads;
}
