export interface CameraFocus {
    x: number;
    z: number;
}

export interface CameraBounds {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

export interface CameraState {
    yawDeg: number;
    pitchDeg: number;
    distance: number;
    focus: CameraFocus;
}

export interface CameraTuning {
    minPitchDeg: number;
    maxPitchDeg: number;
    minDistance: number;
    maxDistance: number;
    orbitYawDegPerPixel: number;
    orbitPitchDegPerPixel: number;
    zoomScaleMin: number;
    zoomScaleMax: number;
    panUnitsPerPixelAtDistance: number;
    focusBounds: CameraBounds;
    yawMode: 'wrap' | 'clamp';
    minYawDeg: number;
    maxYawDeg: number;
}

export interface FocusTransition {
    from: CameraFocus;
    to: CameraFocus;
    durationSeconds: number;
    elapsedSeconds: number;
}

export const DEFAULT_CAMERA_TUNING: CameraTuning = {
    minPitchDeg: 30,
    maxPitchDeg: 62,
    minDistance: 7,
    maxDistance: 24,
    orbitYawDegPerPixel: 0.18,
    orbitPitchDegPerPixel: 0.12,
    zoomScaleMin: 0.25,
    zoomScaleMax: 4,
    panUnitsPerPixelAtDistance: 0.0018,
    focusBounds: {
        minX: -9,
        maxX: 9,
        minZ: -6,
        maxZ: 8,
    },
    yawMode: 'wrap',
    minYawDeg: -180,
    maxYawDeg: 180,
};

export const DEFAULT_CAMERA_STATE: CameraState = {
    yawDeg: 135,
    pitchDeg: 48,
    distance: 15,
    focus: {
        x: 0,
        z: 0,
    },
};

export function clampNumber(value: number, min: number, max: number): number {
    const low = Math.min(min, max);
    const high = Math.max(min, max);

    if (!Number.isFinite(value)) {
        return low;
    }

    return Math.min(high, Math.max(low, value));
}

export function sanitizeFinite(value: number, fallback: number): number {
    return Number.isFinite(value) ? value : fallback;
}

export function normalizeYawDeg(yawDeg: number): number {
    if (!Number.isFinite(yawDeg)) {
        return 0;
    }

    const wrapped = ((yawDeg % 360) + 360) % 360;
    return wrapped === 360 ? 0 : wrapped;
}

export function clampYawDeg(yawDeg: number, tuning: CameraTuning = DEFAULT_CAMERA_TUNING): number {
    if (tuning.yawMode === 'clamp') {
        return clampNumber(yawDeg, tuning.minYawDeg, tuning.maxYawDeg);
    }

    return normalizeYawDeg(yawDeg);
}

export function clampFocus(focus: CameraFocus, tuning: CameraTuning = DEFAULT_CAMERA_TUNING): CameraFocus {
    return {
        x: clampNumber(focus.x, tuning.focusBounds.minX, tuning.focusBounds.maxX),
        z: clampNumber(focus.z, tuning.focusBounds.minZ, tuning.focusBounds.maxZ),
    };
}

export function clampCameraState(state: CameraState, tuning: CameraTuning = DEFAULT_CAMERA_TUNING): CameraState {
    return {
        yawDeg: clampYawDeg(state.yawDeg, tuning),
        pitchDeg: clampNumber(state.pitchDeg, tuning.minPitchDeg, tuning.maxPitchDeg),
        distance: clampNumber(state.distance, tuning.minDistance, tuning.maxDistance),
        focus: clampFocus(state.focus, tuning),
    };
}

export function applyOrbitDelta(
    state: CameraState,
    deltaPixels: { x: number; y: number },
    tuning: CameraTuning = DEFAULT_CAMERA_TUNING,
): CameraState {
    return clampCameraState({
        ...state,
        yawDeg: state.yawDeg - (sanitizeFinite(deltaPixels.x, 0) * tuning.orbitYawDegPerPixel),
        pitchDeg: state.pitchDeg + (sanitizeFinite(deltaPixels.y, 0) * tuning.orbitPitchDegPerPixel),
    }, tuning);
}

export function applyPinchZoom(
    state: CameraState,
    zoomScale: number,
    tuning: CameraTuning = DEFAULT_CAMERA_TUNING,
): CameraState {
    if (!Number.isFinite(zoomScale) || zoomScale <= 0) {
        return clampCameraState(state, tuning);
    }

    const safeScale = clampNumber(zoomScale, tuning.zoomScaleMin, tuning.zoomScaleMax);
    return clampCameraState({
        ...state,
        distance: state.distance / safeScale,
    }, tuning);
}

export function applyCameraRelativePan(
    state: CameraState,
    deltaPixels: { x: number; y: number },
    tuning: CameraTuning = DEFAULT_CAMERA_TUNING,
): CameraState {
    const yawRad = (state.yawDeg * Math.PI) / 180;
    const right = {
        x: Math.cos(yawRad),
        z: -Math.sin(yawRad),
    };
    const forward = {
        x: Math.sin(yawRad),
        z: Math.cos(yawRad),
    };
    const unitsPerPixel = tuning.panUnitsPerPixelAtDistance * clampNumber(
        state.distance,
        tuning.minDistance,
        tuning.maxDistance,
    );
    const dx = sanitizeFinite(deltaPixels.x, 0) * unitsPerPixel;
    const dy = sanitizeFinite(deltaPixels.y, 0) * unitsPerPixel;

    return clampCameraState({
        ...state,
        focus: {
            x: state.focus.x - (right.x * dx) + (forward.x * dy),
            z: state.focus.z - (right.z * dx) + (forward.z * dy),
        },
    }, tuning);
}

export function boundedFocusForTarget(
    target: CameraFocus,
    tuning: CameraTuning = DEFAULT_CAMERA_TUNING,
): CameraFocus {
    return clampFocus(target, tuning);
}

export function startFocusTransition(
    state: CameraState,
    target: CameraFocus,
    durationSeconds: number,
    tuning: CameraTuning = DEFAULT_CAMERA_TUNING,
): FocusTransition {
    return {
        from: clampFocus(state.focus, tuning),
        to: boundedFocusForTarget(target, tuning),
        durationSeconds: Math.max(0, sanitizeFinite(durationSeconds, 0)),
        elapsedSeconds: 0,
    };
}

export function stepFocusTransition(
    state: CameraState,
    transition: FocusTransition,
    deltaSeconds: number,
    tuning: CameraTuning = DEFAULT_CAMERA_TUNING,
): { state: CameraState; transition: FocusTransition | null } {
    const duration = Math.max(0, sanitizeFinite(transition.durationSeconds, 0));
    const elapsedSeconds = Math.max(0, transition.elapsedSeconds + Math.max(0, sanitizeFinite(deltaSeconds, 0)));
    const t = duration <= 0 ? 1 : clampNumber(elapsedSeconds / duration, 0, 1);
    const easedT = t * t * (3 - (2 * t));
    const focus = clampFocus({
        x: transition.from.x + ((transition.to.x - transition.from.x) * easedT),
        z: transition.from.z + ((transition.to.z - transition.from.z) * easedT),
    }, tuning);
    const nextState = clampCameraState({
        ...state,
        focus,
    }, tuning);

    if (t >= 1) {
        return {
            state: nextState,
            transition: null,
        };
    }

    return {
        state: nextState,
        transition: {
            ...transition,
            elapsedSeconds,
        },
    };
}

export function resolveFocusTransitionAfterUserInput(
    transition: FocusTransition | null,
    userInputApplied: boolean,
): FocusTransition | null {
    return userInputApplied ? null : transition;
}

export function cloneCameraState(state: CameraState): CameraState {
    return {
        yawDeg: state.yawDeg,
        pitchDeg: state.pitchDeg,
        distance: state.distance,
        focus: {
            x: state.focus.x,
            z: state.focus.z,
        },
    };
}

// ---- AUT-R-031-02 tap-first input: capability flags, gesture routing and focus distance policy ----

/** What a one-finger drag does: the AUT-031 spike orbits; FactoryWorld pans; `none` ignores it. */
export type CameraOneFingerMode = 'orbit' | 'pan' | 'none';

export interface CameraInputFlags {
    readonly oneFingerMode: CameraOneFingerMode;
    readonly multiTouchEnabled: boolean;
}

/** Defaults keep the AUT-031 CameraSpike gesture set (one-finger orbit, two-finger pan + pinch). */
export const DEFAULT_CAMERA_INPUT_FLAGS: CameraInputFlags = Object.freeze({
    oneFingerMode: 'orbit',
    multiTouchEnabled: true,
});

/** Camera-relevant gesture outputs (structurally the `orbit` / `panZoom` outputs of TouchGestureModel). */
export type CameraGestureInput =
    | { readonly type: 'orbit'; readonly deltaX: number; readonly deltaY: number }
    | { readonly type: 'panZoom'; readonly centerDeltaX: number; readonly centerDeltaY: number; readonly zoomScale: number | null };

export type CameraGestureAction = 'orbit' | 'pan' | 'panZoom' | 'ignored';

export interface CameraGestureResult {
    readonly state: CameraState;
    readonly transition: FocusTransition | null;
    /** True when the gesture moved the camera (and therefore interrupted any focus beat). */
    readonly applied: boolean;
    readonly action: CameraGestureAction;
}

/**
 * Routes one gesture through the capability flags. A switched-off gesture is a no-op: the state is
 * unchanged and a running focus transition keeps running. An applied gesture interrupts the beat.
 */
export function applyCameraGestureInput(
    state: CameraState,
    transition: FocusTransition | null,
    gesture: CameraGestureInput,
    flags: CameraInputFlags = DEFAULT_CAMERA_INPUT_FLAGS,
    tuning: CameraTuning = DEFAULT_CAMERA_TUNING,
): CameraGestureResult {
    let next: CameraState | null = null;
    let action: CameraGestureAction = 'ignored';

    if (gesture.type === 'orbit') {
        if (flags.oneFingerMode === 'orbit') {
            next = applyOrbitDelta(state, { x: gesture.deltaX, y: gesture.deltaY }, tuning);
            action = 'orbit';
        } else if (flags.oneFingerMode === 'pan') {
            next = applyCameraRelativePan(state, { x: gesture.deltaX, y: gesture.deltaY }, tuning);
            action = 'pan';
        }
    } else if (gesture.type === 'panZoom' && flags.multiTouchEnabled) {
        next = gesture.zoomScale !== null ? applyPinchZoom(state, gesture.zoomScale, tuning) : state;
        next = applyCameraRelativePan(next, { x: gesture.centerDeltaX, y: gesture.centerDeltaY }, tuning);
        action = 'panZoom';
    }

    const applied = next !== null;
    return {
        state: next ?? state,
        transition: resolveFocusTransitionAfterUserInput(transition, applied),
        applied,
        action,
    };
}

export type CameraFocusKind = 'selection' | 'reveal';

/**
 * Focus distance policy (TECHNICAL_DESIGN §13.3): a selection focus keeps (and restores) the default
 * distance; only a reveal beat pushes in to `focusDistance`, when one is configured (> 0).
 */
export function resolveFocusBeatDistance(kind: CameraFocusKind, defaultDistance: number, focusDistance: number): number {
    if (kind === 'reveal' && Number.isFinite(focusDistance) && focusDistance > 0) {
        return focusDistance;
    }
    return defaultDistance;
}

/** Smoothstep easing shared by the distance ease of a focus beat (same curve as stepFocusTransition). */
export function easeFocusProgress(t: number): number {
    const clamped = clampNumber(t, 0, 1);
    return clamped * clamped * (3 - (2 * clamped));
}

/** Distance eased alongside a focus transition: `progress` is the transition's elapsed / duration. */
export function easeFocusDistance(fromDistance: number, toDistance: number, progress: number): number {
    return fromDistance + ((toDistance - fromDistance) * easeFocusProgress(progress));
}

/** Focus bounds clamped inside `outer` (an empty intersection collapses onto the nearest edge of `outer`). */
export function intersectCameraBounds(inner: CameraBounds, outer: CameraBounds): CameraBounds {
    const minX = clampNumber(Math.max(inner.minX, outer.minX), outer.minX, outer.maxX);
    const maxX = clampNumber(Math.min(inner.maxX, outer.maxX), outer.minX, outer.maxX);
    const minZ = clampNumber(Math.max(inner.minZ, outer.minZ), outer.minZ, outer.maxZ);
    const maxZ = clampNumber(Math.min(inner.maxZ, outer.maxZ), outer.minZ, outer.maxZ);
    return {
        minX: Math.min(minX, maxX),
        maxX: Math.max(minX, maxX),
        minZ: Math.min(minZ, maxZ),
        maxZ: Math.max(minZ, maxZ),
    };
}

/**
 * Pan bounds grown just enough to contain `focus`. A focus beat may leave the focus outside the pan bounds
 * (e.g. a selection focus on a locked zone); clamping a pan to this box never snaps the camera and never
 * moves the focus further outside the bounds on either axis.
 */
export function expandCameraBoundsToInclude(bounds: CameraBounds, focus: CameraFocus): CameraBounds {
    const x = sanitizeFinite(focus.x, bounds.minX);
    const z = sanitizeFinite(focus.z, bounds.minZ);
    return {
        minX: Math.min(bounds.minX, x),
        maxX: Math.max(bounds.maxX, x),
        minZ: Math.min(bounds.minZ, z),
        maxZ: Math.max(bounds.maxZ, z),
    };
}
