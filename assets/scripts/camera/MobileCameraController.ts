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
    applyCameraRelativePan,
    applyOrbitDelta,
    applyPinchZoom,
    boundedFocusForTarget,
    CameraState,
    CameraTuning,
    clampCameraState,
    DEFAULT_CAMERA_STATE,
    DEFAULT_CAMERA_TUNING,
    FocusTransition,
    resolveFocusTransitionAfterUserInput,
    startFocusTransition,
    stepFocusTransition,
} from './CameraMath';
import { GestureOutput, TouchGestureTracker } from './TouchGestureModel';

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

    private tracker: TouchGestureTracker = new TouchGestureTracker();
    private state: CameraState = { ...DEFAULT_CAMERA_STATE, focus: { ...DEFAULT_CAMERA_STATE.focus } };
    private focusTransition: FocusTransition | null = null;
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
        this.applyCameraPose();
    }

    public focusOnWorldTarget(target: Vec3): void {
        if (this.focusDistance > 0) {
            this.state = clampCameraState({
                ...this.state,
                distance: this.focusDistance,
            }, this.tuning());
        }

        this.focusTransition = startFocusTransition(
            this.state,
            { x: target.x, z: target.z },
            this.focusTransitionSeconds,
            this.tuning(),
        );
    }

    public applyConfiguredInitialView(): void {
        this.focusTransition = null;
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
    }

    private onTouchCancel(event: EventTouch): void {
        const touch = this.primaryTouch(event);
        if (!touch) {
            this.tracker.cancel();
            return;
        }

        const location = touch.getLocation();
        this.handleOutputs(this.tracker.cancel({
            id: touch.getID(),
            x: location.x,
            y: location.y,
        }));
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

            if (output.type === 'orbit') {
                this.focusTransition = resolveFocusTransitionAfterUserInput(this.focusTransition, true);
                this.state = applyOrbitDelta(this.state, {
                    x: output.deltaX,
                    y: output.deltaY,
                }, this.tuning());
                cameraChanged = true;
            } else if (output.type === 'panZoom') {
                this.focusTransition = resolveFocusTransitionAfterUserInput(this.focusTransition, true);
                if (output.zoomScale !== null) {
                    this.state = applyPinchZoom(this.state, output.zoomScale, this.tuning());
                }
                this.state = applyCameraRelativePan(this.state, {
                    x: output.centerDeltaX,
                    y: output.centerDeltaY,
                }, this.tuning());
                cameraChanged = true;
            }
        }

        if (cameraChanged) {
            this.applyCameraPose();
        }
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
