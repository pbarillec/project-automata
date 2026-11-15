import type { AnalyticsParams, AnalyticsService } from './AnalyticsService';
import type { PlatformServiceState } from './PlatformServiceTypes';
import { ANALYTICS_MAX_STRING_LENGTH } from './AnalyticsEvents.ts';
import { validateAnalyticsEvent, type AnalyticsValidationIssue } from './AnalyticsValidator.ts';

/**
 * AUT-063 non-authoritative analytics dispatcher (pure, engine-free). The ONLY object that talks to an `AnalyticsService` provider.
 *
 * - Fire-and-forget: `track` never throws, never returns a value the caller depends on, never awaits the provider.
 * - A provider that throws is swallowed and counted; after `maxConsecutiveFailures` consecutive failures the tracker disables itself
 *   (bounded logging, no retry storm). A provider that fails or times out during `initialize` leaves the tracker disabled.
 * - `validation: 'strict'` (DEBUG) validates every event against the catalogue: an invalid event is reported as a non-fatal diagnostic and NOT
 *   forwarded. `validation: 'off'` forwards the event after a cheap sanitize (primitives only, strings capped).
 * - No gameplay, state or save code reads anything from here.
 */
export type AnalyticsValidationMode = 'strict' | 'off';

export type AnalyticsTrackerDiagnostic =
    | { readonly kind: 'tracked'; readonly eventId: string; readonly params: AnalyticsParams }
    | { readonly kind: 'invalid'; readonly eventId: string; readonly issues: readonly AnalyticsValidationIssue[] }
    | { readonly kind: 'provider_failure'; readonly eventId: string; readonly consecutive: number }
    | { readonly kind: 'disabled'; readonly reason: 'init_failed' | 'init_timeout' | 'too_many_failures' };

export interface AnalyticsTrackerOptions {
    readonly validation?: AnalyticsValidationMode;
    readonly onDiagnostic?: (diagnostic: AnalyticsTrackerDiagnostic) => void;
    readonly initTimeoutMs?: number;
    /** Injected timer (the pure core owns no timers): starts a one-shot timer and returns its cancel function. Without it `initialize` has no deadline. */
    readonly startTimer?: (ms: number, onFire: () => void) => () => void;
    readonly maxConsecutiveFailures?: number;
}

export const ANALYTICS_DEFAULT_INIT_TIMEOUT_MS = 3000;
export const ANALYTICS_DEFAULT_MAX_CONSECUTIVE_FAILURES = 5;

export class AnalyticsTracker {
    private readonly service: AnalyticsService;
    private readonly validation: AnalyticsValidationMode;
    private readonly onDiagnostic: ((diagnostic: AnalyticsTrackerDiagnostic) => void) | undefined;
    private readonly initTimeoutMs: number;
    private readonly startTimer: ((ms: number, onFire: () => void) => () => void) | undefined;
    private readonly maxConsecutiveFailures: number;
    private enabled = true;
    private consecutiveFailures = 0;

    public forwarded = 0;
    public rejected = 0;
    public providerFailures = 0;

    public constructor(service: AnalyticsService, options: AnalyticsTrackerOptions = {}) {
        this.service = service;
        this.validation = options.validation ?? 'off';
        this.onDiagnostic = options.onDiagnostic;
        this.initTimeoutMs = options.initTimeoutMs ?? ANALYTICS_DEFAULT_INIT_TIMEOUT_MS;
        this.startTimer = options.startTimer;
        this.maxConsecutiveFailures = options.maxConsecutiveFailures ?? ANALYTICS_DEFAULT_MAX_CONSECUTIVE_FAILURES;
    }

    public isEnabled(): boolean {
        return this.enabled;
    }

    /** Initializes the provider off the gameplay path. Never rejects; a failure or timeout only disables analytics. */
    public async initialize(): Promise<void> {
        let cancel: (() => void) | undefined;
        try {
            const pending: Promise<PlatformServiceState | 'timeout'>[] = [this.service.initialize()];
            if (this.startTimer) pending.push(new Promise<'timeout'>((resolve) => { cancel = this.startTimer?.(this.initTimeoutMs, () => resolve('timeout')); }));
            const result = await Promise.race(pending);
            if (result === 'timeout') this.disable('init_timeout');
            else if (result.status === 'failed') this.disable('init_failed');
        }
        catch {
            this.disable('init_failed');
        }
        finally {
            try { cancel?.(); } catch { /* ignore */ }
        }
    }

    public track(eventId: string, params: Readonly<Record<string, unknown>> = {}): void {
        try {
            if (!this.enabled) return;
            let clean: AnalyticsParams;
            if (this.validation === 'strict') {
                const result = validateAnalyticsEvent(eventId, params);
                if (!result.ok) {
                    this.rejected += 1;
                    this.report({ kind: 'invalid', eventId, issues: result.issues });
                    return;
                }
                clean = params as AnalyticsParams;
            }
            else {
                clean = sanitizeParams(params);
            }
            this.forward(eventId, clean);
        }
        catch {
            // never propagates
        }
    }

    private forward(eventId: string, params: AnalyticsParams): void {
        try {
            this.service.track(eventId, { ...params });
            this.forwarded += 1;
            this.consecutiveFailures = 0;
            this.report({ kind: 'tracked', eventId, params });
        }
        catch {
            this.providerFailures += 1;
            this.consecutiveFailures += 1;
            this.report({ kind: 'provider_failure', eventId, consecutive: this.consecutiveFailures });
            if (this.consecutiveFailures >= this.maxConsecutiveFailures) this.disable('too_many_failures');
        }
    }

    private disable(reason: 'init_failed' | 'init_timeout' | 'too_many_failures'): void {
        if (!this.enabled) return;
        this.enabled = false;
        this.report({ kind: 'disabled', reason });
    }

    private report(diagnostic: AnalyticsTrackerDiagnostic): void {
        try {
            this.onDiagnostic?.(diagnostic);
        }
        catch {
            // diagnostics never affect anything
        }
    }
}

/** Primitives only; strings capped; non-finite numbers dropped. */
export function sanitizeParams(params: Readonly<Record<string, unknown>>): AnalyticsParams {
    const out: AnalyticsParams = {};
    for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'string') out[key] = value.slice(0, ANALYTICS_MAX_STRING_LENGTH);
        else if (typeof value === 'boolean') out[key] = value;
        else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    }
    return out;
}
