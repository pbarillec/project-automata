/**
 * AUT-RBT-001 review helper: seeds a Reboot-eligible Civilization #1 save for the Reboot entry / confirmation UI capture
 * (`npm run device:seed-rbt001`, `npm run device:reveal-capture -- --scenario rbt001`).
 *
 *   force-stop -> write the seeded save -> remove stale saves AND `debug_command.json` -> relaunch.
 *
 * The state is the AUT-049 `reboot` seed (Fabricator Lv50, Assembly Lv25, no automation: nothing offline-eligible, so no offline report is
 * pending) with the Prestige Power peak raised to 1.2 x the config's first-threshold value: the projected reward stays 5 AI Cores and the
 * progress toward the 6th Core is about 45% (the 6th Core needs 1.44 x p0: (1.2 - 1) / (1.44 - 1)). Unlike the AUT-049 seed NO
 * `debug_command.json` is written: the capture drives the REAL chip / REBOOT taps. The envelope `savedAtUtc` is only a few seconds ago.
 * Requires the FactoryWorld DEBUG APK (run-as).
 */
import { GAME_SESSION_DEV_GAME_VERSION } from '../../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import { CURRENT_SAVE_VERSION, createSaveTimestampUtcIsoFromUnixMilliseconds, serializeGameStateToSaveJson } from '../../assets/scripts/persistence/index.ts';
import type { GameState } from '../../assets/scripts/state/index.ts';
import { loadGameConfigFromSources } from '../../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { DEBUG_COMMAND_FILE } from '../../assets/scripts/presentation/DebugCommandFile.ts';
import { DEBUG_ADS_FILE } from '../../assets/scripts/presentation/DebugAdsScriptFile.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';
import { buildAut049SeededState } from './seed_aut049.ts';

const economy = () => loadGameConfigFromSources(getEmbeddedEconomyConfigSources());

/** Seconds since the seeded save was written (under the 60 s offline-card minimum and with nothing automated). */
export const RBT001_SEED_AGE_SECONDS = 5;

/** The Prestige Power peak is this multiple of the config's first threshold (reward stays 5, progress about 45%). */
export const RBT001_PEAK_MULTIPLIER = 1.2;

export function buildRbt001SeededState(): GameState {
    const state = buildAut049SeededState('reboot');
    state.run.prestigePowerPeak = economy().getPrestigeConfig().p0PrestigePower * RBT001_PEAK_MULTIPLIER;
    return state;
}

export function buildRbt001SeededSave(nowMs: number): string {
    return serializeGameStateToSaveJson(buildRbt001SeededState(), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: economy().contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - RBT001_SEED_AGE_SECONDS * 1000),
    });
}

export async function seedRbt001(driver: SessionDeviceDriver, packageName: string, activity: string, now: () => Date = () => new Date()): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    // Stale saves (main / backup / temp) and any debug command from a previous capture must never leak into the seeded run.
    await driver.removeAppFiles(packageName, [...SAVE_FILE_NAMES, DEBUG_COMMAND_FILE, DEBUG_ADS_FILE].map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildRbt001SeededSave(now().getTime()));
    await driver.launch(packageName, activity);
    return filesDir;
}
