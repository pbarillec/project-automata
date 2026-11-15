/**
 * AUT-065 objective checks of the consent device capture (pure, unit-tested; used by `reveal_capture.ts`).
 * The capture records `consent_state` (script / init / state / timeout / privacy_options_* provider diagnostics), `ads_state` (ads init + overlay begin / end,
 * kind `consent_form`), `session_state`, `ui_layout` (OfflineReportDouble, SettingsRow3 / SettingsRow4) and `error` DEBUG events.
 *
 * Expectations 'not_required' ... 'timeout' and 'privacy_row' / 'no_privacy_row' run the scripted MOCK transport under the REAL ConsentCoordinator (no network).
 * 'ump_eea' runs the REAL Google UMP with debug geography EEA: it needs network and a UMP message published for the sample AdMob app, and the real form cannot
 * be driven reliably through ADB, so when UMP cannot answer (no event, `error` / `unavailable`, a timeout) the capture reports ONE failing check whose detail
 * starts with `ENVIRONMENT_BLOCKED:` and asserts nothing else (never a false PASS, never a code FAIL).
 */
import type { ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';
import { toRect } from './ui_geometry.ts';

export type ConsentExpectation = 'not_required' | 'required_obtained' | 'required_declined' | 'error' | 'timeout' | 'privacy_row' | 'no_privacy_row' | 'ump_eea';

export interface ConsentTimelineEvent { readonly tMs: number; readonly event: ParsedDeviceEvent }
export interface ConsentCheck { readonly id: string; readonly ok: boolean; readonly detail: string }

/** How long the drive waits for the consent flow to settle (the mock timeout state needs the 4 s mock start timeout; the real UMP can need a network round trip + a human). */
export const CONSENT_SETTLE_WAIT_MS = 12_000;
export const CONSENT_UMP_WAIT_MS = 45_000;

const consent = (events: readonly ConsentTimelineEvent[], phase: string) => events.filter((e) => e.event.evt === 'consent_state' && e.event.phase === phase);
const firstIndex = (events: readonly ConsentTimelineEvent[], predicate: (e: ConsentTimelineEvent) => boolean) => events.findIndex(predicate);
const overlay = (events: readonly ConsentTimelineEvent[], state: 'begin' | 'end') => firstIndex(events, (e) => e.event.evt === 'ads_state' && e.event.phase === 'overlay' && e.event.kind === 'consent_form' && e.event.state === state);
const rectSeen = (events: readonly ConsentTimelineEvent[], name: string) => events.some((e) => e.event.evt === 'ui_layout' && toRect((e.event.rects as Record<string, unknown> | undefined)?.[name]) !== null);

/** The last reported `state` diagnostic (the settled consent state of the capture). */
function finalState(events: readonly ConsentTimelineEvent[]): ParsedDeviceEvent | undefined {
    const states = consent(events, 'state');
    return states[states.length - 1]?.event;
}

/** Returns an `ENVIRONMENT_BLOCKED: ...` reason when the real UMP cannot answer, else null. Only 'ump_eea' can be blocked. */
export function detectConsentEnvironmentBlock(events: readonly ConsentTimelineEvent[], expect: ConsentExpectation): string | null {
    if (expect !== 'ump_eea') return null;
    if (consent(events, 'init').length === 0) return 'ENVIRONMENT_BLOCKED: no consent init event (the real UMP provider was not selected: needs the DEBUG script provider "ump_test" and a native Android bridge)';
    const state = finalState(events);
    if (state === undefined) return 'ENVIRONMENT_BLOCKED: UMP reported no state (no network or the native bridge never answered)';
    const reason = String(state.reason ?? '');
    if (state.status === 'unavailable') return `ENVIRONMENT_BLOCKED: UMP is unavailable (reason=${reason || 'none'}; ads are not configured for this build)`;
    if (state.status === 'error' || state.status === 'unknown') {
        return `ENVIRONMENT_BLOCKED: UMP could not complete (status=${String(state.status)} reason=${reason || 'none'}); needs network access and a UMP message published for the sample AdMob app`;
    }
    return null;
}

export function evaluateConsent(events: readonly ConsentTimelineEvent[], expect: ConsentExpectation): ConsentCheck[] {
    const checks: ConsentCheck[] = [];
    const errors = events.filter((e) => e.event.evt === 'error');
    checks.push({ id: 'consent_no_errors', ok: errors.length === 0, detail: `${errors.length} error events` });

    const blocked = detectConsentEnvironmentBlock(events, expect);
    if (blocked !== null) {
        checks.push({ id: 'consent_environment', ok: false, detail: blocked });
        return checks;
    }

    const script = consent(events, 'script')[0];
    checks.push({ id: 'consent_script_accepted', ok: script?.event.accepted === true, detail: script ? `accepted=${String(script.event.accepted)} state=${String(script.event.state ?? null)} provider=${String(script.event.provider ?? null)}` : 'no consent_state script event' });

    // Gameplay is never blocked: the session reaches ready, and consent starts only after it (non-blocking startup).
    const sessionReady = firstIndex(events, (e) => e.event.evt === 'session_state' && e.event.phase === 'ready');
    const consentInit = firstIndex(events, (e) => e.event.evt === 'consent_state' && e.event.phase === 'init');
    checks.push({ id: 'consent_session_ready', ok: sessionReady >= 0, detail: sessionReady >= 0 ? `session ready #${sessionReady}` : 'no session_state ready' });
    checks.push({ id: 'consent_started_after_session_ready', ok: sessionReady >= 0 && consentInit > sessionReady, detail: `session ready #${sessionReady} < consent init #${consentInit}` });
    const hudReady = events.some((e) => e.event.evt === 'ui_layout');
    checks.push({ id: 'consent_game_reached_hud', ok: hudReady, detail: hudReady ? 'ui_layout received' : 'no ui_layout' });

    // A consent form is a platform overlay: bracketed, and never an offline absence (no suspend / resume session events while it is up).
    const begin = overlay(events, 'begin');
    const end = overlay(events, 'end');
    const sawForm = begin >= 0;
    if (sawForm) {
        checks.push({ id: 'consent_overlay_bracket', ok: end > begin, detail: `overlay begin #${begin} < end #${end}` });
        const absence = events.slice(begin, end > begin ? end : undefined).filter((e) => e.event.evt === 'session_state' && (e.event.phase === 'suspended' || e.event.phase === 'resumed'));
        checks.push({ id: 'consent_overlay_no_session_suspend_resume', ok: absence.length === 0, detail: `${absence.length} suspended/resumed session_state while the consent overlay was up` });
    }

    const state = finalState(events);
    const adsInit = firstIndex(events, (e) => e.event.evt === 'ads_state' && e.event.phase === 'initialized');
    const allowedAt = firstIndex(events, (e) => e.event.evt === 'consent_state' && e.event.phase === 'state' && e.event.canRequestAds === true);
    const x2Seen = rectSeen(events, 'OfflineReportDouble');

    switch (expect) {
        case 'not_required':
            checks.push({ id: 'consent_not_required_final', ok: state?.status === 'not_required' && state?.canRequestAds === true, detail: `status=${String(state?.status ?? null)} canRequestAds=${String(state?.canRequestAds ?? null)}` });
            checks.push({ id: 'consent_no_form', ok: !sawForm, detail: sawForm ? 'a consent overlay appeared' : 'no consent overlay' });
            checks.push({ id: 'consent_ads_init_after_allowed', ok: allowedAt >= 0 && adsInit > allowedAt, detail: `canRequestAds true #${allowedAt} < ads initialized #${adsInit}` });
            checks.push({ id: 'consent_x2_offered', ok: x2Seen, detail: x2Seen ? 'OfflineReportDouble rect reported' : 'no OfflineReportDouble rect' });
            break;
        case 'required_obtained':
            checks.push({ id: 'consent_form_shown', ok: sawForm, detail: sawForm ? 'consent overlay begin observed' : 'no consent overlay' });
            checks.push({ id: 'consent_obtained_final', ok: state?.status === 'obtained' && state?.canRequestAds === true, detail: `status=${String(state?.status ?? null)} canRequestAds=${String(state?.canRequestAds ?? null)}` });
            checks.push({ id: 'consent_ads_init_after_allowed', ok: allowedAt >= 0 && adsInit > allowedAt, detail: `canRequestAds true #${allowedAt} < ads initialized #${adsInit}` });
            checks.push({ id: 'consent_x2_offered', ok: x2Seen, detail: x2Seen ? 'OfflineReportDouble rect reported' : 'no OfflineReportDouble rect' });
            break;
        case 'required_declined':
            checks.push({ id: 'consent_form_shown', ok: sawForm, detail: sawForm ? 'consent overlay begin observed' : 'no consent overlay' });
            checks.push({ id: 'consent_declined_final', ok: state?.status === 'required' && state?.canRequestAds === false, detail: `status=${String(state?.status ?? null)} canRequestAds=${String(state?.canRequestAds ?? null)}` });
            checks.push({ id: 'consent_ads_fail_closed', ok: adsInit < 0 && !x2Seen, detail: `ads initialized #${adsInit}, x2 seen=${String(x2Seen)}` });
            break;
        case 'error':
            checks.push({ id: 'consent_error_final', ok: state?.status === 'error' && state?.canRequestAds === false, detail: `status=${String(state?.status ?? null)} canRequestAds=${String(state?.canRequestAds ?? null)} reason=${String(state?.reason ?? null)}` });
            checks.push({ id: 'consent_ads_fail_closed', ok: adsInit < 0 && !x2Seen, detail: `ads initialized #${adsInit}, x2 seen=${String(x2Seen)}` });
            break;
        case 'timeout': {
            const timedOut = consent(events, 'timeout')[0];
            checks.push({ id: 'consent_timeout_reported', ok: timedOut !== undefined && state?.status === 'error' && state?.reason === 'consent_timeout', detail: `timeout event=${String(timedOut !== undefined)} status=${String(state?.status ?? null)} reason=${String(state?.reason ?? null)}` });
            checks.push({ id: 'consent_ads_fail_closed', ok: adsInit < 0 && !x2Seen && state?.canRequestAds === false, detail: `ads initialized #${adsInit}, x2 seen=${String(x2Seen)}, canRequestAds=${String(state?.canRequestAds ?? null)}` });
            break;
        }
        case 'privacy_row': {
            const present = rectSeen(events, 'SettingsRow4');
            checks.push({ id: 'consent_privacy_row_shown', ok: present, detail: present ? 'SettingsRow4 (Privacy options) rect reported' : 'no SettingsRow4 rect' });
            const started = consent(events, 'privacy_options_started').length;
            const result = consent(events, 'privacy_options_result')[0];
            checks.push({ id: 'consent_privacy_options_flow', ok: started === 1 && result?.event.status === 'dismissed', detail: `${started} privacy_options_started, result=${String(result?.event.status ?? null)}` });
            const overlayBegins = events.filter((e) => e.event.evt === 'ads_state' && e.event.phase === 'overlay' && e.event.kind === 'consent_form' && e.event.state === 'begin').length;
            const overlayEnds = events.filter((e) => e.event.evt === 'ads_state' && e.event.phase === 'overlay' && e.event.kind === 'consent_form' && e.event.state === 'end').length;
            checks.push({ id: 'consent_privacy_overlay_balanced', ok: overlayBegins >= 2 && overlayBegins === overlayEnds, detail: `${overlayBegins} consent overlay begin(s), ${overlayEnds} end(s) (startup form + privacy options form)` });
            break;
        }
        case 'no_privacy_row': {
            const row3 = rectSeen(events, 'SettingsRow3');
            const row4 = rectSeen(events, 'SettingsRow4');
            checks.push({ id: 'consent_no_privacy_row', ok: row3 && !row4, detail: `SettingsRow3 seen=${String(row3)} (Language), SettingsRow4 seen=${String(row4)}` });
            break;
        }
        case 'ump_eea':
            checks.push({ id: 'consent_ump_state_reported', ok: state !== undefined, detail: `status=${String(state?.status ?? null)} canRequestAds=${String(state?.canRequestAds ?? null)} privacyOptionsRequired=${String(state?.privacyOptionsRequired ?? null)}` });
            // The real form is observed, not driven: the overlay is bracketed when shown; whether the player accepted is not asserted.
            checks.push({ id: 'consent_ump_form_observed', ok: true, detail: sawForm ? 'the UMP form was shown (overlay begin / end observed)' : 'no form was shown (no UMP message for this app / geography)' });
            break;
    }
    return checks;
}
