/**
 * AUT-059 review helper: seeds saves + the DEBUG purchase script for the Founder's Pack shop capture
 * (`npm run device:seed-aut059 [-- --variant available|owned|locked|no_store] [--outcome completed|pending|cancelled|failed] [--duplicate] [--missing-metadata]`,
 * `npm run device:reveal-capture -- --scenario aut059-available|aut059-purchase-success|aut059-pending|aut059-cancel|aut059-fail|aut059-owned|aut059-hidden|aut059-locked`).
 *
 *   force-stop -> write the seeded save (the AUT-047 factory: Fabricator Lv50 / Assembly Lv25, Auto Feeder + Worker Bot, so the offer is unlocked) ->
 *   remove stale saves, debug_command.json, debug_ads.json and debug_purchase.json -> write debug_purchase.json (the MOCK store: product metadata with a
 *   test price string + the scripted outcomes, read once by the DEBUG build) -> relaunch.
 *   - `available` (default): Worker Bot owned, not purchased: the chip shows with the mock store price.
 *   - `owned`: the Founder pack is already owned (entitlement + cosmetic + 2 Surge charges): the chip shows its owned state, no BUY.
 *   - `locked`: a fresh save (no Worker Bot): NO chip even though the mock store is ready (nothing is teased).
 *   - `no_store`: Worker Bot owned but NO debug_purchase.json: the NoOp purchase service (like a release build): NO chip.
 * Seed-only: no new state shape. The price string is test metadata of the mock store, never read from any game source.
 * Requires the FactoryWorld DEBUG APK (run-as).
 */
import { GAME_SESSION_DEV_GAME_VERSION } from '../../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import { applyFounderPackPurchase } from '../../assets/scripts/monetization/FounderOffer.ts';
import { loadGameConfigFromSources } from '../../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { CURRENT_SAVE_VERSION, createSaveTimestampUtcIsoFromUnixMilliseconds, serializeGameStateToSaveJson } from '../../assets/scripts/persistence/index.ts';
import { DEBUG_ADS_FILE } from '../../assets/scripts/presentation/DebugAdsScriptFile.ts';
import { DEBUG_COMMAND_FILE } from '../../assets/scripts/presentation/DebugCommandFile.ts';
import { DEBUG_PURCHASE_FILE, DEBUG_PURCHASE_OUTCOMES, type DebugPurchaseOutcome } from '../../assets/scripts/presentation/DebugPurchaseScriptFile.ts';
import { createFreshGameState, type GameState } from '../../assets/scripts/state/index.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { FOUNDER_CAPTURE_PRICE_TEXT } from './founder_shop_checks.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';
import { buildAut047SeededState } from './seed_aut047.ts';

export const AUT059_SEED_VARIANTS = ['available', 'owned', 'locked', 'no_store'] as const;
export type Aut059SeedVariant = typeof AUT059_SEED_VARIANTS[number];

export function isAut059SeedVariant(value: unknown): value is Aut059SeedVariant {
    return typeof value === 'string' && (AUT059_SEED_VARIANTS as readonly string[]).includes(value);
}

export function isAut059Outcome(value: unknown): value is DebugPurchaseOutcome {
    return typeof value === 'string' && (DEBUG_PURCHASE_OUTCOMES as readonly string[]).includes(value);
}

export interface Aut059ScriptOptions {
    readonly outcomes?: readonly DebugPurchaseOutcome[];
    readonly duplicateCallback?: boolean;
    readonly metadataMissing?: boolean;
}

export function buildAut059SeededState(variant: Aut059SeedVariant, nowMs: number): GameState {
    if (variant === 'locked') return createFreshGameState();
    const state = buildAut047SeededState('ready');
    if (variant === 'owned') {
        // The Worker Bot / Free Overclock seed plus a real grant (entitlement, cosmetic, grant-once flag, 2 Surge charges), exactly as a purchase would leave it.
        state.meta = applyFounderPackPurchase(state, { source: 'mock', grantedAtUtcMs: Math.floor(nowMs) - 60_000 }).meta;
    }
    return state;
}

export function buildAut059SeededSave(variant: Aut059SeedVariant, nowMs: number): string {
    return serializeGameStateToSaveJson(buildAut059SeededState(variant, nowMs), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: loadGameConfigFromSources(getEmbeddedEconomyConfigSources()).contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - 1_000),
    });
}

/** The DEBUG purchase script the seed writes: the mock store's product metadata (a test price string) and the scripted outcomes. */
export function buildAut059PurchaseScriptFile(options: Aut059ScriptOptions = {}): string {
    return JSON.stringify({
        ...(options.metadataMissing === true ? { metadata: 'missing' } : { price: FOUNDER_CAPTURE_PRICE_TEXT }),
        outcomes: options.outcomes ?? [],
        ...(options.duplicateCallback === true ? { duplicateCallback: true } : {}),
    });
}

export async function seedAut059(
    driver: SessionDeviceDriver,
    packageName: string,
    activity: string,
    variant: Aut059SeedVariant,
    options: Aut059ScriptOptions = {},
    now: () => Date = () => new Date(),
): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    // Stale saves, debug command, ads script and purchase script from a previous capture must never leak into the seeded run.
    await driver.removeAppFiles(packageName, [...SAVE_FILE_NAMES, DEBUG_COMMAND_FILE, DEBUG_ADS_FILE, DEBUG_PURCHASE_FILE].map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut059SeededSave(variant, now().getTime()));
    if (variant !== 'no_store') await driver.writeAppFile(packageName, `${filesDir}${DEBUG_PURCHASE_FILE}`, buildAut059PurchaseScriptFile(options));
    await driver.launch(packageName, activity);
    return filesDir;
}
