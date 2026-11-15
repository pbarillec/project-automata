import { _decorator, Button, Color, Component, EventHandler, EventTouch, Graphics, Label, Layers, Node, UITransform, Vec3, view, Widget } from 'cc';
import { emitDeviceEvent, isDeviceDiagnosticsEnabled } from './DeviceDiagnostics';
import { fitLabel } from './LabelFit.ts';
import type { ExtendedOverclockFlow, ExtendedOverclockFlowResult } from './ExtendedOverclockFlow.ts';
import {
    EXTENDED_OVERCLOCK_CHIP_HEIGHT,
    EXTENDED_OVERCLOCK_CHIP_WIDTH,
    EXTENDED_OVERCLOCK_COLORS,
    EXTENDED_OVERCLOCK_LABEL_FONT_SIZE,
    EXTENDED_OVERCLOCK_TAG_FONT_SIZE,
    extendedOverclockChipWidgetOffsets,
    extendedOverclockOutlineRects,
    resolveExtendedOverclockChipLayout,
    type ExtendedOverclockLocalRect,
} from './ExtendedOverclockLayout.ts';
import { createExtendedOverclockChipViewModel, type ExtendedOverclockChipViewModel } from './ExtendedOverclockViewModel.ts';
import type { UiRect } from './UiLayout.ts';

const { ccclass } = _decorator;

type Rgba = { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
const colorOf = (rgba: Rgba, alpha: number = rgba.a): Color => new Color(rgba.r, rgba.g, rgba.b, Math.min(rgba.a, alpha));

/** The calm "No bonus this time." note stays on the tag line this long. */
const NOTE_SECONDS = 4;
/** The offer is re-read on this cadence (claim ageing, ad availability; the flow caches the ad availability itself). */
const POLL_SECONDS = 2;

/**
 * AUT-056 thin `cc` controller of the Extended Overclock chip. The pure parts live in `ExtendedOverclockViewModel.ts`,
 * `ExtendedOverclockLayout.ts` and `ExtendedOverclockFlow.ts`; this component builds the chip nodes, draws Graphics fillRects (a
 * spriteFrame-less Sprite renders nothing on Android; no stroke), shows the strings the view model composed and calls `flow.start()` on a tap.
 * It never submits a `GameCommand`, never touches the game state and never writes it: the flow hands the verified ad proof to the session.
 *
 * Visibility is scale-based (never `node.active`). The Button node is the drawn rect (hit rect = drawn rect). The chip is inert while
 * suppressed (offline report card / Reboot title card) or while the ad is in flight (dimmed).
 */
@ccclass('ExtendedOverclockController')
export class ExtendedOverclockController extends Component {
    /** Where the chip lives (the HUD safe-area container); Widget-anchored on the second line under the HUD band, left-aligned. */
    public chipHost: Node | null = null;
    public flow: ExtendedOverclockFlow | null = null;
    /** DEBUG only: screen rectangle (bottom-left frame) of a UI node; supplied by FactoryWorldBootstrap (UI camera projection). */
    public screenRectOf: ((node: Node) => UiRect | null) | null = null;
    /** Called after the chip appears / disappears so the bootstrap can report a fresh `ui_layout`. */
    public onLayoutChanged: ((reason: string) => void) | null = null;

    private built = false;
    private suppressed = false;
    private chipVisible: boolean | null = null;
    private chipNode: Node | null = null;
    private chipGraphics: Graphics | null = null;
    private labelNode: Label | null = null;
    private tagNode: Label | null = null;
    private chipKey = '';
    private noteSeconds = 0;
    private pollSeconds = 0;
    private refreshRequested = false;
    private reportFrames = 0;
    private viewModel: ExtendedOverclockChipViewModel | null = null;

    public onLoad(): void {
        this.node.layer = Layers.Enum.UI_2D;
    }

    public update(deltaTime: number): void {
        const step = Number.isFinite(deltaTime) && deltaTime > 0 ? deltaTime : 0;
        if (this.noteSeconds > 0) {
            this.noteSeconds = Math.max(0, this.noteSeconds - step);
            if (this.noteSeconds === 0) this.render();
        }
        this.pollSeconds += step;
        if ((this.refreshRequested || this.pollSeconds >= POLL_SECONDS) && this.flow) {
            this.refreshRequested = false;
            this.pollSeconds = 0;
            void this.flow.refreshOffer();
        }
        if (this.reportFrames > 0) {
            this.reportFrames -= 1;
            if (this.reportFrames === 0 && this.chipVisible === true) this.emitReport('chip_shown', {});
        }
    }

    /** Re-reads the offer on the next frame (boost state changed, session resumed, offline card closed). */
    public requestRefresh(): void {
        this.refreshRequested = true;
    }

    /** AUT-065: the ad availability itself may have changed (consent, provider load): drop the flow's cached read, then re-read on the next frame. */
    public requestAdAvailabilityRefresh(): void {
        this.flow?.invalidateAdAvailability();
        this.requestRefresh();
    }

    /** The flow's state changed (offer refreshed, ad in flight, ad finished): redraw. */
    public onFlowChanged(): void {
        this.render();
    }

    /** The offline report card or the Reboot title card owns the screen: hide the chip and keep it inert. */
    public setSuppressed(suppressed: boolean): void {
        if (this.suppressed === suppressed) return;
        this.suppressed = suppressed;
        this.requestRefresh();
        this.render();
    }

    /** DEBUG ui_layout: the chip node while shown (null while hidden). */
    public getRectNode(): Node | null {
        return this.chipVisible === true ? this.chipNode : null;
    }

    // ---- handler (Button click event) ----

    public onChipPressed(): void {
        const flow = this.flow;
        const viewModel = this.viewModel;
        if (!flow || !viewModel || !viewModel.interactable || this.chipVisible !== true || this.suppressed) return;
        this.noteSeconds = 0;
        // AUT-071: a rejected flow (it never rejects today; belt and braces) must still end the attempt and re-render.
        void flow.start().then((result) => this.onStartFinished(result), () => this.onStartFinished('error'));
    }

    private onStartFinished(result: ExtendedOverclockFlowResult | null): void {
        if (result === 'not_granted' || result === 'error') this.noteSeconds = NOTE_SECONDS;
        this.render();
        if (this.noteSeconds > 0 && this.chipVisible === true) this.emitReport('note', { result });
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

    private newLabel(parent: Node, name: string): Label {
        const node = this.newNode(name, parent, 10, 10);
        const label = node.addComponent(Label);
        label.overflow = Label.Overflow.SHRINK;
        label.enableWrapText = false;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.string = '';
        return label;
    }

    private placeLabel(label: Label, rect: ExtendedOverclockLocalRect, fontSize: number, color: Rgba, alpha: number, text: string): void {
        label.node.setPosition(new Vec3(rect.x, rect.y, 0));
        label.node.getComponent(UITransform)!.setContentSize(rect.w, rect.h);
        label.fontSize = fontSize;
        label.lineHeight = rect.h;
        label.string = fitLabel(label, text);
        label.color = colorOf(color, alpha);
    }

    private ensureChip(): void {
        if (this.built || !this.chipHost) return;
        this.built = true;
        const w = EXTENDED_OVERCLOCK_CHIP_WIDTH;
        const h = EXTENDED_OVERCLOCK_CHIP_HEIGHT;
        const chip = this.newNode('ExtendedOverclockChip', this.chipHost, w, h);
        // Behind the HUD cards and the toast band (like the Settings / AI chips); created after the HUD rows by the bootstrap.
        chip.setSiblingIndex(0);
        const widget = chip.addComponent(Widget);
        const offsets = extendedOverclockChipWidgetOffsets();
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
        // The Button node is the chip itself: hit rect = drawn rect.
        this.chipGraphics = this.newNode('ChipFill', chip, w, h).addComponent(Graphics);
        this.labelNode = this.newLabel(chip, 'ChipLabel');
        this.tagNode = this.newLabel(chip, 'ChipTag');
        const button = chip.addComponent(Button);
        const event = new EventHandler();
        event.target = this.node;
        event.component = 'ExtendedOverclockController';
        event.handler = 'onChipPressed';
        event.customEventData = '';
        button.clickEvents = [event];
        this.chipNode = chip;
        chip.setScale(0, 0, 0);
    }

    // ---- rendering ----

    private render(): void {
        this.ensureChip();
        const chip = this.chipNode;
        if (!chip) return;
        const flowState = this.flow?.getState() ?? null;
        const base = createExtendedOverclockChipViewModel(flowState, this.noteSeconds > 0);
        const viewModel = this.suppressed ? Object.freeze({ ...base, visible: false, interactable: false }) : base;
        this.viewModel = viewModel;
        const key = `${viewModel.visible}|${viewModel.alpha}|${viewModel.label}|${viewModel.tag}`;
        if (key === this.chipKey) return;
        this.chipKey = key;
        const colors = EXTENDED_OVERCLOCK_COLORS;
        const alpha = viewModel.alpha;
        const outline = extendedOverclockOutlineRects();
        const graphics = this.chipGraphics!;
        // Outline: two fillRects (amber outer, graphite inner); never stroke().
        graphics.clear();
        graphics.fillColor = colorOf(colors.amber, alpha);
        graphics.fillRect(-outline.outer.w / 2, -outline.outer.h / 2, outline.outer.w, outline.outer.h);
        graphics.fillColor = colorOf(colors.graphite, alpha);
        graphics.fillRect(-outline.inner.w / 2, -outline.inner.h / 2, outline.inner.w, outline.inner.h);
        const layout = resolveExtendedOverclockChipLayout();
        this.placeLabel(this.labelNode!, layout.label, EXTENDED_OVERCLOCK_LABEL_FONT_SIZE, colors.text, alpha, viewModel.label);
        this.placeLabel(this.tagNode!, layout.tag, EXTENDED_OVERCLOCK_TAG_FONT_SIZE, colors.secondary, alpha, viewModel.tag);
        const changed = this.chipVisible !== viewModel.visible;
        this.chipVisible = viewModel.visible;
        if (viewModel.visible) chip.setScale(1, 1, 1); else chip.setScale(0, 0, 0);
        if (changed) {
            if (viewModel.visible) this.reportFrames = 4; else this.emitReport('chip_hidden', {});
            this.onLayoutChanged?.(viewModel.visible ? 'extended_overclock_chip_shown' : 'extended_overclock_chip_hidden');
        }
    }

    // ---- DEBUG diagnostics ----

    private emitReport(phase: string, extra: Record<string, unknown>): void {
        if (!isDeviceDiagnosticsEnabled()) return;
        const rectOf = this.screenRectOf;
        const node = this.getRectNode();
        // Effective (post-SHRINK) font size in design units: Label.actualFontSize is in render pixels (see the bootstrap's HUD fontOf).
        const fontOf = (label: Label | null): number | null => {
            if (!label || label.string.length === 0) return null;
            let renderScale = view.getScaleX();
            if (renderScale * label.fontSize > 100 && label.fontSize < 100) renderScale = 100 / label.fontSize;
            return label.actualFontSize / Math.max(1, renderScale);
        };
        emitDeviceEvent('extended_overclock', {
            phase,
            ...extra,
            chipRect: node && rectOf ? rectOf(node) : null,
            labelFontSize: fontOf(this.labelNode),
            tagFontSize: fontOf(this.tagNode),
            tag: this.tagNode?.string ?? null,
            suppressed: this.suppressed,
        });
    }
}
