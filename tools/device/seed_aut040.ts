/**
 * AUT-040 human-gate helper: installs nothing, only seeds a save so the Assembly Station can be BUILT live on the phone.
 *
 *   force-stop -> write a seeded save (Fabricator Lv15 automated by Auto Feeder, Assembly Station unlocked but NOT
 *   built, Output = Assembly Lv1 cost) -> relaunch.  The human then selects the Assembly Station and builds it;
 *   the construction sequence plays once. Requires the FactoryWorld DEBUG APK (run-as).
 */
import { loadGameConfigFromSources } from '../../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { GAME_SESSION_DEV_GAME_VERSION } from '../../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import { CURRENT_SAVE_VERSION, createSaveTimestampUtcIsoFromUnixMilliseconds, serializeGameStateToSaveJson } from '../../assets/scripts/persistence/index.ts';
import { createFreshGameState, type GameState } from '../../assets/scripts/state/index.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';

const economy = () => loadGameConfigFromSources(getEmbeddedEconomyConfigSources());

/** Fabricator Lv15 automated, Assembly Station unlocked / not built, enough Output to build it. */
export function buildAut040SeededState(): GameState {
    const state = createFreshGameState();
    state.run.producers.fabricator = { level: 15, isUnlocked: true, isBuilt: true };
    state.run.purchasedBreakthroughIds = ['auto_feeder'];
    state.run.automation.fabricator = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: 'auto_feeder' };
    state.run.producers.assembly_station = { level: 0, isUnlocked: true, isBuilt: false };
    const baseCost = economy().getProducer('assembly_station')?.baseCost;
    if (typeof baseCost !== 'number') throw new Error('assembly_station has no baseCost in the embedded config');
    state.run.industrialOutput = baseCost * 3;
    return state;
}

export function buildAut040SeededSave(nowMs: number): string {
    return serializeGameStateToSaveJson(buildAut040SeededState(), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: economy().contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - 5_000),
    });
}

export async function seedAut040(driver: SessionDeviceDriver, packageName: string, activity: string, now: () => Date = () => new Date()): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    await driver.removeAppFiles(packageName, SAVE_FILE_NAMES.map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut040SeededSave(now().getTime()));
    await driver.launch(packageName, activity);
    return filesDir;
}
