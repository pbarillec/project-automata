/**
 * AUT-052 review helper: seeds a post-Reboot save (Civilization #2, AI Cores) so BOTH entry chips (Settings, left; AI Upgrades, right) are
 * visible on launch, and removes any previous `settings.json` so the run starts from the defaults
 * (`npm run device:seed-aut052`, `npm run device:reveal-capture -- --scenario aut052`).
 *
 *   force-stop -> write the AUT-050 `mixed` post-Reboot save (envelope `savedAtUtc` 5 s old, so no offline card) -> remove stale saves,
 *   `debug_command.json`, `settings.json` and `settings_temp.json` -> relaunch.
 * Requires the FactoryWorld DEBUG APK (run-as).
 */
import { DEBUG_COMMAND_FILE } from '../../assets/scripts/presentation/DebugCommandFile.ts';
import { SETTINGS_FILE, SETTINGS_TEMP_FILE } from '../../assets/scripts/settings/SettingsStore.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { buildAut050SeededSave } from './seed_aut050.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';

export const AUT052_SEED_AGE_SECONDS = 5;

export function buildAut052SeededSave(nowMs: number): string {
    return buildAut050SeededSave('mixed', nowMs);
}

export async function seedAut052(driver: SessionDeviceDriver, packageName: string, activity: string, now: () => Date = () => new Date()): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    await driver.removeAppFiles(packageName, [...SAVE_FILE_NAMES, DEBUG_COMMAND_FILE, SETTINGS_FILE, SETTINGS_TEMP_FILE].map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut052SeededSave(now().getTime()));
    await driver.launch(packageName, activity);
    return filesDir;
}
