import {
    _decorator,
    Camera,
    Component,
    DirectionalLight,
    Layers,
    Material,
    Mesh,
    MeshRenderer,
    Node,
    primitives,
    utils,
    Vec3,
    Color,
} from 'cc';
import { MobileCameraController } from '../camera/MobileCameraController';
import { PresentationController } from './PresentationController';

const { ccclass } = _decorator;

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
    public start(): void {
        const site = this.node.getChildByName('FactorySite') ?? new Node('FactorySite');
        site.parent = this.node;
        if (!site.getChildByName('SiteBoundary')) this.createShell(site);
        this.createZones(site);
        this.createCameraRig(site);
        if (!site.getChildByName('NeutralFactoryKeyLight')) this.createLighting(site);
        this.createPresentationRegistry(site);
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

            const composition = zone.getChildByName(`${zoneId}_CompositionAnchor`) ?? new Node(`${zoneId}_CompositionAnchor`);
            composition.parent = zone;
            const focus = zone.getChildByName(`${zoneId}_FocusAnchor`) ?? new Node(`${zoneId}_FocusAnchor`);
            focus.parent = zone;
            focus.setPosition(0, 0.2, 0);

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
        controller.defaultDistance = 15;
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
        controller.focusAnchors = FACTORY_ZONE_IDS.map((id) => parent.getChildByName(`Zone_${id}`)?.getChildByName(`${id}_FocusAnchor`)).filter((node): node is Node => node !== null && node !== undefined);
        controller.compositionAnchors = FACTORY_ZONE_IDS.map((id) => parent.getChildByName(`Zone_${id}`)?.getChildByName(`${id}_CompositionAnchor`)).filter((node): node is Node => node !== null && node !== undefined);
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
