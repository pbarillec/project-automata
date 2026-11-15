import { _decorator, Button, Color, Component, EventHandler, EventTouch, Graphics, Label, Layers, Node, UITransform, Vec3 } from 'cc';
import type { LifecycleCollectResult } from '../lifecycle/LifecycleSessionCoordinator.ts';
import type { OfflinePreviewResult } from '../offline/index.ts';
import type { OfflineAnalyticsSignal } from '../services/AnalyticsEventMapper.ts';
import { emitDeviceEvent, isDeviceDiagnosticsEnabled } from './DeviceDiagnostics';
import { fitLabel } from './LabelFit.ts';
import { TEXT_MIN_BUTTON_FONT_SIZE } from './TextFit.ts';
import {
    OFFLINE_REPORT_ACCENT_HEIGHT,
    OFFLINE_REPORT_COLORS,
    OFFLINE_REPORT_CARD_WIDTH,
    OFFLINE_REPORT_DOUBLE_OUTLINE,
    offlineReportCardCenterOffsetY,
    resolveOfflineReportCardLayout,
    type OfflineReportCardLayout,
} from './OfflineReportLayout.ts';
import type { OfflineDoubleFlow, OfflineDoubleFlowResult } from './OfflineDoubleFlow.ts';
import { formatOfflineCollectFailed, formatOfflineDoubleNotGranted, formatOfflineDoubleTexts, formatOfflineReportTexts, type OfflineReportTexts } from './OfflineReportText.ts';
import {
    HIDDEN_OFFLINE_REPORT_VIEW_MODEL,
    createOfflineReportViewModel,
    resolveOfflineCollectOutcome,
    resolveOfflineDoubleOutcome,
    type OfflineReportViewModel,
} from './OfflineReportViewModel.ts';
import type { DisplayNameSource } from './PresentationText.ts';
import type { UiRect } from './UiLayout.ts';

const { ccclass } = _decorator;

export type OfflineReportCollectEmitter = () => Promise<LifecycleCollectResult | null>;
export type OfflineReportShowReason = 'startup' | 'resumed' | 'reboot_blocked';

/** Alpha of the COLLECT / COLLECT x2 fill and label while a collection / ad is in flight (the debounce is visible, never a node.active toggle). */
const COLLECT_IN_FLIGHT_ALPHA = 110;

/**
 * AUT-051 thin `cc` controller of the Offline Factory Report card. Pure parts (view model, text, layout) live in
 * `OfflineReport*.ts`; this component only builds the nodes, draws Graphics fills (a spriteFrame-less Sprite renders nothing on
 * Android), displays the composed strings and forwards COLLECT to the session through `collectEmitter` (the binding).
 *
 * Visibility is scale-based (never `node.active`). A full-screen dim backdrop swallows every touch while the card is visible
 * (no tap-outside dismiss); only COLLECT acts. COLLECT is a Button on its own child node whose hit rect is the drawn rect. A failed
 * collect keeps the card and shows the retry line; a durable or not-durable collection closes it. AUT-055: when the
 * doubleFlow offers it (player eligible AND ad available) a secondary COLLECT x2 (Rewarded Ad) action sits below COLLECT; the free
 * COLLECT is never reduced or blocked by it. Nothing in this file computes or mutates economy state.
 *
 * The bootstrap creates the root (full screen, last child of the Canvas) with the `backdropNode` (full screen) and the
 * `safeNode` (safe-area container) and assigns them before the first `show`.
 */
@ccclass('OfflineReportController')
export class OfflineReportController extends Component {
    public backdropNode: Node | null = null;
    public safeNode: Node | null = null;
    public collectEmitter: OfflineReportCollectEmitter | null = null;
    /** DEBUG only: screen rectangle (bottom-left frame) of a UI node; supplied by FactoryWorldBootstrap (UI camera projection). */
    public screenRectOf: ((node: Node) => UiRect | null) | null = null;
    /** Called after the card appears / changes so the bootstrap can report a fresh `ui_layout`. */
    public onLayoutChanged: ((reason: string) => void) | null = null;
    /** AUT-055: the rewarded x2 flow (assigned by the bootstrap when the session is ready); null hides the x2 action. */
    public doubleFlow: OfflineDoubleFlow | null = null;
    /** AUT-063: non-authoritative outcome sink (the bootstrap forwards it to the analytics observer); never read back, never blocks the card. */
    public onAnalytics: ((signal: OfflineAnalyticsSignal) => void) | null = null;

    private nameSource: DisplayNameSource | null = null;
    private built = false;
    private visible = false;
    private inFlight = false;
    private autoCollecting = false;
    private retryShown = false;
    private notGrantedShown = false;
    private viewModel: OfflineReportViewModel = HIDDEN_OFFLINE_REPORT_VIEW_MODEL;
    private texts: OfflineReportTexts | null = null;
    private layout: OfflineReportCardLayout | null = null;
    private backdropGraphics: Graphics | null = null;
    private cardNode: Node | null = null;
    private cardGraphics: Graphics | null = null;
    private collectNode: Node | null = null;
    private collectGraphics: Graphics | null = null;
    private collectLabel: Label | null = null;
    private doubleNode: Node | null = null;
    private doubleGraphics: Graphics | null = null;
    private doubleLabel: Label | null = null;
    private doubleTagLabel: Label | null = null;
    private labels = new Map<string, Label>();
    private drawnBackdropKey = '';

    /** Producer display names for the educational line (assigned once by the bootstrap when the session is ready). */
    public setNameSource(names: DisplayNameSource | null): void {
        this.nameSource = names;
    }

    public onLoad(): void {
        this.hideScale();
    }

    public update(): void {
        if (this.visible) this.drawBackdrop();
    }

    /** True while the card is on screen (DEBUG ui_layout reads the rects only then). */
    public isVisible(): boolean {
        return this.visible;
    }

    public getRectNodes(): { card: Node | null; collect: Node | null; double: Node | null } {
        return {
            card: this.visible ? this.cardNode : null,
            collect: this.visible ? this.collectNode : null,
            double: this.visible && this.isDoubleShown() ? this.doubleNode : null,
        };
    }

    /** AUT-055: true while the x2 action is part of the visible card (player eligible AND ad available). */
    private isDoubleShown(): boolean {
        return this.visible && this.doubleFlow !== null && this.doubleFlow.getState().offer === true;
    }

    /**
     * Shows or refreshes the card for the session's pending preview. A null / non-collectible preview hides a visible (stale) card
     * and otherwise records `skipped`; a second call while visible refreshes the text (no stacking).
     */
    public show(preview: OfflinePreviewResult | null, reason: OfflineReportShowReason): void {
        const viewModel = createOfflineReportViewModel(preview);
        if (viewModel.autoCollect) {
            this.autoCollectSilently(viewModel, reason);
            return;
        }
        if (!viewModel.visible) {
            if (this.visible) this.hide('no_collectible_preview');
            else this.emitReport('skipped', { reason, status: preview?.status ?? 'none' });
            return;
        }
        this.ensureBuilt();
        const wasVisible = this.visible;
        this.viewModel = viewModel;
        this.texts = formatOfflineReportTexts(viewModel, this.nameSource);
        if (!wasVisible) { this.retryShown = false; this.notGrantedShown = false; }
        this.visible = true;
        this.render();
        this.node.setScale(1, 1, 1);
        this.emitReport(wasVisible ? 'refreshed' : 'shown', { reason, status: preview?.status ?? 'none' });
        if (!wasVisible) this.signalAnalytics({ kind: 'shown', reason, rawSeconds: viewModel.rawSeconds, capApplied: viewModel.capApplied });
        this.onLayoutChanged?.(wasVisible ? 'offline_report_refreshed' : 'offline_report_shown');
        void this.refreshDouble();
    }

    /** AUT-055: re-reads the x2 offer (eligibility + ad availability); the card grows / shrinks when it changes. */
    private async refreshDouble(): Promise<void> {
        const flow = this.doubleFlow;
        if (!flow) return;
        const before = this.isDoubleShown();
        try { await flow.refreshOffer(); } catch { /* the free COLLECT never depends on the ad flow */ }
        if (!this.visible) return;
        this.render();
        if (this.isDoubleShown() !== before) this.onLayoutChanged?.('offline_double_offer');
    }

    /** AUT-057: an ad placement became (un)available; re-reads the x2 offer while the card is shown. */
    public onAdsAvailabilityChanged(): void {
        if (this.visible) void this.refreshDouble();
    }

    /** AUT-055: the flow's state changed (in-flight toggled / offer refreshed). */
    public onDoubleChanged(): void {
        if (this.visible) this.render();
    }

    /**
     * AUT-051b MVP rule: a pending preview that is too short (raw absence < OFFLINE_REPORT_MIN_ABSENCE_SECONDS) or has no reward gets no
     * card; it is collected through the same binding path as COLLECT (normal critical save, no ad offer) so Reboot is never blocked.
     */
    private autoCollectSilently(viewModel: OfflineReportViewModel, reason: OfflineReportShowReason): void {
        if (this.autoCollecting) return;
        const emitter = this.collectEmitter;
        if (!emitter) return;
        this.autoCollecting = true;
        this.viewModel = viewModel;
        const finish = (result: LifecycleCollectResult | null): void => {
            this.autoCollecting = false;
            const saveOk = result !== null && result.status !== 'no_pending_preview' && result.status !== 'collect_failed' ? result.save.ok : null;
            this.emitReport('auto_collected', { reason, status: result?.status ?? 'collect_error', rawSeconds: viewModel.rawSeconds, reward: viewModel.reward, saveOk });
            if (resolveOfflineCollectOutcome(result) !== 'keep_retry') this.signalAnalytics({ kind: 'auto_collected', rawSeconds: viewModel.rawSeconds, saveOk });
            if (this.visible && resolveOfflineCollectOutcome(result) !== 'keep_retry') this.hide('auto_collected');
        };
        void emitter().then(finish, () => finish(null));
    }

    public hide(reason: string): void {
        if (!this.visible) return;
        this.visible = false;
        this.inFlight = false;
        this.retryShown = false;
        this.notGrantedShown = false;
        this.hideScale();
        this.emitReport('hidden', { reason });
        this.onLayoutChanged?.('offline_report_hidden');
    }

    /** COLLECT Button handler. Ignored while hidden or while a collection is in flight. */
    public onCollectPressed(): void {
        if (!this.visible || this.inFlight) return;
        const emitter = this.collectEmitter;
        if (!emitter) return;
        this.inFlight = true;
        this.render();
        this.emitReport('collect_tapped', {});
        void emitter().then((result) => this.onCollectResult(result), () => this.onCollectResult(null));
    }

    /** COLLECT x2 Button handler: shows the rewarded ad through the flow. Inert while hidden, not offered, or already in flight. */
    public onDoublePressed(): void {
        const flow = this.doubleFlow;
        if (!this.visible || !flow) return;
        const state = flow.getState();
        if (!state.offer || state.inFlight) return;
        this.notGrantedShown = false;
        this.emitReport('double_tapped', {});
        void flow.start().then((result) => this.onDoubleResult(result), () => this.onDoubleResult('error'));
    }

    private onDoubleResult(result: OfflineDoubleFlowResult | null): void {
        if (result === null) return;
        const outcome = resolveOfflineDoubleOutcome(result);
        this.emitReport('double_result', { result, outcome });
        if (result === 'granted') this.signalAnalytics({ kind: 'collected', rawSeconds: this.viewModel.rawSeconds, capApplied: this.viewModel.capApplied, doubled: true, saveOk: null });
        if (outcome === 'close') { this.hide('double_granted'); return; }
        if (outcome === 'close_stale') { this.hide('close_stale'); return; }
        if (outcome === 'keep_not_granted') this.notGrantedShown = true;
        else this.retryShown = true;
        if (this.visible) {
            this.render();
            this.onLayoutChanged?.('offline_double_result');
        }
    }

    private onCollectResult(result: LifecycleCollectResult | null): void {
        this.inFlight = false;
        const outcome = resolveOfflineCollectOutcome(result);
        const saveOk = result !== null && result.status !== 'no_pending_preview' && result.status !== 'collect_failed' ? result.save.ok : null;
        this.emitReport('collect_result', { status: result?.status ?? 'collect_error', outcome, saveOk });
        if (outcome !== 'keep_retry') this.signalAnalytics({ kind: 'collected', rawSeconds: this.viewModel.rawSeconds, capApplied: this.viewModel.capApplied, doubled: false, saveOk });
        if (outcome === 'keep_retry') {
            this.retryShown = true;
            if (this.visible) this.render();
            return;
        }
        this.hide(outcome);
    }

    private swallowTouch(event: EventTouch): void {
        if (this.visible) event.propagationStopped = true;
    }

    private hideScale(): void {
        this.node.setScale(0, 0, 0);
    }

    // ---- node construction ----

    private ensureBuilt(): void {
        if (this.built) return;
        this.built = true;
        this.node.layer = Layers.Enum.UI_2D;
        const backdrop = this.backdropNode;
        if (backdrop) {
            backdrop.layer = Layers.Enum.UI_2D;
            backdrop.getComponent(UITransform) ?? backdrop.addComponent(UITransform);
            this.backdropGraphics = backdrop.getComponent(Graphics) ?? backdrop.addComponent(Graphics);
            backdrop.on(Node.EventType.TOUCH_START, this.swallowTouch, this);
            backdrop.on(Node.EventType.TOUCH_MOVE, this.swallowTouch, this);
            backdrop.on(Node.EventType.TOUCH_END, this.swallowTouch, this);
            backdrop.on(Node.EventType.TOUCH_CANCEL, this.swallowTouch, this);
        }
        const parent = this.safeNode ?? this.node;
        const card = new Node('OfflineCard');
        card.layer = Layers.Enum.UI_2D;
        card.parent = parent;
        card.addComponent(UITransform);
        this.cardGraphics = card.addComponent(Graphics);
        // The card claims touches on its own area too (it sits above the backdrop; COLLECT is a child Button, handled first).
        card.on(Node.EventType.TOUCH_START, this.swallowTouch, this);
        card.on(Node.EventType.TOUCH_MOVE, this.swallowTouch, this);
        card.on(Node.EventType.TOUCH_END, this.swallowTouch, this);
        card.on(Node.EventType.TOUCH_CANCEL, this.swallowTouch, this);
        this.cardNode = card;
        for (const key of ['title', 'timeAway', 'capReached', 'reward', 'robots', 'note']) this.labels.set(key, this.makeLabel(card, `Offline_${key}`));
        this.buildCollectNode(card);
        this.buildDoubleNode(card);
    }

    private buildCollectNode(card: Node): void {
        const collect = new Node('OfflineCollectAction');
        collect.layer = Layers.Enum.UI_2D;
        collect.parent = card;
        collect.addComponent(UITransform);
        const fill = new Node('OfflineCollectFill');
        fill.layer = Layers.Enum.UI_2D;
        fill.parent = collect;
        fill.addComponent(UITransform);
        this.collectGraphics = fill.addComponent(Graphics);
        const labelNode = new Node('OfflineCollectLabel');
        labelNode.layer = Layers.Enum.UI_2D;
        labelNode.parent = collect;
        labelNode.addComponent(UITransform);
        this.collectLabel = this.configureLabel(labelNode.addComponent(Label), false);
        const button = collect.addComponent(Button);
        const handler = new EventHandler();
        handler.target = this.node;
        handler.component = 'OfflineReportController';
        handler.handler = 'onCollectPressed';
        button.clickEvents = [handler];
        this.collectNode = collect;
    }

    /** AUT-055: the COLLECT x2 Button node: outlined cyan Graphics (two fillRects), a cyan label and a small tag label, hit rect = drawn rect. */
    private buildDoubleNode(card: Node): void {
        const node = new Node('OfflineDoubleAction');
        node.layer = Layers.Enum.UI_2D;
        node.parent = card;
        node.addComponent(UITransform);
        const fill = new Node('OfflineDoubleFill');
        fill.layer = Layers.Enum.UI_2D;
        fill.parent = node;
        fill.addComponent(UITransform);
        this.doubleGraphics = fill.addComponent(Graphics);
        const labelNode = new Node('OfflineDoubleLabel');
        labelNode.layer = Layers.Enum.UI_2D;
        labelNode.parent = node;
        labelNode.addComponent(UITransform);
        this.doubleLabel = this.configureLabel(labelNode.addComponent(Label), false);
        const tagNode = new Node('OfflineDoubleTag');
        tagNode.layer = Layers.Enum.UI_2D;
        tagNode.parent = node;
        tagNode.addComponent(UITransform);
        this.doubleTagLabel = this.configureLabel(tagNode.addComponent(Label), false);
        const button = node.addComponent(Button);
        const handler = new EventHandler();
        handler.target = this.node;
        handler.component = 'OfflineReportController';
        handler.handler = 'onDoublePressed';
        button.clickEvents = [handler];
        node.setScale(0, 0, 0);
        this.doubleNode = node;
    }

    private makeLabel(parent: Node, name: string): Label {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.parent = parent;
        node.addComponent(UITransform);
        return this.configureLabel(node.addComponent(Label), true);
    }

    private configureLabel(label: Label, wrap: boolean): Label {
        label.overflow = Label.Overflow.SHRINK;
        label.enableWrapText = wrap;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.string = '';
        return label;
    }

    // ---- rendering ----

    private render(): void {
        const texts = this.texts;
        if (!texts || !this.cardNode) return;
        // D11: one note slot shared by the retry line, the calm "no bonus" line and the educational line.
        const note = this.retryShown ? formatOfflineCollectFailed() : this.notGrantedShown ? formatOfflineDoubleNotGranted() : texts.explain;
        const doubleState = this.doubleFlow?.getState() ?? null;
        const doubleShown = doubleState !== null && doubleState.offer === true;
        const layout = resolveOfflineReportCardLayout({ capReached: texts.capReached !== null, robots: texts.robots !== null, note: note !== null, x2: doubleShown });
        this.layout = layout;
        const colors = OFFLINE_REPORT_COLORS;
        this.cardNode.getComponent(UITransform)!.setContentSize(layout.width, layout.height);
        this.cardNode.setPosition(new Vec3(0, offlineReportCardCenterOffsetY(), 0));
        const cardGraphics = this.cardGraphics!;
        cardGraphics.clear();
        cardGraphics.fillColor = new Color(colors.pill.r, colors.pill.g, colors.pill.b, colors.pill.a);
        cardGraphics.fillRect(-layout.width / 2, -layout.height / 2, layout.width, layout.height);
        cardGraphics.fillColor = new Color(colors.amber.r, colors.amber.g, colors.amber.b, colors.amber.a);
        cardGraphics.fillRect(-OFFLINE_REPORT_CARD_WIDTH / 2, layout.height / 2 - OFFLINE_REPORT_ACCENT_HEIGHT, OFFLINE_REPORT_CARD_WIDTH, OFFLINE_REPORT_ACCENT_HEIGHT);
        const values: Record<string, { text: string | null; color: { r: number; g: number; b: number; a: number } }> = {
            title: { text: texts.title, color: colors.text },
            timeAway: { text: texts.timeAway, color: colors.text },
            capReached: { text: texts.capReached, color: colors.cyan },
            reward: { text: texts.reward, color: colors.amber },
            robots: { text: texts.robots, color: colors.text },
            note: { text: note, color: this.retryShown || this.notGrantedShown ? colors.cyan : colors.secondary },
        };
        for (const [key, label] of this.labels) {
            const row = layout.rows.find((item) => item.key === key);
            const value = values[key];
            if (!row || value.text === null) {
                label.node.setScale(0, 0, 0);
                continue;
            }
            label.node.setScale(1, 1, 1);
            label.node.setPosition(new Vec3(row.x, row.y, 0));
            label.node.getComponent(UITransform)!.setContentSize(row.w, row.h);
            label.fontSize = row.fontSize;
            label.lineHeight = row.lineHeight;
            label.string = fitLabel(label, value.text);
            label.color = new Color(value.color.r, value.color.g, value.color.b, value.color.a);
        }
        this.renderCollect(layout, texts.collect);
        this.renderDouble(layout, doubleShown ? formatOfflineDoubleTexts(doubleState.projectedReward) : null, doubleState !== null && doubleState.inFlight);
    }

    /** AUT-055: draws / hides the COLLECT x2 action (scale-based visibility; two fillRects, never stroke()). */
    private renderDouble(layout: OfflineReportCardLayout, texts: { readonly button: string; readonly tag: string } | null, inFlight: boolean): void {
        const node = this.doubleNode;
        const rect = layout.double;
        if (!node) return;
        if (!rect || !texts) {
            node.setScale(0, 0, 0);
            return;
        }
        const colors = OFFLINE_REPORT_COLORS;
        node.setScale(1, 1, 1);
        node.setPosition(new Vec3(rect.x, rect.y, 0));
        node.getComponent(UITransform)!.setContentSize(rect.w, rect.h);
        node.getChildByName('OfflineDoubleFill')!.getComponent(UITransform)!.setContentSize(rect.w, rect.h);
        const alpha = inFlight ? COLLECT_IN_FLIGHT_ALPHA : 255;
        const fill = this.doubleGraphics!;
        fill.clear();
        fill.fillColor = new Color(colors.cyan.r, colors.cyan.g, colors.cyan.b, alpha);
        fill.fillRect(-rect.w / 2, -rect.h / 2, rect.w, rect.h);
        const inset = OFFLINE_REPORT_DOUBLE_OUTLINE;
        fill.fillColor = new Color(colors.pill.r, colors.pill.g, colors.pill.b, 255);
        fill.fillRect(-rect.w / 2 + inset, -rect.h / 2 + inset, rect.w - inset * 2, rect.h - inset * 2);
        const tagHeight = rect.tagFontSize + 4;
        const mainHeight = rect.h - inset * 2 - tagHeight - 4;
        const main = this.doubleLabel!;
        main.node.setPosition(new Vec3(0, rect.h / 2 - inset - 2 - mainHeight / 2, 0));
        main.node.getComponent(UITransform)!.setContentSize(rect.w - 24, mainHeight);
        main.fontSize = rect.fontSize;
        main.lineHeight = mainHeight;
        main.string = fitLabel(main, texts.button, TEXT_MIN_BUTTON_FONT_SIZE);
        main.color = new Color(colors.cyan.r, colors.cyan.g, colors.cyan.b, alpha);
        const tag = this.doubleTagLabel!;
        tag.node.setPosition(new Vec3(0, -rect.h / 2 + inset + 2 + tagHeight / 2, 0));
        tag.node.getComponent(UITransform)!.setContentSize(rect.w - 24, tagHeight);
        tag.fontSize = rect.tagFontSize;
        tag.lineHeight = tagHeight;
        tag.string = fitLabel(tag, texts.tag);
        tag.color = new Color(colors.secondary.r, colors.secondary.g, colors.secondary.b, alpha);
    }

    private renderCollect(layout: OfflineReportCardLayout, caption: string): void {
        const collect = this.collectNode!;
        const colors = OFFLINE_REPORT_COLORS;
        const rect = layout.collect;
        collect.setPosition(new Vec3(rect.x, rect.y, 0));
        collect.getComponent(UITransform)!.setContentSize(rect.w, rect.h);
        collect.getChildByName('OfflineCollectFill')!.getComponent(UITransform)!.setContentSize(rect.w, rect.h);
        collect.getChildByName('OfflineCollectLabel')!.getComponent(UITransform)!.setContentSize(rect.w, rect.h);
        const alpha = this.inFlight ? COLLECT_IN_FLIGHT_ALPHA : 255;
        const fill = this.collectGraphics!;
        fill.clear();
        fill.fillColor = new Color(colors.amber.r, colors.amber.g, colors.amber.b, alpha);
        fill.fillRect(-rect.w / 2, -rect.h / 2, rect.w, rect.h);
        const label = this.collectLabel!;
        label.fontSize = rect.fontSize;
        label.lineHeight = rect.h;
        label.string = fitLabel(label, caption, TEXT_MIN_BUTTON_FONT_SIZE);
        label.color = new Color(colors.collectText.r, colors.collectText.g, colors.collectText.b, alpha);
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
        const colors = OFFLINE_REPORT_COLORS;
        graphics.clear();
        graphics.fillColor = new Color(colors.backdrop.r, colors.backdrop.g, colors.backdrop.b, colors.backdrop.a);
        graphics.fillRect(-size.width / 2, -size.height / 2, size.width, size.height);
    }

    private signalAnalytics(signal: OfflineAnalyticsSignal): void {
        try {
            this.onAnalytics?.(signal);
        }
        catch {
            // analytics never affects the report card
        }
    }

    // ---- DEBUG diagnostics ----

    private emitReport(phase: string, extra: Record<string, unknown>): void {
        if (!isDeviceDiagnosticsEnabled()) return;
        const vm = this.viewModel;
        const rectOf = this.screenRectOf;
        emitDeviceEvent('offline_report', {
            phase,
            ...extra,
            effectiveSeconds: vm.effectiveSeconds,
            rawSeconds: vm.rawSeconds,
            capApplied: vm.capApplied,
            reward: vm.reward,
            robotsDelta: vm.robotsDelta,
            notAutomatedProducerIds: vm.notAutomatedProducerIds,
            explainShown: this.texts?.explain != null,
            retryShown: this.retryShown,
            cardRect: this.visible && this.cardNode && rectOf ? rectOf(this.cardNode) : null,
            collectRect: this.visible && this.collectNode && rectOf ? rectOf(this.collectNode) : null,
            doubleShown: this.isDoubleShown(),
            doubleRect: this.isDoubleShown() && this.doubleNode && rectOf ? rectOf(this.doubleNode) : null,
            notGrantedShown: this.notGrantedShown,
            scale: this.node.scale.x,
            collectFontSize: this.collectLabel?.fontSize ?? null,
            texts: this.texts,
        });
    }

    /** DEBUG: emitted by the bootstrap when a Reboot was blocked by the pending report. */
    public reportRebootBlocked(): void {
        this.emitReport('reboot_blocked', { status: 'pending_offline_preview' });
    }
}
