import type { LifecycleExtendedOverclockOffer, LifecycleExtendedOverclockResult, RewardedAdProof } from '../lifecycle/LifecycleSessionCoordinator.ts';
import { EXTENDED_OVERCLOCK_CLAIM_KEY, canOfferRewarded, type RewardedEligibilityResult } from '../monetization/RewardedEligibility.ts';
import { EXTENDED_OVERCLOCK_DURATION_SECONDS, EXTENDED_OVERCLOCK_MULTIPLIER } from '../progression/TemporaryBoosts.ts';
import type { AdsService, RewardedAdResult } from '../services/AdsService';

/**
 * AUT-056 pure Extended Overclock (rewarded x2 for 10 active minutes) flow (engine-free, no `cc`). Mirrors OfflineDoubleFlow.
 *
 * The ad result is only a PROOF handed to the session (`activateExtendedOverclockWithProof`), which verifies it, re-checks eligibility and
 * the activation preconditions, consumes the request id and applies boost + claim + save atomically. The flow never grants anything.
 *
 * Player eligibility and ad availability stay separate inputs combined only by `canOfferRewarded` (the player reason wins); the extra
 * activation gates (already active, Free Overclock locked, offline preview pending) are NOT part of eligibility and only hide the offer.
 */

export type ExtendedOverclockFlowResult = 'granted' | 'not_granted' | 'stale' | 'error';

/** The session surface the flow needs (structurally the binding's extended overclock methods). */
export interface ExtendedOverclockSessionPort {
    getExtendedOverclockOffer(): LifecycleExtendedOverclockOffer | null;
    activateExtendedOverclockWithProof(proof: RewardedAdProof): Promise<LifecycleExtendedOverclockResult | null>;
}

export interface ExtendedOverclockFlowState {
    /** True when the chip may be shown: the player is eligible, the ad is available and no activation gate blocks it. */
    readonly offer: boolean;
    readonly blockedBy: 'player' | 'ad' | 'active' | null;
    readonly inFlight: boolean;
    readonly eligibility: RewardedEligibilityResult | null;
    readonly adAvailable: boolean;
}

export type ExtendedOverclockDiagnostic = (phase: string, payload: Record<string, unknown>) => void;

export interface ExtendedOverclockFlowOptions {
    readonly ads: AdsService;
    readonly session: ExtendedOverclockSessionPort;
    /** Epoch milliseconds; stamps the per-attempt request id and the ad-availability cache. */
    readonly now: () => number;
    /** Called whenever `getState()` may have changed. */
    readonly onChange?: () => void;
    /** DEBUG diagnostics sink (the bootstrap forwards to emitDeviceEvent). */
    readonly onDiagnostic?: ExtendedOverclockDiagnostic;
}

/** The ad availability is re-read at most this often (and after every attempt). */
export const EXTENDED_OVERCLOCK_AD_AVAILABILITY_TTL_MS = 5000;

const HIDDEN_STATE: ExtendedOverclockFlowState = Object.freeze({
    offer: false,
    blockedBy: 'player',
    inFlight: false,
    eligibility: null,
    adAvailable: false,
});

export class ExtendedOverclockFlow {
    private readonly ads: AdsService;
    private readonly session: ExtendedOverclockSessionPort;
    private readonly now: () => number;
    private readonly onChange: (() => void) | undefined;
    private readonly onDiagnostic: ExtendedOverclockDiagnostic | undefined;
    private state: ExtendedOverclockFlowState = HIDDEN_STATE;
    private inFlight = false;
    private attemptSeq = 0;
    private refreshToken = 0;
    private cachedAdAvailable = false;
    private adReadAtMs: number | null = null;

    public constructor(options: ExtendedOverclockFlowOptions) {
        this.ads = options.ads;
        this.session = options.session;
        this.now = options.now;
        this.onChange = options.onChange;
        this.onDiagnostic = options.onDiagnostic;
    }

    public getState(): ExtendedOverclockFlowState {
        return this.inFlight === this.state.inFlight ? this.state : Object.freeze({ ...this.state, inFlight: this.inFlight });
    }

    /** Re-reads the session offer (and the ad availability when the cache is stale). The latest call wins. */
    public async refreshOffer(options: { readonly forceAdRead?: boolean } = {}): Promise<ExtendedOverclockFlowState> {
        const token = ++this.refreshToken;
        let offer: LifecycleExtendedOverclockOffer | null = null;
        try {
            offer = this.session.getExtendedOverclockOffer();
        }
        catch {
            offer = null;
        }
        let adAvailable = this.cachedAdAvailable;
        if (offer !== null && offer.eligibility.eligible && !offer.activeBlocked) {
            const nowMs = this.now();
            const stale = this.adReadAtMs === null || options.forceAdRead === true || !(nowMs - this.adReadAtMs < EXTENDED_OVERCLOCK_AD_AVAILABILITY_TTL_MS);
            if (stale) {
                try {
                    adAvailable = (await this.ads.getRewardedAvailability(EXTENDED_OVERCLOCK_CLAIM_KEY)).available === true;
                }
                catch {
                    adAvailable = false;
                }
                this.cachedAdAvailable = adAvailable;
                this.adReadAtMs = nowMs;
            }
        }
        if (token !== this.refreshToken) return this.getState();
        if (offer === null) {
            this.state = Object.freeze({ ...HIDDEN_STATE, inFlight: this.inFlight });
        }
        else {
            const decision = canOfferRewarded(offer.eligibility, adAvailable);
            // Player reason first; an activation gate wins over the ad reason (the ad availability is not read while gated).
            const blockedBy = decision.blockedBy === 'player' ? 'player' : offer.activeBlocked ? 'active' : decision.blockedBy;
            this.state = Object.freeze({
                offer: decision.offer && !offer.activeBlocked,
                blockedBy,
                inFlight: this.inFlight,
                eligibility: offer.eligibility,
                adAvailable,
            });
        }
        this.emit('offer', {
            eligible: this.state.eligibility?.eligible ?? false,
            reason: this.state.eligibility?.reason ?? 'unknown',
            adAvailable,
            blockedBy: this.state.blockedBy,
            activeBlocked: offer?.activeBlocked ?? false,
            claimsInWindow: this.state.eligibility?.claimsInWindow ?? 0,
        });
        this.onChange?.();
        return this.getState();
    }

    /** Shows the rewarded ad and hands its result to the session as a proof. Returns null when a start is already in flight (no-op). */
    public async start(): Promise<ExtendedOverclockFlowResult | null> {
        if (this.inFlight) return null;
        this.inFlight = true;
        this.onChange?.();
        this.attemptSeq += 1;
        const requestId = `extended_overclock:${this.now()}:${this.attemptSeq}`;
        let outcome: ExtendedOverclockFlowResult = 'error';
        try {
            this.emit('ad_started', { requestId });
            const ad: RewardedAdResult = await this.ads.showRewarded({ placementId: EXTENDED_OVERCLOCK_CLAIM_KEY, requestId });
            this.emit('ad_result', { status: ad.status, rewardVerified: ad.rewardVerified === true, duplicate: ad.duplicate === true });
            const result = await this.session.activateExtendedOverclockWithProof({
                requestId: ad.requestId,
                placementId: ad.placementId,
                status: ad.status,
                rewardVerified: ad.rewardVerified === true,
                duplicate: ad.duplicate,
            });
            outcome = this.mapResult(result, requestId);
        }
        catch {
            outcome = 'error';
        }
        this.inFlight = false;
        // After every attempt the offer is re-read (a grant hides the chip; a failure may have exhausted the quota or the ad).
        await this.refreshOffer({ forceAdRead: true });
        return outcome;
    }

    private mapResult(result: LifecycleExtendedOverclockResult | null, requestId: string): ExtendedOverclockFlowResult {
        if (result === null) return 'error';
        if (result.status === 'not_granted') {
            this.emit('not_granted', { reason: result.reason });
            return result.reason === 'already_active' || result.reason === 'offline_pending' || result.reason === 'locked' ? 'stale' : 'not_granted';
        }
        const claim = this.session.getExtendedOverclockOffer()?.eligibility;
        this.emit('granted', {
            requestId,
            multiplier: EXTENDED_OVERCLOCK_MULTIPLIER,
            durationSeconds: EXTENDED_OVERCLOCK_DURATION_SECONDS,
            claimsInWindow: claim?.claimsInWindow ?? 0,
            claimCount: claim?.claimsInWindow ?? 0,
            saveOk: result.save.ok,
        });
        return 'granted';
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
