/**
 * AUT-055 review helper: seeds saves for the Offline Double (rewarded x2) capture
 * (`npm run device:seed-aut055 [-- --variant ready|short_ineligible|quota] [--outcome rewarded|closed|failed]`,
 * `npm run device:reveal-capture -- --scenario aut055-success|aut055-closed|aut055-failed|aut055-ineligible`).
 *
 *   force-stop -> write the seeded save (same builder as seed_aut051, savedAtUtc = now minus the absence) -> remove stale saves, debug_command.json
 *   and debug_ads.json -> write debug_ads.json (the mock ad outcome, read once by the DEBUG build) -> relaunch.
 *   - `ready` (default): 3 h away, no prior claims: the x2 action is offered.
 *   - `short_ineligible`: 20 min away (above the 60 s card minimum, below the 30 min x2 minimum): the card shows WITHOUT the x2 action.
 *   - `quota`: 3 h away with 3 claims seeded 4-6 h ago (inside the rolling 24 h window): the quota is reached, no x2 action.
 * The outcome is the scripted result of the mock ad (default `rewarded`). Requires the FactoryWorld DEBUG APK (run-as).
 */
import { OFFLINE_DOUBLE_CLAIM_KEY } from '../../assets/scripts/monetization/RewardedEligibility.ts';
import { recordRewardedClaim } from '../../assets/scripts/monetization/RewardedClaimHistory.ts';
import { GAME_SESSION_DEV_GAME_VERSION } from '../../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import { CURRENT_SAVE_VERSION, createSaveTimestampUtcIsoFromUnixMilliseconds, serializeGameStateToSaveJson } from '../../assets/scripts/persistence/index.ts';
import { loadGameConfigFromSources } from '../../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { DEBUG_COMMAND_FILE } from '../../assets/scripts/presentation/DebugCommandFile.ts';
import { DEBUG_ADS_FILE, DEBUG_ADS_OUTCOMES, type DebugAdsOutcome } from '../../assets/scripts/presentation/DebugAdsScriptFile.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';
import { buildAut051SeededState } from './seed_aut051.ts';

export const AUT055_SEED_VARIANTS = ['ready', 'short_ineligible', 'quota'] as const;
export type Aut055SeedVariant = typeof AUT055_SEED_VARIANTS[number];

/** Seconds of absence per variant (20 min: above the 60 s card minimum, below the 30 min Offline Double minimum). */
export const AUT055_ABSENCE_SECONDS: Readonly<Record<Aut055SeedVariant, number>> = Object.freeze({ ready: 3 * 3600, short_ineligible: 20 * 60, quota: 3 * 3600 });
/** Quota variant: three claims this many hours before now (inside the 24 h window, far enough in the past to tolerate a small clock skew). */
export const AUT055_QUOTA_CLAIM_AGES_HOURS: readonly number[] = Object.freeze([6, 5, 4]);

export function isAut055SeedVariant(value: unknown): value is Aut055SeedVariant {
    return typeof value === 'string' && (AUT055_SEED_VARIANTS as readonly string[]).includes(value);
}

export function isAut055Outcome(value: unknown): value is DebugAdsOutcome {
    return typeof value === 'string' && (DEBUG_ADS_OUTCOMES as readonly string[]).includes(value);
}

export function buildAut055SeededSave(variant: Aut055SeedVariant, nowMs: number): string {
    const state = buildAut051SeededState('first');
    if (variant === 'quota') {
        for (const hours of AUT055_QUOTA_CLAIM_AGES_HOURS) {
            state.monetization.rewardedClaims[OFFLINE_DOUBLE_CLAIM_KEY] = recordRewardedClaim(state, OFFLINE_DOUBLE_CLAIM_KEY, Math.floor(nowMs) - hours * 3_600_000);
        }
    }
    return serializeGameStateToSaveJson(state, {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: loadGameConfigFromSources(getEmbeddedEconomyConfigSources()).contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - AUT055_ABSENCE_SECONDS[variant] * 1000),
    });
}

/** The DEBUG ad script the seed writes: one scripted outcome for the next Offline Double ad. */
export function buildAut055AdsScriptFile(outcome: DebugAdsOutcome): string {
    return JSON.stringify({ offlineDouble: [outcome] });
}

export async function seedAut055(driver: SessionDeviceDriver, packageName: string, activity: string, variant: Aut055SeedVariant, outcome: DebugAdsOutcome = 'rewarded', now: () => Date = () => new Date()): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    // Stale saves, debug command and ads script from a previous capture must never leak into the seeded run.
    await driver.removeAppFiles(packageName, [...SAVE_FILE_NAMES, DEBUG_COMMAND_FILE, DEBUG_ADS_FILE].map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut055SeededSave(variant, now().getTime()));
    await driver.writeAppFile(packageName, `${filesDir}${DEBUG_ADS_FILE}`, buildAut055AdsScriptFile(outcome));
    await driver.launch(packageName, activity);
    return filesDir;
}
