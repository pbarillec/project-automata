import { _decorator, Button, Color, Component, EventHandler, EventTouch, Graphics, Label, Layers, Node, UITransform, Vec3, Widget } from 'cc';
import { getTextCatalogue } from '../localization/index.ts';
import type { SettingsStore } from '../settings/SettingsStore.ts';
import type { UserSettings } from '../settings/UserSettings.ts';
import { emitDeviceEvent, isDeviceDiagnosticsEnabled } from './DeviceDiagnostics';
import { fitLabel } from './LabelFit.ts';
import { TEXT_MIN_BODY_FONT_SIZE, TEXT_MIN_BUTTON_FONT_SIZE } from './TextFit.ts';
import {
    SETTINGS_CHIP_FONT_SIZE,
    SETTINGS_CHIP_HEIGHT,
    SETTINGS_CHIP_WIDTH,
    SETTINGS_CLOSE_FONT_SIZE,
    SETTINGS_COLORS,
    SETTINGS_HEADER_FONT_SIZE,
    SETTINGS_PILL_FONT_SIZE,
    SETTINGS_ROW_COUNT,
    SETTINGS_ROW_COUNT_WITH_PRIVACY,
    SETTINGS_ROW_FONT_SIZE,
    gearPoints,
    resolveSettingsPanelLayout,
    settingsChipWidgetOffsets,
    settingsPanelCenterOffsetY,
    type SettingsLocalRect,
    type SettingsPanelLayout,
    type SettingsPoint,
} from './SettingsLayout.ts';
import { createSettingsViewModel, type SettingsRowViewModel, type SettingsViewModel } from './SettingsViewModel.ts';
import type { UiRect } from './UiLayout.ts';

const { ccclass } = _decorator;

type Rgba = { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
const colorOf = (rgba: Rgba): Color => new Color(rgba.r, rgba.g, rgba.b, rgba.a);

/**
 * AUT-052 thin `cc` controller of the Settings entry chip and modal panel. Pure parts (view model, layout) live in
 * `SettingsViewModel.ts` / `SettingsLayout.ts`; this component builds nodes, draws Graphics fills (a spriteFrame-less Sprite renders
 * nothing on Android), displays the strings the view model composed, and hands a toggle's patch to `SettingsStore.update`. It never
 * submits a `GameCommand` and never touches the game state; other services (audio / haptics) follow the store through its subscription.
 *
 * Visibility is scale-based (never `node.active`). A full-screen dim backdrop swallows touches while the panel is open and a tap on
 * it (outside the card) closes the panel; CLOSE always works. Every button is a Button on its own child node whose hit rect is the
 * drawn rect (a toggle's hit rect is its whole row). The chip is inert while suppressed (offline report card / Reboot title card).
 */
@ccclass('SettingsController')
export class SettingsController extends Component {
    public backdropNode: Node | null = null;
    public safeNode: Node | null = null;
    /** Where the entry chip lives (the HUD safe-area container); Widget-anchored below the HUD band, left-aligned. */
    public chipHost: Node | null = null;
    public settingsStore: SettingsStore | null = null;
    /** DEBUG only: screen rectangle (bottom-left frame) of a UI node; supplied by FactoryWorldBootstrap (UI camera projection). */
    public screenRectOf: ((node: Node) => UiRect | null) | null = null;
    /** Called after the chip / panel appears or changes so the bootstrap can report a fresh `ui_layout`. */
    public onLayoutChanged: ((reason: string) => void) | null = null;
    /** DEBUG only: how many missing-text reports the catalogue sink has counted (supplied by the bootstrap). */
    public missingTextCount: (() => number) | null = null;
    /** AUT-065: whether the consent provider requires the "Privacy options" row (read on every refresh; supplied by the bootstrap). */
    public privacyOptionsRequired: (() => boolean) | null = null;
    /** AUT-065: the Privacy options row was tapped (the bootstrap asks the consent service to reopen the platform form). */
    public onPrivacyOptionsRequested: (() => void) | null = null;

    private viewModel: SettingsViewModel | null = null;
    private layout: SettingsPanelLayout = resolveSettingsPanelLayout();
    /** AUT-065: rows currently laid out (4, or 5 with the Privacy options row). */
    private layoutRows = SETTINGS_ROW_COUNT;
    private chipBuilt = false;
    private panelBuilt = false;
    private open = false;
    private suppressed = false;
    private chipVisible: boolean | null = null;
    private chipNode: Node | null = null;
    private chipGraphics: Graphics | null = null;
    private chipLabel: Label | null = null;
    private backdropGraphics: Graphics | null = null;
    private cardNode: Node | null = null;
    private cardGraphics: Graphics | null = null;
    private titleLabel: Label | null = null;
    private closeNode: Node | null = null;
    private closeGraphics: Graphics | null = null;
    private closeLabel: Label | null = null;
    private rowViews: Array<{ node: Node; graphics: Graphics; label: Label; pill: Graphics; pillLabel: Label; button: Button }> = [];
    private drawnBackdropKey = '';
    private chipKey = '';
    /** Frames left before the DEBUG `chip_shown` report (the Widget / UI camera need a couple of frames before the rect is real). */
    private chipReportFrames = 0;
    private panelKey = '';

    public onLoad(): void {
        this.hideScale();
    }

    public update(): void {
        if (this.open) this.drawBackdrop();
        if (this.chipReportFrames > 0) {
            this.chipReportFrames -= 1;
            if (this.chipReportFrames === 0 && this.chipVisible === true) this.emitReport('chip_shown', {});
        }
    }

    public isOpen(): boolean {
        return this.open;
    }

    public isSuppressed(): boolean {
        return this.suppressed;
    }

    /** DEBUG ui_layout: the nodes whose rects are reported (null while hidden). */
    public getRectNodes(): { chip: Node | null; panel: Node | null; close: Node | null; rows: Array<Node | null> } {
        const chipShown = this.chipVisible === true && this.chipNode !== null;
        return {
            chip: chipShown ? this.chipNode : null,
            panel: this.open ? this.cardNode : null,
            close: this.open ? this.closeNode : null,
            rows: this.rowViews.map((row, index) => (this.open && index < this.layoutRows ? row.node : null)),
        };
    }

    /** Builds the chip on the first call and (re)draws it and the open panel from the store's current settings. */
    public refresh(): void {
        const store = this.settingsStore;
        if (!store) return;
        this.viewModel = createSettingsViewModel(store.get(), getTextCatalogue(store.get().language), { privacyOptionsRequired: this.privacyOptionsRequired?.() === true });
        this.ensureChip();
        this.renderChip();
        if (this.open) this.renderPanel();
    }

    /** The offline report card or the Reboot title card owns the screen: hide the chip, inert, and close the panel. */
    public setSuppressed(suppressed: boolean): void {
        if (this.suppressed === suppressed) return;
        this.suppressed = suppressed;
        if (suppressed && this.open) this.closePanel('suppressed');
        this.chipKey = '';
        this.renderChip();
    }

    // ---- handlers (Button click events) ----

    public onChipPressed(): void {
        if (this.chipVisible !== true || this.suppressed || !this.viewModel) return;
        this.openPanel();
    }

    public onRowPressed(_event: unknown, customEventData: string): void {
        const viewModel = this.viewModel;
        const store = this.settingsStore;
        if (!this.open || !viewModel || !store) return;
        const row = viewModel.rows[Number(customEventData)];
        if (row && row.tappable && row.action === 'privacy_options') {
            this.emitReport('privacy_options_tapped', {});
            this.onPrivacyOptionsRequested?.();
            return;
        }
        if (!row || !row.tappable || row.patch === null) return;
        const saved = store.update(row.patch);
        this.refresh();
        this.emitReport('toggled', { setting: row.setting, value: this.valueOf(store.get(), row), saved });
    }

    public onClosePressed(): void {
        this.closePanel('close_button');
    }

    private valueOf(settings: UserSettings, row: SettingsRowViewModel): boolean | string {
        if (row.setting === 'privacy') return 'privacy_options';
        return row.setting === 'language' ? settings.language : settings[row.setting];
    }

    // ---- open / close ----

    private openPanel(): void {
        if (!this.viewModel) return;
        this.ensurePanel();
        this.open = true;
        this.panelKey = '';
        this.renderPanel();
        this.node.setScale(1, 1, 1);
        this.emitReport('opened', {});
        this.onLayoutChanged?.('settings_opened');
    }

    private closePanel(reason: string): void {
        if (!this.open) return;
        this.open = false;
        this.hideScale();
        this.emitReport('closed', { reason });
        this.onLayoutChanged?.('settings_closed');
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

    private newButton(node: Node, handler: string, customEventData: string): Button {
        const button = node.addComponent(Button);
        const event = new EventHandler();
        event.target = this.node;
        event.component = 'SettingsController';
        event.handler = handler;
        event.customEventData = customEventData;
        button.clickEvents = [event];
        return button;
    }

    private placeLabel(label: Label, rect: SettingsLocalRect, fontSize: number, color: Rgba, text: string, minFontSize: number = TEXT_MIN_BODY_FONT_SIZE): void {
        label.node.setPosition(new Vec3(rect.x, rect.y, 0));
        label.node.getComponent(UITransform)!.setContentSize(rect.w, rect.h);
        label.fontSize = fontSize;
        label.lineHeight = rect.h;
        label.string = fitLabel(label, text, minFontSize);
        label.color = colorOf(color);
    }

    private ensureChip(): void {
        if (this.chipBuilt || !this.chipHost) return;
        this.chipBuilt = true;
        const chip = this.newNode('SettingsChip', this.chipHost, SETTINGS_CHIP_WIDTH, SETTINGS_CHIP_HEIGHT);
        // Behind the HUD cards and the toast band (a toast may pass over it for a moment); the AI chip also sits at sibling 0.
        chip.setSiblingIndex(0);
        const widget = chip.addComponent(Widget);
        const offsets = settingsChipWidgetOffsets();
        widget.isAlignTop = true;
        widget.isAlignLeft = true;
        widget.isAlignBottom = widget.isAlignRight = widget.isAlignHorizontalCenter = false;
        widget.top = offsets.top;
        widget.left = offsets.left;
        widget.alignMode = Widget.AlignMode.ALWAYS;
        chip.on(Node.EventType.TOUCH_START, this.swallowChipTouch, this);
        chip.on(Node.EventType.TOUCH_MOVE, this.swallowChipTouch, this);
        chip.on(Node.EventType.TOUCH_END, this.swallowChipTouch, this);
        chip.on(Node.EventType.TOUCH_CANCEL, this.swallowChipTouch, this);
        const action = this.newNode('SettingsChipAction', chip, SETTINGS_CHIP_WIDTH, SETTINGS_CHIP_HEIGHT);
        this.chipGraphics = this.newNode('ChipFill', action, SETTINGS_CHIP_WIDTH, SETTINGS_CHIP_HEIGHT).addComponent(Graphics);
        this.chipLabel = this.newLabel(action, 'ChipLabel', Label.HorizontalAlign.CENTER);
        this.newButton(action, 'onChipPressed', '');
        this.chipNode = chip;
        chip.setScale(0, 0, 0);
    }

    private ensurePanel(): void {
        if (this.panelBuilt) return;
        this.panelBuilt = true;
        // AUT-065: nodes are built for the largest layout (with the Privacy options row); renderPanel() lays out the rows actually shown.
        const layout = resolveSettingsPanelLayout(SETTINGS_ROW_COUNT_WITH_PRIVACY);
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
        const card = this.newNode('SettingsPanel', this.safeNode ?? this.node, layout.width, layout.height);
        card.setPosition(new Vec3(0, settingsPanelCenterOffsetY(), 0));
        this.cardGraphics = card.addComponent(Graphics);
        card.on(Node.EventType.TOUCH_START, this.swallowTouch, this);
        card.on(Node.EventType.TOUCH_MOVE, this.swallowTouch, this);
        card.on(Node.EventType.TOUCH_END, this.swallowTouch, this);
        card.on(Node.EventType.TOUCH_CANCEL, this.swallowTouch, this);
        this.cardNode = card;
        this.titleLabel = this.newLabel(card, 'SettingsTitle', Label.HorizontalAlign.LEFT);
        for (let i = 0; i < SETTINGS_ROW_COUNT_WITH_PRIVACY; i += 1) {
            const rowLayout = layout.rows[i];
            // The whole row is the Button node (hit rect = drawn rect); fill, label and pill are its children.
            const node = this.newNode(`SettingsRow${i}`, card, rowLayout.slot.w, rowLayout.slot.h);
            node.setPosition(new Vec3(rowLayout.slot.x, rowLayout.slot.y, 0));
            const graphics = this.newNode('RowFill', node, rowLayout.slot.w, rowLayout.slot.h).addComponent(Graphics);
            const label = this.newLabel(node, 'RowLabel', Label.HorizontalAlign.LEFT);
            const pillNode = this.newNode('RowPill', node, rowLayout.pill.w, rowLayout.pill.h);
            pillNode.setPosition(new Vec3(rowLayout.pill.x, 0, 0));
            const pill = this.newNode('PillFill', pillNode, rowLayout.pill.w, rowLayout.pill.h).addComponent(Graphics);
            const pillLabel = this.newLabel(pillNode, 'PillLabel', Label.HorizontalAlign.CENTER);
            const button = this.newButton(node, 'onRowPressed', String(i));
            this.rowViews.push({ node, graphics, label, pill, pillLabel, button });
        }
        const close = this.newNode('SettingsClose', card, layout.close.w, layout.close.h);
        close.setPosition(new Vec3(layout.close.x, layout.close.y, 0));
        this.closeGraphics = this.newNode('CloseFill', close, layout.close.w, layout.close.h).addComponent(Graphics);
        this.closeLabel = this.newLabel(close, 'CloseLabel', Label.HorizontalAlign.CENTER);
        this.newButton(close, 'onClosePressed', '');
        this.closeNode = close;
        card.setSiblingIndex(card.parent!.children.length - 1);
    }

    // ---- rendering ----

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

    private fillPolygon(graphics: Graphics, points: readonly SettingsPoint[], color: Rgba): void {
        graphics.fillColor = colorOf(color);
        points.forEach((point, index) => { if (index === 0) graphics.moveTo(point.x, point.y); else graphics.lineTo(point.x, point.y); });
        graphics.close();
        graphics.fill();
    }

    /** Placeholder gear mark (cyan cog, graphite hub); procedural, no asset. */
    private drawGear(graphics: Graphics, cx: number, cy: number): void {
        const colors = SETTINGS_COLORS;
        this.fillPolygon(graphics, gearPoints(cx, cy, 15, 11, 8), colors.cyan);
        this.fillPolygon(graphics, gearPoints(cx, cy, 5, 5, 8), colors.graphite);
    }

    private renderChip(): void {
        const viewModel = this.viewModel;
        const chip = this.chipNode;
        if (!viewModel || !chip) return;
        const visible = !this.suppressed;
        const key = `${visible}|${viewModel.texts.chip}`;
        if (key === this.chipKey) return;
        this.chipKey = key;
        const colors = SETTINGS_COLORS;
        const w = SETTINGS_CHIP_WIDTH;
        const h = SETTINGS_CHIP_HEIGHT;
        this.fillRect(this.chipGraphics!, w, h, colors.graphite, colors.cyan);
        this.drawGear(this.chipGraphics!, -w / 2 + 28, 0);
        this.placeLabel(this.chipLabel!, { x: 24, y: 0, w: 62, h }, SETTINGS_CHIP_FONT_SIZE, colors.text, viewModel.texts.chip);
        const changed = this.chipVisible !== visible;
        this.chipVisible = visible;
        if (visible) chip.setScale(1, 1, 1); else chip.setScale(0, 0, 0);
        if (changed) {
            if (visible) this.chipReportFrames = 4; else this.emitReport('chip_hidden', {});
            this.onLayoutChanged?.(visible ? 'settings_chip_shown' : 'settings_chip_hidden');
        }
    }

    private renderPanel(): void {
        const viewModel = this.viewModel;
        if (!viewModel || !this.panelBuilt) return;
        const key = viewModel.rows.map((row) => `${row.id}:${row.valueText}`).join(',');
        if (key === this.panelKey) return;
        this.panelKey = key;
        this.applyRowCount(viewModel.rows.length);
        const colors = SETTINGS_COLORS;
        const layout = this.layout;
        const card = this.cardGraphics!;
        card.clear();
        card.fillColor = colorOf(colors.pill);
        card.fillRect(-layout.width / 2, -layout.height / 2, layout.width, layout.height);
        card.fillColor = colorOf(colors.cyan);
        card.fillRect(-layout.width / 2, layout.height / 2 - 3, layout.width, 3);
        this.placeLabel(this.titleLabel!, layout.title, SETTINGS_HEADER_FONT_SIZE, colors.text, viewModel.texts.title);
        viewModel.rows.forEach((row, index) => {
            const view = this.rowViews[index];
            const rowLayout = layout.rows[index];
            this.fillRect(view.graphics, rowLayout.slot.w, rowLayout.slot.h, row.tappable ? colors.rowFill : colors.dimFill);
            this.placeLabel(view.label, { x: rowLayout.label.x, y: 0, w: rowLayout.label.w, h: rowLayout.label.h }, SETTINGS_ROW_FONT_SIZE, row.tappable ? colors.text : colors.secondary, row.label);
            view.button.interactable = row.tappable;
            const pillRect = { x: 0, y: 0, w: rowLayout.pill.w, h: rowLayout.pill.h };
            if (row.on === true) {
                this.fillRect(view.pill, pillRect.w, pillRect.h, colors.cyan);
                this.placeLabel(view.pillLabel, pillRect, SETTINGS_PILL_FONT_SIZE, colors.darkText, row.valueText);
            } else if (row.on === false) {
                this.fillRect(view.pill, pillRect.w, pillRect.h, colors.graphite, colors.cyan);
                this.placeLabel(view.pillLabel, pillRect, SETTINGS_PILL_FONT_SIZE, colors.secondary, row.valueText);
            } else if (row.action !== null) {
                // AUT-065: a tappable action pill (Privacy options): graphite + cyan outline like OFF, but with the primary text colour.
                this.fillRect(view.pill, pillRect.w, pillRect.h, colors.graphite, colors.cyan);
                this.placeLabel(view.pillLabel, pillRect, SETTINGS_PILL_FONT_SIZE, colors.text, row.valueText);
            } else {
                this.fillRect(view.pill, pillRect.w, pillRect.h, colors.dimFill);
                this.placeLabel(view.pillLabel, pillRect, SETTINGS_PILL_FONT_SIZE, colors.dimText, row.valueText);
            }
        });
        this.fillRect(this.closeGraphics!, layout.close.w, layout.close.h, colors.graphite, colors.cyan);
        this.placeLabel(this.closeLabel!, { x: 0, y: 0, w: layout.close.w, h: layout.close.h }, SETTINGS_CLOSE_FONT_SIZE, colors.text, viewModel.texts.close, TEXT_MIN_BUTTON_FONT_SIZE);
    }

    /** AUT-065: resizes the card and repositions the title / rows / CLOSE for the number of rows shown (the extra row is hidden by scale). */
    private applyRowCount(rowCount: number): void {
        const count = Math.max(SETTINGS_ROW_COUNT, Math.min(SETTINGS_ROW_COUNT_WITH_PRIVACY, rowCount));
        this.layoutRows = count;
        const layout = resolveSettingsPanelLayout(count);
        this.layout = layout;
        const card = this.cardNode;
        if (card) card.getComponent(UITransform)!.setContentSize(layout.width, layout.height);
        this.rowViews.forEach((view, index) => {
            const rowLayout = layout.rows[index];
            if (rowLayout) {
                view.node.setPosition(new Vec3(rowLayout.slot.x, rowLayout.slot.y, 0));
                view.node.setScale(1, 1, 1);
            } else {
                view.node.setScale(0, 0, 0);
            }
        });
        if (this.closeNode) this.closeNode.setPosition(new Vec3(layout.close.x, layout.close.y, 0));
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
        graphics.fillColor = colorOf(SETTINGS_COLORS.backdrop);
        graphics.fillRect(-size.width / 2, -size.height / 2, size.width, size.height);
    }

    // ---- DEBUG diagnostics ----

    private emitReport(phase: string, extra: Record<string, unknown>): void {
        if (!isDeviceDiagnosticsEnabled()) return;
        const rectOf = this.screenRectOf;
        const nodes = this.getRectNodes();
        const rect = (node: Node | null): UiRect | null => (node && rectOf ? rectOf(node) : null);
        const settings = this.settingsStore?.get() ?? null;
        emitDeviceEvent('settings', {
            phase,
            ...extra,
            settings: settings ? { musicEnabled: settings.musicEnabled, sfxEnabled: settings.sfxEnabled, vibrationEnabled: settings.vibrationEnabled, language: settings.language } : null,
            source: this.settingsStore?.getSource() ?? null,
            chipRect: rect(nodes.chip),
            panelRect: rect(nodes.panel),
            rowRects: nodes.rows.map((node) => rect(node)),
            closeRect: rect(nodes.close),
            suppressed: this.suppressed,
            missingText: this.missingTextCount?.() ?? null,
            scale: this.node.scale.x,
        });
    }
}
