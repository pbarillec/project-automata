import { _decorator, Component, Node } from 'cc';
import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import { MobileCameraController } from '../camera/MobileCameraController';
import { AutomationPayoffViewModel } from './AutomationPayoffViewModel.ts';
import type { AutomationPayoffSnapshot } from './AutomationPayoffViewModel.ts';
import { FabricatorVisualController } from './FabricatorVisualController';
import { emitDeviceEvent, isDeviceDiagnosticsEnabled } from './DeviceDiagnostics';

const { ccclass, property } = _decorator;

const HUMAN_GATE_ENABLED = true;
const HUMAN_GATE_AUTOMATION_DELAY_SECONDS = 6;
const AUTOMATION_INDICATOR_SCALE = 0.2;
const AUTOMATION_INDICATOR_PULSE_AMOUNT = 0.03;

/** Presentation-only Auto Feeder reveal and feedback bridge. */
@ccclass('FirstAutomationPresentationController')
export class FirstAutomationPresentationController extends Component {
    @property(FabricatorVisualController)
    public fabricatorVisual: FabricatorVisualController | null = null;

    @property(MobileCameraController)
    public cameraController: MobileCameraController | null = null;

    @property(Node)
    public focusAnchor: Node | null = null;

    private readonly viewModel = new AutomationPayoffViewModel();
    private activityIndicator: Node | null = null;
    private activityTime = 0;
    private snapshotValue: AutomationPayoffSnapshot | null = null;

    private activityIndicatorVisible = false;
    // AUT-INFRA-001a: a started reveal waits for its camera focus to finish before reporting `complete`.
    private diagnosticsRevealAwaitingFocus: { source: string } | null = null;

    // TEMP AUT-038 human-gate harness state.
    private humanGateState: GameState | null = null;
    private humanGateAutomated = false;
    private humanGateStarted = false;

    public onLoad(): void {
        this.fabricatorVisual ??=
            this.node.getComponent(FabricatorVisualController);

        this.activityIndicator =
            this.fabricatorVisual?.getModuleNode(
                'autonomous_cycle_indicator',
            ) ?? null;
    }

    public start(): void {
        // AUT-INFRA-001a: announce whether a reveal is scheduled (pending) or the presentation is at rest (idle).
        if (isDeviceDiagnosticsEnabled()) {
            const scheduled = HUMAN_GATE_ENABLED && this.fabricatorVisual !== null;
            emitDeviceEvent('reveal_state', { phase: scheduled ? 'pending' : 'idle', source: scheduled ? 'human_gate' : 'none', automated: this.activityIndicatorVisible });
        }
        if (!HUMAN_GATE_ENABLED || !this.fabricatorVisual) return;

        this.humanGateStarted = true;
        this.humanGateAutomated = false;

        this.fabricatorVisual.debugSetVisibleModules([
            'base_compact_press',
            'simple_output_tray',
            'secondary_module',
            'strong_status_indicator',
        ]);

        this.setActivityIndicatorVisible(false);

        console.log('[AUT-038-HG] MANUAL');

        this.scheduleOnce(() => {
            this.applyHumanGateAutomation();
        }, HUMAN_GATE_AUTOMATION_DELAY_SECONDS);
    }

    public sync(state: GameState): AutomationPayoffSnapshot {
        return this.syncFromGameState(state);
    }

    public syncFromGameState(state: GameState): AutomationPayoffSnapshot {
        this.humanGateState = state;

        if (HUMAN_GATE_ENABLED) {
            this.ensureHumanGateStarted();
        }

        this.snapshotValue = this.viewModel.syncFromState(state);
        this.applySnapshot(state);

        return this.snapshotValue;
    }

    public consumeDomainEvents(
        state: GameState,
        events: readonly DomainEvent[],
    ): AutomationPayoffSnapshot {
        this.humanGateState = state;

        if (HUMAN_GATE_ENABLED) {
            this.ensureHumanGateStarted();
        }

        this.snapshotValue =
            this.viewModel.consumeEvents(state, events);

        this.applySnapshot(state);

        if (
            !HUMAN_GATE_ENABLED &&
            this.snapshotValue.focusBeatRequested
        ) {
            this.requestBoundedFocus();
        }

        return this.snapshotValue;
    }

    public getSnapshot(): AutomationPayoffSnapshot | null {
        return this.snapshotValue;
    }

    public interruptFocus(): void {
        this.viewModel.interruptFocusBeat();
    }

    public update(deltaSeconds: number): void {
        if (this.diagnosticsRevealAwaitingFocus && this.cameraController?.isFocusTransitionActive() !== true) {
            this.emitRevealComplete(this.diagnosticsRevealAwaitingFocus.source, true, 'focus_finished');
        }
        if (!this.activityIndicator || !this.activityIndicatorVisible) return;

        this.activityTime += deltaSeconds;

        const pulse = 1 + Math.sin(this.activityTime * 5)
            * AUTOMATION_INDICATOR_PULSE_AMOUNT;

        const indicatorScale = AUTOMATION_INDICATOR_SCALE * pulse;
        this.activityIndicator.setScale(
            indicatorScale,
            indicatorScale,
            indicatorScale,
        );
    }

    private applySnapshot(state: GameState): void {
        this.fabricatorVisual?.syncFromGameState(state);

        this.activityIndicator ??=
            this.fabricatorVisual?.getModuleNode(
                'autonomous_cycle_indicator',
            ) ?? null;

        const visible = HUMAN_GATE_ENABLED
            ? this.humanGateAutomated
            : this.snapshotValue?.activityIndicatorVisible === true;

        this.setActivityIndicatorVisible(visible);
    }

    /** AUT-INFRA-001a: a reveal began; `complete` follows once its focus ends (or now, if no focus was requested). */
    private emitRevealStarted(source: string, focusRequested: boolean): void {
        if (!isDeviceDiagnosticsEnabled()) return;
        emitDeviceEvent('reveal_state', { phase: 'started', source, automated: this.activityIndicatorVisible, focusRequested });
        if (focusRequested) this.diagnosticsRevealAwaitingFocus = { source };
        else this.emitRevealComplete(source, false, 'no_focus');
    }

    private emitRevealComplete(source: string, focusRequested: boolean, reason: string): void {
        this.diagnosticsRevealAwaitingFocus = null;
        emitDeviceEvent('reveal_state', { phase: 'complete', source, automated: this.activityIndicatorVisible, focusRequested, reason });
    }

    private setActivityIndicatorVisible(visible: boolean): void {
        if (!this.activityIndicator) return;

        this.activityIndicatorVisible = visible;

        if (!visible) {
            this.activityIndicator.setScale(0, 0, 0);
        } else {
            this.activityIndicator.setScale(
                AUTOMATION_INDICATOR_SCALE,
                AUTOMATION_INDICATOR_SCALE,
                AUTOMATION_INDICATOR_SCALE,
            );
        }
    }

    private ensureHumanGateStarted(): void {
        // Human-gate harness is started directly from the Cocos lifecycle.

        // if (this.humanGateStarted) return;

        // this.humanGateStarted = true;
        // this.humanGateAutomated = false;

        // this.fabricatorVisual?.forceDebugState('lv10');

        // if (this.humanGateState) {
        //     this.fabricatorVisual?.applyCurrentDebugState(
        //         this.humanGateState,
        //     );
        // }

        // this.setActivityIndicatorVisible(false);

        // console.log('[AUT-038-HG] MANUAL');

        // this.scheduleOnce(() => {
        //     this.applyHumanGateAutomation();
        // }, HUMAN_GATE_AUTOMATION_DELAY_SECONDS);
    }

    private applyHumanGateAutomation(): void {
        if (!this.fabricatorVisual) {
            console.warn(
                '[AUT-038-HG] AUTOMATED skipped: presentation unavailable',
            );
            this.emitRevealStarted('human_gate', false);
            return;
        }

        this.humanGateAutomated = true;

        this.fabricatorVisual.debugSetVisibleModules([
            'base_compact_press',
            'simple_output_tray',
            'secondary_module',
            'strong_status_indicator',
            'auto_feeder_hopper',
            'input_conveyor',
            'autonomous_cycle_indicator',
        ]);

        this.activityIndicator ??=
            this.fabricatorVisual.getModuleNode(
                'autonomous_cycle_indicator',
            );

        this.setActivityIndicatorVisible(true);

        console.log('[AUT-038-HG] AUTOMATED');

        this.requestHumanGateFocus();
    }

    private requestHumanGateFocus(): void {
        const target = this.focusAnchor?.worldPosition;

        if (!target || !this.cameraController) {
            console.warn(
                '[AUT-038-HG] FOCUS_REQUESTED skipped: camera or anchor unavailable',
            );
            this.emitRevealStarted('human_gate', false);
            return;
        }

        console.log('[AUT-038-HG] FOCUS_REQUESTED');

        this.cameraController.focusOnWorldTarget(target);
        this.emitRevealStarted('human_gate', true);
    }

    private requestBoundedFocus(): void {
        const target = this.focusAnchor?.worldPosition;

        if (!target || !this.cameraController) {
            this.emitRevealStarted('runtime', false);
            return;
        }

        this.cameraController.focusOnWorldTarget(target);
        this.emitRevealStarted('runtime', true);
        this.viewModel.acknowledgeFocusBeat();

        if (this.snapshotValue) {
            this.snapshotValue = {
                ...this.snapshotValue,
                focusBeatRequested: false,
            };
        }
    }
}
