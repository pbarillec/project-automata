/**
 * AUT-061 review helper: seeds a save + the DEBUG MOCK store script for the purchase restore captures
 * (`npm run device:seed-aut061 [-- --variant reinstall|local_owned_store_error]`,
 * `npm run device:reveal-capture -- --scenario aut061-restore-reinstall|aut061-restore-store-error`).
 *
 *   force-stop -> write the seeded save -> remove stale saves, debug_command.json, debug_ads.json and debug_purchase.json -> write debug_purchase.json
 *   (the MOCK store with a scripted `restore` mode, read once by the DEBUG build) -> relaunch.
 *   - `reinstall` (default): a FRESH save (nothing owned, as after a reinstall / clear data) and `restore: owned`: the store query must restore the entitlement
 *     and cosmetic with ZERO Surge charges (the grant flag is recorded so a later redelivery cannot regrant).
 *   - `local_owned_store_error`: the pack is owned locally (entitlement + cosmetic + 2 charges) and `restore: error` (the store cannot answer): still Owned, untouched.
 * Seed-only: no new state shape, no real store, no Play sheet. Requires the FactoryWorld DEBUG APK (run-as).
 */
import { GAME_SESSION_DEV_GAME_VERSION } from '../../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import { loadGameConfigFromSources } from '../../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { CURRENT_SAVE_VERSION, createSaveTimestampUtcIsoFromUnixMilliseconds, serializeGameStateToSaveJson } from '../../assets/scripts/persistence/index.ts';
import { DEBUG_ADS_FILE } from '../../assets/scripts/presentation/DebugAdsScriptFile.ts';
import { DEBUG_COMMAND_FILE } from '../../assets/scripts/presentation/DebugCommandFile.ts';
import { DEBUG_PURCHASE_FILE, type DebugPurchaseRestoreMode } from '../../assets/scripts/presentation/DebugPurchaseScriptFile.ts';
import type { GameState } from '../../assets/scripts/state/index.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { FOUNDER_CAPTURE_PRICE_TEXT } from './founder_shop_checks.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';
import { buildAut059SeededState } from './seed_aut059.ts';

export const AUT061_SEED_VARIANTS = ['reinstall', 'local_owned_store_error'] as const;
export type Aut061SeedVariant = typeof AUT061_SEED_VARIANTS[number];

export function isAut061SeedVariant(value: unknown): value is Aut061SeedVariant {
    return typeof value === 'string' && (AUT061_SEED_VARIANTS as readonly string[]).includes(value);
}

/** The scripted store query behaviour of a variant. */
export function aut061RestoreMode(variant: Aut061SeedVariant): DebugPurchaseRestoreMode {
    return variant === 'reinstall' ? 'owned' : 'error';
}

export function buildAut061SeededState(variant: Aut061SeedVariant, nowMs: number): GameState {
    // reinstall = the AUT-059 `locked` seed (a fresh state); local_owned_store_error = the AUT-059 `owned` seed (a real grant: entitlement, cosmetic, flag, 2 charges).
    return buildAut059SeededState(variant === 'reinstall' ? 'locked' : 'owned', nowMs);
}

export function buildAut061SeededSave(variant: Aut061SeedVariant, nowMs: number): string {
    return serializeGameStateToSaveJson(buildAut061SeededState(variant, nowMs), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: loadGameConfigFromSources(getEmbeddedEconomyConfigSources()).contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - 1_000),
    });
}

/** The DEBUG purchase script: the mock store's product metadata (test price) plus the scripted store-query behaviour. */
export function buildAut061PurchaseScriptFile(variant: Aut061SeedVariant): string {
    return JSON.stringify({ price: FOUNDER_CAPTURE_PRICE_TEXT, restore: aut061RestoreMode(variant) });
}

export async function seedAut061(
    driver: SessionDeviceDriver,
    packageName: string,
    activity: string,
    variant: Aut061SeedVariant,
    now: () => Date = () => new Date(),
): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    await driver.removeAppFiles(packageName, [...SAVE_FILE_NAMES, DEBUG_COMMAND_FILE, DEBUG_ADS_FILE, DEBUG_PURCHASE_FILE].map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut061SeededSave(variant, now().getTime()));
    await driver.writeAppFile(packageName, `${filesDir}${DEBUG_PURCHASE_FILE}`, buildAut061PurchaseScriptFile(variant));
    await driver.launch(packageName, activity);
    return filesDir;
}
