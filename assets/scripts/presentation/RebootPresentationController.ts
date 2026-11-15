import { _decorator, Component, Node } from 'cc';
import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import type { MobileCameraController } from '../camera/MobileCameraController';
import { aiCoreScaleFor, aiCoreSummary } from './AutomataIdentity.ts';
import { emitDeviceEvent, isDeviceDiagnosticsEnabled } from './DeviceDiagnostics';
import {
    REBOOT_FOCUS_PRODUCER_ID,
    REBOOT_SCAN,
    RebootPresentationModel,
    rebootCoreCenterY,
    resolveRebootFocus,
    scanRingBars,
    type RebootFrame,
    type RebootUpdate,
} from './RebootPresentation.ts';

const { ccclass } = _decorator;

const CORE_SIZE_EPSILON = 1e-4;

/**
 * AUT-049 thin `cc` controller over the pure `RebootPresentationModel`: the WORLD part of the Reboot presentation (the title card is the
 * `reboot_title` kind of the AUT-046 toast band, `MilestonePresentationController`). It starts ONLY from the `rebootCompleted` domain
 * event (the coordinator appends it after the durable `reboot_saved`), never on load; it draws a thin cyan scan ring (4 opaque outline
 * bars), then a AI Core (AUT-066 primitive boxes merged per colour) on a small relay socket, asks the existing
 * `focusOnRevealTarget` once (skipped when on-centre / a focus is active), and leaves the static persistent socket when
 * `aiCores > 0 || civilization >= 2`. Scale-based visibility (never `node.active`), inert (no touch listener, no state write, no
 * command), nothing runs while idle and nothing outside the 4.0 s window. The nodes are built by FactoryWorldBootstrap.
 */
@ccclass('RebootPresentationController')
export class RebootPresentationController extends Component {
    public cameraController: MobileCameraController | null = null;
    /** Supplied by FactoryWorldBootstrap: the producer's focus anchor (`Zone_X/X_FocusAnchor`). */
    public resolveProducerAnchor: ((producerId: string) => Node | null) | null = null;
    /** Supplied by FactoryWorldBootstrap: the scan ring (root with 4 bar children, scale 0 at rest). */
    public scanPlate: Node | null = null;
    /** Supplied by FactoryWorldBootstrap: the relay socket root (base, pedestal, ring, Core; scale 0 at rest) and its Core child. */
    public socketRoot: Node | null = null;
    public coreNode: Node | null = null;

    private readonly model = new RebootPresentationModel();
    private scanShown = false;
    private socketShown = false;
    private coreSize = 0;
    private idleDirty = false;
    private scanReported = false;
    private coreReported = false;

    /** Initial / restored state: silent baseline (no sequence); the persistent socket follows the snapshot. */
    public sync(state: GameState): RebootUpdate {
        const update = this.model.syncFromState(state);
        this.idleDirty = true;
        this.emit('synced', { source: 'session', socketPersistent: update.socketPersistent, civilization: state.meta.civilizationNumber, aiCores: state.meta.aiCores });
        return update;
    }

    public consumeDomainEvents(state: GameState, events: readonly DomainEvent[]): RebootUpdate {
        const update = this.model.consumeEvents(state, events);
        this.idleDirty = true;
        if (update.duplicate) this.emit('duplicate_ignored', { socketPersistent: update.socketPersistent });
        if (update.started) {
            this.scanReported = false;
            this.coreReported = false;
            this.emit('sequence_started', { key: update.started.key, newCivilization: update.started.newCivilization, aiCoresGranted: update.started.aiCoresGranted, socketPersistent: update.socketPersistent });
            this.requestFocus();
        }
        return update;
    }

    public update(deltaSeconds: number): void {
        if (!this.model.isRunning() && !this.idleDirty) return;
        const frame = this.model.tick(deltaSeconds);
        this.idleDirty = false;
        this.apply(frame);
        if (frame.phaseChanged) this.emit('phase', { name: frame.phaseChanged, elapsedSeconds: frame.elapsed });
        if (frame.finished) this.emit('sequence_finished', { elapsedSeconds: frame.elapsed, socketVisible: frame.socketVisible, coreSize: frame.coreSize });
    }

    /** One camera beat on the Fabricator anchor through the existing reveal API (a touch / pan cancels it inside the camera). */
    private requestFocus(): void {
        const anchor = this.resolveProducerAnchor?.(REBOOT_FOCUS_PRODUCER_ID) ?? null;
        const camera = this.cameraController;
        const cameraState = camera?.getCameraState() ?? null;
        const world = anchor ? { x: anchor.worldPosition.x, y: anchor.worldPosition.y, z: anchor.worldPosition.z } : null;
        const decision = resolveRebootFocus({
            cameraFocus: cameraState ? { x: cameraState.focus.x, z: cameraState.focus.z } : null,
            target: anchor ? { x: anchor.worldPosition.x, z: anchor.worldPosition.z } : null,
            cameraFocusActive: camera?.isFocusTransitionActive() === true,
        });
        if (decision.focus && camera && anchor) {
            camera.focusOnRevealTarget(anchor.worldPosition);
            this.emit('focus_requested', { producerId: REBOOT_FOCUS_PRODUCER_ID, anchorResolved: true, worldPos: world });
        } else {
            this.emit('focus_skipped', { producerId: REBOOT_FOCUS_PRODUCER_ID, reason: decision.reason, anchorResolved: anchor !== null, worldPos: world });
        }
    }

    private apply(frame: RebootFrame): void {
        this.applyScan(frame);
        this.applySocket(frame);
        if (frame.running && !this.scanReported && frame.scanVisible && frame.scanProgress > 0.3) {
            this.scanReported = true;
            this.emit('effect_applied', { part: 'scan', plateScale: this.scanPlate?.scale.x ?? null, plateWorldPos: this.worldPos(this.scanPlate), progress: frame.scanProgress });
        }
        if (frame.running && !this.coreReported && frame.socketVisible && frame.coreSize > 0.3) {
            this.coreReported = true;
            this.emit('effect_applied', { part: 'core', socketScale: this.socketRoot?.scale.x ?? null, socketWorldPos: this.worldPos(this.socketRoot), coreScale: this.coreNode?.scale.x ?? null, coreWorldPos: this.worldPos(this.coreNode), aiCoreParts: this.coreNode?.getChildByName('AiCoreModel')?.children.length ?? 0, aiCore: aiCoreSummary() });
        }
    }

    /** Thin cyan outline growing over the site: 4 opaque bars resized per frame; hidden by scale 0 outside the scan phase. */
    private applyScan(frame: RebootFrame): void {
        const plate = this.scanPlate;
        if (!plate) return;
        if (frame.scanVisible) {
            const bars = scanRingBars(frame.scanProgress);
            plate.children.forEach((bar, index) => {
                const spec = bars[index];
                if (!spec) return;
                bar.setPosition(spec.x, 0, spec.z);
                bar.setScale(spec.sizeX, REBOOT_SCAN.height, spec.sizeZ);
            });
            if (!this.scanShown) {
                plate.setPosition(0, REBOOT_SCAN.y, 0);
                plate.setScale(1, 1, 1);
                this.scanShown = true;
            }
        } else if (this.scanShown) {
            plate.setScale(0, 0, 0);
            this.scanShown = false;
        }
    }

    /** Relay socket + placeholder Core: static once visible; the Core size only changes during the sequence. */
    private applySocket(frame: RebootFrame): void {
        const root = this.socketRoot;
        if (root && frame.socketVisible !== this.socketShown) {
            this.socketShown = frame.socketVisible;
            const s = frame.socketVisible ? 1 : 0;
            root.setScale(s, s, s);
        }
        const core = this.coreNode;
        if (core && Math.abs(frame.coreSize - this.coreSize) > CORE_SIZE_EPSILON) {
            this.coreSize = frame.coreSize;
            // AUT-066: the AI Core model is authored at the persistent size (scale 1); the reveal scales the whole model (shell included) together.
            const scale = aiCoreScaleFor(frame.coreSize);
            core.setScale(scale, scale, scale);
            core.setPosition(0, rebootCoreCenterY(frame.coreSize), 0);
        }
    }

    private worldPos(node: Node | null): { x: number; y: number; z: number } | null {
        return node ? { x: node.worldPosition.x, y: node.worldPosition.y, z: node.worldPosition.z } : null;
    }

    private emit(phase: string, payload: Record<string, unknown>): void {
        if (isDeviceDiagnosticsEnabled()) emitDeviceEvent('reboot_presentation', { phase, ...payload });
    }
}
