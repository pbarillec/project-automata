/**
 * AUT-047 review helper: installs nothing, only seeds a save so the Overclock presentation can be reviewed on the phone.
 *
 *   force-stop -> write a seeded save -> relaunch. Variants:
 *   - `active` (default): Fabricator Lv50 / Assembly Lv25 (+ Auto Feeder, Worker Bot, robots), Free Overclock ACTIVE with
 *     AUT047_ACTIVE_REMAINING_SECONDS left. The load itself is silent (no activation impulse) but shows the sustained look (belt / arm /
 *     Worker Bot ~1.3x, low-rate amber sparks on the Assembly Station and the Fabricator, amber HUD pill with x2 and the countdown), then
 *     the expiry ease-out (about 0.6 s) and the cooldown pill when the countdown ends.
 *   - `ready`: the same factory with Free Overclock READY (no boost, no cooldown). The HUD has no Overclock action yet (button behaviour is
 *     out of AUT-047 scope), so the activation impulse is only exercised by the unit tests; this variant shows the READY baseline.
 * Seed-only: no new state shape. Requires the FactoryWorld DEBUG APK (run-as).
 */
import { GAME_SESSION_DEV_GAME_VERSION } from '../../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import { CURRENT_SAVE_VERSION, createSaveTimestampUtcIsoFromUnixMilliseconds, serializeGameStateToSaveJson } from '../../assets/scripts/persistence/index.ts';
import { createFreshGameState, type GameState } from '../../assets/scripts/state/index.ts';
import { loadGameConfigFromSources } from '../../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../../assets/scripts/config/EmbeddedEconomyConfig.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';

const economy = () => loadGameConfigFromSources(getEmbeddedEconomyConfigSources());

export const AUT047_SEED_VARIANTS = ['active', 'ready'] as const;
export type Aut047SeedVariant = typeof AUT047_SEED_VARIANTS[number];

/** Seconds of boost left at load (the economy duration is 60 s; this only shortens the review so the expiry is reached quickly). */
export const AUT047_ACTIVE_REMAINING_SECONDS = 22;

export function isAut047SeedVariant(value: unknown): value is Aut047SeedVariant {
    return typeof value === 'string' && (AUT047_SEED_VARIANTS as readonly string[]).includes(value);
}

export function buildAut047SeededState(variant: Aut047SeedVariant = 'active'): GameState {
    const state = createFreshGameState();
    state.run.purchasedBreakthroughIds = ['auto_feeder', 'worker_bot'];
    state.run.progressionFlags['first_robot'] = true;
    state.run.producers.fabricator = { level: 50, isUnlocked: true, isBuilt: true };
    state.run.producers.assembly_station = { level: 25, isUnlocked: true, isBuilt: true };
    state.run.automation.fabricator = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: 'auto_feeder' };
    state.run.automation.assembly_station = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: 'worker_bot' };
    state.run.robotsBuilt = 100;
    state.run.industrialOutput = 5000;
    if (variant === 'active') {
        state.boosts.activeBoosts.free_overclock = {
            boostId: 'free_overclock',
            remainingSeconds: AUT047_ACTIVE_REMAINING_SECONDS,
            cooldownSeconds: 240,
            source: 'free',
            requestId: null,
            effect: { type: 'productionMultiplier', multiplier: 2 },
            isSuspended: false,
            suspendedByBoostId: null,
        };
    }
    return state;
}

export function buildAut047SeededSave(variant: Aut047SeedVariant, nowMs: number): string {
    return serializeGameStateToSaveJson(buildAut047SeededState(variant), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: economy().contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - 1_000),
    });
}

export async function seedAut047(driver: SessionDeviceDriver, packageName: string, activity: string, variant: Aut047SeedVariant, now: () => Date = () => new Date()): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    await driver.removeAppFiles(packageName, SAVE_FILE_NAMES.map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut047SeededSave(variant, now().getTime()));
    await driver.launch(packageName, activity);
    return filesDir;
}
