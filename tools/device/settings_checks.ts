/**
 * AUT-052 objective checks of the Settings device capture (pure, unit-tested; used by `reveal_capture.ts`).
 * The capture records `settings` DEBUG events plus `ui_layout`; a synthetic `capture_marker` (phase `relaunch`) separates the first launch
 * from the force-stop + relaunch WITHOUT reseeding (the settings file must survive it).
 */
import type { ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';
import { toRect, type Rect } from './ui_geometry.ts';

export type SettingsExpectation = 'toggle_persist';

export interface SettingsTimelineEvent { readonly tMs: number; readonly event: ParsedDeviceEvent }
export interface SettingsCheck { readonly id: string; readonly ok: boolean; readonly detail: string }

/** Synthetic timeline marker the capture inserts where it force-stops and relaunches (never emitted by the app). */
export const SETTINGS_RELAUNCH_MARKER_EVT = 'capture_marker';

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function evaluateSettings(events: readonly SettingsTimelineEvent[], expect: SettingsExpectation): SettingsCheck[] {
    void expect;
    const markerIndex = events.findIndex((e) => e.event.evt === SETTINGS_RELAUNCH_MARKER_EVT);
    const before = markerIndex < 0 ? events : events.slice(0, markerIndex);
    const after = markerIndex < 0 ? [] : events.slice(markerIndex + 1);
    const phaseOf = (list: readonly SettingsTimelineEvent[], phase: string) => list.filter((e) => e.event.evt === 'settings' && e.event.phase === phase);
    const valuesOf = (e: SettingsTimelineEvent | undefined) => (e?.event.settings ?? {}) as Record<string, unknown>;
    const checks: SettingsCheck[] = [];

    const loaded = phaseOf(before, 'loaded')[0];
    const values = valuesOf(loaded);
    checks.push({
        id: 'settings_first_launch_defaults',
        ok: loaded !== undefined && loaded.event.source === 'default' && values.musicEnabled === true && values.sfxEnabled === true && values.vibrationEnabled === true && values.language === 'en',
        detail: loaded ? `source=${String(loaded.event.source)} settings=${JSON.stringify(values)}` : 'no loaded event',
    });

    const chip = phaseOf(before, 'chip_shown')[0];
    checks.push({ id: 'settings_chip_shown', ok: chip !== undefined && toRect(chip.event.chipRect) !== null, detail: chip ? `chipRect=${JSON.stringify(chip.event.chipRect)}` : 'no chip_shown' });

    // The Settings chip (left) never overlaps the AI chip (right) in any reported layout.
    let layoutsWithBoth = 0;
    let overlapping = 0;
    for (const e of before) {
        if (e.event.evt !== 'ui_layout') continue;
        const rects = (e.event.rects ?? {}) as Record<string, unknown>;
        const settingsRect = toRect(rects.SettingsChip);
        const aiRect = toRect(rects.PermanentUpgradeChip);
        if (settingsRect && aiRect) {
            layoutsWithBoth += 1;
            if (overlaps(settingsRect, aiRect)) overlapping += 1;
        }
    }
    checks.push({ id: 'settings_chip_clear_of_ai_chip', ok: layoutsWithBoth > 0 && overlapping === 0, detail: `${layoutsWithBoth} ui_layout reports with both chips, ${overlapping} overlapping` });

    const opened = phaseOf(before, 'opened')[0];
    const rowRects = Array.isArray(opened?.event.rowRects) ? (opened?.event.rowRects as unknown[]) : [];
    checks.push({ id: 'settings_panel_opened', ok: opened !== undefined && toRect(opened.event.panelRect) !== null && (rowRects.length === 4 || rowRects.length === 5) && /* AUT-065 adds an optional Privacy options row */ rowRects.slice(0, 4).every((r) => toRect(r) !== null) && toRect(opened.event.closeRect) !== null, detail: opened ? `panelRect=${JSON.stringify(opened.event.panelRect)} rows=${rowRects.length}` : 'no opened' });

    const toggledOff = phaseOf(before, 'toggled').find((e) => e.event.setting === 'musicEnabled' && e.event.value === false);
    checks.push({ id: 'settings_music_toggled_off', ok: toggledOff !== undefined && toggledOff.event.saved === true, detail: toggledOff ? `saved=${String(toggledOff.event.saved)}` : 'no musicEnabled=false toggle' });
    checks.push({ id: 'settings_saved_after_toggle', ok: phaseOf(before, 'saved').length > 0 && phaseOf(events, 'save_failed').length === 0, detail: `${phaseOf(before, 'saved').length} saved, ${phaseOf(events, 'save_failed').length} save_failed (whole capture)` });
    checks.push({ id: 'settings_panel_closed', ok: phaseOf(before, 'closed').length > 0, detail: `${phaseOf(before, 'closed').length} closed events` });

    const reloaded = phaseOf(after, 'loaded')[0];
    const reloadedValues = valuesOf(reloaded);
    checks.push({
        id: 'settings_persisted_after_relaunch',
        ok: markerIndex >= 0 && reloaded !== undefined && reloaded.event.source === 'file' && reloadedValues.musicEnabled === false && reloadedValues.sfxEnabled === true && reloadedValues.vibrationEnabled === true,
        detail: reloaded ? `source=${String(reloaded.event.source)} settings=${JSON.stringify(reloadedValues)}` : 'no loaded event after the relaunch',
    });
    const toggledBack = phaseOf(after, 'toggled').find((e) => e.event.setting === 'musicEnabled' && e.event.value === true);
    checks.push({ id: 'settings_music_toggled_back_on', ok: toggledBack !== undefined && toggledBack.event.saved === true, detail: toggledBack ? `saved=${String(toggledBack.event.saved)}` : 'no musicEnabled=true toggle after the relaunch' });

    // No missing localization key was reported by the catalogue during the whole capture.
    const missing = events.filter((e) => e.event.evt === 'settings' && typeof e.event.missingText === 'number').map((e) => Number(e.event.missingText));
    const maxMissing = missing.length > 0 ? Math.max(...missing) : 0;
    checks.push({ id: 'settings_no_missing_text', ok: maxMissing === 0 && phaseOf(events, 'missing_text').length === 0, detail: `max missingText=${maxMissing}` });
    return checks;
}
