import type {
    AdsService,
    RewardedAdRequest,
    RewardedAdResult,
    RewardedAdResultStatus,
} from '../../services/AdsService';
import type { PlatformOverlayTracker } from '../../services/PlatformOverlay';
import type {
    PlatformAvailability,
    PlatformOperationResult,
    PlatformServiceState,
    RewardedPlacementId,
} from '../../services/PlatformServiceTypes';

/**
 * AUT-057 Android ads provider (pure, engine-free: no `cc`, no native class names). The real transport is injected by
 * AndroidNativeBridge.ts; tests inject a fake one.
 *
 * Contract with the native side:
 * - synchronous getters / initialize / preload map one native call each;
 * - showRewarded is START-THEN-EVENT: the native call returns at once `{"status":"started"}` (or a terminal immediate failure) and the single
 *   final result JSON is delivered later as the script event {@link ANDROID_ADS_RESULT_EVENT}, matched by requestId.
 * The platform overlay is begun BEFORE the native call and ended BEFORE the promise resolves, so the caller never runs under the overlay.
 * Nothing here ever throws into the flows: every failure resolves `unavailable | failed | timeout`.
 */
export const ANDROID_ADS_RESULT_EVENT = 'automata.ads.rewarded_result';
/** No final result this long after the native side reported `started` -> resolve `timeout` (the ad itself keeps its own start watchdog). */
export const ANDROID_ADS_RESULT_TIMEOUT_MS = 120_000;
export const ANDROID_ADS_USED_REQUEST_LIMIT = 128;

export interface AndroidAdsTransport {
    /** Synchronous native call returning the raw JSON string. */
    callString(method: string, signature: string, ...args: string[]): string;
    /** Subscribes to a native-to-script event; returns the unsubscribe function. */
    subscribe(event: string, handler: (payload: string) => void): () => void;
}

export type AndroidAdsTimer = (callback: () => void, delayMs: number) => () => void;

export type AndroidAdsDiagnostic = (phase: string, payload: Record<string, unknown>) => void;

export interface AndroidAdsServiceOptions {
    readonly transport: AndroidAdsTransport;
    readonly overlay?: PlatformOverlayTracker;
    /** Injected timer (tests); defaults to the host timer. */
    readonly schedule?: AndroidAdsTimer;
    readonly resultTimeoutMs?: number;
    readonly onDiagnostic?: AndroidAdsDiagnostic;
}

type NativeObject = Record<string, unknown>;

const STRING_SIGNATURE = '(Ljava/lang/String;)Ljava/lang/String;';
const RESULT_STATUSES: readonly RewardedAdResultStatus[] = ['rewarded', 'closed', 'failed', 'unavailable', 'timeout'];

function defaultSchedule(callback: () => void, delayMs: number): () => void {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
}

function parseNativeObject(raw: unknown): NativeObject {
    if (typeof raw !== 'string') return { ok: false, status: 'failed', reason: 'android_native_bridge_invalid_response' };
    try {
        const parsed = JSON.parse(raw) as unknown;
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as NativeObject
            : { ok: false, status: 'failed', reason: 'android_native_bridge_malformed_json' };
    } catch {
        return { ok: false, status: 'failed', reason: 'android_native_bridge_malformed_json' };
    }
}

function stringField(source: NativeObject, key: string, fallback = ''): string {
    const value = source[key];
    return typeof value === 'string' ? value : fallback;
}

function booleanField(source: NativeObject, key: string, fallback = false): boolean {
    const value = source[key];
    return typeof value === 'boolean' ? value : fallback;
}

function serviceStatus(source: NativeObject): PlatformServiceState['status'] {
    const status = stringField(source, 'status', 'failed');
    return (['uninitialized', 'initializing', 'ready', 'unavailable', 'failed'] as const).includes(status as PlatformServiceState['status'])
        ? status as PlatformServiceState['status']
        : 'failed';
}

interface PendingRequest {
    readonly request: RewardedAdRequest;
    readonly resolve: (result: RewardedAdResult) => void;
    cancelTimer: (() => void) | null;
}

export class AndroidAdsService implements AdsService {
    private readonly transport: AndroidAdsTransport;
    private readonly overlay: PlatformOverlayTracker | undefined;
    private readonly schedule: AndroidAdsTimer;
    private readonly resultTimeoutMs: number;
    private readonly onDiagnostic: AndroidAdsDiagnostic | undefined;
    private readonly pending = new Map<string, PendingRequest>();
    /** requestId -> the first delivered result (bounded); a later show with the same id is a no-op duplicate. */
    private readonly used = new Map<string, RewardedAdResult>();
    private unsubscribe: (() => void) | null = null;
    private subscribed = false;
    private readonly lastAvailability = new Map<string, string>();

    public constructor(options: AndroidAdsServiceOptions) {
        this.transport = options.transport;
        this.overlay = options.overlay;
        this.schedule = options.schedule ?? defaultSchedule;
        this.resultTimeoutMs = options.resultTimeoutMs ?? ANDROID_ADS_RESULT_TIMEOUT_MS;
        this.onDiagnostic = options.onDiagnostic;
    }

    public async initialize(): Promise<PlatformServiceState> {
        this.ensureSubscribed();
        const state = this.serviceState(this.safeCall('initializeAds'));
        this.diagnostic('init', { status: state.status, reason: state.reason ?? null });
        return state;
    }

    public getStatus(): PlatformServiceState {
        return this.serviceState(this.safeCall('getAdsStatus'));
    }

    public async getRewardedAvailability(placementId: RewardedPlacementId): Promise<PlatformAvailability> {
        const source = this.safeCall('getRewardedAvailability', STRING_SIGNATURE, placementId);
        const available = booleanField(source, 'available');
        const result: PlatformAvailability = {
            available,
            status: available ? 'ready' : (serviceStatus(source) === 'ready' ? 'unavailable' : serviceStatus(source)),
            reason: stringField(source, 'reason') || undefined,
            message: stringField(source, 'message') || undefined,
        };
        const signature = `${result.available}:${result.reason ?? ''}`;
        if (this.lastAvailability.get(placementId) !== signature) {
            this.lastAvailability.set(placementId, signature);
            this.diagnostic('availability', { placementId, available: result.available, reason: result.reason ?? null });
        }
        return result;
    }

    public async preloadRewarded(placementId: RewardedPlacementId): Promise<PlatformOperationResult> {
        const source = this.safeCall('preloadRewarded', STRING_SIGNATURE, placementId);
        return {
            ok: booleanField(source, 'ok'),
            status: serviceStatus(source),
            reason: stringField(source, 'reason') || undefined,
            message: stringField(source, 'message') || undefined,
        };
    }

    public showRewarded(request: RewardedAdRequest): Promise<RewardedAdResult> {
        const { placementId, requestId } = request;
        const first = this.used.get(requestId);
        if (first !== undefined || this.pending.has(requestId)) {
            return Promise.resolve({
                status: first?.status ?? 'failed',
                placementId,
                requestId,
                rewardVerified: false,
                reason: first?.reason ?? 'duplicate_request_id',
                duplicate: true,
            });
        }
        return new Promise<RewardedAdResult>((resolve) => {
            const entry: PendingRequest = { request, resolve, cancelTimer: null };
            this.pending.set(requestId, entry);
            this.ensureSubscribed();
            this.overlay?.begin('rewarded_ad', requestId);
            let started: NativeObject;
            try {
                started = parseNativeObject(this.transport.callString('showRewarded', STRING_SIGNATURE, JSON.stringify(request)));
            } catch {
                this.finish(requestId, this.build(request, 'failed', false, 'android_native_call_failed'));
                return;
            }
            if (!this.pending.has(requestId)) return; // an early result event already completed it
            if (stringField(started, 'status') === 'started') {
                this.diagnostic('native_started', { placementId, requestId });
                entry.cancelTimer = this.schedule(() => {
                    this.finish(requestId, this.build(request, 'timeout', false, 'android_result_timeout'));
                }, this.resultTimeoutMs);
                return;
            }
            // A terminal immediate answer (unavailable / failed ...): no ad was shown.
            this.finish(requestId, this.toResult(request, started));
        });
    }

    /** Releases the native event subscription (tests / teardown). */
    public dispose(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.subscribed = false;
    }

    private ensureSubscribed(): void {
        if (this.subscribed) return;
        this.subscribed = true;
        try {
            this.unsubscribe = this.transport.subscribe(ANDROID_ADS_RESULT_EVENT, (payload) => this.onResultEvent(payload));
        } catch {
            this.unsubscribe = null; // pending requests then end through the backstop timeout
        }
    }

    private onResultEvent(payload: unknown): void {
        const source = parseNativeObject(payload);
        const requestId = stringField(source, 'requestId');
        const entry = this.pending.get(requestId);
        if (entry === undefined) return; // late (after the backstop) or unknown request: ignored, never granted
        this.finish(requestId, this.toResult(entry.request, source));
    }

    private toResult(request: RewardedAdRequest, source: NativeObject): RewardedAdResult {
        const rawStatus = stringField(source, 'status');
        const known = (RESULT_STATUSES as readonly string[]).includes(rawStatus);
        const status: RewardedAdResultStatus = known ? rawStatus as RewardedAdResultStatus : 'failed';
        // The grant proof requires BOTH the terminal status and the native verified flag.
        const verified = status === 'rewarded' && booleanField(source, 'rewardVerified') === true;
        return this.build(
            request,
            status,
            verified,
            stringField(source, 'reason') || (known ? undefined : 'android_unknown_result_status'),
            stringField(source, 'message') || undefined,
        );
    }

    private build(request: RewardedAdRequest, status: RewardedAdResultStatus, rewardVerified: boolean, reason?: string, message?: string): RewardedAdResult {
        const result: RewardedAdResult = {
            status,
            placementId: request.placementId,
            requestId: request.requestId,
            rewardVerified,
        };
        if (reason) result.reason = reason;
        if (message) result.message = message;
        return result;
    }

    /** The only completion path: first result wins; ends the overlay BEFORE resolving. */
    private finish(requestId: string, result: RewardedAdResult): void {
        const entry = this.pending.get(requestId);
        if (entry === undefined) return;
        this.pending.delete(requestId);
        entry.cancelTimer?.();
        entry.cancelTimer = null;
        this.remember(requestId, result);
        this.diagnostic('ad_result', { requestId, status: result.status, rewardVerified: result.rewardVerified, reason: result.reason ?? null });
        try {
            this.overlay?.end(requestId);
        } catch {
            // the overlay bookkeeping never breaks the flow
        }
        entry.resolve(result);
    }

    private remember(requestId: string, result: RewardedAdResult): void {
        this.used.set(requestId, result);
        if (this.used.size > ANDROID_ADS_USED_REQUEST_LIMIT) {
            const oldest = this.used.keys().next().value;
            if (oldest !== undefined) this.used.delete(oldest);
        }
    }

    private serviceState(source: NativeObject): PlatformServiceState {
        return {
            kind: 'ads',
            status: serviceStatus(source),
            reason: stringField(source, 'reason') || undefined,
            message: stringField(source, 'message') || undefined,
        };
    }

    private safeCall(method: string, signature = '()Ljava/lang/String;', ...args: string[]): NativeObject {
        try {
            return parseNativeObject(this.transport.callString(method, signature, ...args));
        } catch {
            return { ok: false, status: 'failed', reason: 'android_native_call_failed' };
        }
    }

    private diagnostic(phase: string, payload: Record<string, unknown>): void {
        try {
            this.onDiagnostic?.(phase, payload);
        } catch {
            // diagnostics never break the provider
        }
    }
}
