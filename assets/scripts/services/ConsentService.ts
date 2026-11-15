/**
 * AUT-065 consent model (pure, engine-free). The platform consent provider (Google UMP on Android) decides whether ads may be requested;
 * gameplay never depends on it.
 *
 * Fail-open for gameplay / fail-closed for ads: whatever the consent status (unknown, error, timeout, no network, no native bridge), the game
 * starts and plays normally; ads are requested only while `canRequestAds === true`, which is the provider's own answer and defaults to false.
 *
 * MVP decision (owner can change it later): every ad request stays NON-PERSONALIZED (`npa=1`) regardless of the consent status. Consent
 * only unlocks serving ads at all; no personalization claim is made. `personalization` is therefore the constant 'non_personalized'.
 */
export type ConsentStatus =
    | 'unknown'
    | 'not_required'
    | 'required'
    | 'obtained'
    | 'unavailable'
    | 'error';

export const CONSENT_STATUSES: readonly ConsentStatus[] = Object.freeze(['unknown', 'not_required', 'required', 'obtained', 'unavailable', 'error']);

export interface ConsentState {
    readonly status: ConsentStatus;
    /** The provider's answer: true only when ads may be requested. Fail-closed default: false. */
    readonly canRequestAds: boolean;
    /** True when the player must be able to reopen the privacy options (UMP `privacyOptionsRequirementStatus === REQUIRED`). Drives the Settings row. */
    readonly privacyOptionsRequired: boolean;
    /** A consent form / privacy options form is on screen right now (a platform overlay, not an absence). */
    readonly formVisible: boolean;
    readonly personalization: 'non_personalized';
    readonly reason?: string;
}

export const INITIAL_CONSENT_STATE: ConsentState = Object.freeze({
    status: 'unknown',
    canRequestAds: false,
    privacyOptionsRequired: false,
    formVisible: false,
    personalization: 'non_personalized',
});

export type PrivacyOptionsResultStatus = 'dismissed' | 'unavailable' | 'failed' | 'timeout';

export interface PrivacyOptionsResult {
    readonly status: PrivacyOptionsResultStatus;
    readonly reason?: string;
}

export type ConsentListener = (state: ConsentState) => void;

/** The minimal read side the ads gating needs (a ConsentService satisfies it). */
export interface ConsentGate {
    canRequestAds(): boolean;
    subscribe(listener: ConsentListener): () => void;
}

export interface ConsentService extends ConsentGate {
    /** Starts the consent flow once (idempotent). NEVER rejects and never blocks gameplay: resolves with the settled (or timed-out) state. */
    start(): Promise<ConsentState>;
    getState(): ConsentState;
    isPrivacyOptionsRequired(): boolean;
    /** Reopens the privacy options form (only when `privacyOptionsRequired`); never rejects. */
    showPrivacyOptions(): Promise<PrivacyOptionsResult>;
}
