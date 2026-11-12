/**
 * AUT-044 human-gate helper: installs nothing, only seeds a save so the Advanced Robotics Complex states can be screenshotted
 * and the live construction can be built on the phone.
 *
 *   force-stop -> write a seeded save -> relaunch. Variants:
 *   - `unbuilt`: Fabricator Lv50 / Assembly Lv25 / Robot Line Lv50 / Automated Cell Lv25 built, 1000 Robots Built, the Advanced
 *     Robotics Complex NOT built, Output = 2x the cost of the "Advanced Robotics" breakthrough (affordable). The complex is
 *     constructed by buying that breakthrough (effects: constructProducer advanced_robotics_complex Lv1 + enterEra robotics_complex):
 *     the AUT-040 sequence then plays once with one camera focus beat.
 *     SEED-ONLY STATE: the era is already `robotics_complex`. With the natural era (`automated_factory`) the Next Goal is an
 *     `era` goal sourced by that breakthrough and the HUD shows NO Next Goal action for `era` goals (CoreLoopActions only acts on
 *     `breakthrough` goals), so the reveal capture could not tap it. With the era pre-entered the Next Goal is exactly the
 *     `advanced_robotics` breakthrough goal and the purchase still constructs the complex (the era effect is a no-op: no eraChanged,
 *     no era presentation, which belongs to AUT-048).
 *   - `lv1` / `lv10`: the same state with the breakthrough owned and the complex already built (Lv1 / Lv10).
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

export const AUT044_SEED_VARIANTS = ['unbuilt', 'lv1', 'lv10'] as const;
export type Aut044SeedVariant = typeof AUT044_SEED_VARIANTS[number];

/** Cost of the Advanced Robotics breakthrough, which constructs the complex (data/economy/breakthroughs.json; the seed doubles it). */
export const ARC_CONSTRUCTION_COST = 1000000000;

export function isAut044SeedVariant(value: unknown): value is Aut044SeedVariant {
    return typeof value === 'string' && (AUT044_SEED_VARIANTS as readonly string[]).includes(value);
}

export function buildAut044SeededState(variant: Aut044SeedVariant): GameState {
    const state = createFreshGameState();
    state.run.purchasedBreakthroughIds = ['auto_feeder', 'worker_bot', 'robotic_logistics', 'factory_control_system', 'automated_cell_architecture'];
    state.run.progressionFlags['first_robot'] = true;
    state.run.currentEraId = 'robotics_complex';
    state.run.producers.fabricator = { level: 50, isUnlocked: true, isBuilt: true };
    state.run.producers.assembly_station = { level: 25, isUnlocked: true, isBuilt: true };
    state.run.producers.robot_line = { level: 50, isUnlocked: true, isBuilt: true };
    state.run.producers.automated_cell = { level: 25, isUnlocked: true, isBuilt: true };
    state.run.automation.fabricator = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: 'auto_feeder' };
    state.run.automation.assembly_station = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: 'worker_bot' };
    state.run.automation.robot_line = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: null };
    state.run.automation.automated_cell = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: null };
    // A visible population (the Advanced Robotics breakthrough requires 1000 Robots Built).
    state.run.robotsBuilt = 1000;
    if (variant === 'unbuilt') {
        state.run.producers.advanced_robotics_complex = { level: 0, isUnlocked: true, isBuilt: false };
        state.run.industrialOutput = ARC_CONSTRUCTION_COST * 2;
    } else {
        state.run.purchasedBreakthroughIds.push('advanced_robotics');
        state.run.producers.advanced_robotics_complex = { level: variant === 'lv10' ? 10 : 1, isUnlocked: true, isBuilt: true };
        state.run.automation.advanced_robotics_complex = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: null };
        state.run.industrialOutput = 1000;
    }
    return state;
}

export function buildAut044SeededSave(variant: Aut044SeedVariant, nowMs: number): string {
    return serializeGameStateToSaveJson(buildAut044SeededState(variant), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: economy().contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - 5_000),
    });
}

export async function seedAut044(driver: SessionDeviceDriver, packageName: string, activity: string, variant: Aut044SeedVariant, now: () => Date = () => new Date()): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    await driver.removeAppFiles(packageName, SAVE_FILE_NAMES.map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut044SeededSave(variant, now().getTime()));
    await driver.launch(packageName, activity);
    return filesDir;
}
