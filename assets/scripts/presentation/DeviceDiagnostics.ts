/**
 * AUT-INFRA-001 structured device diagnostics.
 *
 * One JSON line per event, `[AUT-DEVICE] {"v":1,"seq":n,"evt":"...",...}`, read back from
 * logcat by the device harness (`tools/device/`). Engine-free so the protocol is shared by
 * the presentation code and the Node tooling and can be unit-tested without `cc`.
 *
 * Disabled by default: `emitDeviceEvent` is a no-op until `configureDeviceDiagnostics`
 * enables it. Only FactoryWorldBootstrap enables it, and only when the Cocos `DEBUG`
 * build flag is true, so release builds never emit or depend on these events.
 * Emitting never changes presentation or gameplay behaviour.
 */
export const DEVICE_DIAGNOSTIC_PREFIX = '[AUT-DEVICE]';
export const DEVICE_DIAGNOSTIC_VERSION = 1;

export const DEVICE_EVENT_TYPES = [
    'scene_ready',
    'reveal_state',
    'touch_start',
    'touch_end',
    'selection_raycast',
    'selection_state',
    'marker_state',
    'camera_focus',
    'zones_projected',
    // AUT-INT-001: persistent session lifecycle (ready | suspended | resumed | load_failed).
    'session_state',
    // AUT-R-036: HUD / panel / Button screen rectangles (bottom-left window frame) after session ready and on resize.
    'ui_layout',
    // AUT-UI-001: the session's result for each submitted command: { command, ok, reason, eventTypes, industrialOutput }.
    'command_result',
    // AUT-R-031-02: camera pose after a player gesture ends: { yaw, pitch, distance, focus, bounds, input, screen, zones }.
    'camera_state',
    // AUT-GP-001: Assembly batch action: { phase: 'ui', state, visible, enabled, progress, remainingSeconds, payout, caption }
    // on each UI state change / 10% of progress, and { phase: 'launched' | 'completed', producerId, durationSeconds, payout? }.
    'assembly_batch',
    // AUT-039: first Worker Bot presentation: { phase: 'synced' | 'reveal_started' | 'reveal_complete' | 'loop_started' | 'waypoint', ... }.
    'robot_state',
    // AUT-040: reusable construction sequence: { phase: 'started' | 'activated', producerId, modules?, durationSeconds? }.
    'construction_state',
    // AUT-041: capped robot population: { phase: 'synced' | 'changed', source, robotsBuilt, visible, pooled, instantiated }.
    'robot_population',
    // AUT-041 DEBUG benchmark: { visible, window, frames, seconds, avgMs, p95Ms, maxMs, fps } per sampled window; `robot_benchmark` once when the override is read.
    'robot_perf',
    'robot_benchmark',
    // AUT-042: Robot Line / Era II reveal hook: { phase: 'synced' | 'construction_started' | 'activated' | 'focus_requested' | 'item_cycle', ... }.
    'robot_line_state',
    'error',
] as const;

export type DeviceEventType = typeof DEVICE_EVENT_TYPES[number];
export type DeviceEventPayload = Record<string, unknown>;
export type DeviceDiagnosticsSink = (line: string) => void;

interface DiagnosticsState {
    enabled: boolean;
    sink: DeviceDiagnosticsSink;
    seq: number;
}

const state: DiagnosticsState = {
    enabled: false,
    sink: (line) => console.log(line),
    seq: 0,
};

export function configureDeviceDiagnostics(options: { enabled: boolean; sink?: DeviceDiagnosticsSink }): void {
    state.enabled = options.enabled === true;
    if (options.sink) state.sink = options.sink;
    state.seq = 0;
}

export function isDeviceDiagnosticsEnabled(): boolean {
    return state.enabled;
}

/** Rounds numbers to 2 decimals (recursively) so lines stay short and stable across runs. */
export function roundForDiagnostics(value: unknown): unknown {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return String(value);
        return Math.round(value * 100) / 100;
    }
    if (Array.isArray(value)) return value.map((item) => roundForDiagnostics(item));
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            if (item !== undefined) out[key] = roundForDiagnostics(item);
        }
        return out;
    }
    return value;
}

export function formatDeviceEvent(evt: DeviceEventType, seq: number, payload: DeviceEventPayload = {}): string {
    const body = roundForDiagnostics({ ...payload, v: DEVICE_DIAGNOSTIC_VERSION, seq, evt }) as Record<string, unknown>;
    // Keep v/seq/evt first for readability in raw logcat.
    const ordered = { v: body.v, seq: body.seq, evt: body.evt, ...body };
    return `${DEVICE_DIAGNOSTIC_PREFIX} ${JSON.stringify(ordered)}`;
}

/** Emits one event line when enabled. Never throws into the caller. */
export function emitDeviceEvent(evt: DeviceEventType, payload: DeviceEventPayload = {}): void {
    if (!state.enabled) return;
    try {
        state.seq += 1;
        state.sink(formatDeviceEvent(evt, state.seq, payload));
    } catch {
        // Diagnostics must never affect the caller.
    }
}

export interface ParsedDeviceEvent {
    v: number;
    seq: number;
    evt: string;
    [key: string]: unknown;
}

/** Extracts the event from any line that contains the prefix (logcat adds its own header). */
export function parseDeviceEventLine(line: string): ParsedDeviceEvent | null {
    const index = line.indexOf(DEVICE_DIAGNOSTIC_PREFIX);
    if (index < 0) return null;
    const json = line.slice(index + DEVICE_DIAGNOSTIC_PREFIX.length).trim();
    try {
        const value = JSON.parse(json) as unknown;
        if (!value || typeof value !== 'object') return null;
        const event = value as ParsedDeviceEvent;
        if (typeof event.evt !== 'string' || typeof event.seq !== 'number') return null;
        return event;
    } catch {
        return null;
    }
}

type ErrorHandlerHost = {
    __errorHandler?: (...args: unknown[]) => unknown;
    addEventListener?: (type: string, listener: (event: unknown) => void) => void;
    __autDeviceErrorHookInstalled?: boolean;
};

/**
 * Chains the Cocos native `__errorHandler` hook and the web `error` event so uncaught
 * exceptions also produce an `error` event. Existing handlers keep running unchanged.
 */
export function installDeviceErrorHook(host: unknown = globalThis): void {
    if (!state.enabled || !host || typeof host !== 'object') return;
    const target = host as ErrorHandlerHost;
    if (target.__autDeviceErrorHookInstalled) return;
    target.__autDeviceErrorHookInstalled = true;
    const previous = target.__errorHandler;
    target.__errorHandler = (...args: unknown[]) => {
        const [file, line, message, stack] = args;
        emitDeviceEvent('error', { source: 'native_error_handler', file: String(file ?? ''), line: Number(line ?? 0), message: String(message ?? ''), stack: String(stack ?? '').slice(0, 400) });
        return previous?.(...args);
    };
    target.addEventListener?.('error', (event: unknown) => {
        const e = event as { message?: unknown; error?: { stack?: unknown } } | null;
        emitDeviceEvent('error', { source: 'window_error', message: String(e?.message ?? ''), stack: String(e?.error?.stack ?? '').slice(0, 400) });
    });
}
