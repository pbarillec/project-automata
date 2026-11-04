import {
    _decorator,
    Component,
    instantiate,
    Node,
    Vec3,
} from 'cc';
import type { Prefab } from 'cc';
import type { GameState } from '../state/GameState.ts';
import {
    FabricatorDebugState,
    VisualStateDescriptor,
    VisualStateResolver,
} from './VisualStateResolver.ts';

const { ccclass } = _decorator;

const MODULE_NAMES = [
    'base_compact_press',
    'simple_output_tray',
    'secondary_module',
    'strong_status_indicator',
    'auto_feeder_hopper',
    'input_conveyor',
    'autonomous_cycle_indicator',
    'output_conveyor',
    'storage_buffer',
    'logistics_connection',
    'dual_fabrication_module',
    'shared_industrial_base',
    'integrated_feeder',
    'automated_input_output',
    'small_robotic_arm',
    'advanced_indicators',
] as const;

const SERIALIZED_PREFAB_MODULES = [
    'base_compact_press',
    'simple_output_tray',
    'secondary_module',
    'strong_status_indicator',
    'auto_feeder_hopper',
    'input_conveyor',
    'autonomous_cycle_indicator',
    'output_conveyor',
    'storage_buffer',
    'logistics_connection',
    'dual_fabrication_module',
    'shared_industrial_base',
    'integrated_feeder',
    'automated_input_output',
    'small_robotic_arm',
    'advanced_indicators',
] as const;

/** AUT-032 imported Kenney Factory Kit prefab sub-assets, selected by visual role. */
export const FABRICATOR_ASSET_REFERENCES: Readonly<Record<string, string>> = {
    base_compact_press: 'a0320000-0000-4000-8000-00000000000a@ce0e9',
    simple_output_tray: 'a0320000-0000-4000-8000-000000000007@a040b',
    secondary_module: 'a0320000-0000-4000-8000-000000000004@2d450',
    auto_feeder_hopper: 'a0320000-0000-4000-8000-000000000008@92950',
    input_conveyor: 'a0320000-0000-4000-8000-000000000007@a040b',
    output_conveyor: 'a0320000-0000-4000-8000-000000000007@a040b',
    storage_buffer: 'a0320000-0000-4000-8000-000000000004@2d450',
    logistics_connection: 'a0320000-0000-4000-8000-00000000000b@8b733',
    dual_fabrication_module: 'a0320000-0000-4000-8000-00000000000a@ce0e9',
    shared_industrial_base: 'a0320000-0000-4000-8000-000000000009@7c2af',
    integrated_feeder: 'a0320000-0000-4000-8000-000000000008@92950',
    automated_input_output: 'a0320000-0000-4000-8000-000000000007@a040b',
    small_robotic_arm: 'a0320000-0000-4000-8000-00000000000c@ace94',
    advanced_indicators: 'a0320000-0000-4000-8000-00000000000e@35a07',
};

/** Presentation-only Fabricator composition. It never writes to GameState. */
@ccclass('FabricatorVisualController')
export class FabricatorVisualController extends Component {
    /** Prefab dependencies are supplied by FactoryWorldBootstrap at runtime. */
    public factoryPrefabs: Prefab[] = [];

    private readonly resolver = new VisualStateResolver();
    private moduleNodes = new Map<string, Node>();
    private moduleVisibility = new Map<string, boolean>();

    public start(): void {
        this.ensureModuleNodes();

        this.applyDescriptor({
            producerId: 'fabricator',
            constructed: false,
            level: 0,
            milestoneTier: 0,
            automationActive: false,
            eraId: null,
            technologyVariant: 'manual_workshop',
            activityTier: 'unconstructed',
            modules: [],
        });
    }

    public syncFromGameState(state: GameState): VisualStateDescriptor {
        const descriptor = this.resolver.resolveFabricator(state);
        this.applyDescriptor(descriptor);
        return descriptor;
    }

    public forceDebugState(debugState: FabricatorDebugState | null): void {
        this.resolver.setDebugState(debugState);
    }

    public clearDebugState(): void {
        this.resolver.clearDebugState();
    }

    public applyCurrentDebugState(state: GameState): VisualStateDescriptor {
        return this.syncFromGameState(state);
    }

    public getModuleNode(moduleName: string): Node | null {
        this.ensureModuleNodes();
        return this.moduleNodes.get(moduleName) ?? null;
    }

    public debugSetVisibleModules(moduleNames: readonly string[]): void {
        this.ensureModuleNodes();

        const visibleModules = new Set(moduleNames);

        for (const moduleName of MODULE_NAMES) {
            this.setModuleVisible(
                moduleName,
                visibleModules.has(moduleName),
            );
        }
    }

    private ensureModuleNodes(): void {
        for (const moduleName of MODULE_NAMES) {
            if (this.moduleNodes.has(moduleName)) continue;

            const node = new Node(moduleName);
            node.parent = this.node;
            node.setPosition(this.positionFor(moduleName));

            /*
             * Keep the complete 3D hierarchy alive. Visibility uses scale so
             * Android Native does not have to deactivate/reactivate imported
             * 3D scene nodes.
             */
            node.active = true;

            this.moduleNodes.set(moduleName, node);
            this.moduleVisibility.set(moduleName, false);

            this.setModuleVisible(moduleName, false);
            this.instantiateSerializedAsset(node, moduleName);
        }
    }

    private applyDescriptor(descriptor: VisualStateDescriptor): void {
        this.ensureModuleNodes();

        const visibleModules = new Set(descriptor.modules);

        for (const moduleName of MODULE_NAMES) {
            this.setModuleVisible(
                moduleName,
                visibleModules.has(moduleName),
            );
        }
    }

    private setModuleVisible(moduleName: string, visible: boolean): void {
        const node = this.moduleNodes.get(moduleName);
        if (!node) return;

        this.moduleVisibility.set(moduleName, visible);

        node.active = true;
        const rotation = this.rotationFor(moduleName);
        node.setRotationFromEuler(rotation.x, rotation.y, rotation.z);
        const scale = this.scaleFor(moduleName);
        node.setScale(
            visible ? scale.x : 0,
            visible ? scale.y : 0,
            visible ? scale.z : 0,
        );
    }

    private scaleFor(moduleName: string): Vec3 {
        const scales: Record<string, Vec3> = {
            // Keep the manual state compact and centered around the press.
            base_compact_press: new Vec3(1.05, 1.05, 1.05),
            simple_output_tray: new Vec3(0.9, 0.9, 0.9),
            secondary_module: new Vec3(0.58, 0.58, 0.58),
            strong_status_indicator: new Vec3(0.28, 0.28, 0.28),

            // Exaggerated separation makes the Auto Feeder silhouette read on
            // a small screen instead of merging into the press.
            auto_feeder_hopper: new Vec3(1.35, 1.3, 1.35),
            input_conveyor: new Vec3(1.0, 1.05, 1.55),
            autonomous_cycle_indicator: new Vec3(0.2, 0.2, 0.2),
        };

        return scales[moduleName] ?? new Vec3(1, 1, 1);
    }

    private rotationFor(moduleName: string): Vec3 {
        const rotations: Record<string, Vec3> = {
            // Aim the incoming belt from the left foreground into the press.
            input_conveyor: new Vec3(0, 71, 0),
            // Cant the hopper outward so its mouth remains visible beside the
            // machine instead of disappearing behind the main asset.
            auto_feeder_hopper: new Vec3(0, -14, 0),
        };

        return rotations[moduleName] ?? new Vec3(0, 0, 0);
    }

    private positionFor(moduleName: string): Vec3 {
        const positions: Record<string, Vec3> = {
            base_compact_press: new Vec3(0, 0.65, 0),
            simple_output_tray: new Vec3(0, 0.18, 0.85),
            secondary_module: new Vec3(0.62, 0.66, 0.02),
            strong_status_indicator: new Vec3(0, 1.25, -0.64),

            auto_feeder_hopper: new Vec3(-2.05, 0.66, -0.75),
            input_conveyor: new Vec3(-1.34, 0.24, -0.5),
            autonomous_cycle_indicator: new Vec3(0.42, 1.58, -0.62),

            output_conveyor: new Vec3(1.35, 0.2, 0.85),
            storage_buffer: new Vec3(1.1, 0.55, -0.65),

            dual_fabrication_module: new Vec3(-0.85, 0.65, 0),
            shared_industrial_base: new Vec3(0, 0.12, 0),

            integrated_feeder: new Vec3(-0.85, 1.15, 0),
            automated_input_output: new Vec3(0, 0.2, 1.2),
            small_robotic_arm: new Vec3(0.8, 1.1, 0.25),
            advanced_indicators: new Vec3(0, 1.45, 0),
        };

        return positions[moduleName] ?? new Vec3();
    }

    private instantiateSerializedAsset(moduleNode: Node, moduleName: string): void {
        const prefabIndex = SERIALIZED_PREFAB_MODULES.indexOf(moduleName as typeof SERIALIZED_PREFAB_MODULES[number]);
        const prefab = prefabIndex >= 0 ? this.factoryPrefabs[prefabIndex] : null;
        if (!prefab) {
            console.warn(`[AUT-038] Missing serialized prefab for ${moduleName}.`);
            return;
        }

        const imported = instantiate(prefab);
        imported.name = `${moduleName}_KenneyAsset`;
        imported.parent = moduleNode;
        imported.setPosition(0, 0, 0);
    }
}
