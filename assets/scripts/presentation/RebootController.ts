import { _decorator, Button, Color, Component, EventHandler, EventTouch, Graphics, Label, Layers, Node, UITransform, Vec3, Widget } from 'cc';
import type { GameCommand } from '../domain/Commands.ts';
import type { LifecycleCommandResult } from '../lifecycle/LifecycleSessionCoordinator.ts';
import { emitDeviceEvent, isDeviceDiagnosticsEnabled } from './DeviceDiagnostics';
import { fitLabel } from './LabelFit.ts';
import { TEXT_MIN_BODY_FONT_SIZE, TEXT_MIN_BUTTON_FONT_SIZE } from './TextFit.ts';
import { drawAiMark } from './IdentityGraphics';
import {
    REBOOT_BUTTON_FONT_SIZE,
    REBOOT_CHIP_FONT_SIZE,
    REBOOT_CHIP_HEIGHT,
    REBOOT_CHIP_LABEL,
    REBOOT_CHIP_MARK,
    REBOOT_CHIP_WIDTH,
    REBOOT_CIVILIZATION_FONT_SIZE,
    REBOOT_COLORS,
    REBOOT_COLUMN_HEADING_FONT_SIZE,
    REBOOT_COLUMN_LINES,
    REBOOT_COLUMN_LINE_FONT_SIZE,
    REBOOT_COLUMN_LINE_HEIGHT,
    REBOOT_HEADER_FONT_SIZE,
    REBOOT_HERO_FONT_SIZE,
    REBOOT_PROGRESS_FONT_SIZE,
    REBOOT_ACCENT_HEIGHT,
    rebootChipWidgetOffsets,
    rebootPanelCenterOffsetY,
    regularPolygonPoints,
    resolveRebootPanelLayout,
    type RebootColumnLayout,
    type RebootLocalRect,
    type RebootPanelLayout,
} from './RebootLayout.ts';
import { resolveRebootResult, type RebootPanelViewModel } from './RebootPanelViewModel.ts';
import type { UiRect } from './UiLayout.ts';

const { ccclass } = _decorator;

export type RebootCommandEmitter = (command: GameCommand) => Promise<LifecycleCommandResult | null>;
type Rgba = { readonly r: number; readonly g: number; readonly b: number; readonly a: number };

const colorOf = (rgba: Rgba, alpha: number = rgba.a): Color => new Color(rgba.r, rgba.g, rgba.b, alpha);

/** Alpha of the button fills / labels while the confirmed Reboot is in flight (the debounce is visible, never a node.active toggle). */
const BUTTON_IN_FLIGHT_ALPHA = 110;

/**
 * AUT-RBT-001 thin `cc` controller of the Reboot entry chip and confirmation modal. Pure parts (view model, result mapping, layout) live in
 * `RebootPanelViewModel.ts` / `RebootLayout.ts`; this component only builds nodes, draws Graphics fills (a spriteFrame-less Sprite renders
 * nothing on Android), shows the strings the view model composed and submits the view model's own command through `commandEmitter` (the
 * binding). It never evaluates eligibility, rewards or progress.
 *
 * Two-step confirmation: the chip opens the modal; the distinct REBOOT button confirms (no hold-to-confirm). CANCEL and a tap on the dim
 * backdrop both cancel (nothing is submitted); both are inert while the Reboot is in flight. Visibility is scale-based (never `node.active`).
 * The chip is hidden (scale 0) when the Reboot is not eligible, while the modal is open, or while suppressed (offline report card / Reboot
 * title card).
 */
@ccclass('RebootController')
export class RebootController extends Component {
    public backdropNode: Node | null = null;
    public safeNode: Node | null = null;
    /** Where the entry chip lives (the HUD safe-area container); the chip is Widget-anchored on the second line under the HUD band. */
    public chipHost: Node | null = null;
    public commandEmitter: RebootCommandEmitter | null = null;
    /** Reads and clears the bootstrap's "Reboot blocked by the pending offline report" flag (set synchronously by the binding's callback). */
    public consumeBlockedByPendingOffline: (() => boolean) | null = null;
    /** DEBUG only: screen rectangle (bottom-left frame) of a UI node; supplied by FactoryWorldBootstrap (UI camera projection). */
    public screenRectOf: ((node: Node) => UiRect | null) | null = null;
    /** Called after the chip / modal appears or changes so the bootstrap can report a fresh `ui_layout`. */
    public onLayoutChanged: ((reason: string) => void) | null = null;

    private viewModel: RebootPanelViewModel | null = null;
    /** The last eligible model: the open modal keeps drawing it while the in-flight Reboot makes the live model ineligible. */
    private panelModel: RebootPanelViewModel | null = null;
    private layout: RebootPanelLayout = resolveRebootPanelLayout();
    private chipBuilt = false;
    private panelBuilt = false;
    private open = false;
    private inFlight = false;
    private suppressed = false;
    private note: string | null = null;
    private chipVisible: boolean | null = null;
    private chipNode: Node | null = null;
    private chipGraphics: Graphics | null = null;
    private chipLabel: Label | null = null;
    private backdropGraphics: Graphics | null = null;
    private cardNode: Node | null = null;
    private cardGraphics: Graphics | null = null;
    private confirmNode: Node | null = null;
    private confirmGraphics: Graphics | null = null;
    private confirmLabel: Label | null = null;
    private confirmButton: Button | null = null;
    private cancelNode: Node | null = null;
    private cancelGraphics: Graphics | null = null;
    private cancelLabel: Label | null = null;
    private cancelButton: Button | null = null;
    private headerLabel: Label | null = null;
    private heroLabel: Label | null = null;
    private civilizationLabel: Label | null = null;
    private progressLabel: Label | null = null;
    private resetsHeading: Label | null = null;
    private keepsHeading: Label | null = null;
    private resetLines: Label[] = [];
    private keepLines: Label[] = [];
    private drawnBackdropKey = '';
    /** Redraw signatures: refresh() runs for every fresh snapshot (about once per frame), so unchanged views are not redrawn. */
    private chipKey = '';
    private panelKey = '';
    private buttonKey = '';

    public onLoad(): void {
        this.hideScale();
    }

    public update(): void {
        if (this.open) this.drawBackdrop();
    }

    public isOpen(): boolean {
        return this.open;
    }

    public isSuppressed(): boolean {
        return this.suppressed;
    }

    /** DEBUG ui_layout: the nodes whose rects are reported (null while hidden). */
    public getRectNodes(): { chip: Node | null; panel: Node | null; confirm: Node | null; cancel: Node | null } {
        const chipShown = this.chipVisible === true && this.chipNode !== null;
        return {
            chip: chipShown ? this.chipNode : null,
            panel: this.open ? this.cardNode : null,
            confirm: this.open ? this.confirmNode : null,
            cancel: this.open ? this.cancelNode : null,
        };
    }

    /** Sink of the binding: every fresh snapshot (start, every accepted command, every collect) refreshes the chip and the open modal. */
    public refresh(viewModel: RebootPanelViewModel): void {
        this.viewModel = viewModel;
        if (viewModel.visible) this.panelModel = viewModel;
        this.ensureChip();
        if (this.open && !viewModel.visible && !this.inFlight) {
            this.closePanel('no_longer_eligible');
        }
        this.renderChip();
        if (this.open) this.renderPanel();
    }

    /** The offline report card or the Reboot title card owns the screen: hide the chip (inert) and close an idle modal. */
    public setSuppressed(suppressed: boolean): void {
        if (this.suppressed === suppressed) return;
        this.suppressed = suppressed;
        if (suppressed && this.open && !this.inFlight) this.closePanel('suppressed');
        this.renderChip();
    }

    // ---- handlers (Button click events) ----

    public onChipPressed(): void {
        const viewModel = this.viewModel;
        if (this.chipVisible !== true || this.suppressed || this.open || !viewModel || !viewModel.visible || viewModel.command === null) return;
        this.openPanel(viewModel);
    }

    public onCancelPressed(): void {
        if (!this.open || this.inFlight) return;
        this.emitReport('cancel_tapped', {});
        this.closePanel('cancel');
    }

    public onConfirmPressed(): void {
        const viewModel = this.viewModel;
        if (!this.open || !viewModel || viewModel.command === null || this.inFlight) return;
        const emitter = this.commandEmitter;
        if (!emitter) return;
        const command = viewModel.command;
        // Clear any stale "blocked" flag so the flag read at the result belongs to THIS submit.
        this.consumeBlockedByPendingOffline?.();
        this.inFlight = true;
        this.note = null;
        this.renderPanel();
        this.emitReport('confirm_tapped', { aiCoresToGain: viewModel.aiCoresToGain });
        void emitter(command).then((result) => this.onRebootResult(result), () => this.onRebootResult(null));
    }

    private onRebootResult(result: LifecycleCommandResult | null): void {
        const blocked = this.consumeBlockedByPendingOffline?.() ?? false;
        const outcome = resolveRebootResult(result, blocked);
        this.inFlight = false;
        this.emitReport('result', { status: outcome.status, reason: outcome.reason, saveOk: outcome.saveOk, eventTypes: outcome.eventTypes });
        if (outcome.closeModal) {
            this.closePanel(outcome.status === 'blocked_pending_offline' ? 'blocked_pending_offline' : 'confirmed');
            return;
        }
        this.note = outcome.showFailureNote ? (this.panelModel?.texts.failed ?? this.viewModel?.texts.failed ?? null) : null;
        // A rejection may mean the Reboot is no longer eligible: the live model decides whether the modal stays.
        if (this.open && this.viewModel !== null && !this.viewModel.visible) {
            this.closePanel('no_longer_eligible');
            return;
        }
        if (this.open) this.renderPanel();
    }

    // ---- open / close ----

    private openPanel(viewModel: RebootPanelViewModel): void {
        this.ensurePanel();
        this.panelModel = viewModel;
        this.note = null;
        this.inFlight = false;
        this.open = true;
        this.panelKey = '';
        this.buttonKey = '';
        this.renderPanel();
        this.node.setScale(1, 1, 1);
        this.renderChip();
        this.emitReport('opened', {
            aiCoresToGain: viewModel.aiCoresToGain,
            currentAiCores: viewModel.currentAiCores,
            resultingAiCores: viewModel.resultingAiCores,
            currentCivilization: viewModel.currentCivilization,
            resultingCivilization: viewModel.resultingCivilization,
            progressPercent: viewModel.progressPercent,
            texts: { title: viewModel.texts.title, reward: viewModel.texts.reward, civilization: viewModel.texts.civilization, progress: viewModel.texts.progress, resetsHeader: viewModel.texts.resetsHeader, keepsHeader: viewModel.texts.keepsHeader, confirm: viewModel.texts.confirm, cancel: viewModel.texts.cancel, resets: viewModel.resets, persists: viewModel.persists },
            resetsCount: viewModel.resets.length,
            keepsCount: viewModel.persists.length,
        });
        this.onLayoutChanged?.('reboot_opened');
    }

    private closePanel(reason: string): void {
        if (!this.open) return;
        this.open = false;
        this.inFlight = false;
        this.note = null;
        this.hideScale();
        this.renderChip();
        this.emitReport('closed', { reason });
        this.onLayoutChanged?.('reboot_closed');
    }

    private onBackdropTouchEnd(event: EventTouch): void {
        if (!this.open) return;
        event.propagationStopped = true;
        if (this.inFlight) return;
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
        event.component = 'RebootController';
        event.handler = handler;
        event.customEventData = '';
        button.clickEvents = [event];
        return button;
    }

    private placeLabel(label: Label, rect: RebootLocalRect, fontSize: number, lineHeight: number, color: Rgba, text: string, alpha: number = color.a, minFontSize: number = TEXT_MIN_BODY_FONT_SIZE): void {
        label.node.setPosition(new Vec3(rect.x, rect.y, 0));
        label.node.getComponent(UITransform)!.setContentSize(rect.w, rect.h);
        label.fontSize = fontSize;
        label.lineHeight = lineHeight;
        label.string = fitLabel(label, text, minFontSize);
        label.color = colorOf(color, alpha);
    }

    private ensureChip(): void {
        if (this.chipBuilt || !this.chipHost) return;
        this.chipBuilt = true;
        const chip = this.newNode('RebootChip', this.chipHost, REBOOT_CHIP_WIDTH, REBOOT_CHIP_HEIGHT);
        // Behind the HUD cards and the toast band (a toast may pass over it for a moment).
        chip.setSiblingIndex(0);
        const widget = chip.addComponent(Widget);
        const offsets = rebootChipWidgetOffsets();
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
        const action = this.newNode('RebootChipAction', chip, REBOOT_CHIP_WIDTH, REBOOT_CHIP_HEIGHT);
        this.chipGraphics = this.newNode('ChipFill', action, REBOOT_CHIP_WIDTH, REBOOT_CHIP_HEIGHT).addComponent(Graphics);
        this.chipLabel = this.newLabel(action, 'ChipLabel', Label.HorizontalAlign.CENTER);
        this.newButton(action, 'onChipPressed');
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
        const card = this.newNode('RebootPanel', this.safeNode ?? this.node, layout.width, layout.height);
        card.setPosition(new Vec3(0, rebootPanelCenterOffsetY(), 0));
        this.cardGraphics = card.addComponent(Graphics);
        // The card claims touches on its own area too (it sits above the backdrop; its Buttons are children handled first).
        card.on(Node.EventType.TOUCH_START, this.swallowTouch, this);
        card.on(Node.EventType.TOUCH_MOVE, this.swallowTouch, this);
        card.on(Node.EventType.TOUCH_END, this.swallowTouch, this);
        card.on(Node.EventType.TOUCH_CANCEL, this.swallowTouch, this);
        this.cardNode = card;
        this.headerLabel = this.newLabel(card, 'RebootHeader', Label.HorizontalAlign.CENTER);
        this.heroLabel = this.newLabel(card, 'RebootHero', Label.HorizontalAlign.LEFT);
        this.civilizationLabel = this.newLabel(card, 'RebootCivilization', Label.HorizontalAlign.CENTER);
        this.progressLabel = this.newLabel(card, 'RebootProgress', Label.HorizontalAlign.CENTER);
        this.resetsHeading = this.newLabel(card, 'RebootResetsHeading', Label.HorizontalAlign.LEFT);
        this.keepsHeading = this.newLabel(card, 'RebootKeepsHeading', Label.HorizontalAlign.LEFT);
        for (let i = 0; i < REBOOT_COLUMN_LINES; i += 1) {
            this.resetLines.push(this.newLabel(card, `RebootReset${i}`, Label.HorizontalAlign.LEFT));
            this.keepLines.push(this.newLabel(card, `RebootKeep${i}`, Label.HorizontalAlign.LEFT));
        }
        const confirm = this.newNode('RebootConfirm', card, layout.confirm.w, layout.confirm.h);
        confirm.setPosition(new Vec3(layout.confirm.x, layout.confirm.y, 0));
        this.confirmGraphics = this.newNode('ConfirmFill', confirm, layout.confirm.w, layout.confirm.h).addComponent(Graphics);
        this.confirmLabel = this.newLabel(confirm, 'ConfirmLabel', Label.HorizontalAlign.CENTER);
        this.confirmButton = this.newButton(confirm, 'onConfirmPressed');
        this.confirmNode = confirm;
        const cancel = this.newNode('RebootCancel', card, layout.cancel.w, layout.cancel.h);
        cancel.setPosition(new Vec3(layout.cancel.x, layout.cancel.y, 0));
        this.cancelGraphics = this.newNode('CancelFill', cancel, layout.cancel.w, layout.cancel.h).addComponent(Graphics);
        this.cancelLabel = this.newLabel(cancel, 'CancelLabel', Label.HorizontalAlign.CENTER);
        this.cancelButton = this.newButton(cancel, 'onCancelPressed');
        this.cancelNode = cancel;
        card.setSiblingIndex(card.parent!.children.length - 1);
    }

    // ---- rendering ----

    private fillRect(graphics: Graphics, w: number, h: number, color: Rgba, outline: Rgba | null = null, alpha: number = 255): void {
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

    private fillPolygon(graphics: Graphics, points: readonly { readonly x: number; readonly y: number }[], color: Rgba): void {
        graphics.fillColor = colorOf(color);
        points.forEach((point, index) => { if (index === 0) graphics.moveTo(point.x, point.y); else graphics.lineTo(point.x, point.y); });
        graphics.close();
        graphics.fill();
    }

    private renderChip(): void {
        const viewModel = this.viewModel;
        const chip = this.chipNode;
        if (!viewModel || !chip) return;
        const visible = viewModel.visible && !this.suppressed && !this.open;
        const key = `${visible}|${viewModel.texts.chip}`;
        if (key === this.chipKey) return;
        this.chipKey = key;
        const colors = REBOOT_COLORS;
        const w = REBOOT_CHIP_WIDTH;
        const h = REBOOT_CHIP_HEIGHT;
        const graphics = this.chipGraphics!;
        this.fillRect(graphics, w, h, colors.graphite, colors.cyan);
        drawAiMark(graphics, REBOOT_CHIP_MARK.x, REBOOT_CHIP_MARK.y, REBOOT_CHIP_MARK.size);
        this.placeLabel(this.chipLabel!, REBOOT_CHIP_LABEL, REBOOT_CHIP_FONT_SIZE, h, colors.text, viewModel.texts.chip);
        const changed = this.chipVisible !== visible;
        this.chipVisible = visible;
        if (visible) chip.setScale(1, 1, 1); else chip.setScale(0, 0, 0);
        if (changed) {
            this.emitReport(visible ? 'chip_shown' : 'chip_hidden', { chipText: viewModel.texts.chip, aiCoresToGain: viewModel.aiCoresToGain, suppressed: this.suppressed, modalOpen: this.open, eligible: viewModel.visible });
            this.onLayoutChanged?.(visible ? 'reboot_chip_shown' : 'reboot_chip_hidden');
        }
    }

    private renderPanel(): void {
        const viewModel = this.panelModel;
        if (!viewModel || !this.panelBuilt) return;
        const key = `${viewModel.texts.reward}|${viewModel.texts.civilization}|${viewModel.texts.progress}|${viewModel.progressPercent}|${viewModel.resets.join(',')}|${viewModel.persists.join(',')}|${this.note}`;
        if (key !== this.panelKey) {
            this.panelKey = key;
            this.drawCard(viewModel);
        }
        this.renderButtons(viewModel);
    }

    private drawCard(viewModel: RebootPanelViewModel): void {
        const colors = REBOOT_COLORS;
        const layout = this.layout;
        const card = this.cardGraphics!;
        card.clear();
        card.fillColor = colorOf(colors.pill);
        card.fillRect(-layout.width / 2, -layout.height / 2, layout.width, layout.height);
        card.fillColor = colorOf(colors.cyan);
        card.fillRect(-layout.width / 2, layout.height / 2 - REBOOT_ACCENT_HEIGHT, layout.width, REBOOT_ACCENT_HEIGHT);

        // Header, hero (AI mark + reward), Civilization line (also the failure-note slot).
        this.placeLabel(this.headerLabel!, layout.header, REBOOT_HEADER_FONT_SIZE, layout.header.h, colors.text, viewModel.texts.title);
        drawAiMark(card, layout.heroMark.x, layout.heroMark.y, layout.heroMark.w);
        this.placeLabel(this.heroLabel!, layout.hero, REBOOT_HERO_FONT_SIZE, layout.hero.h, colors.cyan, viewModel.texts.reward);
        const civilizationText = this.note ?? viewModel.texts.civilization;
        this.placeLabel(this.civilizationLabel!, layout.civilization, REBOOT_CIVILIZATION_FONT_SIZE, layout.civilization.h, this.note !== null ? colors.cyan : colors.secondary, civilizationText);

        // Progress toward the next AI Core: an opaque track and an opaque cyan fill (formatting of the authoritative ratio only).
        const bar = layout.progressBar;
        card.fillColor = colorOf(colors.rowFill);
        card.fillRect(bar.x - bar.w / 2, bar.y - bar.h / 2, bar.w, bar.h);
        const fillWidth = Math.max(0, Math.min(1, viewModel.progressRatio)) * bar.w;
        if (fillWidth > 0) {
            card.fillColor = colorOf(colors.cyan);
            card.fillRect(bar.x - bar.w / 2, bar.y - bar.h / 2, fillWidth, bar.h);
        }
        this.placeLabel(this.progressLabel!, layout.progressLabel, REBOOT_PROGRESS_FONT_SIZE, layout.progressLabel.h, colors.secondary, viewModel.texts.progress);

        // RESETS / KEEPS columns: a heading plus five lines each; the markers (dim dash / cyan dot) make them readable without colour.
        this.drawColumn(card, layout.resets, this.resetsHeading!, this.resetLines, viewModel.texts.resetsHeader, viewModel.resets, false);
        this.drawColumn(card, layout.keeps, this.keepsHeading!, this.keepLines, viewModel.texts.keepsHeader, viewModel.persists, true);
    }

    private drawColumn(card: Graphics, column: RebootColumnLayout, heading: Label, lines: Label[], headingText: string, items: readonly string[], keeps: boolean): void {
        const colors = REBOOT_COLORS;
        card.fillColor = colorOf(colors.rowFill);
        card.fillRect(column.slot.x - column.slot.w / 2, column.slot.y - column.slot.h / 2, column.slot.w, column.slot.h);
        this.placeLabel(heading, { x: column.heading.x + 30 - 4, y: column.heading.y, w: column.heading.w - 30 + 4, h: column.heading.h }, REBOOT_COLUMN_HEADING_FONT_SIZE, column.heading.h, keeps ? colors.cyan : colors.secondary, headingText);
        for (let i = 0; i < REBOOT_COLUMN_LINES; i += 1) {
            const text = items[i] ?? '';
            this.placeLabel(lines[i], column.lines[i], REBOOT_COLUMN_LINE_FONT_SIZE, REBOOT_COLUMN_LINE_HEIGHT, keeps ? colors.text : colors.secondary, text);
            const marker = column.markers[i];
            if (text.length === 0) continue;
            if (keeps) this.fillPolygon(card, regularPolygonPoints(marker.x, marker.y, 5, 8, 0), colors.cyan);
            else {
                card.fillColor = colorOf(colors.dimText);
                card.fillRect(marker.x - 6, marker.y - 1.5, 12, 3);
            }
        }
    }

    private renderButtons(viewModel: RebootPanelViewModel): void {
        const key = `${viewModel.texts.confirm}|${viewModel.texts.cancel}|${this.inFlight}`;
        if (key === this.buttonKey) return;
        this.buttonKey = key;
        const colors = REBOOT_COLORS;
        const layout = this.layout;
        const alpha = this.inFlight ? BUTTON_IN_FLIGHT_ALPHA : 255;
        this.fillRect(this.confirmGraphics!, layout.confirm.w, layout.confirm.h, colors.cyan, null, alpha);
        this.placeLabel(this.confirmLabel!, { x: 0, y: 0, w: layout.confirm.w - 24, h: layout.confirm.h }, REBOOT_BUTTON_FONT_SIZE, layout.confirm.h, colors.darkText, viewModel.texts.confirm, alpha, TEXT_MIN_BUTTON_FONT_SIZE);
        this.fillRect(this.cancelGraphics!, layout.cancel.w, layout.cancel.h, colors.graphite, colors.cyan, alpha);
        this.placeLabel(this.cancelLabel!, { x: 0, y: 0, w: layout.cancel.w - 24, h: layout.cancel.h }, REBOOT_BUTTON_FONT_SIZE, layout.cancel.h, colors.text, viewModel.texts.cancel, alpha, TEXT_MIN_BUTTON_FONT_SIZE);
        if (this.confirmButton) this.confirmButton.interactable = !this.inFlight;
        if (this.cancelButton) this.cancelButton.interactable = !this.inFlight;
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
        graphics.fillColor = colorOf(REBOOT_COLORS.backdrop);
        graphics.fillRect(-size.width / 2, -size.height / 2, size.width, size.height);
    }

    // ---- DEBUG diagnostics ----

    private emitReport(phase: string, extra: Record<string, unknown>): void {
        if (!isDeviceDiagnosticsEnabled()) return;
        const rectOf = this.screenRectOf;
        const nodes = this.getRectNodes();
        const rect = (node: Node | null): UiRect | null => (node && rectOf ? rectOf(node) : null);
        emitDeviceEvent('reboot_ui', {
            phase,
            ...extra,
            chipRect: rect(nodes.chip),
            panelRect: rect(nodes.panel),
            confirmRect: rect(nodes.confirm),
            cancelRect: rect(nodes.cancel),
            scale: this.node.scale.x,
        });
    }
}
