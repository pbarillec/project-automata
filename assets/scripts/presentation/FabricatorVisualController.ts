import { Log } from '../logging/Log.ts';
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

    /*
     * AUT-038 production-line composition (AUT-VIS correction).
     *
     * Measured AUT-032 asset facts (GLB POSITION bounds, unit scale):
     * - every module pivot is bottom-centre (min y = 0), so a module rests on
     *   a surface when its node y equals that surface height;
     * - machine.glb is a 1.2 x 1.3 x 1.5 gantry whose tunnel (1.0 wide,
     *   ~1.0 high, open floor) runs along local X; its local -X mouth is the
     *   input and +X mouth the output;
     * - conveyor.glb is 1.0 x 0.4 x 1.0 with its rollers at local +/-X, so
     *   belt travel is local X (length scales X, width scales Z);
     * - hopper-square.glb is 1.12 x 1.0 x 1.12 with a 0.5 outlet at y = 0;
     * - machine-bed.glb is a 90-degree corner gantry (machine.glb section):
     *   inlet mouth centred (-0.6, 0) opening to local -X, outlet mouth
     *   centred (1.0, 1.6) opening to local +Z, inlet-section roof at 1.25;
     * - pipe-large.glb is a 1.0-long pipe lying along local X;
     * - robot-arm-a.glb stands 3.2 tall (child nodes stacked by translation)
     *   on a 1.0-wide base disc.
     *
     * All production-line modules share rotation Y = 90 so the tunnel, input
     * belt and output tray sit on one axis (world +Z = upstream). Belts are
     * 0.9 wide inside the 1.05 tunnel and their 0.5 belt top is shared by the
     * hopper outlet and the product block.
     *
     * AUT-VIS-002 (Lv25+): the default portrait view looks from world +X/-Z
     * with the zone near the right screen edge, so the milestone expansion
     * grows on the free +X side and stays on screen. Every Lv25+ module stays
     * below the primary press, which remains the dominant silhouette.
     */
    private scaleFor(moduleName: string): Vec3 {
        const scales: Record<string, Vec3> = {
            base_compact_press: new Vec3(1.05, 1.05, 1.05),
            simple_output_tray: new Vec3(0.9, 0.9, 0.9),
            secondary_module: new Vec3(0.5, 0.5, 0.5),
            strong_status_indicator: new Vec3(0.28, 0.28, 0.28),

            // The feeder stays subordinate to the press (0.9 tall vs 1.37)
            // while its open mouth still reads from the default pitch.
            auto_feeder_hopper: new Vec3(0.9, 0.9, 0.9),
            // Length 1.8 along travel (X); same 0.9 width/height as the tray.
            input_conveyor: new Vec3(1.8, 0.9, 0.9),
            autonomous_cycle_indicator: new Vec3(0.2, 0.2, 0.2),

            // AUT-VIS-002 Lv25+ (see positionFor for the layout).
            output_conveyor: new Vec3(1.4, 0.9, 0.66),
            storage_buffer: new Vec3(0.8, 0.8, 0.8),
            logistics_connection: new Vec3(0.6, 0.6, 0.6),
            dual_fabrication_module: new Vec3(0.8, 0.8, 0.8),
            shared_industrial_base: new Vec3(0.64, 0.64, 0.64),
            integrated_feeder: new Vec3(0.45, 0.45, 0.45),
            automated_input_output: new Vec3(0.93, 0.9, 0.76),
            small_robotic_arm: new Vec3(0.4, 0.4, 0.4),
            advanced_indicators: new Vec3(0.3, 0.3, 0.3),
        };

        return scales[moduleName] ?? new Vec3(1, 1, 1);
    }

    private rotationFor(moduleName: string): Vec3 {
        const rotations: Record<string, Vec3> = {
            // Tunnel axis, belt travel and tray travel all along world Z.
            base_compact_press: new Vec3(0, 90, 0),
            simple_output_tray: new Vec3(0, 90, 0),
            secondary_module: new Vec3(0, 90, 0),
            auto_feeder_hopper: new Vec3(0, 90, 0),
            input_conveyor: new Vec3(0, 90, 0),
            // Screen panels face world +X, toward the default camera side.
            strong_status_indicator: new Vec3(0, -90, 0),
            autonomous_cycle_indicator: new Vec3(0, -90, 0),

            // AUT-VIS-002: output belt, storage and pipe run along world +X
            // (toward Assembly).
            output_conveyor: new Vec3(0, 0, 0),
            storage_buffer: new Vec3(0, 0, 0),
            logistics_connection: new Vec3(0, 0, 0),
            // Twin tunnel parallel to the primary one; the corner gantry
            // (Y 180) turns a +X-side infeed into the twin's upstream mouth.
            dual_fabrication_module: new Vec3(0, 90, 0),
            shared_industrial_base: new Vec3(0, 180, 0),
            integrated_feeder: new Vec3(0, 0, 0),
            automated_input_output: new Vec3(0, 90, 0),
            small_robotic_arm: new Vec3(0, 0, 0),
            advanced_indicators: new Vec3(0, -90, 0),
        };

        return rotations[moduleName] ?? new Vec3(0, 0, 0);
    }

    private positionFor(moduleName: string): Vec3 {
        const positions: Record<string, Vec3> = {
            // Floor = foundation top (0.14). Machine tunnel spans z -0.93..0.33.
            base_compact_press: new Vec3(0, 0.14, -0.3),
            // Output tray z -1.6..-0.7: starts 0.23 inside the output mouth.
            simple_output_tray: new Vec3(0, 0.14, -1.15),
            // Product block resting on the tray top, just outside the mouth.
            secondary_module: new Vec3(0, 0.5, -1.28),
            // On the press roof (roof top 1.40), output half.
            strong_status_indicator: new Vec3(0.25, 1.4, -0.57),

            // Hopper outlet resting on the upstream end of the input belt.
            auto_feeder_hopper: new Vec3(0, 0.5, 1.38),
            // Input belt z 0.1..1.9: ends 0.23 inside the input mouth.
            input_conveyor: new Vec3(0, 0.14, 1.0),
            // On the press roof, input half (next to the feeder).
            autonomous_cycle_indicator: new Vec3(0.25, 1.4, -0.03),

            // AUT-VIS-002 Lv25 logistics, on the free +X (camera) side.
            // Output belt x 0.45..1.85 leaves the tray side over the tray
            // part outside the press (z -1.6..-0.94).
            output_conveyor: new Vec3(1.15, 0.14, -1.27),
            // Storage bin x 1.85..2.73 on the floor at the belt end.
            storage_buffer: new Vec3(2.29, 0.14, -1.27),
            // Connection-ready pipe stub x 2.73..3.33 pointing at Assembly.
            logistics_connection: new Vec3(3.03, 0.14, -1.27),

            // AUT-VIS-002 Lv50 dual module beside the primary press, scaled
            // 0.8: x 0.80..2.00, tunnel z -0.16..0.80.
            dual_fabrication_module: new Vec3(1.4, 0.14, 0.32),
            // Corner gantry (machine-bed, 0.64): outlet mouth on the twin's
            // input mouth at (1.4, 0.8); inlet faces +X at x 2.42.
            shared_industrial_base: new Vec3(2.04, 0.14, 1.824),

            // AUT-VIS-002 Lv100. Feeder seated on the gantry inlet roof.
            integrated_feeder: new Vec3(2.04, 0.94, 1.824),
            // Transfer belt z -0.94..-0.01: 0.15 inside the twin output mouth,
            // ending on the shared output belt.
            automated_input_output: new Vec3(1.4, 0.14, -0.475),
            // Arm beside the twin and the storage bin.
            small_robotic_arm: new Vec3(2.2, 0.14, -0.42),
            // Panel on the twin roof, facing the camera side.
            advanced_indicators: new Vec3(1.55, 1.1, 0.32),
        };

        return positions[moduleName] ?? new Vec3();
    }

    private instantiateSerializedAsset(moduleNode: Node, moduleName: string): void {
        const prefabIndex = SERIALIZED_PREFAB_MODULES.indexOf(moduleName as typeof SERIALIZED_PREFAB_MODULES[number]);
        const prefab = prefabIndex >= 0 ? this.factoryPrefabs[prefabIndex] : null;
        if (!prefab) {
            Log.warn('presentation', `[AUT-038] Missing serialized prefab for ${moduleName}.`);
            return;
        }

        const imported = instantiate(prefab);
        imported.name = `${moduleName}_KenneyAsset`;
        imported.parent = moduleNode;
        imported.setPosition(0, 0, 0);
    }
}
