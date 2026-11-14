/**
 * AUT-057 review helper: seeds a save + the per-launch `debug_ads.json {"provider":"admob_test"}` so the DEBUG build uses the REAL Android AdMob provider
 * (Google sample IDs, forced natively in debuggable builds) instead of the mock
 * (`npm run device:seed-aut057 [-- --variant offline_double|extended]`,
 * `npm run device:reveal-capture -- --scenario aut057-offline-double|aut057-extended|aut057-no-fill`).
 *
 *   force-stop -> (no-fill only: Wi-Fi + data OFF) -> write the AUT-055 `ready` save (offline_double: 3 h away, the x2 action is offered) or the
 *   AUT-056 `eligible` save (extended: Free Overclock READY, the chip is offered) -> remove stale saves, debug_command.json and debug_ads.json ->
 *   write debug_ads.json -> relaunch.
 * Requires the FactoryWorld DEBUG APK (run-as) and network access for real test ads (except the no-fill scenario, which switches the network off and
 * restores it at the end of the capture).
 */
import { DEBUG_COMMAND_FILE } from '../../assets/scripts/presentation/DebugCommandFile.ts';
import { DEBUG_ADS_FILE, DEBUG_ADS_PROVIDER_ADMOB_TEST } from '../../assets/scripts/presentation/DebugAdsScriptFile.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';
import { buildAut055SeededSave } from './seed_aut055.ts';
import { buildAut056SeededSave } from './seed_aut056.ts';

export const AUT057_SEED_VARIANTS = ['offline_double', 'extended'] as const;
export type Aut057SeedVariant = typeof AUT057_SEED_VARIANTS[number];

export function isAut057SeedVariant(value: unknown): value is Aut057SeedVariant {
    return typeof value === 'string' && (AUT057_SEED_VARIANTS as readonly string[]).includes(value);
}

/** The DEBUG ads script the seed writes: the provider switch only (no scripted outcomes, the real ad decides). */
export function buildAut057AdsScriptFile(): string {
    return JSON.stringify({ provider: DEBUG_ADS_PROVIDER_ADMOB_TEST });
}

export function buildAut057SeededSave(variant: Aut057SeedVariant, nowMs: number): string {
    return variant === 'offline_double' ? buildAut055SeededSave('ready', nowMs) : buildAut056SeededSave('eligible', nowMs);
}

export interface Aut057SeedOptions {
    /** No-fill scenario: switch Wi-Fi + mobile data OFF before the launch (the capture restores them). */
    readonly networkOff?: boolean;
}

export async function seedAut057(driver: SessionDeviceDriver, packageName: string, activity: string, variant: Aut057SeedVariant, options: Aut057SeedOptions = {}, now: () => Date = () => new Date()): Promise<string> {
    await driver.forceStop(packageName);
    if (options.networkOff === true) await driver.setNetworkEnabled?.(false);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    // Stale saves, debug command and ads script from a previous capture must never leak into the seeded run.
    await driver.removeAppFiles(packageName, [...SAVE_FILE_NAMES, DEBUG_COMMAND_FILE, DEBUG_ADS_FILE].map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut057SeededSave(variant, now().getTime()));
    await driver.writeAppFile(packageName, `${filesDir}${DEBUG_ADS_FILE}`, buildAut057AdsScriptFile());
    await driver.launch(packageName, activity);
    return filesDir;
}
