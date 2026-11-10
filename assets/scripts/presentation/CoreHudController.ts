import { _decorator, Button, Color, Component, EventHandler, EventTouch, Label, Layers, Node, Sprite, UITransform, Vec3 } from 'cc';
import type { GameCommand } from '../domain/Commands.ts';
import { resolveManualProduceAction, resolveNextGoalAction } from './CoreLoopActions.ts';
import type { HudViewModel } from './HudViewModel.ts';
import { defaultHudTexts, formatHudTexts, type DisplayNameSource } from './PresentationText.ts';
import { CORE_HUD_LAYOUT, HUD_ACTION_KEYS, cardActionRect, cardHeight, cardRowCenterY, cardRowWidth, type HudActionKey } from './UiLayout.ts';

const { ccclass } = _decorator;

export type HudCommandEmitter = (command: GameCommand) => void;

/** AUT-UI-001 HUD action state, read by the DEBUG `ui_layout` diagnostic only. */
export interface HudActionState {
    readonly visible: boolean;
    readonly enabled: boolean;
}

/** Compact HUD binding. It renders snapshots and emits commands; it owns no game state. */
@ccclass('CoreHudController')
export class CoreHudController extends Component {
    public commandEmitter: HudCommandEmitter | null = null;
    private labels = new Map<string, Label>();
    private buttons = new Map<HudActionKey, Button>();
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
        this.setText('ManualProduceAction', texts.manualProduceAction);
        this.setText('NextGoalAction', texts.nextGoalAction);
        this.applyActionStates();
    }

    /** AUT-UI-001: Manual Produce is permanent; it still re-checks its action before emitting. */
    public manualProduce(): void {
        const action = resolveManualProduceAction();
        if (action.enabled && action.command) this.commandEmitter?.(action.command);
    }

    /** AUT-UI-001: buys the Next Goal breakthrough only if the latest snapshot still allows it (one tap, no confirmation). */
    public purchaseNextGoal(): void {
        const action = resolveNextGoalAction(this.latest?.nextGoal);
        if (action.enabled && action.command) this.commandEmitter?.(action.command);
    }

    /** Button click handler: Cocos calls EventHandler handlers with (event, customEventData). */
    public onActionPressed(_event: unknown, actionId: string): void {
        if (actionId === 'ManualProduceAction') this.manualProduce();
        else if (actionId === 'NextGoalAction') this.purchaseNextGoal();
    }

    public getActionStates(): Readonly<Record<HudActionKey, HudActionState>> {
        const manual = resolveManualProduceAction();
        const nextGoal = resolveNextGoalAction(this.latest?.nextGoal);
        return { ManualProduceAction: { visible: manual.visible, enabled: manual.enabled }, NextGoalAction: { visible: nextGoal.visible, enabled: nextGoal.enabled } };
    }

    public activateFreeOverclock(): void {
        if (this.latest?.freeOverclock.canActivate) this.commandEmitter?.({ type: 'activateFreeOverclock' });
    }

    private ensureLayout(): void {
        if (this.labels.size > 0) return;
        const defaults = defaultHudTexts();
        const entries = [['IndustrialOutputValue', defaults.industrialOutput], ['ProductionPerSecondValue', defaults.productionPerSecond], ['NextGoalValue', defaults.nextGoal], ['NextGoalContext', defaults.nextGoalContext], ['FreeOverclockValue', defaults.freeOverclock], ['FreeOverclockTimer', defaults.freeOverclockTimer]] as const;
        const layout = CORE_HUD_LAYOUT;
        entries.forEach(([key, text], index) => {
            const row = layout.rows[index];
            const panel = new Node(key);
            panel.layer = Layers.Enum.UI_2D;
            panel.parent = this.node;
            panel.setPosition(new Vec3(0, cardRowCenterY(layout, index), 0));
            const transform = panel.addComponent(UITransform);
            transform.setContentSize(cardRowWidth(layout), row.height);
            const label = panel.addComponent(Label);
            // AUT-R-036: the row keeps its UiLayout size; SHRINK is only a safety net for over-long text.
            label.overflow = Label.Overflow.SHRINK;
            label.enableWrapText = false;
            label.string = text;
            label.fontSize = row.fontSize;
            label.lineHeight = row.height;
            label.color = new Color(238, 241, 233, 255);
            this.labels.set(key, label);
        });
        // AUT-UI-001: one Button per action on its own child node; the root keeps only its touch swallowing.
        const actionRow = layout.actionRow!;
        const actionDefaults: Record<HudActionKey, string> = { ManualProduceAction: defaults.manualProduceAction, NextGoalAction: defaults.nextGoalAction };
        for (const key of HUD_ACTION_KEYS) {
            const rect = cardActionRect(layout, key);
            const node = new Node(key);
            node.layer = Layers.Enum.UI_2D;
            node.parent = this.node;
            node.setPosition(new Vec3(rect.x, rect.y, 0));
            node.addComponent(UITransform).setContentSize(rect.w, rect.h);
            const label = node.addComponent(Label);
            label.overflow = Label.Overflow.SHRINK;
            label.enableWrapText = false;
            label.string = actionDefaults[key];
            label.fontSize = actionRow.fontSize;
            label.lineHeight = rect.h;
            label.color = new Color(238, 241, 233, 255);
            this.labels.set(key, label);
            const button = node.addComponent(Button);
            const event = new EventHandler(); event.target = this.node; event.component = 'CoreHudController'; event.handler = 'onActionPressed'; event.customEventData = key;
            button.clickEvents = [event];
            this.buttons.set(key, button);
        }
        this.applyActionStates();
        const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
        transform.setContentSize(layout.width, cardHeight(layout));
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

    /** The HUD claims touches on its own card area (UiLayout) so camera and selection never receive them. */
    private swallowTouch(event: EventTouch): void { event.propagationStopped = true; }

    /** Disabled Buttons let the touch fall through to the root, which swallows it. */
    private applyActionStates(): void {
        const states = this.getActionStates();
        for (const [key, button] of this.buttons) button.interactable = states[key].visible && states[key].enabled;
    }

    private setText(key: string, value: string): void { this.labels.get(key)!.string = value; }
}
