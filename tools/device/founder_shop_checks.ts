/**
 * AUT-059 objective checks of the Founder's Pack shop device capture (pure, unit-tested; used by `reveal_capture.ts`). The capture records
 * `founder_shop` / `command_result` / `ui_layout` / `error` DEBUG events; a synthetic `capture_marker` (phase `relaunch`) separates the first
 * launch from the force-stop + relaunch WITHOUT reseeding. These checks prove wiring, geometry and causality only; whether the chip and the
 * modal read well (and that no error colour is used) stays with the visual QA review of the screenshots.
 *
 * Capture-check lessons (AUT-055 / AUT-056): causality is compared by EVENT ORDER (tMs mixes frame-collection time with event time); the
 * ui_layout rect is read from the layout that reports it; every strings check compares with the CATALOGUE (never a literal) and the price check
 * with the mock store metadata the seed wrote (the UI must show it verbatim).
 */
import { getDefaultTextCatalogue } from '../../assets/scripts/localization/index.ts';
import type { ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';
import { UI_DESIGN_RESOLUTION } from '../../assets/scripts/presentation/UiLayout.ts';
import { FOUNDER_SURGE_DURATION_SECONDS, FOUNDER_SURGE_MULTIPLIER, FOUNDER_SURGE_QUANTITY } from '../../assets/scripts/state/FounderOfferKeys.ts';
import { rectInside, rectsOverlapBeyond, toRect, type Rect } from './ui_geometry.ts';

export type FounderShopExpectation = 'available' | 'purchase_success' | 'pending' | 'cancel' | 'fail' | 'owned' | 'hidden';

export interface FounderShopTimelineEvent { readonly tMs: number; readonly event: ParsedDeviceEvent }
export interface FounderShopCheck { readonly id: string; readonly ok: boolean; readonly detail: string }

/** Synthetic timeline marker the capture inserts where it force-stops and relaunches (never emitted by the app). */
export const FOUNDER_SHOP_RELAUNCH_MARKER_EVT = 'capture_marker';
/** The mock STORE metadata price the seed writes (test data; the UI must show it verbatim and never owns a price). */
export const FOUNDER_CAPTURE_PRICE_TEXT = 'TEST PRICE 9.99';
export const FOUNDER_SHOP_MIN_HEIGHT_UNITS = 64;
export const FOUNDER_SHOP_MIN_LABEL_FONT_UNITS = 21;
export const FOUNDER_SHOP_RECT_TOLERANCE_PX = 1.5;

/** Rect names the chip must not overlap when they are reported in the same layout. */
const NEIGHBOUR_RECTS = ['CoreHUD', 'ProducerPanel', 'SettingsChip', 'PermanentUpgradeChip', 'RebootChip', 'ExtendedOverclockAction'] as const;

interface LayoutSnapshot { readonly screen: { w: number; h: number }; readonly safeArea: Rect | null; readonly rects: Record<string, unknown> }

const rectOf = (event: ParsedDeviceEvent, name: string): Rect | null => toRect((event.rects as Record<string, unknown> | undefined)?.[name]);

function layoutAt(event: ParsedDeviceEvent): LayoutSnapshot | null {
    const screen = event.screen as { w?: unknown; h?: unknown } | undefined;
    if (!screen || typeof screen.w !== 'number' || typeof screen.h !== 'number') return null;
    return { screen: { w: screen.w, h: screen.h }, safeArea: toRect(event.safeArea), rects: (event.rects ?? {}) as Record<string, unknown> };
}

/** The strings the UI must show, from the catalogue (never literals here). */
export function expectedFounderTexts(): { contents: readonly string[]; pending: string; owned: string; cancelled: string; failed: string } {
    const catalogue = getDefaultTextCatalogue();
    return {
        contents: [
            catalogue.resolveText('founder.content.robot'),
            catalogue.resolveText('founder.content.surges', { count: FOUNDER_SURGE_QUANTITY, multiplier: FOUNDER_SURGE_MULTIPLIER, minutes: FOUNDER_SURGE_DURATION_SECONDS / 60 }),
        ],
        pending: catalogue.resolveText('founder.status.pending'),
        owned: catalogue.resolveText('founder.status.owned'),
        cancelled: catalogue.resolveText('founder.note.cancelled'),
        failed: catalogue.resolveText('founder.note.failed'),
    };
}

export function evaluateFounderShop(events: readonly FounderShopTimelineEvent[], expect: FounderShopExpectation): FounderShopCheck[] {
    const markerIndex = events.findIndex((e) => e.event.evt === FOUNDER_SHOP_RELAUNCH_MARKER_EVT);
    const before = markerIndex < 0 ? events : events.slice(0, markerIndex);
    const after = markerIndex < 0 ? [] : events.slice(markerIndex + 1);
    const shop = (list: readonly FounderShopTimelineEvent[], phase: string) => list.filter((e) => e.event.evt === 'founder_shop' && e.event.phase === phase);
    const grantCommands = (list: readonly FounderShopTimelineEvent[]) => list.filter((e) => e.event.evt === 'command_result' && (e.event.command as { type?: unknown } | undefined)?.type === 'grantFounderPack' && e.event.ok === true);
    const stateEvents = (list: readonly FounderShopTimelineEvent[]) => shop(list, 'state');
    const texts = expectedFounderTexts();
    const checks: FounderShopCheck[] = [];
    const errors = events.filter((e) => e.event.evt === 'error');
    checks.push({ id: 'founder_no_errors', ok: errors.length === 0, detail: `${errors.length} error events` });

    if (expect === 'hidden') {
        const withChip = events.filter((e) => e.event.evt === 'ui_layout' && rectOf(e.event, 'FounderChip') !== null);
        checks.push({ id: 'founder_hidden_no_chip_rect', ok: withChip.length === 0, detail: `${withChip.length} ui_layout event(s) with FounderChip` });
        checks.push({ id: 'founder_hidden_no_chip_shown', ok: shop(events, 'chip_shown').length === 0, detail: `${shop(events, 'chip_shown').length} chip_shown` });
        checks.push({ id: 'founder_hidden_no_purchase', ok: shop(events, 'purchase_started').length === 0 && grantCommands(events).length === 0, detail: `${shop(events, 'purchase_started').length} purchase_started, ${grantCommands(events).length} grant commands` });
        const states = stateEvents(events);
        checks.push({ id: 'founder_hidden_nothing_owned', ok: states.length > 0 && states.every((e) => e.event.owned === false && e.event.surgeCharges === 0), detail: `${states.length} state event(s)` });
        return checks;
    }

    // ---- the chip ----
    const firstLayoutIndex = before.findIndex((e) => e.event.evt === 'ui_layout' && rectOf(e.event, 'FounderChip') !== null);
    const wantedChipState = expect === 'owned' ? 'owned' : 'available';
    const shown = shop(before, 'chip_shown')[0];
    checks.push({
        id: 'founder_chip_shown',
        ok: shown !== undefined && shown.event.state === wantedChipState && toRect(shown.event.chipRect) !== null,
        detail: shown ? `state=${String(shown.event.state)} label="${String(shown.event.chipLabel)}" tag="${String(shown.event.chipTag)}"` : 'no chip_shown',
    });
    checks.push(...chipGeometryChecks(firstLayoutIndex < 0 ? null : layoutAt(before[firstLayoutIndex].event)));
    const labelFont = Number(shown?.event.chipLabelFontSize ?? Number.NaN);
    const tagFont = Number(shown?.event.chipTagFontSize ?? Number.NaN);
    checks.push({
        id: 'founder_chip_fonts_fit',
        ok: shown !== undefined && Number.isFinite(labelFont) && labelFont >= FOUNDER_SHOP_MIN_LABEL_FONT_UNITS - 0.011 && Number.isFinite(tagFont) && tagFont >= 20 - 0.011,
        detail: shown ? `label font ${String(shown.event.chipLabelFontSize)} (min ${FOUNDER_SHOP_MIN_LABEL_FONT_UNITS}), tag font ${String(shown.event.chipTagFontSize)} (min 20)` : 'no chip_shown',
    });

    // ---- the modal (first open) ----
    const opened = shop(before, 'opened')[0];
    checks.push({
        id: 'founder_modal_opened',
        ok: opened !== undefined && opened.event.state === wantedChipState && toRect(opened.event.panelRect) !== null && toRect(opened.event.closeRect) !== null,
        detail: opened ? `state=${String(opened.event.state)} priceText="${String(opened.event.priceText)}" buyVisible=${String(opened.event.buyVisible)} buyEnabled=${String(opened.event.buyEnabled)}` : 'no opened',
    });
    const contents = Array.isArray(opened?.event.contents) ? (opened?.event.contents as unknown[]).map(String) : [];
    checks.push({ id: 'founder_contents_localized_only_robot_and_surges', ok: contents.length === 2 && contents[0] === texts.contents[0] && contents[1] === texts.contents[1], detail: JSON.stringify(contents) });
    const modalLayout = before.find((e) => e.event.evt === 'ui_layout' && rectOf(e.event, 'FounderPanel') !== null && (expect === 'owned' || rectOf(e.event, 'FounderBuy') !== null));
    checks.push(...modalGeometryChecks(modalLayout ? layoutAt(modalLayout.event) : null, expect !== 'owned'));

    if (expect === 'owned') {
        const states = stateEvents(events);
        const ready = stateEvents(before)[0];
        checks.push({ id: 'founder_owned_state', ok: ready?.event.owned === true && ready.event.cosmetic === true && ready.event.grantRecorded === true && ready.event.surgeCharges === 2, detail: ready ? JSON.stringify({ owned: ready.event.owned, cosmetic: ready.event.cosmetic, grantRecorded: ready.event.grantRecorded, surgeCharges: ready.event.surgeCharges }) : 'no state event' });
        checks.push({ id: 'founder_owned_modal_no_buy', ok: opened !== undefined && opened.event.buyVisible === false && toRect(opened.event.buyRect) === null && opened.event.status === texts.owned, detail: opened ? `buyVisible=${String(opened.event.buyVisible)} buyRect=${JSON.stringify(opened.event.buyRect ?? null)} status="${String(opened.event.status)}"` : 'no opened' });
        checks.push({ id: 'founder_owned_no_purchase_no_grant', ok: shop(events, 'purchase_started').length === 0 && grantCommands(events).length === 0 && states.every((e) => e.event.surgeCharges === 2), detail: `${shop(events, 'purchase_started').length} purchase_started, ${grantCommands(events).length} grant commands` });
        return checks;
    }

    // ---- price: the store metadata verbatim, never invented ----
    checks.push({
        id: 'founder_price_is_store_metadata',
        ok: opened !== undefined && opened.event.priceFromStore === true && opened.event.priceText === FOUNDER_CAPTURE_PRICE_TEXT && String(opened.event.buyLabel ?? '').includes(FOUNDER_CAPTURE_PRICE_TEXT),
        detail: opened ? `priceText="${String(opened.event.priceText)}" priceFromStore=${String(opened.event.priceFromStore)} buyLabel="${String(opened.event.buyLabel)}" (store metadata "${FOUNDER_CAPTURE_PRICE_TEXT}")` : 'no opened',
    });
    checks.push({ id: 'founder_buy_enabled_when_available', ok: opened !== undefined && opened.event.buyVisible === true && opened.event.buyEnabled === true && toRect(opened.event.buyRect) !== null, detail: opened ? `buyVisible=${String(opened.event.buyVisible)} buyEnabled=${String(opened.event.buyEnabled)}` : 'no opened' });

    const started = shop(before, 'purchase_started');
    const results = shop(before, 'purchase_result');
    const appliedList = shop(before, 'applied');
    const buyResult = shop(before, 'buy_result')[0];
    const lastState = stateEvents(before).at(-1);

    if (expect === 'available') {
        checks.push({ id: 'founder_available_no_purchase', ok: started.length === 0 && results.length === 0 && grantCommands(events).length === 0, detail: `${started.length} purchase_started, ${results.length} purchase_result, ${grantCommands(events).length} grant commands` });
        checks.push({ id: 'founder_available_nothing_owned', ok: stateEvents(events).length > 0 && stateEvents(events).every((e) => e.event.owned === false && e.event.surgeCharges === 0), detail: `${stateEvents(events).length} state event(s)` });
        const closed = shop(before, 'closed')[0];
        checks.push({ id: 'founder_modal_closes', ok: closed !== undefined && closed.event.reason === 'close_button', detail: closed ? `reason=${String(closed.event.reason)}` : 'no closed' });
        return checks;
    }

    checks.push({ id: 'founder_buy_started_once', ok: started.length === 1 && typeof started[0].event.requestId === 'string', detail: `${started.length} purchase_started` });

    if (expect === 'purchase_success') {
        const completed = results.find((e) => e.event.status === 'completed');
        checks.push({ id: 'founder_purchase_completed', ok: completed !== undefined && completed.event.duplicate === false && typeof completed.event.transactionId === 'string', detail: completed ? JSON.stringify({ status: completed.event.status, transactionId: completed.event.transactionId }) : 'no completed purchase_result' });
        const applied = appliedList[0];
        checks.push({ id: 'founder_applied_saved_before_owned', ok: appliedList.length === 1 && applied.event.status === 'applied_saved' && applied.event.restoreOnly === false, detail: `${appliedList.length} applied event(s): ${appliedList.map((e) => String(e.event.status)).join(',')}` });
        const commands = grantCommands(before);
        const eventTypes: unknown[] = Array.isArray(commands[0]?.event.eventTypes) ? (commands[0].event.eventTypes as unknown[]) : [];
        checks.push({ id: 'founder_grant_command_once', ok: commands.length === 1 && eventTypes.includes('founderPackApplied'), detail: `${commands.length} accepted grantFounderPack command_result(s), eventTypes=${JSON.stringify(eventTypes)}` });
        const appliedIndex = before.findIndex((e) => e === applied);
        const stateAfterApply = before.slice(appliedIndex < 0 ? before.length : appliedIndex).find((e) => e.event.evt === 'founder_shop' && e.event.phase === 'state');
        checks.push({ id: 'founder_owned_with_two_surges_exactly_once', ok: stateAfterApply?.event.owned === true && stateAfterApply.event.cosmetic === true && stateAfterApply.event.grantRecorded === true && stateAfterApply.event.surgeCharges === 2 && lastState?.event.surgeCharges === 2, detail: stateAfterApply ? JSON.stringify({ owned: stateAfterApply.event.owned, cosmetic: stateAfterApply.event.cosmetic, grantRecorded: stateAfterApply.event.grantRecorded, surgeCharges: stateAfterApply.event.surgeCharges, lastSurgeCharges: lastState?.event.surgeCharges }) : 'no state event after applied' });
        const duplicates = shop(before, 'duplicate_ignored');
        checks.push({ id: 'founder_duplicate_callback_ignored', ok: duplicates.length >= 1 && appliedList.length === 1, detail: `${duplicates.length} duplicate_ignored, ${appliedList.length} applied` });
        checks.push({ id: 'founder_buy_result_purchased', ok: buyResult?.event.outcome === 'purchased' && buyResult.event.state === 'owned' && buyResult.event.buyVisible === false, detail: buyResult ? `outcome=${String(buyResult.event.outcome)} state=${String(buyResult.event.state)} buyVisible=${String(buyResult.event.buyVisible)} status="${String(buyResult.event.status)}"` : 'no buy_result' });
        // Relaunch without reseeding (no purchase script: the NoOp store): the owner still sees the owned chip, nothing is granted again.
        const afterState = stateEvents(after)[0];
        const afterChip = shop(after, 'chip_shown')[0];
        const afterOpened = shop(after, 'opened')[0];
        checks.push({ id: 'founder_owned_persisted_after_relaunch', ok: markerIndex >= 0 && afterState?.event.owned === true && afterState.event.surgeCharges === 2 && afterChip?.event.state === 'owned', detail: markerIndex < 0 ? 'no relaunch marker' : `state owned=${String(afterState?.event.owned)} surgeCharges=${String(afterState?.event.surgeCharges)} chip=${String(afterChip?.event.state ?? null)}` });
        checks.push({ id: 'founder_no_regrant_after_relaunch', ok: markerIndex >= 0 && grantCommands(after).length === 0 && shop(after, 'purchase_started').length === 0 && stateEvents(after).every((e) => e.event.surgeCharges === 2), detail: `${grantCommands(after).length} grant commands after the relaunch` });
        checks.push({ id: 'founder_owned_modal_after_relaunch', ok: afterOpened !== undefined && afterOpened.event.state === 'owned' && afterOpened.event.buyVisible === false && toRect(afterOpened.event.buyRect) === null, detail: afterOpened ? `state=${String(afterOpened.event.state)} buyVisible=${String(afterOpened.event.buyVisible)}` : 'no opened after the relaunch' });
        return checks;
    }

    // pending / cancel / fail: nothing is granted, nothing is owned.
    checks.push({ id: 'founder_nothing_granted', ok: appliedList.length === 0 && grantCommands(events).length === 0 && stateEvents(events).every((e) => e.event.owned === false && e.event.surgeCharges === 0), detail: `${appliedList.length} applied, ${grantCommands(events).length} grant commands, ${stateEvents(events).length} state event(s) all not owned` });
    if (expect === 'pending') {
        checks.push({ id: 'founder_purchase_pending', ok: results.some((e) => e.event.status === 'pending') && shop(before, 'pending').length === 1, detail: results.map((e) => String(e.event.status)).join(',') });
        checks.push({ id: 'founder_pending_state_buy_disabled', ok: buyResult?.event.outcome === 'pending' && buyResult.event.state === 'pending' && buyResult.event.buyEnabled === false && buyResult.event.status === texts.pending, detail: buyResult ? `outcome=${String(buyResult.event.outcome)} state=${String(buyResult.event.state)} buyEnabled=${String(buyResult.event.buyEnabled)} status="${String(buyResult.event.status)}"` : 'no buy_result' });
        return checks;
    }
    const wantedStatus = expect === 'cancel' ? 'cancelled' : 'failed';
    const wantedNote = expect === 'cancel' ? texts.cancelled : texts.failed;
    checks.push({ id: `founder_purchase_${wantedStatus}`, ok: results.some((e) => e.event.status === wantedStatus), detail: results.map((e) => String(e.event.status)).join(',') });
    checks.push({
        id: 'founder_calm_note_and_buy_again',
        ok: buyResult?.event.outcome === wantedStatus && buyResult.event.note === wantedNote && buyResult.event.state === 'available' && buyResult.event.buyEnabled === true,
        detail: buyResult ? `outcome=${String(buyResult.event.outcome)} note="${String(buyResult.event.note)}" state=${String(buyResult.event.state)} buyEnabled=${String(buyResult.event.buyEnabled)}` : 'no buy_result',
    });
    return checks;
}

/** Chip >= 64 design units tall, inside the safe area, overlapping none of the HUD / panel / other chips reported in the same layout. */
export function chipGeometryChecks(layout: LayoutSnapshot | null): FounderShopCheck[] {
    if (!layout) return [{ id: 'founder_chip_geometry', ok: false, detail: 'no ui_layout reported the chip rect' }];
    const chip = toRect(layout.rects.FounderChip);
    if (!chip) return [{ id: 'founder_chip_geometry', ok: false, detail: 'chip rect missing' }];
    const scale = layout.screen.w / UI_DESIGN_RESOLUTION.width;
    const tol = FOUNDER_SHOP_RECT_TOLERANCE_PX;
    const safe = layout.safeArea ?? { x: 0, y: 0, w: layout.screen.w, h: layout.screen.h };
    const overlaps = NEIGHBOUR_RECTS.filter((name) => {
        const other = toRect(layout.rects[name]);
        return other !== null && rectsOverlapBeyond(chip, other, tol);
    });
    return [
        { id: 'founder_chip_height_units', ok: chip.h / scale >= FOUNDER_SHOP_MIN_HEIGHT_UNITS - 0.5, detail: `${(chip.h / scale).toFixed(1)} design units, ${chip.h.toFixed(1)} px (scale ${scale.toFixed(3)})` },
        { id: 'founder_chip_in_safe_area', ok: rectInside(safe, chip, tol), detail: JSON.stringify({ safe, chip }) },
        { id: 'founder_chip_no_overlap', ok: overlaps.length === 0, detail: overlaps.length === 0 ? 'no overlap with the HUD, panel or chips' : `overlaps ${overlaps.join(', ')}` },
    ];
}

/** Modal: inside the screen, BUY (when offered) and CLOSE >= 64 design units tall, inside the panel and not overlapping each other. */
export function modalGeometryChecks(layout: LayoutSnapshot | null, expectBuy: boolean): FounderShopCheck[] {
    if (!layout) return [{ id: 'founder_modal_geometry', ok: false, detail: 'no ui_layout reported the modal rects' }];
    const panel = toRect(layout.rects.FounderPanel);
    const close = toRect(layout.rects.FounderClose);
    const buy = toRect(layout.rects.FounderBuy);
    if (!panel || !close || (expectBuy && !buy)) return [{ id: 'founder_modal_geometry', ok: false, detail: `panel=${JSON.stringify(panel)} buy=${JSON.stringify(buy)} close=${JSON.stringify(close)}` }];
    const scale = layout.screen.w / UI_DESIGN_RESOLUTION.width;
    const tol = FOUNDER_SHOP_RECT_TOLERANCE_PX;
    const screenRect = { x: 0, y: 0, w: layout.screen.w, h: layout.screen.h };
    const minHeight = FOUNDER_SHOP_MIN_HEIGHT_UNITS * scale - 1;
    const buttons = [close, ...(buy ? [buy] : [])];
    return [
        { id: 'founder_buttons_at_least_64_design_units', ok: buttons.every((b) => b.h >= minHeight), detail: `scale=${scale.toFixed(3)} close.h=${close.h.toFixed(1)} buy.h=${buy ? buy.h.toFixed(1) : 'n/a'} (min ${Math.round(minHeight)} px)` },
        { id: 'founder_modal_on_screen', ok: rectInside(screenRect, panel, tol), detail: JSON.stringify({ panel }) },
        { id: 'founder_buttons_inside_panel', ok: buttons.every((b) => rectInside(panel, b, tol)) && !(buy && rectsOverlapBeyond(buy, close, 0.5)), detail: JSON.stringify({ panel, buy, close }) },
    ];
}
