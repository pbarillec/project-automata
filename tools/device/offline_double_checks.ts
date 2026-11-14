/**
 * AUT-055 objective checks of the Offline Double (rewarded x2) device capture (pure, unit-tested; used by `reveal_capture.ts`).
 * The capture records `offline_double` / `offline_report` / `ui_layout` DEBUG events; a synthetic `capture_marker` (phase `relaunch`)
 * separates the first launch from the force-stop + relaunch WITHOUT reseeding. These checks prove wiring and geometry only; whether the
 * card with the x2 action reads well stays with the visual QA review of the screenshots.
 */
import type { ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';
import { UI_DESIGN_RESOLUTION } from '../../assets/scripts/presentation/UiLayout.ts';
import { rectInside, toRect, type Rect } from './ui_geometry.ts';

export type OfflineDoubleExpectation = 'success' | 'closed' | 'failed' | 'ineligible';

export interface OfflineDoubleTimelineEvent { readonly tMs: number; readonly event: ParsedDeviceEvent }
export interface OfflineDoubleCheck { readonly id: string; readonly ok: boolean; readonly detail: string }

/** Synthetic timeline marker the capture inserts where it force-stops and relaunches (never emitted by the app). */
export const OFFLINE_DOUBLE_RELAUNCH_MARKER_EVT = 'capture_marker';

/** The x2 action is at least this many design units tall (a comfortable touch target, like COLLECT). */
export const OFFLINE_DOUBLE_MIN_HEIGHT_UNITS = 64;
export const OFFLINE_DOUBLE_RECT_TOLERANCE_PX = 1.5;

export function evaluateOfflineDouble(events: readonly OfflineDoubleTimelineEvent[], expect: OfflineDoubleExpectation): OfflineDoubleCheck[] {
    const markerIndex = events.findIndex((e) => e.event.evt === OFFLINE_DOUBLE_RELAUNCH_MARKER_EVT);
    const before = markerIndex < 0 ? events : events.slice(0, markerIndex);
    const after = markerIndex < 0 ? [] : events.slice(markerIndex + 1);
    const double = (list: readonly OfflineDoubleTimelineEvent[], phase: string) => list.filter((e) => e.event.evt === 'offline_double' && e.event.phase === phase);
    const report = (list: readonly OfflineDoubleTimelineEvent[], phase: string) => list.filter((e) => e.event.evt === 'offline_report' && e.event.phase === phase);
    const checks: OfflineDoubleCheck[] = [];
    const errors = events.filter((e) => e.event.evt === 'error');
    checks.push({ id: 'double_no_errors', ok: errors.length === 0, detail: `${errors.length} error events` });

    const offers = double(before, 'offer');
    const offer = offers[offers.length - 1];
    const shown = report(before, 'shown')[0];
    checks.push({ id: 'double_card_shown', ok: shown !== undefined && Number(shown.event.reward ?? 0) > 0, detail: shown ? `reward=${String(shown.event.reward)}` : 'no offline_report shown' });

    if (expect === 'ineligible') {
        checks.push({
            id: 'double_offer_player_ineligible',
            ok: offer !== undefined && offer.event.eligible === false && offer.event.blockedBy === 'player' && offer.event.reason === 'below_min_offline',
            detail: offer ? `eligible=${String(offer.event.eligible)} reason=${String(offer.event.reason)} blockedBy=${String(offer.event.blockedBy)}` : 'no offer event',
        });
        const withDouble = events.filter((e) => e.event.evt === 'ui_layout' && toRect((e.event.rects as Record<string, unknown> | undefined)?.OfflineReportDouble) !== null);
        checks.push({ id: 'double_no_x2_rect', ok: withDouble.length === 0, detail: `${withDouble.length} ui_layout event(s) with OfflineReportDouble` });
        const layout = latestLayout(before, 'OfflineReportCollect');
        checks.push({ id: 'double_only_collect', ok: layout !== null && toRect(layout.rects.OfflineReportCollect) !== null, detail: layout ? JSON.stringify(layout.rects.OfflineReportCollect) : 'no ui_layout with OfflineReportCollect' });
        checks.push({ id: 'double_ineligible_no_ad', ok: double(events, 'ad_started').length === 0, detail: `${double(events, 'ad_started').length} ad_started` });
        const result = report(before, 'collect_result')[0];
        checks.push({ id: 'double_collect_saved', ok: result?.event.status === 'collected_saved' && result.event.saveOk === true, detail: result ? `status=${String(result.event.status)} saveOk=${String(result.event.saveOk)}` : 'no collect_result' });
        return checks;
    }

    checks.push({
        id: 'double_offer_eligible_and_available',
        ok: offer !== undefined && offer.event.eligible === true && offer.event.adAvailable === true && offer.event.blockedBy === null && Number(offer.event.projectedReward ?? 0) > 0,
        detail: offer ? `eligible=${String(offer.event.eligible)} adAvailable=${String(offer.event.adAvailable)} blockedBy=${String(offer.event.blockedBy)} projected=${String(offer.event.projectedReward)} claimsInWindow=${String(offer.event.claimsInWindow)}` : 'no offer event',
    });

    // Geometry of the card with the x2 action (latest layout that reports it, before the tap).
    const firstTap = report(before, 'double_tapped')[0];
    // Event order, not tMs: tMs mixes frame-collection time with event time. The first layout reporting the x2 rect is the card as shown before the tap.
    const layoutBeforeTap = firstLayout(before, 'OfflineReportDouble');
    checks.push(...geometryChecks(layoutBeforeTap));

    checks.push({ id: 'double_tapped', ok: firstTap !== undefined, detail: firstTap ? `t=${firstTap.tMs}ms` : 'x2 not tapped' });
    const started = double(before, 'ad_started')[0];
    const adResult = double(before, 'ad_result')[0];
    checks.push({ id: 'double_ad_started', ok: started !== undefined && typeof started.event.requestId === 'string' && String(started.event.requestId).length > 0, detail: started ? `requestId=${String(started.event.requestId)}` : 'no ad_started' });
    const claimsBefore = double(before, 'claims')[0];
    const claimsAfter = double(after, 'claims')[0];

    if (expect === 'success') {
        checks.push({ id: 'double_ad_rewarded_verified', ok: adResult?.event.status === 'rewarded' && adResult.event.rewardVerified === true && adResult.event.duplicate === false, detail: adResult ? JSON.stringify({ status: adResult.event.status, rewardVerified: adResult.event.rewardVerified, duplicate: adResult.event.duplicate }) : 'no ad_result' });
        const granted = double(before, 'granted')[0];
        const base = Number(granted?.event.baseReward ?? Number.NaN);
        const total = Number(granted?.event.grantedReward ?? Number.NaN);
        checks.push({
            id: 'double_granted_exactly_2x',
            ok: granted !== undefined && base > 0 && Math.abs(total - 2 * base) <= 0.011 && granted.event.multiplier === 2,
            detail: granted ? `base=${base} granted=${total} multiplier=${String(granted.event.multiplier)}` : 'no granted event',
        });
        const projected = Number(offer?.event.projectedReward ?? Number.NaN);
        checks.push({ id: 'double_granted_matches_projection', ok: granted !== undefined && Number.isFinite(projected) && Math.abs(total - projected) <= Math.abs(projected) * 0.01, detail: `projected=${projected} granted=${total}` });
        checks.push({ id: 'double_granted_saved_claim_1', ok: granted?.event.saveOk === true && granted.event.claimCount === 1, detail: granted ? `saveOk=${String(granted.event.saveOk)} claimCount=${String(granted.event.claimCount)}` : 'no granted event' });
        checks.push({ id: 'double_granted_once', ok: double(events, 'granted').length === 1, detail: `${double(events, 'granted').length} granted event(s)` });
        const hidden = report(before, 'hidden').find((e) => e.event.reason === 'double_granted');
        checks.push({ id: 'double_card_closed_after_grant', ok: hidden !== undefined, detail: hidden ? `t=${hidden.tMs}ms` : 'no hidden(double_granted)' });
        const reshown = report(after, 'shown');
        checks.push({ id: 'double_no_card_after_relaunch', ok: markerIndex >= 0 && reshown.length === 0, detail: `${reshown.length} card(s) after the relaunch` });
        checks.push({
            id: 'double_claim_persisted_after_relaunch',
            ok: markerIndex >= 0 && Number(claimsBefore?.event.claimCount ?? 0) === 0 && Number(claimsAfter?.event.claimCount ?? 0) === 1,
            detail: `claimCount before=${String(claimsBefore?.event.claimCount ?? null)} after relaunch=${String(claimsAfter?.event.claimCount ?? null)}`,
        });
        return checks;
    }

    // closed / failed: no grant, the card stays, the free COLLECT then pays the normal reward and records no claim.
    checks.push({ id: 'double_ad_not_rewarded', ok: adResult?.event.status === expect && adResult.event.rewardVerified === false, detail: adResult ? JSON.stringify({ status: adResult.event.status, rewardVerified: adResult.event.rewardVerified }) : 'no ad_result' });
    const notGranted = double(before, 'not_granted')[0];
    checks.push({ id: 'double_not_granted', ok: notGranted !== undefined && double(events, 'granted').length === 0, detail: notGranted ? `reason=${String(notGranted.event.reason)}` : 'no not_granted' });
    const hiddenEarly = report(before, 'hidden').find((e) => notGranted !== undefined && e.tMs >= (firstTap?.tMs ?? 0) && e.tMs <= notGranted.tMs + 50);
    checks.push({ id: 'double_card_stays_after_not_granted', ok: notGranted !== undefined && hiddenEarly === undefined, detail: hiddenEarly ? `card hidden at ${hiddenEarly.tMs}ms` : 'card still visible' });
    const collectTapped = report(before, 'collect_tapped')[0];
    checks.push({ id: 'double_free_collect_tapped', ok: collectTapped !== undefined && (notGranted === undefined || collectTapped.tMs >= notGranted.tMs), detail: collectTapped ? `t=${collectTapped.tMs}ms` : 'COLLECT not tapped' });
    const result = report(before, 'collect_result')[0];
    checks.push({ id: 'double_free_collect_saved', ok: result?.event.status === 'collected_saved' && result.event.saveOk === true, detail: result ? `status=${String(result.event.status)} saveOk=${String(result.event.saveOk)}` : 'no collect_result' });
    checks.push({
        id: 'double_no_claim_recorded',
        ok: markerIndex >= 0 && Number(claimsBefore?.event.claimCount ?? 0) === 0 && Number(claimsAfter?.event.claimCount ?? 0) === 0 && double(events, 'granted').length === 0,
        detail: `claimCount before=${String(claimsBefore?.event.claimCount ?? null)} after relaunch=${String(claimsAfter?.event.claimCount ?? null)}`,
    });
    return checks;
}

interface LayoutSnapshot { readonly screen: { w: number; h: number }; readonly safeArea: Rect | null; readonly rects: Record<string, unknown> }

function firstLayout(list: readonly OfflineDoubleTimelineEvent[], rectName: string): LayoutSnapshot | null {
    const index = list.findIndex((e) => e.event.evt === 'ui_layout' && toRect((e.event.rects as Record<string, unknown> | undefined)?.[rectName]) !== null);
    return index < 0 ? null : latestLayout(list.slice(0, index + 1), rectName);
}

function latestLayout(list: readonly OfflineDoubleTimelineEvent[], rectName: string): LayoutSnapshot | null {
    const hit = list.filter((e) => e.event.evt === 'ui_layout' && toRect((e.event.rects as Record<string, unknown> | undefined)?.[rectName]) !== null).pop();
    if (!hit) return null;
    const screen = hit.event.screen as { w?: unknown; h?: unknown } | undefined;
    if (!screen || typeof screen.w !== 'number' || typeof screen.h !== 'number') return null;
    return { screen: { w: screen.w, h: screen.h }, safeArea: toRect(hit.event.safeArea), rects: hit.event.rects as Record<string, unknown> };
}

/** x2 >= 64 design units, inside the card, below (not overlapping) COLLECT, COLLECT >= x2, the card inside the safe area / screen. */
export function geometryChecks(layout: LayoutSnapshot | null): OfflineDoubleCheck[] {
    if (!layout) return [{ id: 'double_geometry', ok: false, detail: 'no ui_layout reported the x2 rect' }];
    const card = toRect(layout.rects.OfflineReportCard);
    const collect = toRect(layout.rects.OfflineReportCollect);
    const double = toRect(layout.rects.OfflineReportDouble);
    if (!card || !collect || !double) return [{ id: 'double_geometry', ok: false, detail: JSON.stringify({ card, collect, double }) }];
    const scale = layout.screen.w / UI_DESIGN_RESOLUTION.width;
    const tol = OFFLINE_DOUBLE_RECT_TOLERANCE_PX;
    const safe = layout.safeArea ?? { x: 0, y: 0, w: layout.screen.w, h: layout.screen.h };
    // Window frame is bottom-left origin: "below" means a smaller y.
    const below = double.y + double.h <= collect.y + tol;
    return [
        { id: 'double_height_units', ok: double.h / scale >= OFFLINE_DOUBLE_MIN_HEIGHT_UNITS - 0.5, detail: `${(double.h / scale).toFixed(1)} design units (scale ${scale.toFixed(3)})` },
        { id: 'double_inside_card', ok: rectInside(card, double, tol), detail: JSON.stringify({ card, double }) },
        { id: 'double_below_collect_no_overlap', ok: below, detail: JSON.stringify({ collect, double }) },
        { id: 'double_collect_primary', ok: collect.w >= double.w - tol && collect.y > double.y, detail: `collect w=${collect.w.toFixed(1)} y=${collect.y.toFixed(1)}; x2 w=${double.w.toFixed(1)} y=${double.y.toFixed(1)}` },
        { id: 'double_card_in_safe_area', ok: rectInside(safe, card, tol), detail: JSON.stringify({ safe, card }) },
    ];
}
