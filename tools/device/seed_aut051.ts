/**
 * AUT-051 review helper: seeds saves for the Offline Factory Report capture
 * (`npm run device:seed-aut051 [-- --variant compact|first|cap|reload]`, `npm run device:reveal-capture -- --scenario aut051|aut051-reload`).
 *
 *   force-stop -> write a valid seeded save whose envelope `savedAtUtc` is (now minus N hours) -> remove stale debug / save leftovers -> relaunch.
 *   The app then loads the save, builds the offline preview from that absence and shows the Factory Report card. Variants:
 *   - `first` (default): Fabricator automated (Auto Feeder), Assembly Station built and left MANUAL, 3 h away: the educational line appears.
 *   - `compact`: every built producer is automated (Fabricator only), 3 h away: NO educational line.
 *   - `cap`: as `first` but 10 h away: the 8 h offline limit is applied ("Offline limit 8h reached").
 *   - `reload`: as `first` (3 h); used by the reload scenario that force-stops BEFORE Collect and relaunches without reseeding.
 *   - `short` (AUT-051b): as `first` but only ~30 s away: NO card (under the 60 s minimum); the preview is auto-collected silently.
 * The seeds use the host UTC clock (like seed_aut049); a large device clock skew would shift the absence. Requires the FactoryWorld DEBUG APK (run-as).
 */
import { GAME_SESSION_DEV_GAME_VERSION } from '../../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import { CURRENT_SAVE_VERSION, createSaveTimestampUtcIsoFromUnixMilliseconds, serializeGameStateToSaveJson } from '../../assets/scripts/persistence/index.ts';
import { purchaseBreakthrough } from '../../assets/scripts/progression/index.ts';
import { createFreshGameState, type GameState } from '../../assets/scripts/state/index.ts';
import { loadGameConfigFromSources } from '../../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { DEBUG_COMMAND_FILE } from '../../assets/scripts/presentation/DebugCommandFile.ts';
import { DEBUG_ADS_FILE } from '../../assets/scripts/presentation/DebugAdsScriptFile.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';

const economy = () => loadGameConfigFromSources(getEmbeddedEconomyConfigSources());

export const AUT051_SEED_VARIANTS = ['first', 'compact', 'cap', 'reload', 'short'] as const;
export type Aut051SeedVariant = typeof AUT051_SEED_VARIANTS[number];

/** Seconds of absence per variant (the offline cap is 8 h; AUT-051b: under 60 s no card is shown). */
export const AUT051_ABSENCE_SECONDS: Readonly<Record<Aut051SeedVariant, number>> = Object.freeze({ first: 3 * 3600, compact: 3 * 3600, cap: 10 * 3600, reload: 3 * 3600, short: 30 });

export function isAut051SeedVariant(value: unknown): value is Aut051SeedVariant {
    return typeof value === 'string' && (AUT051_SEED_VARIANTS as readonly string[]).includes(value);
}

/** A valid state with an automated, offline-eligible Fabricator (+ a built, manual Assembly Station unless `compact`). */
export function buildAut051SeededState(variant: Aut051SeedVariant): GameState {
    const repository = economy();
    const state = createFreshGameState();
    state.run.producers.fabricator = { level: 15, isUnlocked: true, isBuilt: true };
    state.run.industrialOutput = 1500;
    const purchase = purchaseBreakthrough(repository, state, 'auto_feeder');
    if (purchase.status !== 'success') throw new Error(`AUT-051 seed: Auto Feeder purchase failed (${purchase.status})`);
    const seeded = purchase.state;
    seeded.run.industrialOutput = 1000;
    if (variant !== 'compact') seeded.run.producers.assembly_station = { level: 3, isUnlocked: true, isBuilt: true };
    return seeded;
}

export function buildAut051SeededSave(variant: Aut051SeedVariant, nowMs: number): string {
    const absenceMs = AUT051_ABSENCE_SECONDS[variant] * 1000;
    return serializeGameStateToSaveJson(buildAut051SeededState(variant), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: economy().contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - absenceMs),
    });
}

export async function seedAut051(driver: SessionDeviceDriver, packageName: string, activity: string, variant: Aut051SeedVariant, now: () => Date = () => new Date()): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    // Stale saves (main / backup / temp) and any debug command from a previous capture must never leak into the seeded run.
    await driver.removeAppFiles(packageName, [...SAVE_FILE_NAMES, DEBUG_COMMAND_FILE, DEBUG_ADS_FILE].map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut051SeededSave(variant, now().getTime()));
    await driver.launch(packageName, activity);
    return filesDir;
}
