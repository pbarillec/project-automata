/**
 * AUT-049 review helper: seeds saves for the Reboot presentation capture (`npm run device:reveal-capture -- --scenario aut049`).
 *
 *   force-stop -> write a seeded save (and, for `reboot`, the DEBUG-only `debug_command.json`) -> relaunch. Variants:
 *   - `reboot` (default): a Civilization #1 run (Fabricator Lv50 / Assembly Lv25, no automation, Prestige Power at the first threshold) whose
 *     projected AI Core reward is positive, so the confirmed Reboot is eligible and no offline report is pending on launch. The DEBUG APK reads `debug_command.json` ONCE after the session is ready
 *     and submits `{ type: 'rebootCivilization', confirmed: true }` through the normal `binding.submit` path (the session's Reboot
 *     transaction: critical save, then the durable `rebootCompleted`), which starts the 4.0 s Reboot sequence. There is no player-facing
 *     Reboot trigger. The load itself must stay silent.
 *   - `post`: the state right AFTER a Reboot (Civilization #2, AI Cores owned, fresh run, no command file): the capture proves the silent
 *     load and shows the persistent relay socket / small Core.
 * Requires the FactoryWorld DEBUG APK (run-as).
 */
import { GAME_SESSION_DEV_GAME_VERSION } from '../../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import { CURRENT_SAVE_VERSION, createSaveTimestampUtcIsoFromUnixMilliseconds, serializeGameStateToSaveJson } from '../../assets/scripts/persistence/index.ts';
import { createFreshGameState, type GameState } from '../../assets/scripts/state/index.ts';
import { loadGameConfigFromSources } from '../../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { DEBUG_COMMAND_FILE } from '../../assets/scripts/presentation/DebugCommandFile.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';

const economy = () => loadGameConfigFromSources(getEmbeddedEconomyConfigSources());

export const AUT049_SEED_VARIANTS = ['reboot', 'post'] as const;
export type Aut049SeedVariant = typeof AUT049_SEED_VARIANTS[number];

export function isAut049SeedVariant(value: unknown): value is Aut049SeedVariant {
    return typeof value === 'string' && (AUT049_SEED_VARIANTS as readonly string[]).includes(value);
}

export function buildAut049SeededState(variant: Aut049SeedVariant): GameState {
    if (variant === 'post') {
        const state = createFreshGameState();
        state.meta.civilizationNumber = 2;
        state.meta.aiCores = 5;
        state.meta.lifetimeAiCoresEarned = 5;
        state.lifetime.rebootsCompleted = 1;
        state.lifetime.highestCivilizationReached = 2;
        return state;
    }
    // A Civilization #1 run with Prestige Power at the config's first-threshold value (reward > 0). Deliberately NO automation / breakthroughs:
    // an automated, offline-eligible producer leaves a pending offline report on launch, and the Reboot transaction is (correctly) blocked
    // while one is pending (its collect UI is AUT-051). The state before the Reboot is not what this capture is about; the reset is.
    const state = createFreshGameState();
    state.run.producers.fabricator = { level: 50, isUnlocked: true, isBuilt: true };
    state.run.producers.assembly_station = { level: 25, isUnlocked: true, isBuilt: true };
    state.run.industrialOutput = 1000;
    state.run.prestigePowerPeak = economy().getPrestigeConfig().p0PrestigePower;
    return state;
}

export function buildAut049SeededSave(variant: Aut049SeedVariant, nowMs: number): string {
    return serializeGameStateToSaveJson(buildAut049SeededState(variant), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: economy().contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - 5_000),
    });
}

/** Delay after the session is ready before the DEBUG command fires (the capture takes its baseline frame about 2 s after the layout). */
export const AUT049_LIVE_COMMAND_DELAY_MS = 6000;

/** The DEBUG-only command file of the live Reboot capture: the confirmed Reboot (no player-facing trigger exists). */
export function buildAut049LiveCommandFile(): string {
    return JSON.stringify({ command: { type: 'rebootCivilization', confirmed: true }, delayMs: AUT049_LIVE_COMMAND_DELAY_MS });
}

export async function seedAut049(driver: SessionDeviceDriver, packageName: string, activity: string, variant: Aut049SeedVariant, now: () => Date = () => new Date()): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    // A stale debug command from a previous capture must never fire on a plain seed.
    await driver.removeAppFiles(packageName, [...SAVE_FILE_NAMES, DEBUG_COMMAND_FILE].map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut049SeededSave(variant, now().getTime()));
    if (variant === 'reboot') await driver.writeAppFile(packageName, `${filesDir}${DEBUG_COMMAND_FILE}`, buildAut049LiveCommandFile());
    await driver.launch(packageName, activity);
    return filesDir;
}
