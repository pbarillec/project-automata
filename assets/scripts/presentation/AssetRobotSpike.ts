import {
    _decorator,
    Animation,
    Camera,
    Canvas,
    Color,
    Component,
    DirectionalLight,
    Label,
    Layers,
    Node,
    Prefab,
    UITransform,
    Vec3,
    instantiate,
} from 'cc';

const { ccclass, property } = _decorator;

const REQUIRED_ANIMATIONS = [
    'Robot_Idle',
    'Robot_Walking',
    'Robot_Running',
    'Robot_ThumbsUp',
] as const;

/**
 * AUT-032 only: presents imported assets and cycles robot clips for inspection.
 * It deliberately owns no gameplay, economy, persistence, or progression state.
 */
@ccclass('AssetRobotSpike')
export class AssetRobotSpike extends Component {
    @property(Prefab)
    public robotPrefab: Prefab | null = null;

    @property([Prefab])
    public factoryPrefabs: Prefab[] = [];

    @property(Camera)
    public cameraComponent: Camera | null = null;

    private readonly animationOrder = [...REQUIRED_ANIMATIONS];
    private robotAnimations: Animation[] = [];
    private animationIndex = 0;
    private animationElapsed = 0;
    private statusLabel: Label | null = null;
    public start(): void {
        const camera = this.cameraComponent ?? this.createCamera();
        this.createLighting();
        this.createFactoryComposition();
        this.createInspectionUi();
        this.cameraComponent = camera;

        if (!this.robotPrefab) {
            console.error('[AUT-032] Robot prefab is not assigned.');
            return;
        }

        const robot = instantiate(this.robotPrefab);
        robot.name = 'AUT-032 Robot';
        robot.setPosition(0, 0, 0);
        robot.setScale(1.25, 1.25, 1.25);
        robot.active = false;
        robot.parent = this.node;
        robot.active = true;
        this.robotAnimations = robot.getComponentsInChildren(Animation);
        this.playRequiredAnimation();

        const available = this.collectAnimationNames();
        console.info(`[AUT-032] Robot clips available: ${available.join(', ')}`);
        this.updateStatus(available);
    }

    public update(deltaTime: number): void {
        if (this.robotAnimations.length === 0) {
            return;
        }

        this.animationElapsed += deltaTime;
        if (this.animationElapsed >= 3) {
            this.animationElapsed = 0;
            this.animationIndex = (this.animationIndex + 1) % this.animationOrder.length;
            this.playRequiredAnimation();
        }
    }

    private createCamera(): Camera {
        const cameraNode = new Node('AUT-032 Camera');
        cameraNode.parent = this.node;
        cameraNode.layer = Layers.Enum.DEFAULT;
        cameraNode.setPosition(11, 9, 13);
        cameraNode.lookAt(new Vec3(0, 1, 0));
        const camera = cameraNode.addComponent(Camera);
        camera.projection = Camera.ProjectionType.PERSPECTIVE;
        camera.fov = 45;
        camera.near = 0.1;
        camera.far = 100;
        camera.visibility = Layers.Enum.ALL;
        return camera;
    }

    private createLighting(): void {
        const lightNode = new Node('AUT-032 Key Light');
        lightNode.parent = this.node;
        lightNode.setRotationFromEuler(-55, -35, 0);
        lightNode.addComponent(DirectionalLight).illuminance = 45000;
    }

    private createFactoryComposition(): void {
        const positions = [
            new Vec3(-4.5, 0, -2.5), new Vec3(-2.5, 0, -2.5), new Vec3(0, 0, -2.5),
            new Vec3(2.5, 0, -2.5), new Vec3(4.5, 0, -2.5), new Vec3(-4.5, 0, 2.2),
            new Vec3(-2.5, 0, 2.2), new Vec3(2.5, 0, 2.2), new Vec3(4.5, 0, 2.2),
            new Vec3(-1, 0, 4.5), new Vec3(1.5, 0, 4.5), new Vec3(4, 0, 4.5),
        ];

        this.factoryPrefabs.slice(0, positions.length).forEach((prefab, index) => {
            const piece = instantiate(prefab);
            piece.name = `AUT-032 Factory Piece ${index + 1}`;
            piece.setPosition(positions[index]);
            piece.setScale(1.5, 1.5, 1.5);
            piece.active = false;
            piece.parent = this.node;
            piece.active = true;
        });
    }

    private createInspectionUi(): void {
        const canvasNode = new Node('AUT-032 Inspection UI');
        canvasNode.layer = Layers.Enum.UI_2D;
        canvasNode.parent = this.node;
        canvasNode.addComponent(Canvas);
        const transform = canvasNode.addComponent(UITransform);
        transform.setContentSize(720, 1280);

        const labelNode = new Node('AUT-032 Status');
        labelNode.layer = Layers.Enum.UI_2D;
        labelNode.parent = canvasNode;
        labelNode.setPosition(0, 555, 0);
        const labelTransform = labelNode.addComponent(UITransform);
        labelTransform.setContentSize(680, 90);
        this.statusLabel = labelNode.addComponent(Label);
        this.statusLabel.fontSize = 24;
        this.statusLabel.lineHeight = 32;
        this.statusLabel.color = new Color(238, 241, 233, 255);
        this.statusLabel.string = 'AUT-032  |  Loading robot clips…';
    }

    private playRequiredAnimation(): void {
        const clipName = this.animationOrder[this.animationIndex];
        this.robotAnimations.forEach((animation) => {
            if (animation.clips.some((clip) => clip?.name === clipName)) {
                animation.play(clipName);
            }
        });
        this.statusLabel && (this.statusLabel.string = `AUT-032  |  ${clipName}  |  auto-cycle 3s`);
    }

    private collectAnimationNames(): string[] {
        const names = new Set<string>();
        this.robotAnimations.forEach((animation) => animation.clips.forEach((clip) => clip && names.add(clip.name)));
        return [...names].sort();
    }

    private updateStatus(available: string[]): void {
        const missing = this.animationOrder.filter((name) => !available.includes(name));
        if (missing.length > 0 && this.statusLabel) {
            this.statusLabel.string = `AUT-032  |  Missing: ${missing.join(', ')}`;
        }
    }
}
