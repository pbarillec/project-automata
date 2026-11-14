/**
 * AUT-056 review helper: seeds saves for the Extended Overclock (rewarded x2 for 10 active minutes, MOCK ad) capture
 * (`npm run device:seed-aut056 [-- --variant eligible|free_active|quota|interval|resume] [--outcome rewarded|closed|failed]`,
 * `npm run device:reveal-capture -- --scenario aut056-success|aut056-free-active|aut056-resume|aut056-closed|aut056-failed|aut056-quota|aut056-interval`).
 *
 *   force-stop -> write the seeded save (the AUT-047 / AUT-UI-003 factory: Fabricator Lv50 / Assembly Lv25, Auto Feeder + Worker Bot, so Free
 *   Overclock is unlocked, 5000 IO) -> remove stale saves, debug_command.json and debug_ads.json -> write debug_ads.json (the mock ad outcome,
 *   read once by the DEBUG build) -> relaunch.
 *   - `eligible` (default): no claims, Free Overclock READY: the chip is offered.
 *   - `free_active`: Free Overclock ACTIVE with 30 s left: a granted ad suspends it (remaining frozen) and starts Extended; effective x2, never x4.
 *   - `quota`: 3 claims 2 h / 3 h / 4 h ago (inside the rolling 24 h window): quota reached, no chip.
 *   - `interval`: 1 claim 20 min ago (below the 60 min minimum interval): no chip.
 *   - `resume`: Extended 15 s left + Free Overclock suspended by it with 30 s left, so expiry -> Free resumes -> Free expires -> cooldown all fit a
 *     60-75 s capture (the full 600 s span is covered by the unit tests).
 * Seed-only: no new state shape. Requires the FactoryWorld DEBUG APK (run-as).
 */
import { EXTENDED_OVERCLOCK_CLAIM_KEY } from '../../assets/scripts/monetization/RewardedEligibility.ts';
import { recordRewardedClaim } from '../../assets/scripts/monetization/RewardedClaimHistory.ts';
import { GAME_SESSION_DEV_GAME_VERSION } from '../../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import { CURRENT_SAVE_VERSION, createSaveTimestampUtcIsoFromUnixMilliseconds, serializeGameStateToSaveJson } from '../../assets/scripts/persistence/index.ts';
import { loadGameConfigFromSources } from '../../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { EXTENDED_OVERCLOCK_BOOST_ID, EXTENDED_OVERCLOCK_MULTIPLIER, EXTENDED_OVERCLOCK_SOURCE } from '../../assets/scripts/progression/TemporaryBoosts.ts';
import { DEBUG_COMMAND_FILE } from '../../assets/scripts/presentation/DebugCommandFile.ts';
import { DEBUG_ADS_FILE, DEBUG_ADS_OUTCOMES, type DebugAdsOutcome } from '../../assets/scripts/presentation/DebugAdsScriptFile.ts';
import type { GameState } from '../../assets/scripts/state/index.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';
import { buildAut047SeededState } from './seed_aut047.ts';

export const AUT056_SEED_VARIANTS = ['eligible', 'free_active', 'quota', 'interval', 'resume'] as const;
export type Aut056SeedVariant = typeof AUT056_SEED_VARIANTS[number];

export const AUT056_FREE_ACTIVE_REMAINING_SECONDS = 30;
export const AUT056_RESUME_EXTENDED_REMAINING_SECONDS = 15;
export const AUT056_RESUME_FREE_REMAINING_SECONDS = 30;
/** Quota variant: three claims this many hours before now (inside the 24 h window; the newest is also past the 60 min interval). */
export const AUT056_QUOTA_CLAIM_AGES_HOURS: readonly number[] = Object.freeze([4, 3, 2]);
/** Interval variant: one claim this many minutes before now (below the 60 min minimum interval). */
export const AUT056_INTERVAL_CLAIM_AGE_MINUTES = 20;

export function isAut056SeedVariant(value: unknown): value is Aut056SeedVariant {
    return typeof value === 'string' && (AUT056_SEED_VARIANTS as readonly string[]).includes(value);
}

export function isAut056Outcome(value: unknown): value is DebugAdsOutcome {
    return typeof value === 'string' && (DEBUG_ADS_OUTCOMES as readonly string[]).includes(value);
}

export function buildAut056SeededState(variant: Aut056SeedVariant, nowMs: number): GameState {
    const state = buildAut047SeededState('ready');
    const now = Math.floor(nowMs);
    if (variant === 'free_active') {
        state.boosts.activeBoosts.free_overclock = {
            boostId: 'free_overclock',
            remainingSeconds: AUT056_FREE_ACTIVE_REMAINING_SECONDS,
            cooldownSeconds: 240,
            source: 'free',
            requestId: null,
            effect: { type: 'productionMultiplier', multiplier: 2 },
            isSuspended: false,
            suspendedByBoostId: null,
        };
    }
    if (variant === 'quota') {
        for (const hours of AUT056_QUOTA_CLAIM_AGES_HOURS) {
            state.monetization.rewardedClaims[EXTENDED_OVERCLOCK_CLAIM_KEY] = recordRewardedClaim(state, EXTENDED_OVERCLOCK_CLAIM_KEY, now - hours * 3_600_000);
        }
    }
    if (variant === 'interval') {
        state.monetization.rewardedClaims[EXTENDED_OVERCLOCK_CLAIM_KEY] = recordRewardedClaim(state, EXTENDED_OVERCLOCK_CLAIM_KEY, now - AUT056_INTERVAL_CLAIM_AGE_MINUTES * 60_000);
    }
    if (variant === 'resume') {
        state.boosts.activeBoosts.free_overclock = {
            boostId: 'free_overclock',
            remainingSeconds: AUT056_RESUME_FREE_REMAINING_SECONDS,
            cooldownSeconds: 240,
            source: 'free',
            requestId: null,
            effect: { type: 'productionMultiplier', multiplier: 2 },
            isSuspended: true,
            suspendedByBoostId: EXTENDED_OVERCLOCK_BOOST_ID,
        };
        state.boosts.activeBoosts[EXTENDED_OVERCLOCK_BOOST_ID] = {
            boostId: EXTENDED_OVERCLOCK_BOOST_ID,
            remainingSeconds: AUT056_RESUME_EXTENDED_REMAINING_SECONDS,
            cooldownSeconds: 0,
            source: EXTENDED_OVERCLOCK_SOURCE,
            requestId: 'aut056_seed',
            effect: { type: 'productionMultiplier', multiplier: EXTENDED_OVERCLOCK_MULTIPLIER },
            isSuspended: false,
            suspendedByBoostId: null,
        };
        state.monetization.rewardedClaims[EXTENDED_OVERCLOCK_CLAIM_KEY] = recordRewardedClaim(state, EXTENDED_OVERCLOCK_CLAIM_KEY, now - 10 * 60_000);
    }
    return state;
}

export function buildAut056SeededSave(variant: Aut056SeedVariant, nowMs: number): string {
    return serializeGameStateToSaveJson(buildAut056SeededState(variant, nowMs), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: loadGameConfigFromSources(getEmbeddedEconomyConfigSources()).contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - 1_000),
    });
}

/** The DEBUG ad script the seed writes: one scripted outcome for the next Extended Overclock ad. */
export function buildAut056AdsScriptFile(outcome: DebugAdsOutcome): string {
    return JSON.stringify({ extendedOverclock: [outcome] });
}

export async function seedAut056(driver: SessionDeviceDriver, packageName: string, activity: string, variant: Aut056SeedVariant, outcome: DebugAdsOutcome = 'rewarded', now: () => Date = () => new Date()): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    // Stale saves, debug command and ads script from a previous capture must never leak into the seeded run.
    await driver.removeAppFiles(packageName, [...SAVE_FILE_NAMES, DEBUG_COMMAND_FILE, DEBUG_ADS_FILE].map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut056SeededSave(variant, now().getTime()));
    await driver.writeAppFile(packageName, `${filesDir}${DEBUG_ADS_FILE}`, buildAut056AdsScriptFile(outcome));
    await driver.launch(packageName, activity);
    return filesDir;
}
