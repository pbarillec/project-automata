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
import { EraEnvironmentVisualController } from './EraEnvironmentVisualController';
import { MilestonePresentationController } from './MilestonePresentationController';
import { BoostPresentationController } from './BoostPresentationController';
import { RebootPresentationController } from './RebootPresentationController';
import { OfflineReportController, type OfflineReportShowReason } from './OfflineReportController';
import { PermanentUpgradeController } from './PermanentUpgradeController';
import { RebootController } from './RebootController';
import { SettingsController } from './SettingsController';
import { mapEventsToCues } from './AudioCueMapper.ts';
import { SettingsStore, type SettingsEvent } from '../settings/SettingsStore.ts';
import type { UserSettings } from '../settings/UserSettings.ts';
import { getDefaultTextCatalogue, type MissingTextReport } from '../localization/index.ts';
import type { AudioService } from '../services/AudioService.ts';
import type { HapticsService } from '../services/HapticsService.ts';
import { SilentAudioService } from '../platform/noop/SilentAudioService';
import { NoOpHapticsService } from '../platform/noop/NoOpHapticsService';
import { REBOOT_CORE_EULER_DEG, REBOOT_SOCKET, socketRingBars } from './RebootPresentation.ts';
import { milestoneToastTopOffset } from './MilestoneToastLayout.ts';
import { MILESTONE_ACCENT_RGB, producerZoneName } from './MilestoneFeedback.ts';
import { ERA_ENV_BOXES, ERA_ENV_GROUP_IDS, ERA_ENV_GROUP_NODE_NAMES, ERA_ENV_ROOT_NODE_NAME } from './EraEnvironmentLayout.ts';
import { ROBOT_LINE_FOUNDATION_SLAB, ROBOT_LINE_LAMP_IDS, ROBOT_LINE_LAMPS, ROBOT_LINE_OUTPUT_LIP, ROBOT_LINE_REVEAL_TARGET, ROBOT_LINE_SPARK_ANCHOR, robotLineLocal } from './RobotLineLayout.ts';
import { FirstRobotPresentationController, ROBOT_BAY_LAMP_OFF_NODE_NAME, ROBOT_BAY_LAMP_ON_NODE_NAME } from './FirstRobotPresentationController';
import { ASSEMBLY_FOUNDATION_SLAB, assemblyLocal, FIRST_ROBOT_REVEAL_TARGET, ROBOT_BAY_LAMP } from './AssemblySliceLayout.ts';
import { CocosFileSystemPort } from '../app/CocosFileSystemPort';
import { DEBUG_COMMAND_FILE, parseDebugCommandFile } from './DebugCommandFile.ts';
import { DEBUG_ADS_FILE, parseDebugAdsScriptFile, type DebugAdsScript } from './DebugAdsScriptFile.ts';
import { createBuildAdsService, createBuildPurchaseService } from './BuildPlatformServices.ts';
import { DEBUG_PURCHASE_FILE, parseDebugPurchaseScriptFile, type DebugPurchaseScript } from './DebugPurchaseScriptFile.ts';
import { FounderShopController } from './FounderShopController';
import { FounderShopFlow } from './FounderShopFlow.ts';
import { PRODUCTS } from '../services/PlatformServiceTypes.ts';
import type { PurchaseService } from '../services/PurchaseService';
import { getFounderSurgeChargesRemaining, hasFounderSurgeGrantBeenRecorded, isFounderPackOwned, isFounderRobotCosmeticOwned } from '../monetization/FounderOffer.ts';
import { OverlayBackgroundGate } from './OverlayBackgroundGate.ts';
import { createAndroidAdsTransport, createAndroidBillingTransport } from '../platform/android/AndroidNativeBridge';
import { PlatformOverlayTracker } from '../services/PlatformOverlay';
import { OfflineDoubleFlow } from './OfflineDoubleFlow.ts';
import { ExtendedOverclockController } from './ExtendedOverclockController';
import { ExtendedOverclockFlow } from './ExtendedOverclockFlow.ts';
import { EXTENDED_OVERCLOCK_CLAIM_KEY, OFFLINE_DOUBLE_CLAIM_KEY } from '../monetization/RewardedEligibility.ts';
import type { AdsService } from '../services/AdsService';
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

    /** AUT-045 era environment prefabs (AUT-032 structure-high), index-aligned with ERA_ENV_PREFAB_SLOTS. */
    @property([Prefab])
    public environmentPrefabs: Prefab[] = [];

    /** AUT-039 first Worker Bot: the AUT-032 Robot.glb prefab. */
    @property(Prefab)
    public robotPrefab: Prefab | null = null;

    /** AUT-INT-001: the persistent session binding; null until the save has loaded (inputs stay inert). */
    private binding: FactoryWorldStateBinding | null = null;
    private pendingBinding: { binding: FactoryWorldStateBinding; status: string; displayNames: DisplayNameSource } | null = null;
    /** AUT-055: the build-selected rewarded-ad provider (mock in DEBUG, no-op otherwise). */
    private offlineAds: AdsService | null = null;
    /** AUT-057: ONE overlay tracker shared by the ads provider and the lifecycle consumer (overlay hide != player absence). */
    private readonly platformOverlay = new PlatformOverlayTracker();
    /** AUT-059: the build-selected purchase provider (mock only in DEBUG with a debug_purchase.json script, otherwise the no-op: no Founder entry). */
    private purchases: PurchaseService | null = null;
    private purchaseSource: 'store' | 'mock' = 'store';
    private debugPurchaseScript: DebugPurchaseScript | undefined;
    private readonly overlayGate = new OverlayBackgroundGate();
    private adsAvailabilitySignature = '';
    private adsProviderStarted = false;
    private extendedHudSeconds = 0;
    private sessionWiring: { hud: CoreHudController; panel: ProducerPanelController; batch: AssemblyBatchActionController; selection: ProducerSelectionController; presentation: PresentationController | null; offlineReport: OfflineReportController; permanentUpgrades: PermanentUpgradeController; settings: SettingsController; reboot: RebootController; extendedOverclock: ExtendedOverclockController; founderShop: FounderShopController } | null = null;
    /** AUT-RBT-001: set by the binding's pending-offline callback and consumed by the Reboot modal to tell "blocked" from "exception" (both return null). */
    private rebootBlockedByPendingOffline = false;
    /** AUT-052: device preferences (own file, loaded before the first UI paint) and the silent audio / no-op haptics services that follow them. */
    private settingsStore: SettingsStore | null = null;
    private readonly audio: AudioService = new SilentAudioService();
    private readonly haptics: HapticsService = new NoOpHapticsService();
    private missingTextReports = 0;
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
        // AUT-052: the user settings load synchronously BEFORE any UI is built, so the first paint already uses them.
        this.loadUserSettings();
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
        this.createEraEnvironment(site);
        this.createPresentationRegistry(site);
        const selection = this.createProducerSelection(site);
        this.createUiRoot(site);
        const hud = this.createCoreHud();
        const panel = this.createProducerPanel();
        // AUT-R-036-02: Manual Produce sits in the bottom band, inside the panel card (before the HUD's first layout).
        hud.primaryActionHost = panel.node;
        const batch = this.createAssemblyBatchAction(panel.node);
        this.createMilestonePresentation(site);
        this.createBoostPresentation(site);
        this.createRebootPresentation(site);
        // AUT-050: the AI Upgrades chip + panel sit below the offline card (the offline report root stays the LAST child of the Canvas).
        const permanentUpgrades = this.createPermanentUpgrades();
        // AUT-052: the Settings chip / panel also sit below the offline card root, which stays the LAST child of the Canvas.
        const settings = this.createSettings();
        // AUT-RBT-001: the Reboot chip / modal sit below the offline card root too (created before it, so the offline card stays topmost).
        const reboot = this.createReboot();
        // AUT-056: the Extended Overclock chip (fixed slot, second line under the HUD band) also sits below the offline card root.
        const extendedOverclock = this.createExtendedOverclock();
        // AUT-059: the Founder's Pack chip (third line, right) and modal also sit below the offline card root.
        const founderShop = this.createFounderShop();
        const offlineReport = this.createOfflineReport();
        selection.onSelectionChanged = (producerId) => {
            panel.replaceSelection(producerId);
            this.binding?.onSelectionChanged(producerId);
        };
        this.reportUiLayoutAfterSelection(selection);
        const presentation = site.getChildByName('PresentationAnchors')?.getComponent(PresentationController) ?? null;
        this.sessionWiring = { hud, panel, batch, selection, presentation, offlineReport, permanentUpgrades, settings, reboot, extendedOverclock, founderShop };
        this.startPersistentSession(presentation);
    }

    /** AUT-INT-001: the binding activates here, after every component built in start() has started. */
    public update(deltaTime: number): void {
        this.tickUiLayoutDiagnostics();
        this.tickCameraStateDiagnostics();
        this.updateSettingsSuppression();
        this.tickExtendedOverclockHudDiagnostics(deltaTime);
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
        // AUT-055: the rewarded-ad provider is chosen at build time: a mock only in DEBUG builds, otherwise the no-op (x2 hidden). The DEBUG script is read once.
        // AUT-057: release = the Android AdMob provider (NoOp when unconfigured / no native bridge); DEBUG = the mock unless the script asks for admob_test.
        this.offlineAds = createBuildAdsService(DEBUG === true, this.readDebugAdsScript(), {
            androidTransport: createAndroidAdsTransport(),
            overlay: this.platformOverlay,
            onDiagnostic: (phase, payload) => emitDeviceEvent('ads_state', { phase, ...payload }),
        });
        this.platformOverlay.subscribe((event) => emitDeviceEvent('ads_state', { phase: 'overlay', state: event.phase, kind: event.kind, requestId: event.requestId }));
        // AUT-059: the purchase provider is chosen at build time: release / no script = the no-op (no Founder entry); DEBUG + debug_purchase.json = the scriptable mock.
        this.debugPurchaseScript = this.readDebugPurchaseScript();
        // AUT-060: release = the Google Play Billing provider (NoOp without the native bridge); DEBUG = the mock script, or the real provider only for `provider: "play_billing"`.
        const purchaseSelection = createBuildPurchaseService(DEBUG === true, this.debugPurchaseScript, {
            androidTransport: createAndroidBillingTransport(),
            overlay: this.platformOverlay,
            onDiagnostic: (phase, payload) => emitDeviceEvent('founder_shop', { phase: `billing_${phase}`, ...payload }),
        });
        this.purchases = purchaseSelection.service;
        this.purchaseSource = purchaseSelection.source;
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
                // AUT-050: the AI Upgrades chip / panel follows every fresh snapshot.
                permanentUpgrades: this.sessionWiring?.permanentUpgrades ?? null,
                // AUT-RBT-001: the Reboot chip / modal follows every fresh snapshot.
                reboot: this.sessionWiring?.reboot ?? null,
                observeDomainEvents: (events) => {
                    // AUT-052: presentation observes the events and asks the (silent) audio service for cues; the runtime knows nothing about audio.
                    for (const cue of mapEventsToCues(events)) this.audio.playSfx(cue);
                    if (isDeviceDiagnosticsEnabled()) this.emitAssemblyBatchEvents(events);
                    this.onTemporaryBoostEvents(events);
                },
                // AUT-051: a Reboot blocked by the pending offline report re-surfaces the card.
                onRebootBlockedByPendingOffline: () => { this.rebootBlockedByPendingOffline = true; this.sessionWiring?.offlineReport.reportRebootBlocked(); this.showOfflineReport('reboot_blocked'); },
            });
            this.pendingBinding = { binding, status: result.startup.status, displayNames: result.configRepository };
        }).catch((error: unknown) => {
            this.reportSessionError('bootstrap', error);
            this.emitSessionState('load_failed', 'bootstrap_error', null, false);
        });
    }

    /**
     * DEBUG / capture-only (AUT-055): reads `debug_ads.json` ONCE, deletes it and returns the allow-listed rewarded-ad script for the mock provider.
     * Guarded by `DEBUG === true` AND enabled device diagnostics, so release builds never read it.
     */
    private readDebugAdsScript(): DebugAdsScript | undefined {
        if (DEBUG !== true || !isDeviceDiagnosticsEnabled()) return undefined;
        try {
            const port = new CocosFileSystemPort();
            const text = port.readText(DEBUG_ADS_FILE);
            if (text === undefined) return undefined;
            port.remove(DEBUG_ADS_FILE);
            const script = parseDebugAdsScriptFile(text);
            emitDeviceEvent('offline_double', { phase: 'script', accepted: script !== null, steps: script?.offlineDouble ?? [], duplicateCallback: script?.duplicateCallback ?? false });
            emitDeviceEvent('extended_overclock', { phase: 'script', accepted: script !== null, steps: script?.extendedOverclock ?? [], duplicateCallback: script?.duplicateCallback ?? false });
            return script ?? undefined;
        } catch (error) {
            this.reportSessionError('debug_ads', error);
            return undefined;
        }
    }

    /**
     * DEBUG / capture-only (AUT-059): reads `debug_purchase.json` ONCE, deletes it and returns the allow-listed purchase script for the mock provider.
     * Guarded by `DEBUG === true` AND enabled device diagnostics, so release builds never read it.
     */
    private readDebugPurchaseScript(): DebugPurchaseScript | undefined {
        if (DEBUG !== true || !isDeviceDiagnosticsEnabled()) return undefined;
        try {
            const port = new CocosFileSystemPort();
            const text = port.readText(DEBUG_PURCHASE_FILE);
            if (text === undefined) return undefined;
            port.remove(DEBUG_PURCHASE_FILE);
            const script = parseDebugPurchaseScriptFile(text);
            emitDeviceEvent('founder_shop', { phase: 'script', accepted: script !== null, price: script?.price ?? null, metadataMissing: script?.metadataMissing ?? false, outcomes: script?.outcomes ?? [], duplicateCallback: script?.duplicateCallback ?? false });
            return script ?? undefined;
        } catch (error) {
            this.reportSessionError('debug_purchase', error);
            return undefined;
        }
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
        // AUT-050: the AI Upgrades panel submits the existing purchasePermanentUpgrade command and observes the result (in-flight guard, failure note).
        wiring.permanentUpgrades.commandEmitter = (command) => binding.submit(command);
        // AUT-RBT-001: the Reboot modal submits the confirmed rebootCivilization command and observes the result (in-flight guard, failure note).
        wiring.reboot.commandEmitter = (command) => binding.submit(command);
        wiring.reboot.consumeBlockedByPendingOffline = () => this.consumeRebootBlockedFlag();
        // AUT-051: the Offline Factory Report card collects through the session (binding), never through a GameCommand.
        wiring.offlineReport.collectEmitter = () => binding.collectOfflineReport();
        wiring.offlineReport.setNameSource(displayNames);
        // AUT-055: the rewarded x2 flow (ad result -> session proof -> atomic collect, all through the binding).
        const offlineAds = this.offlineAds;
        if (offlineAds) {
            wiring.offlineReport.doubleFlow = new OfflineDoubleFlow({
                ads: offlineAds,
                session: {
                    getOfflineDoubleOffer: () => binding.getOfflineDoubleOffer(),
                    collectPendingOfflineWithRewardedBonus: (proof) => binding.collectOfflineReportWithBonus(proof),
                },
                now: () => Date.now(),
                onChange: () => wiring.offlineReport.onDoubleChanged(),
                onDiagnostic: (phase, payload) => emitDeviceEvent('offline_double', { phase, ...payload }),
            });
        }
        // AUT-056: the rewarded Extended Overclock flow (ad result -> session proof -> atomic activation, all through the binding).
        if (offlineAds) {
            const chip = wiring.extendedOverclock;
            chip.flow = new ExtendedOverclockFlow({
                ads: offlineAds,
                session: {
                    getExtendedOverclockOffer: () => binding.getExtendedOverclockOffer(),
                    activateExtendedOverclockWithProof: (proof) => binding.activateExtendedOverclockWithProof(proof),
                },
                now: () => Date.now(),
                onChange: () => chip.onFlowChanged(),
                onDiagnostic: (phase, payload) => emitDeviceEvent('extended_overclock', { phase, ...payload }),
            });
            chip.requestRefresh();
        }
        // AUT-059: the Founder shop flow (store product metadata + purchase result -> session grant, all through the binding). The entry stays hidden without a selling provider.
        const purchases = this.purchases;
        if (purchases) {
            const shop = wiring.founderShop;
            const duplicateCallback = this.debugPurchaseScript?.duplicateCallback === true;
            const flow: FounderShopFlow = new FounderShopFlow({
                purchases,
                session: {
                    getFounderOfferStatus: () => binding.getFounderOfferStatus(),
                    applyFounderPackPurchase: (request) => binding.applyFounderPackPurchase(request),
                    reconcileFounderEntitlement: (report) => binding.reconcileFounderEntitlement(report),
                },
                entitlementSource: this.purchaseSource,
                now: () => Date.now(),
                // AUT-060: the store acknowledge runs ONLY after the flow saw applied_saved / already_applied (grant durable); a failed acknowledge throws so it is logged and retried by the next redelivery.
                acknowledge: typeof purchases.acknowledgePurchase === 'function'
                    ? async (result) => {
                        const acknowledged = await purchases.acknowledgePurchase?.(result);
                        if (acknowledged?.ok !== true) throw new Error(acknowledged?.reason ?? 'acknowledge_failed');
                    }
                    : undefined,
                onChange: () => shop.onFlowChanged(),
                onDiagnostic: (phase, payload) => {
                    emitDeviceEvent('founder_shop', { phase, ...payload });
                    if (phase === 'applied') this.emitFounderState(binding, 'applied');
                    // DEBUG duplicate callback: the store redelivers the same completed purchase right away; the flow must treat it as a no-op.
                    if (phase === 'purchase_result' && duplicateCallback && payload.status === 'completed' && payload.duplicate !== true) {
                        const requestId = String(payload.requestId);
                        const transactionId = typeof payload.transactionId === 'string' ? payload.transactionId : undefined;
                        void Promise.resolve().then(() => flow.deliver({ status: 'completed', productId: PRODUCTS.founderPack, requestId, transactionId }));
                    }
                },
            });
            shop.flow = flow;
            // AUT-060: purchases arriving outside a purchase() call (pending that completes, late result, store redelivery) take the same grant-then-acknowledge path.
            purchases.onPurchaseDelivery?.((result) => { void flow.deliver(result); });
            shop.requestRefresh();
            this.startPurchaseProvider(purchases);
        }
        if (wiring.presentation?.milestonePresentation) wiring.presentation.milestonePresentation.setNameSource(displayNames);
        // AUT-057: initialise the ads provider only now (session ready), never on the startup path; availability never blocks anything.
        if (offlineAds) this.startAdsProvider(offlineAds);
        if (!this.lifecycleHooksRegistered) {
            game.on(Game.EVENT_HIDE, this.onGameHide, this);
            game.on(Game.EVENT_SHOW, this.onGameShow, this);
            this.lifecycleHooksRegistered = true;
        }
        this.emitSessionState('ready', status, null, binding.describe().autoFeederOwned);
        // AUT-055 DEBUG: the persisted Offline Double claim history at session ready (proves a granted claim survived a relaunch).
        if (isDeviceDiagnosticsEnabled()) {
            const claim = binding.getStateSnapshot()?.monetization.rewardedClaims[OFFLINE_DOUBLE_CLAIM_KEY];
            emitDeviceEvent('offline_double', { phase: 'claims', claimCount: claim?.claimCount ?? 0, claimsInWindow: claim?.recentClaimUtcMs.length ?? 0 });
            const extendedClaim = binding.getStateSnapshot()?.monetization.rewardedClaims[EXTENDED_OVERCLOCK_CLAIM_KEY];
            emitDeviceEvent('extended_overclock', { phase: 'claims', claimCount: extendedClaim?.claimCount ?? 0, claimsInWindow: extendedClaim?.recentClaimUtcMs.length ?? 0 });
            this.emitExtendedOverclockHud('session_ready');
        }
        this.emitFounderState(binding, 'session_ready');
        this.showOfflineReport('startup');
        this.runDebugCommandFile(binding);
        // DEBUG-only (emitDeviceEvent is a no-op unless enabled from DEBUG): the restored automation state.
        const payoff = wiring.presentation?.firstAutomationPresentation?.getSnapshot() ?? null;
        emitDeviceEvent('reveal_state', { phase: 'synced', source: 'session', automated: payoff?.activityIndicatorVisible === true, focusRequested: false });
    }

    /**
     * DEBUG / capture-only (AUT-048 follow-up): reads `debug_command.json` ONCE after the session is ready, deletes it, and submits the
     * allow-listed command through the same `binding.submit` path the HUD uses. Guarded by `DEBUG === true` AND enabled device
     * diagnostics, so release builds never read it. No HUD / scene / gameplay path.
     */
    private runDebugCommandFile(binding: FactoryWorldStateBinding): void {
        if (DEBUG !== true || !isDeviceDiagnosticsEnabled()) return;
        try {
            const port = new CocosFileSystemPort();
            const text = port.readText(DEBUG_COMMAND_FILE);
            if (text === undefined) return;
            port.remove(DEBUG_COMMAND_FILE);
            const request = parseDebugCommandFile(text);
            if (!request) { emitDeviceEvent('debug_command', { phase: 'ignored' }); return; }
            emitDeviceEvent('debug_command', { phase: 'scheduled', command: request.command, delayMs: request.delayMs });
            this.scheduleOnce(() => {
                emitDeviceEvent('debug_command', { phase: 'submitted', command: request.command });
                void binding.submit(request.command);
            }, request.delayMs / 1000);
        } catch (error) {
            this.reportSessionError('debug_command', error);
        }
    }

    /**
     * AUT-057: initialises the ads provider (fire and forget) and, while the first ads load, re-reads the availability every 3 s (up to 2 min, stops once
     * both placements are available) so the x2 / Extended actions appear when an ad becomes ready. Later changes are picked up by the existing refresh points.
     */
    /** AUT-059: initialises the purchase provider only once the session is ready (never on the startup path); availability never blocks anything. */
    private startPurchaseProvider(purchases: PurchaseService): void {
        void purchases.initialize().then((state) => {
            emitDeviceEvent('founder_shop', { phase: 'store_initialized', status: state.status, reason: state.reason ?? null });
            this.sessionWiring?.founderShop.requestRefresh();
            // AUT-060: a real store provider redelivers unacknowledged / pending purchases once per start (crash between payment and grant). AUT-061 owns the restore flow proper.
            if (state.status === 'ready' && typeof purchases.onPurchaseDelivery === 'function') {
                void purchases.restorePurchases().then((query) => emitDeviceEvent('founder_shop', { phase: 'store_query', ok: query.ok, status: query.status, reason: query.reason ?? null })).catch(() => undefined);
            }
        }).catch(() => undefined);
    }

    /** AUT-059 DEBUG: the persisted Founder facts (entitlement, cosmetic, grant-once flag, Surge charges) so a capture can prove exactly-once and persistence. */
    private emitFounderState(binding: FactoryWorldStateBinding, reason: string): void {
        if (!isDeviceDiagnosticsEnabled()) return;
        const state = binding.getStateSnapshot();
        if (!state) return;
        emitDeviceEvent('founder_shop', { phase: 'state', reason, owned: isFounderPackOwned(state), cosmetic: isFounderRobotCosmeticOwned(state), grantRecorded: hasFounderSurgeGrantBeenRecorded(state), surgeCharges: getFounderSurgeChargesRemaining(state) });
    }

    private startAdsProvider(ads: AdsService): void {
        if (this.adsProviderStarted) return;
        this.adsProviderStarted = true;
        void ads.initialize().then((state) => {
            emitDeviceEvent('ads_state', { phase: 'initialized', status: state.status, reason: state.reason ?? null });
            if (state.status === 'unavailable' || state.status === 'failed') return;
            let attempts = 0;
            const tick = (): void => {
                attempts += 1;
                void this.pollAdsAvailability(ads).then((allAvailable) => {
                    if (allAvailable || attempts >= 40) this.unschedule(tick);
                });
            };
            this.schedule(tick, 3, 39);
        }).catch(() => undefined);
    }

    private async pollAdsAvailability(ads: AdsService): Promise<boolean> {
        let offlineDouble = false;
        let extended = false;
        try { offlineDouble = (await ads.getRewardedAvailability(OFFLINE_DOUBLE_CLAIM_KEY)).available === true; } catch { offlineDouble = false; }
        try { extended = (await ads.getRewardedAvailability(EXTENDED_OVERCLOCK_CLAIM_KEY)).available === true; } catch { extended = false; }
        const signature = `${offlineDouble}:${extended}`;
        if (signature !== this.adsAvailabilitySignature) {
            this.adsAvailabilitySignature = signature;
            this.sessionWiring?.offlineReport.onAdsAvailabilityChanged();
            this.sessionWiring?.extendedOverclock.requestRefresh();
        }
        return offlineDouble && extended;
    }

    private onGameHide(): void {
        const binding = this.binding;
        if (!binding) return;
        // AUT-057: a rewarded-ad overlay pauses the activity; that is not the player leaving (no suspend, no boost-look stop, no session_state).
        if (this.overlayGate.onHide(this.platformOverlay.classifyBackground() === 'overlay') === 'skip') {
            emitDeviceEvent('ads_state', { phase: 'overlay_hide_skipped' });
            return;
        }
        // AUT-047: the boost look stops at once on background (baseline visuals); the foreground re-syncs it silently from the state.
        this.sessionWiring?.presentation?.boostPresentation?.onBackground();
        void binding.suspend().then((result) => {
            this.emitSessionState('suspended', result?.status ?? 'suspend_error', result?.save.ok ?? false, binding.describe().autoFeederOwned);
        });
    }

    private onGameShow(): void {
        const binding = this.binding;
        if (!binding) return;
        // AUT-057: the one-shot flag (not the tracker, which may already be ended) says this show closes an overlay-induced hide: no resume, no offline report.
        if (this.overlayGate.onShow() === 'skip') {
            emitDeviceEvent('ads_state', { phase: 'overlay_show_skipped' });
            return;
        }
        const result = binding.resume();
        const resumedState = binding.getStateSnapshot();
        if (resumedState) this.sessionWiring?.presentation?.boostPresentation?.resume(resumedState);
        this.emitSessionState('resumed', result?.status ?? 'resume_error', null, binding.describe().autoFeederOwned);
        this.showOfflineReport('resumed');
        // AUT-056: the offer is re-read after a resume (a preview may now be pending, claims may have aged out).
        this.sessionWiring?.extendedOverclock.requestRefresh();
        this.sessionWiring?.founderShop.requestRefresh();
    }

    /** AUT-051: shows / refreshes the Offline Factory Report card from the session's pending preview (a non-collectible preview shows nothing). */
    private showOfflineReport(reason: OfflineReportShowReason): void {
        const binding = this.binding;
        const offlineReport = this.sessionWiring?.offlineReport;
        if (!binding || !offlineReport) return;
        offlineReport.show(binding.getPendingOfflinePreview(), reason);
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

    /** AUT-056: a temporary boost changed (activated / expired / suspended / resumed): re-read the chip offer and report it (DEBUG). */
    private onTemporaryBoostEvents(events: readonly DomainEvent[]): void {
        let changed = false;
        for (const event of events) {
            if (event.type === 'temporaryBoostActivated') {
                changed = true;
                if (isDeviceDiagnosticsEnabled()) emitDeviceEvent('extended_overclock', { phase: 'boost_event', event: 'activated', boostId: event.boostId, multiplier: event.multiplier, durationSeconds: event.durationSeconds, cooldownSeconds: event.cooldownSeconds, source: event.source, requestId: event.requestId });
            }
            else if (event.type === 'temporaryBoostExpired') {
                changed = true;
                if (isDeviceDiagnosticsEnabled()) emitDeviceEvent('extended_overclock', { phase: 'boost_event', event: 'expired', boostId: event.boostId, source: event.source });
            }
            else if (event.type === 'temporaryBoostSuspended') {
                changed = true;
                if (isDeviceDiagnosticsEnabled()) emitDeviceEvent('extended_overclock', { phase: 'boost_event', event: 'suspended', boostId: event.boostId, suspendedByBoostId: event.suspendedByBoostId, remainingSeconds: event.remainingSeconds });
            }
            else if (event.type === 'temporaryBoostResumed') {
                changed = true;
                if (isDeviceDiagnosticsEnabled()) emitDeviceEvent('extended_overclock', { phase: 'boost_event', event: 'resumed', boostId: event.boostId, remainingSeconds: event.remainingSeconds });
            }
        }
        if (!changed) return;
        this.sessionWiring?.extendedOverclock.requestRefresh();
        this.emitExtendedOverclockHud('boost_event');
    }

    /** AUT-056 DEBUG: the Overclock rows' current state (what the HUD shows). */
    private emitExtendedOverclockHud(reason: string): void {
        if (!isDeviceDiagnosticsEnabled()) return;
        const hud = this.sessionWiring?.hud.getOverclockDiagnostic() ?? null;
        if (hud) emitDeviceEvent('extended_overclock', { phase: 'hud', reason, ...hud });
    }

    /** AUT-056 DEBUG: while a boost runs, the HUD countdown is reported every 5 s (proves the timer is ticking). */
    private tickExtendedOverclockHudDiagnostics(deltaTime: number): void {
        if (!isDeviceDiagnosticsEnabled() || !this.binding) return;
        this.extendedHudSeconds += Number.isFinite(deltaTime) && deltaTime > 0 ? deltaTime : 0;
        if (this.extendedHudSeconds < 5) return;
        this.extendedHudSeconds = 0;
        const hud = this.sessionWiring?.hud.getOverclockDiagnostic() ?? null;
        if (hud && hud.state !== 'ready' && hud.state !== 'locked') this.emitExtendedOverclockHud('periodic');
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

    /**
     * AUT-045 era environment: a root per group (hall / vertical / teaser) under `EraEnvironment`, hidden by scale until the era
     * shows them, holding the unlit primitive boxes; the controller adds the structure-high instances from `environmentPrefabs`
     * and recolours the three shell boxes, the camera clear colour and the key light. Presentation only.
     */
    private createEraEnvironment(parent: Node): void {
        const root = parent.getChildByName(ERA_ENV_ROOT_NODE_NAME) ?? new Node(ERA_ENV_ROOT_NODE_NAME);
        root.layer = Layers.Enum.DEFAULT;
        root.parent = parent;
        const visual = root.getComponent(EraEnvironmentVisualController) ?? root.addComponent(EraEnvironmentVisualController);
        visual.environmentPrefabs = this.environmentPrefabs;
        visual.worldCamera = parent.getChildByName('CameraRig')?.getChildByName('WorldCamera')?.getComponent(Camera) ?? null;
        visual.keyLight = parent.getChildByName('NeutralFactoryKeyLight')?.getComponent(DirectionalLight) ?? null;
        for (const group of ERA_ENV_GROUP_IDS) {
            const name = ERA_ENV_GROUP_NODE_NAMES[group];
            const groupNode = root.getChildByName(name) ?? new Node(name);
            groupNode.layer = Layers.Enum.DEFAULT;
            groupNode.parent = root;
            groupNode.setScale(0, 0, 0);
            for (const box of ERA_ENV_BOXES) {
                if (box.group !== group || groupNode.getChildByName(box.id)) continue;
                const color = box.color ?? { r: 128, g: 128, b: 128 };
                this.createBox(groupNode, box.id, new Vec3(box.size.x, box.size.y, box.size.z), new Vec3(box.center.x, box.center.y, box.center.z), new Color(color.r, color.g, color.b, 255));
            }
        }
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
        controller.eraEnvironmentVisual = parent.getChildByName(ERA_ENV_ROOT_NODE_NAME)?.getComponent(EraEnvironmentVisualController) ?? null;
        controller.constructionPresentation = this.createConstructionPresentation(parent, registry);
        controller.robotPopulation = parent.getChildByName('Zone_AssemblyStation')
            ?.getChildByName('AssemblyStation_CompositionAnchor')
            ?.getComponent(RobotPopulationController) ?? null;
        controller.focusAnchors = FACTORY_ZONE_IDS.map((id) => parent.getChildByName(`Zone_${id}`)?.getChildByName(`${id}_FocusAnchor`)).filter((node): node is Node => node !== null && node !== undefined);
        controller.compositionAnchors = FACTORY_ZONE_IDS.map((id) => parent.getChildByName(`Zone_${id}`)?.getChildByName(`${id}_CompositionAnchor`)).filter((node): node is Node => node !== null && node !== undefined);
    }

    /**
     * AUT-046 milestone presentation: a touch-transparent toast band under the HUD (UiSafeArea child, top-anchored below the HUD card),
     * one flat pulse plate per accent (scale 0 at rest) and the wiring to the AUT-040 spark pool, the focus anchors and the camera.
     * Runs after createUiRoot(). Presentation only.
     */
    private createMilestonePresentation(site: Node): void {
        const registry = site.getChildByName('PresentationAnchors');
        const presentation = registry?.getComponent(PresentationController) ?? null;
        if (!registry || !presentation) return;
        const container = this.uiSafeArea();
        const toast = container.getChildByName('MilestoneToast') ?? new Node('MilestoneToast');
        toast.parent = container;
        toast.layer = Layers.Enum.UI_2D;
        toast.getComponent(UITransform) ?? toast.addComponent(UITransform);
        const widget = toast.getComponent(Widget) ?? toast.addComponent(Widget);
        widget.isAlignTop = true;
        widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = false;
        widget.isAlignHorizontalCenter = true;
        widget.horizontalCenter = 0;
        widget.top = milestoneToastTopOffset();
        widget.alignMode = Widget.AlignMode.ALWAYS;
        const controller = toast.getComponent(MilestonePresentationController) ?? toast.addComponent(MilestonePresentationController);
        controller.cameraController = this.cameraController();
        controller.construction = presentation.constructionPresentation;
        controller.resolveProducerAnchor = (producerId) => {
            const zone = producerZoneName(producerId);
            return zone === null ? null : site.getChildByName(`Zone_${zone}`)?.getChildByName(`${zone}_FocusAnchor`) ?? null;
        };
        for (const accent of ['amber', 'cyan'] as const) {
            const rgb = MILESTONE_ACCENT_RGB[accent];
            const plateName = `MilestonePulse_${accent}`;
            // Thin outline ring: a root at the origin (hidden by scale) holding 4 unit boxes the controller sizes per producer footprint.
            const plate = site.getChildByName(plateName) ?? new Node(plateName);
            plate.layer = Layers.Enum.DEFAULT;
            plate.parent = site;
            for (let index = 0; index < 4; index += 1) {
                if (!plate.getChildByName(`${plateName}_Bar${index}`)) this.createBox(plate, `${plateName}_Bar${index}`, new Vec3(1, 1, 1), new Vec3(0, 0, 0), new Color(rgb.r, rgb.g, rgb.b, 255));
            }
            plate.setScale(0, 0, 0);
            controller.pulsePlates[accent] = plate;
        }
        presentation.milestonePresentation = controller;
    }

    /**
     * AUT-047 temporary boost (Overclock) presentation: one controller node under the site, its own amber outline ring plate (4 flat opaque
     * bars, scale 0 at rest, sized per footprint by the controller) and the wiring to the AUT-040 spark pool and the zone focus anchors
     * (`Zone_X/X_FocusAnchor`). Nothing runs while no boost is active. Presentation only.
     */
    private createBoostPresentation(site: Node): void {
        const registry = site.getChildByName('PresentationAnchors');
        const presentation = registry?.getComponent(PresentationController) ?? null;
        if (!registry || !presentation) return;
        const node = site.getChildByName('BoostPresentation') ?? new Node('BoostPresentation');
        node.parent = site;
        const controller = node.getComponent(BoostPresentationController) ?? node.addComponent(BoostPresentationController);
        controller.construction = presentation.constructionPresentation;
        controller.resolveProducerAnchor = (producerId) => {
            const zone = producerZoneName(producerId);
            return zone === null ? null : site.getChildByName(`Zone_${zone}`)?.getChildByName(`${zone}_FocusAnchor`) ?? null;
        };
        const rgb = MILESTONE_ACCENT_RGB.amber;
        const plate = site.getChildByName('BoostPulse_amber') ?? new Node('BoostPulse_amber');
        plate.layer = Layers.Enum.DEFAULT;
        plate.parent = site;
        for (let index = 0; index < 4; index += 1) {
            if (!plate.getChildByName(`BoostPulse_amber_Bar${index}`)) this.createBox(plate, `BoostPulse_amber_Bar${index}`, new Vec3(1, 1, 1), new Vec3(0, 0, 0), new Color(rgb.r, rgb.g, rgb.b, 255));
        }
        plate.setScale(0, 0, 0);
        controller.pulsePlate = plate;
        presentation.boostPresentation = controller;
    }

    /**
     * AUT-049 Reboot world presentation: one controller node under the site, a thin cyan scan ring (4 opaque outline bars, scale 0 at rest),
     * the relay socket (graphite base + pedestal + thin cyan outline + the placeholder AI Core cube, all primitive boxes, scale 0 at rest)
     * and the Fabricator focus anchor for the one camera beat. The Core is intentionally simple and temporary (no asset). Presentation only.
     */
    private createRebootPresentation(site: Node): void {
        const registry = site.getChildByName('PresentationAnchors');
        const presentation = registry?.getComponent(PresentationController) ?? null;
        if (!registry || !presentation) return;
        const node = site.getChildByName('RebootPresentation') ?? new Node('RebootPresentation');
        node.parent = site;
        const controller = node.getComponent(RebootPresentationController) ?? node.addComponent(RebootPresentationController);
        controller.cameraController = this.cameraController();
        controller.resolveProducerAnchor = (producerId) => {
            const zone = producerZoneName(producerId);
            return zone === null ? null : site.getChildByName(`Zone_${zone}`)?.getChildByName(`${zone}_FocusAnchor`) ?? null;
        };
        const colors = REBOOT_SOCKET.colors;
        const scan = site.getChildByName('RebootScan') ?? new Node('RebootScan');
        scan.layer = Layers.Enum.DEFAULT;
        scan.parent = site;
        for (let index = 0; index < 4; index += 1) {
            if (!scan.getChildByName(`RebootScan_Bar${index}`)) this.createBox(scan, `RebootScan_Bar${index}`, new Vec3(1, 1, 1), new Vec3(0, 0, 0), new Color(colors.scan.r, colors.scan.g, colors.scan.b, 255));
        }
        scan.setScale(0, 0, 0);
        controller.scanPlate = scan;
        let socket = site.getChildByName('RebootSocket');
        if (!socket) {
            socket = new Node('RebootSocket');
            socket.layer = Layers.Enum.DEFAULT;
            socket.parent = site;
            socket.setPosition(REBOOT_SOCKET.x, 0, REBOOT_SOCKET.z);
            const { base, pedestal, ring } = REBOOT_SOCKET;
            this.createBox(socket, 'RebootSocket_Base', new Vec3(base.sizeX, base.sizeY, base.sizeZ), new Vec3(0, base.y, 0), new Color(colors.base.r, colors.base.g, colors.base.b, 255));
            this.createBox(socket, 'RebootSocket_Pedestal', new Vec3(pedestal.sizeX, pedestal.sizeY, pedestal.sizeZ), new Vec3(0, pedestal.y, 0), new Color(colors.pedestal.r, colors.pedestal.g, colors.pedestal.b, 255));
            socketRingBars().forEach((bar, index) => {
                this.createBox(socket!, `RebootSocket_Ring${index}`, new Vec3(bar.sizeX, ring.height, bar.sizeZ), new Vec3(bar.x, ring.y, bar.z), new Color(colors.ring.r, colors.ring.g, colors.ring.b, 255));
            });
            // Placeholder AI Core: a unit cube balanced on a vertex, sized by the controller (hidden at scale 0).
            const core = this.createBox(socket, 'RebootCore', new Vec3(1, 1, 1), new Vec3(0, 0.6, 0), new Color(colors.core.r, colors.core.g, colors.core.b, 255));
            core.setRotationFromEuler(REBOOT_CORE_EULER_DEG.x, REBOOT_CORE_EULER_DEG.y, REBOOT_CORE_EULER_DEG.z);
            core.setScale(0, 0, 0);
            socket.setScale(0, 0, 0);
        }
        controller.socketRoot = socket;
        controller.coreNode = socket.getChildByName('RebootCore');
        presentation.rebootPresentation = controller;
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

    /**
     * AUT-051 Offline Factory Report: a full-screen root as the LAST child of the Canvas (above the HUD, the panel and the toast band), holding the
     * full-screen dim backdrop and a safe-area container the controller builds the card in. Hidden by scale (0) until a collectible report exists.
     */
    private createOfflineReport(): OfflineReportController {
        const canvas = this.node.getChildByName('CoreHudCanvas');
        if (!canvas) throw new Error('createUiRoot() must run before the offline report is built.');
        const stretched = (parent: Node, name: string): Node => {
            const node = parent.getChildByName(name) ?? new Node(name);
            node.parent = parent;
            node.layer = Layers.Enum.UI_2D;
            node.getComponent(UITransform) ?? node.addComponent(UITransform);
            this.stretchWidget(node.getComponent(Widget) ?? node.addComponent(Widget));
            return node;
        };
        const root = stretched(canvas, 'OfflineReport');
        const backdrop = stretched(root, 'OfflineBackdrop');
        const safe = stretched(root, 'OfflineSafeArea');
        safe.getComponent(SafeArea) ?? safe.addComponent(SafeArea);
        const controller = root.getComponent(OfflineReportController) ?? root.addComponent(OfflineReportController);
        controller.backdropNode = backdrop;
        controller.safeNode = safe;
        controller.screenRectOf = (node) => this.uiScreenRect(node);
        controller.onLayoutChanged = (reason) => this.scheduleUiLayoutDiagnostics(reason);
        return controller;
    }

    /**
     * AUT-050 AI Upgrades: a full-screen root (below the offline report root) holding the dim backdrop and a safe-area container for the
     * panel card; the entry chip is built by the controller under the HUD safe-area container. Hidden by scale (0) until opened.
     */
    private createPermanentUpgrades(): PermanentUpgradeController {
        const canvas = this.node.getChildByName('CoreHudCanvas');
        if (!canvas) throw new Error('createUiRoot() must run before the permanent upgrade panel is built.');
        const stretched = (parent: Node, name: string): Node => {
            const node = parent.getChildByName(name) ?? new Node(name);
            node.parent = parent;
            node.layer = Layers.Enum.UI_2D;
            node.getComponent(UITransform) ?? node.addComponent(UITransform);
            this.stretchWidget(node.getComponent(Widget) ?? node.addComponent(Widget));
            return node;
        };
        const root = stretched(canvas, 'PermanentUpgrades');
        const backdrop = stretched(root, 'PermanentUpgradesBackdrop');
        const safe = stretched(root, 'PermanentUpgradesSafeArea');
        safe.getComponent(SafeArea) ?? safe.addComponent(SafeArea);
        const controller = root.getComponent(PermanentUpgradeController) ?? root.addComponent(PermanentUpgradeController);
        controller.backdropNode = backdrop;
        controller.safeNode = safe;
        controller.chipHost = this.uiSafeArea();
        controller.screenRectOf = (node) => this.uiScreenRect(node);
        controller.onLayoutChanged = (reason) => this.scheduleUiLayoutDiagnostics(reason);
        return controller;
    }

    /**
     * AUT-052 Settings: a full-screen root (below the offline report root) holding the dim backdrop and a safe-area container for the card;
     * the entry chip is built by the controller under the HUD safe-area container, left-aligned under the HUD. Hidden by scale until opened.
     */
    private createSettings(): SettingsController {
        const canvas = this.node.getChildByName('CoreHudCanvas');
        if (!canvas) throw new Error('createUiRoot() must run before the settings panel is built.');
        const stretched = (parent: Node, name: string): Node => {
            const node = parent.getChildByName(name) ?? new Node(name);
            node.parent = parent;
            node.layer = Layers.Enum.UI_2D;
            node.getComponent(UITransform) ?? node.addComponent(UITransform);
            this.stretchWidget(node.getComponent(Widget) ?? node.addComponent(Widget));
            return node;
        };
        const root = stretched(canvas, 'Settings');
        const backdrop = stretched(root, 'SettingsBackdrop');
        const safe = stretched(root, 'SettingsSafeArea');
        safe.getComponent(SafeArea) ?? safe.addComponent(SafeArea);
        const controller = root.getComponent(SettingsController) ?? root.addComponent(SettingsController);
        controller.backdropNode = backdrop;
        controller.safeNode = safe;
        controller.chipHost = this.uiSafeArea();
        controller.settingsStore = this.settingsStore;
        controller.screenRectOf = (node) => this.uiScreenRect(node);
        controller.onLayoutChanged = (reason) => this.scheduleUiLayoutDiagnostics(reason);
        controller.missingTextCount = () => this.missingTextReports;
        controller.refresh();
        return controller;
    }

    /**
     * AUT-056 Extended Overclock: a small host node under the Canvas (below the offline report root) for the controller; the chip itself is
     * built by the controller under the HUD safe-area container, on the second line under the HUD band, left-aligned. Hidden by scale.
     */
    private createExtendedOverclock(): ExtendedOverclockController {
        const canvas = this.node.getChildByName('CoreHudCanvas');
        if (!canvas) throw new Error('createUiRoot() must run before the Extended Overclock chip is built.');
        const root = canvas.getChildByName('ExtendedOverclock') ?? new Node('ExtendedOverclock');
        root.parent = canvas;
        root.layer = Layers.Enum.UI_2D;
        const controller = root.getComponent(ExtendedOverclockController) ?? root.addComponent(ExtendedOverclockController);
        controller.chipHost = this.uiSafeArea();
        controller.screenRectOf = (node) => this.uiScreenRect(node);
        controller.onLayoutChanged = (reason) => this.scheduleUiLayoutDiagnostics(reason);
        return controller;
    }

    /**
     * AUT-059 Founder's Pack: a full-screen root (below the offline report root) holding the dim backdrop and a safe-area container for the modal;
     * the entry chip is built by the controller under the HUD safe-area container, on the third line under the HUD band, right-aligned. Hidden by scale.
     */
    private createFounderShop(): FounderShopController {
        const canvas = this.node.getChildByName('CoreHudCanvas');
        if (!canvas) throw new Error('createUiRoot() must run before the Founder shop is built.');
        const stretched = (parent: Node, name: string): Node => {
            const node = parent.getChildByName(name) ?? new Node(name);
            node.parent = parent;
            node.layer = Layers.Enum.UI_2D;
            node.getComponent(UITransform) ?? node.addComponent(UITransform);
            this.stretchWidget(node.getComponent(Widget) ?? node.addComponent(Widget));
            return node;
        };
        const root = stretched(canvas, 'FounderShop');
        const backdrop = stretched(root, 'FounderShopBackdrop');
        const safe = stretched(root, 'FounderShopSafeArea');
        safe.getComponent(SafeArea) ?? safe.addComponent(SafeArea);
        const controller = root.getComponent(FounderShopController) ?? root.addComponent(FounderShopController);
        controller.backdropNode = backdrop;
        controller.safeNode = safe;
        controller.chipHost = this.uiSafeArea();
        controller.screenRectOf = (node) => this.uiScreenRect(node);
        controller.onLayoutChanged = (reason) => this.scheduleUiLayoutDiagnostics(reason);
        return controller;
    }

    /**
     * AUT-RBT-001 Reboot: a full-screen root (below the offline report root) holding the dim backdrop and a safe-area container for the modal;
     * the entry chip is built by the controller under the HUD safe-area container, on the second line under the HUD band. Hidden by scale.
     */
    private createReboot(): RebootController {
        const canvas = this.node.getChildByName('CoreHudCanvas');
        if (!canvas) throw new Error('createUiRoot() must run before the Reboot modal is built.');
        const stretched = (parent: Node, name: string): Node => {
            const node = parent.getChildByName(name) ?? new Node(name);
            node.parent = parent;
            node.layer = Layers.Enum.UI_2D;
            node.getComponent(UITransform) ?? node.addComponent(UITransform);
            this.stretchWidget(node.getComponent(Widget) ?? node.addComponent(Widget));
            return node;
        };
        const root = stretched(canvas, 'Reboot');
        const backdrop = stretched(root, 'RebootBackdrop');
        const safe = stretched(root, 'RebootSafeArea');
        safe.getComponent(SafeArea) ?? safe.addComponent(SafeArea);
        const controller = root.getComponent(RebootController) ?? root.addComponent(RebootController);
        controller.backdropNode = backdrop;
        controller.safeNode = safe;
        controller.chipHost = this.uiSafeArea();
        controller.screenRectOf = (node) => this.uiScreenRect(node);
        controller.onLayoutChanged = (reason) => this.scheduleUiLayoutDiagnostics(reason);
        return controller;
    }

    /**
     * AUT-052: loads `settings.json` (synchronously, contained: a failure gives the defaults) and applies it to the audio / haptics services.
     * Later changes made by the Settings panel go through `SettingsStore.update`, and this subscription applies them.
     */
    private loadUserSettings(): void {
        const catalogue = getDefaultTextCatalogue();
        catalogue.setMissingTextSink((report: MissingTextReport) => {
            this.missingTextReports += 1;
            if (isDeviceDiagnosticsEnabled() && this.missingTextReports <= 5) emitDeviceEvent('settings', { phase: 'missing_text', report, missingText: this.missingTextReports });
        });
        try {
            const store = new SettingsStore(new CocosFileSystemPort(), (event) => this.reportSettingsEvent(event));
            this.settingsStore = store;
            this.applyUserSettings(store.load());
            store.subscribe((settings) => this.applyUserSettings(settings));
        } catch (error) {
            // No usable file port: the defaults stay (audio / haptics already default to on) and the chip is simply not offered.
            this.reportSessionError('settings', error);
        }
    }

    private applyUserSettings(settings: UserSettings): void {
        this.audio.applySettings({ musicEnabled: settings.musicEnabled, sfxEnabled: settings.sfxEnabled });
        this.haptics.setEnabled(settings.vibrationEnabled);
    }

    private reportSettingsEvent(event: SettingsEvent): void {
        if (!isDeviceDiagnosticsEnabled()) return;
        const settings = this.settingsStore?.get() ?? null;
        const values = settings ? { musicEnabled: settings.musicEnabled, sfxEnabled: settings.sfxEnabled, vibrationEnabled: settings.vibrationEnabled, language: settings.language } : null;
        if (event.kind === 'loaded') emitDeviceEvent('settings', { phase: 'loaded', source: event.source, settings: values, missingText: this.missingTextReports });
        else if (event.kind === 'saved') emitDeviceEvent('settings', { phase: 'saved', settings: values });
        else emitDeviceEvent('settings', { phase: event.kind, message: event.message, settings: values });
    }

    /** AUT-052: the Settings chip is hidden and inert while the offline report card or the Reboot title card is up. */
    private updateSettingsSuppression(): void {
        const wiring = this.sessionWiring;
        if (!wiring) return;
        const rebootCard = wiring.presentation?.milestonePresentation?.isRebootCardActive() === true;
        wiring.settings.setSuppressed(wiring.offlineReport.isVisible() || rebootCard);
        // AUT-RBT-001: the Reboot chip is hidden (and an idle modal closed) while the offline report card or the Reboot title card is up.
        wiring.reboot.setSuppressed(wiring.offlineReport.isVisible() || rebootCard);
        // AUT-056: the Extended Overclock chip follows the same suppression (it also stays hidden while the offline preview is pending).
        wiring.extendedOverclock.setSuppressed(wiring.offlineReport.isVisible() || rebootCard);
        // AUT-059: the Founder chip follows the same suppression (modal closed, chip hidden) and cannot open while Settings / AI Upgrades / Reboot is open.
        wiring.founderShop.setSuppressed(wiring.offlineReport.isVisible() || rebootCard);
        wiring.founderShop.setModalBlocked(wiring.settings.isOpen() || wiring.permanentUpgrades.isOpen() || wiring.reboot.isOpen());
    }

    /** AUT-RBT-001: true once after the binding reported a Reboot blocked by the pending offline report (then cleared). */
    private consumeRebootBlockedFlag(): boolean {
        const blocked = this.rebootBlockedByPendingOffline;
        this.rebootBlockedByPendingOffline = false;
        return blocked;
    }

    /** DEBUG: screen rectangle (bottom-left frame) of a UI node through the UI camera. */
    private uiScreenRect(node: Node): UiRect | null {
        const uiCamera = this.node.getChildByName('CoreHudCanvas')?.getChildByName('UICamera')?.getComponent(Camera) ?? null;
        const box = node.getComponent(UITransform)?.getBoundingBoxToWorld();
        if (!uiCamera || !box) return null;
        const a = uiCamera.worldToScreen(new Vec3(box.xMin, box.yMin, 0), new Vec3());
        const b = uiCamera.worldToScreen(new Vec3(box.xMax, box.yMax, 0), new Vec3());
        return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
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
        // AUT-051: the Offline Factory Report card and its COLLECT Button, only while the card is shown (null otherwise).
        const offlineNodes = this.sessionWiring?.offlineReport.getRectNodes() ?? null;
        rects.OfflineReportCard = offlineNodes?.card ? rectOf(offlineNodes.card) : null;
        rects.OfflineReportCollect = offlineNodes?.collect ? rectOf(offlineNodes.collect) : null;
        // AUT-055: the COLLECT x2 action, only while offered (null otherwise).
        rects.OfflineReportDouble = offlineNodes?.double ? rectOf(offlineNodes.double) : null;
        // AUT-050: the AI Upgrades chip, panel, tabs, CLOSE and buy buttons, only while shown / open (null otherwise).
        const upgradeNodes = this.sessionWiring?.permanentUpgrades.getRectNodes() ?? null;
        rects.PermanentUpgradeChip = upgradeNodes?.chip ? rectOf(upgradeNodes.chip) : null;
        rects.PermanentUpgradePanel = upgradeNodes?.panel ? rectOf(upgradeNodes.panel) : null;
        rects.PermanentUpgradeClose = upgradeNodes?.close ? rectOf(upgradeNodes.close) : null;
        upgradeNodes?.tabs.forEach((node, index) => { rects[`PermanentUpgradeTab${index}`] = node ? rectOf(node) : null; });
        upgradeNodes?.buys.forEach((node, index) => { rects[`PermanentUpgradeBuy${index}`] = node ? rectOf(node) : null; });
        // AUT-052: the Settings chip, panel, rows and CLOSE, only while shown / open (null otherwise).
        const settingsNodes = this.sessionWiring?.settings.getRectNodes() ?? null;
        rects.SettingsChip = settingsNodes?.chip ? rectOf(settingsNodes.chip) : null;
        rects.SettingsPanel = settingsNodes?.panel ? rectOf(settingsNodes.panel) : null;
        rects.SettingsClose = settingsNodes?.close ? rectOf(settingsNodes.close) : null;
        settingsNodes?.rows.forEach((node, index) => { rects[`SettingsRow${index}`] = node ? rectOf(node) : null; });
        // AUT-056: the Extended Overclock chip, only while shown (null otherwise).
        const extendedNode = this.sessionWiring?.extendedOverclock.getRectNode() ?? null;
        rects.ExtendedOverclockAction = extendedNode ? rectOf(extendedNode) : null;
        // AUT-059: the Founder chip, modal, BUY and CLOSE, only while shown / open (null otherwise).
        const founderNodes = this.sessionWiring?.founderShop.getRectNodes() ?? null;
        rects.FounderChip = founderNodes?.chip ? rectOf(founderNodes.chip) : null;
        rects.FounderPanel = founderNodes?.panel ? rectOf(founderNodes.panel) : null;
        rects.FounderBuy = founderNodes?.buy ? rectOf(founderNodes.buy) : null;
        rects.FounderClose = founderNodes?.close ? rectOf(founderNodes.close) : null;
        // AUT-RBT-001: the Reboot chip, modal, REBOOT and CANCEL, only while shown / open (null otherwise).
        const rebootNodes = this.sessionWiring?.reboot.getRectNodes() ?? null;
        rects.RebootChip = rebootNodes?.chip ? rectOf(rebootNodes.chip) : null;
        rects.RebootPanel = rebootNodes?.panel ? rectOf(rebootNodes.panel) : null;
        rects.RebootConfirm = rebootNodes?.confirm ? rectOf(rebootNodes.confirm) : null;
        rects.RebootCancel = rebootNodes?.cancel ? rectOf(rebootNodes.cancel) : null;
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
