/**
 * AUT-043 human-gate helper: installs nothing, only seeds a save so the Automated Cell states can be screenshotted and the
 * live construction can be built on the phone.
 *
 *   force-stop -> write a seeded save -> relaunch. Variants:
 *   - `unbuilt`: Fabricator Lv50 / Assembly Lv25 / Robot Line Lv25 built (Automated Factory era), 100 Robots Built, Automated Cell
 *     NOT built, Output = 2x the cost of the "Automated Cell Architecture" breakthrough (affordable). The Automated Cell is constructed
 *     by buying that breakthrough (effect constructProducer automated_cell Lv1): the AUT-040 sequence then plays once with one camera
 *     focus beat.
 *   - `lv1` / `lv10`: the same state with the breakthrough owned and the Automated Cell already built (Lv1 / Lv10).
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

export const AUT043_SEED_VARIANTS = ['unbuilt', 'lv1', 'lv10'] as const;
export type Aut043SeedVariant = typeof AUT043_SEED_VARIANTS[number];

/** Cost of the Automated Cell Architecture breakthrough, which constructs the cell (data/economy/breakthroughs.json; the seed doubles it). */
export const AUTOMATED_CELL_CONSTRUCTION_COST = 25000000;

export function isAut043SeedVariant(value: unknown): value is Aut043SeedVariant {
    return typeof value === 'string' && (AUT043_SEED_VARIANTS as readonly string[]).includes(value);
}

export function buildAut043SeededState(variant: Aut043SeedVariant): GameState {
    const state = createFreshGameState();
    state.run.purchasedBreakthroughIds = ['auto_feeder', 'worker_bot', 'robotic_logistics'];
    state.run.progressionFlags['first_robot'] = true;
    state.run.currentEraId = 'automated_factory';
    state.run.producers.fabricator = { level: 50, isUnlocked: true, isBuilt: true };
    state.run.producers.assembly_station = { level: 25, isUnlocked: true, isBuilt: true };
    state.run.producers.robot_line = { level: 25, isUnlocked: true, isBuilt: true };
    state.run.automation.fabricator = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: 'auto_feeder' };
    state.run.automation.assembly_station = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: 'worker_bot' };
    state.run.automation.robot_line = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: null };
    // A visible population so the Line / Cell -> Storage robots can be seen.
    state.run.robotsBuilt = 100;
    if (variant === 'unbuilt') {
        state.run.producers.automated_cell = { level: 0, isUnlocked: true, isBuilt: false };
        state.run.industrialOutput = AUTOMATED_CELL_CONSTRUCTION_COST * 2;
    } else {
        state.run.purchasedBreakthroughIds.push('automated_cell_architecture');
        state.run.producers.automated_cell = { level: variant === 'lv10' ? 10 : 1, isUnlocked: true, isBuilt: true };
        state.run.automation.automated_cell = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: null };
        state.run.industrialOutput = 1000;
    }
    return state;
}

export function buildAut043SeededSave(variant: Aut043SeedVariant, nowMs: number): string {
    return serializeGameStateToSaveJson(buildAut043SeededState(variant), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: economy().contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - 5_000),
    });
}

export async function seedAut043(driver: SessionDeviceDriver, packageName: string, activity: string, variant: Aut043SeedVariant, now: () => Date = () => new Date()): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    await driver.removeAppFiles(packageName, SAVE_FILE_NAMES.map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut043SeededSave(variant, now().getTime()));
    await driver.launch(packageName, activity);
    return filesDir;
}
