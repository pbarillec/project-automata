/**
 * AUT-042 human-gate helper: installs nothing, only seeds a save so the Robot Line states can be screenshotted and the
 * live Era II reveal can be built on the phone.
 *
 *   force-stop -> write a seeded save -> relaunch. Variants:
 *   - `unbuilt`: Fabricator Lv50 / Assembly Lv25, Auto Feeder + Worker Bot + Robotic Logistics, Robot Line unlocked but NOT
 *     built, Output = 2x its Era II construction cost (affordable). Select the Robot Line and build it: the AUT-040
 *     sequence plays once with one camera focus beat and the Era II change is seen live.
 *   - `lv1` / `lv10`: the same state with the Robot Line already built (Lv1 / Lv10) in the Automated Factory era.
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

export const AUT042_SEED_VARIANTS = ['unbuilt', 'lv1', 'lv10'] as const;
export type Aut042SeedVariant = typeof AUT042_SEED_VARIANTS[number];

/** Era II construction cost of the Robot Line (the authoritative Era II transition; see automation_era_progression tests). */
export const ROBOT_LINE_CONSTRUCTION_COST = 500000;

export function isAut042SeedVariant(value: unknown): value is Aut042SeedVariant {
    return typeof value === 'string' && (AUT042_SEED_VARIANTS as readonly string[]).includes(value);
}

export function buildAut042SeededState(variant: Aut042SeedVariant): GameState {
    const state = createFreshGameState();
    state.run.purchasedBreakthroughIds = ['auto_feeder', 'worker_bot', 'robotic_logistics'];
    state.run.progressionFlags['first_robot'] = true;
    state.run.producers.fabricator = { level: 50, isUnlocked: true, isBuilt: true };
    state.run.producers.assembly_station = { level: 25, isUnlocked: true, isBuilt: true };
    state.run.automation.fabricator = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: 'auto_feeder' };
    state.run.automation.assembly_station = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: 'worker_bot' };
    // A visible population so the Line -> Exit -> Storage robots can be seen once the line exists.
    state.run.robotsBuilt = 100;
    if (variant === 'unbuilt') {
        state.run.producers.robot_line = { level: 0, isUnlocked: true, isBuilt: false };
        state.run.industrialOutput = ROBOT_LINE_CONSTRUCTION_COST * 2;
    } else {
        state.run.producers.robot_line = { level: variant === 'lv10' ? 10 : 1, isUnlocked: true, isBuilt: true };
        state.run.automation.robot_line = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: null };
        state.run.currentEraId = 'automated_factory';
        state.run.industrialOutput = 1000;
    }
    return state;
}

export function buildAut042SeededSave(variant: Aut042SeedVariant, nowMs: number): string {
    return serializeGameStateToSaveJson(buildAut042SeededState(variant), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: economy().contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - 5_000),
    });
}

export async function seedAut042(driver: SessionDeviceDriver, packageName: string, activity: string, variant: Aut042SeedVariant, now: () => Date = () => new Date()): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    await driver.removeAppFiles(packageName, SAVE_FILE_NAMES.map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut042SeededSave(variant, now().getTime()));
    await driver.launch(packageName, activity);
    return filesDir;
}
