/**
 * AUT-050 review helper: seeds a post-Reboot save for the AI Upgrades capture
 * (`npm run device:seed-aut050 [-- --variant mixed|maxed]`, `npm run device:reveal-capture -- --scenario aut050`).
 *
 *   force-stop -> write a valid post-Reboot save (Civilization #2, fresh run, AI Cores owned, some permanent ranks) -> remove stale saves and
 *   `debug_command.json` -> relaunch. The envelope `savedAtUtc` is only a few seconds ago, no producer is automated and no offline report is
 *   pending, so no offline card appears over the chip. Variants:
 *   - `mixed` (default): Optimized Fabrication rank 2, 4 AI Cores. Production: Optimized Fabrication (4 AI) and Industrial Scaling (2 AI) are
 *     affordable, Autonomous Optimization (5 AI) is insufficient; Automation: Worker Templates is locked (needs Cached Procedures rank 1), Cached
 *     Procedures is affordable; Expansion: Compact Blueprints is affordable, Era Compression is locked. (A rank-1 save cannot show an insufficient
 *     row: every available rank-1 cost is at most the 2 AI an affordable row needs, so the default uses rank 2 and 4 AI Cores.)
 *   - `maxed`: Optimized Fabrication rank 3 (a MAX row), 6 AI Cores.
 * AI Cores are otherwise only obtainable through the DEBUG `rebootCivilization` command or a seeded save until a Reboot UI task exists.
 * Requires the FactoryWorld DEBUG APK (run-as).
 */
import { GAME_SESSION_DEV_GAME_VERSION } from '../../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import { CURRENT_SAVE_VERSION, createSaveTimestampUtcIsoFromUnixMilliseconds, serializeGameStateToSaveJson } from '../../assets/scripts/persistence/index.ts';
import { createFreshGameState, type GameState } from '../../assets/scripts/state/index.ts';
import { loadGameConfigFromSources } from '../../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { DEBUG_COMMAND_FILE } from '../../assets/scripts/presentation/DebugCommandFile.ts';
import { DEBUG_ADS_FILE } from '../../assets/scripts/presentation/DebugAdsScriptFile.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';

const economy = () => loadGameConfigFromSources(getEmbeddedEconomyConfigSources());

export const AUT050_SEED_VARIANTS = ['mixed', 'maxed'] as const;
export type Aut050SeedVariant = typeof AUT050_SEED_VARIANTS[number];

/** Seconds since the seeded save was written (under the 60 s offline-card minimum and with nothing automated). */
export const AUT050_SEED_AGE_SECONDS = 5;

const VARIANT_PLAN: Readonly<Record<Aut050SeedVariant, { readonly aiCores: number; readonly ranks: Readonly<Record<string, number>> }>> = Object.freeze({
    mixed: Object.freeze({ aiCores: 4, ranks: Object.freeze({ optimized_fabrication: 2 }) }),
    maxed: Object.freeze({ aiCores: 6, ranks: Object.freeze({ optimized_fabrication: 3 }) }),
});

export function isAut050SeedVariant(value: unknown): value is Aut050SeedVariant {
    return typeof value === 'string' && (AUT050_SEED_VARIANTS as readonly string[]).includes(value);
}

/** AI Cores spent on the seeded ranks (config rank costs), so the lifetime earned counter stays consistent with the wallet. */
function spentOnRanks(ranks: Readonly<Record<string, number>>): number {
    const repository = economy();
    let spent = 0;
    for (const [id, rank] of Object.entries(ranks)) {
        const costs = repository.getPermanentUpgrade(id)?.rankCosts ?? [];
        for (let i = 0; i < rank; i += 1) spent += costs[i] ?? 0;
    }
    return spent;
}

export function buildAut050SeededState(variant: Aut050SeedVariant): GameState {
    const plan = VARIANT_PLAN[variant];
    const state = createFreshGameState();
    state.meta.civilizationNumber = 2;
    state.meta.aiCores = plan.aiCores;
    state.meta.lifetimeAiCoresEarned = plan.aiCores + spentOnRanks(plan.ranks);
    state.meta.permanentUpgradeRanks = { ...plan.ranks };
    state.lifetime.rebootsCompleted = 1;
    state.lifetime.highestCivilizationReached = 2;
    return state;
}

export function buildAut050SeededSave(variant: Aut050SeedVariant, nowMs: number): string {
    return serializeGameStateToSaveJson(buildAut050SeededState(variant), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: economy().contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - AUT050_SEED_AGE_SECONDS * 1000),
    });
}

export async function seedAut050(driver: SessionDeviceDriver, packageName: string, activity: string, variant: Aut050SeedVariant, now: () => Date = () => new Date()): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    // Stale saves (main / backup / temp) and any debug command from a previous capture must never leak into the seeded run.
    await driver.removeAppFiles(packageName, [...SAVE_FILE_NAMES, DEBUG_COMMAND_FILE, DEBUG_ADS_FILE].map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut050SeededSave(variant, now().getTime()));
    await driver.launch(packageName, activity);
    return filesDir;
}
