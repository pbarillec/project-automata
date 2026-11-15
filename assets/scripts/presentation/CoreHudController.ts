import { _decorator, Button, Color, Component, EventHandler, EventTouch, Graphics, Label, Layers, Node, Sprite, UITransform, Vec3 } from 'cc';
import type { GameCommand } from '../domain/Commands.ts';
import { resolveManualProduceAction, resolveNextGoalAction, resolveOverclockAction } from './CoreLoopActions.ts';
import { resolveOverclockDisplayState, type HudViewModel } from './HudViewModel.ts';
import { defaultHudTexts, formatHudTexts, type DisplayNameSource } from './PresentationText.ts';
import { BOOST_HUD_OUTLINE_THICKNESS, resolveBoostHudPill, resolveOverclockRowText } from './BoostHudPill.ts';
import { IDENTITY_PALETTE, hudIndustrialIconSlot, hudOverclockIconSlot } from './AutomataIdentity.ts';
import { drawIcon, recordIcon } from './IdentityGraphics';
import { CORE_HUD_LAYOUT, HUD_ACTION_KEYS, cardActionFontSize, cardActionRect, cardHeight, cardRowCenterY, cardRowWidth, hudActionCard, type HudActionKey } from './UiLayout.ts';

const { ccclass } = _decorator;

/** AUT-047: the Overclock status pill spans the two Overclock rows (FreeOverclockValue, FreeOverclockTimer) of the HUD card. */
const OVERCLOCK_FIRST_ROW = 4;
/** AUT-UI-003: the pill is inset from the Button rect so it never touches the row of text above or below it. */
const PILL_INSET = 3;

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
    /**
     * AUT-R-036-02: card node that hosts the actions UiLayout places outside the HUD (Manual Produce, in
     * the bottom band). Set by the bootstrap before the first layout; null keeps them on the HUD node.
     */
    public primaryActionHost: Node | null = null;
    private labels = new Map<string, Label>();
    private buttons = new Map<HudActionKey, Button>();
    private latest: HudViewModel | null = null;
    private nameSource: DisplayNameSource | null = null;
    private touchBlockRegistered = false;
    private overclockPill: Node | null = null;
    private overclockPillGraphics: Graphics | null = null;
    private pillKey = 'none';
    /** AUT-066: icons drawn inside the existing Industrial Output row and Overclock button (no text / hit rect change). */
    private iconGraphics: Graphics | null = null;
    private overclockIconFilled: boolean | null = null;
    private rowTextState = 'none';

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
        // AUT-056: while Extended Overclock is active the rows / pill show its ACTIVE look.
        const overclockState = resolveOverclockDisplayState(viewModel);
        this.applyOverclockPill(overclockState);
        this.applyOverclockRowText(overclockState);
    }

    /** AUT-047: amber-filled active pill / amber-outlined paused pill behind the two Overclock rows; redrawn only when the style changes. */
    private applyOverclockPill(state: HudViewModel['freeOverclock']['state']): void {
        const style = resolveBoostHudPill(state);
        if (style.key === this.pillKey) return;
        this.pillKey = style.key;
        const pill = this.overclockPill;
        const graphics = this.overclockPillGraphics;
        if (pill && graphics) {
            graphics.clear();
            if (style.visible) {
                const layout = CORE_HUD_LAYOUT;
                const top = cardRowCenterY(layout, OVERCLOCK_FIRST_ROW) + layout.rows[OVERCLOCK_FIRST_ROW].height / 2;
                const bottom = cardRowCenterY(layout, OVERCLOCK_FIRST_ROW + 1) - layout.rows[OVERCLOCK_FIRST_ROW + 1].height / 2;
                const width = cardRowWidth(layout);
                if (style.fill) {
                    graphics.fillColor = new Color(style.fill.r, style.fill.g, style.fill.b, style.fill.a);
                    graphics.fillRect(-width / 2, bottom + PILL_INSET, width, top - bottom - (PILL_INSET * 2));
                }
                if (style.outline) {
                    graphics.strokeColor = new Color(style.outline.r, style.outline.g, style.outline.b, style.outline.a);
                    graphics.lineWidth = BOOST_HUD_OUTLINE_THICKNESS;
                    graphics.rect(-width / 2, bottom + PILL_INSET, width, top - bottom - (PILL_INSET * 2));
                    graphics.stroke();
                }
            }
            pill.setScale(style.visible ? 1 : 0, style.visible ? 1 : 0, 1);
        }
        this.drawOverclockIcon(style.visible && !!style.fill);
        const textColor = new Color(style.text.r, style.text.g, style.text.b, style.text.a);
        for (const key of ['FreeOverclockValue', 'FreeOverclockTimer']) {
            const label = this.labels.get(key);
            if (label) label.color = textColor;
        }
    }

    /** AUT-066: the bolt is amber on the plain pill and graphite on the amber-filled ACTIVE pill; the Industrial Output icon is static. */
    private drawOverclockIcon(filled: boolean): void {
        const graphics = this.iconGraphics;
        if (!graphics || filled === this.overclockIconFilled) return;
        this.overclockIconFilled = filled;
        graphics.clear();
        const io = hudIndustrialIconSlot();
        drawIcon(graphics, 'industrial_output', io.x, io.y, io.size);
        const oc = hudOverclockIconSlot();
        const ink = filled ? IDENTITY_PALETTE.graphite : IDENTITY_PALETTE.amber;
        drawIcon(graphics, 'overclock', oc.x, oc.y, oc.size, { ink, accent: ink });
        recordIcon({ slot: io.slot, icon: 'industrial_output', node: graphics.node, x: io.x, y: io.y, size: io.size });
        recordIcon({ slot: oc.slot, icon: 'overclock', node: graphics.node, x: oc.x, y: oc.y, size: oc.size });
    }

    private createIconLayer(): void {
        const node = new Node('HudIdentityIcons');
        node.layer = Layers.Enum.UI_2D;
        node.parent = this.node;
        node.addComponent(UITransform);
        this.iconGraphics = node.addComponent(Graphics);
        this.drawOverclockIcon(false);
    }

    private createOverclockPill(): void {
        const pill = new Node('FreeOverclockPill');
        pill.layer = Layers.Enum.UI_2D;
        pill.parent = this.node;
        pill.addComponent(UITransform);
        this.overclockPillGraphics = pill.addComponent(Graphics);
        pill.setScale(0, 0, 1);
        this.overclockPill = pill;
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
        else if (actionId === 'OverclockAction') this.activateFreeOverclock();
    }

    public getActionStates(): Readonly<Record<HudActionKey, HudActionState>> {
        const manual = resolveManualProduceAction();
        const nextGoal = resolveNextGoalAction(this.latest?.nextGoal);
        const overclock = resolveOverclockAction(this.latest?.freeOverclock);
        return { ManualProduceAction: { visible: manual.visible, enabled: manual.enabled }, NextGoalAction: { visible: nextGoal.visible, enabled: nextGoal.enabled }, OverclockAction: { visible: overclock.visible, enabled: overclock.enabled } };
    }

    /** AUT-047 / AUT-UI-003: re-checks the latest snapshot (ready only) and emits the existing `activateFreeOverclock` command through commandEmitter. */
    public activateFreeOverclock(): void {
        if (this.latest?.freeOverclock.canActivate) this.commandEmitter?.({ type: 'activateFreeOverclock' });
    }

    /** DEBUG diagnostics only (AUT-056): what the two Overclock rows currently show. */
    public getOverclockDiagnostic(): { state: string; freeState: string; remainingSeconds: number; multiplier: number; text: string; timerText: string } | null {
        const latest = this.latest;
        if (!latest) return null;
        const texts = formatHudTexts(latest, this.displayNames);
        const extended = latest.extendedOverclock.active;
        return {
            state: resolveOverclockDisplayState(latest),
            freeState: latest.freeOverclock.state,
            remainingSeconds: extended ? latest.extendedOverclock.remainingSeconds : latest.freeOverclock.remainingSeconds,
            multiplier: extended ? latest.extendedOverclock.multiplier : latest.freeOverclock.multiplier,
            text: texts.freeOverclock,
            timerText: texts.freeOverclockTimer,
        };
    }

    /** AUT-UI-003: locked / cooldown = dimmed text; ready / active / suspended keep their pill text. */
    private applyOverclockRowText(state: HudViewModel['freeOverclock']['state']): void {
        if (state === this.rowTextState) return;
        this.rowTextState = state;
        // AUT-UI-003: READY shows one line, centred in the pill (the timer row is empty); other states use their own rows.
        const valueLabel = this.labels.get('FreeOverclockValue');
        if (valueLabel) {
            const layout = CORE_HUD_LAYOUT;
            const y = state === 'ready' ? cardActionRect(layout, 'OverclockAction').y : cardRowCenterY(layout, OVERCLOCK_FIRST_ROW);
            valueLabel.node.setPosition(new Vec3(0, y, 0));
        }
        const tint = resolveOverclockRowText(state);
        if (!tint) return;
        const color = new Color(tint.r, tint.g, tint.b, tint.a);
        for (const key of ['FreeOverclockValue', 'FreeOverclockTimer']) {
            const label = this.labels.get(key);
            if (label) label.color = color;
        }
    }

    private ensureLayout(): void {
        if (this.labels.size > 0) return;
        const defaults = defaultHudTexts();
        const entries = [['IndustrialOutputValue', defaults.industrialOutput], ['ProductionPerSecondValue', defaults.productionPerSecond], ['NextGoalValue', defaults.nextGoal], ['NextGoalContext', defaults.nextGoalContext], ['FreeOverclockValue', defaults.freeOverclock], ['FreeOverclockTimer', defaults.freeOverclockTimer]] as const;
        const layout = CORE_HUD_LAYOUT;
        entries.forEach(([key, text], index) => {
            const row = layout.rows[index];
            // AUT-047: the Overclock status pill sits UNDER its two rows (earlier sibling = drawn first); scale 0 until a boost is active.
            if (key === 'FreeOverclockValue') this.createOverclockPill();
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
        // AUT-R-036-02: Manual Produce is laid out in the bottom (panel) band; its node goes under
        // `primaryActionHost` (the panel card, which swallows touches on its area). Wiring is unchanged.
        const actionDefaults: Record<HudActionKey, string | null> = { ManualProduceAction: defaults.manualProduceAction, NextGoalAction: defaults.nextGoalAction, OverclockAction: null };
        for (const key of HUD_ACTION_KEYS) {
            const card = hudActionCard(key);
            const rect = cardActionRect(card, key);
            const node = new Node(key);
            node.layer = Layers.Enum.UI_2D;
            node.parent = card === layout ? this.node : (this.primaryActionHost ?? this.node);
            node.setPosition(new Vec3(rect.x, rect.y, 0));
            node.addComponent(UITransform).setContentSize(rect.w, rect.h);
            // AUT-UI-003: the Overclock Button covers the two Overclock label rows and has no label of its own.
            const defaultText = actionDefaults[key];
            if (defaultText !== null) {
                const label = node.addComponent(Label);
                label.overflow = Label.Overflow.SHRINK;
                label.enableWrapText = false;
                label.string = defaultText;
                label.fontSize = cardActionFontSize(card, key);
                label.lineHeight = rect.h;
                label.color = new Color(238, 241, 233, 255);
                this.labels.set(key, label);
            }
            const button = node.addComponent(Button);
            const event = new EventHandler(); event.target = this.node; event.component = 'CoreHudController'; event.handler = 'onActionPressed'; event.customEventData = key;
            button.clickEvents = [event];
            this.buttons.set(key, button);
        }
        this.createIconLayer();
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
