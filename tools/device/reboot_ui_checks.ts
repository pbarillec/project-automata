/**
 * AUT-RBT-001 objective checks of the Reboot entry / confirmation UI device capture (pure, unit-tested; used by `reveal_capture.ts`).
 * The capture records `reboot_ui` DEBUG events plus the existing `command_result`, `reboot_presentation`, `permanent_upgrades` and `ui_layout`
 * events; a synthetic `capture_marker` (phase `relaunch`) separates the first launch from the force-stop + relaunch WITHOUT reseeding.
 * Counts and amounts are compared with what the UI itself reported at `opened` (the preview), and the Reboot sequence with the runtime's events.
 */
import type { ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';
import { toRect } from './ui_geometry.ts';

export type RebootUiExpectation = 'confirm_flow';

export interface RebootUiTimelineEvent { readonly tMs: number; readonly event: ParsedDeviceEvent }
export interface RebootUiCheck { readonly id: string; readonly ok: boolean; readonly detail: string }

/** Synthetic timeline marker the capture inserts where it force-stops and relaunches (never emitted by the app). */
export const REBOOT_UI_RELAUNCH_MARKER_EVT = 'capture_marker';

/** Design units: every button must be at least this tall at the capture scale (screen width / 720). */
export const REBOOT_UI_MIN_BUTTON_DESIGN_HEIGHT = 64;

const DESIGN_WIDTH = 720;

export function evaluateRebootUi(events: readonly RebootUiTimelineEvent[], expect: RebootUiExpectation): RebootUiCheck[] {
    void expect;
    const markerIndex = events.findIndex((e) => e.event.evt === REBOOT_UI_RELAUNCH_MARKER_EVT);
    const before = markerIndex < 0 ? events : events.slice(0, markerIndex);
    const after = markerIndex < 0 ? [] : events.slice(markerIndex + 1);
    const ui = (list: readonly RebootUiTimelineEvent[], phase: string) => list.filter((e) => e.event.evt === 'reboot_ui' && e.event.phase === phase);
    const checks: RebootUiCheck[] = [];

    // 1. The chip is shown with a positive reward and a rect.
    const chip = ui(before, 'chip_shown')[0];
    checks.push({ id: 'rbt_chip_shown', ok: chip !== undefined && Number(chip.event.aiCoresToGain) > 0 && toRect(chip.event.chipRect) !== null, detail: chip ? `aiCoresToGain=${String(chip.event.aiCoresToGain)} text=${String(chip.event.chipText)} chipRect=${JSON.stringify(chip.event.chipRect)}` : 'no chip_shown' });

    // 2. The modal opened (first open = the cancel round trip) with the lists, the reward text and large buttons.
    const openedAll = ui(before, 'opened');
    const opened = openedAll[0];
    const toGain = Number(opened?.event.aiCoresToGain ?? Number.NaN);
    const texts = (opened?.event.texts ?? {}) as Record<string, unknown>;
    const expectedReward = toGain === 1 ? '+1 AI CORE' : `+${String(toGain)} AI CORES`;
    checks.push({
        id: 'rbt_modal_opened',
        ok: opened !== undefined && toGain > 0 && texts.reward === expectedReward && opened.event.resetsCount === 5 && opened.event.keepsCount === 5 && toRect(opened.event.panelRect) !== null,
        detail: opened ? `reward="${String(texts.reward)}" civilization="${String(texts.civilization)}" progress="${String(texts.progress)}" progressPercent=${String(opened.event.progressPercent)} resets=${String(opened.event.resetsCount)} keeps=${String(opened.event.keepsCount)}` : 'no opened',
    });
    const layouts = events.filter((e) => e.event.evt === 'ui_layout');
    const layoutWith = (name: string) => layouts.filter((e) => toRect((e.event.rects as Record<string, unknown> | undefined)?.[name]) !== null).pop();
    const confirmLayout = layoutWith('RebootConfirm');
    const screen = (confirmLayout?.event.screen ?? layouts.at(-1)?.event.screen ?? {}) as { w?: unknown };
    const scale = typeof screen.w === 'number' && screen.w > 0 ? screen.w / DESIGN_WIDTH : Number.NaN;
    const confirmRect = toRect((confirmLayout?.event.rects as Record<string, unknown> | undefined)?.RebootConfirm) ?? toRect(opened?.event.confirmRect);
    const cancelRect = toRect((layoutWith('RebootCancel')?.event.rects as Record<string, unknown> | undefined)?.RebootCancel) ?? toRect(opened?.event.cancelRect);
    const minHeight = REBOOT_UI_MIN_BUTTON_DESIGN_HEIGHT * scale - 1;
    checks.push({
        id: 'rbt_buttons_at_least_64_design_units',
        ok: confirmRect !== null && cancelRect !== null && Number.isFinite(scale) && confirmRect.h >= minHeight && cancelRect.h >= minHeight,
        detail: `scale=${String(scale)} confirm.h=${String(confirmRect?.h ?? null)} cancel.h=${String(cancelRect?.h ?? null)} (min ${String(Math.round(minHeight))} px)`,
    });

    // 3. The cancel path changed nothing: cancel_tapped, closed(cancel), no Reboot command or sequence before the confirm.
    const cancelTapped = ui(before, 'cancel_tapped')[0];
    const closedCancel = ui(before, 'closed').find((e) => e.event.reason === 'cancel');
    const confirmTapped = ui(before, 'confirm_tapped')[0];
    const confirmAt = confirmTapped?.tMs ?? Number.POSITIVE_INFINITY;
    const rebootCommands = before.filter((e) => e.event.evt === 'command_result' && (e.event.command as { type?: unknown } | undefined)?.type === 'rebootCivilization');
    const earlyCommands = rebootCommands.filter((e) => e.tMs < confirmAt);
    const earlySequences = before.filter((e) => e.event.evt === 'reboot_presentation' && (e.event.phase === 'sequence_started' || e.event.phase === 'toast_started') && e.tMs < confirmAt - 250);
    checks.push({
        id: 'rbt_cancel_submits_nothing',
        ok: cancelTapped !== undefined && closedCancel !== undefined && earlyCommands.length === 0 && earlySequences.length === 0,
        detail: `cancel_tapped=${String(cancelTapped !== undefined)} closed(cancel)=${String(closedCancel !== undefined)} rebootCivilization command_results before confirm=${earlyCommands.length} sequences before confirm=${earlySequences.length}`,
    });

    // 4. The confirmed Reboot: accepted command with the three events, a saved result.
    const reopened = openedAll.at(-1);
    const gainAtConfirm = Number(reopened?.event.aiCoresToGain ?? Number.NaN);
    const resultingAiCores = Number(reopened?.event.resultingAiCores ?? Number.NaN);
    const resultingCivilization = Number(reopened?.event.resultingCivilization ?? Number.NaN);
    const commit = rebootCommands.find((e) => e.tMs >= confirmAt - 250 && e.event.ok === true);
    const commitTypes: unknown[] = Array.isArray(commit?.event.eventTypes) ? (commit?.event.eventTypes as unknown[]) : [];
    checks.push({
        id: 'rbt_confirm_command_ok',
        ok: confirmTapped !== undefined && commit !== undefined && ['aiCoresGranted', 'civilizationChanged', 'rebootCompleted'].every((type) => commitTypes.includes(type)),
        detail: commit ? `eventTypes=${JSON.stringify(commitTypes)}` : 'no accepted rebootCivilization command_result after confirm_tapped',
    });
    const result = ui(before, 'result').pop();
    checks.push({ id: 'rbt_confirm_result_saved', ok: result?.event.status === 'rebooted' && result.event.saveOk === true, detail: result ? `status=${String(result.event.status)} saveOk=${String(result.event.saveOk)} reason=${String(result.event.reason ?? null)}` : 'no result' });

    // 5. The granted amount equals what the modal announced; closed(confirmed) accompanies the sequence start.
    const sequences = before.filter((e) => e.event.evt === 'reboot_presentation' && e.event.phase === 'sequence_started');
    const started = sequences[0];
    checks.push({ id: 'rbt_granted_equals_announced', ok: started !== undefined && Number.isFinite(gainAtConfirm) && Number(started.event.aiCoresGranted) === gainAtConfirm && Number(started.event.newCivilization) === resultingCivilization, detail: started ? `announced=${String(gainAtConfirm)} granted=${String(started.event.aiCoresGranted)} civilization #${String(started.event.newCivilization)} (announced #${String(resultingCivilization)})` : 'no sequence_started' });
    const closedConfirmed = ui(before, 'closed').find((e) => e.event.reason === 'confirmed');
    checks.push({ id: 'rbt_closed_confirmed_with_sequence', ok: closedConfirmed !== undefined && started !== undefined && Math.abs(closedConfirmed.tMs - started.tMs) <= 1500, detail: closedConfirmed && started ? `closed t=${closedConfirmed.tMs}ms sequence_started t=${started.tMs}ms` : 'closed(confirmed) or sequence_started missing' });

    // 6. Exactly one AUT-049 sequence, within the 4 s cap, with the three beats.
    const finished = before.filter((e) => e.event.evt === 'reboot_presentation' && e.event.phase === 'sequence_finished')[0];
    const elapsed = finished && typeof finished.event.elapsedSeconds === 'number' ? finished.event.elapsedSeconds : null;
    const titles = before.filter((e) => e.event.evt === 'reboot_presentation' && e.event.phase === 'title_applied').map((e) => String(e.event.labelText ?? ''));
    checks.push({ id: 'rbt_single_sequence_within_cap', ok: sequences.length === 1 && finished !== undefined && elapsed !== null && elapsed <= 4.05, detail: `${sequences.length} sequence_started, finished elapsed=${String(elapsed)}s` });
    checks.push({
        id: 'rbt_sequence_beats',
        ok: titles.length === 3 && titles[0] === 'REBOOT' && titles[1] === `AI CORE ×${String(gainAtConfirm)}` && titles[2] === `CIVILIZATION #${String(resultingCivilization)}`,
        detail: JSON.stringify(titles),
    });

    // 7. After the sequence the modal and the chip are gone, and the AI chip holds the new balance.
    const lastLayout = before.filter((e) => e.event.evt === 'ui_layout').pop();
    const lastRects = (lastLayout?.event.rects ?? {}) as Record<string, unknown>;
    const lastChipEvent = before.filter((e) => e.event.evt === 'reboot_ui' && (e.event.phase === 'chip_shown' || e.event.phase === 'chip_hidden')).pop();
    checks.push({
        id: 'rbt_modal_and_chip_hidden_after',
        ok: lastLayout !== undefined && toRect(lastRects.RebootChip) === null && toRect(lastRects.RebootPanel) === null && lastChipEvent?.event.phase !== 'chip_shown',
        detail: `last ui_layout RebootChip=${JSON.stringify(lastRects.RebootChip ?? null)} RebootPanel=${JSON.stringify(lastRects.RebootPanel ?? null)}; last chip event=${String(lastChipEvent?.event.phase ?? null)}`,
    });
    const aiChip = before.filter((e) => e.event.evt === 'permanent_upgrades' && e.event.phase === 'chip_shown' && e.tMs >= confirmAt - 250).pop();
    checks.push({ id: 'rbt_ai_chip_balance_equals_reward', ok: aiChip !== undefined && Number.isFinite(resultingAiCores) && Number(aiChip.event.aiCores) === resultingAiCores, detail: aiChip ? `AI chip aiCores=${String(aiChip.event.aiCores)} (expected ${String(resultingAiCores)})` : 'no AI chip_shown after the Reboot' });

    // 8. The relaunch without reseeding keeps the result: no Reboot chip, no sequence, the AI balance persisted.
    const afterChip = ui(after, 'chip_shown')[0];
    const afterSequence = after.filter((e) => e.event.evt === 'reboot_presentation' && e.event.phase === 'sequence_started');
    const afterAiChip = after.filter((e) => e.event.evt === 'permanent_upgrades' && e.event.phase === 'chip_shown')[0];
    checks.push({
        id: 'rbt_persisted_after_relaunch',
        ok: markerIndex >= 0 && afterChip === undefined && afterSequence.length === 0 && afterAiChip !== undefined && Number(afterAiChip.event.aiCores) === resultingAiCores,
        detail: markerIndex < 0 ? 'no relaunch marker' : `Reboot chip after relaunch=${String(afterChip !== undefined)} sequences=${afterSequence.length} AI chip aiCores=${String(afterAiChip?.event.aiCores ?? null)} (expected ${String(resultingAiCores)})`,
    });
    return checks;
}
