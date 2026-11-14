/**
 * AUT-050 objective checks of the AI Upgrades device capture (pure, unit-tested; used by `reveal_capture.ts`).
 * The capture records `permanent_upgrades` DEBUG events; a synthetic `capture_marker` (phase `relaunch`) separates the first launch from the
 * force-stop + relaunch WITHOUT reseeding. Costs are compared with the shipped config (`rankCosts`), never with a number the UI computed.
 */
import { loadGameConfigFromSources } from '../../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../../assets/scripts/config/EmbeddedEconomyConfig.ts';
import type { ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';
import { toRect } from './ui_geometry.ts';

export type PermanentUpgradeExpectation = 'purchase';

export interface PermanentUpgradeTimelineEvent { readonly tMs: number; readonly event: ParsedDeviceEvent }
export interface PermanentUpgradeCheck { readonly id: string; readonly ok: boolean; readonly detail: string }

/** Synthetic timeline marker the capture inserts where it force-stops and relaunches (never emitted by the app). */
export const PERMANENT_UPGRADE_RELAUNCH_MARKER_EVT = 'capture_marker';

export interface PermanentUpgradeRowReport { readonly id: string; readonly state: string; readonly cost: number | null; readonly rank: number }

/** The affordable row with the lowest cost of an `opened` / `tab` event (the capture buys it with a real tap); null when none. */
export function pickAffordableRow(rows: unknown): { index: number; row: PermanentUpgradeRowReport } | null {
    if (!Array.isArray(rows)) return null;
    let best: { index: number; row: PermanentUpgradeRowReport } | null = null;
    rows.forEach((value, index) => {
        const row = value as Partial<PermanentUpgradeRowReport> | null;
        if (!row || row.state !== 'affordable' || typeof row.id !== 'string' || typeof row.cost !== 'number') return;
        if (best === null || row.cost < (best.row.cost ?? Number.POSITIVE_INFINITY)) best = { index, row: row as PermanentUpgradeRowReport };
    });
    return best;
}

export function configRankCost(upgradeId: string, previousRank: number): number | null {
    const upgrade = loadGameConfigFromSources(getEmbeddedEconomyConfigSources()).getPermanentUpgrade(upgradeId);
    const cost = upgrade?.rankCosts[previousRank];
    return typeof cost === 'number' ? cost : null;
}

export function evaluatePermanentUpgrades(events: readonly PermanentUpgradeTimelineEvent[], expect: PermanentUpgradeExpectation): PermanentUpgradeCheck[] {
    const markerIndex = events.findIndex((e) => e.event.evt === PERMANENT_UPGRADE_RELAUNCH_MARKER_EVT);
    const before = markerIndex < 0 ? events : events.slice(0, markerIndex);
    const after = markerIndex < 0 ? [] : events.slice(markerIndex + 1);
    const phaseOf = (list: readonly PermanentUpgradeTimelineEvent[], phase: string) => list.filter((e) => e.event.evt === 'permanent_upgrades' && e.event.phase === phase);
    const checks: PermanentUpgradeCheck[] = [];
    void expect;

    const chip = phaseOf(before, 'chip_shown')[0];
    checks.push({ id: 'upgrades_chip_shown_on_launch', ok: chip !== undefined && toRect(chip.event.chipRect) !== null, detail: chip ? `aiCores=${String(chip.event.aiCores)} chipRect=${JSON.stringify(chip.event.chipRect)}` : 'no chip_shown' });
    const opened = phaseOf(before, 'opened')[0];
    const rows = Array.isArray(opened?.event.rows) ? (opened?.event.rows as PermanentUpgradeRowReport[]) : [];
    checks.push({ id: 'upgrades_panel_opened', ok: opened !== undefined && toRect(opened.event.panelRect) !== null && rows.length > 0, detail: opened ? `tab=${String(opened.event.tab)} rows=${JSON.stringify(rows.map((r) => `${r.id}:${r.state}`))}` : 'no opened' });
    checks.push({ id: 'upgrades_open_has_affordable_row', ok: pickAffordableRow(opened?.event.rows) !== null, detail: 'an affordable row is on the first tab' });

    const tapped = phaseOf(before, 'row_tapped')[0];
    const result = phaseOf(before, 'purchase_result')[0];
    checks.push({ id: 'upgrades_buy_tapped', ok: tapped !== undefined && tapped.event.rowState === 'affordable', detail: tapped ? `upgradeId=${String(tapped.event.upgradeId)} cost=${String(tapped.event.cost)} rank=${String(tapped.event.rank)}` : 'no row_tapped' });
    const upgradeId = String(result?.event.upgradeId ?? tapped?.event.upgradeId ?? '');
    const previousRank = Number(tapped?.event.rank ?? Number.NaN);
    const cost = Number(result?.event.cost ?? Number.NaN);
    const configCost = Number.isFinite(previousRank) ? configRankCost(upgradeId, previousRank) : null;
    checks.push({ id: 'upgrades_purchase_cost_equals_config', ok: result !== undefined && configCost !== null && cost === configCost, detail: `upgrade=${upgradeId} event cost=${String(cost)} config cost=${String(configCost)}` });
    const balanceBefore = Number(tapped?.event.aiCores ?? Number.NaN);
    const balanceAfter = Number(result?.event.aiCores ?? Number.NaN);
    const delta = Number(result?.event.balanceDelta ?? Number.NaN);
    checks.push({ id: 'upgrades_balance_delta_equals_minus_cost', ok: result !== undefined && delta === -cost && balanceAfter - balanceBefore === -cost, detail: `balanceChanged delta=${String(delta)} balance ${String(balanceBefore)} -> ${String(balanceAfter)} cost=${String(cost)}` });
    const eventTypes = Array.isArray(result?.event.eventTypes) ? (result?.event.eventTypes as unknown[]) : [];
    checks.push({ id: 'upgrades_event_order', ok: eventTypes.indexOf('aiCoreBalanceChanged') >= 0 && eventTypes.indexOf('aiCoreBalanceChanged') < eventTypes.indexOf('permanentUpgradePurchased'), detail: JSON.stringify(eventTypes) });
    checks.push({ id: 'upgrades_purchase_saved', ok: result?.event.status === 'purchased' && result.event.saveOk === true, detail: result ? `status=${String(result.event.status)} saveOk=${String(result.event.saveOk)} reason=${String(result.event.reason ?? null)}` : 'no purchase_result' });
    const newRank = Number(result?.event.rank ?? Number.NaN);
    checks.push({ id: 'upgrades_rank_advanced_by_one', ok: Number.isFinite(newRank) && newRank === previousRank + 1, detail: `rank ${String(previousRank)} -> ${String(newRank)}` });

    const tab = phaseOf(before, 'tab').pop();
    const tabRows = Array.isArray(tab?.event.rows) ? (tab?.event.rows as PermanentUpgradeRowReport[]) : [];
    checks.push({ id: 'upgrades_tab_switched_with_locked_row', ok: tab !== undefined && tab.event.tab === 'automation' && tabRows.some((row) => row.state === 'locked'), detail: tab ? `tab=${String(tab.event.tab)} rows=${JSON.stringify(tabRows.map((r) => `${r.id}:${r.state}`))}` : 'no tab event' });

    const second = phaseOf(after, 'chip_shown')[0];
    const ranks = (second?.event.ranks ?? {}) as Record<string, unknown>;
    checks.push({
        id: 'upgrades_persisted_after_relaunch',
        ok: markerIndex >= 0 && second !== undefined && Number(second.event.aiCores) === balanceAfter && Number(ranks[upgradeId]) === newRank,
        detail: second ? `after relaunch aiCores=${String(second.event.aiCores)} (expected ${String(balanceAfter)}) rank[${upgradeId}]=${String(ranks[upgradeId])} (expected ${String(newRank)})` : 'no chip_shown after the relaunch',
    });
    return checks;
}
