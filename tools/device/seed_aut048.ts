/**
 * AUT-048 review helper: installs nothing, only seeds a save ONE STEP BEFORE an era transition so the era title card and the optional
 * focus beat can be captured live (`npm run device:reveal-capture -- --scenario aut048`).
 *
 *   force-stop -> write a seeded save -> relaunch. Variants (states already used by earlier seeds, nothing new):
 *   - `era2`: the AUT-042 `unbuilt` state (Fabricator Lv50 / Assembly Lv25, Robotic Logistics owned, era `manual_workshop`, Robot Line NOT
 *     built, Output = 2x its construction cost). Selecting the Robot Line zone and pressing the producer panel x1 button constructs it
 *     (`producerConstructed` + `eraChanged` to `automated_factory`): the AUT-040 construction sequence, the AUT-045 environment fade (t0) and
 *     the "AUTOMATED FACTORY" title card (t0 + 0.6 s) follow. The load itself must be silent (no card, no focus).
 *   - `era3`: the AUT-044 `unbuilt` state with the NATURAL era `automated_factory` (not the AUT-044 pre-entered `robotics_complex`) and
 *     Output = 2x the cost of the Advanced Robotics breakthrough. That breakthrough enters Era III (`eraChanged` to `robotics_complex`).
 *     CAPTURE LIMIT: its Next Goal is an `era` goal and the owner deliberately has NO era-goal HUD action, and the breakthrough is not a
 *     producer-panel purchase, so no existing tap path can trigger it: the capture of this variant only proves the silent load (no card, no
 *     focus) and the sealed teaser baseline. The live Era III card is covered by unit tests only.
 * Requires the FactoryWorld DEBUG APK (run-as).
 */
import { GAME_SESSION_DEV_GAME_VERSION } from '../../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import { CURRENT_SAVE_VERSION, createSaveTimestampUtcIsoFromUnixMilliseconds, serializeGameStateToSaveJson } from '../../assets/scripts/persistence/index.ts';
import type { GameState } from '../../assets/scripts/state/index.ts';
import { loadGameConfigFromSources } from '../../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../../assets/scripts/config/EmbeddedEconomyConfig.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';
import { DEBUG_COMMAND_FILE } from '../../assets/scripts/presentation/DebugCommandFile.ts';
import { buildAut042SeededState } from './seed_aut042.ts';
import { buildAut044SeededState } from './seed_aut044.ts';

const economy = () => loadGameConfigFromSources(getEmbeddedEconomyConfigSources());

export const AUT048_SEED_VARIANTS = ['era2', 'era3'] as const;
export type Aut048SeedVariant = typeof AUT048_SEED_VARIANTS[number];

export function isAut048SeedVariant(value: unknown): value is Aut048SeedVariant {
    return typeof value === 'string' && (AUT048_SEED_VARIANTS as readonly string[]).includes(value);
}

export function buildAut048SeededState(variant: Aut048SeedVariant): GameState {
    if (variant === 'era2') return buildAut042SeededState('unbuilt');
    const state = buildAut044SeededState('unbuilt');
    // The AUT-044 seed pre-enters Era III; here the era is the natural one before the Advanced Robotics breakthrough.
    state.run.currentEraId = 'automated_factory';
    return state;
}

export function buildAut048SeededSave(variant: Aut048SeedVariant, nowMs: number): string {
    return serializeGameStateToSaveJson(buildAut048SeededState(variant), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: economy().contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - 5_000),
    });
}

export async function seedAut048(driver: SessionDeviceDriver, packageName: string, activity: string, variant: Aut048SeedVariant, now: () => Date = () => new Date()): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    // A stale debug command from a previous live capture must never fire on a plain seed.
    await driver.removeAppFiles(packageName, [...SAVE_FILE_NAMES, DEBUG_COMMAND_FILE].map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut048SeededSave(variant, now().getTime()));
    await driver.launch(packageName, activity);
    return filesDir;
}

/** Delay after the session is ready before the DEBUG command fires (the capture takes its baseline frame about 2 s after the layout). */
export const AUT048_LIVE_COMMAND_DELAY_MS = 6000;

/** The DEBUG-only command file of the live Era III capture: the normal Advanced Robotics purchase (the era goal has no HUD action by design). */
export function buildAut048LiveCommandFile(): string {
    return JSON.stringify({ command: { type: 'purchaseBreakthrough', breakthroughId: 'advanced_robotics' }, delayMs: AUT048_LIVE_COMMAND_DELAY_MS });
}

/** Era III live capture seed: the era3 save plus `debug_command.json` (read once by the DEBUG APK after the session is ready), then launch. */
export async function seedAut048Era3Live(driver: SessionDeviceDriver, packageName: string, activity: string, now: () => Date = () => new Date()): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    await driver.removeAppFiles(packageName, [...SAVE_FILE_NAMES, DEBUG_COMMAND_FILE].map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut048SeededSave('era3', now().getTime()));
    await driver.writeAppFile(packageName, `${filesDir}${DEBUG_COMMAND_FILE}`, buildAut048LiveCommandFile());
    await driver.launch(packageName, activity);
    return filesDir;
}
