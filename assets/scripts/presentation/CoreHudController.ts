import { _decorator, Color, Component, Label, Node, Sprite, UITransform, Vec3 } from 'cc';
import type { GameCommand } from '../domain/Commands.ts';
import type { HudViewModel } from './HudViewModel.ts';

const { ccclass } = _decorator;

export type HudCommandEmitter = (command: GameCommand) => void;

/** Compact HUD binding. It renders snapshots and emits commands; it owns no game state. */
@ccclass('CoreHudController')
export class CoreHudController extends Component {
    public commandEmitter: HudCommandEmitter | null = null;
    private labels = new Map<string, Label>();
    private latest: HudViewModel | null = null;

    public start(): void { this.ensureLayout(); }

    public refresh(viewModel: HudViewModel): void {
        this.ensureLayout();
        this.latest = viewModel;
        this.setText('IndustrialOutputValue', viewModel.industrialOutput.formatted);
        this.setText('ProductionPerSecondValue', `${viewModel.productionPerSecond.formatted}/s`);
        this.setText('NextGoalValue', viewModel.nextGoal.semanticKey);
        this.setText('NextGoalContext', this.goalContext(viewModel));
        this.setText('FreeOverclockValue', viewModel.freeOverclock.state);
        this.setText('FreeOverclockTimer', viewModel.freeOverclock.remainingFormatted);
    }

    public activateFreeOverclock(): void {
        if (this.latest?.freeOverclock.canActivate) this.commandEmitter?.({ type: 'activateFreeOverclock' });
    }

    private ensureLayout(): void {
        if (this.labels.size > 0) return;
        const entries = [['IndustrialOutputValue', '—'], ['ProductionPerSecondValue', '—/s'], ['NextGoalValue', 'next_goal.none'], ['NextGoalContext', ''], ['FreeOverclockValue', 'locked'], ['FreeOverclockTimer', '0s']] as const;
        entries.forEach(([key, text], index) => {
            const panel = new Node(key);
            panel.parent = this.node;
            panel.setPosition(new Vec3(0, 120 - index * 48, 0));
            const transform = panel.addComponent(UITransform);
            transform.setContentSize(600, 54);
            const label = panel.addComponent(Label);
            label.string = text;
            label.fontSize = key === 'IndustrialOutputValue' ? 42 : 22;
            label.color = new Color(238, 241, 233, 255);
            this.labels.set(key, label);
        });
        const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
        transform.setContentSize(640, 310);
        if (!this.node.getComponent(Sprite)) {
            const background = this.node.addComponent(Sprite);
            background.color = new Color(24, 29, 32, 205);
        }
    }

    private setText(key: string, value: string): void { this.labels.get(key)!.string = value; }

    private goalContext(viewModel: HudViewModel): string {
        const goal = viewModel.nextGoal;
        if (goal.progress) return `${goal.progress.currentFormatted}/${goal.progress.requiredFormatted}`;
        if (goal.affordability.costFormatted) return `${goal.affordability.costFormatted} • ${goal.affordability.state}`;
        return goal.blocking.state;
    }
}
