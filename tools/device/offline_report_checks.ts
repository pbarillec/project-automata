/**
 * AUT-051 objective checks of the Offline Factory Report device capture (pure, unit-tested; used by `reveal_capture.ts`).
 * The capture records `offline_report` DEBUG events; a synthetic `capture_marker` (phase `relaunch`) separates the first launch from the
 * force-stop + relaunch WITHOUT reseeding.
 */
import type { ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';
import { toRect } from './ui_geometry.ts';

export type OfflineReportExpectation = 'collect' | 'reload' | 'short';

export interface OfflineTimelineEvent { readonly tMs: number; readonly event: ParsedDeviceEvent }
export interface OfflineCheck { readonly id: string; readonly ok: boolean; readonly detail: string }

/** Synthetic timeline marker the capture inserts where it force-stops and relaunches (never emitted by the app). */
export const OFFLINE_RELAUNCH_MARKER_EVT = 'capture_marker';

/** Relative reward difference allowed between the first launch and the relaunch (the absence grows by the relaunch gap). */
export const OFFLINE_RELOAD_REWARD_TOLERANCE = 0.01;

const AD_WORDS = /rewarded|x2|×2|\bads?\b|double/i;

export function evaluateOfflineReport(events: readonly OfflineTimelineEvent[], expect: OfflineReportExpectation): OfflineCheck[] {
    const markerIndex = events.findIndex((e) => e.event.evt === OFFLINE_RELAUNCH_MARKER_EVT);
    const before = markerIndex < 0 ? events : events.slice(0, markerIndex);
    const after = markerIndex < 0 ? [] : events.slice(markerIndex + 1);
    const phaseOf = (list: readonly OfflineTimelineEvent[], phase: string) => list.filter((e) => e.event.evt === 'offline_report' && e.event.phase === phase);
    const checks: OfflineCheck[] = [];
    if (expect === 'short') {
        // AUT-051b: a sub-minute absence shows no card; the preview is collected silently (normal critical save).
        const cards = events.filter((e) => e.event.evt === 'offline_report' && (e.event.phase === 'shown' || e.event.phase === 'refreshed'));
        const auto = phaseOf(events, 'auto_collected')[0];
        checks.push({ id: 'offline_short_no_card', ok: cards.length === 0, detail: `${cards.length} card event(s)` });
        checks.push({
            id: 'offline_short_auto_collected',
            ok: auto !== undefined && auto.event.status === 'collected_saved' && auto.event.saveOk === true && Number(auto.event.reward ?? 0) > 0 && Number(auto.event.rawSeconds ?? Number.POSITIVE_INFINITY) < 60,
            detail: auto ? `status=${String(auto.event.status)} saveOk=${String(auto.event.saveOk)} rawSeconds=${String(auto.event.rawSeconds)} reward=${String(auto.event.reward)}` : 'no auto_collected',
        });
        checks.push({ id: 'offline_short_no_collect_tap', ok: phaseOf(events, 'collect_tapped').length === 0, detail: 'no COLLECT interaction was needed' });
        return checks;
    }
    const shown = phaseOf(before, 'shown')[0];
    const cardRect = toRect(shown?.event.cardRect);
    const collectRect = toRect(shown?.event.collectRect);
    const reward = Number(shown?.event.reward ?? 0);
    checks.push({
        id: 'offline_card_shown_on_launch',
        ok: shown !== undefined && reward > 0,
        detail: shown ? `t=${shown.tMs}ms reward=${reward} effectiveSeconds=${String(shown.event.effectiveSeconds)} explainShown=${String(shown.event.explainShown)}` : 'no offline_report shown',
    });
    checks.push({ id: 'offline_card_and_collect_rects', ok: cardRect !== null && collectRect !== null && collectRect.w > 0 && collectRect.h > 0, detail: JSON.stringify({ cardRect, collectRect }) });
    checks.push({ id: 'offline_no_ad_affordance', ok: shown === undefined || !AD_WORDS.test(JSON.stringify(shown.event.texts ?? {})), detail: JSON.stringify(shown?.event.texts ?? null) });

    if (expect === 'reload') {
        const second = phaseOf(after, 'shown')[0];
        const next = Number(second?.event.reward ?? 0);
        const close = reward > 0 && Math.abs(next - reward) / reward <= OFFLINE_RELOAD_REWARD_TOLERANCE;
        checks.push({ id: 'offline_report_reloaded_after_kill', ok: second !== undefined && close, detail: second ? `reward before=${reward} after=${next}` : 'no shown after the relaunch' });
        const taps = phaseOf(events, 'collect_tapped').length;
        checks.push({ id: 'offline_no_collect_in_reload', ok: taps === 0, detail: `${taps} collect_tapped` });
        return checks;
    }

    const tapped = phaseOf(before, 'collect_tapped')[0];
    checks.push({ id: 'offline_collect_tapped', ok: tapped !== undefined, detail: tapped ? `t=${tapped.tMs}ms` : 'collect not tapped' });
    const result = phaseOf(before, 'collect_result')[0];
    checks.push({
        id: 'offline_collect_saved',
        ok: result?.event.status === 'collected_saved' && result.event.saveOk === true,
        detail: result ? `status=${String(result.event.status)} saveOk=${String(result.event.saveOk)}` : 'no collect_result',
    });
    const hidden = phaseOf(before, 'hidden')[0];
    checks.push({ id: 'offline_card_hidden_after_collect', ok: hidden !== undefined, detail: hidden ? `t=${hidden.tMs}ms scale=${String(hidden.event.scale)}` : 'no hidden' });
    const tapTime = tapped?.tMs ?? Number.POSITIVE_INFINITY;
    const fanfare = before.filter((e) => e.tMs >= tapTime && (
        (e.event.evt === 'milestone_presentation' && e.event.phase === 'toast_started')
        || (e.event.evt === 'camera_focus' && e.event.phase === 'started')
        || (e.event.evt === 'era_transition' && e.event.phase === 'title_started')
        || (e.event.evt === 'reboot_presentation' && e.event.phase === 'sequence_started')));
    checks.push({ id: 'offline_collect_no_fanfare', ok: fanfare.length === 0, detail: `${fanfare.length} toast / camera focus / era / reboot events after the tap` });
    // The relaunch itself takes several seconds, so a small genuine report for that gap may legitimately appear; what must not appear is the ORIGINAL report again (cursor advanced, no re-grant).
    const originalReward = Number(shown?.event.reward ?? 0);
    const originalSeconds = Number(shown?.event.effectiveSeconds ?? 0);
    const reshown = phaseOf(after, 'shown');
    const regrant = reshown.some((e) => Number(e.event.reward ?? 0) > originalReward * 0.05 || Number(e.event.effectiveSeconds ?? 0) > originalSeconds * 0.05);
    checks.push({ id: 'offline_no_original_report_after_relaunch', ok: markerIndex >= 0 && !regrant, detail: `${reshown.length} card(s) after the relaunch, original report re-shown: ${String(regrant)}` });
    // AUT-051b: the relaunch gap is under 60 s, so it is auto-collected silently: no card at all after the relaunch.
    checks.push({ id: 'offline_relaunch_gap_silent', ok: markerIndex >= 0 && reshown.length === 0, detail: `${reshown.length} card(s), ${phaseOf(after, 'auto_collected').length} auto_collected after the relaunch` });
    checks.push({ id: 'offline_collect_persisted', ok: result?.event.saveOk === true && markerIndex >= 0 && !regrant, detail: 'saved collect; the original report is not re-granted after the relaunch (only the small relaunch gap may show)' });
    return checks;
}
