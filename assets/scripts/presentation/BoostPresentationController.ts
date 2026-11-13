import { _decorator, Component, Node } from 'cc';
import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import type { ConstructionPresentationController } from './ConstructionPresentationController';
import { BOOST_IMPULSE_SPARK_COUNT, BOOST_SPARK_SLOTS, BoostPresentationModel, sampleBoostImpulseSpark, sampleBoostSustainedSpark, type BoostFrame, type BoostSparkPlacement, type BoostTransition } from './BoostPresentation.ts';
import { emitDeviceEvent, isDeviceDiagnosticsEnabled } from './DeviceDiagnostics';
import { MILESTONE_RING_HEIGHT, MILESTONE_RING_VISIBLE_ABOVE, milestoneRingBars, producerFootprint } from './MilestoneFeedback.ts';
import { resetPresentationTimeScale, setPresentationTimeScale } from './PresentationTimeScale.ts';

const { ccclass } = _decorator;

const SPARK_SIZE = 0.12;
const SPARK_RADIUS = 0.8;
const SPARK_HEIGHT_SCALE = 1;
const PULSE_HEIGHT = 0.2;

/**
 * AUT-047 thin `cc` controller over the pure `BoostPresentationModel`: renders the "temporary production boost active" look.
 * It writes the shared presentation time scale (read by the animated work-loop controllers; the simulation never reads it), runs low-rate
 * amber sparks from the AUT-040 pool (odd, already amber, nodes; at most 2 machines), the ~0.35 s activation ring (own flat outline plate,
 * scale 0 at rest) and stops completely on expiry / suspend / background. Nothing runs while idle (`update` returns at once). Never writes
 * GameState, never submits a command, no node.active toggling (scale-based visibility), no per-frame allocation.
 */
@ccclass('BoostPresentationController')
export class BoostPresentationController extends Component {
    /** Shared AUT-040 spark pool owner and the "a construction is running" flag. */
    public construction: ConstructionPresentationController | null = null;
    /** Supplied by FactoryWorldBootstrap: the producer's focus anchor (zone naming `Zone_X/X_FocusAnchor`). */
    public resolveProducerAnchor: ((producerId: string) => Node | null) | null = null;
    /** Supplied by FactoryWorldBootstrap: the amber outline plate (root with 4 bar children, scale 0 at rest). */
    public pulsePlate: Node | null = null;

    private readonly model = new BoostPresentationModel();
    private readonly placement: BoostSparkPlacement = { intensity: 0, angle: 0, height: 0 };
    private readonly anchors: (Node | null)[] = [null, null];
    private readonly sparkShown: boolean[] = [false, false, false];
    private running = false;
    private ringVisible = false;
    private ringLaidOutFor: string | null = null;
    private effectReported = false;
    private sparksTouched = false;

    /** Initial / restored state: silent baseline (no impulse); an already active boost shows the sustained look at once. */
    public sync(state: GameState): BoostTransition {
        const transition = this.model.syncFromState(state);
        this.afterTransition(transition, 'session');
        return transition;
    }

    public consumeDomainEvents(state: GameState, events: readonly DomainEvent[]): BoostTransition | null {
        const transition = this.model.consumeEvents(state, events);
        if (transition) this.afterTransition(transition, transition.source);
        return transition;
    }

    /** App background: stop everything at once (baseline visuals); `resume` re-syncs silently from the saved state. */
    public onBackground(): void {
        const wasRunning = this.running;
        this.model.reset();
        this.stop();
        this.running = false;
        if (wasRunning) this.emit('stopped', { reason: 'background' });
    }

    /** App foreground: silent re-sync from the (possibly offline-advanced) state; no impulse. */
    public resume(state: GameState): void {
        const transition = this.model.syncFromState(state);
        this.afterTransition(transition, 'resume');
    }

    public update(deltaSeconds: number): void {
        if (!this.running) return;
        const frame = this.model.tick(deltaSeconds);
        setPresentationTimeScale(frame.timeScale);
        this.applySparks(frame);
        this.applyRing(frame);
        if (!this.effectReported && (frame.ring > 0.5 || (!frame.impulseActive && frame.level >= 0.5))) {
            this.effectReported = true;
            this.reportEffect(frame);
        }
        if (frame.idle) {
            this.stop();
            this.running = false;
            this.emit('settled', { timeScale: frame.timeScale });
        }
    }

    private afterTransition(transition: BoostTransition, source: string): void {
        this.refreshAnchors();
        this.effectReported = false;
        this.running = !this.model.isIdle();
        if (!this.running) this.stop();
        this.emit(transition.phase, { source, impulse: transition.impulse, mode: transition.mode, remainingSeconds: transition.remainingSeconds, multiplier: transition.multiplier, machines: this.model.getMachines(), anchorsResolved: this.anchors.filter((anchor) => anchor !== null).length });
    }

    private refreshAnchors(): void {
        const machines = this.model.getMachines();
        for (let index = 0; index < this.anchors.length; index += 1) {
            const producerId = machines[index];
            this.anchors[index] = producerId !== undefined ? this.resolveProducerAnchor?.(producerId) ?? null : null;
        }
    }

    // ---- sparks (AUT-040 pool, odd amber nodes) ----

    private applySparks(frame: BoostFrame): void {
        const pool = this.construction?.sparkNodes ?? [];
        if (pool.length === 0 || this.construction?.isAnyConstructing() === true) return;
        for (let slot = 0; slot < BOOST_SPARK_SLOTS.length; slot += 1) {
            const spec = BOOST_SPARK_SLOTS[slot];
            const node = pool[spec.poolIndex];
            const impulse = frame.impulseActive && slot < BOOST_IMPULSE_SPARK_COUNT;
            // The impulse bursts around the primary machine; sustained sparks sit on their own machine.
            const anchor = impulse ? this.anchors[0] : this.anchors[spec.machine];
            if (!node || !anchor) {
                if (node && this.sparkShown[slot]) { node.setScale(0, 0, 0); this.sparkShown[slot] = false; }
                continue;
            }
            if (impulse) sampleBoostImpulseSpark(frame.impulseElapsed, slot, this.placement);
            else sampleBoostSustainedSpark(frame.clock, slot, this.placement);
            const intensity = this.placement.intensity * (impulse ? 1 : frame.level);
            if (intensity <= 0.01) {
                if (this.sparkShown[slot]) { node.setScale(0, 0, 0); this.sparkShown[slot] = false; }
                continue;
            }
            const size = SPARK_SIZE * intensity;
            const center = anchor.worldPosition;
            node.setWorldPosition(center.x + (Math.cos(this.placement.angle) * SPARK_RADIUS), this.placement.height * SPARK_HEIGHT_SCALE, center.z + (Math.sin(this.placement.angle) * SPARK_RADIUS));
            node.setScale(size, size, size);
            this.sparkShown[slot] = true;
            this.sparksTouched = true;
        }
    }

    // ---- activation ring (own amber outline plate) ----

    private applyRing(frame: BoostFrame): void {
        const plate = this.pulsePlate;
        if (!plate) return;
        const producerId = this.model.getMachines()[0] ?? null;
        const rect = producerId !== null ? producerFootprint(producerId) : null;
        if (rect && producerId !== null && this.ringLaidOutFor !== producerId) {
            this.ringLaidOutFor = producerId;
            const bars = milestoneRingBars(rect);
            plate.children.forEach((bar, index) => {
                const spec = bars[index];
                if (!spec) return;
                bar.setPosition(spec.x, 0, spec.z);
                bar.setScale(spec.sizeX, MILESTONE_RING_HEIGHT, spec.sizeZ);
            });
            plate.setPosition(0, PULSE_HEIGHT, 0);
        }
        const visible = rect !== null && frame.ring > MILESTONE_RING_VISIBLE_ABOVE;
        if (visible !== this.ringVisible) {
            this.ringVisible = visible;
            plate.setScale(visible ? 1 : 0, visible ? 1 : 0, visible ? 1 : 0);
        }
    }

    /** Everything back to the baseline: time scale 1, ring hidden, our sparks hidden (only when no construction owns the pool). */
    private stop(): void {
        resetPresentationTimeScale();
        if (this.ringVisible) { this.ringVisible = false; this.pulsePlate?.setScale(0, 0, 0); }
        if (this.sparksTouched && this.construction?.isAnyConstructing() !== true) {
            const pool = this.construction?.sparkNodes ?? [];
            for (let slot = 0; slot < BOOST_SPARK_SLOTS.length; slot += 1) {
                if (this.sparkShown[slot]) pool[BOOST_SPARK_SLOTS[slot].poolIndex]?.setScale(0, 0, 0);
                this.sparkShown[slot] = false;
            }
            this.sparksTouched = false;
        }
    }

    private reportEffect(frame: BoostFrame): void {
        if (!isDeviceDiagnosticsEnabled()) return;
        const pool = this.construction?.sparkNodes ?? [];
        const spark = pool[BOOST_SPARK_SLOTS[0].poolIndex] ?? null;
        const plate = this.pulsePlate;
        const anchor = this.anchors[0];
        this.emit('effect_applied', {
            anchorResolved: anchor !== null,
            anchorName: anchor?.name ?? null,
            timeScale: frame.timeScale,
            level: frame.level,
            impulseActive: frame.impulseActive,
            plateScale: plate ? plate.scale.x : null,
            plateWorldPos: plate ? { x: plate.worldPosition.x, y: plate.worldPosition.y, z: plate.worldPosition.z } : null,
            sparkScale: spark ? spark.scale.x : null,
            sparkWorldPos: spark ? { x: spark.worldPosition.x, y: spark.worldPosition.y, z: spark.worldPosition.z } : null,
            poolSize: pool.length,
        });
    }

    private emit(phase: string, payload: Record<string, unknown>): void {
        if (isDeviceDiagnosticsEnabled()) emitDeviceEvent('boost_presentation', { phase, ...payload });
    }
}
