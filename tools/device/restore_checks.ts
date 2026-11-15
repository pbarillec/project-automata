/**
 * AUT-061 objective checks of the purchase restore / reconciliation device captures (pure, unit-tested; used by `reveal_capture.ts`).
 * Both scenarios use the DEBUG MOCK store (`debug_purchase.json` with a scripted `restore` mode): no real store, no Play sheet, no taps. The capture records
 * `founder_shop` (flow phases, `store_query*`, `reconciliation`, `chip_shown`, persisted-state `state` events), `command_result` and `error` DEBUG events.
 *
 * - `reinstall`: a FRESH save (nothing owned, offer locked, as after a reinstall / clear data) and a store that reports the pack as owned: the entitlement and
 *   the cosmetic come back, the Surge grant flag is recorded with ZERO charges, nothing is granted or acknowledged, the chip reads Owned.
 * - `local_owned_store_error`: the pack is owned locally (2 charges) and the store query FAILS: ownership and charges are untouched (no revoke), the chip reads Owned.
 *
 * These checks prove wiring and causality only; real-store behaviour (Play query, refunds, pending) is not exercised here.
 */
import type { ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';

export type RestoreExpectation = 'reinstall' | 'local_owned_store_error';

export interface RestoreTimelineEvent { readonly tMs: number; readonly event: ParsedDeviceEvent }
export interface RestoreCheck { readonly id: string; readonly ok: boolean; readonly detail: string }

export function evaluateRestore(events: readonly RestoreTimelineEvent[], expect: RestoreExpectation): RestoreCheck[] {
    const shop = (phase: string) => events.filter((e) => e.event.evt === 'founder_shop' && e.event.phase === phase);
    const commands = (type: string) => events.filter((e) => e.event.evt === 'command_result' && (e.event.command as { type?: unknown } | undefined)?.type === type && e.event.ok === true);
    const states = shop('state');
    const first = states[0]?.event;
    const last = states[states.length - 1]?.event;
    const checks: RestoreCheck[] = [];
    const errors = events.filter((e) => e.event.evt === 'error');
    checks.push({ id: 'restore_no_errors', ok: errors.length === 0, detail: `${errors.length} error events` });

    const query = shop('store_query').find((e) => e.event.trigger === 'startup') ?? shop('store_query')[0];
    const chip = shop('chip_shown')[0];
    const reconciliations = shop('reconciliation');
    const grants = commands('grantFounderPack');
    const reconciles = commands('reconcileFounderEntitlement');
    const acknowledged = events.filter((e) => e.event.evt === 'founder_shop' && (e.event.phase === 'acknowledged' || e.event.phase === 'billing_acknowledged'));

    checks.push({ id: 'restore_no_purchase_flow', ok: shop('purchase_started').length === 0 && grants.length === 0, detail: `${shop('purchase_started').length} purchase_started, ${grants.length} grantFounderPack command(s)` });
    checks.push({ id: 'restore_chip_owned', ok: chip?.event.state === 'owned', detail: chip ? `chip state=${String(chip.event.state)} label="${String(chip.event.chipLabel)}"` : 'no chip_shown' });
    checks.push({ id: 'restore_no_acknowledge', ok: acknowledged.length === 0, detail: `${acknowledged.length} acknowledge event(s)` });

    if (expect === 'reinstall') {
        checks.push({ id: 'restore_start_state_empty', ok: first?.owned === false && first.cosmetic === false && first.grantRecorded === false && first.surgeCharges === 0, detail: first ? JSON.stringify({ owned: first.owned, cosmetic: first.cosmetic, grantRecorded: first.grantRecorded, surgeCharges: first.surgeCharges }) : 'no state event' });
        checks.push({ id: 'restore_store_query_ok', ok: query?.event.ok === true, detail: query ? `trigger=${String(query.event.trigger)} ok=${String(query.event.ok)} status=${String(query.event.status)}` : 'no store_query event' });
        checks.push({ id: 'restore_reconciled_from_store', ok: reconciliations.some((e) => e.event.reason === 'restored_from_store' && e.event.surgeGrant === 'record_flag_only'), detail: `${reconciliations.length} reconciliation event(s): ${reconciliations.map((e) => String(e.event.reason)).join(',')}` });
        checks.push({ id: 'restore_single_reconcile_command', ok: reconciles.length === 1, detail: `${reconciles.length} accepted reconcileFounderEntitlement command(s)` });
        checks.push({ id: 'restore_entitlement_restored_zero_surges', ok: last?.owned === true && last.cosmetic === true && last.grantRecorded === true && last.surgeCharges === 0, detail: last ? JSON.stringify({ owned: last.owned, cosmetic: last.cosmetic, grantRecorded: last.grantRecorded, surgeCharges: last.surgeCharges }) : 'no state event' });
        checks.push({ id: 'restore_never_grants_surges_at_any_point', ok: states.length > 0 && states.every((e) => e.event.surgeCharges === 0), detail: `${states.length} state event(s)` });
        return checks;
    }

    const policy = shop('store_query_policy')[0];
    checks.push({ id: 'restore_store_query_failed', ok: query?.event.ok === false, detail: query ? `trigger=${String(query.event.trigger)} ok=${String(query.event.ok)} status=${String(query.event.status)} reason=${String(query.event.reason)}` : 'no store_query event' });
    checks.push({ id: 'restore_policy_keeps_local', ok: policy?.event.reason === 'store_no_answer_keep_local' && policy.event.revokes === false && policy.event.localOwned === true && Array.isArray(policy.event.actions) && policy.event.actions.length === 0, detail: policy ? JSON.stringify({ reason: policy.event.reason, revokes: policy.event.revokes, localOwned: policy.event.localOwned, actions: policy.event.actions }) : 'no store_query_policy event' });
    checks.push({ id: 'restore_no_reconcile_command', ok: reconciles.length === 0, detail: `${reconciles.length} reconcileFounderEntitlement command(s)` });
    checks.push({ id: 'restore_local_start_owned_with_two_surges', ok: first?.owned === true && first.surgeCharges === 2, detail: first ? JSON.stringify({ owned: first.owned, surgeCharges: first.surgeCharges }) : 'no state event' });
    checks.push({ id: 'restore_still_owned_after_failed_query', ok: states.length > 0 && states.every((e) => e.event.owned === true && e.event.cosmetic === true && e.event.surgeCharges === 2), detail: `${states.length} state event(s), last=${last ? JSON.stringify({ owned: last.owned, surgeCharges: last.surgeCharges }) : 'none'}` });
    return checks;
}
