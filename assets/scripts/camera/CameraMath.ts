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
