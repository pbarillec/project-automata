import {
    CONSENT_STATUSES,
    INITIAL_CONSENT_STATE,
    type ConsentListener,
    type ConsentService,
    type ConsentState,
    type ConsentStatus,
    type PrivacyOptionsResult,
} from './ConsentService.ts';
import type { PlatformOverlayTracker } from './PlatformOverlay';

/**
 * AUT-065 consent coordinator (pure, engine-free: no `cc`, no native class names). The real transport (Android UMP through the Java bridge) and the host
 * timer are injected by the platform / build layer; tests and the DEBUG mock inject fakes.
 *
 * Contract with the native side (START-THEN-EVENT, like ads / billing):
 * - `initializeConsent(optionsJson)` returns at once a snapshot `{status, canRequestAds, privacyOptionsRequired, formVisible, settled, reason?}`; the
 *   slow UMP work (consent info update, form load / show) reports through the script event {@link CONSENT_STATE_EVENT} with the same shape.
 *   `settled:false` = the native side is still working (initial / update in flight); anything else is final until the next event.
 * - `showPrivacyOptions()` returns `{status:"started"}` or a terminal `unavailable` / `failed`; the result arrives as {@link CONSENT_PRIVACY_RESULT_EVENT}
 *   `{status:"dismissed"|"unavailable"|"failed", reason?}` followed by a state event.
 *
 * Fail-open for gameplay, fail-closed for ads: `start()` never rejects and never blocks (the caller fires it after the session is ready); a native
 * failure, a missing bridge, a malformed answer or a timeout only produce an `error` / `unavailable` state whose `canRequestAds` is the provider's
 * own answer (false unless it said otherwise). A form shown to the player (`formVisible`) is a platform overlay: it is bracketed on the shared
 * PlatformOverlayTracker (kind `consent_form`) so the activity pause it causes is never an offline absence / suspend / report.
 */
export const CONSENT_STATE_EVENT = 'automata.consent.state';
export const CONSENT_PRIVACY_RESULT_EVENT = 'automata.consent.privacy_result';
/** The native consent info update has this long to settle (the Java side has its own shorter watchdog); a visible form never times out. */
export const CONSENT_START_TIMEOUT_MS = 20_000;
/** No privacy options result this long after `started` -> resolve `timeout` and end the overlay. */
export const CONSENT_PRIVACY_TIMEOUT_MS = 10 * 60_000;
/** A consent form that never reports its end releases the overlay after this long. */
export const CONSENT_FORM_BACKSTOP_MS = 10 * 60_000;
export const CONSENT_OVERLAY_ID = 'consent_form';

export interface ConsentTransport {
    /** Synchronous native call returning the raw JSON string. */
    callString(method: string, signature: string, ...args: string[]): string;
    /** Subscribes to a native-to-script event; returns the unsubscribe function. */
    subscribe(event: string, handler: (payload: string) => void): () => void;
}

export type ConsentTimer = (callback: () => void, delayMs: number) => () => void;
export type ConsentDiagnostic = (phase: string, payload: Record<string, unknown>) => void;

export interface ConsentCoordinatorOptions {
    readonly transport: ConsentTransport;
    readonly overlay?: PlatformOverlayTracker;
    /** Host timer (injected by the build layer; this engine-free service owns no timer of its own). */
    readonly schedule: ConsentTimer;
    readonly startTimeoutMs?: number;
    readonly privacyTimeoutMs?: number;
    readonly formBackstopMs?: number;
    /** Sent as the native `initializeConsent` argument (DEBUG geography / test settings; the native side ignores them in non-debuggable builds). */
    readonly nativeOptions?: Readonly<Record<string, string | boolean>>;
    readonly onDiagnostic?: ConsentDiagnostic;
}

type NativeObject = Record<string, unknown>;

const STRING_SIGNATURE = '(Ljava/lang/String;)Ljava/lang/String;';

function parseNativeObject(raw: unknown): NativeObject {
    if (typeof raw !== 'string') return { status: 'error', reason: 'android_native_bridge_invalid_response' };
    try {
        const parsed = JSON.parse(raw) as unknown;
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as NativeObject
            : { status: 'error', reason: 'android_native_bridge_malformed_json' };
    } catch {
        return { status: 'error', reason: 'android_native_bridge_malformed_json' };
    }
}

function stringField(source: NativeObject, key: string): string {
    const value = source[key];
    return typeof value === 'string' ? value : '';
}

function booleanField(source: NativeObject, key: string): boolean {
    return source[key] === true;
}

export class ConsentCoordinator implements ConsentService {
    private readonly transport: ConsentTransport;
    private readonly overlay: PlatformOverlayTracker | undefined;
    private readonly schedule: ConsentTimer;
    private readonly startTimeoutMs: number;
    private readonly privacyTimeoutMs: number;
    private readonly formBackstopMs: number;
    private readonly nativeOptions: Readonly<Record<string, string | boolean>>;
    private readonly onDiagnostic: ConsentDiagnostic | undefined;
    private readonly listeners = new Set<ConsentListener>();
    private state: ConsentState = INITIAL_CONSENT_STATE;
    private startPromise: Promise<ConsentState> | null = null;
    private resolveStart: ((state: ConsentState) => void) | null = null;
    private cancelStartTimer: (() => void) | null = null;
    private cancelFormBackstop: (() => void) | null = null;
    private overlayActive = false;
    private subscriptions: Array<() => void> = [];
    private privacy: { resolve: (result: PrivacyOptionsResult) => void; cancelTimer: (() => void) | null; promise: Promise<PrivacyOptionsResult> } | null = null;

    public constructor(options: ConsentCoordinatorOptions) {
        this.transport = options.transport;
        this.overlay = options.overlay;
        this.schedule = options.schedule;
        this.startTimeoutMs = options.startTimeoutMs ?? CONSENT_START_TIMEOUT_MS;
        this.privacyTimeoutMs = options.privacyTimeoutMs ?? CONSENT_PRIVACY_TIMEOUT_MS;
        this.formBackstopMs = options.formBackstopMs ?? CONSENT_FORM_BACKSTOP_MS;
        this.nativeOptions = options.nativeOptions ?? {};
        this.onDiagnostic = options.onDiagnostic;
    }

    public getState(): ConsentState {
        return this.state;
    }

    public canRequestAds(): boolean {
        return this.state.canRequestAds === true;
    }

    public isPrivacyOptionsRequired(): boolean {
        return this.state.privacyOptionsRequired === true;
    }

    public subscribe(listener: ConsentListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    public start(): Promise<ConsentState> {
        if (this.startPromise !== null) return this.startPromise;
        this.startPromise = new Promise<ConsentState>((resolve) => {
            this.resolveStart = resolve;
            this.begin();
        });
        return this.startPromise;
    }

    public showPrivacyOptions(): Promise<PrivacyOptionsResult> {
        if (this.privacy !== null) return this.privacy.promise;
        if (this.state.privacyOptionsRequired !== true) {
            return Promise.resolve({ status: 'unavailable', reason: 'privacy_options_not_required' });
        }
        let resolveOuter: (result: PrivacyOptionsResult) => void = () => undefined;
        const promise = new Promise<PrivacyOptionsResult>((resolve) => { resolveOuter = resolve; });
        this.privacy = { resolve: resolveOuter, cancelTimer: null, promise };
        this.ensureSubscribed();
        this.beginOverlay();
        let started: NativeObject;
        try {
            started = parseNativeObject(this.transport.callString('showPrivacyOptions', '()Ljava/lang/String;'));
        } catch {
            this.finishPrivacy({ status: 'failed', reason: 'android_native_call_failed' });
            return promise;
        }
        if (this.privacy === null) return promise; // an early result event already completed it
        if (stringField(started, 'status') === 'started') {
            this.diagnostic('privacy_options_started', {});
            this.privacy.cancelTimer = this.schedule(() => this.finishPrivacy({ status: 'timeout', reason: 'privacy_options_timeout' }), this.privacyTimeoutMs);
        } else {
            const status = stringField(started, 'status');
            this.finishPrivacy({ status: status === 'unavailable' ? 'unavailable' : 'failed', reason: stringField(started, 'reason') || 'privacy_options_not_started' });
        }
        return promise;
    }

    /** Releases the native subscriptions and timers (tests / teardown). */
    public dispose(): void {
        for (const unsubscribe of this.subscriptions) unsubscribe();
        this.subscriptions = [];
        this.cancelStartTimer?.();
        this.cancelStartTimer = null;
        this.cancelFormBackstop?.();
        this.cancelFormBackstop = null;
        this.endOverlay();
    }

    // ------------------------------------------------------------------ internals

    private begin(): void {
        this.ensureSubscribed();
        this.armStartTimer();
        let answer: NativeObject;
        try {
            answer = parseNativeObject(this.transport.callString('initializeConsent', STRING_SIGNATURE, JSON.stringify(this.nativeOptions)));
        } catch {
            this.apply({ status: 'error', reason: 'android_native_call_failed' }, true);
            return;
        }
        this.diagnostic('init', { status: stringField(answer, 'status') || null, reason: stringField(answer, 'reason') || null });
        this.apply(answer, false);
    }

    private ensureSubscribed(): void {
        if (this.subscriptions.length > 0) return;
        try {
            this.subscriptions = [
                this.transport.subscribe(CONSENT_STATE_EVENT, (payload) => this.apply(parseNativeObject(payload), false)),
                this.transport.subscribe(CONSENT_PRIVACY_RESULT_EVENT, (payload) => this.onPrivacyResult(parseNativeObject(payload))),
            ];
        } catch {
            this.subscriptions = []; // no events: the start timeout and the privacy backstop settle everything
        }
    }

    private armStartTimer(): void {
        this.cancelStartTimer?.();
        this.cancelStartTimer = this.schedule(() => {
            this.cancelStartTimer = null;
            if (this.resolveStart === null) return;
            if (this.state.formVisible) {
                this.armStartTimer(); // the player is reading the form: never time out under it
                return;
            }
            this.diagnostic('timeout', { status: this.state.status });
            this.apply({ status: 'error', reason: 'consent_timeout', canRequestAds: this.state.canRequestAds, privacyOptionsRequired: this.state.privacyOptionsRequired }, true);
        }, this.startTimeoutMs);
    }

    /** Merges a native snapshot / event into the state. `forceSettled` is used by the local failure paths (timeout, native call failure). */
    private apply(source: NativeObject, forceSettled: boolean): void {
        const rawStatus = stringField(source, 'status');
        const known = (CONSENT_STATUSES as readonly string[]).includes(rawStatus);
        let status: ConsentStatus = known ? rawStatus as ConsentStatus : 'error';
        let reason = stringField(source, 'reason') || (known ? undefined : 'android_unknown_consent_status');
        // The native initial snapshot (`unknown`, not settled) is the only legitimate unknown; a settled unknown is an error.
        const settledFlag = source['settled'] === undefined ? status !== 'unknown' : booleanField(source, 'settled');
        const settled = forceSettled || settledFlag;
        if (settled && status === 'unknown') {
            status = 'error';
            reason = reason ?? 'consent_status_unknown';
        }
        const formVisible = booleanField(source, 'formVisible') && !forceSettled;
        // Fail-closed: only the provider's explicit `true` allows ads, and never for an unknown / unavailable status.
        const canRequestAds = booleanField(source, 'canRequestAds') && status !== 'unknown' && status !== 'unavailable';
        const next: ConsentState = Object.freeze({
            status,
            canRequestAds,
            privacyOptionsRequired: booleanField(source, 'privacyOptionsRequired'),
            formVisible,
            personalization: 'non_personalized' as const,
            ...(reason ? { reason } : {}),
        });
        const changed = next.status !== this.state.status
            || next.canRequestAds !== this.state.canRequestAds
            || next.privacyOptionsRequired !== this.state.privacyOptionsRequired
            || next.formVisible !== this.state.formVisible
            || next.reason !== this.state.reason;
        this.state = next;
        this.syncOverlay(formVisible);
        if (changed) {
            this.diagnostic('state', { status: next.status, canRequestAds: next.canRequestAds, privacyOptionsRequired: next.privacyOptionsRequired, formVisible: next.formVisible, reason: next.reason ?? null });
            for (const listener of [...this.listeners]) {
                try {
                    listener(next);
                } catch {
                    // listeners never break the provider
                }
            }
        }
        if (settled && !formVisible && this.resolveStart !== null) {
            const resolve = this.resolveStart;
            this.resolveStart = null;
            this.cancelStartTimer?.();
            this.cancelStartTimer = null;
            resolve(next);
        }
    }

    private syncOverlay(formVisible: boolean): void {
        if (formVisible) {
            this.beginOverlay();
        } else if (this.privacy === null) {
            this.endOverlay(); // a privacy options flow ends its own overlay on its result
        }
    }

    private beginOverlay(): void {
        if (this.overlayActive) return;
        this.overlayActive = true;
        this.overlay?.begin('consent_form', CONSENT_OVERLAY_ID);
        this.cancelFormBackstop?.();
        this.cancelFormBackstop = this.schedule(() => {
            this.cancelFormBackstop = null;
            this.diagnostic('form_backstop', {});
            this.endOverlay();
        }, this.formBackstopMs);
    }

    private endOverlay(): void {
        this.cancelFormBackstop?.();
        this.cancelFormBackstop = null;
        if (!this.overlayActive) return;
        this.overlayActive = false;
        try {
            this.overlay?.end(CONSENT_OVERLAY_ID);
        } catch {
            // the overlay bookkeeping never breaks the flow
        }
    }

    private onPrivacyResult(source: NativeObject): void {
        if (this.privacy === null) return;
        const status = stringField(source, 'status');
        this.finishPrivacy({
            status: status === 'dismissed' || status === 'unavailable' ? status : 'failed',
            ...(stringField(source, 'reason') ? { reason: stringField(source, 'reason') } : {}),
        });
    }

    private finishPrivacy(result: PrivacyOptionsResult): void {
        const current = this.privacy;
        if (current === null) return;
        this.privacy = null;
        current.cancelTimer?.();
        this.diagnostic('privacy_options_result', { status: result.status, reason: result.reason ?? null });
        if (!this.state.formVisible) this.endOverlay(); // ends BEFORE the promise resolves (same order as ads)
        current.resolve(result);
    }

    private diagnostic(phase: string, payload: Record<string, unknown>): void {
        try {
            this.onDiagnostic?.(phase, payload);
        } catch {
            // diagnostics never break the provider
        }
    }
}
