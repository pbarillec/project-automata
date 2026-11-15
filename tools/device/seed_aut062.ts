/**
 * AUT-062 review helper: seeds saves for the Founder Robot / UNIT 0001 captures
 * (`npm run device:seed-aut062 [-- --variant not_owned|owned_before_first_robot|owned_many_robots|mid_session]`,
 * `npm run device:reveal-capture -- --scenario aut062-not-owned|aut062-owned-first|aut062-owned-many|aut062-mid-session|aut062-reload`).
 *
 *   force-stop -> write the seeded save -> remove stale saves, debug_command.json, debug_ads.json and debug_purchase.json -> (mid_session only: write the DEBUG
 *   mock-store script with one scripted `completed` outcome) -> relaunch.
 *   - `not_owned`: the AUT-047 factory (Fabricator Lv50 / Assembly Lv25, Worker Bot, 100 robots built = 7 visible), Founder cosmetic NOT owned: no Founder robot.
 *   - `owned_before_first_robot`: the AUT-039 seed (Worker Bot NOT bought yet, Output = its cost) with the Founder pack granted: tap Next Goal and the first
 *     Worker Bot reveal already uses the Founder variant (rank 0).
 *   - `owned_many_robots`: the AUT-047 factory (7 visible robots) with the Founder pack granted: rank 0 and one pooled robot (rank 3) are Founder robots, the rest standard.
 *   - `mid_session`: the AUT-059 `available` seed + a mock-store script that completes the purchase: tap the Founder chip and BUY, the variant swaps in place.
 * Seed-only: no new state shape (a real grant through applyFounderPackPurchase, exactly as a purchase leaves it). Requires the FactoryWorld DEBUG APK (run-as).
 */
import { GAME_SESSION_DEV_GAME_VERSION } from '../../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import { applyFounderPackPurchase } from '../../assets/scripts/monetization/FounderOffer.ts';
import { loadGameConfigFromSources } from '../../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { CURRENT_SAVE_VERSION, createSaveTimestampUtcIsoFromUnixMilliseconds, serializeGameStateToSaveJson } from '../../assets/scripts/persistence/index.ts';
import { DEBUG_ADS_FILE } from '../../assets/scripts/presentation/DebugAdsScriptFile.ts';
import { DEBUG_COMMAND_FILE } from '../../assets/scripts/presentation/DebugCommandFile.ts';
import { DEBUG_PURCHASE_FILE } from '../../assets/scripts/presentation/DebugPurchaseScriptFile.ts';
import type { GameState } from '../../assets/scripts/state/index.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';
import { buildAut039SeededState } from './scenarios/aut039_first_robot.ts';
import { buildAut047SeededState } from './seed_aut047.ts';
import { buildAut059PurchaseScriptFile, buildAut059SeededState } from './seed_aut059.ts';

export const AUT062_SEED_VARIANTS = ['not_owned', 'owned_before_first_robot', 'owned_many_robots', 'mid_session'] as const;
export type Aut062SeedVariant = typeof AUT062_SEED_VARIANTS[number];

export function isAut062SeedVariant(value: unknown): value is Aut062SeedVariant {
    return typeof value === 'string' && (AUT062_SEED_VARIANTS as readonly string[]).includes(value);
}

function withFounderGrant(state: GameState, nowMs: number): GameState {
    state.meta = applyFounderPackPurchase(state, { source: 'mock', grantedAtUtcMs: Math.floor(nowMs) - 60_000 }).meta;
    return state;
}

export function buildAut062SeededState(variant: Aut062SeedVariant, nowMs: number): GameState {
    switch (variant) {
        case 'not_owned': return buildAut047SeededState('ready');
        case 'owned_before_first_robot': return withFounderGrant(buildAut039SeededState(), nowMs);
        case 'owned_many_robots': return withFounderGrant(buildAut047SeededState('ready'), nowMs);
        case 'mid_session': return buildAut059SeededState('available', nowMs);
    }
}

export function buildAut062SeededSave(variant: Aut062SeedVariant, nowMs: number): string {
    return serializeGameStateToSaveJson(buildAut062SeededState(variant, nowMs), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: loadGameConfigFromSources(getEmbeddedEconomyConfigSources()).contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - 1_000),
    });
}

/** Only `mid_session` needs the DEBUG mock store (one scripted completed purchase); the other variants write no store script. */
export function buildAut062PurchaseScriptFile(variant: Aut062SeedVariant): string | null {
    return variant === 'mid_session' ? buildAut059PurchaseScriptFile({ outcomes: ['completed'], duplicateCallback: true }) : null;
}

export async function seedAut062(
    driver: SessionDeviceDriver,
    packageName: string,
    activity: string,
    variant: Aut062SeedVariant,
    now: () => Date = () => new Date(),
): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    await driver.removeAppFiles(packageName, [...SAVE_FILE_NAMES, DEBUG_COMMAND_FILE, DEBUG_ADS_FILE, DEBUG_PURCHASE_FILE].map((name) => `${filesDir}${name}`));
    await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildAut062SeededSave(variant, now().getTime()));
    const script = buildAut062PurchaseScriptFile(variant);
    if (script !== null) await driver.writeAppFile(packageName, `${filesDir}${DEBUG_PURCHASE_FILE}`, script);
    await driver.launch(packageName, activity);
    return filesDir;
}
