/**
 * AUT-066 objective checks of the Automata identity device captures (pure, unit-tested; used by `reveal_capture.ts`).
 * The capture records the DEBUG `identity` event (decal renderers per producer with a window rect, the AI Core model summary, every UI icon drawn with
 * its window rect) and `error` events. These checks prove wiring and budgets only: whether the marks READ at the normal camera, their pixel size against the
 * brief and the composition stay with the agent visual QA of the screenshots (the pixel sizes are reported as information, never as a pass criterion).
 */
import type { ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';
import { DECAL_MAX_PARTS_PER_PRODUCER, DECAL_MAX_PARTS_TOTAL } from '../../assets/scripts/presentation/AutomataIdentity.ts';

/** 'factory' = decals + HUD icons; 'ai_core' = the AI Core in the Reboot sequence + the Reboot toast icon; 'panel' = the producer panel header icon per selected producer; 'toast_breakthrough' = the breakthrough toast icon. */
export type IdentityExpectation = 'factory' | 'ai_core' | 'panel' | 'toast_breakthrough';

export interface IdentityTimelineEvent { readonly tMs: number; readonly event: ParsedDeviceEvent }
export interface IdentityCheck { readonly id: string; readonly ok: boolean; readonly detail: string }

/** Icon slots that exist on every factory screen (HUD row + Overclock button). */
export const IDENTITY_REQUIRED_ICON_SLOTS: readonly string[] = Object.freeze(['hud_industrial_output', 'hud_overclock']);
export const IDENTITY_MIN_ICON_PX = 12;
export const IDENTITY_PRODUCER_COUNT = 5;
export const IDENTITY_AI_CORE_RENDERERS = 3;
/** Producer header icons that must be seen when the capture selects the Fabricator, the Robot Line and the Advanced Robotics Complex. */
export const IDENTITY_PANEL_ICONS: readonly string[] = Object.freeze(['industrial_output', 'automation', 'robot']);
export const IDENTITY_PANEL_MIN_ICON_PX = 40;

/**
 * The producers the 'select-producers' trigger taps, in preference order. A selection re-focuses the camera, so a zone
 * that was on screen before a tap can be off screen after it (device capture 2026-11-15: after the Fabricator focus the
 * Robot Line projected at x = -266). The trigger therefore re-reads the `zones_projected` of the SETTLED camera before
 * every tap and takes the first not-yet-tapped producer that is on screen and clear of the panel.
 */
export const IDENTITY_PANEL_TAP_ORDER: readonly string[] = Object.freeze(['Fabricator', 'RobotLine', 'AdvancedRoboticsComplex', 'AssemblyStation', 'AutomatedCell']);

export interface ProjectedZoneLike { readonly id: string; readonly sx: number | null; readonly sy: number | null; readonly onScreen: boolean }

/** First untapped producer in IDENTITY_PANEL_TAP_ORDER that is projected on screen (and outside `avoid`, a cocos-space rect), or null. */
export function nextProducerTap(zones: readonly ProjectedZoneLike[] | undefined, tapped: ReadonlySet<string>, avoid?: { x: number; y: number; w: number; h: number } | null, margin = 40, screen?: { w: number; h: number }): ProjectedZoneLike | null {
    if (!zones) return null;
    for (const id of IDENTITY_PANEL_TAP_ORDER) {
        if (tapped.has(id)) continue;
        const z = zones.find((zone) => zone.id === id);
        if (!z || !z.onScreen || typeof z.sx !== 'number' || typeof z.sy !== 'number') continue;
        if (screen && (z.sx < margin || z.sy < margin || z.sx > screen.w - margin || z.sy > screen.h - margin)) continue;
        if (avoid && z.sx >= avoid.x && z.sx <= avoid.x + avoid.w && z.sy >= avoid.y && z.sy <= avoid.y + avoid.h) continue;
        return z;
    }
    return null;
}

interface DecalRow { producerId: string; parts: number; rect: { w: number; h: number } | null }
interface IconRow { slot: string; icon: string; rect: { x: number; y: number; w: number; h: number } | null }

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : NaN);

function rectOf(value: unknown): { x: number; y: number; w: number; h: number } | null {
    if (typeof value !== 'object' || value === null) return null;
    const r = value as Record<string, unknown>;
    const [x, y, w, h] = [num(r.x), num(r.y), num(r.w), num(r.h)];
    return [x, y, w, h].every(Number.isFinite) ? { x, y, w, h } : null;
}

function decalsOf(event: ParsedDeviceEvent): DecalRow[] {
    const raw = event.decals;
    if (!Array.isArray(raw)) return [];
    return raw.map((row) => {
        const r = (row ?? {}) as Record<string, unknown>;
        return { producerId: String(r.producerId ?? ''), parts: num(r.parts), rect: rectOf(r.rect) };
    });
}

function iconsOf(event: ParsedDeviceEvent): IconRow[] {
    const raw = event.icons;
    if (!Array.isArray(raw)) return [];
    return raw.map((row) => {
        const r = (row ?? {}) as Record<string, unknown>;
        return { slot: String(r.slot ?? ''), icon: String(r.icon ?? ''), rect: rectOf(r.rect) };
    });
}

export function evaluateIdentity(events: readonly IdentityTimelineEvent[], expect: IdentityExpectation): IdentityCheck[] {
    const checks: IdentityCheck[] = [];
    const errors = events.filter((e) => e.event.evt === 'error');
    checks.push({ id: 'identity_no_errors', ok: errors.length === 0, detail: `${errors.length} error events` });
    const identity = events.filter((e) => e.event.evt === 'identity' && e.event.phase !== 'toast_icon');
    const toastIcons = events.filter((e) => e.event.evt === 'identity' && e.event.phase === 'toast_icon');
    checks.push({ id: 'identity_events_seen', ok: identity.length > 0, detail: `${identity.length} identity events` });
    const last = identity[identity.length - 1]?.event;
    if (!last) return checks;
    const toastCheck = (icon: string, kind: string): void => {
        const match = toastIcons.find((e) => e.event.icon === icon && e.event.kind === kind);
        const m = match?.event;
        checks.push({ id: `identity_toast_icon_${kind}`, ok: m !== undefined, detail: m ? `kind ${kind} -> icon ${icon} (tier ${String(m.tier)})` : `no toast icon event for kind ${kind} (seen: ${toastIcons.map((e) => `${String(e.event.kind)}=${String(e.event.icon)}`).join(', ') || 'none'})` });
        // Major / Exceptional bands start below the chip stack; the Minor band stays on the first line.
        const clear = m !== undefined && (m.tier === 'minor' || num(m.topOffset) >= num(m.chipsBottom));
        checks.push({ id: `identity_toast_clear_of_chips_${kind}`, ok: clear, detail: m ? `tier ${String(m.tier)} topOffset=${String(m.topOffset)} chipsBottom=${String(m.chipsBottom)}` : 'no toast icon event' });
    };

    if (expect === 'panel') {
        const headers = identity.flatMap((e) => iconsOf(e.event)).filter((icon) => icon.slot === 'producer_header');
        const seen = new Set(headers.map((icon) => icon.icon));
        const missing = IDENTITY_PANEL_ICONS.filter((icon) => !seen.has(icon));
        checks.push({ id: 'identity_panel_header_icons', ok: missing.length === 0, detail: missing.length === 0 ? `header icons seen: ${[...seen].join(', ')}` : `missing ${missing.join(', ')} (seen: ${[...seen].join(', ') || 'none'})` });
        const small = headers.filter((icon) => icon.rect === null || Math.min(icon.rect.w, icon.rect.h) < IDENTITY_PANEL_MIN_ICON_PX);
        checks.push({ id: 'identity_panel_header_rects', ok: headers.length > 0 && small.length === 0, detail: headers.length === 0 ? 'no producer_header rect reported' : `${headers.length} reports, min edge ${Math.round(Math.min(...headers.map((icon) => (icon.rect ? Math.min(icon.rect.w, icon.rect.h) : 0))))}px (>= ${IDENTITY_PANEL_MIN_ICON_PX})` });
    } else if (expect === 'toast_breakthrough') {
        toastCheck('breakthrough', 'breakthrough');
    } else if (expect === 'factory') {
        const decals = decalsOf(last);
        const total = decals.reduce((sum, row) => sum + (Number.isFinite(row.parts) ? row.parts : 0), 0);
        checks.push({ id: 'identity_decals_every_producer', ok: decals.length === IDENTITY_PRODUCER_COUNT && decals.every((row) => row.parts >= 1), detail: decals.map((row) => `${row.producerId}:${row.parts}`).join(' ') || 'no decals' });
        checks.push({ id: 'identity_decal_budget', ok: decals.every((row) => row.parts <= DECAL_MAX_PARTS_PER_PRODUCER) && total <= DECAL_MAX_PARTS_TOTAL, detail: `${total} merged renderers (<= ${DECAL_MAX_PARTS_PER_PRODUCER} per producer, <= ${DECAL_MAX_PARTS_TOTAL} total)` });
        checks.push({ id: 'identity_decal_rects_reported', ok: decals.length > 0 && decals.every((row) => row.rect !== null && row.rect.w > 0 && row.rect.h > 0), detail: decals.map((row) => `${row.producerId}:${row.rect ? `${Math.round(row.rect.w)}x${Math.round(row.rect.h)}px` : 'none'}`).join(' ') || 'no decals' });
        const icons = iconsOf(last);
        const missing = IDENTITY_REQUIRED_ICON_SLOTS.filter((slot) => !icons.some((icon) => icon.slot === slot && icon.rect !== null));
        checks.push({ id: 'identity_icons_drawn', ok: missing.length === 0, detail: missing.length === 0 ? icons.map((icon) => `${icon.slot}=${icon.icon}`).join(' ') : `missing ${missing.join(', ')}` });
        // icons of hidden surfaces (e.g. the Founder chip without a store) report a zero-size rect: not drawn, so not judged
        const tiny = icons.filter((icon) => icon.rect !== null && Math.min(icon.rect.w, icon.rect.h) > 0 && Math.min(icon.rect.w, icon.rect.h) < IDENTITY_MIN_ICON_PX);
        checks.push({ id: 'identity_icon_rects_sane', ok: tiny.length === 0 && icons.every((icon) => icon.rect !== null), detail: tiny.length === 0 ? `${icons.length} icons, min edge >= ${IDENTITY_MIN_ICON_PX}px` : `too small: ${tiny.map((icon) => icon.slot).join(', ')}` });
    } else {
        const core = (last.aiCore ?? {}) as Record<string, unknown>;
        checks.push({ id: 'identity_ai_core_built', ok: core.built === true && num(core.modelRenderers) === IDENTITY_AI_CORE_RENDERERS, detail: `built=${String(core.built)} modelRenderers=${String(core.modelRenderers)}` });
        checks.push({ id: 'identity_ai_core_shape', ok: num(core.shellBars) === 12 && num(core.arcBoxes) === 24 && num(core.arcSegments) === 3, detail: `shellBars=${String(core.shellBars)} arcBoxes=${String(core.arcBoxes)} arcSegments=${String(core.arcSegments)}` });
        const applied = events.find((e) => e.event.evt === 'reboot_presentation' && e.event.phase === 'effect_applied' && e.event.part === 'core');
        toastCheck('reboot', 'reboot_title');
        checks.push({ id: 'identity_ai_core_in_sequence', ok: applied !== undefined && num(applied.event.aiCoreParts) === IDENTITY_AI_CORE_RENDERERS, detail: applied ? `aiCoreParts=${String(applied.event.aiCoreParts)}` : 'no reboot core effect_applied' });
    }
    return checks;
}
