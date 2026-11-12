/**
 * AUT-045 review helper: installs nothing, only seeds a save so the era environment can be screenshotted per era.
 *
 *   force-stop -> write a seeded save -> relaunch. Variants (states already used by the earlier seeds, nothing new):
 *   - `workshop`: the AUT-042 `unbuilt` state (Fabricator Lv50 / Assembly Lv25, Robot Line not built) in era `manual_workshop`:
 *     no hall, no vertical group, no teaser (also the look after a Reboot).
 *   - `era2`: the AUT-042 `lv10` state (Robot Line Lv10 built) in era `automated_factory`: the hall is visible, no vertical group, no teaser.
 *   - `era3`: the AUT-044 `lv10` state (Advanced Robotics Complex built) in era `robotics_complex`: hall recoloured, vertical group and teaser visible.
 * A save load snaps to the era (no fade). The live Era II change (building the Robot Line from the producer panel, not a
 * Next Goal action) and the live Era III change (an `era` goal with no HUD action) are NOT triggered by this helper.
 * Requires the FactoryWorld DEBUG APK (run-as).
 */
import { GAME_SESSION_DEV_GAME_VERSION } from '../../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import { CURRENT_SAVE_VERSION, createSaveTimestampUtcIsoFromUnixMilliseconds, serializeGameStateToSaveJson } from '../../assets/scripts/persistence/index.ts';
import type { GameState } from '../../assets/scripts/state/index.ts';
import { loadGameConfigFromSources } from '../../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../../assets/scripts/config/EmbeddedEconomyConfig.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';
import { buildAut042SeededState } from './seed_aut042.ts';
import { buildAut044SeededState } from './seed_aut044.ts';

const economy = () => loadGameConfigFromSources(getEmbeddedEconomyConfigSources());

export const AUT045_SEED_VARIANTS = ['workshop', 'era2', 'era3'] as const;
export type Aut045SeedVariant = typeof AUT045_SEED_VARIANTS[number];

export function isAut045SeedVariant(value: unknown): value is Aut045SeedVariant {
    return typeof value === 'string' && (AUT045_SEED_VARIANTS as readonly string[]).includes(value);
}

export function buildAut045SeededState(variant: Aut045SeedVariant): GameState {
    if (variant === 'workshop') return buildAut042SeededState('unbuilt');
    if (variant === 'era2') return buildAut042SeededState('lv10');
    return buildAut044SeededState('lv10');
}

export function buildAut045SeededSave(variant: Aut045SeedVariant, nowMs: number): string {
    return serializeGameStateToSaveJson(buildAut045SeededState(variant), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: economy().contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - 5_000),
    });
}

export async function seedAut045(driver: SessionDeviceDriver, packageName: string, activity: string, variant: Aut045SeedVariant, now: () => Date = () => new Date()): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    await driver.removeAppFiles(packageName, SAVE_FILE_NAMES.map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut045SeededSave(variant, now().getTime()));
    await driver.launch(packageName, activity);
    return filesDir;
}
