import type { LifecycleBonusCollectResult, LifecycleOfflineDoubleOffer, OfflineDoubleAdProof } from '../lifecycle/LifecycleSessionCoordinator.ts';
import { OFFLINE_DOUBLE_CLAIM_KEY, canOfferRewarded, type RewardedEligibilityResult } from '../monetization/RewardedEligibility.ts';
import type { AdsService, RewardedAdResult } from '../services/AdsService';

/**
 * AUT-055 pure Offline Double (rewarded x2) flow (engine-free, no `cc`).
 *
 * It connects the Offline Factory Report to the rewarded ad (`AdsService`, mock or no-op) and to the session's atomic
 * `collectPendingOfflineWithRewardedBonus(proof)`. It never grants anything itself: the ad result is only a PROOF handed to the session,
 * which verifies it, re-checks eligibility, consumes the request id and applies reward + claim + save atomically.
 *
 * Eligibility (player) and ad availability stay separate inputs, combined only by `canOfferRewarded`; the player reason wins. The x2 action
 * is offered only when both allow it (otherwise it is omitted, never shown disabled).
 *
 * Deliberately does NOT call suspend / resume: the mock ad reports no full-screen overlay, and a pending preview already survives a
 * suspend / resume. Overlay-vs-absence handling is deferred to AUT-056 / AUT-057.
 */

export type OfflineDoubleFlowResult = 'granted' | 'not_granted' | 'stale' | 'error';

/** The session surface the flow needs (structurally the binding's offline double methods). */
export interface OfflineDoubleSessionPort {
    getOfflineDoubleOffer(): LifecycleOfflineDoubleOffer | null;
    collectPendingOfflineWithRewardedBonus(proof: OfflineDoubleAdProof): Promise<LifecycleBonusCollectResult | null>;
}

export interface OfflineDoubleFlowState {
    /** True when the x2 action may be shown: the player is eligible AND the ad is available. */
    readonly offer: boolean;
    readonly blockedBy: 'player' | 'ad' | null;
    /** Display only: the projected total (2 x the normal reward). */
    readonly projectedReward: number;
    readonly inFlight: boolean;
    readonly eligibility: RewardedEligibilityResult | null;
    readonly adAvailable: boolean;
}

export type OfflineDoubleDiagnostic = (phase: string, payload: Record<string, unknown>) => void;

export interface OfflineDoubleFlowOptions {
    readonly ads: AdsService;
    readonly session: OfflineDoubleSessionPort;
    /** Epoch milliseconds; stamps the per-attempt request id. */
    readonly now: () => number;
    /** Called whenever `getState()` may have changed. */
    readonly onChange?: () => void;
    /** DEBUG diagnostics sink (the bootstrap forwards to emitDeviceEvent). */
    readonly onDiagnostic?: OfflineDoubleDiagnostic;
}

const HIDDEN_STATE: OfflineDoubleFlowState = Object.freeze({
    offer: false,
    blockedBy: 'player',
    projectedReward: 0,
    inFlight: false,
    eligibility: null,
    adAvailable: false,
});

export class OfflineDoubleFlow {
    private readonly ads: AdsService;
    private readonly session: OfflineDoubleSessionPort;
    private readonly now: () => number;
    private readonly onChange: (() => void) | undefined;
    private readonly onDiagnostic: OfflineDoubleDiagnostic | undefined;
    private state: OfflineDoubleFlowState = HIDDEN_STATE;
    private inFlight = false;
    private attemptSeq = 0;
    private refreshToken = 0;

    public constructor(options: OfflineDoubleFlowOptions) {
        this.ads = options.ads;
        this.session = options.session;
        this.now = options.now;
        this.onChange = options.onChange;
        this.onDiagnostic = options.onDiagnostic;
    }

    public getState(): OfflineDoubleFlowState {
        return this.inFlight === this.state.inFlight ? this.state : Object.freeze({ ...this.state, inFlight: this.inFlight });
    }

    /** Re-reads the session offer and the ad availability. The latest call wins; a stale refresh never overwrites a newer one. */
    public async refreshOffer(): Promise<OfflineDoubleFlowState> {
        const token = ++this.refreshToken;
        let offer: LifecycleOfflineDoubleOffer | null = null;
        try {
            offer = this.session.getOfflineDoubleOffer();
        }
        catch {
            offer = null;
        }
        let adAvailable = false;
        if (offer !== null) {
            try {
                adAvailable = (await this.ads.getRewardedAvailability(OFFLINE_DOUBLE_CLAIM_KEY)).available === true;
            }
            catch {
                adAvailable = false;
            }
        }
        if (token !== this.refreshToken) return this.getState();
        if (offer === null) {
            this.state = Object.freeze({ ...HIDDEN_STATE, inFlight: this.inFlight });
        }
        else {
            const decision = canOfferRewarded(offer.eligibility, adAvailable);
            this.state = Object.freeze({
                offer: decision.offer,
                blockedBy: decision.blockedBy,
                projectedReward: offer.projectedReward,
                inFlight: this.inFlight,
                eligibility: offer.eligibility,
                adAvailable,
            });
        }
        this.emit('offer', {
            eligible: this.state.eligibility?.eligible ?? false,
            reason: this.state.eligibility?.reason ?? 'no_offline_report',
            adAvailable,
            blockedBy: this.state.blockedBy,
            projectedReward: this.state.projectedReward,
            claimsInWindow: this.state.eligibility?.claimsInWindow ?? 0,
        });
        this.onChange?.();
        return this.getState();
    }

    /** Shows the rewarded ad and hands its result to the session as a proof. Returns null when a start is already in flight (no-op). */
    public async start(): Promise<OfflineDoubleFlowResult | null> {
        if (this.inFlight) return null;
        this.inFlight = true;
        this.onChange?.();
        this.attemptSeq += 1;
        const requestId = `offline_double:${this.now()}:${this.attemptSeq}`;
        let outcome: OfflineDoubleFlowResult = 'error';
        try {
            this.emit('ad_started', { requestId });
            const ad: RewardedAdResult = await this.ads.showRewarded({ placementId: OFFLINE_DOUBLE_CLAIM_KEY, requestId });
            this.emit('ad_result', { status: ad.status, rewardVerified: ad.rewardVerified === true, duplicate: ad.duplicate === true });
            const result = await this.session.collectPendingOfflineWithRewardedBonus({
                requestId: ad.requestId,
                placementId: ad.placementId,
                status: ad.status,
                rewardVerified: ad.rewardVerified === true,
                duplicate: ad.duplicate,
            });
            outcome = this.mapResult(result);
        }
        catch {
            outcome = 'error';
        }
        this.inFlight = false;
        if (outcome === 'not_granted') {
            // The offer may no longer stand (quota, ineligible, ad unavailable): the card re-reads it.
            await this.refreshOffer();
        }
        else {
            this.onChange?.();
        }
        return outcome;
    }

    private mapResult(result: LifecycleBonusCollectResult | null): OfflineDoubleFlowResult {
        if (result === null) return 'error';
        switch (result.status) {
            case 'no_pending_preview':
                return 'stale';
            case 'bonus_not_granted':
                this.emit('not_granted', { reason: result.reason });
                return 'not_granted';
            case 'collected_saved':
            case 'no_reward_saved':
            case 'collected_persistence_failed':
            case 'no_reward_persistence_failed': {
                if (result.bonusGranted !== true) {
                    // Fail-closed fallback: the claim could not be recorded, so the session granted only the normal reward (nothing left to collect).
                    this.emit('not_granted', { reason: 'claim_not_recorded' });
                    return 'stale';
                }
                const request = result.collect.criticalSaveRequest;
                const multiplier = request.rewardMultiplier ?? 1;
                const granted = request.grantedIndustrialOutput ?? 0;
                this.emit('granted', {
                    baseReward: multiplier > 0 ? granted / multiplier : 0,
                    grantedReward: granted,
                    multiplier,
                    claimCount: result.collect.state.monetization.rewardedClaims[OFFLINE_DOUBLE_CLAIM_KEY]?.claimCount ?? 0,
                    saveOk: result.save.ok,
                });
                return 'granted';
            }
            case 'collect_failed':
            default:
                return 'error';
        }
    }

    private emit(phase: string, payload: Record<string, unknown>): void {
        try {
            this.onDiagnostic?.(phase, payload);
        }
        catch {
            // diagnostics never affect the flow
        }
    }
}
