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
    ROBOT_LINE_BELT_TILE_SCALE,
    ROBOT_LINE_CHASSIS_SCALE,
    ROBOT_LINE_FINISHED_ROBOT_SCALE,
    ROBOT_LINE_LAMP_IDS,
    ROBOT_LINE_MODULE_IDS,
    ROBOT_LINE_MODULE_PREFAB,
    ROBOT_LINE_MODULE_TRANSFORMS,
    ROBOT_LINE_PLACEHOLDER_NODE_NAMES,
    ROBOT_LINE_PRODUCER_ID,
    ROBOT_LINE_PREFAB_SLOTS,
    robotLineBeltTileOffsets,
    robotLineLocal,
    type RobotLineLampId,
    type RobotLineModuleId,
    type RobotLinePrefabSlot,
} from './RobotLineLayout.ts';
import { advanceBeltClock, beltItemPhase, ROBOT_LINE_ITEM_POOL_SIZE, sampleArmPose, sampleBeltItem } from './RobotLineProduction.ts';
import { RobotLineRevealViewModel, type RobotLineRevealSnapshot } from './RobotLineRevealViewModel.ts';
import { resolveRobotLineVisualState, type RobotLineVisualDescriptor } from './RobotLineVisualStateResolver.ts';
import { getPresentationTimeScale } from './PresentationTimeScale.ts';

const { ccclass } = _decorator;

/** Primitive nodes built by FactoryWorldBootstrap under the composition anchor. */
export const ROBOT_LINE_SLAB_NODE_NAME = 'foundation_slab';
export const ROBOT_LINE_LIP_NODE_NAME = 'output_lip';
export const ROBOT_LINE_LAMP_OFF_NODE_PREFIX = 'robot_line_lamp_off_';
export const ROBOT_LINE_LAMP_ON_NODE_PREFIX = 'robot_line_lamp_on_';
export const ROBOT_LINE_ITEM_CHASSIS_PREFIX = 'RobotLineChassis_';
export const ROBOT_LINE_ITEM_ROBOT_PREFIX = 'RobotLineRobot_';

/** Modules that are primitives (the bootstrap builds them); the rest come from `robotLinePrefabs`. */
const PRIMITIVE_MODULES: ReadonlySet<RobotLineModuleId> = new Set<RobotLineModuleId>(['foundation_slab', 'output_lip']);
const LAMP_MODULE: Readonly<Record<RobotLineLampId, RobotLineModuleId>> = Object.freeze({ machine_a: 'machine_a', arm_a: 'arm_a', machine_b: 'machine_b', arm_b: 'arm_b' });

interface BeltItem {
    readonly chassis: Node;
    readonly robot: Node;
    readonly animations: Animation[];
    robotPlaying: boolean;
    lastCycle: number;
}

/**
 * AUT-042 presentation-only Robot Line composition: thin controller over the pure
 * `resolveRobotLineVisualState`, `RobotLineProduction` and `RobotLineRevealViewModel`. Modules are AUT-032
 * prefabs serialized on FactoryWorldBootstrap (`robotLinePrefabs`, index-aligned with ROBOT_LINE_PREFAB_SLOTS).
 * Visibility uses scale, never `node.active` (AUT-038 Android rule). Registered as an AUT-040 ConstructionTarget;
 * the live construction triggers one bounded camera focus through the existing reveal API. Fake production is a
 * pooled belt of 2 (Lv1) / 4 (Lv10) items driven by a belt clock. It never writes GameState.
 */
@ccclass('RobotLineVisualController')
export class RobotLineVisualController extends Component implements ConstructionTarget {
    /** Supplied by FactoryWorldBootstrap at runtime (index-aligned with ROBOT_LINE_PREFAB_SLOTS). */
    public robotLinePrefabs: Prefab[] = [];
    /** Supplied by FactoryWorldBootstrap at runtime (the AUT-032 Robot.glb prefab, shared with the Worker Bot). */
    public robotPrefab: Prefab | null = null;
    public cameraController: MobileCameraController | null = null;
    public focusAnchor: Node | null = null;

    private readonly viewModel = new RobotLineRevealViewModel();
    private readonly moduleNodes = new Map<RobotLineModuleId, Node>();
    private readonly items: BeltItem[] = [];
    private descriptorValue: RobotLineVisualDescriptor | null = null;
    private snapshotValue: RobotLineRevealSnapshot | null = null;
    private construction: ConstructionSample | null = null;
    private beatPending = false;
    private running = false;
    private beltClock = 0;
    private activeItemCount = 0;
    private readonly slotGate: number[] = [];
    private armClock = 0;

    public start(): void {
        this.ensureModuleNodes();
        if (!this.descriptorValue) this.applyAll();
    }

    /** Initial / restored state: rebuilds the line instantly, never replays the construction. */
    public sync(state: GameState): RobotLineRevealSnapshot {
        this.snapshotValue = this.viewModel.syncFromState(state);
        this.applyDescriptor(this.snapshotValue.descriptor);
        this.finishBeat();
        if (isDeviceDiagnosticsEnabled()) emitDeviceEvent('robot_line_state', { phase: 'synced', source: 'session', ...this.describe() });
        return this.snapshotValue;
    }

    public consumeDomainEvents(state: GameState, events: readonly DomainEvent[]): RobotLineRevealSnapshot {
        this.snapshotValue = this.viewModel.consumeEvents(state, events);
        this.applyDescriptor(this.snapshotValue.descriptor);
        this.finishBeat();
        return this.snapshotValue;
    }

    public syncFromGameState(state: GameState): RobotLineVisualDescriptor {
        const descriptor = resolveRobotLineVisualState(state);
        this.applyDescriptor(descriptor);
        return descriptor;
    }

    public getDescriptor(): RobotLineVisualDescriptor | null { return this.descriptorValue; }
    public getSnapshot(): RobotLineRevealSnapshot | null { return this.snapshotValue; }

    public getModuleNode(moduleId: RobotLineModuleId): Node | null {
        this.ensureModuleNodes();
        return this.moduleNodes.get(moduleId) ?? null;
    }

    /** AUT-040: the modules the construction sequence reveals when the line is first built. */
    public getConstructionModuleIds(state: GameState): readonly string[] {
        return resolveRobotLineVisualState(state).modules;
    }

    public setConstructionSample(sample: ConstructionSample | null): void {
        if (sample !== null && this.construction === null) this.beatPending = true;
        this.construction = sample;
        if (!this.descriptorValue) return;
        this.ensureModuleNodes();
        this.applyAll();
    }

    /** AUT-040 activation: lamps on (already pulsing), the belt starts and the first chassis enters. */
    public onConstructionActivated(): void {
        this.startBelt(true);
        this.applyAll();
        if (isDeviceDiagnosticsEnabled()) emitDeviceEvent('robot_line_state', { phase: 'activated', source: 'runtime', ...this.describe() });
    }

    public update(deltaSeconds: number): void {
        const descriptor = this.descriptorValue;
        if (!descriptor || !descriptor.constructed || this.construction || !this.running) return;
        const speed = getPresentationTimeScale(); // AUT-047 presentation time scale (presentation clocks only)
        this.armClock += deltaSeconds * speed;
        this.beltClock = advanceBeltClock(this.beltClock, deltaSeconds * speed, descriptor.beltCadence);
        this.applyArms();
        this.applyItems(descriptor);
    }

    private applyDescriptor(descriptor: RobotLineVisualDescriptor): void {
        const previous = this.descriptorValue;
        this.descriptorValue = descriptor;
        this.ensureModuleNodes();
        if (!descriptor.constructed) {
            // Unbuilt (or Reboot): the line disappears and a stale construction never lingers.
            this.construction = null;
            this.running = false;
        } else if (!this.construction && !this.running) {
            this.startBelt(false);
        } else if (previous && descriptor.itemCount > this.activeItemCount) {
            // Lv10: new slots wait for their next entry instead of popping in mid-belt.
            for (let slot = this.activeItemCount; slot < descriptor.itemCount; slot += 1) this.slotGate[slot] = Math.ceil(this.beltClock + beltItemPhase(slot));
        }
        if (descriptor.constructed) this.activeItemCount = Math.max(this.activeItemCount, descriptor.itemCount);
        if (!descriptor.constructed) this.activeItemCount = 0;
        this.applyAll();
    }

    /** `fresh` = the live activation (the first chassis enters now); otherwise a loaded save starts mid-belt. */
    private startBelt(fresh: boolean): void {
        this.running = true;
        this.activeItemCount = this.descriptorValue?.itemCount ?? 0;
        if (fresh) {
            this.beltClock = -beltItemPhase(0);
            for (let slot = 0; slot < ROBOT_LINE_ITEM_POOL_SIZE; slot += 1) this.slotGate[slot] = 0;
        } else {
            this.beltClock = 0;
            for (let slot = 0; slot < ROBOT_LINE_ITEM_POOL_SIZE; slot += 1) this.slotGate[slot] = Number.NEGATIVE_INFINITY;
        }
        for (const item of this.items) item.lastCycle = Number.NEGATIVE_INFINITY;
    }

    /** One bounded focus on the line when the construction is live (the AUT-038 reveal API; gestures interrupt it). */
    private finishBeat(): void {
        if (!this.beatPending) return;
        this.beatPending = false;
        const beat = this.viewModel.beginConstructionBeat();
        const target = this.focusAnchor?.worldPosition ?? null;
        const focused = beat.focusRequested && target !== null && this.cameraController !== null;
        if (target && this.cameraController && beat.focusRequested) this.cameraController.focusOnRevealTarget(target);
        if (!isDeviceDiagnosticsEnabled()) return;
        emitDeviceEvent('robot_line_state', { phase: 'construction_started', source: 'runtime', eraReveal: beat.eraReveal, ...this.describe() });
        emitDeviceEvent('robot_line_state', { phase: 'focus_requested', source: 'runtime', focusRequested: focused, focus: target ? { x: target.x, z: target.z } : null });
    }

    private describe(): Record<string, unknown> {
        const descriptor = this.descriptorValue;
        return {
            constructed: descriptor?.constructed === true,
            level: descriptor?.level ?? 0,
            phase: descriptor?.phase ?? 'unbuilt',
            modules: descriptor?.modules ?? [],
            litLamps: this.lampsLit() ? descriptor?.litLamps ?? [] : [],
            itemCount: descriptor?.itemCount ?? 0,
            beltCadence: descriptor?.beltCadence ?? 1,
            running: this.running && this.construction === null,
            eraAutomatedFactory: descriptor?.eraAutomatedFactory === true,
            items: this.items.length,
        };
    }

    private lampsLit(): boolean {
        return this.construction === null || this.construction.activating;
    }

    private ensureModuleNodes(): void {
        for (const moduleId of ROBOT_LINE_MODULE_IDS) {
            if (this.moduleNodes.has(moduleId)) continue;
            if (PRIMITIVE_MODULES.has(moduleId)) {
                const primitive = this.node.getChildByName(moduleId === 'foundation_slab' ? ROBOT_LINE_SLAB_NODE_NAME : ROBOT_LINE_LIP_NODE_NAME);
                if (primitive) this.moduleNodes.set(moduleId, primitive);
                continue;
            }
            const transform = ROBOT_LINE_MODULE_TRANSFORMS[moduleId as Exclude<RobotLineModuleId, 'foundation_slab' | 'output_lip'>];
            const node = this.node.getChildByName(moduleId) ?? new Node(moduleId);
            node.parent = this.node;
            const local = robotLineLocal(transform.position);
            node.setPosition(local.x, local.y, local.z);
            node.setRotationFromEuler(0, transform.rotationY, 0);
            node.active = true;
            node.setScale(0, 0, 0);
            this.moduleNodes.set(moduleId, node);
            this.instantiateModule(node, moduleId);
        }
    }

    private instantiateModule(moduleNode: Node, moduleId: RobotLineModuleId): void {
        if (moduleNode.getChildByName(`${moduleId}_KenneyAsset`) || moduleNode.getChildByName('belt_tile_0')) return;
        const slot = ROBOT_LINE_MODULE_PREFAB[moduleId];
        const prefab = slot ? this.prefabFor(slot) : null;
        if (!slot || !prefab) {
            Log.warn('presentation', `[AUT-042] Missing serialized prefab for ${moduleId}.`);
            return;
        }
        if (moduleId === 'belt') {
            robotLineBeltTileOffsets().forEach((offset, index) => {
                const tile = instantiate(prefab);
                tile.name = `belt_tile_${index}`;
                tile.parent = moduleNode;
                tile.setPosition(offset, 0, 0);
                tile.setScale(ROBOT_LINE_BELT_TILE_SCALE, ROBOT_LINE_BELT_TILE_SCALE, ROBOT_LINE_BELT_TILE_SCALE);
            });
            return;
        }
        const imported = instantiate(prefab);
        imported.name = `${moduleId}_KenneyAsset`;
        imported.parent = moduleNode;
        imported.setPosition(0, 0, 0);
    }

    private prefabFor(slot: RobotLinePrefabSlot): Prefab | null {
        return this.robotLinePrefabs[ROBOT_LINE_PREFAB_SLOTS.indexOf(slot)] ?? null;
    }

    private moduleBaseScale(moduleId: RobotLineModuleId): number {
        if (PRIMITIVE_MODULES.has(moduleId) || moduleId === 'belt') return 1;
        return ROBOT_LINE_MODULE_TRANSFORMS[moduleId as Exclude<RobotLineModuleId, 'foundation_slab' | 'output_lip'>].scale;
    }

    private moduleFactor(moduleId: RobotLineModuleId): number {
        return this.construction?.modules.find((module) => module.id === moduleId)?.scaleFactor ?? 1;
    }

    private applyAll(): void {
        const descriptor = this.descriptorValue;
        const visible = new Set<RobotLineModuleId>(descriptor?.modules ?? []);
        for (const moduleId of ROBOT_LINE_MODULE_IDS) {
            const node = this.moduleNodes.get(moduleId);
            if (!node) continue;
            node.active = true;
            const applied = visible.has(moduleId) ? this.moduleBaseScale(moduleId) * this.moduleFactor(moduleId) : 0;
            node.setScale(applied, applied, applied);
        }
        const zone = this.node.parent;
        for (const name of ROBOT_LINE_PLACEHOLDER_NODE_NAMES) {
            const placeholder = zone?.getChildByName(name);
            if (!placeholder) continue;
            placeholder.active = true;
            // During construction the inactive shell holds, then gives way while the first modules appear.
            const applied = this.construction ? Math.max(0, 1 - (this.construction.progress * 4)) : descriptor?.placeholderVisible === false ? 0 : 1;
            placeholder.setScale(applied, applied, applied);
        }
        this.applyLamps(descriptor, visible);
        if (!descriptor || !descriptor.constructed || this.construction) this.hideItems();
    }

    /** Lamps: unlit graphite while unbuilt / building; cyan once active. The sampled lightLevel flickers them at activation. */
    private applyLamps(descriptor: RobotLineVisualDescriptor | null, visible: ReadonlySet<RobotLineModuleId>): void {
        const lit = new Set<RobotLineLampId>(descriptor?.litLamps ?? []);
        const flicker = this.construction?.activating ? 0.5 + (0.5 * this.construction.lightLevel) : 1;
        for (const lampId of ROBOT_LINE_LAMP_IDS) {
            const moduleId = LAMP_MODULE[lampId];
            const ready = visible.has(moduleId) && this.moduleFactor(moduleId) >= 1;
            const on = ready && lit.has(lampId) && this.lampsLit();
            const offNode = this.node.getChildByName(`${ROBOT_LINE_LAMP_OFF_NODE_PREFIX}${lampId}`);
            const onNode = this.node.getChildByName(`${ROBOT_LINE_LAMP_ON_NODE_PREFIX}${lampId}`);
            if (offNode) { offNode.active = true; const s = ready && !on ? 1 : 0; offNode.setScale(s, s, s); }
            if (onNode) { onNode.active = true; const s = on ? flicker : 0; onNode.setScale(s, s, s); }
        }
    }

    private applyArms(): void {
        const descriptor = this.descriptorValue;
        if (!descriptor) return;
        (['arm_a', 'arm_b'] as const).forEach((armId, index) => {
            const node = this.moduleNodes.get(armId);
            if (!node || !descriptor.modules.includes(armId)) return;
            const pose = sampleArmPose(this.armClock, index);
            node.setRotationFromEuler(pose.pitchDeg, pose.yawDeg, 0);
        });
    }

    private ensureItems(): void {
        while (this.items.length < ROBOT_LINE_ITEM_POOL_SIZE) {
            const chassisPrefab = this.prefabFor('chassis');
            if (!chassisPrefab || !this.robotPrefab) {
                Log.warn('presentation', '[AUT-042] Missing serialized chassis / Robot prefab.');
                return;
            }
            const slot = this.items.length;
            const chassis = instantiate(chassisPrefab);
            chassis.name = `${ROBOT_LINE_ITEM_CHASSIS_PREFIX}${slot}`;
            chassis.parent = this.node;
            chassis.active = true;
            chassis.setScale(0, 0, 0);
            const robot = instantiate(this.robotPrefab);
            robot.name = `${ROBOT_LINE_ITEM_ROBOT_PREFIX}${slot}`;
            robot.parent = this.node;
            robot.active = true;
            robot.setScale(0, 0, 0);
            this.items.push({ chassis, robot, animations: robot.getComponentsInChildren(Animation), robotPlaying: false, lastCycle: Number.NEGATIVE_INFINITY });
        }
    }

    private hideItems(): void {
        for (const item of this.items) {
            item.chassis.setScale(0, 0, 0);
            item.robot.setScale(0, 0, 0);
            item.robotPlaying = false;
        }
    }

    private applyItems(descriptor: RobotLineVisualDescriptor): void {
        this.ensureItems();
        const machineB = descriptor.milestoneTier >= 10;
        const diagnostics = isDeviceDiagnosticsEnabled();
        for (let slot = 0; slot < this.items.length; slot += 1) {
            const item = this.items[slot];
            const enabled = slot < descriptor.itemCount;
            const sample = sampleBeltItem(this.beltClock, slot, machineB);
            const gated = (this.beltClock + beltItemPhase(slot)) < (this.slotGate[slot] ?? 0);
            const visibility = enabled && !gated ? sample.visibility : 0;
            const local = robotLineLocal({ x: sample.x, y: sample.y, z: sample.z });
            const chassisScale = sample.kind === 'chassis' ? ROBOT_LINE_CHASSIS_SCALE * visibility : 0;
            const robotScale = sample.kind === 'robot' ? ROBOT_LINE_FINISHED_ROBOT_SCALE * visibility : 0;
            item.chassis.setPosition(local.x, local.y, local.z);
            item.chassis.setScale(chassisScale, chassisScale, chassisScale);
            item.robot.setPosition(local.x, local.y, local.z);
            item.robot.setRotationFromEuler(0, sample.headingDeg, 0);
            item.robot.setScale(robotScale, robotScale, robotScale);
            if (robotScale > 0 && !item.robotPlaying) {
                item.robotPlaying = true;
                for (const animation of item.animations) if (animation.clips.some((entry) => entry?.name === 'Robot_Idle')) animation.play('Robot_Idle');
            }
            if (enabled && !gated && diagnostics && sample.cycle > item.lastCycle) {
                if (item.lastCycle !== Number.NEGATIVE_INFINITY) emitDeviceEvent('robot_line_state', { phase: 'item_cycle', source: 'runtime', slot, cycle: sample.cycle, itemCount: descriptor.itemCount, producerId: ROBOT_LINE_PRODUCER_ID });
                item.lastCycle = sample.cycle;
            }
        }
    }
}
