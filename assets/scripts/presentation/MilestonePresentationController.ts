import { _decorator, Color, Component, Graphics, Label, Layers, Node, UITransform, Vec3 } from 'cc';
import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import type { MobileCameraController } from '../camera/MobileCameraController';
import type { ConstructionPresentationController } from './ConstructionPresentationController';
import { emitDeviceEvent, isDeviceDiagnosticsEnabled } from './DeviceDiagnostics';
import { MILESTONE_SPARK_COUNT, resolveMilestoneFocus, sampleMilestoneEffect } from './MilestoneFeedback.ts';
import { MilestonePresentationViewModel, type MilestoneUpdate } from './MilestonePresentationViewModel.ts';
import type { MilestoneToastItem } from './MilestoneToastQueue.ts';
import { MILESTONE_TOAST_COLORS, MILESTONE_TOAST_LAYOUT } from './MilestoneToastLayout.ts';
import { formatMilestoneToast } from './MilestoneToastText.ts';
import type { MilestoneAccent, MilestoneTrigger } from './MilestoneTier.ts';
import type { DisplayNameSource } from './PresentationText.ts';

const { ccclass } = _decorator;

const PULSE_PLATE_SCALE = 5.0;
const SPARK_SIZE = 0.3;
const SPARK_RING_RADIUS = 1.1;
const PULSE_HEIGHT = 0.5;
const SPARK_HEIGHT = 1.4;

interface RunningEffect {
    readonly trigger: MilestoneTrigger;
    elapsed: number;
    reported?: boolean;
}

/**
 * AUT-046 thin `cc` controller over the pure `MilestonePresentationViewModel`: one reusable pipeline
 * (DomainEvent -> tier -> toast + pulse/spark + optional focus). The toast is a single touch-transparent band below the HUD (no touch
 * listener, so camera panning and every button stay live); idle it has scale 0 (scale-based visibility). Pulse plates come from the
 * bootstrap, sparks from the AUT-040 pool, the focus goes through the existing `focusOnRevealTarget`. Never writes GameState,
 * never submits a command, never delays control.
 */
@ccclass('MilestonePresentationController')
export class MilestonePresentationController extends Component {
    /** AUT-LOC-001 name source (null shows generic names). */
    private nameSource: DisplayNameSource | null = null;

    /** Names the toasts (assigned through this setter once the session is ready; the load baseline never depends on it). */
    public setNameSource(source: DisplayNameSource | null): void { this.nameSource = source; }
    public cameraController: MobileCameraController | null = null;
    /** Shared AUT-040 spark pool and "a construction is running" flag. */
    public construction: ConstructionPresentationController | null = null;
    /** Supplied by FactoryWorldBootstrap: the producer's focus anchor (world position source). */
    public resolveProducerAnchor: ((producerId: string) => Node | null) | null = null;
    /** Supplied by FactoryWorldBootstrap: one flat pulse plate per accent (scale 0 at rest). */
    public pulsePlates: Partial<Record<MilestoneAccent, Node>> = {};

    private readonly viewModel = new MilestonePresentationViewModel();
    private pill: Node | null = null;
    private titleLabel: Label | null = null;
    private subtitleLabel: Label | null = null;
    private underline: Node | null = null;
    private pillGraphics: Graphics | null = null;
    private underlineGraphics: Graphics | null = null;
    private builtLayoutTier: string | null = null;
    private shownText = '';
    private effect: RunningEffect | null = null;
    private sparksDirty = false;

    public start(): void {
        this.ensureToast();
        this.hideToast();
    }

    /** Initial / restored state: silent baseline (no toast, no pulse, no focus). */
    public sync(state: GameState): MilestoneUpdate {
        const update = this.viewModel.syncFromState(state);
        this.report(update, 'sync');
        if (isDeviceDiagnosticsEnabled()) emitDeviceEvent('milestone_presentation', { phase: 'synced', source: 'session' });
        return update;
    }

    public consumeDomainEvents(state: GameState, events: readonly DomainEvent[]): MilestoneUpdate {
        const update = this.viewModel.consumeEvents(state, events);
        this.report(update, 'events');
        // Items started directly by the offer (idle queue) never appear in tick.started: start their effects here.
        for (const item of update.outcome?.started ?? []) this.onToastStarted(item);
        return update;
    }

    public update(deltaSeconds: number): void {
        const tick = this.viewModel.tick(deltaSeconds);
        for (const item of tick.finished) this.emit('toast_finished', { id: item.id, key: item.trigger.key, tier: item.trigger.tier });
        for (const item of tick.started) this.onToastStarted(item);
        if (tick.frame) this.renderToast(tick.frame.item, tick.frame.sample.alpha, tick.frame.sample.wipe);
        else this.hideToast();
        this.updateEffect(deltaSeconds);
    }

    private report(update: MilestoneUpdate, source: string): void {
        if (update.rebooted) this.stopEffect();
        if (!isDeviceDiagnosticsEnabled()) return;
        if (update.exceptional.length > 0) this.emit('exceptional_routed', { source, types: update.exceptional });
        if (update.skipped.length > 0) this.emit('skipped', { source, skipped: update.skipped });
        const outcome = update.outcome;
        if (outcome && (outcome.queued.length > 0 || outcome.dropped.length > 0 || outcome.collapsed.length > 0)) {
            this.emit('queue', { source, queued: outcome.queued, dropped: outcome.dropped, collapsed: outcome.collapsed });
        }
    }

    private onToastStarted(item: MilestoneToastItem): void {
        const trigger = item.trigger;
        this.emit('toast_started', { id: item.id, key: trigger.key, tier: trigger.tier, kind: trigger.kind, accent: trigger.accent, producerId: trigger.producerId, extra: item.extra, ...this.textOf(item) });
        if (trigger.pulse || trigger.sparks) {
            this.stopEffect();
            this.effect = { trigger, elapsed: 0 };
        }
        const anchor = trigger.producerId !== null ? this.resolveProducerAnchor?.(trigger.producerId) ?? null : null;
        const world = anchor ? { x: anchor.worldPosition.x, y: anchor.worldPosition.y, z: anchor.worldPosition.z } : null;
        const plate = this.pulsePlates[trigger.accent] ?? null;
        const sparkPool = this.construction?.sparkNodes ?? [];
        if (trigger.pulse) this.emit('pulse_started', { id: item.id, key: trigger.key, tier: trigger.tier, accent: trigger.accent, producerId: trigger.producerId, anchorResolved: anchor !== null, anchorName: anchor?.name ?? null, worldPos: world, plate: plate !== null, plateParent: plate?.parent?.name ?? null });
        if (trigger.sparks) this.emit('sparks_started', { id: item.id, key: trigger.key, tier: trigger.tier, count: MILESTONE_SPARK_COUNT, producerId: trigger.producerId, anchorResolved: anchor !== null, worldPos: world, poolSize: sparkPool.length, poolParent: sparkPool[0]?.parent?.name ?? null, constructionActive: this.construction?.isAnyConstructing() === true });
        this.requestFocus(trigger);
    }

    private requestFocus(trigger: MilestoneTrigger): void {
        if (trigger.tier !== 'major' || trigger.focusProducerId === null) return;
        const anchor = this.resolveProducerAnchor?.(trigger.focusProducerId) ?? null;
        const camera = this.cameraController;
        const cameraState = camera?.getCameraState() ?? null;
        const decision = resolveMilestoneFocus({
            trigger,
            cameraFocus: cameraState ? { x: cameraState.focus.x, z: cameraState.focus.z } : null,
            target: anchor ? { x: anchor.worldPosition.x, z: anchor.worldPosition.z } : null,
            exceptionalRevealActive: this.construction?.isAnyConstructing() === true,
            cameraFocusActive: camera?.isFocusTransitionActive() === true,
        });
        if (decision.focus && camera && anchor) {
            camera.focusOnRevealTarget(anchor.worldPosition);
            this.emit('focus_requested', { key: trigger.key, producerId: trigger.focusProducerId });
        } else {
            this.emit('focus_skipped', { key: trigger.key, producerId: trigger.focusProducerId, reason: decision.reason });
        }
    }

    // ---- toast band ----

    private textOf(item: MilestoneToastItem): { title: string; subtitle: string | null } {
        return formatMilestoneToast(item.trigger, this.nameSource, item.extra);
    }

    private ensureToast(): void {
        if (this.pill) return;
        const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
        transform.setContentSize(MILESTONE_TOAST_LAYOUT.major.width, MILESTONE_TOAST_LAYOUT.major.height);
        transform.setAnchorPoint(0.5, 1);
        this.node.layer = Layers.Enum.UI_2D;
        // No touch listener on purpose: the band is touch-transparent (it never swallows a touch).
        this.pill = this.makeChild('MilestonePill');
        this.pill.getComponent(UITransform)?.setAnchorPoint(0.5, 1);
        this.pillGraphics = this.pill.addComponent(Graphics);
        this.titleLabel = this.makeLabel('MilestoneTitle');
        this.subtitleLabel = this.makeLabel('MilestoneSubtitle');
        this.underline = this.makeChild('MilestoneUnderline');
        this.underline.getComponent(UITransform)?.setAnchorPoint(0, 0.5);
        this.underlineGraphics = this.underline.addComponent(Graphics);
    }

    private makeChild(name: string): Node {
        const child = new Node(name);
        child.layer = Layers.Enum.UI_2D;
        child.parent = this.node;
        child.addComponent(UITransform);
        return child;
    }

    private makeLabel(name: string): Label {
        const child = this.makeChild(name);
        const label = child.addComponent(Label);
        label.overflow = Label.Overflow.SHRINK;
        label.enableWrapText = false;
        return label;
    }

    private hideToast(): void {
        this.node.setScale(0, 0, 0);
        this.shownText = '';
    }

    private renderToast(item: MilestoneToastItem, alpha: number, wipe: number): void {
        this.ensureToast();
        const trigger = item.trigger;
        const layout = MILESTONE_TOAST_LAYOUT[trigger.tier];
        const colors = MILESTONE_TOAST_COLORS;
        const text = this.textOf(item);
        const signature = `${item.id}|${item.extra}|${text.title}`;
        if (this.shownText !== signature || this.builtLayoutTier !== trigger.tier) {
            this.shownText = signature;
            this.builtLayoutTier = trigger.tier;
            this.node.getComponent(UITransform)?.setContentSize(layout.width, layout.height);
            this.pill!.getComponent(UITransform)!.setContentSize(layout.width, layout.height);
            this.pill!.setPosition(new Vec3(0, 0, 0));
            this.layoutLabel(this.titleLabel!, layout.width - 24, layout.titleLineHeight, layout.titleFontSize, layout.titleCenterY, text.title);
            const hasSubtitle = layout.subtitleFontSize > 0 && text.subtitle !== null;
            this.subtitleLabel!.node.setScale(hasSubtitle ? 1 : 0, hasSubtitle ? 1 : 0, 1);
            if (hasSubtitle) this.layoutLabel(this.subtitleLabel!, layout.width - 24, layout.subtitleLineHeight, layout.subtitleFontSize, layout.subtitleCenterY, text.subtitle ?? '');
            const hasUnderline = layout.underlineHeight > 0;
            this.underline!.setScale(hasUnderline ? 1 : 0, hasUnderline ? 1 : 0, 1);
            this.underline!.setPosition(new Vec3(-layout.width / 2 + layout.underlineInset, layout.underlineCenterY, 0));
        }
        const accent = colors.accent[trigger.accent];
        // Graphics fills render a solid colour on Android (a spriteFrame-less Sprite renders nothing).
        const pillGraphics = this.pillGraphics!;
        pillGraphics.clear();
        pillGraphics.fillColor = new Color(colors.pill.r, colors.pill.g, colors.pill.b, Math.round(colors.pill.a * alpha));
        pillGraphics.fillRect(-layout.width / 2, -layout.height, layout.width, layout.height);
        const titleColor = colors.titleAccent[trigger.accent];
        this.titleLabel!.color = new Color(titleColor.r, titleColor.g, titleColor.b, Math.round(255 * alpha));
        this.subtitleLabel!.color = new Color(colors.subtitle.r, colors.subtitle.g, colors.subtitle.b, Math.round(255 * alpha));
        if (layout.underlineHeight > 0) {
            const underlineWidth = Math.max(0.01, (layout.width - layout.underlineInset * 2) * (trigger.tier === 'minor' ? 1 : wipe));
            this.underline!.getComponent(UITransform)!.setContentSize(underlineWidth, layout.underlineHeight);
            const underlineGraphics = this.underlineGraphics!;
            underlineGraphics.clear();
            underlineGraphics.fillColor = new Color(accent.r, accent.g, accent.b, Math.round(accent.a * alpha));
            underlineGraphics.fillRect(0, -layout.underlineHeight / 2, underlineWidth, layout.underlineHeight);
        }
        this.node.setScale(1, 1, 1);
    }

    private layoutLabel(label: Label, width: number, lineHeight: number, fontSize: number, centerY: number, text: string): void {
        label.node.getComponent(UITransform)?.setContentSize(width, lineHeight);
        label.node.setPosition(new Vec3(0, centerY, 0));
        label.fontSize = fontSize;
        label.lineHeight = lineHeight;
        label.string = text;
    }

    // ---- pulse / sparks ----

    private updateEffect(deltaSeconds: number): void {
        const running = this.effect;
        if (!running) return;
        running.elapsed += Math.max(0, deltaSeconds);
        const sample = sampleMilestoneEffect(running.trigger, running.elapsed);
        const anchor = running.trigger.producerId !== null ? this.resolveProducerAnchor?.(running.trigger.producerId) ?? null : null;
        const plate = this.pulsePlates[running.trigger.accent] ?? null;
        if (anchor && plate && running.trigger.pulse) {
            const position = anchor.worldPosition;
            plate.setWorldPosition(position.x, PULSE_HEIGHT, position.z);
            const scale = sample.pulse * PULSE_PLATE_SCALE;
            plate.setScale(scale, scale > 0 ? 1 : 0, scale);
        }
        if (anchor && running.trigger.sparks) this.applySparks(anchor.worldPosition, sample.sparkIntensity, running.elapsed);
        if (!running.reported && sample.pulse > 0.5) {
            running.reported = true;
            const spark = (this.construction?.sparkNodes ?? [])[0] ?? null;
            this.emit('effect_applied', { key: running.trigger.key, anchorResolved: anchor !== null, plateScale: plate ? plate.scale.x : null, plateWorldPos: plate ? { x: plate.worldPosition.x, y: plate.worldPosition.y, z: plate.worldPosition.z } : null, sparkScale: spark ? spark.scale.x : null, sparkWorldPos: spark ? { x: spark.worldPosition.x, y: spark.worldPosition.y, z: spark.worldPosition.z } : null });
        }
        if (sample.complete) this.stopEffect();
    }

    private applySparks(center: Readonly<Vec3>, intensity: number, elapsed: number): void {
        const sparks = this.construction?.sparkNodes ?? [];
        // The pool is shared: a construction sequence owns it while it runs.
        if (sparks.length === 0 || this.construction?.isAnyConstructing() === true) return;
        const count = Math.min(MILESTONE_SPARK_COUNT, sparks.length);
        for (let index = 0; index < count; index += 1) {
            const flicker = 0.5 + 0.5 * Math.sin(elapsed * 38 + index * 1.7);
            const angle = (index / count) * Math.PI * 2 + elapsed * 2;
            const size = SPARK_SIZE * intensity * flicker * (index % 2 === 0 ? 1 : 0.7);
            sparks[index].setWorldPosition(center.x + Math.cos(angle) * SPARK_RING_RADIUS, SPARK_HEIGHT * (0.3 + 0.7 * flicker), center.z + Math.sin(angle) * SPARK_RING_RADIUS);
            sparks[index].setScale(size, size, size);
        }
        this.sparksDirty = true;
    }

    private stopEffect(): void {
        this.effect = null;
        for (const plate of Object.values(this.pulsePlates)) plate?.setScale(0, 0, 0);
        if (this.sparksDirty && this.construction?.isAnyConstructing() !== true) {
            for (const spark of this.construction?.sparkNodes ?? []) spark.setScale(0, 0, 0);
        }
        this.sparksDirty = false;
    }

    private emit(phase: string, payload: Record<string, unknown>): void {
        if (isDeviceDiagnosticsEnabled()) emitDeviceEvent('milestone_presentation', { phase, ...payload });
    }
}
