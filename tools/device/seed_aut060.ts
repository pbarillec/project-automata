/**
 * AUT-060 review helper: seeds a save + the per-launch `debug_purchase.json {"provider":"play_billing"}` so the DEBUG build uses the REAL Google
 * Play Billing provider instead of the AUT-059 mock (`npm run device:seed-aut060 [-- --variant available|owned]`,
 * `npm run device:reveal-capture -- --scenario aut060-license-tester-purchase|aut060-cancel|aut060-restore-owned`).
 *
 *   force-stop -> write the seeded save (the AUT-047 factory: Worker Bot owned so the offer is unlocked, NO local Founder entitlement) -> remove stale
 *   saves, debug_command.json, debug_ads.json and debug_purchase.json -> write debug_purchase.json -> relaunch.
 *   - `available` (default): offer unlocked, not purchased: the chip shows once the store answers with a price.
 *   - `owned`: the same save, used for the restore scenario: the local entitlement is EMPTY, as after a reinstall, and the store (already bought by
 *     this license tester) must restore ownership WITHOUT re-granting Surges.
 *
 * ENVIRONMENT: the real store scenarios need a device with Google Play, a license-tester account, the in-app product created by the owner and the
 * app installed in a form the Play Billing library accepts (internal testing track or a matching signed build). Without them the capture reports
 * `ENVIRONMENT_BLOCKED` (never a false PASS). `restore-owned` additionally needs a prior successful purchase on that account.
 */
import { GAME_SESSION_DEV_GAME_VERSION } from '../../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import { loadGameConfigFromSources } from '../../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { CURRENT_SAVE_VERSION, createSaveTimestampUtcIsoFromUnixMilliseconds, serializeGameStateToSaveJson } from '../../assets/scripts/persistence/index.ts';
import { DEBUG_ADS_FILE } from '../../assets/scripts/presentation/DebugAdsScriptFile.ts';
import { DEBUG_COMMAND_FILE } from '../../assets/scripts/presentation/DebugCommandFile.ts';
import { DEBUG_PURCHASE_FILE, DEBUG_PURCHASE_PROVIDER_PLAY_BILLING } from '../../assets/scripts/presentation/DebugPurchaseScriptFile.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';
import { buildAut047SeededState } from './seed_aut047.ts';

export const AUT060_SEED_VARIANTS = ['available', 'owned'] as const;
export type Aut060SeedVariant = typeof AUT060_SEED_VARIANTS[number];

export function isAut060SeedVariant(value: unknown): value is Aut060SeedVariant {
    return typeof value === 'string' && (AUT060_SEED_VARIANTS as readonly string[]).includes(value);
}

/** The DEBUG purchase script the seed writes: the provider switch only (no mock field, the real store decides). */
export function buildAut060PurchaseScriptFile(): string {
    return JSON.stringify({ provider: DEBUG_PURCHASE_PROVIDER_PLAY_BILLING });
}

/** Both variants start with NO local Founder entitlement (the seeded factory only unlocks the offer). */
export function buildAut060SeededSave(_variant: Aut060SeedVariant, nowMs: number): string {
    return serializeGameStateToSaveJson(buildAut047SeededState('ready'), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: loadGameConfigFromSources(getEmbeddedEconomyConfigSources()).contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - 1_000),
    });
}

export async function seedAut060(driver: SessionDeviceDriver, packageName: string, activity: string, variant: Aut060SeedVariant, now: () => Date = () => new Date()): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    await driver.removeAppFiles(packageName, [...SAVE_FILE_NAMES, DEBUG_COMMAND_FILE, DEBUG_ADS_FILE, DEBUG_PURCHASE_FILE].map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut060SeededSave(variant, now().getTime()));
    await driver.writeAppFile(packageName, `${filesDir}${DEBUG_PURCHASE_FILE}`, buildAut060PurchaseScriptFile());
    await driver.launch(packageName, activity);
    return filesDir;
}
