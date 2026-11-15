/**
 * AUT-069 objective checks of the QA toolkit device captures (pure, unit-tested; used by `reveal_capture.ts`).
 * The DEBUG APK reads `debug_command.json` once after the session is ready and records `debug_command` diagnostics
 * (`scheduled` / `submitted` / `applied`, each carrying `source: 'debug'`), plus the usual `founder_shop`, `reboot_ui`, `offline_report` and `error` events.
 *
 * - `patches`: the six-command sequence (grant IO, producer level, Robots Built, AI Cores, Founder owned, Reboot preview): every command is applied
 *   EXACTLY ONCE, in order, with `source: 'debug'` and ok; the Founder grant leaves exactly 2 Surge charges (granted once through the real path);
 *   the Reboot modal opened (and nothing was committed: no `command_result` rebootCivilization); zero errors.
 * - `offline`: `createPendingOffline` applied once (source debug, ok) and the Offline Factory Report card was shown; zero errors.
 *
 * These checks prove wiring and causality only; what the screen looks like stays with visual QA.
 */
import type { ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';

export type QaToolkitExpectation = 'patches' | 'offline';

export interface QaToolkitTimelineEvent { readonly tMs: number; readonly event: ParsedDeviceEvent }
export interface QaToolkitCheck { readonly id: string; readonly ok: boolean; readonly detail: string }

export const QA_TOOLKIT_EXPECTED_TYPES: Readonly<Record<QaToolkitExpectation, readonly string[]>> = Object.freeze({
    patches: Object.freeze(['grantIndustrialOutput', 'setProducerLevel', 'setRobotsBuilt', 'grantAiCores', 'mockFounderOwned', 'previewReboot']),
    offline: Object.freeze(['createPendingOffline']),
});

export function evaluateQaToolkit(events: readonly QaToolkitTimelineEvent[], expect: QaToolkitExpectation): QaToolkitCheck[] {
    const debug = (phase: string) => events.filter((e) => e.event.evt === 'debug_command' && e.event.phase === phase);
    const applied = debug('applied');
    const expected = QA_TOOLKIT_EXPECTED_TYPES[expect];
    const checks: QaToolkitCheck[] = [];
    const errors = events.filter((e) => e.event.evt === 'error');
    checks.push({ id: 'qa_no_errors', ok: errors.length === 0, detail: `${errors.length} error events` });
    checks.push({ id: 'qa_command_file_accepted', ok: debug('ignored').length === 0 && debug('rejected').length === 0 && debug('scheduled').length === expected.length, detail: `${debug('scheduled').length} scheduled, ${debug('ignored').length} ignored, ${debug('rejected').length} rejected` });
    checks.push({ id: 'qa_each_applied_exactly_once_in_order', ok: applied.length === expected.length && expected.every((type, index) => applied[index]?.event.type === type && applied[index]?.event.index === index), detail: `applied: ${applied.map((e) => String(e.event.type)).join(', ') || 'none'}` });
    checks.push({ id: 'qa_all_ok', ok: applied.length > 0 && applied.every((e) => e.event.ok === true), detail: applied.map((e) => `${String(e.event.type)}=${String(e.event.ok)}${e.event.reason ? `(${String(e.event.reason)})` : ''}`).join(', ') || 'none' });
    checks.push({ id: 'qa_source_debug', ok: applied.length > 0 && applied.every((e) => e.event.source === 'debug') && debug('scheduled').every((e) => e.event.source === 'debug'), detail: `${applied.filter((e) => e.event.source === 'debug').length}/${applied.length} applied events carry source debug` });

    if (expect === 'patches') {
        const founderStates = events.filter((e) => e.event.evt === 'founder_shop' && e.event.phase === 'state' && e.event.reason === 'debug');
        const founder = founderStates[founderStates.length - 1]?.event;
        checks.push({ id: 'qa_founder_granted_once_with_two_surges', ok: founderStates.length === 1 && founder?.owned === true && founder.cosmetic === true && founder.grantRecorded === true && founder.surgeCharges === 2, detail: founder ? JSON.stringify({ owned: founder.owned, cosmetic: founder.cosmetic, grantRecorded: founder.grantRecorded, surgeCharges: founder.surgeCharges, states: founderStates.length }) : 'no debug founder state event' });
        const opened = events.filter((e) => e.event.evt === 'reboot_ui' && e.event.phase === 'opened');
        checks.push({ id: 'qa_reboot_preview_opened', ok: opened.length === 1, detail: `${opened.length} reboot_ui opened event(s)` });
        const reboots = events.filter((e) => e.event.evt === 'command_result' && (e.event.command as { type?: unknown } | undefined)?.type === 'rebootCivilization');
        checks.push({ id: 'qa_reboot_not_committed', ok: reboots.length === 0, detail: `${reboots.length} rebootCivilization command_result(s)` });
        return checks;
    }

    const shown = events.filter((e) => e.event.evt === 'offline_report' && e.event.phase === 'shown');
    checks.push({ id: 'qa_offline_report_shown', ok: shown.length >= 1, detail: shown.length ? `shown t=${shown[0].tMs}ms status=${String(shown[0].event.status)} reward=${String(shown[0].event.reward)}` : 'no offline_report shown event' });
    return checks;
}
