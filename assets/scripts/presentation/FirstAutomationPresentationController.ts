import { _decorator, Component, Node } from 'cc';
import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import { MobileCameraController } from '../camera/MobileCameraController';
import { AutomationPayoffViewModel } from './AutomationPayoffViewModel.ts';
import type { AutomationPayoffSnapshot } from './AutomationPayoffViewModel.ts';
import { FabricatorVisualController } from './FabricatorVisualController';
import { emitDeviceEvent, isDeviceDiagnosticsEnabled } from './DeviceDiagnostics';

const { ccclass, property } = _decorator;

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

    public onLoad(): void {
        this.fabricatorVisual ??=
            this.node.getComponent(FabricatorVisualController);

        this.activityIndicator =
            this.fabricatorVisual?.getModuleNode(
                'autonomous_cycle_indicator',
            ) ?? null;
    }

    public start(): void {
        // AUT-INFRA-001a: nothing is scheduled at start; the presentation stays at rest until a runtime focus beat.
        if (isDeviceDiagnosticsEnabled()) {
            emitDeviceEvent('reveal_state', { phase: 'idle', source: 'none', automated: this.activityIndicatorVisible });
        }
    }

    public sync(state: GameState): AutomationPayoffSnapshot {
        return this.syncFromGameState(state);
    }

    public syncFromGameState(state: GameState): AutomationPayoffSnapshot {
        this.snapshotValue = this.viewModel.syncFromState(state);
        this.applySnapshot(state);

        return this.snapshotValue;
    }

    public consumeDomainEvents(
        state: GameState,
        events: readonly DomainEvent[],
    ): AutomationPayoffSnapshot {
        this.snapshotValue =
            this.viewModel.consumeEvents(state, events);

        this.applySnapshot(state);

        if (this.snapshotValue.focusBeatRequested) {
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

        const visible =
            this.snapshotValue?.activityIndicatorVisible === true;

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

    private requestBoundedFocus(): void {
        const target = this.focusAnchor?.worldPosition;

        if (!target || !this.cameraController) {
            this.emitRevealStarted('runtime', false);
            return;
        }

        this.cameraController.focusOnRevealTarget(target);
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
