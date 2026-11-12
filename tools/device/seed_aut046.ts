/**
 * AUT-046 review helper: installs nothing, only seeds a save one step before a Major milestone so the toast / pulse / spark /
 * optional focus can be triggered on the phone with ONE tap.
 *
 *   force-stop -> write a seeded save -> relaunch. Variant:
 *   - `breakthrough` (default): Fabricator Lv50 / Assembly Lv25 with Auto Feeder + Worker Bot owned, Robotic Logistics not yet bought and
 *     affordable. The HUD Next Goal is the Robotic Logistics breakthrough: tapping its Unlock action emits `breakthroughPurchased`, a
 *     Major toast titled "Robotic Logistics" with the accent underline, sparks and a pulse on the Assembly Station, plus a camera
 *     focus when the Assembly Station is off-centre (pan away first to see it). The save load itself must stay silent (no toast).
 * Seed-only: no new state shape, no Exceptional reveal in the burst (the breakthrough only adds multipliers).
 * Requires the FactoryWorld DEBUG APK (run-as).
 */
import { GAME_SESSION_DEV_GAME_VERSION } from '../../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import { CURRENT_SAVE_VERSION, createSaveTimestampUtcIsoFromUnixMilliseconds, serializeGameStateToSaveJson } from '../../assets/scripts/persistence/index.ts';
import { createFreshGameState, type GameState } from '../../assets/scripts/state/index.ts';
import { loadGameConfigFromSources } from '../../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../../assets/scripts/config/EmbeddedEconomyConfig.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';

const economy = () => loadGameConfigFromSources(getEmbeddedEconomyConfigSources());

export const AUT046_SEED_VARIANTS = ['breakthrough'] as const;
export type Aut046SeedVariant = typeof AUT046_SEED_VARIANTS[number];

/** Economy cost of the Robotic Logistics breakthrough (the tests pin it to data/economy/breakthroughs.json). */
export const AUT046_BREAKTHROUGH_ID = 'robotic_logistics';
export const AUT046_BREAKTHROUGH_COST = 250000;

export function isAut046SeedVariant(value: unknown): value is Aut046SeedVariant {
    return typeof value === 'string' && (AUT046_SEED_VARIANTS as readonly string[]).includes(value);
}

export function buildAut046SeededState(_variant: Aut046SeedVariant = 'breakthrough'): GameState {
    const state = createFreshGameState();
    state.run.purchasedBreakthroughIds = ['auto_feeder', 'worker_bot'];
    state.run.progressionFlags['first_robot'] = true;
    state.run.producers.fabricator = { level: 50, isUnlocked: true, isBuilt: true };
    state.run.producers.assembly_station = { level: 25, isUnlocked: true, isBuilt: true };
    state.run.automation.fabricator = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: 'auto_feeder' };
    state.run.automation.assembly_station = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: 'worker_bot' };
    state.run.robotsBuilt = 100;
    state.run.industrialOutput = AUT046_BREAKTHROUGH_COST * 2;
    return state;
}

export function buildAut046SeededSave(variant: Aut046SeedVariant, nowMs: number): string {
    return serializeGameStateToSaveJson(buildAut046SeededState(variant), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: economy().contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - 5_000),
    });
}

export async function seedAut046(driver: SessionDeviceDriver, packageName: string, activity: string, variant: Aut046SeedVariant, now: () => Date = () => new Date()): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    await driver.removeAppFiles(packageName, SAVE_FILE_NAMES.map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut046SeededSave(variant, now().getTime()));
    await driver.launch(packageName, activity);
    return filesDir;
}
