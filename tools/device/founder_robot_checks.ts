/**
 * AUT-062 objective checks of the Founder Robot / UNIT 0001 device captures (pure, unit-tested; used by `reveal_capture.ts`).
 * The capture records the DEBUG `robot_founder` (owned, founderRanks, visible, pooled, shellTinted, fallbackShell, optional crest rect), `robot_population`,
 * `robot_perf` and `error` events; a synthetic `capture_marker` (phase `relaunch`) separates the first launch from the force-stop + relaunch WITHOUT reseeding.
 *
 * These checks prove wiring, the Founder-slot rule and determinism only. Whether the Founder robot is READABLE at the normal camera distance, the premium
 * feel, and the crest pixel size against the brief stay with the agent visual QA of the screenshots and the human sign-off (the crest rectangle is reported
 * as information, never as a pass criterion).
 */
import type { ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';
import { FOUNDER_SHOP_RELAUNCH_MARKER_EVT } from './founder_shop_checks.ts';

export type FounderRobotExpectation = 'not_owned' | 'owned_first' | 'owned_many' | 'mid_session' | 'reload';

export interface FounderRobotTimelineEvent { readonly tMs: number; readonly event: ParsedDeviceEvent }
export interface FounderRobotCheck { readonly id: string; readonly ok: boolean; readonly detail: string }

/** AUT-041 recorded worst p95 24.94 ms (30 robots) and >= 52.8 fps on the benchmark device; the Founder variant must not push a sampled window past it. */
export const FOUNDER_PERF_P95_BUDGET_MS = 25;
export const FOUNDER_PERF_MIN_FPS = 50;

const POOL_VISIBLE_MIN = 4;
const MAX_FOUNDER_ROBOTS = 2;

function ranksOf(event: ParsedDeviceEvent): number[] | null {
    const value = event.founderRanks;
    return Array.isArray(value) && value.every((entry) => typeof entry === 'number' && Number.isInteger(entry) && entry >= 0) ? (value as number[]) : null;
}

/** Why one robot_founder event breaks the rule, or null when it is consistent (pure; also used by the unit tests). */
export function founderEventViolation(event: ParsedDeviceEvent): string | null {
    const ranks = ranksOf(event);
    const visible = typeof event.visible === 'number' ? event.visible : NaN;
    if (typeof event.owned !== 'boolean') return 'owned is not a boolean';
    if (ranks === null) return 'founderRanks missing or invalid';
    if (!Number.isFinite(visible) || visible < 0) return 'visible missing or invalid';
    if (new Set(ranks).size !== ranks.length) return `duplicate ranks ${JSON.stringify(ranks)}`;
    if (ranks.length > MAX_FOUNDER_ROBOTS) return `${ranks.length} Founder robots (max ${MAX_FOUNDER_ROBOTS})`;
    if (visible >= 3 && ranks.length >= visible) return `${ranks.length} Founder robots of ${visible} visible (must stay a minority)`;
    if (event.owned === false) return ranks.length === 0 ? null : `not owned but founderRanks ${JSON.stringify(ranks)}`;
    if (!ranks.includes(0)) return `owned but rank 0 (the first Worker Bot) is not a Founder robot: ${JSON.stringify(ranks)}`;
    const expected = visible >= POOL_VISIBLE_MIN ? 2 : 1;
    return ranks.length === expected ? null : `owned with ${visible} visible expects ${expected} Founder robot(s), got ${JSON.stringify(ranks)}`;
}

export function evaluateFounderRobot(events: readonly FounderRobotTimelineEvent[], expect: FounderRobotExpectation): FounderRobotCheck[] {
    const checks: FounderRobotCheck[] = [];
    const markerIndex = events.findIndex((e) => e.event.evt === FOUNDER_SHOP_RELAUNCH_MARKER_EVT);
    const founder = events.filter((e) => e.event.evt === 'robot_founder');
    const before = markerIndex < 0 ? founder : events.slice(0, markerIndex).filter((e) => e.event.evt === 'robot_founder');
    const after = markerIndex < 0 ? [] : events.slice(markerIndex + 1).filter((e) => e.event.evt === 'robot_founder');
    const errors = events.filter((e) => e.event.evt === 'error');
    checks.push({ id: 'founder_no_errors', ok: errors.length === 0, detail: `${errors.length} error events` });
    checks.push({ id: 'founder_events_seen', ok: founder.length > 0, detail: `${founder.length} robot_founder events (${before.length} before / ${after.length} after the relaunch)` });

    const violations = founder.map((e) => ({ e, why: founderEventViolation(e.event) })).filter((entry) => entry.why !== null);
    checks.push({ id: 'founder_slot_rule_holds', ok: violations.length === 0, detail: violations.length === 0 ? `${founder.length} events consistent (<=2 Founder robots, a minority from 3 visible, rank 0 when owned)` : `t=${violations[0].e.tMs}ms ${violations[0].why}` });

    const flags = founder.map((e) => e.event.owned === true);
    const flips = flags.filter((flag, index) => index > 0 && flags[index - 1] === true && flag === false).length;
    checks.push({ id: 'founder_owned_never_flips_back', ok: flips === 0, detail: `${flips} owned -> not owned transition(s)` });

    const first = founder[0]?.event;
    const last = founder[founder.length - 1]?.event;
    const population = events.filter((e) => e.event.evt === 'robot_population');
    const maxVisible = Math.max(0, ...founder.map((e) => (typeof e.event.visible === 'number' ? e.event.visible : 0)), ...population.map((e) => (typeof e.event.visible === 'number' ? e.event.visible : 0)));

    if (expect === 'not_owned') {
        checks.push({ id: 'founder_not_owned_all_events', ok: founder.length > 0 && founder.every((e) => e.event.owned === false && ranksOf(e.event)?.length === 0), detail: `${founder.filter((e) => e.event.owned === true).length} owned event(s)` });
        checks.push({ id: 'founder_not_owned_population_present', ok: maxVisible >= POOL_VISIBLE_MIN, detail: `max visible ${maxVisible} (a population is on screen, none of it Founder)` });
    }
    if (expect === 'owned_many' || expect === 'reload') {
        checks.push({ id: 'founder_owned_all_events', ok: founder.length > 0 && founder.every((e) => e.event.owned === true), detail: `${founder.filter((e) => e.event.owned === false).length} not-owned event(s)` });
        const many = founder.find((e) => (e.event.visible as number) >= POOL_VISIBLE_MIN);
        checks.push({ id: 'founder_many_two_founders_minority', ok: many !== undefined && ranksOf(many.event)?.length === 2 && (many.event.visible as number) > 2, detail: many ? `visible=${String(many.event.visible)} founderRanks=${JSON.stringify(many.event.founderRanks)}` : 'no robot_founder with 4+ visible robots' });
    }
    if (expect === 'owned_first') {
        checks.push({ id: 'founder_first_robot_owned_before_reveal', ok: first?.owned === true && first.visible === 0 && JSON.stringify(first.founderRanks) === '[0]', detail: first ? `owned=${String(first.owned)} visible=${String(first.visible)} founderRanks=${JSON.stringify(first.founderRanks)}` : 'no robot_founder' });
        checks.push({ id: 'founder_first_robot_then_visible', ok: founder.some((e) => (e.event.visible as number) >= 1 && JSON.stringify(e.event.founderRanks) === '[0]'), detail: `max visible ${maxVisible}; the revealed Worker Bot is rank 0 = the Founder robot` });
    }
    if (expect === 'mid_session') {
        const firstOwnedIndex = before.findIndex((e) => e.event.owned === true);
        const unowned = before.filter((e, index) => e.event.owned === false && (firstOwnedIndex < 0 || index < firstOwnedIndex));
        checks.push({ id: 'founder_mid_session_starts_not_owned', ok: unowned.length > 0 && ranksOf(unowned[0].event)?.length === 0, detail: `${unowned.length} not-owned event(s) before the purchase` });
        const swapped = before[firstOwnedIndex]?.event;
        checks.push({ id: 'founder_mid_session_swaps_in_place', ok: firstOwnedIndex > 0 && swapped !== undefined && (ranksOf(swapped)?.includes(0) ?? false), detail: swapped ? `owned at event #${firstOwnedIndex}: visible=${String(swapped.visible)} founderRanks=${JSON.stringify(swapped.founderRanks)}` : 'no owned robot_founder after the purchase' });
        const buy = events.find((e) => e.event.evt === 'command_result' && (e.event.command as { type?: unknown } | undefined)?.type === 'grantFounderPack' && e.event.ok === true);
        checks.push({ id: 'founder_mid_session_after_grant_command', ok: buy !== undefined && firstOwnedIndex >= 0, detail: buy ? `grantFounderPack accepted at t=${buy.tMs}ms` : 'no accepted grantFounderPack' });
    }
    if (expect === 'reload' || expect === 'mid_session') {
        const beforeLast = before[before.length - 1]?.event;
        const afterFirst = after[0]?.event;
        const afterLast = after[after.length - 1]?.event;
        checks.push({ id: 'founder_relaunch_marker', ok: markerIndex >= 0, detail: markerIndex >= 0 ? 'relaunch marker present' : 'no relaunch marker' });
        checks.push({ id: 'founder_owned_after_relaunch', ok: after.length > 0 && afterFirst?.owned === true && (afterFirst !== undefined && ranksOf(afterFirst)?.includes(0) === true), detail: afterFirst ? `owned=${String(afterFirst.owned)} founderRanks=${JSON.stringify(afterFirst.founderRanks)}` : 'no robot_founder after the relaunch' });
        checks.push({ id: 'founder_ranks_deterministic_across_relaunch', ok: beforeLast !== undefined && afterLast !== undefined && JSON.stringify(beforeLast.founderRanks) === JSON.stringify(afterLast.founderRanks) && beforeLast.visible === afterLast.visible, detail: `before ${JSON.stringify(beforeLast?.founderRanks ?? null)}/${String(beforeLast?.visible ?? null)} after ${JSON.stringify(afterLast?.founderRanks ?? null)}/${String(afterLast?.visible ?? null)}` });
    }

    const perf = events.filter((e) => e.event.evt === 'robot_perf');
    const worstP95 = Math.max(0, ...perf.map((e) => Number(e.event.p95Ms)));
    const lowestFps = perf.length > 0 ? Math.min(...perf.map((e) => Number(e.event.fps))) : NaN;
    checks.push({ id: 'founder_perf_within_aut041_budget', ok: perf.length === 0 || (worstP95 <= FOUNDER_PERF_P95_BUDGET_MS && lowestFps >= FOUNDER_PERF_MIN_FPS), detail: perf.length === 0 ? 'no robot_perf events (the DEBUG benchmark override is not active; nothing to compare)' : `${perf.length} window(s): worst p95 ${worstP95.toFixed(2)} ms (budget ${FOUNDER_PERF_P95_BUDGET_MS}), lowest ${lowestFps.toFixed(1)} fps (min ${FOUNDER_PERF_MIN_FPS})` });

    // Information only (never a pass criterion): how the shell was tinted and the crest rectangle the app computed.
    const lastWithShell = [...founder].reverse().find((e) => Array.isArray(e.event.shellTinted));
    checks.push({ id: 'founder_shell_status_info', ok: true, detail: lastWithShell ? `shellTinted=${JSON.stringify(lastWithShell.event.shellTinted)} fallbackShell=${String(lastWithShell.event.fallbackShell)}` : 'no Founder robot node yet (not owned)' });
    const sampled = [...founder].reverse().find((e) => Array.isArray(e.event.crest) && (e.event.crest as unknown[]).length > 0);
    const crest = (sampled?.event.crest as Array<{ rank: number; rect: { w: number; h: number } }> | undefined)?.[0];
    checks.push({ id: 'founder_crest_rect_info', ok: true, detail: crest ? `rank ${crest.rank} crest ${Math.round(crest.rect.w)}x${Math.round(crest.rect.h)} window px (brief target ~22x45 on 1080x2412; information only)` : 'no crest rectangle sampled (not owned or not computable)' });
    return checks;
}
