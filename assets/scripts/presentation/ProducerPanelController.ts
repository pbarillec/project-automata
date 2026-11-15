import { _decorator, Button, Color, Component, EventHandler, EventTouch, Graphics, Label, Layers, Node, Sprite, UITransform, Vec3 } from 'cc';
import type { GameCommand } from '../domain/Commands.ts';
import type { ProducerPanelActionId, ProducerPanelViewModel } from './ProducerPanelViewModel.ts';
import { defaultPanelTexts, formatPanelTexts, pendingSelectionPanelTexts, type DisplayNameSource, type PanelTexts } from './PresentationText.ts';
import { producerHeaderIconSlot, producerIconFor, type IconName } from './AutomataIdentity.ts';
import { clearIconRecord, drawIcon, recordIcon } from './IdentityGraphics';
import { PANEL_ACTION_KEYS, PRODUCER_PANEL_LAYOUT, cardActionRect, cardHeight, cardRowCenterY, cardRowWidth, type PanelActionKey } from './UiLayout.ts';

const { ccclass } = _decorator;
export type ProducerPanelCommandEmitter = (command: GameCommand) => void;

/** Compact selected-producer card. It renders snapshots and emits runtime commands only. */
@ccclass('ProducerPanelController')
export class ProducerPanelController extends Component {
    public commandEmitter: ProducerPanelCommandEmitter | null = null;
    /** AUT-LOC-001: same narrow name source as the HUD; panel names come from the view model's displayNameKey. */
    public displayNames: DisplayNameSource | null = null;
    private labels = new Map<string, Label>();
    private latest: ProducerPanelViewModel | null = null;
    private selectedProducerId: string | null = null;
    private touchBlockRegistered = false;
    /** AUT-066: the producer icon inside the existing ProducerName row (text rect unchanged). */
    private iconGraphics: Graphics | null = null;
    private iconName: IconName | null | undefined = undefined;

    public start(): void { this.ensureLayout(); }

    public refresh(viewModel: ProducerPanelViewModel): void {
        this.ensureLayout();
        this.latest = viewModel;
        this.selectedProducerId = viewModel.selectedProducerId;
        this.applyTexts(formatPanelTexts(viewModel));
    }

    public purchase(id: ProducerPanelActionId): void {
        const action = this.latest?.actions?.[id];
        if (action?.isEnabled && action.command) this.commandEmitter?.(action.command);
    }

    public replaceSelection(selectedProducerId: string | null): void {
        this.ensureLayout();
        this.selectedProducerId = selectedProducerId;
        this.latest = null;
        this.applyTexts(pendingSelectionPanelTexts(selectedProducerId));
    }

    private ensureLayout(): void {
        if (this.labels.size > 0) return;
        const defaults = defaultPanelTexts();
        const entries = [['ProducerName', defaults.name], ['ProducerLevel', defaults.level], ['ProducerProduction', defaults.production], ['ProducerMilestone', defaults.milestone]] as const;
        const layout = PRODUCER_PANEL_LAYOUT;
        entries.forEach(([key, text], index) => {
            const row = layout.rows[index];
            const node = new Node(key); node.layer = Layers.Enum.UI_2D; node.parent = this.node; node.setPosition(new Vec3(0, cardRowCenterY(layout, index), 0));
            const transform = node.addComponent(UITransform); transform.setContentSize(cardRowWidth(layout), row.height);
            // AUT-R-036: the row keeps its UiLayout size; SHRINK is only a safety net.
            const label = node.addComponent(Label); label.overflow = Label.Overflow.SHRINK; label.enableWrapText = false; label.string = text; label.fontSize = row.fontSize; label.lineHeight = row.height; label.color = new Color(238, 241, 233, 255); this.labels.set(key, label);
        });
        // AUT-R-036-02: ×1/×10/×MAX side by side in the action row; each Button keeps its UiLayout rect as hit area.
        const actionRow = layout.actionRow!;
        const actionDefaults: Record<PanelActionKey, string> = { Action_x1: defaults.actions.x1, Action_x10: defaults.actions.x10, Action_xMax: defaults.actions.xMax };
        for (const key of PANEL_ACTION_KEYS) {
            const rect = cardActionRect(layout, key);
            const node = new Node(key); node.layer = Layers.Enum.UI_2D; node.parent = this.node; node.setPosition(new Vec3(rect.x, rect.y, 0));
            node.addComponent(UITransform).setContentSize(rect.w, rect.h);
            // Two-line caption (UiLayout captionLines): wraps inside the Button, SHRINK stays the safety net.
            const actionLabel = node.addComponent(Label); actionLabel.overflow = Label.Overflow.SHRINK; actionLabel.enableWrapText = true; actionLabel.string = actionDefaults[key]; actionLabel.fontSize = actionRow.fontSize; actionLabel.lineHeight = actionRow.lineHeight ?? rect.h; actionLabel.color = new Color(238, 241, 233, 255); this.labels.set(key, actionLabel);
            const button = node.addComponent(Button);
            const event = new EventHandler(); event.target = this.node; event.component = 'ProducerPanelController'; event.handler = 'onActionPressed'; event.customEventData = key.slice('Action_'.length);
            button.clickEvents = [event];
        }
        const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform); transform.setContentSize(layout.width, cardHeight(layout));
        if (!this.touchBlockRegistered) {
            this.touchBlockRegistered = true;
            this.node.on(Node.EventType.TOUCH_START, this.swallowTouch, this);
            this.node.on(Node.EventType.TOUCH_MOVE, this.swallowTouch, this);
            this.node.on(Node.EventType.TOUCH_END, this.swallowTouch, this);
            this.node.on(Node.EventType.TOUCH_CANCEL, this.swallowTouch, this);
        }
        if (!this.node.getComponent(Sprite)) { const background = this.node.addComponent(Sprite); background.color = new Color(24, 29, 32, 225); }
    }

    public onActionPressed(_event: unknown, actionId: string): void {
        if (actionId === 'x1' || actionId === 'x10' || actionId === 'xMax') this.purchase(actionId);
    }

    private applyTexts(texts: PanelTexts): void {
        this.drawHeaderIcon();
        this.setText('ProducerName', texts.name);
        this.setText('ProducerLevel', texts.level);
        this.setText('ProducerProduction', texts.production);
        this.setText('ProducerMilestone', texts.milestone);
        for (const id of ['x1', 'x10', 'xMax'] as const) this.setText(`Action_${id}`, texts.actions[id]);
    }

    private drawHeaderIcon(): void {
        const icon = producerIconFor(this.selectedProducerId);
        if (icon === this.iconName) return;
        this.iconName = icon;
        let graphics = this.iconGraphics;
        if (!graphics) {
            const node = new Node('ProducerHeaderIcon'); node.layer = Layers.Enum.UI_2D; node.parent = this.node; node.addComponent(UITransform);
            graphics = this.iconGraphics = node.addComponent(Graphics);
        }
        graphics.clear();
        const slot = producerHeaderIconSlot();
        if (icon === null) { clearIconRecord(slot.slot); return; }
        drawIcon(graphics, icon, slot.x, slot.y, slot.size);
        recordIcon({ slot: slot.slot, icon, node: graphics.node, x: slot.x, y: slot.y, size: slot.size });
    }

    /** The panel claims touches on its own card area (UiLayout; after child Buttons) so camera and selection never receive them. */
    private swallowTouch(event: EventTouch): void { event.propagationStopped = true; }

    private setText(key: string, value: string): void { this.labels.get(key)!.string = value; }
}
