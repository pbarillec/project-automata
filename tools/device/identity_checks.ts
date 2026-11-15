/**
 * AUT-066 objective checks of the Automata identity device captures (pure, unit-tested; used by `reveal_capture.ts`).
 * The capture records the DEBUG `identity` event (decal renderers per producer with a window rect, the AI Core model summary, every UI icon drawn with
 * its window rect) and `error` events. These checks prove wiring and budgets only: whether the marks READ at the normal camera, their pixel size against the
 * brief and the composition stay with the agent visual QA of the screenshots (the pixel sizes are reported as information, never as a pass criterion).
 */
import type { ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';
import { DECAL_MAX_PARTS_PER_PRODUCER, DECAL_MAX_PARTS_TOTAL } from '../../assets/scripts/presentation/AutomataIdentity.ts';

export type IdentityExpectation = 'factory' | 'ai_core';

export interface IdentityTimelineEvent { readonly tMs: number; readonly event: ParsedDeviceEvent }
export interface IdentityCheck { readonly id: string; readonly ok: boolean; readonly detail: string }

/** Icon slots that exist on every factory screen (HUD row + Overclock button). */
export const IDENTITY_REQUIRED_ICON_SLOTS: readonly string[] = Object.freeze(['hud_industrial_output', 'hud_overclock']);
export const IDENTITY_MIN_ICON_PX = 12;
export const IDENTITY_PRODUCER_COUNT = 5;
export const IDENTITY_AI_CORE_RENDERERS = 3;

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
    const identity = events.filter((e) => e.event.evt === 'identity');
    checks.push({ id: 'identity_events_seen', ok: identity.length > 0, detail: `${identity.length} identity events` });
    const last = identity[identity.length - 1]?.event;
    if (!last) return checks;

    if (expect === 'factory') {
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
        checks.push({ id: 'identity_ai_core_in_sequence', ok: applied !== undefined && num(applied.event.aiCoreParts) === IDENTITY_AI_CORE_RENDERERS, detail: applied ? `aiCoreParts=${String(applied.event.aiCoreParts)}` : 'no reboot core effect_applied' });
    }
    return checks;
}
