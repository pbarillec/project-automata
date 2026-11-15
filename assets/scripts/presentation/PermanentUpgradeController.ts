import { _decorator, Button, Color, Component, EventHandler, EventTouch, Graphics, Label, Layers, Node, UITransform, Vec3, Widget } from 'cc';
import type { GameCommand } from '../domain/Commands.ts';
import type { DomainEvent } from '../domain/Events.ts';
import type { LifecycleCommandResult } from '../lifecycle/LifecycleSessionCoordinator.ts';
import { emitDeviceEvent, isDeviceDiagnosticsEnabled } from './DeviceDiagnostics';
import { drawAiMark } from './IdentityGraphics';
import {
    PERMANENT_UPGRADE_BALANCE_FONT_SIZE,
    PERMANENT_UPGRADE_BUY_FONT_SIZE,
    PERMANENT_UPGRADE_CHIP_FONT_SIZE,
    PERMANENT_UPGRADE_CHIP_HEIGHT,
    PERMANENT_UPGRADE_CHIP_WIDTH,
    PERMANENT_UPGRADE_CLOSE_FONT_SIZE,
    PERMANENT_UPGRADE_COLORS,
    PERMANENT_UPGRADE_EFFECT_FONT_SIZE,
    PERMANENT_UPGRADE_EFFECT_LINE_HEIGHT,
    PERMANENT_UPGRADE_HEADER_FONT_SIZE,
    PERMANENT_UPGRADE_NAME_FONT_SIZE,
    PERMANENT_UPGRADE_PULSE_SECONDS,
    PERMANENT_UPGRADE_RANK_FONT_SIZE,
    PERMANENT_UPGRADE_ROW_SLOTS,
    PERMANENT_UPGRADE_TAB_FONT_SIZE,
    permanentUpgradeChipWidgetOffsets,
    permanentUpgradePanelCenterOffsetY,
    pulseRingBars,
    regularPolygonPoints,
    resolvePermanentUpgradePanelLayout,
    type PermanentUpgradeLocalRect,
    type PermanentUpgradePanelLayout,
    type PermanentUpgradePoint,
} from './PermanentUpgradeLayout.ts';
import type { PermanentUpgradePanelViewModel, PermanentUpgradeRowViewModel } from './PermanentUpgradePanelViewModel.ts';
import type { UiRect } from './UiLayout.ts';

const { ccclass } = _decorator;

export type PermanentUpgradeCommandEmitter = (command: GameCommand) => Promise<LifecycleCommandResult | null>;
type Rgba = { readonly r: number; readonly g: number; readonly b: number; readonly a: number };

const colorOf = (rgba: Rgba): Color => new Color(rgba.r, rgba.g, rgba.b, rgba.a);

/**
 * AUT-050 thin `cc` controller of the AI Upgrades entry chip and modal panel. Pure parts (view model, layout) live in
 * `PermanentUpgradePanelViewModel.ts` / `PermanentUpgradeLayout.ts`; this component only builds nodes, draws Graphics fills (a
 * spriteFrame-less Sprite renders nothing on Android), displays the strings the view model composed and submits the view model's own
 * purchase command through `commandEmitter` (the binding). It never evaluates a rank, a cost, a prerequisite or an effect.
 *
 * Visibility is scale-based (never `node.active`). A full-screen dim backdrop swallows touches while the panel is open and a tap on it
 * (outside the card) closes the panel; CLOSE always works. Every button is a Button on its own child node whose hit rect is the drawn
 * rect. Only `affordable` rows are tappable: insufficient / maxed / locked rows are inert (Button.interactable = false, no command).
 * One tap buys one rank (no confirm, no bulk); a second tap while a purchase is in flight is ignored.
 */
@ccclass('PermanentUpgradeController')
export class PermanentUpgradeController extends Component {
    public backdropNode: Node | null = null;
    public safeNode: Node | null = null;
    /** Where the entry chip lives (the HUD safe-area container); the chip is Widget-anchored below the HUD band, right-aligned. */
    public chipHost: Node | null = null;
    public commandEmitter: PermanentUpgradeCommandEmitter | null = null;
    /** DEBUG only: screen rectangle (bottom-left frame) of a UI node; supplied by FactoryWorldBootstrap (UI camera projection). */
    public screenRectOf: ((node: Node) => UiRect | null) | null = null;
    /** Called after the chip / panel appears or changes so the bootstrap can report a fresh `ui_layout`. */
    public onLayoutChanged: ((reason: string) => void) | null = null;

    private viewModel: PermanentUpgradePanelViewModel | null = null;
    private layout: PermanentUpgradePanelLayout = resolvePermanentUpgradePanelLayout();
    private chipBuilt = false;
    private panelBuilt = false;
    private open = false;
    private inFlight = false;
    private branchIndex = 0;
    private note: string | null = null;
    private chipVisible: boolean | null = null;
    private pulse: { rect: PermanentUpgradeLocalRect; elapsed: number } | null = null;
    private chipNode: Node | null = null;
    private chipGraphics: Graphics | null = null;
    private chipLabel: Label | null = null;
    private backdropGraphics: Graphics | null = null;
    private cardNode: Node | null = null;
    private cardGraphics: Graphics | null = null;
    private titleLabel: Label | null = null;
    private balanceLabel: Label | null = null;
    private markGraphics: Graphics | null = null;
    private closeNode: Node | null = null;
    private closeGraphics: Graphics | null = null;
    private closeLabel: Label | null = null;
    private pulseGraphics: Graphics | null = null;
    private tabs: Array<{ node: Node; graphics: Graphics; label: Label }> = [];
    private rowViews: Array<{
        slot: Node; graphics: Graphics; name: Label; rank: Label; effect: Label;
        buy: Node; buyGraphics: Graphics; buyLabel: Label; button: Button;
    }> = [];
    private drawnBackdropKey = '';
    private shownRowIds: string[] = [];
    /** Redraw signatures: refresh() runs for every fresh snapshot (about once per frame), so unchanged views are not redrawn. */
    private chipKey = '';
    private panelKey = '';

    public onLoad(): void {
        this.hideScale();
    }

    public update(deltaTime: number): void {
        if (this.open) this.drawBackdrop();
        if (this.pulse) this.advancePulse(deltaTime);
    }

    public isOpen(): boolean {
        return this.open;
    }

    /** DEBUG ui_layout: the nodes whose rects are reported (null while hidden). */
    public getRectNodes(): { chip: Node | null; panel: Node | null; close: Node | null; tabs: Array<Node | null>; buys: Array<Node | null> } {
        const chipShown = this.chipVisible === true && this.chipNode !== null;
        return {
            chip: chipShown ? this.chipNode : null,
            panel: this.open ? this.cardNode : null,
            close: this.open ? this.closeNode : null,
            tabs: this.tabs.map((tab) => (this.open ? tab.node : null)),
            buys: this.rowViews.map((row, index) => (this.open && index < this.shownRowIds.length ? row.buy : null)),
        };
    }

    /** Sink of the binding: every fresh snapshot (start, every accepted command, every collect) refreshes the chip balance and the open panel. */
    public refresh(viewModel: PermanentUpgradePanelViewModel): void {
        this.viewModel = viewModel;
        this.ensureChip();
        this.renderChip();
        if (this.open) this.renderPanel();
    }

    // ---- handlers (Button click events) ----

    public onChipPressed(): void {
        if (this.chipVisible !== true || !this.viewModel) return;
        this.openPanel();
    }

    public onTabPressed(_event: unknown, customEventData: string): void {
        if (!this.open || !this.viewModel) return;
        const index = Number(customEventData);
        if (!Number.isInteger(index) || index < 0 || index >= this.viewModel.branches.length) return;
        this.branchIndex = index;
        this.note = null;
        this.renderPanel();
        this.emitReport('tab', { tab: this.viewModel.branches[index].id });
        this.onLayoutChanged?.('permanent_upgrades_tab');
    }

    public onClosePressed(): void {
        this.closePanel('close_button');
    }

    public onBuyPressed(_event: unknown, customEventData: string): void {
        const viewModel = this.viewModel;
        if (!this.open || !viewModel || this.inFlight) return;
        const row = this.rowsOfBranch(viewModel)[Number(customEventData)];
        if (!row || row.command === null) return;
        const emitter = this.commandEmitter;
        if (!emitter) return;
        this.inFlight = true;
        this.note = null;
        this.renderPanel();
        this.emitReport('row_tapped', { upgradeId: row.id, rowState: row.state, rank: row.currentRank, cost: row.nextRankCost });
        void emitter(row.command).then((result) => this.onPurchaseResult(row, result), () => this.onPurchaseResult(row, null));
    }

    private onPurchaseResult(row: PermanentUpgradeRowViewModel, result: LifecycleCommandResult | null): void {
        this.inFlight = false;
        const execution = result?.execution ?? null;
        const events: readonly DomainEvent[] = execution !== null && execution.ok ? execution.events : [];
        let purchasedRank: number | null = null;
        let purchasedCost: number | null = null;
        let balanceDelta: number | null = null;
        for (const event of events) {
            if (event.type === 'permanentUpgradePurchased') { purchasedRank = event.newRank; purchasedCost = event.cost; }
            if (event.type === 'aiCoreBalanceChanged') balanceDelta = event.delta;
        }
        const ok = purchasedRank !== null;
        const saveOk = result?.save ? result.save.ok : null;
        this.emitReport('purchase_result', {
            upgradeId: row.id,
            rowState: row.state,
            status: ok ? (saveOk === false ? 'purchased_persistence_failed' : 'purchased') : execution === null ? 'error' : 'rejected',
            reason: execution !== null && !execution.ok ? execution.reason : null,
            saveOk,
            eventTypes: events.map((event) => event.type),
            balanceDelta,
            rank: purchasedRank ?? row.currentRank,
            cost: purchasedCost ?? row.nextRankCost,
        });
        if (ok) {
            this.note = null;
            this.startPulse(row.id);
        } else {
            this.note = this.viewModel?.texts.purchaseFailed ?? null;
        }
        if (this.open) this.renderPanel();
    }

    // ---- open / close ----

    private openPanel(): void {
        const viewModel = this.viewModel;
        if (!viewModel) return;
        this.ensurePanel();
        const affordable = viewModel.branches.findIndex((branch) => branch.canBuy);
        this.branchIndex = affordable >= 0 ? affordable : 0;
        this.note = null;
        this.open = true;
        this.panelKey = '';
        this.renderPanel();
        this.node.setScale(1, 1, 1);
        this.emitReport('opened', { tab: viewModel.branches[this.branchIndex].id });
        this.onLayoutChanged?.('permanent_upgrades_opened');
    }

    private closePanel(reason: string): void {
        if (!this.open) return;
        this.open = false;
        this.inFlight = false;
        this.note = null;
        this.pulse = null;
        this.pulseGraphics?.clear();
        this.hideScale();
        this.emitReport('closed', { reason });
        this.onLayoutChanged?.('permanent_upgrades_closed');
    }

    private onBackdropTouchEnd(event: EventTouch): void {
        if (!this.open) return;
        event.propagationStopped = true;
        this.closePanel('backdrop');
    }

    private swallowTouch(event: EventTouch): void {
        if (this.open) event.propagationStopped = true;
    }

    private swallowChipTouch(event: EventTouch): void {
        if (this.chipVisible === true) event.propagationStopped = true;
    }

    private hideScale(): void {
        this.node.setScale(0, 0, 0);
    }

    // ---- node construction ----

    private newNode(name: string, parent: Node, width: number, height: number): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.parent = parent;
        node.addComponent(UITransform).setContentSize(width, height);
        return node;
    }

    private newLabel(parent: Node, name: string, align: number, wrap: boolean): Label {
        const node = this.newNode(name, parent, 10, 10);
        const label = node.addComponent(Label);
        label.overflow = Label.Overflow.SHRINK;
        label.enableWrapText = wrap;
        label.horizontalAlign = align;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.string = '';
        return label;
    }

    private newButton(node: Node, handler: string, customEventData: string): Button {
        const button = node.addComponent(Button);
        const event = new EventHandler();
        event.target = this.node;
        event.component = 'PermanentUpgradeController';
        event.handler = handler;
        event.customEventData = customEventData;
        button.clickEvents = [event];
        return button;
    }

    private placeLabel(label: Label, rect: PermanentUpgradeLocalRect, fontSize: number, lineHeight: number, color: Rgba, text: string): void {
        label.node.setPosition(new Vec3(rect.x, rect.y, 0));
        label.node.getComponent(UITransform)!.setContentSize(rect.w, rect.h);
        label.fontSize = fontSize;
        label.lineHeight = lineHeight;
        label.string = text;
        label.color = colorOf(color);
    }

    private ensureChip(): void {
        if (this.chipBuilt || !this.chipHost) return;
        this.chipBuilt = true;
        const chip = this.newNode('PermanentUpgradeChip', this.chipHost, PERMANENT_UPGRADE_CHIP_WIDTH, PERMANENT_UPGRADE_CHIP_HEIGHT);
        // Behind the HUD cards and the toast band (they never overlap it; a toast may pass over it for a moment).
        chip.setSiblingIndex(0);
        const widget = chip.addComponent(Widget);
        const offsets = permanentUpgradeChipWidgetOffsets();
        widget.isAlignTop = true;
        widget.isAlignRight = true;
        widget.isAlignBottom = widget.isAlignLeft = widget.isAlignHorizontalCenter = false;
        widget.top = offsets.top;
        widget.right = offsets.right;
        widget.alignMode = Widget.AlignMode.ALWAYS;
        chip.on(Node.EventType.TOUCH_START, this.swallowChipTouch, this);
        chip.on(Node.EventType.TOUCH_MOVE, this.swallowChipTouch, this);
        chip.on(Node.EventType.TOUCH_END, this.swallowChipTouch, this);
        chip.on(Node.EventType.TOUCH_CANCEL, this.swallowChipTouch, this);
        const action = this.newNode('PermanentUpgradeChipAction', chip, PERMANENT_UPGRADE_CHIP_WIDTH, PERMANENT_UPGRADE_CHIP_HEIGHT);
        this.chipGraphics = this.newNode('ChipFill', action, PERMANENT_UPGRADE_CHIP_WIDTH, PERMANENT_UPGRADE_CHIP_HEIGHT).addComponent(Graphics);
        this.chipLabel = this.newLabel(action, 'ChipLabel', Label.HorizontalAlign.CENTER, false);
        this.newButton(action, 'onChipPressed', '');
        this.chipNode = chip;
        chip.setScale(0, 0, 0);
    }

    private ensurePanel(): void {
        if (this.panelBuilt) return;
        this.panelBuilt = true;
        const layout = this.layout;
        this.node.layer = Layers.Enum.UI_2D;
        const backdrop = this.backdropNode;
        if (backdrop) {
            backdrop.layer = Layers.Enum.UI_2D;
            backdrop.getComponent(UITransform) ?? backdrop.addComponent(UITransform);
            this.backdropGraphics = backdrop.getComponent(Graphics) ?? backdrop.addComponent(Graphics);
            backdrop.on(Node.EventType.TOUCH_START, this.swallowTouch, this);
            backdrop.on(Node.EventType.TOUCH_MOVE, this.swallowTouch, this);
            backdrop.on(Node.EventType.TOUCH_END, this.onBackdropTouchEnd, this);
            backdrop.on(Node.EventType.TOUCH_CANCEL, this.swallowTouch, this);
        }
        const card = this.newNode('PermanentUpgradePanel', this.safeNode ?? this.node, layout.width, layout.height);
        card.setPosition(new Vec3(0, permanentUpgradePanelCenterOffsetY(), 0));
        this.cardGraphics = card.addComponent(Graphics);
        // The card claims touches on its own area too (it sits above the backdrop; its Buttons are children handled first).
        card.on(Node.EventType.TOUCH_START, this.swallowTouch, this);
        card.on(Node.EventType.TOUCH_MOVE, this.swallowTouch, this);
        card.on(Node.EventType.TOUCH_END, this.swallowTouch, this);
        card.on(Node.EventType.TOUCH_CANCEL, this.swallowTouch, this);
        this.cardNode = card;
        this.titleLabel = this.newLabel(card, 'UpgradesTitle', Label.HorizontalAlign.LEFT, false);
        this.balanceLabel = this.newLabel(card, 'UpgradesBalance', Label.HorizontalAlign.RIGHT, false);
        this.markGraphics = this.newNode('UpgradesMark', card, layout.mark.w, layout.mark.h).addComponent(Graphics);
        this.markGraphics.node.setPosition(new Vec3(layout.mark.x, layout.mark.y, 0));
        for (let i = 0; i < layout.tabs.length; i += 1) {
            const rect = layout.tabs[i];
            const node = this.newNode(`UpgradesTab${i}`, card, rect.w, rect.h);
            node.setPosition(new Vec3(rect.x, rect.y, 0));
            const graphics = this.newNode('TabFill', node, rect.w, rect.h).addComponent(Graphics);
            const label = this.newLabel(node, 'TabLabel', Label.HorizontalAlign.CENTER, false);
            this.newButton(node, 'onTabPressed', String(i));
            this.tabs.push({ node, graphics, label });
        }
        for (let i = 0; i < PERMANENT_UPGRADE_ROW_SLOTS; i += 1) {
            const rowLayout = layout.rows[i];
            const slot = this.newNode(`UpgradesRow${i}`, card, rowLayout.slot.w, rowLayout.slot.h);
            slot.setPosition(new Vec3(rowLayout.slot.x, rowLayout.slot.y, 0));
            const graphics = this.newNode('RowFill', slot, rowLayout.slot.w, rowLayout.slot.h).addComponent(Graphics);
            // Labels are children of the card (positions are card-local), after the row fill so they draw above it.
            const name = this.newLabel(card, `UpgradesName${i}`, Label.HorizontalAlign.LEFT, false);
            const rank = this.newLabel(card, `UpgradesRank${i}`, Label.HorizontalAlign.RIGHT, false);
            const effect = this.newLabel(card, `UpgradesEffect${i}`, Label.HorizontalAlign.LEFT, true);
            const buy = this.newNode(`UpgradesBuy${i}`, card, rowLayout.buy.w, rowLayout.buy.h);
            buy.setPosition(new Vec3(rowLayout.buy.x, rowLayout.buy.y, 0));
            const buyGraphics = this.newNode('BuyFill', buy, rowLayout.buy.w, rowLayout.buy.h).addComponent(Graphics);
            const buyLabel = this.newLabel(buy, 'BuyLabel', Label.HorizontalAlign.CENTER, false);
            const button = this.newButton(buy, 'onBuyPressed', String(i));
            this.rowViews.push({ slot, graphics, name, rank, effect, buy, buyGraphics, buyLabel, button });
        }
        this.pulseGraphics = this.newNode('UpgradesPulse', card, layout.width, layout.height).addComponent(Graphics);
        const close = this.newNode('UpgradesClose', card, layout.close.w, layout.close.h);
        close.setPosition(new Vec3(layout.close.x, layout.close.y, 0));
        this.closeGraphics = this.newNode('CloseFill', close, layout.close.w, layout.close.h).addComponent(Graphics);
        this.closeLabel = this.newLabel(close, 'CloseLabel', Label.HorizontalAlign.CENTER, false);
        this.newButton(close, 'onClosePressed', '');
        this.closeNode = close;
        card.setSiblingIndex(card.parent!.children.length - 1);
    }

    // ---- rendering ----

    private rowsOfBranch(viewModel: PermanentUpgradePanelViewModel): readonly PermanentUpgradeRowViewModel[] {
        const branch = viewModel.branches[this.branchIndex];
        if (!branch) return [];
        return branch.rowIds.map((id) => viewModel.rows.find((row) => row.id === id)).filter((row): row is PermanentUpgradeRowViewModel => row !== undefined);
    }

    private fillRect(graphics: Graphics, w: number, h: number, color: Rgba, outline: Rgba | null = null): void {
        graphics.clear();
        if (outline) {
            graphics.fillColor = colorOf(outline);
            graphics.fillRect(-w / 2, -h / 2, w, h);
            graphics.fillColor = colorOf(color);
            graphics.fillRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4);
            return;
        }
        graphics.fillColor = colorOf(color);
        graphics.fillRect(-w / 2, -h / 2, w, h);
    }

    private fillPolygon(graphics: Graphics, points: readonly PermanentUpgradePoint[], color: Rgba): void {
        graphics.fillColor = colorOf(color);
        points.forEach((point, index) => { if (index === 0) graphics.moveTo(point.x, point.y); else graphics.lineTo(point.x, point.y); });
        graphics.close();
        graphics.fill();
    }

    private renderChip(): void {
        const viewModel = this.viewModel;
        const chip = this.chipNode;
        if (!viewModel || !chip) return;
        const visible = viewModel.chipVisible;
        const key = `${visible}|${viewModel.texts.chip}`;
        if (key === this.chipKey) return;
        this.chipKey = key;
        const colors = PERMANENT_UPGRADE_COLORS;
        const w = PERMANENT_UPGRADE_CHIP_WIDTH;
        const h = PERMANENT_UPGRADE_CHIP_HEIGHT;
        const graphics = this.chipGraphics!;
        this.fillRect(graphics, w, h, colors.graphite, colors.cyan);
        drawAiMark(graphics, -w / 2 + 28, 0, 34);
        this.placeLabel(this.chipLabel!, { x: 22, y: 0, w: 92, h }, PERMANENT_UPGRADE_CHIP_FONT_SIZE, h, colors.text, viewModel.texts.chip);
        const changed = this.chipVisible !== visible;
        this.chipVisible = visible;
        if (visible) chip.setScale(1, 1, 1); else chip.setScale(0, 0, 0);
        if (changed) {
            this.emitReport(visible ? 'chip_shown' : 'chip_hidden', {});
            this.onLayoutChanged?.(visible ? 'permanent_upgrades_chip_shown' : 'permanent_upgrades_chip_hidden');
        }
        if (!visible && this.open) this.closePanel('chip_hidden');
    }

    private renderPanel(): void {
        const viewModel = this.viewModel;
        if (!viewModel || !this.panelBuilt) return;
        const key = `${this.branchIndex}|${this.note}|${this.inFlight}|${viewModel.aiCores}|${viewModel.rows.map((row) => `${row.id}:${row.currentRank}:${row.state}`).join(',')}`;
        if (key === this.panelKey) return;
        this.panelKey = key;
        const colors = PERMANENT_UPGRADE_COLORS;
        const layout = this.layout;
        const card = this.cardGraphics!;
        card.clear();
        card.fillColor = colorOf(colors.pill);
        card.fillRect(-layout.width / 2, -layout.height / 2, layout.width, layout.height);
        card.fillColor = colorOf(colors.cyan);
        card.fillRect(-layout.width / 2, layout.height / 2 - 3, layout.width, 3);

        // Header: title (or the short failure note), AI mark and balance.
        this.placeLabel(this.titleLabel!, layout.title, PERMANENT_UPGRADE_HEADER_FONT_SIZE, layout.title.h, colors.text, viewModel.texts.title);
        if (this.note !== null) {
            this.placeLabel(this.titleLabel!, layout.title, PERMANENT_UPGRADE_RANK_FONT_SIZE, layout.title.h, colors.cyan, this.note);
        }
        this.placeLabel(this.balanceLabel!, layout.balance, PERMANENT_UPGRADE_BALANCE_FONT_SIZE, layout.balance.h, colors.text, viewModel.texts.balance);
        this.markGraphics!.clear();
        drawAiMark(this.markGraphics!, 0, 0, layout.mark.w);

        // Tabs.
        viewModel.branches.forEach((branch, index) => {
            const tab = this.tabs[index];
            const rect = layout.tabs[index];
            const selected = index === this.branchIndex;
            this.fillRect(tab.graphics, rect.w, rect.h, selected ? colors.cyan : colors.graphite, selected ? null : colors.cyan);
            this.placeLabel(tab.label, { x: 0, y: 0, w: rect.w - 28, h: rect.h }, PERMANENT_UPGRADE_TAB_FONT_SIZE, rect.h, selected ? colors.darkText : colors.text, branch.label);
            if (branch.canBuy) this.fillPolygon(tab.graphics, regularPolygonPoints(rect.w / 2 - 14, rect.h / 2 - 14, 6, 10, 0), selected ? colors.darkText : colors.cyan);
        });

        // Rows of the selected branch (at most three slots; unused slots are hidden by scale).
        const rows = this.rowsOfBranch(viewModel);
        this.shownRowIds = rows.map((row) => row.id);
        this.rowViews.forEach((view, index) => {
            const row = rows[index];
            const scale = row ? 1 : 0;
            for (const node of [view.slot, view.name.node, view.rank.node, view.effect.node, view.buy]) node.setScale(scale, scale, scale);
            if (!row) return;
            const rowLayout = layout.rows[index];
            const locked = row.state === 'locked';
            this.fillRect(view.graphics, rowLayout.slot.w, rowLayout.slot.h, locked ? colors.dimFill : colors.rowFill);
            this.placeLabel(view.name, rowLayout.name, PERMANENT_UPGRADE_NAME_FONT_SIZE, rowLayout.name.h, locked ? colors.dimText : colors.text, row.name);
            this.placeLabel(view.rank, rowLayout.rank, PERMANENT_UPGRADE_RANK_FONT_SIZE, rowLayout.rank.h, locked ? colors.dimText : colors.secondary, row.rankText);
            const effectText = locked && row.lockedText !== null ? row.lockedText : row.effectText;
            this.placeLabel(view.effect, rowLayout.effect, PERMANENT_UPGRADE_EFFECT_FONT_SIZE, PERMANENT_UPGRADE_EFFECT_LINE_HEIGHT, locked ? colors.cyan : colors.secondary, effectText);
            this.renderBuy(view, row, rowLayout.buy);
        });

        // CLOSE.
        this.fillRect(this.closeGraphics!, layout.close.w, layout.close.h, colors.graphite, colors.cyan);
        this.placeLabel(this.closeLabel!, { x: 0, y: 0, w: layout.close.w, h: layout.close.h }, PERMANENT_UPGRADE_CLOSE_FONT_SIZE, layout.close.h, colors.text, viewModel.texts.close);
    }

    private renderBuy(view: { buyGraphics: Graphics; buyLabel: Label; button: Button }, row: PermanentUpgradeRowViewModel, rect: PermanentUpgradeLocalRect): void {
        const colors = PERMANENT_UPGRADE_COLORS;
        const graphics = view.buyGraphics;
        const labelRect = { x: 0, y: 0, w: rect.w - 12, h: rect.h };
        const tappable = row.state === 'affordable' && row.command !== null && !this.inFlight;
        view.button.interactable = row.state === 'affordable' && row.command !== null;
        switch (row.state) {
            case 'affordable':
                this.fillRect(graphics, rect.w, rect.h, colors.amber);
                this.placeLabel(view.buyLabel, labelRect, PERMANENT_UPGRADE_BUY_FONT_SIZE, rect.h, colors.darkText, row.buyText);
                // An in-flight purchase dims the button (the debounce is visible; never a node.active toggle).
                if (!tappable) this.fillRect(graphics, rect.w, rect.h, colors.dimText);
                break;
            case 'insufficient':
                this.fillRect(graphics, rect.w, rect.h, colors.graphite, colors.cyan);
                this.placeLabel(view.buyLabel, labelRect, PERMANENT_UPGRADE_BUY_FONT_SIZE, rect.h, colors.secondary, row.buyText);
                break;
            case 'maxed':
                this.fillRect(graphics, rect.w, rect.h, colors.dimFill);
                this.placeLabel(view.buyLabel, labelRect, PERMANENT_UPGRADE_BUY_FONT_SIZE, rect.h, colors.cyan, row.buyText);
                break;
            default: {
                this.fillRect(graphics, rect.w, rect.h, colors.dimFill);
                this.placeLabel(view.buyLabel, { x: 14, y: 0, w: rect.w - 44, h: rect.h }, PERMANENT_UPGRADE_NAME_FONT_SIZE - 4, rect.h, colors.dimText, row.buyText);
                // Lock mark: shackle (two posts and a bar) over a body, all opaque fills.
                const cx = -rect.w / 2 + 24;
                graphics.fillColor = colorOf(colors.dimText);
                graphics.fillRect(cx - 7, -10, 14, 11);
                graphics.fillRect(cx - 5, 1, 3, 8);
                graphics.fillRect(cx + 2, 1, 3, 8);
                graphics.fillRect(cx - 5, 8, 10, 3);
            }
        }
    }

    private startPulse(upgradeId: string): void {
        const viewModel = this.viewModel;
        if (!viewModel) return;
        const index = this.rowsOfBranch(viewModel).findIndex((row) => row.id === upgradeId);
        if (index < 0) return;
        this.pulse = { rect: this.layout.rows[index].slot, elapsed: 0 };
        this.advancePulse(0);
    }

    private advancePulse(deltaTime: number): void {
        const pulse = this.pulse;
        const graphics = this.pulseGraphics;
        if (!pulse || !graphics) return;
        pulse.elapsed += Math.max(0, deltaTime);
        graphics.clear();
        if (pulse.elapsed >= PERMANENT_UPGRADE_PULSE_SECONDS) {
            this.pulse = null;
            return;
        }
        graphics.fillColor = colorOf(PERMANENT_UPGRADE_COLORS.cyan);
        for (const bar of pulseRingBars(pulse.rect, pulse.elapsed / PERMANENT_UPGRADE_PULSE_SECONDS)) graphics.fillRect(bar.x - bar.w / 2, bar.y - bar.h / 2, bar.w, bar.h);
    }

    /** Redraws the full-screen dim backdrop whenever its (Widget-driven) size changes. */
    private drawBackdrop(): void {
        const backdrop = this.backdropNode;
        const graphics = this.backdropGraphics;
        if (!backdrop || !graphics) return;
        const size = backdrop.getComponent(UITransform)!.contentSize;
        const key = `${Math.round(size.width)}x${Math.round(size.height)}`;
        if (key === this.drawnBackdropKey || size.width <= 0 || size.height <= 0) return;
        this.drawnBackdropKey = key;
        graphics.clear();
        graphics.fillColor = colorOf(PERMANENT_UPGRADE_COLORS.backdrop);
        graphics.fillRect(-size.width / 2, -size.height / 2, size.width, size.height);
    }

    // ---- DEBUG diagnostics ----

    private emitReport(phase: string, extra: Record<string, unknown>): void {
        if (!isDeviceDiagnosticsEnabled()) return;
        const rectOf = this.screenRectOf;
        const viewModel = this.viewModel;
        const nodes = this.getRectNodes();
        const rect = (node: Node | null): UiRect | null => (node && rectOf ? rectOf(node) : null);
        emitDeviceEvent('permanent_upgrades', {
            phase,
            tab: viewModel?.branches[this.branchIndex]?.id ?? null,
            ...extra,
            aiCores: viewModel?.aiCores ?? null,
            ranks: viewModel ? Object.fromEntries(viewModel.rows.map((row) => [row.id, row.currentRank])) : null,
            rows: this.open && viewModel ? this.rowsOfBranch(viewModel).map((row) => ({ id: row.id, state: row.state, cost: row.nextRankCost, rank: row.currentRank })) : null,
            texts: this.open && viewModel ? { title: this.titleLabel?.string ?? null, chip: viewModel.texts.chip, note: this.note, rows: this.rowsOfBranch(viewModel).map((row) => ({ name: row.name, rank: row.rankText, effect: row.effectText, buy: row.buyText, locked: row.lockedText })) } : { chip: viewModel?.texts.chip ?? null },
            chipRect: rect(nodes.chip),
            panelRect: rect(nodes.panel),
            rowRects: this.open ? this.rowViews.slice(0, this.shownRowIds.length).map((view) => rect(view.slot)) : [],
            buyRects: nodes.buys.map((node) => rect(node)),
            scale: this.node.scale.x,
        });
    }
}
