/**
 * AUT-056 objective checks of the Extended Overclock (rewarded x2 for 10 active minutes) device capture (pure, unit-tested; used by
 * `reveal_capture.ts`). The capture records `extended_overclock` / `boost_presentation` / `command_result` / `ui_layout` DEBUG events; a
 * synthetic `capture_marker` (phase `relaunch`) separates the first launch from the force-stop + relaunch WITHOUT reseeding. These checks prove
 * wiring and geometry only; whether the chip reads well and how the boost feels stay with the visual QA review of the screenshots.
 *
 * Capture-check lessons from AUT-055: geometry and causality are compared by EVENT ORDER (tMs mixes frame-collection time with event time);
 * numbers shown with 2 decimals are compared with a 0.011 absolute tolerance; the ui_layout rect is read from the same layout that reports it.
 */
import type { ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';
import { UI_DESIGN_RESOLUTION } from '../../assets/scripts/presentation/UiLayout.ts';
import { EXTENDED_OVERCLOCK_DURATION_SECONDS, EXTENDED_OVERCLOCK_MULTIPLIER } from '../../assets/scripts/progression/TemporaryBoosts.ts';
import { rectInside, rectsOverlapBeyond, toRect, type Rect } from './ui_geometry.ts';

export type ExtendedOverclockExpectation = 'success' | 'free_active' | 'resume' | 'closed' | 'failed' | 'quota' | 'interval';

export interface ExtendedOverclockTimelineEvent { readonly tMs: number; readonly event: ParsedDeviceEvent }
export interface ExtendedOverclockCheck { readonly id: string; readonly ok: boolean; readonly detail: string }

/** Synthetic timeline marker the capture inserts where it force-stops and relaunches (never emitted by the app). */
export const EXTENDED_OVERCLOCK_RELAUNCH_MARKER_EVT = 'capture_marker';
export const EXTENDED_OVERCLOCK_MIN_HEIGHT_UNITS = 64;
export const EXTENDED_OVERCLOCK_MIN_LABEL_FONT_UNITS = 21;
export const EXTENDED_OVERCLOCK_RECT_TOLERANCE_PX = 1.5;
/** Absolute tolerance for numbers the app reports with 2 decimals. */
export const EXTENDED_OVERCLOCK_NUMBER_TOLERANCE = 0.011;
/** The persisted boost can be up to ~one save interval (~1 s) older than the last HUD value seen before the kill, so a relaunch may show slightly MORE remaining. */
export const EXTENDED_OVERCLOCK_SAVE_LAG_SECONDS = 2;
/** The HUD countdown must have ticked at least this much between the first and a later HUD report. */
export const EXTENDED_OVERCLOCK_MIN_TICK_SECONDS = 5;
export const EXTENDED_OVERCLOCK_NOTE_TEXT = 'No bonus this time.';

/** Rect names the chip must not overlap when they are reported. */
const NEIGHBOUR_RECTS = ['CoreHUD', 'ProducerPanel', 'SettingsChip', 'PermanentUpgradeChip', 'RebootChip'] as const;

interface LayoutSnapshot { readonly screen: { w: number; h: number }; readonly safeArea: Rect | null; readonly rects: Record<string, unknown> }

const rectOf = (event: ParsedDeviceEvent, name: string): Rect | null => toRect((event.rects as Record<string, unknown> | undefined)?.[name]);

export function evaluateExtendedOverclock(events: readonly ExtendedOverclockTimelineEvent[], expect: ExtendedOverclockExpectation): ExtendedOverclockCheck[] {
    const markerIndex = events.findIndex((e) => e.event.evt === EXTENDED_OVERCLOCK_RELAUNCH_MARKER_EVT);
    const before = markerIndex < 0 ? events : events.slice(0, markerIndex);
    const after = markerIndex < 0 ? [] : events.slice(markerIndex + 1);
    const ext = (list: readonly ExtendedOverclockTimelineEvent[], phase: string) => list.filter((e) => e.event.evt === 'extended_overclock' && e.event.phase === phase);
    const boostEvents = (list: readonly ExtendedOverclockTimelineEvent[], kind: string, boostId?: string) => ext(list, 'boost_event').filter((e) => e.event.event === kind && (boostId === undefined || e.event.boostId === boostId));
    const checks: ExtendedOverclockCheck[] = [];
    const errors = events.filter((e) => e.event.evt === 'error');
    checks.push({ id: 'extended_no_errors', ok: errors.length === 0, detail: `${errors.length} error events` });

    if (expect === 'quota' || expect === 'interval') {
        const offers = ext(before, 'offer');
        const offer = offers[offers.length - 1];
        const reason = expect === 'quota' ? 'quota_reached' : 'min_interval';
        checks.push({
            id: 'extended_offer_player_ineligible',
            ok: offer !== undefined && offer.event.eligible === false && offer.event.blockedBy === 'player' && offer.event.reason === reason,
            detail: offer ? `eligible=${String(offer.event.eligible)} reason=${String(offer.event.reason)} blockedBy=${String(offer.event.blockedBy)}` : 'no offer event',
        });
        const withChip = events.filter((e) => e.event.evt === 'ui_layout' && rectOf(e.event, 'ExtendedOverclockAction') !== null);
        checks.push({ id: 'extended_no_chip_rect', ok: withChip.length === 0, detail: `${withChip.length} ui_layout event(s) with ExtendedOverclockAction` });
        checks.push({ id: 'extended_ineligible_no_ad', ok: ext(events, 'ad_started').length === 0, detail: `${ext(events, 'ad_started').length} ad_started` });
        return checks;
    }

    if (expect === 'resume') {
        // Seed: Extended 15 s left + Free suspended (30 s left) by it. Expected chain by event order: Extended expires -> Free resumes with its frozen 30 s -> Free expires -> cooldown.
        const hudEvents = ext(events, 'hud');
        const firstHud = hudEvents[0];
        checks.push({
            id: 'extended_resume_start_active',
            ok: firstHud !== undefined && firstHud.event.state === 'active' && firstHud.event.freeState === 'suspended' && firstHud.event.multiplier === EXTENDED_OVERCLOCK_MULTIPLIER && String(firstHud.event.text ?? '').startsWith('Extended Overclock'),
            detail: firstHud ? JSON.stringify({ state: firstHud.event.state, freeState: firstHud.event.freeState, multiplier: firstHud.event.multiplier, text: firstHud.event.text }) : 'no hud event',
        });
        const order = events.map((e, index) => ({ e, index }));
        const expiredExtended = order.find(({ e }) => e.event.evt === 'extended_overclock' && e.event.phase === 'boost_event' && e.event.event === 'expired' && e.event.boostId === 'extended_overclock');
        const resumed = order.find(({ e, index }) => e.event.evt === 'extended_overclock' && e.event.phase === 'boost_event' && e.event.event === 'resumed' && e.event.boostId === 'free_overclock' && expiredExtended !== undefined && index > expiredExtended.index);
        const expiredFree = order.find(({ e, index }) => e.event.evt === 'extended_overclock' && e.event.phase === 'boost_event' && e.event.event === 'expired' && e.event.boostId === 'free_overclock' && resumed !== undefined && index > resumed.index);
        checks.push({ id: 'extended_resume_extended_expired', ok: expiredExtended !== undefined, detail: expiredExtended ? `index=${expiredExtended.index}` : 'no expired(extended_overclock)' });
        const resumedRemaining = Number(resumed?.e.event.remainingSeconds ?? Number.NaN);
        checks.push({ id: 'extended_resume_free_resumed_with_remaining', ok: resumed !== undefined && Math.abs(resumedRemaining - 30) <= EXTENDED_OVERCLOCK_NUMBER_TOLERANCE, detail: resumed ? `remainingSeconds=${resumedRemaining}` : 'no resumed(free_overclock) after the Extended expiry' });
        checks.push({ id: 'extended_resume_free_expired', ok: expiredFree !== undefined, detail: expiredFree ? `index=${expiredFree.index}` : 'no expired(free_overclock) after the resume' });
        const cooldownHud = order.find(({ e, index }) => e.event.evt === 'extended_overclock' && e.event.phase === 'hud' && e.event.state === 'cooldown' && expiredFree !== undefined && index > expiredFree.index);
        checks.push({ id: 'extended_resume_cooldown', ok: cooldownHud !== undefined, detail: cooldownHud ? `hud state=${String(cooldownHud.e.event.state)}` : 'no cooldown hud after the Free expiry' });
        checks.push({ id: 'extended_resume_no_ad', ok: ext(events, 'ad_started').length === 0 && boostEvents(events, 'activated').length === 0, detail: `${ext(events, 'ad_started').length} ad_started, ${boostEvents(events, 'activated').length} activated` });
        return checks;
    }

    // ---- tapped scenarios: success / free_active / closed / failed ----
    const offers = ext(before, 'offer');
    const offer = offers[0];
    checks.push({
        id: 'extended_offer_eligible_and_available',
        ok: offer !== undefined && offer.event.eligible === true && offer.event.adAvailable === true && offer.event.blockedBy === null,
        detail: offer ? `eligible=${String(offer.event.eligible)} adAvailable=${String(offer.event.adAvailable)} blockedBy=${String(offer.event.blockedBy)} claimsInWindow=${String(offer.event.claimsInWindow)}` : 'no offer event',
    });
    const firstLayoutIndex = before.findIndex((e) => e.event.evt === 'ui_layout' && rectOf(e.event, 'ExtendedOverclockAction') !== null);
    checks.push(...geometryChecks(firstLayoutIndex < 0 ? null : layoutAt(before[firstLayoutIndex].event)));
    const shown = ext(before, 'chip_shown')[0];
    const labelFont = Number(shown?.event.labelFontSize ?? Number.NaN);
    checks.push({
        id: 'extended_label_font_fits',
        ok: shown !== undefined && Number.isFinite(labelFont) && labelFont >= EXTENDED_OVERCLOCK_MIN_LABEL_FONT_UNITS - 0.011,
        detail: shown ? `label font ${String(shown.event.labelFontSize)} (min ${EXTENDED_OVERCLOCK_MIN_LABEL_FONT_UNITS}), tag font ${String(shown.event.tagFontSize)}` : 'no chip_shown event',
    });

    const started = ext(before, 'ad_started')[0];
    const adResult = ext(before, 'ad_result')[0];
    checks.push({ id: 'extended_ad_started', ok: started !== undefined && typeof started.event.requestId === 'string' && String(started.event.requestId).length > 0, detail: started ? `requestId=${String(started.event.requestId)}` : 'no ad_started (chip not tapped)' });
    const claimsBefore = ext(before, 'claims')[0];
    const claimsAfter = ext(after, 'claims')[0];
    const grantedList = ext(events, 'granted');
    const layoutsAfterGrant = (() => {
        const grantedIndex = events.findIndex((e) => e.event.evt === 'extended_overclock' && e.event.phase === 'granted');
        return grantedIndex < 0 ? [] : events.slice(grantedIndex + 1).filter((e, i) => (markerIndex < 0 || grantedIndex + 1 + i < markerIndex) && e.event.evt === 'ui_layout');
    })();

    if (expect === 'success' || expect === 'free_active') {
        checks.push({ id: 'extended_ad_rewarded_verified', ok: adResult?.event.status === 'rewarded' && adResult.event.rewardVerified === true && adResult.event.duplicate === false, detail: adResult ? JSON.stringify({ status: adResult.event.status, rewardVerified: adResult.event.rewardVerified, duplicate: adResult.event.duplicate }) : 'no ad_result' });
        const accepted = before.find((e) => e.event.evt === 'command_result' && (e.event.command as { type?: unknown } | undefined)?.type === 'activateExtendedOverclock' && e.event.ok === true);
        checks.push({ id: 'extended_command_result_accepted', ok: accepted !== undefined, detail: accepted ? JSON.stringify({ eventTypes: accepted.event.eventTypes ?? null }) : 'no accepted command_result for activateExtendedOverclock' });
        const phases = new Set(before.filter((e) => e.event.evt === 'boost_presentation').map((e) => String(e.event.phase)));
        const wanted = expect === 'success' ? ['started', 'effect_applied'] : ['started'];
        checks.push({ id: 'extended_boost_presentation', ok: wanted.every((p) => phases.has(p)), detail: `phases seen: ${[...phases].join(',')}` });
        const activated = boostEvents(before, 'activated', 'extended_overclock')[0];
        checks.push({
            id: 'extended_boost_event_params',
            ok: activated !== undefined && activated.event.multiplier === EXTENDED_OVERCLOCK_MULTIPLIER && activated.event.durationSeconds === EXTENDED_OVERCLOCK_DURATION_SECONDS && activated.event.source === 'rewarded' && typeof activated.event.requestId === 'string' && activated.event.requestId === started?.event.requestId,
            detail: activated ? JSON.stringify({ multiplier: activated.event.multiplier, durationSeconds: activated.event.durationSeconds, source: activated.event.source, requestId: activated.event.requestId }) : 'no activated(extended_overclock) boost event',
        });
        checks.push({ id: 'extended_granted_once_saved', ok: grantedList.length === 1 && grantedList[0].event.saveOk === true && grantedList[0].event.claimCount === 1, detail: grantedList.length > 0 ? JSON.stringify({ count: grantedList.length, saveOk: grantedList[0].event.saveOk, claimCount: grantedList[0].event.claimCount }) : 'no granted event' });
        // HUD by event order: the first hud after the activation shows the Extended pill at ~600 s; a later one shows the countdown has ticked.
        const activatedIndex = events.findIndex((e) => e === activated);
        const hudAfter = events.slice(activatedIndex < 0 ? events.length : activatedIndex).filter((e, i) => e.event.evt === 'extended_overclock' && e.event.phase === 'hud' && (markerIndex < 0 || (activatedIndex + i) < markerIndex));
        const firstHud = hudAfter[0];
        const lastHud = hudAfter[hudAfter.length - 1];
        const firstRemaining = Number(firstHud?.event.remainingSeconds ?? Number.NaN);
        const lastRemaining = Number(lastHud?.event.remainingSeconds ?? Number.NaN);
        checks.push({
            id: 'extended_hud_active_x2_600',
            ok: firstHud !== undefined && firstHud.event.state === 'active' && firstHud.event.multiplier === EXTENDED_OVERCLOCK_MULTIPLIER && String(firstHud.event.text ?? '') === 'Extended Overclock: ×2' && firstRemaining <= EXTENDED_OVERCLOCK_DURATION_SECONDS + EXTENDED_OVERCLOCK_NUMBER_TOLERANCE && firstRemaining >= EXTENDED_OVERCLOCK_DURATION_SECONDS - EXTENDED_OVERCLOCK_MIN_TICK_SECONDS,
            detail: firstHud ? JSON.stringify({ state: firstHud.event.state, multiplier: firstHud.event.multiplier, text: firstHud.event.text, timerText: firstHud.event.timerText, remainingSeconds: firstRemaining }) : 'no hud event after the activation',
        });
        checks.push({ id: 'extended_hud_countdown_ticks', ok: Number.isFinite(lastRemaining) && lastRemaining <= EXTENDED_OVERCLOCK_DURATION_SECONDS - EXTENDED_OVERCLOCK_MIN_TICK_SECONDS + EXTENDED_OVERCLOCK_NUMBER_TOLERANCE, detail: `first=${firstRemaining} last=${lastRemaining}` });
        if (expect === 'free_active') {
            const suspended = boostEvents(before, 'suspended', 'free_overclock')[0];
            const suspendedIndex = events.findIndex((e) => e === suspended);
            checks.push({
                id: 'extended_free_suspended_before_activation',
                ok: suspended !== undefined && suspended.event.suspendedByBoostId === 'extended_overclock' && activatedIndex > suspendedIndex && Number(suspended.event.remainingSeconds) > 0 && Number(suspended.event.remainingSeconds) <= 30 + EXTENDED_OVERCLOCK_NUMBER_TOLERANCE,
                detail: suspended ? JSON.stringify({ suspendedBy: suspended.event.suspendedByBoostId, remainingSeconds: suspended.event.remainingSeconds, order: suspendedIndex < activatedIndex }) : 'no suspended(free_overclock) boost event',
            });
            checks.push({ id: 'extended_effective_x2_not_x4', ok: firstHud !== undefined && firstHud.event.freeState === 'suspended' && firstHud.event.multiplier === 2, detail: firstHud ? `freeState=${String(firstHud.event.freeState)} multiplier=${String(firstHud.event.multiplier)}` : 'no hud event' });
        }
        const hiddenAfter = ext(before, 'chip_hidden').filter((e) => before.indexOf(e) > before.findIndex((x) => x.event.evt === 'extended_overclock' && x.event.phase === 'granted'));
        const lastLayout = layoutsAfterGrant[layoutsAfterGrant.length - 1];
        checks.push({ id: 'extended_chip_hidden_after_grant', ok: hiddenAfter.length > 0 && (lastLayout === undefined || rectOf(lastLayout.event, 'ExtendedOverclockAction') === null), detail: `${hiddenAfter.length} chip_hidden after granted; last layout chip rect ${lastLayout ? JSON.stringify(rectOf(lastLayout.event, 'ExtendedOverclockAction')) : 'n/a'}` });
        // Relaunch: claim persisted, boost still active with (roughly) the same remaining, chip still hidden.
        checks.push({ id: 'extended_claim_persisted_after_relaunch', ok: markerIndex >= 0 && Number(claimsBefore?.event.claimCount ?? Number.NaN) === 0 && Number(claimsAfter?.event.claimCount ?? Number.NaN) === 1, detail: `claimCount before=${String(claimsBefore?.event.claimCount ?? null)} after relaunch=${String(claimsAfter?.event.claimCount ?? null)}` });
        const hudRelaunch = ext(after, 'hud')[0];
        const relaunchRemaining = Number(hudRelaunch?.event.remainingSeconds ?? Number.NaN);
        checks.push({
            id: 'extended_boost_active_after_relaunch',
            ok: markerIndex >= 0 && hudRelaunch !== undefined && hudRelaunch.event.state === 'active' && Number.isFinite(relaunchRemaining) && relaunchRemaining <= lastRemaining + EXTENDED_OVERCLOCK_SAVE_LAG_SECONDS && relaunchRemaining >= lastRemaining - 15 && (expect !== 'free_active' || hudRelaunch.event.freeState === 'suspended'),
            detail: hudRelaunch ? JSON.stringify({ state: hudRelaunch.event.state, freeState: hudRelaunch.event.freeState, remainingSeconds: relaunchRemaining, lastBefore: lastRemaining }) : 'no hud event after the relaunch',
        });
        const chipAfter = after.filter((e) => e.event.evt === 'ui_layout' && rectOf(e.event, 'ExtendedOverclockAction') !== null);
        checks.push({ id: 'extended_no_chip_after_relaunch', ok: markerIndex >= 0 && chipAfter.length === 0, detail: `${chipAfter.length} chip rect(s) after the relaunch` });
        return checks;
    }

    // closed / failed: no grant, the chip stays offerable, a calm note shows, nothing about the boost or the claim changes.
    checks.push({ id: 'extended_ad_not_rewarded', ok: adResult?.event.status === expect && adResult.event.rewardVerified === false, detail: adResult ? JSON.stringify({ status: adResult.event.status, rewardVerified: adResult.event.rewardVerified }) : 'no ad_result' });
    const notGranted = ext(before, 'not_granted')[0];
    checks.push({ id: 'extended_not_granted', ok: notGranted !== undefined && grantedList.length === 0, detail: notGranted ? `reason=${String(notGranted.event.reason)}` : 'no not_granted' });
    const notGrantedIndex = events.findIndex((e) => e === notGranted);
    const acceptedCommand = events.find((e) => e.event.evt === 'command_result' && (e.event.command as { type?: unknown } | undefined)?.type === 'activateExtendedOverclock' && e.event.ok === true);
    checks.push({ id: 'extended_no_boost_activated', ok: boostEvents(events, 'activated').length === 0 && acceptedCommand === undefined, detail: `${boostEvents(events, 'activated').length} activated boost event(s)` });
    const hiddenAfterTap = notGrantedIndex < 0 ? [] : events.slice(notGrantedIndex).filter((e, i) => (markerIndex < 0 || notGrantedIndex + i < markerIndex) && e.event.evt === 'extended_overclock' && e.event.phase === 'chip_hidden');
    const latestLayoutBefore = [...before].reverse().find((e) => e.event.evt === 'ui_layout');
    checks.push({ id: 'extended_chip_stays_after_not_granted', ok: notGranted !== undefined && hiddenAfterTap.length === 0 && latestLayoutBefore !== undefined && rectOf(latestLayoutBefore.event, 'ExtendedOverclockAction') !== null, detail: `${hiddenAfterTap.length} chip_hidden after not_granted; latest layout chip rect ${latestLayoutBefore ? JSON.stringify(rectOf(latestLayoutBefore.event, 'ExtendedOverclockAction')) : 'n/a'}` });
    const note = ext(before, 'note')[0];
    checks.push({ id: 'extended_calm_note', ok: note !== undefined && note.event.tag === EXTENDED_OVERCLOCK_NOTE_TEXT, detail: note ? `tag=${String(note.event.tag)}` : 'no note event' });
    const offersAfter = notGrantedIndex < 0 ? [] : events.slice(notGrantedIndex).filter((e) => e.event.evt === 'extended_overclock' && e.event.phase === 'offer');
    const offerAfter = offersAfter[offersAfter.length - 1];
    checks.push({ id: 'extended_offer_still_eligible', ok: offerAfter !== undefined && offerAfter.event.eligible === true && offerAfter.event.blockedBy === null, detail: offerAfter ? `eligible=${String(offerAfter.event.eligible)} blockedBy=${String(offerAfter.event.blockedBy)}` : 'no offer refresh after the not_granted' });
    checks.push({
        id: 'extended_no_claim_recorded',
        ok: markerIndex >= 0 && Number(claimsBefore?.event.claimCount ?? Number.NaN) === 0 && Number(claimsAfter?.event.claimCount ?? Number.NaN) === 0,
        detail: `claimCount before=${String(claimsBefore?.event.claimCount ?? null)} after relaunch=${String(claimsAfter?.event.claimCount ?? null)}`,
    });
    return checks;
}

function layoutAt(event: ParsedDeviceEvent): LayoutSnapshot | null {
    const screen = event.screen as { w?: unknown; h?: unknown } | undefined;
    if (!screen || typeof screen.w !== 'number' || typeof screen.h !== 'number') return null;
    return { screen: { w: screen.w, h: screen.h }, safeArea: toRect(event.safeArea), rects: (event.rects ?? {}) as Record<string, unknown> };
}

/** Chip >= 64 design units tall, inside the safe area, overlapping none of the HUD / panel / other chips reported in the same layout. */
export function geometryChecks(layout: LayoutSnapshot | null): ExtendedOverclockCheck[] {
    if (!layout) return [{ id: 'extended_geometry', ok: false, detail: 'no ui_layout reported the chip rect' }];
    const chip = toRect(layout.rects.ExtendedOverclockAction);
    if (!chip) return [{ id: 'extended_geometry', ok: false, detail: 'chip rect missing' }];
    const scale = layout.screen.w / UI_DESIGN_RESOLUTION.width;
    const tol = EXTENDED_OVERCLOCK_RECT_TOLERANCE_PX;
    const safe = layout.safeArea ?? { x: 0, y: 0, w: layout.screen.w, h: layout.screen.h };
    const overlaps = NEIGHBOUR_RECTS.filter((name) => {
        const other = toRect(layout.rects[name]);
        return other !== null && rectsOverlapBeyond(chip, other, tol);
    });
    return [
        { id: 'extended_height_units', ok: chip.h / scale >= EXTENDED_OVERCLOCK_MIN_HEIGHT_UNITS - 0.5, detail: `${(chip.h / scale).toFixed(1)} design units, ${chip.h.toFixed(1)} px (scale ${scale.toFixed(3)})` },
        { id: 'extended_chip_in_safe_area', ok: rectInside(safe, chip, tol), detail: JSON.stringify({ safe, chip }) },
        { id: 'extended_chip_no_overlap', ok: overlaps.length === 0, detail: overlaps.length === 0 ? 'no overlap with the HUD, panel or chips' : `overlaps ${overlaps.join(', ')}` },
    ];
}
