/**
 * AUT-067 worst-case performance baseline seed (tooling only, no gameplay / visual change):
 * `npm run device:seed-aut067 [-- --variant standard|founder]`, then `npm run device:reveal-capture -- --scenario aut067-baseline`
 * (the capture seeds by itself; the seed command only prepares the same state for manual inspection).
 *
 *   force-stop -> write the seeded save + the DEBUG benchmark override -> remove stale debug files -> relaunch.
 *
 * Benchmark state (see docs/AUT-067_PERFORMANCE_BASELINE.md):
 *   - Era III (`robotics_complex`), ALL FIVE producers built at Lv100 (top visual milestone tier: tier-100 visual state, decals, markers),
 *     every producer automated (conveyors / logistics, belts, arm, item cycles active), Auto Feeder / Worker Bot / Robotic Logistics /
 *     Factory Control System / Automated Cell Architecture / Advanced Robotics owned.
 *   - Robots Built far above the last anchor + the DEBUG override `{ maxVisible: 14, perf: true }` = the 14-robot baseline population
 *     (the AUT-041 benchmark mechanism) and the per-second `perf_second` / `perf_scene` samplers.
 *   - Free Overclock ACTIVE with its full 60 s left (Overclock VFX + HUD pill), then cooldown; the capture window starts about 10 s after launch.
 *   - HUD is the normal HUD; decals (+20 renderers) and the AI Core socket (+3) are part of the scene since AUT-066.
 *   - Variant `founder` adds the Founder pack grant (UNIT 0001 Founder robot + crest); `standard` (default) does not own it.
 * Seed-only: no new state shape. Requires the FactoryWorld DEBUG APK (run-as).
 */
import { GAME_SESSION_DEV_GAME_VERSION } from '../../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import { applyFounderPackPurchase } from '../../assets/scripts/monetization/FounderOffer.ts';
import { loadGameConfigFromSources } from '../../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { CURRENT_SAVE_VERSION, createSaveTimestampUtcIsoFromUnixMilliseconds, serializeGameStateToSaveJson } from '../../assets/scripts/persistence/index.ts';
import { DEBUG_ADS_FILE } from '../../assets/scripts/presentation/DebugAdsScriptFile.ts';
import { DEBUG_COMMAND_FILE } from '../../assets/scripts/presentation/DebugCommandFile.ts';
import { DEBUG_PURCHASE_FILE } from '../../assets/scripts/presentation/DebugPurchaseScriptFile.ts';
import { POPULATION_BENCHMARK_FILE } from '../../assets/scripts/presentation/RobotPopulation.ts';
import { createFreshGameState, type GameState } from '../../assets/scripts/state/index.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';

export const AUT067_SEED_VARIANTS = ['standard', 'founder'] as const;
export type Aut067SeedVariant = typeof AUT067_SEED_VARIANTS[number];

export function isAut067SeedVariant(value: unknown): value is Aut067SeedVariant {
    return typeof value === 'string' && (AUT067_SEED_VARIANTS as readonly string[]).includes(value);
}

/** Every producer level of the benchmark state (the top visual milestone tier). */
export const AUT067_PRODUCER_LEVEL = 100;
/** Baseline visible robot count (AUT-041 saturation, ART_DIRECTION 15.2). */
export const AUT067_VISIBLE_ROBOTS = 14;
/** Free Overclock seconds left at load (the full economy duration). */
export const AUT067_OVERCLOCK_SECONDS = 60;
export const AUT067_PRODUCER_IDS = ['fabricator', 'assembly_station', 'robot_line', 'automated_cell', 'advanced_robotics_complex'] as const;

/** The DEBUG override file: the AUT-041 population cap plus the AUT-067 per-second sampler switch. */
export function buildAut067BenchmarkOverride(): string {
    return JSON.stringify({ maxVisible: AUT067_VISIBLE_ROBOTS, perf: true });
}

export function buildAut067SeededState(variant: Aut067SeedVariant, nowMs: number): GameState {
    const state = createFreshGameState();
    state.run.purchasedBreakthroughIds = ['auto_feeder', 'worker_bot', 'robotic_logistics', 'factory_control_system', 'automated_cell_architecture', 'advanced_robotics'];
    state.run.progressionFlags['first_robot'] = true;
    state.run.currentEraId = 'robotics_complex';
    for (const id of AUT067_PRODUCER_IDS) {
        state.run.producers[id] = { level: AUT067_PRODUCER_LEVEL, isUnlocked: true, isBuilt: true };
        state.run.automation[id] = {
            isAutomated: true,
            isOfflineEligible: true,
            unlockedByBreakthroughId: id === 'fabricator' ? 'auto_feeder' : id === 'assembly_station' ? 'worker_bot' : null,
        };
    }
    state.run.robotsBuilt = 1_000_000;
    state.run.statistics.robotsBuiltPeak = 1_000_000;
    state.lifetime.robotsBuilt = 1_000_000;
    state.run.industrialOutput = 1000;
    state.boosts.activeBoosts.free_overclock = {
        boostId: 'free_overclock',
        remainingSeconds: AUT067_OVERCLOCK_SECONDS,
        cooldownSeconds: 240,
        source: 'free',
        requestId: null,
        effect: { type: 'productionMultiplier', multiplier: 2 },
        isSuspended: false,
        suspendedByBoostId: null,
    };
    if (variant === 'founder') {
        state.meta = applyFounderPackPurchase(state, { source: 'mock', grantedAtUtcMs: Math.floor(nowMs) - 60_000 }).meta;
    }
    return state;
}

export function buildAut067SeededSave(variant: Aut067SeedVariant, nowMs: number): string {
    return serializeGameStateToSaveJson(buildAut067SeededState(variant, nowMs), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: loadGameConfigFromSources(getEmbeddedEconomyConfigSources()).contentVersion,
        // Under the 60 s offline-card minimum so no Offline Factory Report card covers the scene.
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - 1_000),
    });
}

export async function seedAut067(driver: SessionDeviceDriver, packageName: string, activity: string, variant: Aut067SeedVariant = 'standard', now: () => Date = () => new Date()): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    await driver.removeAppFiles(packageName, [...SAVE_FILE_NAMES, DEBUG_COMMAND_FILE, DEBUG_ADS_FILE, DEBUG_PURCHASE_FILE, POPULATION_BENCHMARK_FILE].map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut067SeededSave(variant, now().getTime()));
    await driver.writeAppFile(packageName, `${filesDir}${POPULATION_BENCHMARK_FILE}`, buildAut067BenchmarkOverride());
    await driver.launch(packageName, activity);
    return filesDir;
}

/** The benchmark override survives a plain relaunch and would make every later capture a 14-robot benchmark run: the capture removes it when it ends. */
export async function clearAut067BenchmarkOverride(driver: SessionDeviceDriver, packageName: string): Promise<void> {
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    await driver.removeAppFiles(packageName, [`${filesDir}${POPULATION_BENCHMARK_FILE}`]);
}
