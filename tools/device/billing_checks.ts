/**
 * AUT-060 objective checks of the REAL Google Play Billing device capture (pure, unit-tested; used by `reveal_capture.ts`).
 * The capture records `founder_shop` (flow phases + `billing_*` provider diagnostics + persisted-state `state` events), `command_result`,
 * `ads_state` (overlay begin / end, kind `purchase_flow`), `session_state` and `error` DEBUG events.
 *
 * These scenarios need a REAL store: a device with Google Play, a license-tester account, the app installed from an internal / licensed
 * testing track (or a debug build whose package + signature match a Play Console app) and the in-app product created by the owner. Without
 * them the capture must NOT report a false PASS: every scenario first checks `billing_environment`; when the store is not ready, the product
 * has no store price, or the store query failed, it reports ONE failing check whose detail starts with `ENVIRONMENT_BLOCKED:` and nothing else
 * is asserted. The Play purchase sheet cannot be driven reliably through ADB (like AdMob), so the outcome of a purchase is observed, never forced.
 */
import type { ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';

export type BillingExpectation = 'license_tester_purchase' | 'cancel' | 'restore_owned';

export interface BillingTimelineEvent { readonly tMs: number; readonly event: ParsedDeviceEvent }
export interface BillingCheck { readonly id: string; readonly ok: boolean; readonly detail: string }

/** How long the drive waits for the Play sheet outcome (a license tester completes it by hand), and the settle time before BACK in the cancel scenario. */
export const BILLING_RESULT_WAIT_MS = 120_000;
export const BILLING_SHEET_SETTLE_MS = 8_000;
export const BILLING_CHIP_WAIT_MS = 30_000;

const shop = (events: readonly BillingTimelineEvent[], phase: string) => events.filter((e) => e.event.evt === 'founder_shop' && e.event.phase === phase);
const firstIndex = (events: readonly BillingTimelineEvent[], predicate: (e: BillingTimelineEvent) => boolean) => events.findIndex(predicate);

/** Returns an `ENVIRONMENT_BLOCKED: ...` reason when the real store cannot answer, else null. */
export function detectBillingEnvironmentBlock(events: readonly BillingTimelineEvent[], expect: BillingExpectation): string | null {
    const init = shop(events, 'store_initialized')[0];
    if (!init) return 'ENVIRONMENT_BLOCKED: no store_initialized event (the real Play Billing provider was not selected: needs the DEBUG script provider "play_billing" or a release build, and a native Android bridge)';
    if (init.event.status !== 'ready') return `ENVIRONMENT_BLOCKED: Play Billing is not ready (status=${String(init.event.status)} reason=${String(init.event.reason ?? null)}); needs a device with Google Play and a signed-in account`;
    if (expect === 'restore_owned') {
        const query = shop(events, 'store_query')[0];
        if (!query || query.event.ok !== true) return `ENVIRONMENT_BLOCKED: the Play purchase query did not succeed (${query ? `reason=${String(query.event.reason ?? null)}` : 'no store_query event'})`;
        return null;
    }
    const priced = shop(events, 'refresh').some((e) => e.event.priceShown === true && typeof e.event.price === 'string' && e.event.price.length > 0);
    if (!priced) return 'ENVIRONMENT_BLOCKED: the store returned no price for the founder product (the in-app product is not created / active in the Play Console, or this build is not installed from a Play testing track for a license-tester account)';
    return null;
}

export function evaluateBilling(events: readonly BillingTimelineEvent[], expect: BillingExpectation): BillingCheck[] {
    const checks: BillingCheck[] = [];
    const errors = events.filter((e) => e.event.evt === 'error');
    checks.push({ id: 'billing_no_errors', ok: errors.length === 0, detail: `${errors.length} error events` });
    const blocked = detectBillingEnvironmentBlock(events, expect);
    if (blocked !== null) {
        checks.push({ id: 'billing_environment', ok: false, detail: blocked });
        return checks;
    }
    checks.push({ id: 'billing_environment', ok: true, detail: 'store ready and answering' });

    const grants = events.filter((e) => e.event.evt === 'command_result' && (e.event.command as { type?: unknown } | undefined)?.type === 'grantFounderPack' && e.event.ok === true);
    const applied = shop(events, 'applied');
    const acknowledged = events.filter((e) => e.event.evt === 'founder_shop' && (e.event.phase === 'billing_acknowledged' || e.event.phase === 'acknowledged'));
    const states = shop(events, 'state');
    const lastState = states[states.length - 1]?.event;

    if (expect === 'restore_owned') {
        const deliveries = shop(events, 'billing_delivery');
        checks.push({ id: 'billing_restore_delivered_owned', ok: deliveries.some((e) => e.event.status === 'already_owned'), detail: `${deliveries.length} delivery event(s): ${deliveries.map((e) => String(e.event.status)).join(',')}` });
        checks.push({ id: 'billing_restore_reconciled_without_grant', ok: grants.length === 0 && applied.every((e) => e.event.restoreOnly === true), detail: `${grants.length} grant command(s), ${applied.length} applied event(s)` });
        checks.push({ id: 'billing_restore_owned_no_surges', ok: lastState?.owned === true && lastState?.surgeCharges === 0, detail: `owned=${String(lastState?.owned)} surgeCharges=${String(lastState?.surgeCharges)}` });
        checks.push({ id: 'billing_restore_no_acknowledge', ok: acknowledged.length === 0, detail: `${acknowledged.length} acknowledge event(s)` });
        return checks;
    }

    const started = firstIndex(events, (e) => e.event.evt === 'founder_shop' && e.event.phase === 'purchase_started');
    const nativeStarted = firstIndex(events, (e) => e.event.evt === 'founder_shop' && e.event.phase === 'billing_native_started');
    checks.push({ id: 'billing_price_from_store', ok: true, detail: `price shown from the store: ${String(shop(events, 'refresh').find((e) => e.event.priceShown === true)?.event.price)}` });
    checks.push({ id: 'billing_native_purchase_started', ok: started >= 0 && nativeStarted > started, detail: `purchase_started #${started}, billing_native_started #${nativeStarted}` });

    const overlayBegin = firstIndex(events, (e) => e.event.evt === 'ads_state' && e.event.phase === 'overlay' && e.event.kind === 'purchase_flow' && e.event.state === 'begin');
    const overlayEnd = firstIndex(events, (e) => e.event.evt === 'ads_state' && e.event.phase === 'overlay' && e.event.kind === 'purchase_flow' && e.event.state === 'end');
    if (overlayBegin >= 0) {
        checks.push({ id: 'billing_overlay_bracket', ok: overlayEnd > overlayBegin, detail: `overlay begin #${overlayBegin} < end #${overlayEnd}` });
        const absence = events.slice(overlayBegin).filter((e) => e.event.evt === 'session_state' && (e.event.phase === 'suspended' || e.event.phase === 'resumed'));
        checks.push({ id: 'billing_overlay_no_session_suspend_resume', ok: absence.length === 0, detail: `${absence.length} suspended/resumed session_state after the purchase overlay began` });
    }

    const result = shop(events, 'purchase_result')[0];
    if (expect === 'cancel') {
        checks.push({ id: 'billing_cancel_result', ok: result?.event.status === 'cancelled', detail: `purchase_result status=${String(result?.event.status ?? null)}` });
        checks.push({ id: 'billing_cancel_nothing_granted', ok: grants.length === 0 && lastState?.owned !== true && (lastState?.surgeCharges ?? 0) === 0, detail: `${grants.length} grant command(s), owned=${String(lastState?.owned)}, surgeCharges=${String(lastState?.surgeCharges)}` });
        checks.push({ id: 'billing_cancel_nothing_acknowledged', ok: acknowledged.length === 0, detail: `${acknowledged.length} acknowledge event(s)` });
        return checks;
    }

    checks.push({ id: 'billing_result_completed', ok: result?.event.status === 'completed' && typeof result.event.transactionId === 'string', detail: `purchase_result status=${String(result?.event.status ?? null)} transactionId=${String(result?.event.transactionId ?? null)}` });
    checks.push({ id: 'billing_single_grant', ok: grants.length === 1 && applied.filter((e) => e.event.status === 'applied_saved').length === 1, detail: `${grants.length} grant command(s), ${applied.filter((e) => e.event.status === 'applied_saved').length} applied_saved` });
    checks.push({ id: 'billing_owned_with_two_surges_once', ok: lastState?.owned === true && lastState?.grantRecorded === true && lastState?.surgeCharges === 2, detail: `owned=${String(lastState?.owned)} grantRecorded=${String(lastState?.grantRecorded)} surgeCharges=${String(lastState?.surgeCharges)}` });
    const durable = firstIndex(events, (e) => e.event.evt === 'founder_shop' && e.event.phase === 'applied' && (e.event.status === 'applied_saved' || e.event.status === 'already_applied'));
    const ack = firstIndex(events, (e) => e.event.evt === 'founder_shop' && (e.event.phase === 'billing_acknowledged' || e.event.phase === 'acknowledged'));
    checks.push({ id: 'billing_ack_after_grant', ok: durable >= 0 && ack > durable, detail: `durable apply #${durable} < acknowledge #${ack}` });
    return checks;
}
