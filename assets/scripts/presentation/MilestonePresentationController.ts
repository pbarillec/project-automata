import { _decorator, Color, Component, Graphics, MeshRenderer, Label, Layers, Node, UITransform, Vec3, Widget } from 'cc';
import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import type { MobileCameraController } from '../camera/MobileCameraController';
import type { ConstructionPresentationController } from './ConstructionPresentationController';
import { emitDeviceEvent, isDeviceDiagnosticsEnabled } from './DeviceDiagnostics';
import { eraTransitionSpec, resolveEraFocus } from './EraTransition.ts';
import { MILESTONE_ACCENT_RGB, MILESTONE_RING_HEIGHT, MILESTONE_RING_VISIBLE_ABOVE, MILESTONE_SPARK_COUNT, milestoneRingBars, producerFootprint, resolveMilestoneFocus, sampleMilestoneEffect } from './MilestoneFeedback.ts';
import { MilestonePresentationViewModel, type MilestoneUpdate } from './MilestonePresentationViewModel.ts';
import type { MilestoneToastItem } from './MilestoneToastQueue.ts';
import type { RebootBeat } from './RebootPresentation.ts';
import { MILESTONE_TOAST_COLORS, MILESTONE_TOAST_GAP_BELOW_CHIPS, MILESTONE_TOAST_LAYOUT, milestoneToastTopOffsetFor } from './MilestoneToastLayout.ts';
import { IDENTITY_PALETTE, milestoneIconFor, milestoneIconSlot } from './AutomataIdentity.ts';
import { drawIcon, recordIcon } from './IdentityGraphics';
import { formatMilestoneToast } from './MilestoneToastText.ts';
import type { MilestoneAccent, MilestoneTrigger } from './MilestoneTier.ts';
import type { DisplayNameSource } from './PresentationText.ts';

const { ccclass } = _decorator;

const SPARK_SIZE = 0.15;
const SPARK_RING_RADIUS = 0.9;
const PULSE_HEIGHT = 0.2;
const SPARK_HEIGHT = 1.2;
/** Default colours of the AUT-040 pool (index parity), restored after the effect. */
const POOL_DEFAULT_RGB = [{ r: 82, g: 206, b: 224 }, { r: 255, g: 190, b: 80 }];

interface RunningEffect {
    readonly trigger: MilestoneTrigger;
    elapsed: number;
    reported?: boolean;
    laidOut?: boolean;
}

/**
 * AUT-046 thin `cc` controller over the pure `MilestonePresentationViewModel`: one reusable pipeline
 * (DomainEvent -> tier -> toast + pulse/spark + optional focus). AUT-048 adds the Exceptional era title card to the same band (plus an
 * optional era focus beat through the same camera API); the environment fade stays with the AUT-045 controller. The toast is a single touch-transparent band below the HUD (no touch
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
    private iconGraphics: Graphics | null = null;
    private toastIconKey = '';
    private builtLayoutTier: string | null = null;
    private shownText = '';
    private effect: RunningEffect | null = null;
    private sparksDirty = false;
    private eraAppliedReportedFor = 0;
    /** AUT-049: the Reboot card beat currently drawn (text changes per beat). */
    private rebootBeat: RebootBeat | null = null;
    private rebootCardActive = false;

    public start(): void {
        this.ensureToast();
        this.hideToast();
    }

    /** Initial / restored state: silent baseline (no toast, no pulse, no focus). */
    public sync(state: GameState): MilestoneUpdate {
        const update = this.viewModel.syncFromState(state);
        this.report(update, 'sync');
        if (isDeviceDiagnosticsEnabled()) emitDeviceEvent('milestone_presentation', { phase: 'synced', source: 'session' });
        this.emitEra('synced', { source: 'session', eraId: state.run.currentEraId });
        return update;
    }

    public consumeDomainEvents(state: GameState, events: readonly DomainEvent[]): MilestoneUpdate {
        const update = this.viewModel.consumeEvents(state, events);
        this.report(update, 'events');
        // Items started directly by the offer (idle queue) never appear in tick.started: start their effects here.
        for (const item of update.outcome?.started ?? []) this.onToastStarted(item);
        return update;
    }

    /**
     * Review / debug replay of one era title card (and its focus beat) from the era id alone. Presentation only: no GameState read or
     * write, no command, no save, and the AUT-045 environment is not touched.
     */
    public replayEraTransition(eraId: string): MilestoneUpdate {
        const update = this.viewModel.replayEra(eraId);
        this.report(update, 'replay');
        return update;
    }

    /** True while the Reboot title card item is playing (the Settings chip is suppressed meanwhile). */
    public isRebootCardActive(): boolean {
        return this.rebootCardActive;
    }

    public update(deltaSeconds: number): void {
        const tick = this.viewModel.tick(deltaSeconds);
        for (const item of tick.finished) {
            this.emit('toast_finished', { id: item.id, key: item.trigger.key, tier: item.trigger.tier });
            if (item.trigger.kind === 'era_title') this.emitEra('title_finished', { eraId: item.trigger.eraId, elapsedSeconds: item.elapsed });
            if (item.trigger.kind === 'reboot_title') this.emitReboot('toast_finished', { id: item.id, key: item.trigger.key, elapsedSeconds: item.elapsed });
        }
        // Era card offers made when the card delay elapsed are already merged into started (both start paths are handled).
        for (const item of tick.started) this.onToastStarted(item);
        // AUT-052: the Settings chip stays inert while the Reboot title card owns the band.
        this.rebootCardActive = tick.frame?.item.trigger.kind === 'reboot_title';
        if (tick.frame) this.renderToast(tick.frame.item, tick.frame.sample.alpha, tick.frame.sample.wipe, tick.frame.sample.beat ?? null);
        else this.hideToast();
        this.updateEffect(deltaSeconds);
    }

    private report(update: MilestoneUpdate, source: string): void {
        if (update.rebooted) this.stopEffect();
        if (update.eraCancelled) this.emitEra('cancelled', { source, reason: 'reboot' });
        if (update.eraScheduled) this.emitEra('scheduled', { source, eraId: update.eraScheduled.eraId, cardDelaySeconds: eraTransitionSpec(update.eraScheduled.eraId)?.cardDelaySeconds ?? null, subsumed: update.skipped.filter((s) => s.reason === 'subsumed').map((s) => s.key) });
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
        if (trigger.kind === 'era_title') {
            this.onEraCardStarted(item);
            return;
        }
        if (trigger.kind === 'reboot_title') {
            // AUT-049: the card only; the scan ring / socket / Core / camera beat belong to RebootPresentationController.
            this.rebootBeat = null;
            this.emit('toast_started', { id: item.id, key: trigger.key, tier: trigger.tier, kind: trigger.kind, accent: trigger.accent, producerId: null, extra: 0, ...this.textOf(item, 'reboot') });
            this.emitReboot('toast_started', { id: item.id, key: trigger.key, newCivilization: trigger.reboot?.newCivilization ?? null, aiCoresGranted: trigger.reboot?.aiCoresGranted ?? null });
            return;
        }
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

    private onEraCardStarted(item: MilestoneToastItem): void {
        const trigger = item.trigger;
        const text = this.textOf(item);
        const spec = eraTransitionSpec(trigger.eraId);
        this.emit('toast_started', { id: item.id, key: trigger.key, tier: trigger.tier, kind: trigger.kind, accent: trigger.accent, producerId: null, extra: item.extra, ...text });
        this.emitEra('title_started', { id: item.id, eraId: trigger.eraId, title: text.title, subtitle: text.subtitle, accent: trigger.accent, cardDelaySeconds: spec?.cardDelaySeconds ?? null });
        this.requestEraFocus(trigger);
    }

    /** Era focus beat: the existing focusOnRevealTarget only; a touch / pan cancels it inside the camera (no re-snap). */
    private requestEraFocus(trigger: MilestoneTrigger): void {
        const eraId = trigger.eraId ?? '';
        const producerId = trigger.focusProducerId;
        const anchor = producerId !== null ? this.resolveProducerAnchor?.(producerId) ?? null : null;
        const camera = this.cameraController;
        const cameraState = camera?.getCameraState() ?? null;
        const world = anchor ? { x: anchor.worldPosition.x, y: anchor.worldPosition.y, z: anchor.worldPosition.z } : null;
        const decision = resolveEraFocus({
            eraId,
            cameraFocus: cameraState ? { x: cameraState.focus.x, z: cameraState.focus.z } : null,
            target: anchor ? { x: anchor.worldPosition.x, z: anchor.worldPosition.z } : null,
            constructionActive: this.construction?.isAnyConstructing() === true,
            cameraFocusActive: camera?.isFocusTransitionActive() === true,
        });
        if (decision.focus && camera && anchor) {
            camera.focusOnRevealTarget(anchor.worldPosition);
            this.emitEra('focus_requested', { eraId, producerId, anchorResolved: true, worldPos: world });
        } else {
            this.emitEra('focus_skipped', { eraId, producerId, reason: decision.reason, anchorResolved: anchor !== null, worldPos: world });
        }
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

    private textOf(item: MilestoneToastItem, beat: RebootBeat | null = null): { title: string; subtitle: string | null } {
        return formatMilestoneToast(item.trigger, this.nameSource, item.extra, undefined, beat);
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
        this.iconGraphics = this.makeChild('MilestoneIcon').addComponent(Graphics);
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

    private renderToast(item: MilestoneToastItem, alpha: number, wipe: number, beat: RebootBeat | null): void {
        this.ensureToast();
        const trigger = item.trigger;
        const isReboot = trigger.kind === 'reboot_title';
        // AUT-049: the Reboot card is invisible during its silence (scale-based hide; the item keeps its clock).
        if (isReboot && (beat === null || alpha <= 0)) {
            this.hideToast();
            return;
        }
        const layout = MILESTONE_TOAST_LAYOUT[trigger.tier];
        const colors = MILESTONE_TOAST_COLORS;
        const text = this.textOf(item, isReboot ? beat : null);
        const signature = `${item.id}|${item.extra}|${text.title}`;
        if (this.shownText !== signature || this.builtLayoutTier !== trigger.tier) {
            this.shownText = signature;
            this.builtLayoutTier = trigger.tier;
            // AUT-066 round 3: Major / Exceptional bands start below the chip stack (the Minor band keeps the original top).
            const widget = this.node.getComponent(Widget);
            if (widget) { widget.top = milestoneToastTopOffsetFor(trigger.tier); widget.updateAlignment(); }
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
        const isEra = trigger.kind === 'era_title' || isReboot;
        // The era / Reboot underline uses the AUT-045 environment cyan (59,112,121) / amber; their title text stays off-white.
        const accent = isReboot ? colors.rebootUnderline : isEra ? colors.eraUnderline[trigger.accent] : colors.accent[trigger.accent];
        // Graphics fills render a solid colour on Android (a spriteFrame-less Sprite renders nothing).
        const pillGraphics = this.pillGraphics!;
        pillGraphics.clear();
        pillGraphics.fillColor = new Color(colors.pill.r, colors.pill.g, colors.pill.b, Math.round(colors.pill.a * alpha));
        pillGraphics.fillRect(-layout.width / 2, -layout.height, layout.width, layout.height);
        const titleColor = isEra ? colors.text : colors.titleAccent[trigger.accent];
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
        this.drawToastIcon(trigger.kind, trigger.tier, alpha);
        this.node.setScale(1, 1, 1);
        if (isReboot && this.rebootBeat !== beat) {
            this.rebootBeat = beat;
            this.emitReboot('title_applied', { id: item.id, beat, labelText: this.titleLabel!.string, fontSize: this.titleLabel!.fontSize, bandScale: this.node.scale.x, alpha, underlineRgb: { r: accent.r, g: accent.g, b: accent.b } });
        }
        if (trigger.kind === 'era_title' && this.eraAppliedReportedFor !== item.id && alpha >= 1) {
            this.eraAppliedReportedFor = item.id;
            const pill = this.pill!;
            this.emitEra('title_applied', { id: item.id, eraId: trigger.eraId, bandScale: this.node.scale.x, labelText: this.titleLabel!.string, fontSize: this.titleLabel!.fontSize, underlineRgb: { r: accent.r, g: accent.g, b: accent.b }, pillWorldPos: { x: pill.worldPosition.x, y: pill.worldPosition.y, z: pill.worldPosition.z }, wipe });
        }
    }

    /** AUT-066: a small icon left of the centred title, inside the existing pill (title rect unchanged). */
    private drawToastIcon(kind: string, tier: 'minor' | 'major' | 'exceptional', alpha: number): void {
        const graphics = this.iconGraphics;
        if (!graphics) return;
        graphics.clear();
        const icon = milestoneIconFor(kind);
        if (icon === null) return;
        const slot = milestoneIconSlot(tier);
        if (isDeviceDiagnosticsEnabled() && this.toastIconKey !== `${kind}|${tier}`) {
            this.toastIconKey = `${kind}|${tier}`;
            emitDeviceEvent('identity', { phase: 'toast_icon', kind, tier, icon, slot: { x: slot.x, y: slot.y, size: slot.size }, topOffset: milestoneToastTopOffsetFor(tier), chipsBottom: milestoneToastTopOffsetFor('major') - MILESTONE_TOAST_GAP_BELOW_CHIPS });
        }
        drawIcon(graphics, icon, slot.x, slot.y, slot.size, { ink: IDENTITY_PALETTE.offWhite, accent: IDENTITY_PALETTE.amber, alpha });
        recordIcon({ slot: slot.slot, icon, node: graphics.node, x: slot.x, y: slot.y, size: slot.size });
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
        if (plate && running.trigger.pulse) {
            const rect = running.trigger.producerId !== null ? producerFootprint(running.trigger.producerId) : null;
            if (rect && !running.laidOut) {
                running.laidOut = true;
                const bars = milestoneRingBars(rect);
                plate.children.forEach((bar, index) => {
                    const spec = bars[index];
                    if (!spec) return;
                    bar.setPosition(spec.x, 0, spec.z);
                    bar.setScale(spec.sizeX, MILESTONE_RING_HEIGHT, spec.sizeZ);
                });
                plate.setPosition(0, PULSE_HEIGHT, 0);
            }
            // Scale-based visibility: visible while the envelope is up, hidden (scale 0) otherwise.
            const visible = rect !== null && sample.pulse > MILESTONE_RING_VISIBLE_ABOVE;
            plate.setScale(visible ? 1 : 0, visible ? 1 : 0, visible ? 1 : 0);
        }
        if (anchor && running.trigger.sparks) this.applySparks(anchor.worldPosition, sample.sparkIntensity, running.elapsed, running.trigger.accent);
        if (!running.reported && sample.pulse > 0.5) {
            running.reported = true;
            const spark = (this.construction?.sparkNodes ?? [])[0] ?? null;
            this.emit('effect_applied', { key: running.trigger.key, anchorResolved: anchor !== null, plateScale: plate ? plate.scale.x : null, plateWorldPos: plate ? { x: plate.worldPosition.x, y: plate.worldPosition.y, z: plate.worldPosition.z } : null, sparkScale: spark ? spark.scale.x : null, sparkWorldPos: spark ? { x: spark.worldPosition.x, y: spark.worldPosition.y, z: spark.worldPosition.z } : null });
        }
        if (sample.complete) this.stopEffect();
    }

    private applySparks(center: Readonly<Vec3>, intensity: number, elapsed: number, accent: MilestoneAccent): void {
        const sparks = this.construction?.sparkNodes ?? [];
        // The pool is shared: a construction sequence owns it while it runs.
        if (sparks.length === 0 || this.construction?.isAnyConstructing() === true) return;
        const count = Math.min(MILESTONE_SPARK_COUNT, sparks.length);
        for (let index = 0; index < count; index += 1) {
            if (!this.sparksDirty) this.recolorSpark(sparks[index], MILESTONE_ACCENT_RGB[accent]);
            const flicker = 0.5 + 0.5 * Math.sin(elapsed * 38 + index * 1.7);
            const angle = (index / count) * Math.PI * 2 + elapsed * 2;
            const size = SPARK_SIZE * intensity * flicker * (index % 2 === 0 ? 1 : 0.7);
            sparks[index].setWorldPosition(center.x + Math.cos(angle) * SPARK_RING_RADIUS, SPARK_HEIGHT * (0.3 + 0.7 * flicker), center.z + Math.sin(angle) * SPARK_RING_RADIUS);
            sparks[index].setScale(size, size, size);
        }
        this.sparksDirty = true;
    }

    /** The pool nodes own their unlit material (createBox); the accent colour is set through the shared material. */
    private recolorSpark(spark: Node, rgb: { readonly r: number; readonly g: number; readonly b: number }): void {
        spark.getComponent(MeshRenderer)?.getSharedMaterial(0)?.setProperty('mainColor', new Color(rgb.r, rgb.g, rgb.b, 255));
    }

    private stopEffect(): void {
        this.effect = null;
        for (const plate of Object.values(this.pulsePlates)) plate?.setScale(0, 0, 0);
        if (this.sparksDirty && this.construction?.isAnyConstructing() !== true) {
            (this.construction?.sparkNodes ?? []).forEach((spark, index) => {
                spark.setScale(0, 0, 0);
                this.recolorSpark(spark, POOL_DEFAULT_RGB[index % 2]);
            });
        }
        this.sparksDirty = false;
    }

    private emitEra(phase: string, payload: Record<string, unknown>): void {
        if (isDeviceDiagnosticsEnabled()) emitDeviceEvent('era_transition', { phase, ...payload });
    }

    private emitReboot(phase: string, payload: Record<string, unknown>): void {
        if (isDeviceDiagnosticsEnabled()) emitDeviceEvent('reboot_presentation', { phase, ...payload });
    }

    private emit(phase: string, payload: Record<string, unknown>): void {
        if (isDeviceDiagnosticsEnabled()) emitDeviceEvent('milestone_presentation', { phase, ...payload });
    }
}
