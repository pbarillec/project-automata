import { _decorator, Camera, Component, EventTouch, geometry, input, Input, MeshRenderer, Node, screen, UITransform, Vec2, Vec3 } from 'cc';
import { MobileCameraController } from '../camera/MobileCameraController';
import { TouchGestureTracker } from '../camera/TouchGestureModel';
import { ProducerHighlight } from './ProducerHighlight';
import { selectionTapSlopPixels } from './SelectionInput';
import { emitDeviceEvent, isDeviceDiagnosticsEnabled } from './DeviceDiagnostics';
import { pickSelectionTarget, SelectionRaycastResult } from './SelectionRaycast';

const { ccclass, property } = _decorator;

type SelectionTouch = { getID(): number; getLocation(): Vec2; getStartLocation(): Vec2 };

export const PRODUCER_SELECTION_IDS = ['Fabricator', 'AssemblyStation', 'RobotLine', 'AutomatedCell', 'AdvancedRoboticsComplex'] as const;
export type ProducerSelectionId = typeof PRODUCER_SELECTION_IDS[number];
export type ProducerSelectionState = ProducerSelectionId | null;

export function selectProducer(current: ProducerSelectionState, next: ProducerSelectionId): ProducerSelectionState {
    return current === next ? current : next;
}

/** Presentation-only producer hit targets, highlight state, and camera focus bridge. */
@ccclass('ProducerSelectionController')
export class ProducerSelectionController extends Component {
    @property(Camera) public cameraComponent: Camera | null = null;
    @property(MobileCameraController) public cameraController: MobileCameraController | null = null;
    @property([Node]) public selectableTargets: Node[] = [];
    @property([Node]) public uiBlockerNodes: Node[] = [];
    @property public dragThresholdPixels = 12;

    public onSelectionChanged: ((producerId: ProducerSelectionState) => void) | null = null;
    private tapSlopPixels = 12;
    private tracker = new TouchGestureTracker();
    private selectedProducerId: ProducerSelectionState = null;
    private targetById = new Map<ProducerSelectionId, Node>();
    // AUT-INFRA-001 diagnostics bookkeeping (observers only; inert when diagnostics are off).
    private diagnosticsProjectionFrames = -1;
    private diagnosticsProjectionReason = '';
    private diagnosticsFocusWasActive = false;

    public onLoad(): void {
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    /** Runs after the bootstrap assigned selectableTargets/dragThresholdPixels (onLoad fires inside addComponent). */
    public start(): void {
        this.tapSlopPixels = selectionTapSlopPixels(this.dragThresholdPixels, screen.devicePixelRatio, Math.min(screen.windowSize.width, screen.windowSize.height));
        this.tracker = new TouchGestureTracker({ dragThresholdPixels: this.tapSlopPixels, pinchMinDistancePixels: 4 });
        this.rebuildTargetIndex();
        if (isDeviceDiagnosticsEnabled()) this.scheduleDiagnosticsProjection('scene_ready');
    }

    /** AUT-INFRA-001: emits zone projections two frames after start / after a camera focus settles, so camera matrices are current. */
    public lateUpdate(): void {
        if (!isDeviceDiagnosticsEnabled()) return;
        const focusActive = this.cameraController?.isFocusTransitionActive() === true;
        if (this.diagnosticsFocusWasActive && !focusActive) this.scheduleDiagnosticsProjection('camera_settled');
        this.diagnosticsFocusWasActive = focusActive;
        if (this.diagnosticsProjectionFrames < 0) return;
        if (this.diagnosticsProjectionFrames > 0) { this.diagnosticsProjectionFrames -= 1; return; }
        this.diagnosticsProjectionFrames = -1;
        this.emitProjection(this.diagnosticsProjectionReason);
    }

    public onDestroy(): void {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        this.tracker.cancel();
    }

    public getSelectedProducerId(): ProducerSelectionState { return this.selectedProducerId; }

    public selectProducer(producerId: ProducerSelectionId): void {
        const target = this.targetById.get(producerId);
        if (!target) {
            emitDeviceEvent('selection_state', { requested: producerId, prev: this.selectedProducerId, next: this.selectedProducerId, changed: false, rejected: 'no_target' });
            return;
        }
        const previousId = this.selectedProducerId;
        if (previousId !== producerId) {
            this.setHighlight(previousId, false);
            this.selectedProducerId = selectProducer(previousId, producerId);
            this.setHighlight(this.selectedProducerId, true);
            this.onSelectionChanged?.(this.selectedProducerId);
        } else {
            this.setHighlight(producerId, true);
        }
        if (isDeviceDiagnosticsEnabled()) {
            emitDeviceEvent('selection_state', { requested: producerId, prev: previousId, next: this.selectedProducerId, changed: previousId !== this.selectedProducerId });
            if (previousId && previousId !== this.selectedProducerId) this.emitMarkerState(previousId);
            this.emitMarkerState(producerId);
        }
        const focusAnchor = target.parent?.getChildByName(`${producerId}_FocusAnchor`);
        if (focusAnchor) {
            if (isDeviceDiagnosticsEnabled()) {
                const anchor = focusAnchor.worldPosition;
                emitDeviceEvent('camera_focus', { phase: this.cameraController ? 'requested' : 'skipped', source: 'selection', id: producerId, target: { x: anchor.x, y: anchor.y, z: anchor.z }, reason: this.cameraController ? undefined : 'no_camera_controller' });
            }
            this.cameraController?.focusOnWorldTarget(focusAnchor.worldPosition);
        } else {
            emitDeviceEvent('camera_focus', { phase: 'skipped', source: 'selection', id: producerId, reason: 'no_focus_anchor' });
        }
    }

    public clearSelection(): void {
        this.setHighlight(this.selectedProducerId, false);
        if (this.selectedProducerId === null) return;
        this.selectedProducerId = null;
        this.onSelectionChanged?.(null);
    }

    private rebuildTargetIndex(): void {
        this.targetById.clear();
        for (const target of this.selectableTargets) {
            const id = target.name.replace(/_SelectableTarget$/, '') as ProducerSelectionId;
            if ((PRODUCER_SELECTION_IDS as readonly string[]).includes(id)) {
                target.getComponent(ProducerHighlight) ?? target.addComponent(ProducerHighlight);
                this.targetById.set(id, target);
            }
        }
    }

    private setHighlight(producerId: ProducerSelectionState, active: boolean): void {
        if (!producerId) return;
        this.targetById.get(producerId)?.getComponent(ProducerHighlight)?.setSelected(active);
    }

    private onTouchStart(event: EventTouch): void {
        const touch = this.primaryTouch(event); if (!touch) return;
        const location = touch.getLocation();
        const consumedByUi = this.isUiBlocked(location);
        emitDeviceEvent('touch_start', { touchId: touch.getID(), x: location.x, y: location.y, uiBlocked: consumedByUi });
        this.tracker.begin({ id: touch.getID(), x: location.x, y: location.y, consumedByUi });
    }

    private onTouchMove(event: EventTouch): void {
        const touch = this.primaryTouch(event); if (!touch) return;
        const location = touch.getLocation();
        this.tracker.move({ id: touch.getID(), x: location.x, y: location.y });
    }

    private onTouchEnd(event: EventTouch): void {
        const touch = this.primaryTouch(event); if (!touch) return;
        const location = touch.getLocation();
        const outputs = this.tracker.end({ id: touch.getID(), x: location.x, y: location.y });
        if (isDeviceDiagnosticsEnabled()) this.emitTouchEnd(touch, location, outputs.some((output) => output.type === 'tap'));
        for (const output of outputs) {
            if (output.type !== 'tap') continue;
            const producerId = this.producerAtScreenPoint(output.x, output.y, true);
            if (producerId) this.selectProducer(producerId);
        }
    }

    private onTouchCancel(event: EventTouch): void {
        const touch = this.primaryTouch(event);
        this.tracker.cancel(touch ? { id: touch.getID(), x: 0, y: 0 } : undefined);
    }

    private producerAtScreenPoint(x: number, y: number, emitDiagnostics = false): ProducerSelectionId | null {
        if (!this.cameraComponent) {
            if (emitDiagnostics) emitDeviceEvent('selection_raycast', { x, y, hit: null, targets: this.targetById.size, reason: 'no_camera' });
            return null;
        }
        const ray = new geometry.Ray();
        this.cameraComponent.screenPointToRay(x, y, ray);
        // AUT-035 hit test, extracted unchanged into SelectionRaycast (AUT-INFRA-001).
        const result: SelectionRaycastResult<ProducerSelectionId> = pickSelectionTarget(
            { o: ray.o, d: ray.d },
            Array.from(this.targetById, ([id, target]) => ({ id, position: target.worldPosition, scale: target.scale })),
        );
        if (emitDiagnostics && isDeviceDiagnosticsEnabled()) {
            emitDeviceEvent('selection_raycast', {
                x, y, hit: result.hit, targets: this.targetById.size,
                ray: { o: { x: ray.o.x, y: ray.o.y, z: ray.o.z }, d: { x: ray.d.x, y: ray.d.y, z: ray.d.z } },
                zones: Array.from(this.targetById, ([id, target], index) => ({
                    ...result.zones[index], id,
                    worldScale: { x: target.worldScale.x, y: target.worldScale.y, z: target.worldScale.z },
                    position: { x: target.worldPosition.x, y: target.worldPosition.y, z: target.worldPosition.z },
                })),
            });
        }
        return result.hit;
    }

    // ---- AUT-INFRA-001 device diagnostics (emit only; never change selection, marker or camera state) ----

    private scheduleDiagnosticsProjection(reason: string): void {
        this.diagnosticsProjectionReason = reason;
        this.diagnosticsProjectionFrames = 2;
    }

    private emitProjection(reason: string): void {
        const windowSize = screen.windowSize;
        const camera = this.cameraComponent?.camera;
        const zones = Array.from(this.targetById, ([id, target]) => {
            const world = target.worldPosition;
            const projected = this.cameraComponent ? this.cameraComponent.worldToScreen(world, new Vec3()) : null;
            const onScreen = projected !== null && projected.x >= 0 && projected.y >= 0
                && projected.x <= windowSize.width && projected.y <= windowSize.height && projected.z > 0 && projected.z < 1;
            return { id, wx: world.x, wy: world.y, wz: world.z, sx: projected?.x ?? null, sy: projected?.y ?? null, sz: projected?.z ?? null, onScreen };
        });
        emitDeviceEvent(reason === 'scene_ready' ? 'scene_ready' : 'zones_projected', {
            reason,
            screen: { w: windowSize.width, h: windowSize.height, dpr: screen.devicePixelRatio, cameraW: camera?.width ?? null, cameraH: camera?.height ?? null },
            slop: this.tapSlopPixels,
            targets: this.targetById.size,
            hasCamera: this.cameraComponent !== null,
            hasCameraController: this.cameraController !== null,
            uiBlockers: this.uiBlockerNodes.filter((node) => node?.activeInHierarchy).length,
            selected: this.selectedProducerId,
            cameraState: this.cameraController?.getCameraState() ?? null,
            zones,
        });
    }

    private emitTouchEnd(touch: SelectionTouch, location: Vec2, tap: boolean): void {
        const start = touch.getStartLocation();
        emitDeviceEvent('touch_end', {
            touchId: touch.getID(), x: location.x, y: location.y, startX: start.x, startY: start.y,
            moved: Math.hypot(location.x - start.x, location.y - start.y), slop: this.tapSlopPixels, tap,
            uiBlocked: this.isUiBlocked(start),
        });
    }

    /** Reads the ProducerHighlight marker by node name (ProducerHighlight itself is untouched). */
    private emitMarkerState(producerId: ProducerSelectionId): void {
        const target = this.targetById.get(producerId);
        const marker = target?.getChildByName('ProducerSelectionMarker') ?? null;
        const renderer = marker?.getComponent(MeshRenderer) ?? null;
        emitDeviceEvent('marker_state', {
            id: producerId,
            hasHighlight: target?.getComponent(ProducerHighlight) !== null && target?.getComponent(ProducerHighlight) !== undefined,
            exists: marker !== null,
            active: marker?.active === true,
            activeInHierarchy: marker?.activeInHierarchy === true,
            layer: marker?.layer ?? null,
            hasMesh: renderer?.mesh !== null && renderer?.mesh !== undefined,
            worldPos: marker ? { x: marker.worldPosition.x, y: marker.worldPosition.y, z: marker.worldPosition.z } : null,
            worldScale: marker ? { x: marker.worldScale.x, y: marker.worldScale.y, z: marker.worldScale.z } : null,
        });
    }

    private isUiBlocked(screenPoint: Vec2): boolean {
        return this.uiBlockerNodes.some((blocker) => blocker?.activeInHierarchy && blocker.getComponent(UITransform)?.getBoundingBoxToWorld().contains(screenPoint));
    }

    private primaryTouch(event: EventTouch): SelectionTouch | null {
        const maybeEvent = event as unknown as { touch?: SelectionTouch };
        if (maybeEvent.touch) return maybeEvent.touch;
        const touches = event.getTouches();
        return touches.length > 0 ? touches[0] : null;
    }
}
