import {
    _decorator,
    Camera,
    Component,
    EventTouch,
    input,
    Input,
    Node,
    UITransform,
    Vec2,
    Vec3,
} from 'cc';
import {
    applyCameraGestureInput,
    boundedFocusForTarget,
    CameraBounds,
    CameraFocusKind,
    CameraInputFlags,
    CameraOneFingerMode,
    CameraState,
    CameraTuning,
    clampCameraState,
    DEFAULT_CAMERA_INPUT_FLAGS,
    DEFAULT_CAMERA_STATE,
    DEFAULT_CAMERA_TUNING,
    easeFocusDistance,
    expandCameraBoundsToInclude,
    FocusTransition,
    resolveFocusBeatDistance,
    startFocusTransition,
    stepFocusTransition,
} from './CameraMath';
import { GestureOutput, TouchGestureTracker } from './TouchGestureModel';
import { emitDeviceEvent, isDeviceDiagnosticsEnabled } from '../presentation/DeviceDiagnostics';

const { ccclass, property } = _decorator;

@ccclass('MobileCameraController')
export class MobileCameraController extends Component {
    @property(Camera)
    public cameraComponent: Camera | null = null;

    @property([Node])
    public uiBlockerNodes: Node[] = [];

    @property
    public dragThresholdPixels = 12;

    @property
    public minPitchDeg = DEFAULT_CAMERA_TUNING.minPitchDeg;

    @property
    public maxPitchDeg = DEFAULT_CAMERA_TUNING.maxPitchDeg;

    @property
    public minDistance = DEFAULT_CAMERA_TUNING.minDistance;

    @property
    public maxDistance = DEFAULT_CAMERA_TUNING.maxDistance;

    @property
    public orbitYawDegPerPixel = DEFAULT_CAMERA_TUNING.orbitYawDegPerPixel;

    @property
    public orbitPitchDegPerPixel = DEFAULT_CAMERA_TUNING.orbitPitchDegPerPixel;

    @property
    public panUnitsPerPixelAtDistance = DEFAULT_CAMERA_TUNING.panUnitsPerPixelAtDistance;

    @property
    public focusMinX = DEFAULT_CAMERA_TUNING.focusBounds.minX;

    @property
    public focusMaxX = DEFAULT_CAMERA_TUNING.focusBounds.maxX;

    @property
    public focusMinZ = DEFAULT_CAMERA_TUNING.focusBounds.minZ;

    @property
    public focusMaxZ = DEFAULT_CAMERA_TUNING.focusBounds.maxZ;

    @property
    public defaultYawDeg = DEFAULT_CAMERA_STATE.yawDeg;

    @property
    public defaultPitchDeg = DEFAULT_CAMERA_STATE.pitchDeg;

    @property
    public defaultDistance = DEFAULT_CAMERA_STATE.distance;

    @property
    public defaultFocusX = DEFAULT_CAMERA_STATE.focus.x;

    @property
    public defaultFocusZ = DEFAULT_CAMERA_STATE.focus.z;

    @property
    public focusDistance = 0;

    @property
    public focusHeight = 0;

    @property
    public focusTransitionSeconds = 0.45;

    /** AUT-R-031-02: what a one-finger drag does. The default ('orbit') keeps the AUT-031 CameraSpike set. */
    @property
    public oneFingerMode: CameraOneFingerMode = DEFAULT_CAMERA_INPUT_FLAGS.oneFingerMode;

    /** AUT-R-031-02: two-finger pan + pinch zoom. The default (true) keeps the AUT-031 CameraSpike set. */
    @property
    public multiTouchEnabled = DEFAULT_CAMERA_INPUT_FLAGS.multiTouchEnabled;

    /** AUT-R-031-02: called once when a touch sequence that moved the camera has fully ended (diagnostics only). */
    public onCameraGestureEnded: ((state: CameraState) => void) | null = null;

    private tracker: TouchGestureTracker = new TouchGestureTracker();
    private state: CameraState = { ...DEFAULT_CAMERA_STATE, focus: { ...DEFAULT_CAMERA_STATE.focus } };
    private focusTransition: FocusTransition | null = null;
    /** Distance eased alongside the running focus transition (null when the beat keeps the distance). */
    private focusDistanceEase: { from: number; to: number } | null = null;
    /** AUT-R-031-02: player pan bounds (the unlocked zones); null = the serialized global focus bounds. */
    private panBounds: CameraBounds | null = null;
    private cameraMovedByGesture = false;
    private lastTapMarker: Vec2 | null = null;

    public onLoad(): void {
        this.tracker = new TouchGestureTracker({
            dragThresholdPixels: this.dragThresholdPixels,
            pinchMinDistancePixels: 4,
        });
        this.state = clampCameraState({
            yawDeg: this.defaultYawDeg,
            pitchDeg: this.defaultPitchDeg,
            distance: this.defaultDistance,
            focus: { x: this.defaultFocusX, z: this.defaultFocusZ },
        }, this.tuning());
        this.applyCameraPose();

        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    public onDestroy(): void {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    public update(deltaSeconds: number): void {
        if (!this.focusTransition) {
            return;
        }

        const result = stepFocusTransition(this.state, this.focusTransition, deltaSeconds, this.tuning());
        this.state = result.state;
        this.focusTransition = result.transition;
        if (this.focusDistanceEase) {
            const progress = result.transition && result.transition.durationSeconds > 0
                ? result.transition.elapsedSeconds / result.transition.durationSeconds
                : 1;
            this.state = clampCameraState({
                ...this.state,
                distance: easeFocusDistance(this.focusDistanceEase.from, this.focusDistanceEase.to, progress),
            }, this.tuning());
            if (!result.transition) this.focusDistanceEase = null;
        }
        this.applyCameraPose();
        if (!this.focusTransition && isDeviceDiagnosticsEnabled()) {
            emitDeviceEvent('camera_focus', { phase: 'settled', focus: { ...this.state.focus }, distance: this.state.distance });
        }
    }

    /** Read-only: true while a focus transition is animating (AUT-INFRA-001 diagnostics). */
    public isFocusTransitionActive(): boolean {
        return this.focusTransition !== null;
    }

    /** Selection focus: eases to the target and to the default distance (TECHNICAL_DESIGN §13.3). */
    public focusOnWorldTarget(target: Vec3): void {
        this.startFocusBeat(target, 'selection');
    }

    /** Reveal/payoff beat: eases to the target and pushes in to `focusDistance` (the default distance when 0). */
    public focusOnRevealTarget(target: Vec3): void {
        this.startFocusBeat(target, 'reveal');
    }

    /**
     * AUT-R-031-02: bounds that clamp the player's pan (the unlocked zones); null restores the global bounds.
     * Automatic focus beats keep the global focus bounds; nothing moves when the bounds change.
     */
    public setFocusBounds(bounds: CameraBounds | null): void {
        this.panBounds = bounds ? { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: bounds.maxZ } : null;
    }

    /** The bounds that clamp the player's pan. */
    public getFocusBounds(): CameraBounds {
        return this.panBounds ? { ...this.panBounds } : { ...this.tuning().focusBounds };
    }

    /** The serialized global focus bounds (focusMinX..focusMaxZ). */
    public getGlobalFocusBounds(): CameraBounds {
        return { minX: this.focusMinX, maxX: this.focusMaxX, minZ: this.focusMinZ, maxZ: this.focusMaxZ };
    }

    public getInputFlags(): CameraInputFlags {
        return { oneFingerMode: this.oneFingerMode, multiTouchEnabled: this.multiTouchEnabled };
    }

    private startFocusBeat(target: Vec3, kind: CameraFocusKind): void {
        const fromDistance = this.state.distance;
        const distance = clampCameraState({
            ...this.state,
            distance: resolveFocusBeatDistance(kind, this.defaultDistance, this.focusDistance),
        }, this.tuning()).distance;
        this.focusDistanceEase = distance !== fromDistance ? { from: fromDistance, to: distance } : null;
        this.focusTransition = startFocusTransition(
            this.state,
            { x: target.x, z: target.z },
            this.focusTransitionSeconds,
            this.tuning(),
        );
        if (isDeviceDiagnosticsEnabled()) {
            emitDeviceEvent('camera_focus', { phase: 'started', kind, target: { x: target.x, y: target.y, z: target.z }, distance, fromDistance, defaultDistance: this.defaultDistance, seconds: this.focusTransitionSeconds });
        }
    }

    public applyConfiguredInitialView(): void {
        this.focusTransition = null;
        this.focusDistanceEase = null;
        this.state = clampCameraState({
            yawDeg: this.defaultYawDeg,
            pitchDeg: this.defaultPitchDeg,
            distance: this.defaultDistance,
            focus: { x: this.defaultFocusX, z: this.defaultFocusZ },
        }, this.tuning());
        this.applyCameraPose();
    }

    public snapToWorldTarget(target: Vec3): void {
        this.focusTransition = null;
        this.focusDistanceEase = null;
        this.state = clampCameraState({
            ...this.state,
            focus: boundedFocusForTarget({ x: target.x, z: target.z }, this.tuning()),
        }, this.tuning());
        this.applyCameraPose();
    }

    public getCameraState(): CameraState {
        return {
            yawDeg: this.state.yawDeg,
            pitchDeg: this.state.pitchDeg,
            distance: this.state.distance,
            focus: { ...this.state.focus },
        };
    }

    public getLastTapMarker(): Vec2 | null {
        return this.lastTapMarker ? this.lastTapMarker.clone() : null;
    }

    private onTouchStart(event: EventTouch): void {
        const touch = this.primaryTouch(event);
        if (!touch) {
            return;
        }

        const location = touch.getLocation();
        const consumedByUi = this.isUiBlocked(location);
        this.handleOutputs(this.tracker.begin({
            id: touch.getID(),
            x: location.x,
            y: location.y,
            consumedByUi,
        }));
    }

    private onTouchMove(event: EventTouch): void {
        const touch = this.primaryTouch(event);
        if (!touch) {
            return;
        }

        const location = touch.getLocation();
        this.handleOutputs(this.tracker.move({
            id: touch.getID(),
            x: location.x,
            y: location.y,
        }));
    }

    private onTouchEnd(event: EventTouch): void {
        const touch = this.primaryTouch(event);
        if (!touch) {
            return;
        }

        const location = touch.getLocation();
        this.handleOutputs(this.tracker.end({
            id: touch.getID(),
            x: location.x,
            y: location.y,
        }));
        this.reportGestureEndIfReleased();
    }

    private onTouchCancel(event: EventTouch): void {
        const touch = this.primaryTouch(event);
        if (!touch) {
            this.tracker.cancel();
            this.reportGestureEndIfReleased();
            return;
        }

        const location = touch.getLocation();
        this.handleOutputs(this.tracker.cancel({
            id: touch.getID(),
            x: location.x,
            y: location.y,
        }));
        this.reportGestureEndIfReleased();
    }

    private handleOutputs(outputs: GestureOutput[]): void {
        if (outputs.length === 0) {
            return;
        }

        let cameraChanged = false;
        for (const output of outputs) {
            if (output.type === 'tap') {
                this.lastTapMarker = new Vec2(output.x, output.y);
                continue;
            }

            // AUT-R-031-02: the capability flags route the gesture; a switched-off gesture is a no-op
            // (no camera change, and a running focus beat keeps running).
            const result = applyCameraGestureInput(this.state, this.focusTransition, output, this.getInputFlags(), this.gestureTuning());
            if (!result.applied) {
                continue;
            }
            if (this.focusTransition && isDeviceDiagnosticsEnabled()) emitDeviceEvent('camera_focus', { phase: 'cancelled', reason: result.action });
            if (!result.transition) this.focusDistanceEase = null;
            this.state = result.state;
            this.focusTransition = result.transition;
            cameraChanged = true;
        }

        if (cameraChanged) {
            this.cameraMovedByGesture = true;
            this.applyCameraPose();
        }
    }

    /** Player gestures clamp to the pan bounds, grown to contain the current focus so a pan never snaps. */
    private gestureTuning(): CameraTuning {
        const tuning = this.tuning();
        return this.panBounds ? { ...tuning, focusBounds: expandCameraBoundsToInclude(this.panBounds, this.state.focus) } : tuning;
    }

    /** Reports a finished camera gesture once every touch of the sequence is released. */
    private reportGestureEndIfReleased(): void {
        if (!this.cameraMovedByGesture || this.tracker.activeTouchCount() > 0) {
            return;
        }
        this.cameraMovedByGesture = false;
        this.onCameraGestureEnded?.(this.getCameraState());
    }

    private applyCameraPose(): void {
        const cameraNode = this.cameraComponent?.node;
        if (!cameraNode) {
            return;
        }

        const yawRad = (this.state.yawDeg * Math.PI) / 180;
        const pitchRad = (this.state.pitchDeg * Math.PI) / 180;
        const horizontalDistance = this.state.distance * Math.cos(pitchRad);
        const cameraPosition = new Vec3(
            this.state.focus.x + (Math.sin(yawRad) * horizontalDistance),
            this.focusHeight + (this.state.distance * Math.sin(pitchRad)),
            this.state.focus.z + (Math.cos(yawRad) * horizontalDistance),
        );
        const focusPosition = new Vec3(this.state.focus.x, this.focusHeight, this.state.focus.z);

        cameraNode.setWorldPosition(cameraPosition);
        cameraNode.lookAt(focusPosition);
    }

    private isUiBlocked(screenPoint: Vec2): boolean {
        for (const blocker of this.uiBlockerNodes) {
            if (!blocker?.activeInHierarchy) {
                continue;
            }

            const transform = blocker.getComponent(UITransform);
            if (transform?.getBoundingBoxToWorld().contains(screenPoint)) {
                return true;
            }
        }

        return false;
    }

    private primaryTouch(event: EventTouch): { getID(): number; getLocation(): Vec2 } | null {
        const maybeEvent = event as unknown as { touch?: { getID(): number; getLocation(): Vec2 } };
        if (maybeEvent.touch) {
            return maybeEvent.touch;
        }

        const touches = event.getTouches();
        return touches.length > 0 ? touches[0] : null;
    }

    private tuning(): CameraTuning {
        return {
            minPitchDeg: this.minPitchDeg,
            maxPitchDeg: this.maxPitchDeg,
            minDistance: this.minDistance,
            maxDistance: this.maxDistance,
            orbitYawDegPerPixel: this.orbitYawDegPerPixel,
            orbitPitchDegPerPixel: this.orbitPitchDegPerPixel,
            zoomScaleMin: DEFAULT_CAMERA_TUNING.zoomScaleMin,
            zoomScaleMax: DEFAULT_CAMERA_TUNING.zoomScaleMax,
            panUnitsPerPixelAtDistance: this.panUnitsPerPixelAtDistance,
            focusBounds: {
                minX: this.focusMinX,
                maxX: this.focusMaxX,
                minZ: this.focusMinZ,
                maxZ: this.focusMaxZ,
            },
            yawMode: 'wrap',
            minYawDeg: DEFAULT_CAMERA_TUNING.minYawDeg,
            maxYawDeg: DEFAULT_CAMERA_TUNING.maxYawDeg,
        };
    }
}
