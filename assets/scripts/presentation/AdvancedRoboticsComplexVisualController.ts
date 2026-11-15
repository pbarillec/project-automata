import { Log } from '../logging/Log.ts';
import { _decorator, Animation, Component, instantiate, Node } from 'cc';
import type { Prefab } from 'cc';
import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import type { MobileCameraController } from '../camera/MobileCameraController';
import type { ConstructionSample } from './ConstructionSequence.ts';
import type { ConstructionTarget } from './ConstructionPresentationController';
import { emitDeviceEvent, isDeviceDiagnosticsEnabled } from './DeviceDiagnostics';
import {
    ARC_BOX_SCALE,
    ARC_GUIDE_PARTS,
    ARC_LAMP_IDS,
    ARC_MODULE_IDS,
    ARC_MODULE_PREFAB,
    ARC_MODULE_TRANSFORMS,
    ARC_PRIMITIVE_MODULE_IDS,
    ARC_PLACEHOLDER_NODE_NAMES,
    ARC_PREFAB_SLOTS,
    ARC_PRODUCER_ID,
    ARC_ROBOT_SCALE,
    arcLocal,
    type ArcLampId,
    type ArcModuleId,
    type ArcPrefabSlot,
} from './AdvancedRoboticsComplexLayout.ts';
import { ARC_POOL_LIMIT, advanceArcClock, sampleArcArmPose, sampleArcJob, sampleArcLampLit, sampleArcSpirePulse } from './AdvancedRoboticsComplexProduction.ts';
import { AdvancedRoboticsComplexRevealViewModel, type ArcRevealSnapshot } from './AdvancedRoboticsComplexRevealViewModel.ts';
import { resolveArcVisualState, type ArcVisualDescriptor } from './AdvancedRoboticsComplexVisualStateResolver.ts';
import { getPresentationTimeScale } from './PresentationTimeScale.ts';

const { ccclass } = _decorator;

/** Primitive nodes built by FactoryWorldBootstrap under the composition anchor. */
export const ARC_SLAB_NODE_NAME = 'foundation_slab';
export const ARC_LAMP_OFF_NODE_PREFIX = 'arc_lamp_off_';
export const ARC_LAMP_ON_NODE_PREFIX = 'arc_lamp_on_';
export const ARC_GUIDE_OFF_NODE_PREFIX = 'arc_guide_off_';
export const ARC_GUIDE_ON_NODE_PREFIX = 'arc_guide_on_';
export const ARC_ITEM_BOX_PREFIX = 'AdvancedRoboticsComplexBox_';
export const ARC_ITEM_ROBOT_PREFIX = 'AdvancedRoboticsComplexRobot_';

/** Modules that are primitives (the bootstrap builds them); the rest come from `advancedRoboticsComplexPrefabs`. */
const PRIMITIVE_MODULES: ReadonlySet<ArcModuleId> = new Set<ArcModuleId>(ARC_PRIMITIVE_MODULE_IDS);
const ARM_MODULES = ['arm_1', 'arm_2', 'arm_b'] as const;
/** The lamp is "ready" once its host module has been built (the status lamps do not exist before it). */
const LAMP_MODULE: Readonly<Record<ArcLampId, ArcModuleId>> = Object.freeze({
    input: 'conveyor_in',
    output: 'conveyor_out',
    core: 'core',
    head: 'head',
    arm_1: 'arm_1',
    arm_2: 'arm_2',
    frame_west: 'frame_west_1',
    frame_back: 'frame_back_1',
    bay: 'bay',
    arm_b: 'arm_b',
    gantry_1: 'beam_1',
    gantry_2: 'beam_2',
    overhead: 'overhead_belt',
    spire: 'spire',
});

interface ArcItem {
    readonly box: Node;
    readonly robot: Node;
    readonly animations: Animation[];
    robotPlaying: boolean;
    lastCycle: number;
}

/**
 * AUT-044 presentation-only Advanced Robotics Complex composition: thin controller over the pure
 * `resolveArcVisualState`, `AdvancedRoboticsComplexProduction` and `AdvancedRoboticsComplexRevealViewModel`. Modules are
 * AUT-032 prefabs serialized on FactoryWorldBootstrap (`advancedRoboticsComplexPrefabs`, index-aligned with
 * ARC_PREFAB_SLOTS). Visibility uses scale, never `node.active` (AUT-038 Android rule). Registered as an
 * AUT-040 ConstructionTarget; the live construction triggers one bounded camera focus through the existing reveal API.
 * Fake production is a pooled box + robot per slot driven by a presentation clock. It never writes GameState.
 */
@ccclass('AdvancedRoboticsComplexVisualController')
export class AdvancedRoboticsComplexVisualController extends Component implements ConstructionTarget {
    /** Supplied by FactoryWorldBootstrap at runtime (index-aligned with ARC_PREFAB_SLOTS). */
    public advancedRoboticsComplexPrefabs: Prefab[] = [];
    /** Supplied by FactoryWorldBootstrap at runtime (the AUT-032 Robot.glb prefab, shared with the Worker Bot). */
    public robotPrefab: Prefab | null = null;
    public cameraController: MobileCameraController | null = null;
    public focusAnchor: Node | null = null;

    private readonly viewModel = new AdvancedRoboticsComplexRevealViewModel();
    private readonly moduleNodes = new Map<ArcModuleId, Node>();
    private readonly items: ArcItem[] = [];
    private descriptorValue: ArcVisualDescriptor | null = null;
    private snapshotValue: ArcRevealSnapshot | null = null;
    private construction: ConstructionSample | null = null;
    private beatPending = false;
    private running = false;
    private clock = 0;

    public start(): void {
        this.ensureModuleNodes();
        if (!this.descriptorValue) this.applyAll();
    }

    /** Initial / restored state: rebuilds the complex instantly, never replays the construction. */
    public sync(state: GameState): ArcRevealSnapshot {
        this.snapshotValue = this.viewModel.syncFromState(state);
        this.applyDescriptor(this.snapshotValue.descriptor);
        this.finishBeat();
        if (isDeviceDiagnosticsEnabled()) emitDeviceEvent('advanced_robotics_complex_state', { phase: 'synced', source: 'session', ...this.describe() });
        return this.snapshotValue;
    }

    public consumeDomainEvents(state: GameState, events: readonly DomainEvent[]): ArcRevealSnapshot {
        this.snapshotValue = this.viewModel.consumeEvents(state, events);
        this.applyDescriptor(this.snapshotValue.descriptor);
        this.finishBeat();
        return this.snapshotValue;
    }

    public syncFromGameState(state: GameState): ArcVisualDescriptor {
        const descriptor = resolveArcVisualState(state);
        this.applyDescriptor(descriptor);
        return descriptor;
    }

    public getDescriptor(): ArcVisualDescriptor | null { return this.descriptorValue; }
    public getSnapshot(): ArcRevealSnapshot | null { return this.snapshotValue; }

    public getModuleNode(moduleId: ArcModuleId): Node | null {
        this.ensureModuleNodes();
        return this.moduleNodes.get(moduleId) ?? null;
    }

    /** AUT-040: the modules the construction sequence reveals when the complex is first built. */
    public getConstructionModuleIds(state: GameState): readonly string[] {
        return resolveArcVisualState(state).modules;
    }

    public setConstructionSample(sample: ConstructionSample | null): void {
        if (sample !== null && this.construction === null) this.beatPending = true;
        this.construction = sample;
        if (!this.descriptorValue) return;
        this.ensureModuleNodes();
        this.applyAll();
    }

    /** AUT-040 activation: lamps on (already flickering), the cycle starts. */
    public onConstructionActivated(): void {
        this.startCycle();
        this.applyAll();
        if (isDeviceDiagnosticsEnabled()) emitDeviceEvent('advanced_robotics_complex_state', { phase: 'activated', source: 'runtime', ...this.describe() });
    }

    public update(deltaSeconds: number): void {
        const descriptor = this.descriptorValue;
        if (!descriptor || !descriptor.constructed || this.construction || !this.running) return;
        this.clock = advanceArcClock(this.clock, deltaSeconds * getPresentationTimeScale());
        this.applyArms(descriptor);
        this.applyItems(descriptor);
        this.applyLamps(descriptor, new Set<ArcModuleId>(descriptor.modules));
    }

    private applyDescriptor(descriptor: ArcVisualDescriptor): void {
        this.descriptorValue = descriptor;
        this.ensureModuleNodes();
        if (!descriptor.constructed) {
            // Unbuilt (or Reboot): the complex disappears and a stale construction never lingers.
            this.construction = null;
            this.running = false;
        } else if (!this.construction && !this.running) {
            this.startCycle();
        }
        this.applyAll();
    }

    private startCycle(): void {
        this.running = true;
        this.clock = 0;
        for (const item of this.items) item.lastCycle = Number.NEGATIVE_INFINITY;
    }

    /** One bounded focus on the complex when the construction is live (the AUT-038 reveal API; gestures interrupt it). */
    private finishBeat(): void {
        if (!this.beatPending) return;
        this.beatPending = false;
        const beat = this.viewModel.beginConstructionBeat();
        const target = this.focusAnchor?.worldPosition ?? null;
        const focused = beat.focusRequested && target !== null && this.cameraController !== null;
        if (target && this.cameraController && beat.focusRequested) this.cameraController.focusOnRevealTarget(target);
        if (!isDeviceDiagnosticsEnabled()) return;
        emitDeviceEvent('advanced_robotics_complex_state', { phase: 'construction_started', source: 'runtime', ...this.describe() });
        emitDeviceEvent('advanced_robotics_complex_state', { phase: 'focus_requested', source: 'runtime', focusRequested: focused, focus: target ? { x: target.x, z: target.z } : null });
    }

    private describe(): Record<string, unknown> {
        const descriptor = this.descriptorValue;
        return {
            constructed: descriptor?.constructed === true,
            level: descriptor?.level ?? 0,
            phase: descriptor?.phase ?? 'unbuilt',
            modules: descriptor?.modules ?? [],
            litLamps: this.lampsLit() ? descriptor?.litLamps ?? [] : [],
            poolSize: descriptor?.poolSize ?? 0,
            cycleSeconds: descriptor?.cycleSeconds ?? 0,
            armPeriodSeconds: descriptor?.armPeriodSeconds ?? 0,
            guideLit: this.lampsLit() && descriptor?.guideLit === true,
            running: this.running && this.construction === null,
            items: this.items.length,
        };
    }

    private lampsLit(): boolean {
        return this.construction === null || this.construction.activating;
    }

    private ensureModuleNodes(): void {
        for (const moduleId of ARC_MODULE_IDS) {
            if (this.moduleNodes.has(moduleId)) continue;
            if (PRIMITIVE_MODULES.has(moduleId)) {
                const primitive = this.node.getChildByName(moduleId);
                if (primitive) this.moduleNodes.set(moduleId, primitive);
                continue;
            }
            const transform = ARC_MODULE_TRANSFORMS[moduleId as Exclude<ArcModuleId, 'foundation_slab' | 'beam_1' | 'beam_2'>];
            const node = this.node.getChildByName(moduleId) ?? new Node(moduleId);
            node.parent = this.node;
            const local = arcLocal(transform.position);
            node.setPosition(local.x, local.y, local.z);
            node.setRotationFromEuler(0, transform.rotationY, 0);
            node.active = true;
            node.setScale(0, 0, 0);
            this.moduleNodes.set(moduleId, node);
            this.instantiateModule(node, moduleId);
        }
    }

    private instantiateModule(moduleNode: Node, moduleId: ArcModuleId): void {
        if (moduleNode.getChildByName(`${moduleId}_KenneyAsset`)) return;
        const slot = ARC_MODULE_PREFAB[moduleId];
        const prefab = slot ? this.prefabFor(slot) : null;
        if (!slot || !prefab) {
            Log.warn('presentation', `[AUT-044] Missing serialized prefab for ${moduleId}.`);
            return;
        }
        const imported = instantiate(prefab);
        imported.name = `${moduleId}_KenneyAsset`;
        imported.parent = moduleNode;
        imported.setPosition(0, 0, 0);
    }

    private prefabFor(slot: ArcPrefabSlot): Prefab | null {
        return this.advancedRoboticsComplexPrefabs[ARC_PREFAB_SLOTS.indexOf(slot)] ?? null;
    }

    private moduleBaseScale(moduleId: ArcModuleId): number {
        if (PRIMITIVE_MODULES.has(moduleId)) return 1;
        return ARC_MODULE_TRANSFORMS[moduleId as Exclude<ArcModuleId, 'foundation_slab' | 'beam_1' | 'beam_2'>].scale;
    }

    private moduleFactor(moduleId: ArcModuleId): number {
        return this.construction?.modules.find((module) => module.id === moduleId)?.scaleFactor ?? 1;
    }

    private applyAll(): void {
        const descriptor = this.descriptorValue;
        const visible = new Set<ArcModuleId>(descriptor?.modules ?? []);
        for (const moduleId of ARC_MODULE_IDS) {
            const node = this.moduleNodes.get(moduleId);
            if (!node) continue;
            node.active = true;
            const applied = visible.has(moduleId) ? this.moduleBaseScale(moduleId) * this.moduleFactor(moduleId) : 0;
            node.setScale(applied, applied, applied);
        }
        const zone = this.node.parent;
        for (const name of ARC_PLACEHOLDER_NODE_NAMES) {
            const placeholder = zone?.getChildByName(name);
            if (!placeholder) continue;
            placeholder.active = true;
            // During construction the inactive shell holds, then gives way while the first modules appear.
            const applied = this.construction ? Math.max(0, 1 - (this.construction.progress * 4)) : descriptor?.placeholderVisible === false ? 0 : 1;
            placeholder.setScale(applied, applied, applied);
        }
        this.applyLamps(descriptor, visible);
        this.applyGuide(descriptor);
        if (!descriptor || !descriptor.constructed || this.construction) this.hideItems();
    }

    /** Connector guide: graphite until the complex is built and active, then ~40% cyan (a colour state change, no light). */
    private applyGuide(descriptor: ArcVisualDescriptor | null): void {
        const on = descriptor?.guideLit === true && this.lampsLit();
        for (const part of ARC_GUIDE_PARTS) {
            const offNode = this.node.getChildByName(`${ARC_GUIDE_OFF_NODE_PREFIX}${part}`);
            const onNode = this.node.getChildByName(`${ARC_GUIDE_ON_NODE_PREFIX}${part}`);
            if (offNode) { offNode.active = true; const s = on ? 0 : 1; offNode.setScale(s, s, s); }
            if (onNode) { onNode.active = true; const s = on ? 1 : 0; onNode.setScale(s, s, s); }
        }
    }

    /** Lamps: unlit graphite while unbuilt / building; cyan once active, blinking on the cycle; the sampled lightLevel flickers them at activation. */
    private applyLamps(descriptor: ArcVisualDescriptor | null, visible: ReadonlySet<ArcModuleId>): void {
        const lit = new Set<ArcLampId>(descriptor?.litLamps ?? []);
        const flicker = this.construction?.activating ? 0.5 + (0.5 * this.construction.lightLevel) : 1;
        const blinking = descriptor !== null && descriptor.constructed && this.construction === null && this.running;
        const count = lit.size;
        let index = 0;
        for (const lampId of ARC_LAMP_IDS) {
            const moduleId = LAMP_MODULE[lampId];
            const ready = visible.has(moduleId) && this.moduleFactor(moduleId) >= 1;
            const isLit = lit.has(lampId);
            const blinkLit = !blinking || !isLit || lampId === 'spire' || sampleArcLampLit(this.clock, index, count, descriptor?.cycleSeconds ?? 1);
            if (isLit) index += 1;
            const on = ready && isLit && this.lampsLit() && blinkLit;
            // The spire lamp pulses once per cycle (Lv10) instead of blinking off.
            const pulse = blinking && lampId === 'spire' ? sampleArcSpirePulse(this.clock, descriptor?.cycleSeconds ?? 1) : 1;
            const offNode = this.node.getChildByName(`${ARC_LAMP_OFF_NODE_PREFIX}${lampId}`);
            const onNode = this.node.getChildByName(`${ARC_LAMP_ON_NODE_PREFIX}${lampId}`);
            if (offNode) { offNode.active = true; const s = ready && !on ? 1 : 0; offNode.setScale(s, s, s); }
            if (onNode) { onNode.active = true; const s = on ? flicker * pulse : 0; onNode.setScale(s, s, s); }
        }
    }

    private applyArms(descriptor: ArcVisualDescriptor): void {
        ARM_MODULES.forEach((armId, index) => {
            const node = this.moduleNodes.get(armId);
            if (!node || !descriptor.modules.includes(armId)) return;
            const pose = sampleArcArmPose(this.clock, index, descriptor.armPeriodSeconds);
            node.setRotationFromEuler(pose.pitchDeg, ARC_MODULE_TRANSFORMS[armId].rotationY + pose.yawDeg, 0);
        });
    }

    private ensureItems(): void {
        while (this.items.length < ARC_POOL_LIMIT) {
            const boxPrefab = this.prefabFor('box');
            if (!boxPrefab || !this.robotPrefab) {
                Log.warn('presentation', '[AUT-044] Missing serialized box / Robot prefab.');
                return;
            }
            const slot = this.items.length;
            const box = instantiate(boxPrefab);
            box.name = `${ARC_ITEM_BOX_PREFIX}${slot}`;
            box.parent = this.node;
            box.active = true;
            box.setScale(0, 0, 0);
            const robot = instantiate(this.robotPrefab);
            robot.name = `${ARC_ITEM_ROBOT_PREFIX}${slot}`;
            robot.parent = this.node;
            robot.active = true;
            robot.setScale(0, 0, 0);
            this.items.push({ box, robot, animations: robot.getComponentsInChildren(Animation), robotPlaying: false, lastCycle: Number.NEGATIVE_INFINITY });
        }
    }

    private hideItems(): void {
        for (const item of this.items) {
            item.box.setScale(0, 0, 0);
            item.robot.setScale(0, 0, 0);
            item.robotPlaying = false;
        }
    }

    private applyItems(descriptor: ArcVisualDescriptor): void {
        this.ensureItems();
        const diagnostics = isDeviceDiagnosticsEnabled();
        for (let slot = 0; slot < this.items.length; slot += 1) {
            const item = this.items[slot];
            const enabled = slot < descriptor.poolSize;
            if (!enabled) {
                item.box.setScale(0, 0, 0);
                item.robot.setScale(0, 0, 0);
                item.robotPlaying = false;
                continue;
            }
            const sample = sampleArcJob(this.clock, slot, descriptor.poolSize, descriptor.cycleSeconds);
            const boxLocal = arcLocal(sample.box);
            const robotLocal = arcLocal(sample.robot);
            const boxScale = ARC_BOX_SCALE * sample.box.visibility;
            const robotScale = ARC_ROBOT_SCALE * sample.robot.visibility;
            item.box.setPosition(boxLocal.x, boxLocal.y, boxLocal.z);
            item.box.setScale(boxScale, boxScale, boxScale);
            item.robot.setPosition(robotLocal.x, robotLocal.y, robotLocal.z);
            item.robot.setRotationFromEuler(0, sample.robotHeadingDeg, 0);
            item.robot.setScale(robotScale, robotScale, robotScale);
            if (robotScale > 0 && !item.robotPlaying) {
                item.robotPlaying = true;
                for (const animation of item.animations) if (animation.clips.some((entry) => entry?.name === 'Robot_Idle')) animation.play('Robot_Idle');
            }
            if (diagnostics && sample.cycle > item.lastCycle) {
                if (item.lastCycle !== Number.NEGATIVE_INFINITY) emitDeviceEvent('advanced_robotics_complex_state', { phase: 'item_cycle', source: 'runtime', slot, cycle: sample.cycle, poolSize: descriptor.poolSize, producerId: ARC_PRODUCER_ID });
                item.lastCycle = sample.cycle;
            }
        }
    }
}
