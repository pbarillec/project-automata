import { Log } from '../logging/Log.ts';
import { _decorator, Component, instantiate, Node } from 'cc';
import type { Prefab } from 'cc';
import type { GameState } from '../state/GameState.ts';
import {
    ASSEMBLY_MODULE_IDS,
    ASSEMBLY_MODULE_TRANSFORMS,
    ASSEMBLY_SERIALIZED_PREFAB_MODULES,
    assemblyLocal,
    type AssemblyModuleId,
    type AssemblyPrefabModuleId,
} from './AssemblySliceLayout.ts';
import { resolveAssemblyVisualState, type AssemblyVisualDescriptor } from './AssemblyVisualStateResolver.ts';
import type { ConstructionSample } from './ConstructionSequence.ts';
import type { ConstructionTarget } from './ConstructionPresentationController';
import { getPresentationTimeScale } from './PresentationTimeScale.ts';

const { ccclass } = _decorator;

/** AUT-033 placeholder boxes of the unbuilt Assembly zone (siblings of the composition anchor). */
export const ASSEMBLY_PLACEHOLDER_NODE_NAMES = Object.freeze(['AssemblyStation_InactiveShell', 'AssemblyStation_DisconnectedLogistics']);
/** Primitive slab built by FactoryWorldBootstrap under the composition anchor. */
export const ASSEMBLY_SLAB_NODE_NAME = 'foundation_slab';

const PANEL_PULSE_AMOUNT = 0.03;

/**
 * AUT-039 presentation-only Assembly Station composition (thin controller over the pure
 * `resolveAssemblyVisualState`). Modules are AUT-032 prefabs serialized on FactoryWorldBootstrap
 * (`assemblyPrefabs`, index-aligned with ASSEMBLY_SERIALIZED_PREFAB_MODULES). Visibility uses scale so
 * Android native never deactivates imported 3D nodes (AUT-038 rule). It never writes GameState.
 */
@ccclass('AssemblyVisualController')
export class AssemblyVisualController extends Component implements ConstructionTarget {
    /** Supplied by FactoryWorldBootstrap at runtime. */
    public assemblyPrefabs: Prefab[] = [];

    private readonly moduleNodes = new Map<AssemblyModuleId, Node>();
    private descriptorValue: AssemblyVisualDescriptor | null = null;
    private panelTime = 0;
    /** AUT-040: while a construction sequence runs, module scales follow it instead of snapping to the built state. */
    private construction: ConstructionSample | null = null;

    public start(): void {
        this.ensureModuleNodes();
        if (!this.descriptorValue) this.applyModules(new Set(), true);
    }

    public syncFromGameState(state: GameState): AssemblyVisualDescriptor {
        const descriptor = resolveAssemblyVisualState(state);
        this.applyDescriptor(descriptor);
        return descriptor;
    }

    public applyDescriptor(descriptor: AssemblyVisualDescriptor): void {
        this.descriptorValue = descriptor;
        this.ensureModuleNodes();
        this.applyModules(new Set(descriptor.modules), descriptor.placeholderVisible);
    }

    /** AUT-040: the modules the construction sequence reveals when the station is first built. */
    public getConstructionModuleIds(state: GameState): readonly string[] {
        return resolveAssemblyVisualState(state).modules;
    }

    public setConstructionSample(sample: ConstructionSample | null): void {
        this.construction = sample;
        if (!this.descriptorValue) return;
        this.ensureModuleNodes();
        this.applyModules(new Set(this.descriptorValue.modules), this.descriptorValue.placeholderVisible);
    }

    public getDescriptor(): AssemblyVisualDescriptor | null {
        return this.descriptorValue;
    }

    public getModuleNode(moduleId: AssemblyModuleId): Node | null {
        this.ensureModuleNodes();
        return this.moduleNodes.get(moduleId) ?? null;
    }

    public update(deltaSeconds: number): void {
        const descriptor = this.descriptorValue;
        const panel = this.moduleNodes.get('status_panel');
        if (this.construction || !descriptor || !panel || !descriptor.panelLit || !descriptor.modules.includes('status_panel')) return;
        this.panelTime += deltaSeconds * getPresentationTimeScale(); // AUT-047 presentation time scale
        const scale = ASSEMBLY_MODULE_TRANSFORMS.status_panel.scale * (1 + (Math.sin(this.panelTime * 5) * PANEL_PULSE_AMOUNT));
        panel.setScale(scale, scale, scale);
    }

    private ensureModuleNodes(): void {
        if (!this.moduleNodes.has('foundation_slab')) {
            const slab = this.node.getChildByName(ASSEMBLY_SLAB_NODE_NAME);
            if (slab) this.moduleNodes.set('foundation_slab', slab);
        }
        for (const moduleId of ASSEMBLY_SERIALIZED_PREFAB_MODULES) {
            if (this.moduleNodes.has(moduleId)) continue;
            const node = this.node.getChildByName(moduleId) ?? new Node(moduleId);
            node.parent = this.node;
            const transform = ASSEMBLY_MODULE_TRANSFORMS[moduleId];
            const local = assemblyLocal(transform.position);
            node.setPosition(local.x, local.y, local.z);
            node.setRotationFromEuler(0, transform.rotationY, 0);
            node.active = true;
            node.setScale(0, 0, 0);
            this.moduleNodes.set(moduleId, node);
            this.instantiateSerializedAsset(node, moduleId);
        }
    }

    private applyModules(visible: ReadonlySet<AssemblyModuleId>, placeholderVisible: boolean): void {
        for (const moduleId of ASSEMBLY_MODULE_IDS) {
            const node = this.moduleNodes.get(moduleId);
            if (!node) continue;
            node.active = true;
            const scale = moduleId === 'foundation_slab' ? 1 : ASSEMBLY_MODULE_TRANSFORMS[moduleId as AssemblyPrefabModuleId].scale;
            const factor = this.construction?.modules.find((module) => module.id === moduleId)?.scaleFactor ?? 1;
            const applied = visible.has(moduleId) ? scale * factor : 0;
            node.setScale(applied, applied, applied);
        }
        const zone = this.node.parent;
        for (const name of ASSEMBLY_PLACEHOLDER_NODE_NAMES) {
            const placeholder = zone?.getChildByName(name);
            if (!placeholder) continue;
            placeholder.active = true;
            // During construction the inactive shell holds, then gives way while the first modules appear.
            const applied = this.construction ? Math.max(0, 1 - (this.construction.progress * 4)) : placeholderVisible ? 1 : 0;
            placeholder.setScale(applied, applied, applied);
        }
    }

    private instantiateSerializedAsset(moduleNode: Node, moduleId: AssemblyPrefabModuleId): void {
        if (moduleNode.getChildByName(`${moduleId}_KenneyAsset`)) return;
        const prefab = this.assemblyPrefabs[ASSEMBLY_SERIALIZED_PREFAB_MODULES.indexOf(moduleId)] ?? null;
        if (!prefab) {
            Log.warn('presentation', `[AUT-039] Missing serialized prefab for ${moduleId}.`);
            return;
        }
        const imported = instantiate(prefab);
        imported.name = `${moduleId}_KenneyAsset`;
        imported.parent = moduleNode;
        imported.setPosition(0, 0, 0);
    }
}
