import { _decorator, Button, Color, Component, EventHandler, EventTouch, Graphics, Label, Layers, Node, UITransform, Vec3, view, Widget } from 'cc';
import { emitDeviceEvent, isDeviceDiagnosticsEnabled } from './DeviceDiagnostics';
import { fitLabel } from './LabelFit.ts';
import type { FounderShopFlow } from './FounderShopFlow.ts';
import { IDENTITY_PALETTE, founderChipIconSlot } from './AutomataIdentity.ts';
import { drawIcon, recordIcon } from './IdentityGraphics';
import {
    FOUNDER_BUY_FONT_SIZE,
    FOUNDER_CHIP_HEIGHT,
    FOUNDER_CHIP_LABEL_FONT_SIZE,
    FOUNDER_CHIP_TAG_FONT_SIZE,
    FOUNDER_CHIP_WIDTH,
    FOUNDER_CLOSE_FONT_SIZE,
    FOUNDER_COLORS,
    FOUNDER_CONTENT_FONT_SIZE,
    FOUNDER_CONTENT_ROW_COUNT,
    FOUNDER_NOTE_FONT_SIZE,
    FOUNDER_PRICE_FONT_SIZE,
    FOUNDER_TITLE_FONT_SIZE,
    founderChipOutlineRects,
    founderChipWidgetOffsets,
    founderPanelCenterOffsetY,
    resolveFounderChipLayout,
    resolveFounderPanelLayout,
    type FounderLocalRect,
    type FounderPanelLayout,
} from './FounderShopLayout.ts';
import { createFounderShopViewModel, founderBuyAlpha, type FounderEntryState, type FounderShopViewModel } from './FounderShopViewModel.ts';
import type { UiRect } from './UiLayout.ts';

const { ccclass } = _decorator;

type Rgba = { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
const colorOf = (rgba: Rgba, alpha: number = rgba.a): Color => new Color(rgba.r, rgba.g, rgba.b, Math.min(rgba.a, alpha));

/** The offer / store product are re-read on this cadence (the flow caches the metadata itself). */
const POLL_SECONDS = 2;

/**
 * AUT-059 thin `cc` controller of the Founder's Pack entry chip and modal. The pure parts live in `FounderShopViewModel.ts`,
 * `FounderShopLayout.ts` and `FounderShopFlow.ts`; this component builds the nodes, draws Graphics fillRects (a spriteFrame-less Sprite
 * renders nothing on Android; no stroke), shows the strings the view model composed and calls `flow.buy()` on BUY. It never submits a
 * `GameCommand`, never touches the game state and never writes a price: the price text is the store metadata the view model passes through.
 *
 * Visibility is scale-based (never `node.active`). A full-screen dim backdrop swallows touches while the modal is open (a tap on it closes
 * it); every button is a Button on its own child node whose hit rect is the drawn rect. The chip is inert while suppressed (offline report
 * card / Reboot title card) or while another modal owns the screen (`setModalBlocked`), and the modal closes when suppressed.
 */
@ccclass('FounderShopController')
export class FounderShopController extends Component {
    public backdropNode: Node | null = null;
    public safeNode: Node | null = null;
    /** Where the chip lives (the HUD safe-area container); Widget-anchored on the third line under the HUD band, right-aligned. */
    public chipHost: Node | null = null;
    public flow: FounderShopFlow | null = null;
    /** DEBUG only: screen rectangle (bottom-left frame) of a UI node; supplied by FactoryWorldBootstrap (UI camera projection). */
    public screenRectOf: ((node: Node) => UiRect | null) | null = null;
    /** Called after the chip / modal appears or changes so the bootstrap can report a fresh `ui_layout`. */
    public onLayoutChanged: ((reason: string) => void) | null = null;

    private layout: FounderPanelLayout = resolveFounderPanelLayout();
    private viewModel: FounderShopViewModel | null = null;
    private chipBuilt = false;
    private panelBuilt = false;
    private open = false;
    private suppressed = false;
    private modalBlocked = false;
    private chipVisible: boolean | null = null;
    private chipNode: Node | null = null;
    private chipGraphics: Graphics | null = null;
    private chipLabel: Label | null = null;
    private chipTag: Label | null = null;
    private chipKey = '';
    private backdropGraphics: Graphics | null = null;
    private cardNode: Node | null = null;
    private cardGraphics: Graphics | null = null;
    private titleLabel: Label | null = null;
    private contentViews: Array<{ node: Node; graphics: Graphics; label: Label }> = [];
    private priceNode: Node | null = null;
    private priceGraphics: Graphics | null = null;
    private priceLabel: Label | null = null;
    private priceValue: Label | null = null;
    private noteLabel: Label | null = null;
    private buyNode: Node | null = null;
    private buyGraphics: Graphics | null = null;
    private buyLabel: Label | null = null;
    private buyButton: Button | null = null;
    private closeNode: Node | null = null;
    private closeGraphics: Graphics | null = null;
    private closeLabel: Label | null = null;
    private drawnBackdropKey = '';
    private panelKey = '';
    private pollSeconds = 0;
    private refreshRequested = false;
    private reportFrames = 0;

    public onLoad(): void {
        this.node.layer = Layers.Enum.UI_2D;
        this.node.setScale(0, 0, 0);
    }

    public update(deltaTime: number): void {
        const step = Number.isFinite(deltaTime) && deltaTime > 0 ? deltaTime : 0;
        if (this.open) this.drawBackdrop();
        this.pollSeconds += step;
        if ((this.refreshRequested || this.pollSeconds >= POLL_SECONDS) && this.flow) {
            this.refreshRequested = false;
            this.pollSeconds = 0;
            void this.flow.refresh();
        }
        if (this.reportFrames > 0) {
            this.reportFrames -= 1;
            if (this.reportFrames === 0 && this.chipVisible === true) this.emitReport('chip_shown', {});
        }
    }

    public isOpen(): boolean {
        return this.open;
    }

    /** Re-reads the offer on the next frame (state changed, session resumed, offline card closed). */
    public requestRefresh(): void {
        this.refreshRequested = true;
    }

    /** The flow's state changed (offer / product refreshed, purchase in flight or finished): redraw. */
    public onFlowChanged(): void {
        this.render();
    }

    /** The offline report card or the Reboot title card owns the screen: hide the chip, keep it inert and close the modal. */
    public setSuppressed(suppressed: boolean): void {
        if (this.suppressed === suppressed) return;
        this.suppressed = suppressed;
        if (suppressed && this.open) this.closePanel('suppressed');
        this.requestRefresh();
        this.chipKey = '';
        this.render();
    }

    /** Another modal (Settings / AI Upgrades / Reboot) is open: the chip cannot open this modal. */
    public setModalBlocked(blocked: boolean): void {
        this.modalBlocked = blocked;
    }

    /** DEBUG ui_layout: the nodes whose rects are reported (null while hidden). */
    public getRectNodes(): { chip: Node | null; panel: Node | null; buy: Node | null; close: Node | null } {
        const chipShown = this.chipVisible === true && this.chipNode !== null;
        const buyShown = this.open && this.viewModel?.modal.buyVisible === true;
        return {
            chip: chipShown ? this.chipNode : null,
            panel: this.open ? this.cardNode : null,
            buy: buyShown ? this.buyNode : null,
            close: this.open ? this.closeNode : null,
        };
    }

    // ---- handlers (Button click events) ----

    public onChipPressed(): void {
        if (this.chipVisible !== true || this.suppressed || this.modalBlocked || this.open) return;
        this.openPanel();
    }

    public onBuyPressed(): void {
        const flow = this.flow;
        const viewModel = this.viewModel;
        if (!this.open || !flow || !viewModel || !viewModel.modal.buyEnabled) return;
        this.emitReport('buy_tapped', {});
        // AUT-071: a rejected flow (it never rejects today; belt and braces) must still re-render so the modal never stays stuck.
        void flow.buy().then((outcome) => {
            this.render();
            this.emitReport('buy_result', { outcome });
        }, () => {
            this.render();
            this.emitReport('buy_result', { outcome: 'failed' });
        });
    }

    public onClosePressed(): void {
        this.closePanel('close_button');
    }

    // ---- open / close ----

    private openPanel(): void {
        this.flow?.dismissNote();
        this.ensurePanel();
        this.open = true;
        this.panelKey = '';
        this.render();
        this.node.setScale(1, 1, 1);
        this.requestRefresh();
        this.emitReport('opened', {});
        this.onLayoutChanged?.('founder_opened');
    }

    private closePanel(reason: string): void {
        if (!this.open) return;
        this.open = false;
        this.node.setScale(0, 0, 0);
        this.flow?.dismissNote();
        this.emitReport('closed', { reason });
        this.onLayoutChanged?.('founder_closed');
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

    // ---- node construction ----

    private newNode(name: string, parent: Node, width: number, height: number): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.parent = parent;
        node.addComponent(UITransform).setContentSize(width, height);
        return node;
    }

    private newLabel(parent: Node, name: string, align: number): Label {
        const node = this.newNode(name, parent, 10, 10);
        const label = node.addComponent(Label);
        label.overflow = Label.Overflow.SHRINK;
        label.enableWrapText = false;
        label.horizontalAlign = align;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.string = '';
        return label;
    }

    private newButton(node: Node, handler: string): Button {
        const button = node.addComponent(Button);
        const event = new EventHandler();
        event.target = this.node;
        event.component = 'FounderShopController';
        event.handler = handler;
        event.customEventData = '';
        button.clickEvents = [event];
        return button;
    }

    private placeLabel(label: Label, rect: FounderLocalRect, fontSize: number, color: Rgba, alpha: number, text: string): void {
        label.node.setPosition(new Vec3(rect.x, rect.y, 0));
        label.node.getComponent(UITransform)!.setContentSize(rect.w, rect.h);
        label.fontSize = fontSize;
        label.lineHeight = rect.h;
        label.string = fitLabel(label, text);
        label.color = colorOf(color, alpha);
    }

    private ensureChip(): void {
        if (this.chipBuilt || !this.chipHost) return;
        this.chipBuilt = true;
        const w = FOUNDER_CHIP_WIDTH;
        const h = FOUNDER_CHIP_HEIGHT;
        const chip = this.newNode('FounderChip', this.chipHost, w, h);
        // Behind the HUD cards and the toast band (like the other chips); created after the HUD rows by the bootstrap.
        chip.setSiblingIndex(0);
        const widget = chip.addComponent(Widget);
        const offsets = founderChipWidgetOffsets();
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
        // The Button node is the chip itself: hit rect = drawn rect.
        this.chipGraphics = this.newNode('ChipFill', chip, w, h).addComponent(Graphics);
        this.chipLabel = this.newLabel(chip, 'ChipLabel', Label.HorizontalAlign.CENTER);
        this.chipTag = this.newLabel(chip, 'ChipTag', Label.HorizontalAlign.CENTER);
        this.newButton(chip, 'onChipPressed');
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
        const card = this.newNode('FounderPanel', this.safeNode ?? this.node, layout.width, layout.height);
        card.setPosition(new Vec3(0, founderPanelCenterOffsetY(), 0));
        this.cardGraphics = card.addComponent(Graphics);
        card.on(Node.EventType.TOUCH_START, this.swallowTouch, this);
        card.on(Node.EventType.TOUCH_MOVE, this.swallowTouch, this);
        card.on(Node.EventType.TOUCH_END, this.swallowTouch, this);
        card.on(Node.EventType.TOUCH_CANCEL, this.swallowTouch, this);
        this.cardNode = card;
        this.titleLabel = this.newLabel(card, 'FounderTitle', Label.HorizontalAlign.LEFT);
        for (let i = 0; i < FOUNDER_CONTENT_ROW_COUNT; i += 1) {
            const rowLayout = layout.contentRows[i];
            const node = this.newNode(`FounderContent${i}`, card, rowLayout.w, rowLayout.h);
            node.setPosition(new Vec3(rowLayout.x, rowLayout.y, 0));
            const graphics = this.newNode('RowFill', node, rowLayout.w, rowLayout.h).addComponent(Graphics);
            const label = this.newLabel(node, 'RowLabel', Label.HorizontalAlign.LEFT);
            this.contentViews.push({ node, graphics, label });
        }
        const price = this.newNode('FounderPrice', card, layout.priceRow.w, layout.priceRow.h);
        price.setPosition(new Vec3(layout.priceRow.x, layout.priceRow.y, 0));
        this.priceGraphics = this.newNode('PriceFill', price, layout.priceRow.w, layout.priceRow.h).addComponent(Graphics);
        this.priceLabel = this.newLabel(price, 'PriceLabel', Label.HorizontalAlign.LEFT);
        this.priceValue = this.newLabel(price, 'PriceValue', Label.HorizontalAlign.RIGHT);
        this.priceNode = price;
        this.noteLabel = this.newLabel(card, 'FounderNote', Label.HorizontalAlign.CENTER);
        const buy = this.newNode('FounderBuy', card, layout.buy.w, layout.buy.h);
        buy.setPosition(new Vec3(layout.buy.x, layout.buy.y, 0));
        this.buyGraphics = this.newNode('BuyFill', buy, layout.buy.w, layout.buy.h).addComponent(Graphics);
        this.buyLabel = this.newLabel(buy, 'BuyLabel', Label.HorizontalAlign.CENTER);
        this.buyButton = this.newButton(buy, 'onBuyPressed');
        this.buyNode = buy;
        const close = this.newNode('FounderClose', card, layout.close.w, layout.close.h);
        close.setPosition(new Vec3(layout.close.x, layout.close.y, 0));
        this.closeGraphics = this.newNode('CloseFill', close, layout.close.w, layout.close.h).addComponent(Graphics);
        this.closeLabel = this.newLabel(close, 'CloseLabel', Label.HorizontalAlign.CENTER);
        this.newButton(close, 'onClosePressed');
        this.closeNode = close;
        card.setSiblingIndex(card.parent!.children.length - 1);
    }

    // ---- rendering ----

    private fillRect(graphics: Graphics, w: number, h: number, color: Rgba, alpha: number, outline: Rgba | null = null): void {
        graphics.clear();
        if (outline) {
            graphics.fillColor = colorOf(outline, alpha);
            graphics.fillRect(-w / 2, -h / 2, w, h);
            graphics.fillColor = colorOf(color, alpha);
            graphics.fillRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4);
            return;
        }
        graphics.fillColor = colorOf(color, alpha);
        graphics.fillRect(-w / 2, -h / 2, w, h);
    }

    private accentOf(state: FounderEntryState): Rgba {
        return state === 'owned' ? FOUNDER_COLORS.cyan : state === 'pending' ? FOUNDER_COLORS.secondary : FOUNDER_COLORS.amber;
    }

    private render(): void {
        this.ensureChip();
        const chip = this.chipNode;
        if (!chip) return;
        const base = createFounderShopViewModel(this.flow?.getState() ?? null);
        const viewModel: FounderShopViewModel = this.suppressed ? Object.freeze({ ...base, chip: Object.freeze({ ...base.chip, visible: false }) }) : base;
        this.viewModel = viewModel;
        this.renderChip(viewModel);
        if (this.open) {
            if (!viewModel.chip.visible) this.closePanel('no_longer_offered');
            else this.renderPanel(viewModel);
        }
    }

    private renderChip(viewModel: FounderShopViewModel): void {
        const chip = this.chipNode!;
        const model = viewModel.chip;
        const key = `${model.visible}|${model.state}|${model.label}|${model.tag}`;
        if (key === this.chipKey) return;
        this.chipKey = key;
        const colors = FOUNDER_COLORS;
        const outline = founderChipOutlineRects();
        const graphics = this.chipGraphics!;
        graphics.clear();
        graphics.fillColor = colorOf(this.accentOf(model.state), model.alpha);
        graphics.fillRect(-outline.outer.w / 2, -outline.outer.h / 2, outline.outer.w, outline.outer.h);
        graphics.fillColor = colorOf(colors.graphite, model.alpha);
        graphics.fillRect(-outline.inner.w / 2, -outline.inner.h / 2, outline.inner.w, outline.inner.h);
        const chipLayout = resolveFounderChipLayout();
        // AUT-066: the Robot icon (off-white / amber; Founder gold stays on the Founder robot) at the left edge of the chip.
        const iconSlot = founderChipIconSlot();
        drawIcon(graphics, 'robot', iconSlot.x, iconSlot.y, iconSlot.size, { ink: IDENTITY_PALETTE.offWhite, accent: IDENTITY_PALETTE.amber, alpha: model.alpha });
        recordIcon({ slot: iconSlot.slot, icon: 'robot', node: graphics.node, x: iconSlot.x, y: iconSlot.y, size: iconSlot.size });
        this.placeLabel(this.chipLabel!, chipLayout.label, FOUNDER_CHIP_LABEL_FONT_SIZE, colors.text, model.alpha, model.label);
        this.placeLabel(this.chipTag!, chipLayout.tag, FOUNDER_CHIP_TAG_FONT_SIZE, colors.secondary, model.alpha, model.tag);
        const changed = this.chipVisible !== model.visible;
        this.chipVisible = model.visible;
        if (model.visible) chip.setScale(1, 1, 1); else chip.setScale(0, 0, 0);
        if (changed) {
            if (model.visible) this.reportFrames = 4; else this.emitReport('chip_hidden', {});
            this.onLayoutChanged?.(model.visible ? 'founder_chip_shown' : 'founder_chip_hidden');
        }
    }

    private renderPanel(viewModel: FounderShopViewModel): void {
        if (!this.panelBuilt) return;
        const modal = viewModel.modal;
        const key = JSON.stringify(modal);
        if (key === this.panelKey) return;
        this.panelKey = key;
        const colors = FOUNDER_COLORS;
        const layout = this.layout;
        const card = this.cardGraphics!;
        card.clear();
        card.fillColor = colorOf(colors.pill);
        card.fillRect(-layout.width / 2, -layout.height / 2, layout.width, layout.height);
        card.fillColor = colorOf(this.accentOf(modal.state));
        card.fillRect(-layout.width / 2, layout.height / 2 - 3, layout.width, 3);
        this.placeLabel(this.titleLabel!, layout.title, FOUNDER_TITLE_FONT_SIZE, colors.text, 255, modal.title);
        modal.contents.forEach((text, index) => {
            const view = this.contentViews[index];
            const rowLayout = layout.contentRows[index];
            if (!view) return;
            this.fillRect(view.graphics, rowLayout.w, rowLayout.h, colors.rowFill, 255);
            this.placeLabel(view.label, { x: 0, y: 0, w: rowLayout.w - 28, h: rowLayout.h }, FOUNDER_CONTENT_FONT_SIZE, colors.text, 255, text);
        });
        const priceRow = layout.priceRow;
        this.priceNode!.setScale(modal.priceVisible ? 1 : 0, modal.priceVisible ? 1 : 0, 1);
        this.fillRect(this.priceGraphics!, priceRow.w, priceRow.h, colors.dimFill, 255);
        this.placeLabel(this.priceLabel!, layout.priceLabel, FOUNDER_PRICE_FONT_SIZE, colors.secondary, 255, modal.priceLabel);
        this.placeLabel(this.priceValue!, layout.priceValue, FOUNDER_PRICE_FONT_SIZE, modal.priceFromStore ? colors.text : colors.dimText, 255, modal.priceText);
        // The note line shows the last-attempt note, else the in-progress / pending / owned status, else nothing.
        const noteText = modal.note ?? modal.status ?? '';
        this.placeLabel(this.noteLabel!, layout.note, FOUNDER_NOTE_FONT_SIZE, modal.note ? colors.amber : colors.secondary, 255, noteText);
        const buy = layout.buy;
        const buyAlpha = founderBuyAlpha(modal);
        this.buyNode!.setScale(modal.buyVisible ? 1 : 0, modal.buyVisible ? 1 : 0, 1);
        this.buyButton!.interactable = modal.buyEnabled;
        this.fillRect(this.buyGraphics!, buy.w, buy.h, colors.cyan, buyAlpha);
        this.placeLabel(this.buyLabel!, { x: 0, y: 0, w: buy.w, h: buy.h }, FOUNDER_BUY_FONT_SIZE, colors.darkText, buyAlpha, modal.buyLabel);
        this.fillRect(this.closeGraphics!, layout.close.w, layout.close.h, colors.graphite, 255, colors.cyan);
        this.placeLabel(this.closeLabel!, { x: 0, y: 0, w: layout.close.w, h: layout.close.h }, FOUNDER_CLOSE_FONT_SIZE, colors.text, 255, modal.close);
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
        graphics.fillColor = colorOf(FOUNDER_COLORS.backdrop);
        graphics.fillRect(-size.width / 2, -size.height / 2, size.width, size.height);
    }

    // ---- DEBUG diagnostics ----

    private emitReport(phase: string, extra: Record<string, unknown>): void {
        if (!isDeviceDiagnosticsEnabled()) return;
        const rectOf = this.screenRectOf;
        const nodes = this.getRectNodes();
        const rect = (node: Node | null): UiRect | null => (node && rectOf ? rectOf(node) : null);
        // Effective (post-SHRINK) font size in design units: Label.actualFontSize is in render pixels (see the bootstrap's HUD fontOf).
        const fontOf = (label: Label | null): number | null => {
            if (!label || label.string.length === 0) return null;
            let renderScale = view.getScaleX();
            if (renderScale * label.fontSize > 100 && label.fontSize < 100) renderScale = 100 / label.fontSize;
            return label.actualFontSize / Math.max(1, renderScale);
        };
        const modal = this.viewModel?.modal ?? null;
        emitDeviceEvent('founder_shop', {
            phase,
            ...extra,
            state: this.viewModel?.chip.state ?? null,
            chipVisible: this.chipVisible === true,
            chipLabel: this.viewModel?.chip.label ?? null,
            chipTag: this.viewModel?.chip.tag ?? null,
            open: this.open,
            priceText: modal?.priceText ?? null,
            priceFromStore: modal?.priceFromStore ?? null,
            buyVisible: modal?.buyVisible ?? null,
            buyEnabled: modal?.buyEnabled ?? null,
            buyLabel: modal?.buyLabel ?? null,
            status: modal?.status ?? null,
            note: modal?.note ?? null,
            contents: modal?.contents ?? null,
            chipRect: rect(nodes.chip),
            panelRect: rect(nodes.panel),
            buyRect: rect(nodes.buy),
            closeRect: rect(nodes.close),
            chipLabelFontSize: fontOf(this.chipLabel),
            chipTagFontSize: fontOf(this.chipTag),
            buyFontSize: this.open ? fontOf(this.buyLabel) : null,
            suppressed: this.suppressed,
        });
    }
}
