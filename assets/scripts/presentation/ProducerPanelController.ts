import { _decorator, Button, Color, Component, EventHandler, Label, Node, Sprite, UITransform, Vec3 } from 'cc';
import type { GameCommand } from '../domain/Commands.ts';
import type { ProducerPanelActionId, ProducerPanelPurchaseAction, ProducerPanelViewModel } from './ProducerPanelViewModel.ts';

const { ccclass } = _decorator;
export type ProducerPanelCommandEmitter = (command: GameCommand) => void;

/** Compact selected-producer card. It renders snapshots and emits runtime commands only. */
@ccclass('ProducerPanelController')
export class ProducerPanelController extends Component {
    public commandEmitter: ProducerPanelCommandEmitter | null = null;
    private labels = new Map<string, Label>();
    private latest: ProducerPanelViewModel | null = null;
    private selectedProducerId: string | null = null;

    public start(): void { this.ensureLayout(); }

    public refresh(viewModel: ProducerPanelViewModel): void {
        this.ensureLayout();
        this.latest = viewModel;
        this.selectedProducerId = viewModel.selectedProducerId;
        this.setText('ProducerName', viewModel.displayNameKey ?? 'producer_panel.none_selected');
        this.setText('ProducerLevel', viewModel.selectedProducerId ? `Lv ${viewModel.level}` : '');
        this.setText('ProducerProduction', viewModel.selectedProducerId ? `${viewModel.productionPerSecondFormatted}/s` : '');
        this.setText('ProducerMilestone', viewModel.milestone?.state === 'complete' ? 'producer_panel.milestone.complete' : viewModel.milestone ? `${viewModel.milestone.nextThreshold} • ${viewModel.milestone.levelsRemaining}` : '');
        for (const id of ['x1', 'x10', 'xMax'] as const) this.setText(`Action_${id}`, this.actionText(viewModel.actions?.[id]));
    }

    public purchase(id: ProducerPanelActionId): void {
        const action = this.latest?.actions?.[id];
        if (action?.isEnabled && action.command) this.commandEmitter?.(action.command);
    }

    public replaceSelection(selectedProducerId: string | null): void {
        this.ensureLayout();
        this.selectedProducerId = selectedProducerId;
        this.latest = null;
        this.setText('ProducerName', selectedProducerId ?? 'producer_panel.none_selected');
        this.setText('ProducerLevel', '');
        this.setText('ProducerProduction', '');
        this.setText('ProducerMilestone', '');
        for (const id of ['x1', 'x10', 'xMax'] as const) this.setText(`Action_${id}`, '—');
    }

    private ensureLayout(): void {
        if (this.labels.size > 0) return;
        const entries = [['ProducerName', 'producer_panel.none_selected'], ['ProducerLevel', ''], ['ProducerProduction', ''], ['ProducerMilestone', ''], ['Action_x1', 'producer_panel.buy_1'], ['Action_x10', 'producer_panel.buy_10'], ['Action_xMax', 'producer_panel.buy_max']] as const;
        entries.forEach(([key, text], index) => {
            const node = new Node(key); node.parent = this.node; node.setPosition(new Vec3(0, 138 - index * 38, 0));
            const transform = node.addComponent(UITransform); transform.setContentSize(560, 36);
            const label = node.addComponent(Label); label.string = text; label.fontSize = index === 0 ? 28 : 18; label.color = new Color(238, 241, 233, 255); this.labels.set(key, label);
            if (key.startsWith('Action_')) {
                const button = node.addComponent(Button);
                const event = new EventHandler(); event.target = this.node; event.component = 'ProducerPanelController'; event.handler = 'onActionPressed'; event.customEventData = key.slice('Action_'.length);
                button.clickEvents = [event];
            }
        });
        const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform); transform.setContentSize(600, 330);
        if (!this.node.getComponent(Sprite)) { const background = this.node.addComponent(Sprite); background.color = new Color(24, 29, 32, 225); }
    }

    public onActionPressed(actionId: string): void {
        if (actionId === 'x1' || actionId === 'x10' || actionId === 'xMax') this.purchase(actionId);
    }

    private actionText(action: ProducerPanelPurchaseAction | undefined): string {
        if (!action) return '—';
        return `${action.labelKey} ${action.costFormatted}${action.isEnabled ? '' : ' • unavailable'}`;
    }

    private setText(key: string, value: string): void { this.labels.get(key)!.string = value; }
}
