import { _decorator, Component, Node } from 'cc';
import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import { sampleConstruction, type ConstructionSample } from './ConstructionSequence.ts';
import { ConstructionViewModel, type ConstructionStartRequest } from './ConstructionViewModel.ts';
import { emitDeviceEvent, isDeviceDiagnosticsEnabled } from './DeviceDiagnostics';

const { ccclass } = _decorator;

/** What a producer composition exposes so the generic construction sequence can drive it (presentation only). */
export interface ConstructionTarget {
    /** Modules revealed by the sequence, in reveal order; empty = no sequence. */
    getConstructionModuleIds(state: GameState): readonly string[];
    /** Applies one sampled frame; `null` ends the sequence and returns control to the normal visual state. */
    setConstructionSample(sample: ConstructionSample | null): void;
    /** Optional activation hook, called once when the sequence completes. */
    onConstructionActivated?(): void;
}

const SPARK_SIZE = 0.09;
const SPARK_BURST_SECONDS_FREQUENCY = 38;

/**
 * AUT-040 reusable construction presentation: thin `cc` controller over the pure `ConstructionViewModel`.
 * Any producer composition registers a `ConstructionTarget`; sequences start from live domain events or a live
 * unbuilt -> built state transition, never on save load. Sparks are a small pool of bootstrap-supplied nodes
 * placed on the module footprint (scale-only visibility, AUT-038 Android rule). Never writes GameState.
 */
@ccclass('ConstructionPresentationController')
export class ConstructionPresentationController extends Component {
    /** Supplied by FactoryWorldBootstrap: small unlit boxes used as sparks (scale 0 at rest). */
    public sparkNodes: Node[] = [];
    /** Local positions the sparks are scattered around while a sequence runs, per producer. */
    public sparkAnchors = new Map<string, { x: number; y: number; z: number }>();

    private readonly targets = new Map<string, ConstructionTarget>();
    private readonly viewModel = new ConstructionViewModel((producerId, state) => this.targets.get(producerId)?.getConstructionModuleIds(state) ?? []);
    private clock = 0;
    private runningProducerId: string | null = null;

    public registerTarget(producerId: string, target: ConstructionTarget): void {
        this.targets.set(producerId, target);
    }

    public sync(state: GameState): void {
        this.report(this.viewModel.syncFromState(state));
    }

    public consumeDomainEvents(state: GameState, events: readonly DomainEvent[]): void {
        this.report(this.viewModel.consumeEvents(state, events));
    }

    public isConstructing(producerId: string): boolean {
        return this.viewModel.isActive(producerId);
    }

    public update(deltaSeconds: number): void {
        const tick = this.viewModel.tick(deltaSeconds);
        if (tick.frames.length === 0) return;
        this.clock += deltaSeconds;
        for (const frame of tick.frames) {
            const target = this.targets.get(frame.producerId);
            if (!frame.sample.complete) target?.setConstructionSample(frame.sample);
            this.runningProducerId = frame.producerId;
            this.applySparks(frame.producerId, frame.sample);
        }
        for (const producerId of tick.completed) {
            const target = this.targets.get(producerId);
            target?.setConstructionSample(null);
            target?.onConstructionActivated?.();
            this.hideSparks();
            if (isDeviceDiagnosticsEnabled()) emitDeviceEvent('construction_state', { phase: 'activated', producerId });
        }
    }

    private report(requests: readonly ConstructionStartRequest[]): void {
        for (const request of requests) {
            // Apply frame 0 immediately so the built state never flashes before the first tick.
            this.targets.get(request.producerId)?.setConstructionSample(sampleConstruction(request.plan, 0));
            if (!isDeviceDiagnosticsEnabled()) continue;
            emitDeviceEvent('construction_state', {
                phase: 'started',
                producerId: request.producerId,
                modules: request.plan.moduleIds,
                durationSeconds: request.plan.durationSeconds,
            });
        }
    }

    private applySparks(producerId: string, sample: ConstructionSample): void {
        const anchor = this.sparkAnchors.get(producerId);
        if (!anchor || this.sparkNodes.length === 0) return;
        this.sparkNodes.forEach((spark, index) => {
            const phase = this.clock * SPARK_BURST_SECONDS_FREQUENCY + index * 1.7;
            const flicker = 0.5 + 0.5 * Math.sin(phase);
            const scale = SPARK_SIZE * sample.sparkIntensity * flicker * (index % 2 === 0 ? 1 : 0.7);
            const angle = (index / this.sparkNodes.length) * Math.PI * 2 + this.clock * 2;
            spark.setPosition(anchor.x + Math.cos(angle) * 0.45, anchor.y + 0.25 + flicker * 0.6, anchor.z + Math.sin(angle) * 0.45);
            spark.setScale(scale, scale, scale);
        });
    }

    private hideSparks(): void {
        if (this.viewModel.isActive(this.runningProducerId ?? '')) return;
        for (const spark of this.sparkNodes) spark.setScale(0, 0, 0);
    }
}
