import { _decorator, Camera, Component, EventTouch, geometry, input, Input, Node, UITransform, Vec2 } from 'cc';
import { MobileCameraController } from '../camera/MobileCameraController';
import { TouchGestureTracker } from '../camera/TouchGestureModel';
import { ProducerHighlight } from './ProducerHighlight';

const { ccclass, property } = _decorator;

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
    private tracker = new TouchGestureTracker();
    private selectedProducerId: ProducerSelectionState = null;
    private targetById = new Map<ProducerSelectionId, Node>();

    public onLoad(): void {
        this.tracker = new TouchGestureTracker({ dragThresholdPixels: this.dragThresholdPixels, pinchMinDistancePixels: 4 });
        this.rebuildTargetIndex();
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
        this.tracker.cancel();
    }

    public getSelectedProducerId(): ProducerSelectionState { return this.selectedProducerId; }

    public selectProducer(producerId: ProducerSelectionId): void {
        const target = this.targetById.get(producerId);
        if (!target) return;
        const previousId = this.selectedProducerId;
        if (previousId !== producerId) {
            this.setHighlight(previousId, false);
            this.selectedProducerId = selectProducer(previousId, producerId);
            this.setHighlight(this.selectedProducerId, true);
            this.onSelectionChanged?.(this.selectedProducerId);
        } else {
            this.setHighlight(producerId, true);
        }
        const focusAnchor = target.parent?.getChildByName(`${producerId}_FocusAnchor`);
        if (focusAnchor) this.cameraController?.focusOnWorldTarget(focusAnchor.worldPosition);
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
        this.tracker.begin({ id: touch.getID(), x: location.x, y: location.y, consumedByUi: this.isUiBlocked(location) });
    }

    private onTouchMove(event: EventTouch): void {
        const touch = this.primaryTouch(event); if (!touch) return;
        const location = touch.getLocation();
        this.tracker.move({ id: touch.getID(), x: location.x, y: location.y });
    }

    private onTouchEnd(event: EventTouch): void {
        const touch = this.primaryTouch(event); if (!touch) return;
        const location = touch.getLocation();
        for (const output of this.tracker.end({ id: touch.getID(), x: location.x, y: location.y })) {
            if (output.type !== 'tap') continue;
            const producerId = this.producerAtScreenPoint(output.x, output.y);
            if (producerId) this.selectProducer(producerId);
        }
    }

    private onTouchCancel(event: EventTouch): void {
        const touch = this.primaryTouch(event);
        this.tracker.cancel(touch ? { id: touch.getID(), x: 0, y: 0 } : undefined);
    }

    private producerAtScreenPoint(x: number, y: number): ProducerSelectionId | null {
        if (!this.cameraComponent) return null;
        const ray = new geometry.Ray();
        this.cameraComponent.screenPointToRay(x, y, ray);
        let bestId: ProducerSelectionId | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const [id, target] of this.targetById) {
            const position = target.worldPosition;
            const halfWidth = Math.max(0.5, target.scale.x / 2);
            const halfDepth = Math.max(0.5, target.scale.z / 2);
            if (Math.abs(ray.d.y) < 0.0001) continue;
            const distance = (position.y - ray.o.y) / ray.d.y;
            const hitX = ray.o.x + ray.d.x * distance;
            const hitZ = ray.o.z + ray.d.z * distance;
            if (distance >= 0 && Math.abs(hitX - position.x) <= halfWidth && Math.abs(hitZ - position.z) <= halfDepth && distance < bestDistance) {
                bestDistance = distance; bestId = id;
            }
        }
        return bestId;
    }

    private isUiBlocked(screenPoint: Vec2): boolean {
        return this.uiBlockerNodes.some((blocker) => blocker?.activeInHierarchy && blocker.getComponent(UITransform)?.getBoundingBoxToWorld().contains(screenPoint));
    }

    private primaryTouch(event: EventTouch): { getID(): number; getLocation(): Vec2 } | null {
        const maybeEvent = event as unknown as { touch?: { getID(): number; getLocation(): Vec2 } };
        if (maybeEvent.touch) return maybeEvent.touch;
        const touches = event.getTouches();
        return touches.length > 0 ? touches[0] : null;
    }
}
