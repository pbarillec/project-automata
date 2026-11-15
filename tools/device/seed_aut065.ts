/**
 * AUT-065 review helper: seeds a save + the per-launch `debug_consent.json` so the DEBUG build runs a scripted consent state
 * (`npm run device:seed-aut065 [-- --variant not_required|required_obtained|required_declined|error|timeout|privacy_row|no_privacy_row|ump_eea]`,
 * `npm run device:reveal-capture -- --scenario aut065-not-required|aut065-required-obtained|aut065-required-declined|aut065-error|aut065-timeout|aut065-privacy-row|aut065-no-privacy-row|aut065-ump-eea`).
 *
 *   force-stop -> write the seeded save -> remove stale saves, debug_command.json, debug_ads.json and debug_consent.json -> write debug_consent.json -> relaunch.
 *   - not_required / required_obtained / required_declined / error / timeout: the AUT-055 `ready` save (3 h away: the Offline Factory Report card shows and the x2 action
 *     is offered ONLY when ads may be requested), consent = the MOCK transport state of the same name under the real ConsentCoordinator.
 *   - privacy_row: the AUT-052 save (no offline card, so the Settings chip is reachable) + consent `required_obtained`: Settings shows the Privacy options row; the drive taps it.
 *   - no_privacy_row: the same save + consent `not_required`: Settings shows NO Privacy options row.
 *   - ump_eea: the AUT-055 `ready` save + `{"provider":"ump_test","geography":"eea"}` = the REAL Google UMP form with debug geography EEA (needs network and a UMP
 *     message published for the sample AdMob app; without them the capture reports ENVIRONMENT_BLOCKED, never a false PASS).
 * Requires the FactoryWorld DEBUG APK (run-as).
 */
import { DEBUG_ADS_FILE } from '../../assets/scripts/presentation/DebugAdsScriptFile.ts';
import { DEBUG_COMMAND_FILE } from '../../assets/scripts/presentation/DebugCommandFile.ts';
import { DEBUG_CONSENT_FILE, DEBUG_CONSENT_PROVIDER_UMP_TEST } from '../../assets/scripts/presentation/DebugConsentScriptFile.ts';
import { SETTINGS_FILE, SETTINGS_TEMP_FILE } from '../../assets/scripts/settings/SettingsStore.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';
import { buildAut052SeededSave } from './seed_aut052.ts';
import { buildAut055SeededSave } from './seed_aut055.ts';

export const AUT065_SEED_VARIANTS = ['not_required', 'required_obtained', 'required_declined', 'error', 'timeout', 'privacy_row', 'no_privacy_row', 'ump_eea'] as const;
export type Aut065SeedVariant = typeof AUT065_SEED_VARIANTS[number];

export function isAut065SeedVariant(value: unknown): value is Aut065SeedVariant {
    return typeof value === 'string' && (AUT065_SEED_VARIANTS as readonly string[]).includes(value);
}

/** The DEBUG consent script the seed writes for a variant (the mock state, or the real UMP provider with debug geography EEA). */
export function buildAut065ConsentScriptFile(variant: Aut065SeedVariant): string {
    if (variant === 'ump_eea') return JSON.stringify({ provider: DEBUG_CONSENT_PROVIDER_UMP_TEST, geography: 'eea' });
    if (variant === 'privacy_row') return JSON.stringify({ state: 'required_obtained', privacyOptions: true });
    if (variant === 'no_privacy_row') return JSON.stringify({ state: 'not_required', privacyOptions: false });
    return JSON.stringify({ state: variant });
}

/** The two Settings variants use the AUT-052 save (no offline card); every other variant uses the AUT-055 `ready` save (the x2 action depends on consent). */
export function buildAut065SeededSave(variant: Aut065SeedVariant, nowMs: number): string {
    return variant === 'privacy_row' || variant === 'no_privacy_row' ? buildAut052SeededSave(nowMs) : buildAut055SeededSave('ready', nowMs);
}

export async function seedAut065(driver: SessionDeviceDriver, packageName: string, activity: string, variant: Aut065SeedVariant, now: () => Date = () => new Date()): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    await driver.removeAppFiles(packageName, [...SAVE_FILE_NAMES, DEBUG_COMMAND_FILE, DEBUG_ADS_FILE, DEBUG_CONSENT_FILE, SETTINGS_FILE, SETTINGS_TEMP_FILE].map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut065SeededSave(variant, now().getTime()));
    await driver.writeAppFile(packageName, `${filesDir}${DEBUG_CONSENT_FILE}`, buildAut065ConsentScriptFile(variant));
    await driver.launch(packageName, activity);
    return filesDir;
}
