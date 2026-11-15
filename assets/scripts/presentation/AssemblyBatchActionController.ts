import { _decorator, Button, Color, Component, EventHandler, Label, Layers, Node, UITransform, Vec3 } from 'cc';
import type { GameCommand } from '../domain/Commands.ts';
import type { AssemblyBatchViewModel } from './AssemblyBatchViewModel.ts';
import { emitDeviceEvent, isDeviceDiagnosticsEnabled } from './DeviceDiagnostics';
import { fitLabel } from './LabelFit.ts';
import { formatAssemblyBatchText } from './PresentationText.ts';
import { PRODUCER_PANEL_LAYOUT, cardActionRect, cardPrimaryActionSplitRects } from './UiLayout.ts';

const { ccclass } = _decorator;
export type AssemblyBatchCommandEmitter = (command: GameCommand) => void;

/**
 * AUT-GP-001 thin controller of the Assembly batch Button (bottom thumb zone, on the Producer Panel card).
 * It renders `AssemblyBatchViewModel` snapshots and emits `launchAssemblyBatch` only when the view model
 * enables it; the runtime stays authoritative. While visible it shares the panel's primary row with Manual
 * Produce (UiLayout split); hidden, Manual Produce gets its full row back. Styling matches the panel Buttons.
 */
@ccclass('AssemblyBatchActionController')
export class AssemblyBatchActionController extends Component {
    public commandEmitter: AssemblyBatchCommandEmitter | null = null;
    private label: Label | null = null;
    private button: Button | null = null;
    private latest: AssemblyBatchViewModel | null = null;
    /** Whether the primary row is currently split (null until Manual Produce has been laid out once). */
    private splitApplied: boolean | null = null;
    private lastDiagnosticKey = '';

    public start(): void { this.ensureLayout(); }

    public refresh(viewModel: AssemblyBatchViewModel): void {
        this.ensureLayout();
        this.latest = viewModel;
        this.label!.string = formatAssemblyBatchText(viewModel);
        this.label!.string = fitLabel(this.label!, this.label!.string);
        this.button!.interactable = viewModel.enabled;
        this.node.active = viewModel.visible;
        this.applyPrimaryRowSplit(viewModel.visible);
        this.reportDiagnostics(viewModel);
    }

    public onPressed(): void {
        const viewModel = this.latest;
        if (viewModel?.enabled && viewModel.command) this.commandEmitter?.(viewModel.command);
    }

    /** DEBUG-only read of the rendered state (for the `ui_layout` diagnostic). */
    public getActionState(): { visible: boolean; enabled: boolean; state: string; caption: string } | null {
        if (!this.latest || !this.label) return null;
        return { visible: this.latest.visible, enabled: this.latest.enabled, state: this.latest.state, caption: this.label.string };
    }

    private ensureLayout(): void {
        if (this.label) return;
        const primary = PRODUCER_PANEL_LAYOUT.primaryAction!;
        const rect = cardPrimaryActionSplitRects(PRODUCER_PANEL_LAYOUT).secondary;
        this.node.layer = Layers.Enum.UI_2D;
        this.node.setPosition(new Vec3(rect.x, rect.y, 0));
        (this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform)).setContentSize(rect.w, rect.h);
        const label = this.node.addComponent(Label);
        label.overflow = Label.Overflow.SHRINK;
        label.enableWrapText = false;
        label.string = '';
        label.fontSize = primary.fontSize;
        label.lineHeight = rect.h;
        label.color = new Color(238, 241, 233, 255);
        this.label = label;
        const button = this.node.addComponent(Button);
        const event = new EventHandler(); event.target = this.node; event.component = 'AssemblyBatchActionController'; event.handler = 'onPressed';
        button.clickEvents = [event];
        this.button = button;
        this.node.active = false;
    }

    /** Resizes the sibling Manual Produce Button (owned by CoreHudController) between the full and the left-half rect. */
    private applyPrimaryRowSplit(split: boolean): void {
        if (this.splitApplied === split) return;
        const manual = this.node.parent?.getChildByName(PRODUCER_PANEL_LAYOUT.primaryAction!.key);
        const transform = manual?.getComponent(UITransform);
        if (!manual || !transform) return;
        const rect = split ? cardPrimaryActionSplitRects(PRODUCER_PANEL_LAYOUT).primary : cardActionRect(PRODUCER_PANEL_LAYOUT, PRODUCER_PANEL_LAYOUT.primaryAction!.key);
        manual.setPosition(new Vec3(rect.x, rect.y, 0));
        transform.setContentSize(rect.w, rect.h);
        const manualLabel = manual.getComponent(Label);
        if (manualLabel) manualLabel.lineHeight = rect.h;
        this.splitApplied = split;
    }

    /** DEBUG-only `assembly_batch` diagnostic on each state change and every 10% of progress. */
    private reportDiagnostics(viewModel: AssemblyBatchViewModel): void {
        if (!isDeviceDiagnosticsEnabled()) return;
        const key = `${viewModel.state}:${viewModel.enabled}:${Math.floor(viewModel.progress * 10)}`;
        if (key === this.lastDiagnosticKey) return;
        this.lastDiagnosticKey = key;
        emitDeviceEvent('assembly_batch', {
            phase: 'ui',
            state: viewModel.state,
            visible: viewModel.visible,
            enabled: viewModel.enabled,
            progress: viewModel.progress,
            remainingSeconds: viewModel.remainingSeconds,
            payout: viewModel.payout,
            caption: this.label?.string ?? '',
            split: this.splitApplied,
        });
    }
}
