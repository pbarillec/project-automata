import { Log } from '../logging/Log.ts';
import { _decorator, Camera, Color, Component, DirectionalLight, instantiate, MeshRenderer, Node } from 'cc';
import type { Material, Prefab } from 'cc';
import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import { emitDeviceEvent, isDeviceDiagnosticsEnabled } from './DeviceDiagnostics';
import {
    ERA_ENV_BOXES,
    ERA_ENV_GROUP_IDS,
    ERA_ENV_GROUP_NODE_NAMES,
    ERA_ENV_PREFAB_INSTANCES,
    ERA_ENV_PREFAB_SLOTS,
    ERA_ENV_SHELL_NODE_NAMES,
    TEASER_CORE_CENTER,
    TEASER_CORE_SPIN_DEG_PER_SECOND,
    TEASER_CORE_TILT_DEG,
    ERA_ENV_CYAN,
    type EraEnvironmentGroupId,
    type Rgb,
} from './EraEnvironmentLayout.ts';
import { framesEqual, sampleTeaserCoreYaw, sampleTeaserSeamPulse, type EraEnvironmentFrame } from './EraEnvironmentStateResolver.ts';
import { EraEnvironmentViewModel, type EraEnvironmentSnapshot, type EraEnvironmentStatePhase } from './EraEnvironmentViewModel.ts';

const { ccclass } = _decorator;

const SEAM_NODE_ID = 'teaser_seam';
const CORE_NODE_ID = 'teaser_core';

const toColor = (rgb: Rgb): Color => new Color(Math.round(rgb.r), Math.round(rgb.g), Math.round(rgb.b), 255);

/**
 * AUT-045 presentation-only era environment: a thin controller over the pure `EraEnvironmentStateResolver` /
 * `EraEnvironmentViewModel`. The era (Manual Workshop / Automated Factory / Robotics Complex) recolours the three shell boxes,
 * the clear colour and the key light, and shows the hall / vertical group / AI Megafactory teaser built by FactoryWorldBootstrap
 * (primitives) plus `structure-high` instances from the serialized `environmentPrefabs`. Visibility is by SCALE (a hidden group has
 * scale 0; a group that appears rises by scale-Y), never `node.active`. A load / Reboot snaps; a live era change fades 1.2 s and
 * rises 1.0 s, concurrently with the producer construction reveal, without taking camera focus. It never writes GameState and
 * never touches producer, zone-foundation, lamp, Fabricator or guide nodes.
 */
@ccclass('EraEnvironmentVisualController')
export class EraEnvironmentVisualController extends Component {
    /** Supplied by FactoryWorldBootstrap at runtime (index-aligned with ERA_ENV_PREFAB_SLOTS: the AUT-032 structure-high prefab). */
    public environmentPrefabs: Prefab[] = [];
    public worldCamera: Camera | null = null;
    public keyLight: DirectionalLight | null = null;

    private readonly viewModel = new EraEnvironmentViewModel();
    private readonly groupNodes = new Map<EraEnvironmentGroupId, Node>();
    private readonly materials = new Map<string, Material>();
    private readonly shellMaterials = new Map<string, Material>();
    private instantiated = false;
    private resolved = false;
    private applied: EraEnvironmentFrame | null = null;
    private clock = 0;

    public start(): void {
        this.ensureNodes();
        if (!this.applied) this.applyFrame(this.viewModel.getFrame() ?? this.syncDefault());
    }

    /** Initial / restored state: the environment is rebuilt instantly (no fade, no rise). */
    public sync(state: GameState): EraEnvironmentSnapshot {
        const snapshot = this.viewModel.syncFromState(state);
        this.applyFrame(snapshot.frame);
        this.report('synced', 'session', snapshot);
        return snapshot;
    }

    public consumeDomainEvents(state: GameState, events: readonly DomainEvent[]): EraEnvironmentSnapshot {
        const snapshot = this.viewModel.consumeEvents(state, events);
        this.applyFrame(snapshot.frame);
        if (snapshot.transitionStarted) this.report('transition_started', 'runtime', snapshot);
        else if (snapshot.snapped) this.report('snapped', 'runtime', snapshot);
        return snapshot;
    }

    public getFrame(): EraEnvironmentFrame | null { return this.viewModel.getFrame(); }
    public getGroupNode(group: EraEnvironmentGroupId): Node | null {
        this.ensureNodes();
        return this.groupNodes.get(group) ?? null;
    }

    public update(deltaSeconds: number): void {
        const wasTransitioning = this.viewModel.isTransitioning();
        const frame = this.viewModel.advance(deltaSeconds);
        if (frame && (wasTransitioning || !this.applied)) this.applyFrame(frame);
        if (wasTransitioning && !this.viewModel.isTransitioning() && isDeviceDiagnosticsEnabled()) {
            emitDeviceEvent('era_environment_state', { phase: 'transition_finished', source: 'runtime', ...this.describe() });
        }
        const rise = this.applied?.rise.teaser ?? 0;
        if (rise > 0) this.animateTeaser(deltaSeconds);
    }

    private syncDefault(): EraEnvironmentFrame {
        // No session yet: show the Manual Workshop (the pre-AUT-045 look) until the first sync.
        return this.viewModel.syncFromEra('manual_workshop').frame;
    }

    private animateTeaser(deltaSeconds: number): void {
        this.clock += Math.max(0, deltaSeconds);
        const core = this.findBoxNode(CORE_NODE_ID);
        if (core) core.setRotationFromEuler(TEASER_CORE_TILT_DEG, sampleTeaserCoreYaw(this.clock, TEASER_CORE_SPIN_DEG_PER_SECOND), 0);
        const seam = this.materials.get(SEAM_NODE_ID);
        if (seam) {
            const pulse = sampleTeaserSeamPulse(this.clock);
            seam.setProperty('mainColor', toColor({ r: ERA_ENV_CYAN.r * pulse, g: ERA_ENV_CYAN.g * pulse, b: ERA_ENV_CYAN.b * pulse }));
        }
    }

    private findBoxNode(id: string): Node | null {
        const box = ERA_ENV_BOXES.find((entry) => entry.id === id);
        return box ? this.groupNodes.get(box.group)?.getChildByName(id) ?? null : null;
    }

    private ensureNodes(): void {
        if (!this.resolved) {
            for (const group of ERA_ENV_GROUP_IDS) {
                const node = this.node.getChildByName(ERA_ENV_GROUP_NODE_NAMES[group]);
                if (node) this.groupNodes.set(group, node);
            }
            for (const box of ERA_ENV_BOXES) {
                const material = this.groupNodes.get(box.group)?.getChildByName(box.id)?.getComponent(MeshRenderer)?.getSharedMaterial(0);
                if (material) this.materials.set(box.id, material);
            }
            const site = this.node.parent;
            for (const name of ERA_ENV_SHELL_NODE_NAMES) {
                const material = site?.getChildByName(name)?.getComponent(MeshRenderer)?.getSharedMaterial(0);
                if (material) this.shellMaterials.set(name, material);
            }
            this.resolved = this.groupNodes.size === ERA_ENV_GROUP_IDS.length;
        }
        if (this.instantiated || !this.resolved) return;
        const prefab = this.environmentPrefabs[ERA_ENV_PREFAB_SLOTS.indexOf('structure_high')] ?? null;
        if (!prefab) {
            Log.warn('presentation', '[AUT-045] Missing serialized structure-high prefab.');
            return;
        }
        for (const instance of ERA_ENV_PREFAB_INSTANCES) {
            const parent = this.groupNodes.get(instance.group);
            if (!parent || parent.getChildByName(instance.id)) continue;
            const node = instantiate(prefab);
            node.name = instance.id;
            node.parent = parent;
            node.setPosition(instance.position.x, instance.position.y, instance.position.z);
            node.setRotationFromEuler(0, instance.rotationY, 0);
            node.setScale(instance.scale, instance.scale, instance.scale);
        }
        this.instantiated = true;
    }

    private applyFrame(frame: EraEnvironmentFrame): void {
        this.ensureNodes();
        if (this.applied && framesEqual(this.applied, frame)) return;
        this.applied = frame;
        const palette = frame.palette;
        this.shellMaterials.get('SiteBoundary')?.setProperty('mainColor', toColor(palette.siteBoundary));
        this.shellMaterials.get('MainLogisticsSpine')?.setProperty('mainColor', toColor(palette.mainLogisticsSpine));
        this.shellMaterials.get('FutureAccessBarrier')?.setProperty('mainColor', toColor(palette.futureAccessBarrier));
        for (const box of ERA_ENV_BOXES) {
            if (box.role === undefined) continue;
            this.materials.get(box.id)?.setProperty('mainColor', toColor(palette[box.role]));
        }
        if (this.worldCamera) {
            this.worldCamera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
            this.worldCamera.clearColor = toColor(palette.clear);
        }
        if (this.keyLight) {
            this.keyLight.color = toColor(palette.keyLightColor);
            this.keyLight.illuminance = palette.keyLightIlluminance;
        }
        for (const group of ERA_ENV_GROUP_IDS) {
            const node = this.groupNodes.get(group);
            if (!node) continue;
            node.active = true;
            const rise = frame.rise[group];
            if (rise <= 0) node.setScale(0, 0, 0);
            else node.setScale(1, rise, 1);
        }
    }

    private describe(): Record<string, unknown> {
        const descriptor = this.viewModel.getDescriptor();
        const frame = this.viewModel.getFrame();
        return {
            eraId: descriptor?.eraId ?? null,
            hall: frame?.rise.hall ?? 0,
            vertical: frame?.rise.vertical ?? 0,
            teaser: frame?.rise.teaser ?? 0,
            transitioning: this.viewModel.isTransitioning(),
            clear: frame ? { r: Math.round(frame.palette.clear.r), g: Math.round(frame.palette.clear.g), b: Math.round(frame.palette.clear.b) } : null,
            illuminance: frame ? Math.round(frame.palette.keyLightIlluminance) : null,
            core: { x: TEASER_CORE_CENTER.x, z: TEASER_CORE_CENTER.z },
        };
    }

    private report(phase: EraEnvironmentStatePhase, source: string, _snapshot: EraEnvironmentSnapshot): void {
        if (!isDeviceDiagnosticsEnabled()) return;
        emitDeviceEvent('era_environment_state', { phase, source, ...this.describe() });
    }
}
