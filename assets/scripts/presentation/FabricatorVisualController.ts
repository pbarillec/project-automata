import { _decorator, assetManager, Component, instantiate, Layers, Material, MeshRenderer, Node, primitives, utils, Vec3, Color } from 'cc';
import type { GameState } from '../state/GameState.ts';
import { FabricatorDebugState, VisualStateDescriptor, VisualStateResolver } from './VisualStateResolver.ts';

const { ccclass } = _decorator;

const MODULE_NAMES = [
    'base_compact_press', 'simple_output_tray', 'secondary_module', 'strong_status_indicator',
    'auto_feeder_hopper', 'input_conveyor', 'autonomous_cycle_indicator', 'output_conveyor',
    'storage_buffer', 'logistics_connection', 'dual_fabrication_module', 'shared_industrial_base',
    'integrated_feeder', 'automated_input_output', 'small_robotic_arm', 'advanced_indicators',
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
    private readonly resolver = new VisualStateResolver();
    private moduleNodes = new Map<string, Node>();

    public start(): void {
        this.ensureModuleNodes();
        this.applyDescriptor({
            producerId: 'fabricator', constructed: false, level: 0, milestoneTier: 0,
            automationActive: false, eraId: null, technologyVariant: 'manual_workshop',
            activityTier: 'unconstructed', modules: [],
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

    private ensureModuleNodes(): void {
        for (const moduleName of MODULE_NAMES) {
            if (this.moduleNodes.has(moduleName)) continue;
            const node = new Node(moduleName);
            node.parent = this.node;
            node.setPosition(this.positionFor(moduleName));
            this.addPlaceholderMesh(node, moduleName);
            this.loadApprovedAsset(node, moduleName);
            this.moduleNodes.set(moduleName, node);
        }
    }

    private applyDescriptor(descriptor: VisualStateDescriptor): void {
        this.ensureModuleNodes();
        const visible = new Set(descriptor.modules);
        for (const [name, node] of this.moduleNodes) node.active = visible.has(name);
    }

    private positionFor(moduleName: string): Vec3 {
        const positions: Record<string, Vec3> = {
            base_compact_press: new Vec3(0, 0.65, 0), simple_output_tray: new Vec3(0, 0.18, 0.85),
            secondary_module: new Vec3(0.9, 0.5, 0), strong_status_indicator: new Vec3(0, 1.3, 0),
            auto_feeder_hopper: new Vec3(-0.8, 1.05, 0), input_conveyor: new Vec3(-1.35, 0.2, 0),
            output_conveyor: new Vec3(1.35, 0.2, 0.85), storage_buffer: new Vec3(1.1, 0.55, -0.65),
            dual_fabrication_module: new Vec3(-0.85, 0.65, 0), shared_industrial_base: new Vec3(0, 0.12, 0),
            integrated_feeder: new Vec3(-0.85, 1.15, 0), automated_input_output: new Vec3(0, 0.2, 1.2),
            small_robotic_arm: new Vec3(0.8, 1.1, 0.25), advanced_indicators: new Vec3(0, 1.45, 0),
        };
        return positions[moduleName] ?? new Vec3();
    }

    private addPlaceholderMesh(node: Node, moduleName: string): void {
        const renderer = node.addComponent(MeshRenderer);
        const geometry = primitives.box({ width: moduleName.includes('conveyor') ? 1.2 : 0.7, height: 0.35, length: 0.7 });
        const meshFactory = utils as unknown as { MeshUtils?: { createMesh(geometry: unknown): unknown }; createMesh?: (geometry: unknown) => unknown };
        renderer.mesh = (meshFactory.MeshUtils?.createMesh(geometry) ?? meshFactory.createMesh?.(geometry)) as any;
        const material = new Material();
        material.initialize({ effectName: 'builtin-unlit', defines: { USE_COLOR: true } });
        material.setProperty('mainColor', moduleName.includes('indicator') ? new Color(61, 190, 205, 255) : new Color(101, 108, 110, 255));
        renderer.setMaterial(material, 0);
        node.layer = Layers.Enum.DEFAULT;
    }

    private loadApprovedAsset(moduleNode: Node, moduleName: string): void {
        const uuid = FABRICATOR_ASSET_REFERENCES[moduleName];
        if (!uuid) return;
        (assetManager as unknown as { loadAny: (request: unknown, callback: (error: Error | null, asset: unknown) => void) => void }).loadAny(
            { uuid },
            (error, asset) => {
                if (error || !asset || !moduleNode.isValid) return;
                const imported = instantiate(asset as any);
                imported.name = `${moduleName}_KenneyAsset`;
                imported.parent = moduleNode;
                imported.setPosition(0, 0, 0);
            },
        );
    }
}
