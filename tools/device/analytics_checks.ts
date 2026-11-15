/**
 * AUT-064 objective checks of the DEBUG `analytics` events recorded during an existing monetization device capture (pure, unit-tested; used by
 * `reveal_capture.ts` through `expectAnalytics`). It reuses the AUT-055 / AUT-056 / AUT-059 success scenarios: the capture already records the
 * DEBUG `analytics` diagnostic (`tracked | invalid | provider_failure | disabled`, with the event id and its params), so no new seed is needed.
 *
 * The checks prove wiring and the clean-event contract only (validated params, one opportunity per episode, opt-in / grant / completion linkage,
 * no price text, one opaque session id per launch). Real analytics backend delivery is out of scope (the DEBUG provider only logs).
 */
import type { ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';
import { validateAnalyticsEvent } from '../../assets/scripts/services/AnalyticsValidator.ts';

export type AnalyticsExpectation = 'offline_double' | 'extended_overclock' | 'founder_purchase';

export interface AnalyticsTimelineEvent { readonly tMs: number; readonly event: ParsedDeviceEvent }
export interface AnalyticsCheck { readonly id: string; readonly ok: boolean; readonly detail: string }

/** Synthetic marker the capture inserts at the force-stop + relaunch (a new launch has a new session id); never emitted by the app. */
const RELAUNCH_MARKER_EVT = 'capture_marker';
const PRICE_TEXT = /[$€£¥]\s?\d|\d\s?(usd|eur|gbp)\b|price|currency|localized/i;

interface Tracked { readonly eventId: string; readonly params: Record<string, unknown> }

function trackedOf(events: readonly AnalyticsTimelineEvent[]): Tracked[] {
    const out: Tracked[] = [];
    for (const e of events) {
        if (e.event.evt !== 'analytics' || e.event.phase !== 'tracked') continue;
        const eventId = typeof e.event.eventId === 'string' ? e.event.eventId : '';
        const params = e.event.params && typeof e.event.params === 'object' ? e.event.params as Record<string, unknown> : {};
        if (eventId.length > 0) out.push({ eventId, params });
    }
    return out;
}

export function evaluateAnalytics(events: readonly AnalyticsTimelineEvent[], expect: AnalyticsExpectation): AnalyticsCheck[] {
    const checks: AnalyticsCheck[] = [];
    const markerIndex = events.findIndex((e) => e.event.evt === RELAUNCH_MARKER_EVT);
    const firstLaunch = markerIndex < 0 ? events : events.slice(0, markerIndex);
    const tracked = trackedOf(firstLaunch);
    const byId = (id: string, filter: (t: Tracked) => boolean = () => true) => tracked.filter((t) => t.eventId === id && filter(t));

    const problems = events.filter((e) => e.event.evt === 'analytics' && e.event.phase !== 'tracked');
    checks.push({ id: 'analytics_no_invalid_or_failure', ok: problems.length === 0, detail: problems.length === 0 ? `${tracked.length} tracked event(s)` : problems.map((e) => `${String(e.event.phase)}:${String(e.event.eventId ?? e.event.reason ?? '')}`).join(',') });
    checks.push({ id: 'analytics_events_tracked', ok: tracked.length > 0, detail: `${tracked.length} tracked event(s): ${tracked.map((t) => t.eventId).join(',')}` });
    const invalid = tracked.filter((t) => !validateAnalyticsEvent(t.eventId, t.params as Record<string, unknown>).ok);
    checks.push({ id: 'analytics_tracked_params_valid', ok: invalid.length === 0, detail: invalid.length === 0 ? 'every tracked event matches the catalogue schema' : invalid.map((t) => t.eventId).join(',') });
    checks.push({ id: 'analytics_no_price_text', ok: !PRICE_TEXT.test(JSON.stringify(tracked)), detail: 'no price / currency text in tracked params' });
    const sessions = new Set(tracked.map((t) => t.params.session_id));
    checks.push({ id: 'analytics_single_opaque_session_id', ok: sessions.size === 1 && typeof [...sessions][0] === 'string' && !/\d{10,}/.test(String([...sessions][0])), detail: `${sessions.size} session id(s): ${[...sessions].map(String).join(',')}` });

    if (expect === 'founder_purchase') {
        const shown = byId('purchase_offer_shown');
        const starts = byId('purchase_start');
        const complete = byId('purchase_complete');
        checks.push({ id: 'analytics_founder_impression_once', ok: shown.length === 1 && typeof shown[0].params.since_unlock_bucket === 'string' && typeof shown[0].params.before_first_reboot === 'boolean', detail: `${shown.length} purchase_offer_shown: ${JSON.stringify(shown[0]?.params ?? null)}` });
        checks.push({ id: 'analytics_founder_start', ok: starts.length >= 1, detail: `${starts.length} purchase_start` });
        checks.push({ id: 'analytics_founder_single_complete', ok: complete.length === 1 && typeof complete[0].params.since_unlock_bucket === 'string' && typeof complete[0].params.before_first_reboot === 'boolean', detail: `${complete.length} purchase_complete (a duplicate callback must not add one): ${JSON.stringify(complete[0]?.params ?? null)}` });
        return checks;
    }

    const placement = expect;
    const opportunities = byId('rewarded_opportunity', (t) => t.params.placement === placement);
    const opportunityId = opportunities[0]?.params.opportunity_id;
    const starts = byId('rewarded_start', (t) => t.params.placement === placement);
    const completes = byId('rewarded_complete', (t) => t.params.placement === placement);
    checks.push({ id: 'analytics_one_opportunity_per_episode', ok: opportunities.length === 1 && typeof opportunityId === 'string', detail: `${opportunities.length} rewarded_opportunity: ${JSON.stringify(opportunities[0]?.params ?? null)}` });
    checks.push({ id: 'analytics_opt_in_linked_to_opportunity', ok: starts.length >= 1 && starts.every((t) => t.params.opportunity_id === opportunityId && typeof t.params.request_id === 'string'), detail: `${starts.length} rewarded_start` });
    checks.push({ id: 'analytics_completion_linked', ok: completes.length === 1 && completes[0].params.opportunity_id === opportunityId, detail: `${completes.length} rewarded_complete` });

    if (placement === 'offline_double') {
        const granted = byId('offline_bonus_granted');
        const collected = byId('offline_collected', (t) => t.params.doubled === true);
        const g = granted[0]?.params;
        checks.push({ id: 'analytics_offline_opportunity_context', ok: typeof opportunities[0]?.params.absence_bucket === 'string' && typeof opportunities[0]?.params.base_reward_mag === 'number' && opportunities[0].params.multiplier === 2, detail: JSON.stringify(opportunities[0]?.params ?? null) });
        checks.push({ id: 'analytics_offline_bonus_granted', ok: granted.length === 1 && g?.multiplier === 2 && g.opportunity_id === opportunityId && typeof g.base_reward_mag === 'number' && typeof g.bonus_reward_mag === 'number' && Number(g.claims_in_window) >= 1, detail: JSON.stringify(g ?? null) });
        checks.push({ id: 'analytics_offline_collected_doubled', ok: collected.length === 1, detail: `${collected.length} offline_collected(doubled)` });
        return checks;
    }

    const activated = byId('extended_overclock_activated');
    const a = activated[0]?.params;
    checks.push({ id: 'analytics_overclock_activated_context', ok: activated.length === 1 && a?.opportunity_id === opportunityId && a.multiplier === 2 && typeof a.run_age_bucket === 'string' && typeof a.era_id === 'string' && typeof a.civilization === 'number' && Number(a.claims_in_window) >= 1, detail: JSON.stringify(a ?? null) });
    return checks;
}
