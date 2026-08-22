import {
    _decorator,
    Camera,
    Canvas,
    Color,
    Component,
    DirectionalLight,
    Label,
    Layers,
    Material,
    Mesh,
    MeshRenderer,
    Node,
    primitives,
    Sprite,
    UITransform,
    utils,
    Vec3,
} from 'cc';
import { MobileCameraController } from '../camera/MobileCameraController';

const { ccclass, property } = _decorator;

@ccclass('CameraSpikeBootstrap')
export class CameraSpikeBootstrap extends Component {
    @property(Camera)
    public cameraComponent: Camera | null = null;

    private controller: MobileCameraController | null = null;
    private readonly robotLineFocus = new Vec3(4.5, 0, 2.5);

    public start(): void {
        const camera = this.cameraComponent ?? this.createCamera();
        this.cameraComponent = camera;
        this.createLighting();
        this.createPlaceholderFactory();
        const uiBlockers = this.createPlaceholderUi();

        this.controller = this.node.getComponent(MobileCameraController)
            ?? this.node.addComponent(MobileCameraController);
        this.controller.cameraComponent = camera;
        this.controller.uiBlockerNodes = uiBlockers;
        this.controller.focusMinX = -9;
        this.controller.focusMaxX = 9;
        this.controller.focusMinZ = -6;
        this.controller.focusMaxZ = 8;
        this.controller.defaultYawDeg = 135;
        this.controller.defaultPitchDeg = 48;
        this.controller.defaultDistance = 15;
        this.controller.snapToWorldTarget(new Vec3(0, 0, 0));
    }

    private createCamera(): Camera {
        const cameraNode = new Node('Camera');
        cameraNode.layer = Layers.Enum.DEFAULT;
        cameraNode.parent = this.node;
        const camera = cameraNode.addComponent(Camera);
        camera.fov = 45;
        camera.near = 0.1;
        camera.far = 200;
        return camera;
    }

    private createLighting(): void {
        const lightNode = new Node('Key Light');
        lightNode.parent = this.node;
        lightNode.setRotationFromEuler(-55, -35, 0);
        const light = lightNode.addComponent(DirectionalLight);
        light.illuminance = 45000;
    }

    private createPlaceholderFactory(): void {
        const factoryRoot = new Node('Placeholder Factory Diorama');
        factoryRoot.parent = this.node;

        this.createBox(factoryRoot, 'Factory Bounds Floor', new Vec3(18, 0.25, 14), new Vec3(0, -0.15, 1), new Color(83, 90, 96, 255));
        this.createBox(factoryRoot, 'Manual Workshop Slab', new Vec3(5.5, 0.18, 4), new Vec3(-4.5, 0.02, -2.5), new Color(122, 128, 132, 255));
        this.createBox(factoryRoot, 'Automated Factory Slab', new Vec3(7, 0.18, 5), new Vec3(3.5, 0.03, 0.8), new Color(111, 118, 122, 255));
        this.createBox(factoryRoot, 'Robotics Complex Future Pad', new Vec3(4.5, 0.16, 5), new Vec3(4.2, 0.04, 5.6), new Color(70, 82, 90, 255));

        this.createBox(factoryRoot, 'Fabricator Placeholder', new Vec3(1.2, 1.5, 1.2), new Vec3(-5.8, 0.85, -2.8), new Color(210, 132, 51, 255));
        this.createBox(factoryRoot, 'Assembly Station Placeholder', new Vec3(2.2, 0.9, 1.3), new Vec3(-2.4, 0.55, -1.8), new Color(185, 188, 178, 255));
        this.createBox(factoryRoot, 'Robot Line Placeholder', new Vec3(4.3, 0.9, 1.1), new Vec3(this.robotLineFocus.x, 0.55, this.robotLineFocus.z), new Color(65, 170, 190, 255));
        this.createBox(factoryRoot, 'Automated Cell Placeholder', new Vec3(1.8, 1.4, 1.8), new Vec3(6.4, 0.8, 0.1), new Color(128, 156, 165, 255));
        this.createBox(factoryRoot, 'Advanced Robotics Placeholder', new Vec3(2, 3.2, 2), new Vec3(4.2, 1.7, 5.6), new Color(82, 206, 224, 255));

        this.createBox(factoryRoot, 'Focus Target Marker', new Vec3(0.8, 0.12, 0.8), new Vec3(this.robotLineFocus.x, 0.1, this.robotLineFocus.z), new Color(255, 210, 90, 255));
    }

    private createPlaceholderUi(): Node[] {
        const canvasNode = new Node('Camera Spike UI Canvas');
        canvasNode.layer = Layers.Enum.UI_2D;
        canvasNode.parent = this.node;
        canvasNode.addComponent(Canvas);
        const transform = canvasNode.addComponent(UITransform);
        transform.setContentSize(720, 1280);

        const topPanel = this.createUiPanel(canvasNode, 'Camera Spike Status Blocker', new Vec3(0, 555, 0), 680, 120, new Color(31, 36, 40, 205));
        this.createLabel(topPanel, 'One-finger orbit. Pinch zoom. Two-finger pan.', 26, new Color(238, 241, 233, 255));

        const focusButton = this.createUiPanel(canvasNode, 'Focus Demo Button Blocker', new Vec3(0, -540, 0), 420, 92, new Color(56, 128, 150, 230));
        this.createLabel(focusButton, 'FOCUS ROBOT LINE', 28, new Color(255, 255, 255, 255));
        focusButton.on(Node.EventType.TOUCH_END, () => {
            this.controller?.focusOnWorldTarget(this.robotLineFocus);
        });

        return [topPanel, focusButton];
    }

    private createUiPanel(parent: Node, name: string, position: Vec3, width: number, height: number, color: Color): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.parent = parent;
        node.setPosition(position);
        const transform = node.addComponent(UITransform);
        transform.setContentSize(width, height);
        const sprite = node.addComponent(Sprite);
        sprite.color = color;
        return node;
    }

    private createLabel(parent: Node, text: string, fontSize: number, color: Color): void {
        const node = new Node(`${parent.name} Label`);
        node.layer = Layers.Enum.UI_2D;
        node.parent = parent;
        const transform = node.addComponent(UITransform);
        transform.setContentSize(640, 80);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = fontSize + 8;
        label.color = color;
    }

    private createBox(parent: Node, name: string, size: Vec3, position: Vec3, color: Color): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.DEFAULT;
        node.parent = parent;
        node.setPosition(position);
        const renderer = node.addComponent(MeshRenderer);
        const primitive = primitives.box({
            width: size.x,
            height: size.y,
            length: size.z,
        });
        const meshFactory = (utils as unknown as {
            MeshUtils?: { createMesh(geometry: unknown): unknown };
            createMesh?: (geometry: unknown) => unknown;
        });
        const mesh = (
            meshFactory.MeshUtils?.createMesh(primitive)
            ?? meshFactory.createMesh?.(primitive)
        );
        if (!mesh) {
            throw new Error('Cocos mesh creation utility is unavailable for CameraSpike placeholders.');
        }

        renderer.mesh = mesh as Mesh;
        renderer.setMaterial(this.createMaterial(color), 0);
        return node;
    }

    private createMaterial(color: Color): Material {
        const material = new Material();
        material.initialize({
            effectName: 'builtin-standard',
        });
        material.setProperty('mainColor', color);
        return material;
    }
}
