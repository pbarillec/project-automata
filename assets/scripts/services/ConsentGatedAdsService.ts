import type { AdsService, RewardedAdRequest, RewardedAdResult } from './AdsService';
import type { ConsentGate } from './ConsentService';
import type {
    PlatformAvailability,
    PlatformOperationResult,
    PlatformServiceState,
    RewardedPlacementId,
} from './PlatformServiceTypes';

export const CONSENT_PENDING_REASON = 'consent_pending';

/**
 * AUT-065: wraps any AdsService so that NOTHING reaches the ads provider (SDK init, loads, availability, show) until the consent gate says
 * `canRequestAds()`. Fail-closed: while consent is pending / declined / errored the x2 and Extended actions stay hidden (availability false) and a
 * show resolves `unavailable` without touching the provider. Pure and engine-free; the gameplay flows only ever see an AdsService.
 */
export class ConsentGatedAdsService implements AdsService {
    private readonly inner: AdsService;
    private readonly gate: ConsentGate;

    public constructor(inner: AdsService, gate: ConsentGate) {
        this.inner = inner;
        this.gate = gate;
    }

    public async initialize(): Promise<PlatformServiceState> {
        if (!this.gate.canRequestAds()) return this.pendingState();
        return this.inner.initialize();
    }

    public getStatus(): PlatformServiceState {
        if (!this.gate.canRequestAds()) return this.pendingState();
        return this.inner.getStatus();
    }

    public async getRewardedAvailability(placementId: RewardedPlacementId): Promise<PlatformAvailability> {
        if (!this.gate.canRequestAds()) return { available: false, status: 'uninitialized', reason: CONSENT_PENDING_REASON };
        return this.inner.getRewardedAvailability(placementId);
    }

    public async preloadRewarded(placementId: RewardedPlacementId): Promise<PlatformOperationResult> {
        if (!this.gate.canRequestAds()) return { ok: false, status: 'uninitialized', reason: CONSENT_PENDING_REASON };
        return this.inner.preloadRewarded(placementId);
    }

    public async showRewarded(request: RewardedAdRequest): Promise<RewardedAdResult> {
        if (!this.gate.canRequestAds()) {
            return { status: 'unavailable', placementId: request.placementId, requestId: request.requestId, rewardVerified: false, reason: CONSENT_PENDING_REASON };
        }
        return this.inner.showRewarded(request);
    }

    private pendingState(): PlatformServiceState {
        return { kind: 'ads', status: 'uninitialized', reason: CONSENT_PENDING_REASON };
    }
}
