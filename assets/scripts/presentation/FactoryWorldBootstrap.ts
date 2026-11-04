import {
    _decorator,
    Camera,
    Canvas,
    Component,
    DirectionalLight,
    Layers,
    Material,
    Mesh,
    MeshRenderer,
    Node,
    Prefab,
    primitives,
    utils,
    Vec3,
    Color,
    UITransform,
} from 'cc';
import { MobileCameraController } from '../camera/MobileCameraController';
import { PresentationController } from './PresentationController';
import { FabricatorVisualController } from './FabricatorVisualController';
import { ProducerSelectionController } from './ProducerSelectionController';
import { CoreHudController } from './CoreHudController';
import { ProducerPanelController } from './ProducerPanelController';
import { FirstAutomationPresentationController } from './FirstAutomationPresentationController';

const { ccclass, property } = _decorator;

export const FACTORY_ZONE_IDS = [
    'Fabricator',
    'AssemblyStation',
    'RobotLine',
    'AutomatedCell',
    'AdvancedRoboticsComplex',
] as const;

type FactoryZoneId = typeof FACTORY_ZONE_IDS[number];

const ZONE_LAYOUT: Record<FactoryZoneId, { x: number; z: number; width: number; depth: number }> = {
    Fabricator: { x: -6, z: -3, width: 5, depth: 4 },
    AssemblyStation: { x: -2, z: -1.8, width: 4, depth: 3.5 },
    RobotLine: { x: 3.5, z: -1.2, width: 6, depth: 3.5 },
    AutomatedCell: { x: 6.2, z: 3.2, width: 4.5, depth: 4 },
    AdvancedRoboticsComplex: { x: 2, z: 6, width: 6, depth: 5.5 },
};

/** Builds the single persistent world shell; producer state belongs to later tasks. */
@ccclass('FactoryWorldBootstrap')
export class FactoryWorldBootstrap extends Component {
    /** AUT-032 prefab references owned by the scene's stable bootstrap component. */
    @property([Prefab])
    public factoryPrefabs: Prefab[] = [];

    public start(): void {
        const site = this.node.getChildByName('FactorySite') ?? new Node('FactorySite');
        site.parent = this.node;
        if (!site.getChildByName('SiteBoundary')) this.createShell(site);
        this.createZones(site);
        this.createCameraRig(site);
        this.connectFirstAutomationPresentation(site);
        if (!site.getChildByName('NeutralFactoryKeyLight')) this.createLighting(site);
        this.createPresentationRegistry(site);
        const selection = this.createProducerSelection(site);
        this.createCoreHud();
        const panel = this.createProducerPanel();
        selection.onSelectionChanged = (producerId) => panel.replaceSelection(producerId);
    }

    private createShell(parent: Node): void {
        this.createBox(parent, 'SiteBoundary', new Vec3(20, 0.2, 16), new Vec3(0, -0.1, 1), new Color(76, 82, 87, 255));
        this.createBox(parent, 'OpeningWorkshopFoundation', new Vec3(6, 0.18, 4.8), new Vec3(-5.2, 0.05, -2.7), new Color(120, 125, 126, 255));
        this.createBox(parent, 'MainLogisticsSpine', new Vec3(13, 0.12, 0.7), new Vec3(0.2, 0.18, -0.3), new Color(92, 101, 104, 255));
        this.createBox(parent, 'FutureAccessBarrier', new Vec3(0.18, 1.2, 11), new Vec3(8.8, 0.6, 3), new Color(52, 59, 62, 255));
    }

    private createZones(parent: Node): void {
        for (const zoneId of FACTORY_ZONE_IDS) {
            const layout = ZONE_LAYOUT[zoneId];
            const zone = parent.getChildByName(`Zone_${zoneId}`) ?? new Node(`Zone_${zoneId}`);
            zone.parent = parent;
            zone.setPosition(layout.x, 0, layout.z);

            const compositionAnchorName = zoneId === 'Fabricator'
                ? 'Fabricator_CompositionAnchor'
                : `${zoneId}_CompositionAnchor`;
            const composition = zone.getChildByName(compositionAnchorName) ?? new Node(compositionAnchorName);
            composition.parent = zone;
            if (zoneId === 'Fabricator') {
                const fabricatorVisual = composition.getComponent(FabricatorVisualController)
                    ?? composition.addComponent(FabricatorVisualController);
                fabricatorVisual.factoryPrefabs = this.factoryPrefabs;
                composition.getComponent(FirstAutomationPresentationController) ?? composition.addComponent(FirstAutomationPresentationController);
            }
            const focus = zone.getChildByName(`${zoneId}_FocusAnchor`) ?? new Node(`${zoneId}_FocusAnchor`);
            focus.parent = zone;
            focus.setPosition(
                zoneId === 'Fabricator' ? -0.35 : 0,
                0.2,
                zoneId === 'Fabricator' ? -0.1 : 0,
            );
            const target = zone.getChildByName(`${zoneId}_SelectableTarget`) ?? new Node(`${zoneId}_SelectableTarget`);
            target.parent = zone;
            target.setPosition(0, 0.2, 0);
            target.setScale(layout.width, 1, layout.depth);

            const isOpening = zoneId === 'Fabricator';
            if (zone.getChildByName('WorkshopFoundation') || zone.getChildByName(`${zoneId}_FutureFoundation`)) continue;
            this.createBox(
                zone,
                isOpening ? 'WorkshopFoundation' : `${zoneId}_FutureFoundation`,
                new Vec3(layout.width, 0.12, layout.depth),
                new Vec3(0, 0.06, 0),
                isOpening ? new Color(136, 140, 137, 255) : new Color(59, 67, 70, 255),
            );

            if (!isOpening) {
                this.createBox(zone, `${zoneId}_InactiveShell`, new Vec3(layout.width * 0.48, 0.8, layout.depth * 0.42), new Vec3(0, 0.46, 0), new Color(43, 49, 52, 255));
                this.createBox(zone, `${zoneId}_DisconnectedLogistics`, new Vec3(layout.width * 0.72, 0.08, 0.3), new Vec3(0, 0.18, layout.depth * 0.32), new Color(74, 85, 88, 255));
            }
        }
    }

    private createCameraRig(parent: Node): void {
        const rig = parent.getChildByName('CameraRig') ?? new Node('CameraRig');
        rig.parent = parent;
        const cameraNode = rig.getChildByName('WorldCamera') ?? new Node('WorldCamera');
        cameraNode.parent = rig;
        const camera = cameraNode.getComponent(Camera) ?? cameraNode.addComponent(Camera);
        camera.projection = Camera.ProjectionType.PERSPECTIVE;
        camera.fov = 45;
        camera.near = 0.1;
        camera.far = 200;
        camera.visibility = Layers.Enum.ALL;

        const controller = rig.getComponent(MobileCameraController) ?? rig.addComponent(MobileCameraController);
        controller.cameraComponent = camera;
        controller.focusMinX = -9;
        controller.focusMaxX = 9;
        controller.focusMinZ = -6;
        controller.focusMaxZ = 8;
        controller.defaultYawDeg = 135;
        controller.defaultPitchDeg = 48;
        controller.defaultDistance = 12.5;
        controller.defaultFocusX = -3.8;
        controller.defaultFocusZ = -1.8;
        controller.focusDistance = 16.5;
        controller.applyConfiguredInitialView();
    }

    private createLighting(parent: Node): void {
        const lightNode = new Node('NeutralFactoryKeyLight');
        lightNode.parent = parent;
        lightNode.setRotationFromEuler(-55, -35, 0);
        const light = lightNode.addComponent(DirectionalLight);
        light.illuminance = 45000;
    }

    private createPresentationRegistry(parent: Node): void {
        const registry = parent.getChildByName('PresentationAnchors') ?? new Node('PresentationAnchors');
        registry.parent = parent;
        const controller = registry.getComponent(PresentationController) ?? registry.addComponent(PresentationController);
        controller.firstAutomationPresentation = parent.getChildByName('Zone_Fabricator')
            ?.getChildByName('Fabricator_CompositionAnchor')
            ?.getComponent(FirstAutomationPresentationController) ?? null;
        controller.focusAnchors = FACTORY_ZONE_IDS.map((id) => parent.getChildByName(`Zone_${id}`)?.getChildByName(`${id}_FocusAnchor`)).filter((node): node is Node => node !== null && node !== undefined);
        controller.compositionAnchors = FACTORY_ZONE_IDS.map((id) => parent.getChildByName(`Zone_${id}`)?.getChildByName(`${id}_CompositionAnchor`)).filter((node): node is Node => node !== null && node !== undefined);
    }

    private connectFirstAutomationPresentation(parent: Node): void {
        const zone = parent.getChildByName('Zone_Fabricator');
        const composition = zone?.getChildByName('Fabricator_CompositionAnchor');
        const presentation = composition?.getComponent(FirstAutomationPresentationController);
        if (!composition || !presentation) return;
        presentation.fabricatorVisual = composition.getComponent(FabricatorVisualController);
        presentation.cameraController = parent.getChildByName('CameraRig')?.getComponent(MobileCameraController) ?? null;
        presentation.focusAnchor = zone?.getChildByName('Fabricator_FocusAnchor') ?? null;
    }

    private createProducerSelection(parent: Node): ProducerSelectionController {
        const registry = parent.getChildByName('ProducerSelection') ?? new Node('ProducerSelection');
        registry.parent = parent;
        const controller = registry.getComponent(ProducerSelectionController) ?? registry.addComponent(ProducerSelectionController);
        const rig = parent.getChildByName('CameraRig');
        controller.cameraComponent = rig?.getChildByName('WorldCamera')?.getComponent(Camera) ?? null;
        controller.cameraController = rig?.getComponent(MobileCameraController) ?? null;
        controller.selectableTargets = FACTORY_ZONE_IDS.map((id) => parent.getChildByName(`Zone_${id}`)?.getChildByName(`${id}_SelectableTarget`)).filter((node): node is Node => node !== null && node !== undefined);
        controller.uiBlockerNodes = controller.cameraController?.uiBlockerNodes ?? [];
        controller.dragThresholdPixels = controller.cameraController?.dragThresholdPixels ?? controller.dragThresholdPixels;
        return controller;
    }

    private createCoreHud(): void {
        const canvas = this.node.getChildByName('CoreHudCanvas') ?? new Node('CoreHudCanvas');
        canvas.parent = this.node;
        canvas.layer = Layers.Enum.UI_2D;
        canvas.getComponent(Canvas) ?? canvas.addComponent(Canvas);
        const canvasTransform = canvas.getComponent(UITransform) ?? canvas.addComponent(UITransform);
        canvasTransform.setContentSize(720, 1280);

        const hud = canvas.getChildByName('CoreHUD') ?? new Node('CoreHUD');
        hud.parent = canvas;
        hud.layer = Layers.Enum.UI_2D;
        hud.setPosition(28, 560, 0);
        hud.getComponent(CoreHudController) ?? hud.addComponent(CoreHudController);
    }

    private createProducerPanel(): ProducerPanelController {
        const canvas = this.node.getChildByName('CoreHudCanvas') ?? new Node('CoreHudCanvas');
        canvas.parent = this.node;
        canvas.layer = Layers.Enum.UI_2D;
        canvas.getComponent(Canvas) ?? canvas.addComponent(Canvas);
        canvas.getComponent(UITransform) ?? canvas.addComponent(UITransform);
        const panel = canvas.getChildByName('ProducerPanel') ?? new Node('ProducerPanel');
        panel.parent = canvas;
        panel.layer = Layers.Enum.UI_2D;
        panel.setPosition(28, 150, 0);
        return panel.getComponent(ProducerPanelController) ?? panel.addComponent(ProducerPanelController);
    }

    private createBox(parent: Node, name: string, size: Vec3, position: Vec3, color: Color): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.DEFAULT;
        node.parent = parent;
        node.setPosition(position);
        const renderer = node.addComponent(MeshRenderer);
        const primitive = primitives.box({ width: size.x, height: size.y, length: size.z });
        const meshFactory = utils as unknown as { MeshUtils?: { createMesh(geometry: unknown): Mesh }; createMesh?: (geometry: unknown) => Mesh };
        const mesh = meshFactory.MeshUtils?.createMesh(primitive) ?? meshFactory.createMesh?.(primitive);
        if (!mesh) throw new Error('Cocos mesh creation utility is unavailable for FactoryWorld shell.');
        renderer.mesh = mesh;
        const material = new Material();
        material.initialize({ effectName: 'builtin-unlit', defines: { USE_COLOR: true } });
        material.setProperty('mainColor', color);
        renderer.setMaterial(material, 0);
        return node;
    }
}
