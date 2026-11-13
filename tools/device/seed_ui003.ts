/**
 * AUT-UI-003 review helper: seeds a save with Free Overclock READY so the HUD Overclock action can be tapped on the phone.
 *
 *   force-stop -> write a seeded save -> relaunch.
 *
 * The state is the AUT-047 `ready` factory (Fabricator Lv50 / Assembly Lv25, Auto Feeder + Worker Bot, 100 robots, no boost, no
 * cooldown). Free Overclock is unlocked by `isFreeOverclockUnlocked` (HudViewModel `locked` rule) in that state; the unit test
 * asserts `freeOverclock.state === 'ready'` and `canActivate`. Seed-only: no new state shape. Requires the FactoryWorld DEBUG APK (run-as).
 */
import { GAME_SESSION_DEV_GAME_VERSION } from '../../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import { CURRENT_SAVE_VERSION, createSaveTimestampUtcIsoFromUnixMilliseconds, serializeGameStateToSaveJson } from '../../assets/scripts/persistence/index.ts';
import type { GameState } from '../../assets/scripts/state/index.ts';
import { loadGameConfigFromSources } from '../../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../../assets/scripts/config/EmbeddedEconomyConfig.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';
import { buildAut047SeededState } from './seed_aut047.ts';

const economy = () => loadGameConfigFromSources(getEmbeddedEconomyConfigSources());

export function buildUi003SeededState(): GameState {
    return buildAut047SeededState('ready');
}

export function buildUi003SeededSave(nowMs: number): string {
    return serializeGameStateToSaveJson(buildUi003SeededState(), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: economy().contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - 1_000),
    });
}

export async function seedUi003(driver: SessionDeviceDriver, packageName: string, activity: string, now: () => Date = () => new Date()): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    await driver.removeAppFiles(packageName, SAVE_FILE_NAMES.map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildUi003SeededSave(now().getTime()));
    await driver.launch(packageName, activity);
    return filesDir;
}
