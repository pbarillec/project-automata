import { _decorator, Color, Component, EventTouch, Label, Node, Sprite, UITransform, Vec3 } from 'cc';
import type { GameCommand } from '../domain/Commands.ts';
import type { HudViewModel } from './HudViewModel.ts';
import { defaultHudTexts, formatHudTexts, type DisplayNameSource } from './PresentationText.ts';

const { ccclass } = _decorator;

export type HudCommandEmitter = (command: GameCommand) => void;

/** Compact HUD binding. It renders snapshots and emits commands; it owns no game state. */
@ccclass('CoreHudController')
export class CoreHudController extends Component {
    public commandEmitter: HudCommandEmitter | null = null;
    private labels = new Map<string, Label>();
    private latest: HudViewModel | null = null;
    private nameSource: DisplayNameSource | null = null;
    private touchBlockRegistered = false;

    /**
     * AUT-LOC-001: names Next Goal objectives; null shows the generic catalogue text. The session binding
     * renders its first snapshot before this is assigned, so assigning re-renders the latest snapshot.
     */
    public get displayNames(): DisplayNameSource | null { return this.nameSource; }
    public set displayNames(source: DisplayNameSource | null) {
        this.nameSource = source;
        if (this.latest) this.refresh(this.latest);
    }

    public start(): void { this.ensureLayout(); }

    public refresh(viewModel: HudViewModel): void {
        this.ensureLayout();
        this.latest = viewModel;
        const texts = formatHudTexts(viewModel, this.displayNames);
        this.setText('IndustrialOutputValue', texts.industrialOutput);
        this.setText('ProductionPerSecondValue', texts.productionPerSecond);
        this.setText('NextGoalValue', texts.nextGoal);
        this.setText('NextGoalContext', texts.nextGoalContext);
        this.setText('FreeOverclockValue', texts.freeOverclock);
        this.setText('FreeOverclockTimer', texts.freeOverclockTimer);
    }

    public activateFreeOverclock(): void {
        if (this.latest?.freeOverclock.canActivate) this.commandEmitter?.({ type: 'activateFreeOverclock' });
    }

    private ensureLayout(): void {
        if (this.labels.size > 0) return;
        const defaults = defaultHudTexts();
        const entries = [['IndustrialOutputValue', defaults.industrialOutput], ['ProductionPerSecondValue', defaults.productionPerSecond], ['NextGoalValue', defaults.nextGoal], ['NextGoalContext', defaults.nextGoalContext], ['FreeOverclockValue', defaults.freeOverclock], ['FreeOverclockTimer', defaults.freeOverclockTimer]] as const;
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
        if (!this.touchBlockRegistered) {
            this.touchBlockRegistered = true;
            this.node.on(Node.EventType.TOUCH_START, this.swallowTouch, this);
            this.node.on(Node.EventType.TOUCH_MOVE, this.swallowTouch, this);
            this.node.on(Node.EventType.TOUCH_END, this.swallowTouch, this);
            this.node.on(Node.EventType.TOUCH_CANCEL, this.swallowTouch, this);
        }
        if (!this.node.getComponent(Sprite)) {
            const background = this.node.addComponent(Sprite);
            background.color = new Color(24, 29, 32, 205);
        }
    }

    /** The HUD claims touches on its own 640x310 area so camera and selection never receive them. */
    private swallowTouch(event: EventTouch): void { event.propagationStopped = true; }

    private setText(key: string, value: string): void { this.labels.get(key)!.string = value; }
}
