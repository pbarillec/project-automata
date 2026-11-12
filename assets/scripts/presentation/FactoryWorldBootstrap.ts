import {
    _decorator,
    Camera,
    Canvas,
    Component,
    DirectionalLight,
    game,
    Game,
    Layers,
    Material,
    Mesh,
    MeshRenderer,
    Node,
    profiler,
    Prefab,
    primitives,
    SafeArea,
    screen,
    utils,
    Vec3,
    Color,
    Label,
    UITransform,
    view,
    Widget,
} from 'cc';
import { DEBUG } from 'cc/env';
import { MobileCameraController } from '../camera/MobileCameraController';
import { configureDeviceDiagnostics, emitDeviceEvent, installDeviceErrorHook, isDeviceDiagnosticsEnabled } from './DeviceDiagnostics';
import { PresentationController } from './PresentationController';
import { FabricatorVisualController } from './FabricatorVisualController';
import { ProducerSelectionController } from './ProducerSelectionController';
import { CoreHudController } from './CoreHudController';
import { ProducerPanelController } from './ProducerPanelController';
import { AssemblyBatchActionController } from './AssemblyBatchActionController';
import { FirstAutomationPresentationController } from './FirstAutomationPresentationController';
import { AssemblyVisualController, ASSEMBLY_SLAB_NODE_NAME } from './AssemblyVisualController';
import { ConstructionPresentationController } from './ConstructionPresentationController';
import { RobotPopulationController } from './RobotPopulationController';
import { RobotLineVisualController, ROBOT_LINE_LAMP_OFF_NODE_PREFIX, ROBOT_LINE_LAMP_ON_NODE_PREFIX, ROBOT_LINE_LIP_NODE_NAME, ROBOT_LINE_SLAB_NODE_NAME } from './RobotLineVisualController';
import { AutomatedCellVisualController, AUTOMATED_CELL_GUIDE_OFF_NODE_PREFIX, AUTOMATED_CELL_GUIDE_ON_NODE_PREFIX, AUTOMATED_CELL_LAMP_OFF_NODE_PREFIX, AUTOMATED_CELL_LAMP_ON_NODE_PREFIX, AUTOMATED_CELL_SLAB_NODE_NAME } from './AutomatedCellVisualController';
import { AUTOMATED_CELL_FOUNDATION_SLAB, AUTOMATED_CELL_GUIDE, AUTOMATED_CELL_GUIDE_OFF_COLOR, AUTOMATED_CELL_GUIDE_ON_COLOR, AUTOMATED_CELL_GUIDE_PARTS, AUTOMATED_CELL_LAMP_IDS, AUTOMATED_CELL_LAMPS, AUTOMATED_CELL_REVEAL_TARGET, AUTOMATED_CELL_SPARK_ANCHOR, automatedCellLocal } from './AutomatedCellLayout.ts';
import { AdvancedRoboticsComplexVisualController, ARC_GUIDE_OFF_NODE_PREFIX, ARC_GUIDE_ON_NODE_PREFIX, ARC_LAMP_OFF_NODE_PREFIX, ARC_LAMP_ON_NODE_PREFIX, ARC_SLAB_NODE_NAME } from './AdvancedRoboticsComplexVisualController';
import { ARC_BEAM_GRAPHITE_COLOR, ARC_BEAMS, ARC_FOUNDATION_SLAB, ARC_GUIDE, ARC_GUIDE_OFF_COLOR, ARC_GUIDE_ON_COLOR, ARC_GUIDE_PARTS, ARC_LAMP_IDS, ARC_LAMPS, ARC_REVEAL_TARGET, ARC_SPARK_ANCHOR, arcLocal } from './AdvancedRoboticsComplexLayout.ts';
import { ROBOT_LINE_FOUNDATION_SLAB, ROBOT_LINE_LAMP_IDS, ROBOT_LINE_LAMPS, ROBOT_LINE_OUTPUT_LIP, ROBOT_LINE_REVEAL_TARGET, ROBOT_LINE_SPARK_ANCHOR, robotLineLocal } from './RobotLineLayout.ts';
import { FirstRobotPresentationController, ROBOT_BAY_LAMP_OFF_NODE_NAME, ROBOT_BAY_LAMP_ON_NODE_NAME } from './FirstRobotPresentationController';
import { ASSEMBLY_FOUNDATION_SLAB, assemblyLocal, FIRST_ROBOT_REVEAL_TARGET, ROBOT_BAY_LAMP } from './AssemblySliceLayout.ts';
import { CocosFileSystemPort } from '../app/CocosFileSystemPort';
import { bootstrapGameSession } from '../lifecycle/GameSessionBootstrap.ts';
import { FileSaveStorage } from '../persistence/FileSaveStorage.ts';
import { DefaultTimeService } from '../time/DefaultTimeService.ts';
import { FactoryWorldStateBinding, type FactoryWorldAutomationSink } from './FactoryWorldStateBinding.ts';
import type { GameCommand } from '../domain/Commands.ts';
import type { DomainEvent } from '../domain/Events.ts';
import type { LifecycleCommandResult } from '../lifecycle/LifecycleSessionCoordinator.ts';
import type { DisplayNameSource } from './PresentationText.ts';
import { ASSEMBLY_BATCH_ACTION_KEY, CORE_HUD_LAYOUT, HUD_ACTION_KEYS, PANEL_ACTION_KEYS, PRODUCER_PANEL_LAYOUT, UI_EDGE_MARGIN, widgetAlignment, type UiCardSpec, type UiRect } from './UiLayout.ts';
import { ZONE_LAYOUT } from './FactoryZoneLayout.ts';
import { CAMERA_PAN_BOUNDS_MARGIN, resolveCameraPanBounds } from './CameraPanBounds.ts';

const { ccclass, property } = _decorator;

export const FACTORY_ZONE_IDS = [
    'Fabricator',
    'AssemblyStation',
    'RobotLine',
    'AutomatedCell',
    'AdvancedRoboticsComplex',
] as const;

/** Builds the single persistent world shell; producer state belongs to later tasks. */
@ccclass('FactoryWorldBootstrap')
export class FactoryWorldBootstrap extends Component {
    /** AUT-032 prefab references owned by the scene's stable bootstrap component. */
    @property([Prefab])
    public factoryPrefabs: Prefab[] = [];

    /** AUT-039 Assembly slice prefabs (AUT-032 imports), index-aligned with ASSEMBLY_SERIALIZED_PREFAB_MODULES. */
    @property([Prefab])
    public assemblyPrefabs: Prefab[] = [];

    /** AUT-042 Robot Line prefabs (AUT-032 imports), index-aligned with ROBOT_LINE_PREFAB_SLOTS. */
    @property([Prefab])
    public robotLinePrefabs: Prefab[] = [];

    /** AUT-043 Automated Cell prefabs (AUT-032 imports), index-aligned with AUTOMATED_CELL_PREFAB_SLOTS. */
    @property([Prefab])
    public automatedCellPrefabs: Prefab[] = [];

    /** AUT-044 Advanced Robotics Complex prefabs (AUT-032 imports), index-aligned with ARC_PREFAB_SLOTS. */
    @property([Prefab])
    public advancedRoboticsComplexPrefabs: Prefab[] = [];

    /** AUT-039 first Worker Bot: the AUT-032 Robot.glb prefab. */
    @property(Prefab)
    public robotPrefab: Prefab | null = null;

    /** AUT-INT-001: the persistent session binding; null until the save has loaded (inputs stay inert). */
    private binding: FactoryWorldStateBinding | null = null;
    private pendingBinding: { binding: FactoryWorldStateBinding; status: string; displayNames: DisplayNameSource } | null = null;
    private sessionWiring: { hud: CoreHudController; panel: ProducerPanelController; batch: AssemblyBatchActionController; selection: ProducerSelectionController; presentation: PresentationController | null } | null = null;
    private saveRootPath = '';
    private lifecycleHooksRegistered = false;
    /** AUT-R-036: frames left before the DEBUG `ui_layout` diagnostic (0 = none scheduled). */
    private uiLayoutFrames = 0;
    private uiLayoutReason = '';
    private uiResizeRegistered = false;
    /** AUT-R-031-02: frames left before the DEBUG `camera_state` diagnostic (0 = none scheduled). */
    private cameraStateFrames = 0;

    /** AUT-INFRA-001: structured [AUT-DEVICE] diagnostics exist only in DEBUG builds; release builds never emit. */
    public onLoad(): void {
        // AUT-UI-002: the engine FPS/debug overlay obstructs product and device gates; diagnostics stay on the [AUT-DEVICE] log channel.
        profiler.hideStats();
        configureDeviceDiagnostics({ enabled: DEBUG === true });
        installDeviceErrorHook();
        emitDeviceEvent('scene_ready', { reason: 'bootstrap_loaded', scene: 'FactoryWorld' });
    }

    public start(): void {
        const site = this.node.getChildByName('FactorySite') ?? new Node('FactorySite');
        site.parent = this.node;
        if (!site.getChildByName('SiteBoundary')) this.createShell(site);
        this.createZones(site);
        this.createAssemblySlice(site);
        this.createRobotLineSlice(site);
        this.createAutomatedCellSlice(site);
        this.createAdvancedRoboticsComplexSlice(site);
        this.createCameraRig(site);
        this.connectFirstAutomationPresentation(site);
        this.connectFirstRobotPresentation(site);
        this.connectRobotLinePresentation(site);
        this.connectAutomatedCellPresentation(site);
        this.connectAdvancedRoboticsComplexPresentation(site);
        if (!site.getChildByName('NeutralFactoryKeyLight')) this.createLighting(site);
        this.createPresentationRegistry(site);
        const selection = this.createProducerSelection(site);
        this.createUiRoot(site);
        const hud = this.createCoreHud();
        const panel = this.createProducerPanel();
        // AUT-R-036-02: Manual Produce sits in the bottom band, inside the panel card (before the HUD's first layout).
        hud.primaryActionHost = panel.node;
        const batch = this.createAssemblyBatchAction(panel.node);
        selection.onSelectionChanged = (producerId) => {
            panel.replaceSelection(producerId);
            this.binding?.onSelectionChanged(producerId);
        };
        this.reportUiLayoutAfterSelection(selection);
        const presentation = site.getChildByName('PresentationAnchors')?.getComponent(PresentationController) ?? null;
        this.sessionWiring = { hud, panel, batch, selection, presentation };
        this.startPersistentSession(presentation);
    }

    /** AUT-INT-001: the binding activates here, after every component built in start() has started. */
    public update(deltaTime: number): void {
        this.tickUiLayoutDiagnostics();
        this.tickCameraStateDiagnostics();
        if (this.pendingBinding) {
            this.activateSessionBinding(this.pendingBinding.binding, this.pendingBinding.status, this.pendingBinding.displayNames);
            this.pendingBinding = null;
            this.scheduleUiLayoutDiagnostics('session_ready');
            return;
        }
        void this.binding?.tick(deltaTime);
    }

    public onDestroy(): void {
        if (this.uiResizeRegistered) {
            view.off('canvas-resize', this.onUiResize, this);
            this.uiResizeRegistered = false;
        }
        if (!this.lifecycleHooksRegistered) return;
        game.off(Game.EVENT_HIDE, this.onGameHide, this);
        game.off(Game.EVENT_SHOW, this.onGameShow, this);
        this.lifecycleHooksRegistered = false;
    }

    /** Loads the save through the single authoritative session; a failed load stays inert and never starts fresh. */
    private startPersistentSession(presentation: PresentationController | null): void {
        let storage: FileSaveStorage;
        try {
            const port = new CocosFileSystemPort();
            this.saveRootPath = port.rootPath;
            storage = new FileSaveStorage(port);
        } catch (error) {
            this.reportSessionError('storage', error);
            this.emitSessionState('load_failed', 'storage_unavailable', null, false);
            return;
        }
        const automation: FactoryWorldAutomationSink | null = presentation ? {
            syncAutomationState: (snapshot) => presentation.syncAutomationState(snapshot),
            consumeDomainEvents: (snapshot, events) => presentation.consumeDomainEvents(snapshot, events),
        } : null;
        const cameraController = this.cameraController();
        bootstrapGameSession({ storage, timeService: new DefaultTimeService() }).then((result) => {
            if (!result.startup.ok) {
                this.emitSessionState('load_failed', result.startup.status, null, false);
                return;
            }
            const binding = new FactoryWorldStateBinding({
                session: result.startup.session,
                configRepository: result.configRepository,
                automation,
                hud: this.sessionWiring?.hud ?? null,
                panel: this.sessionWiring?.panel ?? null,
                // AUT-R-031-02: the pan bounds follow the unlocked zones of every fresh snapshot.
                camera: cameraController ? {
                    syncPanBounds: (snapshot) => cameraController.setFocusBounds(resolveCameraPanBounds(result.configRepository, snapshot, ZONE_LAYOUT, CAMERA_PAN_BOUNDS_MARGIN, cameraController.getGlobalFocusBounds())),
                } : null,
                reportError: (context, error) => this.reportSessionError(context, error),
                reportCommandResult: (command, commandResult) => this.emitCommandResult(command, commandResult),
                // AUT-GP-001: the Assembly batch Button follows the same snapshots and selection as the panel.
                assemblyBatch: this.sessionWiring?.batch ?? null,
                observeDomainEvents: isDeviceDiagnosticsEnabled() ? (events) => this.emitAssemblyBatchEvents(events) : undefined,
            });
            this.pendingBinding = { binding, status: result.startup.status, displayNames: result.configRepository };
        }).catch((error: unknown) => {
            this.reportSessionError('bootstrap', error);
            this.emitSessionState('load_failed', 'bootstrap_error', null, false);
        });
    }

    private activateSessionBinding(binding: FactoryWorldStateBinding, status: string, displayNames: DisplayNameSource): void {
        const wiring = this.sessionWiring;
        if (!wiring) return;
        this.binding = binding;
        binding.init();
        binding.onSelectionChanged(wiring.selection.getSelectedProducerId());
        wiring.hud.displayNames = displayNames;
        wiring.panel.displayNames = displayNames;
        wiring.hud.commandEmitter = (command) => { void binding.submit(command); };
        wiring.panel.commandEmitter = (command) => { void binding.submit(command); };
        wiring.batch.commandEmitter = (command) => { void binding.submit(command); };
        if (!this.lifecycleHooksRegistered) {
            game.on(Game.EVENT_HIDE, this.onGameHide, this);
            game.on(Game.EVENT_SHOW, this.onGameShow, this);
            this.lifecycleHooksRegistered = true;
        }
        this.emitSessionState('ready', status, null, binding.describe().autoFeederOwned);
        // DEBUG-only (emitDeviceEvent is a no-op unless enabled from DEBUG): the restored automation state.
        const payoff = wiring.presentation?.firstAutomationPresentation?.getSnapshot() ?? null;
        emitDeviceEvent('reveal_state', { phase: 'synced', source: 'session', automated: payoff?.activityIndicatorVisible === true, focusRequested: false });
    }

    private onGameHide(): void {
        const binding = this.binding;
        if (!binding) return;
        void binding.suspend().then((result) => {
            this.emitSessionState('suspended', result?.status ?? 'suspend_error', result?.save.ok ?? false, binding.describe().autoFeederOwned);
        });
    }

    private onGameShow(): void {
        const binding = this.binding;
        if (!binding) return;
        const result = binding.resume();
        this.emitSessionState('resumed', result?.status ?? 'resume_error', null, binding.describe().autoFeederOwned);
    }

    /** DEBUG-only `session_state` diagnostic (no-op unless diagnostics were enabled from DEBUG). */
    private emitSessionState(phase: 'ready' | 'suspended' | 'resumed' | 'load_failed', status: string, saveOk: boolean | null, autoFeederOwned: boolean): void {
        emitDeviceEvent('session_state', { phase, status, saveOk, autoFeederOwned, writablePath: this.saveRootPath });
    }

    /**
     * AUT-UI-001 DEBUG-only `command_result` diagnostic (no-op unless enabled from DEBUG): the session's verdict
     * on each submitted command; `industrialOutput` is the last balance the command's events report (else null).
     */
    private emitCommandResult(command: GameCommand, result: LifecycleCommandResult): void {
        if (!isDeviceDiagnosticsEnabled()) return;
        const execution = result.execution;
        let industrialOutput: number | null = null;
        for (const event of execution.events) if (event.type === 'industrialOutputChanged') industrialOutput = event.newAmount;
        emitDeviceEvent('command_result', {
            command,
            ok: execution.ok,
            reason: execution.ok ? null : execution.reason,
            eventTypes: execution.events.map((event) => event.type),
            industrialOutput,
        });
    }

    /** AUT-GP-001 DEBUG-only `assembly_batch` diagnostic for the runtime's batch launch / completion events. */
    private emitAssemblyBatchEvents(events: readonly DomainEvent[]): void {
        for (const event of events) {
            if (event.type === 'assistedBatchLaunched') emitDeviceEvent('assembly_batch', { phase: 'launched', producerId: event.producerId, durationSeconds: event.durationSeconds });
            if (event.type === 'assistedBatchCompleted') emitDeviceEvent('assembly_batch', { phase: 'completed', producerId: event.producerId, durationSeconds: event.durationSeconds, payout: event.payout });
        }
    }

    /** DEBUG-only `error` diagnostic; session failures never throw into the frame loop. */
    private reportSessionError(context: string, error: unknown): void {
        const stack = error instanceof Error ? String(error.stack ?? '') : '';
        emitDeviceEvent('error', { source: 'session', context, message: error instanceof Error ? error.message : String(error), stack: stack.slice(0, 400) });
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
            // AUT-038 reveal target: centre of the Fabricator production line
            // (input belt end z 1.9 .. output tray end z -1.6).
            focus.setPosition(
                0,
                0.2,
                zoneId === 'Fabricator' ? 0.15 : 0,
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
        // AUT-R-036-02 portrait framing (Scene Presentation, owner Option A 2026-11-11): the FOV is held on the
        // horizontal axis so the factory width stays framed on narrow portrait screens. 55 is provisional
        // (camera-feel human gate).
        camera.fovAxis = Camera.FOVAxis.HORIZONTAL;
        camera.fov = 55;
        camera.near = 0.1;
        camera.far = 200;
        // UI_2D must not be visible to the world camera, so UI hit tests can't claim world touches.
        camera.visibility = (Layers.Enum.ALL & ~Layers.Enum.UI_2D) >>> 0;

        const controller = rig.getComponent(MobileCameraController) ?? rig.addComponent(MobileCameraController);
        controller.cameraComponent = camera;
        controller.focusMinX = -9;
        controller.focusMaxX = 9;
        controller.focusMinZ = -6;
        controller.focusMaxZ = 8;
        controller.defaultYawDeg = 135;
        controller.defaultPitchDeg = 48;
        // AUT-R-036-02 portrait framing: default distance 14 (provisional) and the default focus on the
        // (-2.5, 0) corner of the Fabricator-only pan bounds; yaw/pitch and the global bounds are unchanged.
        controller.defaultDistance = 14;
        controller.defaultFocusX = -2.5;
        controller.defaultFocusZ = 0;
        // AUT-038 reveal pushes in from the default distance so the feeder line reads.
        controller.focusDistance = 9.5;
        // AUT-R-036-02: touch deltas are device pixels (Touch.getLocation), so the pan speed per pixel drops
        // with the portrait framing; 0.001 is provisional (camera-feel human gate).
        controller.panUnitsPerPixelAtDistance = 0.001;
        // AUT-R-031-02 tap-first input: one-finger drag pans (clamped to the unlocked zones); no orbit,
        // no pinch zoom, no two-finger pan. Taps stay with ProducerSelectionController.
        controller.oneFingerMode = 'pan';
        controller.multiTouchEnabled = false;
        controller.applyConfiguredInitialView();
        if (isDeviceDiagnosticsEnabled()) controller.onCameraGestureEnded = () => this.scheduleCameraStateDiagnostics();
    }

    private cameraController(): MobileCameraController | null {
        return this.node.getChildByName('FactorySite')?.getChildByName('CameraRig')?.getComponent(MobileCameraController) ?? null;
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
        controller.firstRobotPresentation = parent.getChildByName('Zone_AssemblyStation')
            ?.getChildByName('AssemblyStation_CompositionAnchor')
            ?.getComponent(FirstRobotPresentationController) ?? null;
        controller.robotLineVisual = parent.getChildByName('Zone_RobotLine')
            ?.getChildByName('RobotLine_CompositionAnchor')
            ?.getComponent(RobotLineVisualController) ?? null;
        controller.automatedCellVisual = parent.getChildByName('Zone_AutomatedCell')
            ?.getChildByName('AutomatedCell_CompositionAnchor')
            ?.getComponent(AutomatedCellVisualController) ?? null;
        controller.advancedRoboticsComplexVisual = parent.getChildByName('Zone_AdvancedRoboticsComplex')
            ?.getChildByName('AdvancedRoboticsComplex_CompositionAnchor')
            ?.getComponent(AdvancedRoboticsComplexVisualController) ?? null;
        controller.constructionPresentation = this.createConstructionPresentation(parent, registry);
        controller.robotPopulation = parent.getChildByName('Zone_AssemblyStation')
            ?.getChildByName('AssemblyStation_CompositionAnchor')
            ?.getComponent(RobotPopulationController) ?? null;
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

    /**
     * AUT-039 Assembly Station + first Worker Bot slice: the Assembly composition anchor gets the visual and
     * reveal controllers, the grey slab and the bay lamp primitives, and a reveal focus anchor on the bay ->
     * station entry path. Presentation only (it never reads or writes state).
     */
    private createAssemblySlice(parent: Node): void {
        const zone = parent.getChildByName('Zone_AssemblyStation');
        const composition = zone?.getChildByName('AssemblyStation_CompositionAnchor');
        if (!zone || !composition) return;
        const visual = composition.getComponent(AssemblyVisualController) ?? composition.addComponent(AssemblyVisualController);
        visual.assemblyPrefabs = this.assemblyPrefabs;
        const robot = composition.getComponent(FirstRobotPresentationController) ?? composition.addComponent(FirstRobotPresentationController);
        robot.robotPrefab = this.robotPrefab;
        const population = composition.getComponent(RobotPopulationController) ?? composition.addComponent(RobotPopulationController);
        population.robotPrefab = this.robotPrefab;
        if (!composition.getChildByName(ASSEMBLY_SLAB_NODE_NAME)) {
            const slab = ASSEMBLY_FOUNDATION_SLAB;
            const slabNode = this.createBox(composition, ASSEMBLY_SLAB_NODE_NAME, new Vec3(slab.size.x, slab.size.y, slab.size.z), this.assemblyLocalVec3(slab.center), new Color(136, 140, 137, 255));
            slabNode.setScale(0, 0, 0);
        }
        // Bay "light switching on": an unlit lamp state change (off = graphite shell, on = automation cyan).
        for (const [name, color] of [[ROBOT_BAY_LAMP_OFF_NODE_NAME, new Color(43, 49, 52, 255)], [ROBOT_BAY_LAMP_ON_NODE_NAME, new Color(82, 206, 224, 255)]] as const) {
            if (composition.getChildByName(name)) continue;
            const lamp = this.createBox(composition, name, new Vec3(ROBOT_BAY_LAMP.size.x, ROBOT_BAY_LAMP.size.y, ROBOT_BAY_LAMP.size.z), this.assemblyLocalVec3(ROBOT_BAY_LAMP.center), color);
            lamp.setScale(0, 0, 0);
        }
        const reveal = zone.getChildByName('FirstRobot_RevealAnchor') ?? new Node('FirstRobot_RevealAnchor');
        reveal.parent = zone;
        reveal.setPosition(this.assemblyLocalVec3(FIRST_ROBOT_REVEAL_TARGET));
    }

    /** AUT-040: one reusable construction controller; the Assembly composition is its first registered target. */
    private createConstructionPresentation(parent: Node, registry: Node): ConstructionPresentationController {
        const construction = registry.getComponent(ConstructionPresentationController) ?? registry.addComponent(ConstructionPresentationController);
        const composition = parent.getChildByName('Zone_AssemblyStation')?.getChildByName('AssemblyStation_CompositionAnchor');
        const visual = composition?.getComponent(AssemblyVisualController);
        if (composition && visual) {
            construction.registerTarget('assembly_station', visual);
            if (construction.sparkNodes.length === 0) {
                for (let index = 0; index < 6; index += 1) {
                    const spark = this.createBox(composition, `ConstructionSpark_${index}`, new Vec3(1, 1, 1), new Vec3(0, 0, 0), index % 2 === 0 ? new Color(82, 206, 224, 255) : new Color(255, 190, 80, 255));
                    spark.setScale(0, 0, 0);
                    construction.sparkNodes.push(spark);
                }
            }
            construction.sparkAnchors.set('assembly_station', this.assemblyLocalVec3({ x: -2.9, y: 0.16, z: -1.45 }));
            // AUT-042: the Robot Line is the second target; the shared sparks anchor on the line (assembly-local coordinates).
            const lineVisual = parent.getChildByName('Zone_RobotLine')?.getChildByName('RobotLine_CompositionAnchor')?.getComponent(RobotLineVisualController);
            if (lineVisual) {
                construction.registerTarget('robot_line', lineVisual);
                construction.sparkAnchors.set('robot_line', this.assemblyLocalVec3(ROBOT_LINE_SPARK_ANCHOR));
            }
            // AUT-043: the Automated Cell is the third target; the shared sparks re-anchor on the cell (assembly-local coordinates).
            const cellVisual = parent.getChildByName('Zone_AutomatedCell')?.getChildByName('AutomatedCell_CompositionAnchor')?.getComponent(AutomatedCellVisualController);
            if (cellVisual) {
                construction.registerTarget('automated_cell', cellVisual);
                construction.sparkAnchors.set('automated_cell', this.assemblyLocalVec3(AUTOMATED_CELL_SPARK_ANCHOR));
            }
            // AUT-044: the Advanced Robotics Complex is the fourth target; the shared sparks re-anchor on the complex (assembly-local coordinates).
            const arcVisual = parent.getChildByName('Zone_AdvancedRoboticsComplex')?.getChildByName('AdvancedRoboticsComplex_CompositionAnchor')?.getComponent(AdvancedRoboticsComplexVisualController);
            if (arcVisual) {
                construction.registerTarget('advanced_robotics_complex', arcVisual);
                construction.sparkAnchors.set('advanced_robotics_complex', this.assemblyLocalVec3(ARC_SPARK_ANCHOR));
            }
        }
        return construction;
    }

    /**
     * AUT-042 Robot Line (Producer #3): the RobotLine composition anchor gets the visual controller, the grey slab,
     * the output lip plate and the unlit status lamps (primitives), and a reveal focus anchor on the line.
     * Presentation only (it never reads or writes state).
     */
    private createRobotLineSlice(parent: Node): void {
        const zone = parent.getChildByName('Zone_RobotLine');
        const composition = zone?.getChildByName('RobotLine_CompositionAnchor');
        if (!zone || !composition) return;
        const visual = composition.getComponent(RobotLineVisualController) ?? composition.addComponent(RobotLineVisualController);
        visual.robotLinePrefabs = this.robotLinePrefabs;
        visual.robotPrefab = this.robotPrefab;
        const local = (world: { x: number; y: number; z: number }): Vec3 => { const l = robotLineLocal(world); return new Vec3(l.x, l.y, l.z); };
        if (!composition.getChildByName(ROBOT_LINE_SLAB_NODE_NAME)) {
            const slab = ROBOT_LINE_FOUNDATION_SLAB;
            this.createBox(composition, ROBOT_LINE_SLAB_NODE_NAME, new Vec3(slab.size.x, slab.size.y, slab.size.z), local(slab.center), new Color(136, 140, 137, 255)).setScale(0, 0, 0);
        }
        if (!composition.getChildByName(ROBOT_LINE_LIP_NODE_NAME)) {
            const lip = ROBOT_LINE_OUTPUT_LIP;
            this.createBox(composition, ROBOT_LINE_LIP_NODE_NAME, new Vec3(lip.size.x, lip.size.y, lip.size.z), local(lip.center), new Color(74, 85, 88, 255)).setScale(0, 0, 0);
        }
        // Status lamps: unlit graphite while idle, automation cyan when active (a colour state change, no dynamic light).
        for (const lampId of ROBOT_LINE_LAMP_IDS) {
            const lamp = ROBOT_LINE_LAMPS[lampId];
            for (const [prefix, color] of [[ROBOT_LINE_LAMP_OFF_NODE_PREFIX, new Color(43, 49, 52, 255)], [ROBOT_LINE_LAMP_ON_NODE_PREFIX, new Color(82, 206, 224, 255)]] as const) {
                const name = `${prefix}${lampId}`;
                if (composition.getChildByName(name)) continue;
                this.createBox(composition, name, new Vec3(lamp.size.x, lamp.size.y, lamp.size.z), local(lamp.center), color).setScale(0, 0, 0);
            }
        }
        const reveal = zone.getChildByName('RobotLine_RevealAnchor') ?? new Node('RobotLine_RevealAnchor');
        reveal.parent = zone;
        reveal.setPosition(local(ROBOT_LINE_REVEAL_TARGET));
    }

    private connectRobotLinePresentation(parent: Node): void {
        const zone = parent.getChildByName('Zone_RobotLine');
        const visual = zone?.getChildByName('RobotLine_CompositionAnchor')?.getComponent(RobotLineVisualController);
        if (!zone || !visual) return;
        visual.cameraController = parent.getChildByName('CameraRig')?.getComponent(MobileCameraController) ?? null;
        visual.focusAnchor = zone.getChildByName('RobotLine_RevealAnchor') ?? null;
    }

    /**
     * AUT-043 Automated Cell (Producer #4): the AutomatedCell composition anchor gets the visual controller, the grey
     * slab, the unlit status lamps and the one-flow floor guide (primitives), and a reveal focus anchor on the cell.
     * Presentation only (it never reads or writes state).
     */
    private createAutomatedCellSlice(parent: Node): void {
        const zone = parent.getChildByName('Zone_AutomatedCell');
        const composition = zone?.getChildByName('AutomatedCell_CompositionAnchor');
        if (!zone || !composition) return;
        const visual = composition.getComponent(AutomatedCellVisualController) ?? composition.addComponent(AutomatedCellVisualController);
        visual.automatedCellPrefabs = this.automatedCellPrefabs;
        visual.robotPrefab = this.robotPrefab;
        const local = (world: { x: number; y: number; z: number }): Vec3 => { const l = automatedCellLocal(world); return new Vec3(l.x, l.y, l.z); };
        if (!composition.getChildByName(AUTOMATED_CELL_SLAB_NODE_NAME)) {
            const slab = AUTOMATED_CELL_FOUNDATION_SLAB;
            this.createBox(composition, AUTOMATED_CELL_SLAB_NODE_NAME, new Vec3(slab.size.x, slab.size.y, slab.size.z), local(slab.center), new Color(136, 140, 137, 255)).setScale(0, 0, 0);
        }
        // Status lamps: unlit graphite while idle, automation cyan when active (a colour state change, no dynamic light).
        for (const lampId of AUTOMATED_CELL_LAMP_IDS) {
            const lamp = AUTOMATED_CELL_LAMPS[lampId];
            for (const [prefix, color] of [[AUTOMATED_CELL_LAMP_OFF_NODE_PREFIX, new Color(43, 49, 52, 255)], [AUTOMATED_CELL_LAMP_ON_NODE_PREFIX, new Color(82, 206, 224, 255)]] as const) {
                const name = `${prefix}${lampId}`;
                if (composition.getChildByName(name)) continue;
                this.createBox(composition, name, new Vec3(lamp.size.x, lamp.size.y, lamp.size.z), local(lamp.center), color).setScale(0, 0, 0);
            }
        }
        // One-flow floor guide: graphite until the cell is built, then ~40% cyan. Visible (graphite) from the start.
        for (const part of AUTOMATED_CELL_GUIDE_PARTS) {
            const guide = AUTOMATED_CELL_GUIDE[part];
            const off = AUTOMATED_CELL_GUIDE_OFF_COLOR;
            const on = AUTOMATED_CELL_GUIDE_ON_COLOR;
            for (const [prefix, color, scale] of [[AUTOMATED_CELL_GUIDE_OFF_NODE_PREFIX, new Color(off.r, off.g, off.b, 255), 1], [AUTOMATED_CELL_GUIDE_ON_NODE_PREFIX, new Color(on.r, on.g, on.b, 255), 0]] as const) {
                const name = `${prefix}${part}`;
                if (composition.getChildByName(name)) continue;
                this.createBox(composition, name, new Vec3(guide.size.x, guide.size.y, guide.size.z), local(guide.center), color).setScale(scale, scale, scale);
            }
        }
        const reveal = zone.getChildByName('AutomatedCell_RevealAnchor') ?? new Node('AutomatedCell_RevealAnchor');
        reveal.parent = zone;
        reveal.setPosition(local(AUTOMATED_CELL_REVEAL_TARGET));
    }

    private connectAutomatedCellPresentation(parent: Node): void {
        const zone = parent.getChildByName('Zone_AutomatedCell');
        const visual = zone?.getChildByName('AutomatedCell_CompositionAnchor')?.getComponent(AutomatedCellVisualController);
        if (!zone || !visual) return;
        visual.cameraController = parent.getChildByName('CameraRig')?.getComponent(MobileCameraController) ?? null;
        visual.focusAnchor = zone.getChildByName('AutomatedCell_RevealAnchor') ?? null;
    }

    /**
     * AUT-044 Advanced Robotics Complex (Producer #5): the AdvancedRoboticsComplex composition anchor gets the visual controller,
     * the grey slab, the graphite gantry beams, the unlit status lamps and the connector guide (primitives), and a reveal
     * focus anchor on the complex. Presentation only (it never reads or writes state).
     */
    private createAdvancedRoboticsComplexSlice(parent: Node): void {
        const zone = parent.getChildByName('Zone_AdvancedRoboticsComplex');
        const composition = zone?.getChildByName('AdvancedRoboticsComplex_CompositionAnchor');
        if (!zone || !composition) return;
        const visual = composition.getComponent(AdvancedRoboticsComplexVisualController) ?? composition.addComponent(AdvancedRoboticsComplexVisualController);
        visual.advancedRoboticsComplexPrefabs = this.advancedRoboticsComplexPrefabs;
        visual.robotPrefab = this.robotPrefab;
        const local = (world: { x: number; y: number; z: number }): Vec3 => { const l = arcLocal(world); return new Vec3(l.x, l.y, l.z); };
        if (!composition.getChildByName(ARC_SLAB_NODE_NAME)) {
            const slab = ARC_FOUNDATION_SLAB;
            this.createBox(composition, ARC_SLAB_NODE_NAME, new Vec3(slab.size.x, slab.size.y, slab.size.z), local(slab.center), new Color(136, 140, 137, 255)).setScale(0, 0, 0);
        }
        // Gantry beams: graphite primitives resting on the west frame tops (Lv10).
        for (const beamId of ['beam_1', 'beam_2'] as const) {
            if (composition.getChildByName(beamId)) continue;
            const beam = ARC_BEAMS[beamId];
            const graphite = ARC_BEAM_GRAPHITE_COLOR;
            this.createBox(composition, beamId, new Vec3(beam.size.x, beam.size.y, beam.size.z), local(beam.center), new Color(graphite.r, graphite.g, graphite.b, 255)).setScale(0, 0, 0);
        }
        // Status lamps: unlit graphite while idle, automation cyan when active (a colour state change, no dynamic light).
        for (const lampId of ARC_LAMP_IDS) {
            const lamp = ARC_LAMPS[lampId];
            for (const [prefix, color] of [[ARC_LAMP_OFF_NODE_PREFIX, new Color(43, 49, 52, 255)], [ARC_LAMP_ON_NODE_PREFIX, new Color(82, 206, 224, 255)]] as const) {
                const name = `${prefix}${lampId}`;
                if (composition.getChildByName(name)) continue;
                this.createBox(composition, name, new Vec3(lamp.size.x, lamp.size.y, lamp.size.z), local(lamp.center), color).setScale(0, 0, 0);
            }
        }
        // Connector guide (crate -> complex): graphite until the complex is built, then ~40% cyan. Visible (graphite) from the start.
        for (const part of ARC_GUIDE_PARTS) {
            const guide = ARC_GUIDE[part];
            const off = ARC_GUIDE_OFF_COLOR;
            const on = ARC_GUIDE_ON_COLOR;
            for (const [prefix, color, scale] of [[ARC_GUIDE_OFF_NODE_PREFIX, new Color(off.r, off.g, off.b, 255), 1], [ARC_GUIDE_ON_NODE_PREFIX, new Color(on.r, on.g, on.b, 255), 0]] as const) {
                const name = `${prefix}${part}`;
                if (composition.getChildByName(name)) continue;
                this.createBox(composition, name, new Vec3(guide.size.x, guide.size.y, guide.size.z), local(guide.center), color).setScale(scale, scale, scale);
            }
        }
        const reveal = zone.getChildByName('AdvancedRoboticsComplex_RevealAnchor') ?? new Node('AdvancedRoboticsComplex_RevealAnchor');
        reveal.parent = zone;
        reveal.setPosition(local(ARC_REVEAL_TARGET));
    }

    private connectAdvancedRoboticsComplexPresentation(parent: Node): void {
        const zone = parent.getChildByName('Zone_AdvancedRoboticsComplex');
        const visual = zone?.getChildByName('AdvancedRoboticsComplex_CompositionAnchor')?.getComponent(AdvancedRoboticsComplexVisualController);
        if (!zone || !visual) return;
        visual.cameraController = parent.getChildByName('CameraRig')?.getComponent(MobileCameraController) ?? null;
        visual.focusAnchor = zone.getChildByName('AdvancedRoboticsComplex_RevealAnchor') ?? null;
    }

    private assemblyLocalVec3(world: { x: number; y: number; z: number }): Vec3 {
        const local = assemblyLocal(world);
        return new Vec3(local.x, local.y, local.z);
    }

    private connectFirstRobotPresentation(parent: Node): void {
        const zone = parent.getChildByName('Zone_AssemblyStation');
        const composition = zone?.getChildByName('AssemblyStation_CompositionAnchor');
        const presentation = composition?.getComponent(FirstRobotPresentationController);
        if (!composition || !presentation) return;
        presentation.assemblyVisual = composition.getComponent(AssemblyVisualController);
        presentation.cameraController = parent.getChildByName('CameraRig')?.getComponent(MobileCameraController) ?? null;
        presentation.focusAnchor = zone?.getChildByName('FirstRobot_RevealAnchor') ?? null;
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

    /**
     * AUT-R-036 screen-space UI root: a fit-height Canvas aligned with the screen and rendered by a
     * dedicated orthographic UI camera that sees UI_2D only and draws above the WorldCamera with a
     * depth-only clear, plus a full-screen `UiSafeArea` container that the HUD and the panel anchor to.
     */
    private createUiRoot(site: Node): void {
        const canvas = this.node.getChildByName('CoreHudCanvas') ?? new Node('CoreHudCanvas');
        canvas.parent = this.node;
        canvas.layer = Layers.Enum.UI_2D;
        canvas.getComponent(UITransform) ?? canvas.addComponent(UITransform);
        const canvasWidget = canvas.getComponent(Widget) ?? canvas.addComponent(Widget);
        this.stretchWidget(canvasWidget);
        canvasWidget.updateAlignment();
        const canvasComponent = canvas.getComponent(Canvas) ?? canvas.addComponent(Canvas);

        const cameraNode = canvas.getChildByName('UICamera') ?? new Node('UICamera');
        cameraNode.parent = canvas;
        cameraNode.layer = Layers.Enum.UI_2D;
        const uiCamera = cameraNode.getComponent(Camera) ?? cameraNode.addComponent(Camera);
        uiCamera.projection = Camera.ProjectionType.ORTHO;
        uiCamera.visibility = Layers.Enum.UI_2D;
        uiCamera.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
        const worldCamera = site.getChildByName('CameraRig')?.getChildByName('WorldCamera')?.getComponent(Camera) ?? null;
        uiCamera.priority = (worldCamera?.priority ?? 0) + 1;
        uiCamera.near = 1;
        uiCamera.far = 2000;
        canvasComponent.cameraComponent = uiCamera;
        canvasComponent.alignCanvasWithScreen = true;

        const container = canvas.getChildByName('UiSafeArea') ?? new Node('UiSafeArea');
        container.parent = canvas;
        container.layer = Layers.Enum.UI_2D;
        container.getComponent(UITransform) ?? container.addComponent(UITransform);
        this.stretchWidget(container.getComponent(Widget) ?? container.addComponent(Widget));
        container.getComponent(SafeArea) ?? container.addComponent(SafeArea);

        if (!this.uiResizeRegistered) {
            view.on('canvas-resize', this.onUiResize, this);
            this.uiResizeRegistered = true;
        }
    }

    private createCoreHud(): CoreHudController {
        const container = this.uiSafeArea();
        const hud = container.getChildByName('CoreHUD') ?? new Node('CoreHUD');
        hud.parent = container;
        hud.layer = Layers.Enum.UI_2D;
        this.anchorCard(hud, CORE_HUD_LAYOUT);
        return hud.getComponent(CoreHudController) ?? hud.addComponent(CoreHudController);
    }

    private createProducerPanel(): ProducerPanelController {
        const container = this.uiSafeArea();
        const panel = container.getChildByName('ProducerPanel') ?? new Node('ProducerPanel');
        panel.parent = container;
        panel.layer = Layers.Enum.UI_2D;
        this.anchorCard(panel, PRODUCER_PANEL_LAYOUT);
        return panel.getComponent(ProducerPanelController) ?? panel.addComponent(ProducerPanelController);
    }

    /** AUT-GP-001: the Assembly batch Button node, inside the panel card next to Manual Produce (bottom thumb zone). */
    private createAssemblyBatchAction(panel: Node): AssemblyBatchActionController {
        const node = panel.getChildByName(ASSEMBLY_BATCH_ACTION_KEY) ?? new Node(ASSEMBLY_BATCH_ACTION_KEY);
        node.parent = panel;
        node.layer = Layers.Enum.UI_2D;
        return node.getComponent(AssemblyBatchActionController) ?? node.addComponent(AssemblyBatchActionController);
    }

    private uiSafeArea(): Node {
        const container = this.node.getChildByName('CoreHudCanvas')?.getChildByName('UiSafeArea');
        if (!container) throw new Error('createUiRoot() must run before the HUD and the panel are built.');
        return container;
    }

    private stretchWidget(widget: Widget): void {
        widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
        widget.top = widget.bottom = widget.left = widget.right = 0;
    }

    /**
     * Anchors a card to its UiLayout edge of the safe area (AUT-R-036-02: a full-width band, centred
     * horizontally); ALWAYS so safe-area or size changes re-align it.
     */
    private anchorCard(node: Node, card: UiCardSpec): void {
        node.getComponent(UITransform) ?? node.addComponent(UITransform);
        const widget = node.getComponent(Widget) ?? node.addComponent(Widget);
        const align = widgetAlignment(card.corner);
        widget.isAlignTop = align.top;
        widget.isAlignBottom = align.bottom;
        widget.isAlignLeft = align.left;
        widget.isAlignRight = align.right;
        widget.isAlignHorizontalCenter = align.horizontalCenter;
        widget.horizontalCenter = 0;
        widget.top = widget.bottom = widget.left = widget.right = UI_EDGE_MARGIN;
        widget.alignMode = Widget.AlignMode.ALWAYS;
    }

    // ---- AUT-R-036 DEBUG `ui_layout` diagnostic (emit only; never changes layout, selection or input) ----

    /**
     * DEBUG-only: after the panel refresh a selection change causes (replaceSelection + binding refresh, both
     * synchronous in the wrapped handler), re-reports `ui_layout` with the real strings. Scheduling restarts
     * the 2-frame countdown, so a burst of refreshes emits once.
     */
    private reportUiLayoutAfterSelection(selection: ProducerSelectionController): void {
        if (!isDeviceDiagnosticsEnabled()) return;
        const refreshPanel = selection.onSelectionChanged;
        selection.onSelectionChanged = (producerId) => {
            refreshPanel?.(producerId);
            this.scheduleUiLayoutDiagnostics('selection_refresh');
        };
    }

    private onUiResize(): void {
        this.scheduleUiLayoutDiagnostics('screen_resize');
    }

    private scheduleUiLayoutDiagnostics(reason: string): void {
        if (!isDeviceDiagnosticsEnabled()) return;
        this.uiLayoutReason = reason;
        this.uiLayoutFrames = 2;
    }

    private tickUiLayoutDiagnostics(): void {
        if (this.uiLayoutFrames <= 0) return;
        this.uiLayoutFrames -= 1;
        if (this.uiLayoutFrames === 0) this.emitUiLayout(this.uiLayoutReason);
    }

    /**
     * Screen rectangles of the HUD, the panel and its Button rows: bounding-box corners projected through
     * the UI camera, so they share the bottom-left window frame of touches and `zones_projected`.
     */
    private emitUiLayout(reason: string): void {
        const canvas = this.node.getChildByName('CoreHudCanvas');
        const uiCamera = canvas?.getChildByName('UICamera')?.getComponent(Camera) ?? null;
        const container = canvas?.getChildByName('UiSafeArea') ?? null;
        if (!uiCamera || !container) return;
        const rectOf = (node: Node | null | undefined): UiRect | null => {
            const box = node?.getComponent(UITransform)?.getBoundingBoxToWorld();
            if (!box) return null;
            const a = uiCamera.worldToScreen(new Vec3(box.xMin, box.yMin, 0), new Vec3());
            const b = uiCamera.worldToScreen(new Vec3(box.xMax, box.yMax, 0), new Vec3());
            return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
        };
        const hud = container.getChildByName('CoreHUD');
        const panel = container.getChildByName('ProducerPanel');
        const rects: Record<string, UiRect | null> = { CoreHUD: rectOf(hud), ProducerPanel: rectOf(panel) };
        for (const key of PANEL_ACTION_KEYS) rects[key] = rectOf(panel?.getChildByName(key));
        for (const key of HUD_ACTION_KEYS) rects[key] = rectOf(hud?.getChildByName(key) ?? panel?.getChildByName(key));
        // AUT-GP-001: the batch Button rect only while it is shown (null when hidden).
        const batchNode = panel?.getChildByName(ASSEMBLY_BATCH_ACTION_KEY) ?? null;
        rects[ASSEMBLY_BATCH_ACTION_KEY] = batchNode?.active ? rectOf(batchNode) : null;
        const rowsOf = (card: Node | null, spec: UiCardSpec) => Object.fromEntries(spec.rows.map((row) => [row.key, rectOf(card?.getChildByName(row.key))]));
        const rows = { CoreHUD: rowsOf(hud, CORE_HUD_LAYOUT), ProducerPanel: rowsOf(panel, PRODUCER_PANEL_LAYOUT) };
        // AUT-UI-001: effective (post-SHRINK) font size of every non-empty label in design units; null while empty.
        // Label.actualFontSize is in render pixels: the TTF assembler multiplies by max(1, view scale), capped at 100 px.
        const fontOf = (card: Node | null, key: string) => {
            const label = card?.getChildByName(key)?.getComponent(Label);
            if (!label || label.string.length === 0) return null;
            let renderScale = view.getScaleX();
            if (renderScale * label.fontSize > 100 && label.fontSize < 100) renderScale = 100 / label.fontSize;
            return label.actualFontSize / Math.max(1, renderScale);
        };
        const fontSizes = {
            CoreHUD: Object.fromEntries([...CORE_HUD_LAYOUT.rows.map((row) => row.key), ...HUD_ACTION_KEYS].map((key) => [key, fontOf(hud?.getChildByName(key) ? hud : panel, key)])),
            ProducerPanel: Object.fromEntries([...PRODUCER_PANEL_LAYOUT.rows.map((row) => row.key), ...PANEL_ACTION_KEYS].map((key) => [key, fontOf(panel, key)])),
        };
        const hudActions = this.sessionWiring?.hud.getActionStates() ?? null;
        const assemblyBatch = this.sessionWiring?.batch.getActionState() ?? null;
        const windowSize = screen.windowSize;
        emitDeviceEvent('ui_layout', {
            reason,
            screen: { w: windowSize.width, h: windowSize.height },
            safeArea: rectOf(container),
            corners: { CoreHUD: CORE_HUD_LAYOUT.corner, ProducerPanel: PRODUCER_PANEL_LAYOUT.corner },
            rects,
            rows,
            fontSizes,
            hudActions,
            assemblyBatch,
        });
    }

    // ---- AUT-R-031-02 DEBUG `camera_state` diagnostic (emit only; never changes camera, selection or input) ----

    /** Two frames after a camera gesture ends, so the camera matrices used for the projection are current. */
    private scheduleCameraStateDiagnostics(): void {
        if (!isDeviceDiagnosticsEnabled()) return;
        this.cameraStateFrames = 2;
    }

    private tickCameraStateDiagnostics(): void {
        if (this.cameraStateFrames <= 0) return;
        this.cameraStateFrames -= 1;
        if (this.cameraStateFrames === 0) this.emitCameraState('gesture_end');
    }

    /** Camera pose, active pan bounds and the zone centres projected through the WorldCamera (bottom-left window frame). */
    private emitCameraState(reason: string): void {
        const controller = this.cameraController();
        if (!controller) return;
        const state = controller.getCameraState();
        const site = this.node.getChildByName('FactorySite');
        const camera = site?.getChildByName('CameraRig')?.getChildByName('WorldCamera')?.getComponent(Camera) ?? null;
        const windowSize = screen.windowSize;
        const zones = FACTORY_ZONE_IDS.map((id) => {
            const target = site?.getChildByName(`Zone_${id}`)?.getChildByName(`${id}_SelectableTarget`);
            const world = target?.worldPosition ?? null;
            const projected = camera && world ? camera.worldToScreen(world, new Vec3()) : null;
            const onScreen = projected !== null && projected.x >= 0 && projected.y >= 0
                && projected.x <= windowSize.width && projected.y <= windowSize.height && projected.z > 0 && projected.z < 1;
            return { id, sx: projected?.x ?? null, sy: projected?.y ?? null, onScreen };
        });
        emitDeviceEvent('camera_state', {
            reason,
            yaw: state.yawDeg,
            pitch: state.pitchDeg,
            distance: state.distance,
            focus: state.focus,
            bounds: controller.getFocusBounds(),
            input: controller.getInputFlags(),
            screen: { w: windowSize.width, h: windowSize.height },
            zones,
        });
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
