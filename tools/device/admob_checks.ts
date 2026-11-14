/**
 * AUT-057 objective checks of the real-AdMob (test ads) device capture (pure, unit-tested; used by `reveal_capture.ts`).
 * The capture records `ads_state` (provider / overlay diagnostics), `offline_double` / `extended_overclock` (flow), `offline_report`,
 * `session_state` and `ui_layout` DEBUG events.
 *
 * Real Google test ads cannot be tapped closed reliably through ADB (the ad is a WebView and its countdown is real time), so the drive waits up to
 * ~45 s for the result and presses BACK after a fixed delay. What the user did NOT do cannot be asserted: the checks that depend on the ad outcome
 * are therefore BEST-EFFORT (always `ok`, the detail records what happened) and the structural checks are hard.
 */
import type { ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';
import { toRect } from './ui_geometry.ts';

export type AdmobExpectation = 'offline_double' | 'extended' | 'no_fill';

export interface AdmobTimelineEvent { readonly tMs: number; readonly event: ParsedDeviceEvent }
export interface AdmobCheck { readonly id: string; readonly ok: boolean; readonly detail: string }

/** Wait for the final ad result, then press BACK once, then wait again (total about 45 s). */
export const ADMOB_RESULT_WAIT_BEFORE_BACK_MS = 30_000;
export const ADMOB_RESULT_WAIT_AFTER_BACK_MS = 15_000;
/** The ad is loaded in the background after init; the x2 / chip may take a while to appear. */
export const ADMOB_AVAILABILITY_WAIT_MS = 60_000;

const PLACEMENT_BY_EXPECTATION = { offline_double: 'rewarded.offline_double', extended: 'rewarded.extended_overclock' } as const;
const FLOW_EVT_BY_EXPECTATION = { offline_double: 'offline_double', extended: 'extended_overclock' } as const;

const ads = (events: readonly AdmobTimelineEvent[], phase: string) => events.filter((e) => e.event.evt === 'ads_state' && e.event.phase === phase);
const indexOfFirst = (events: readonly AdmobTimelineEvent[], predicate: (e: AdmobTimelineEvent) => boolean): number => events.findIndex(predicate);

export function evaluateAdmob(events: readonly AdmobTimelineEvent[], expect: AdmobExpectation): AdmobCheck[] {
    const checks: AdmobCheck[] = [];
    const errors = events.filter((e) => e.event.evt === 'error');
    checks.push({ id: 'admob_no_errors', ok: errors.length === 0, detail: `${errors.length} error events` });

    const init = ads(events, 'initialized')[0];
    if (expect === 'no_fill') return [...checks, ...evaluateNoFill(events, init)];

    const placementId = PLACEMENT_BY_EXPECTATION[expect];
    const flowEvt = FLOW_EVT_BY_EXPECTATION[expect];
    checks.push({ id: 'admob_init_ready', ok: init?.event.status === 'ready' || init?.event.status === 'initializing', detail: init ? `status=${String(init.event.status)} reason=${String(init.event.reason ?? null)}` : 'no ads_state initialized' });

    const availableIndex = indexOfFirst(events, (e) => e.event.evt === 'ads_state' && e.event.phase === 'availability' && e.event.placementId === placementId && e.event.available === true);
    const initIndex = indexOfFirst(events, (e) => e.event.evt === 'ads_state' && e.event.phase === 'initialized');
    checks.push({ id: 'admob_availability_true_after_init', ok: availableIndex >= 0 && initIndex >= 0 && availableIndex > initIndex, detail: availableIndex >= 0 ? `availability true at event #${availableIndex} (init #${initIndex})` : `${placementId} never reported available` });

    const flowStarted = indexOfFirst(events, (e) => e.event.evt === flowEvt && e.event.phase === 'ad_started');
    const overlayBegin = indexOfFirst(events, (e) => e.event.evt === 'ads_state' && e.event.phase === 'overlay' && e.event.state === 'begin');
    const nativeStarted = indexOfFirst(events, (e) => e.event.evt === 'ads_state' && e.event.phase === 'native_started');
    const result = indexOfFirst(events, (e) => e.event.evt === 'ads_state' && e.event.phase === 'ad_result');
    const overlayEnd = indexOfFirst(events, (e) => e.event.evt === 'ads_state' && e.event.phase === 'overlay' && e.event.state === 'end');
    checks.push({ id: 'admob_ad_started_by_flow', ok: flowStarted >= 0 && overlayBegin > flowStarted, detail: `flow ad_started #${flowStarted}, overlay begin #${overlayBegin}` });
    checks.push({ id: 'admob_native_started', ok: nativeStarted > overlayBegin && overlayBegin >= 0, detail: `native_started #${nativeStarted} after overlay begin #${overlayBegin}` });

    const resultEvent = result >= 0 ? events[result] : undefined;
    // BEST-EFFORT: the outcome of a real test ad (the capture cannot reliably finish it).
    checks.push({ id: 'admob_ad_result_observed_best_effort', ok: true, detail: resultEvent ? `BEST-EFFORT observed: status=${String(resultEvent.event.status)} rewardVerified=${String(resultEvent.event.rewardVerified)} reason=${String(resultEvent.event.reason ?? null)}` : 'BEST-EFFORT not observed within the wait window (ad still on screen or not dismissed); structural checks below still apply' });
    if (resultEvent) {
        checks.push({ id: 'admob_order_overlay_begin_result_end', ok: overlayBegin >= 0 && result > overlayBegin && overlayEnd > result, detail: `begin #${overlayBegin} < ad_result #${result} < end #${overlayEnd}` });
        const requestId = resultEvent.event.requestId;
        checks.push({ id: 'admob_single_result_per_request', ok: events.filter((e) => e.event.evt === 'ads_state' && e.event.phase === 'ad_result' && e.event.requestId === requestId).length === 1, detail: `requestId=${String(requestId)}` });
        const status = String(resultEvent.event.status);
        const flow = (phase: string) => events.filter((e) => e.event.evt === flowEvt && e.event.phase === phase);
        if (status === 'rewarded' && resultEvent.event.rewardVerified === true) {
            const granted = flow('granted');
            checks.push({ id: 'admob_reward_granted_exactly_once', ok: granted.length === 1 && granted[0].event.saveOk === true && granted[0].event.claimCount === 1, detail: `${granted.length} granted, saveOk=${String(granted[0]?.event.saveOk ?? null)} claimCount=${String(granted[0]?.event.claimCount ?? null)}` });
        } else {
            const notGranted = flow('not_granted');
            checks.push({ id: 'admob_no_grant_without_verified_reward', ok: flow('granted').length === 0 && notGranted.length >= 1, detail: `${flow('granted').length} granted, ${notGranted.length} not_granted (status=${status})` });
        }
        const after = events.slice(result + 1);
        checks.push({ id: 'admob_game_responsive_after_result', ok: after.some((e) => e.event.evt === flowEvt || e.event.evt === 'ui_layout' || e.event.evt === 'offline_report'), detail: `${after.length} events after the result` });
    }

    // The overlay must not look like absence: no suspend / resume, no new offline report created by it.
    const sessionAfterBegin = events.slice(Math.max(overlayBegin, 0)).filter((e) => overlayBegin >= 0 && e.event.evt === 'session_state' && (e.event.phase === 'suspended' || e.event.phase === 'resumed'));
    checks.push({ id: 'admob_overlay_no_session_suspend_resume', ok: overlayBegin >= 0 && sessionAfterBegin.length === 0, detail: `${sessionAfterBegin.length} suspended/resumed session_state after the overlay began` });
    const newCards = events.slice(Math.max(overlayBegin, 0)).filter((e) => e.event.evt === 'offline_report' && e.event.phase === 'shown').length;
    checks.push({ id: 'admob_overlay_no_new_offline_report', ok: overlayBegin >= 0 && newCards === 0, detail: `${newCards} offline_report shown after the overlay began` });
    const hideSkipped = ads(events, 'overlay_hide_skipped').length;
    checks.push({ id: 'admob_overlay_hide_skipped_info', ok: true, detail: `INFO overlay_hide_skipped=${hideSkipped} overlay_show_skipped=${ads(events, 'overlay_show_skipped').length}` });
    return checks;
}

function evaluateNoFill(events: readonly AdmobTimelineEvent[], init: AdmobTimelineEvent | undefined): AdmobCheck[] {
    const checks: AdmobCheck[] = [];
    checks.push({ id: 'admob_nofill_init_reported', ok: init !== undefined, detail: init ? `status=${String(init.event.status)} reason=${String(init.event.reason ?? null)}` : 'no ads_state initialized' });
    const available = events.filter((e) => e.event.evt === 'ads_state' && e.event.phase === 'availability');
    checks.push({ id: 'admob_nofill_never_available', ok: available.every((e) => e.event.available !== true), detail: `${available.length} availability events; reasons=${JSON.stringify(available.map((e) => e.event.reason ?? null))}` });
    const withX2 = events.filter((e) => e.event.evt === 'ui_layout' && toRect((e.event.rects as Record<string, unknown> | undefined)?.OfflineReportDouble) !== null);
    const withChip = events.filter((e) => e.event.evt === 'ui_layout' && toRect((e.event.rects as Record<string, unknown> | undefined)?.ExtendedOverclockAction) !== null);
    checks.push({ id: 'admob_nofill_x2_and_extended_hidden', ok: withX2.length === 0 && withChip.length === 0, detail: `${withX2.length} layouts with OfflineReportDouble, ${withChip.length} with ExtendedOverclockAction` });
    checks.push({ id: 'admob_nofill_no_ad_started', ok: events.filter((e) => e.event.evt === 'offline_double' && e.event.phase === 'ad_started').length === 0 && ads(events, 'native_started').length === 0, detail: 'no ad was started' });
    const shown = events.find((e) => e.event.evt === 'offline_report' && e.event.phase === 'shown');
    checks.push({ id: 'admob_nofill_card_shown', ok: shown !== undefined, detail: shown ? `reward=${String(shown.event.reward)}` : 'no offline_report shown' });
    const collect = events.find((e) => e.event.evt === 'offline_report' && e.event.phase === 'collect_result');
    checks.push({ id: 'admob_nofill_free_collect_works', ok: collect?.event.status === 'collected_saved' && collect.event.saveOk === true, detail: collect ? `status=${String(collect.event.status)} saveOk=${String(collect.event.saveOk)}` : 'no collect_result (free COLLECT not exercised)' });
    return checks;
}
