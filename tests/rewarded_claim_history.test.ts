import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
    REWARDED_CLAIM_HISTORY_CAP,
    getRewardedClaimHistory,
    recordRewardedClaim,
} from '../assets/scripts/monetization/RewardedClaimHistory.ts';
import {
    EXTENDED_OVERCLOCK_RULES,
    OFFLINE_DOUBLE_RULES,
    ROLLING_WINDOW_MS,
    evaluateExtendedOverclockEligibility,
    evaluateOfflineDoubleEligibility,
} from '../assets/scripts/monetization/RewardedEligibility.ts';
import {
    AtomicSaveRepository,
    CURRENT_SAVE_VERSION,
    InMemorySaveStorage,
    PersistenceCoordinator,
    SAVE_BACKUP_NAME,
    SAVE_MAIN_NAME,
    calculatePayloadHash,
    deserializeGameStateFromSaveJson,
    serializeGameStateToSaveJson,
} from '../assets/scripts/persistence/index.ts';
import { createFreshGameState } from '../assets/scripts/state/index.ts';
import { validateGameState } from '../assets/scripts/state/StateValidation.ts';
import { ManualTimeService } from '../assets/scripts/time/index.ts';
import { buildUi003SeededSave } from '../tools/device/seed_ui003.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const fixturesRoot = path.join(repoRoot, 'tests/fixtures/save_migrations');
const OD = 'rewarded.offline_double';
const EO = 'rewarded.extended_overclock';
const T0 = 1_787_366_400_000;
const HOUR = 3_600_000;
const metadata = { saveVersion: CURRENT_SAVE_VERSION, gameVersion: '0.1.0-test', contentVersion: 'test', savedAtUtc: '2026-11-14T08:00:00.000Z' };

function fixture(name: string): string {
    return fs.readFileSync(path.join(fixturesRoot, name), 'utf8');
}

function stateWithClaim(claim: Record<string, unknown>) {
    const state = createFreshGameState();
    (state.monetization.rewardedClaims as Record<string, unknown>)[OD] = claim;
    return state;
}

function codes(state: unknown): string[] {
    return validateGameState(state).diagnostics.map((d) => d.code);
}

test('cap is a single constant consistent with the AUT-054 rule constants', () => {
    assert.equal(REWARDED_CLAIM_HISTORY_CAP, Math.max(OFFLINE_DOUBLE_RULES.maxClaimsPerRolling24h, EXTENDED_OVERCLOCK_RULES.maxClaimsPerRolling24h));
    assert.equal(REWARDED_CLAIM_HISTORY_CAP, 3);
});

test('save version is 3 and fresh state has no claims', () => {
    assert.equal(CURRENT_SAVE_VERSION, 3);
    assert.deepEqual(createFreshGameState().monetization.rewardedClaims, {});
});

test('v2 -> v3 migration: null last claim gets empty history, known last claim gets only that timestamp', () => {
    const result = deserializeGameStateFromSaveJson(fixture('v2_rewarded_claims.json'));
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.envelope!.saveVersion, 3);
    assert.deepEqual(result.migration!.appliedMigrations.map((m) => m.id), ['v2-to-v3-rewarded-claim-history']);
    const claims = result.state!.monetization.rewardedClaims;
    // claimCount 5 is never expanded into fabricated entries.
    assert.deepEqual(claims[OD], { placementId: OD, claimCount: 5, lastClaimUtcMs: 1787366500000, recentClaimUtcMs: [1787366500000] });
    assert.deepEqual(claims[EO], { placementId: EO, claimCount: 0, lastClaimUtcMs: null, recentClaimUtcMs: [] });
    assert.equal(result.state!.run.industrialOutput, 777);
});

test('v2 -> v3 migration of an empty rewardedClaims record and non-mutation of the parsed input', () => {
    const v2 = JSON.parse(fixture('v2_rewarded_claims.json'));
    v2.payload.monetization.rewardedClaims = {};
    v2.integrity.payloadHash = calculatePayloadHash(v2.payload);
    const text = JSON.stringify(v2);
    const result = deserializeGameStateFromSaveJson(text);
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.state!.monetization.rewardedClaims, {});
    assert.equal(JSON.parse(text).saveVersion, 2);
});

test('v2 -> v3 migration is a no-op for v3 input (idempotent) and rejects forward versions', () => {
    const migrated = deserializeGameStateFromSaveJson(fixture('v2_rewarded_claims.json'));
    const again = deserializeGameStateFromSaveJson(serializeGameStateToSaveJson(migrated.state!, metadata));
    assert.equal(again.migration!.migrated, false);
    assert.deepEqual(again.state, migrated.state);
    const future = JSON.parse(fixture('v3_rewarded_claim_history.json'));
    future.saveVersion = 4;
    const result = deserializeGameStateFromSaveJson(JSON.stringify(future));
    assert.deepEqual(result.diagnostics.map((d) => d.code), ['SAVE_UNSUPPORTED_VERSION']);
});

test('v2 migration never launders a corrupted v2 integrity hash', () => {
    const v2 = JSON.parse(fixture('v2_rewarded_claims.json'));
    v2.payload.run.industrialOutput = 1;
    const result = deserializeGameStateFromSaveJson(JSON.stringify(v2));
    assert.equal(result.state, undefined);
    assert.deepEqual(result.diagnostics.map((d) => d.code), ['SAVE_PAYLOAD_HASH_MISMATCH']);
});

test('a v2 claim that already has history, or a non-object claim, fails migration', () => {
    const v2 = JSON.parse(fixture('v2_rewarded_claims.json'));
    v2.payload.monetization.rewardedClaims[OD].recentClaimUtcMs = [1];
    assert.deepEqual(deserializeGameStateFromSaveJson(JSON.stringify(v2)).diagnostics.map((d) => d.code), ['SAVE_MIGRATION_FAILED']);
    v2.payload.monetization.rewardedClaims[OD] = 5;
    assert.deepEqual(deserializeGameStateFromSaveJson(JSON.stringify(v2)).diagnostics.map((d) => d.code), ['SAVE_MIGRATION_FAILED']);
});

test('v3 fixture loads on v3 code without migration and round-trips byte-stably', () => {
    const text = fixture('v3_rewarded_claim_history.json');
    const result = deserializeGameStateFromSaveJson(text);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.migration!.migrated, false);
    const resaved = serializeGameStateToSaveJson(result.state!, { ...metadata, contentVersion: 'v1-test', savedAtUtc: '2026-11-14T08:00:00.000Z' });
    assert.deepEqual(JSON.parse(resaved), JSON.parse(text));
});

test('validation rejects malformed history', () => {
    const base = { placementId: OD, claimCount: 3, lastClaimUtcMs: 300 };
    assert.deepEqual(codes(stateWithClaim({ ...base, recentClaimUtcMs: [100, 200, 300] })), []);
    assert.deepEqual(codes(stateWithClaim(base)), ['STATE_REQUIRED_FIELD']);
    assert.deepEqual(codes(stateWithClaim({ ...base, recentClaimUtcMs: 'x' })), ['STATE_EXPECTED_ARRAY']);
    assert.deepEqual(codes(stateWithClaim({ ...base, recentClaimUtcMs: null })), ['STATE_EXPECTED_ARRAY']);
    assert.deepEqual(codes(stateWithClaim({ ...base, recentClaimUtcMs: [-1, 300] })), ['STATE_INVALID_NON_NEGATIVE_NUMBER']);
    assert.deepEqual(codes(stateWithClaim({ ...base, recentClaimUtcMs: [Number.NaN, 300] })), ['STATE_INVALID_NON_NEGATIVE_NUMBER']);
    assert.deepEqual(codes(stateWithClaim({ ...base, recentClaimUtcMs: ['1', 300] })), ['STATE_INVALID_NON_NEGATIVE_NUMBER']);
    assert.deepEqual(codes(stateWithClaim({ ...base, recentClaimUtcMs: [300, 200] })), ['STATE_CLAIM_HISTORY_NOT_ASCENDING']);
    assert.deepEqual(codes(stateWithClaim({ ...base, claimCount: 9, recentClaimUtcMs: [1, 2, 3, 300] })), ['STATE_CLAIM_HISTORY_TOO_LONG']);
    assert.deepEqual(codes(stateWithClaim({ ...base, recentClaimUtcMs: [100, 200] })), ['STATE_CLAIM_HISTORY_LAST_MISMATCH']);
    assert.deepEqual(codes(stateWithClaim({ ...base, claimCount: 1, recentClaimUtcMs: [200, 300] })), ['STATE_CLAIM_HISTORY_EXCEEDS_COUNT']);
    assert.deepEqual(codes(stateWithClaim({ ...base, lastClaimUtcMs: null, claimCount: 0, recentClaimUtcMs: [5] })), ['STATE_CLAIM_HISTORY_EXCEEDS_COUNT', 'STATE_CLAIM_HISTORY_LAST_MISMATCH']);
    assert.deepEqual(codes(stateWithClaim({ ...base, extra: 1, recentClaimUtcMs: [300] })), ['STATE_UNKNOWN_FIELD']);
});

test('recordRewardedClaim: first claim, count, immutability and ordering', () => {
    const state = createFreshGameState();
    const first = recordRewardedClaim(state, OD, T0);
    assert.deepEqual(first, { placementId: OD, claimCount: 1, lastClaimUtcMs: T0, recentClaimUtcMs: [T0] });
    assert.deepEqual(state.monetization.rewardedClaims, {}, 'input state is not mutated');
    state.monetization.rewardedClaims[OD] = first;
    const second = recordRewardedClaim(state, OD, T0 + HOUR);
    assert.deepEqual(second.recentClaimUtcMs, [T0, T0 + HOUR]);
    assert.equal(second.claimCount, 2);
    assert.equal(second.lastClaimUtcMs, T0 + HOUR);
    assert.deepEqual(first.recentClaimUtcMs, [T0]);
    assert.deepEqual(codes(stateWithClaim(second)), []);
});

test('recordRewardedClaim: window boundary is exactly 24 h and the cap keeps the newest 3', () => {
    const state = createFreshGameState();
    state.monetization.rewardedClaims[OD] = { placementId: OD, claimCount: 3, lastClaimUtcMs: T0 + 2 * HOUR, recentClaimUtcMs: [T0, T0 + HOUR, T0 + 2 * HOUR] };
    const atBoundary = recordRewardedClaim(state, OD, T0 + ROLLING_WINDOW_MS);
    assert.deepEqual(atBoundary.recentClaimUtcMs, [T0 + HOUR, T0 + 2 * HOUR, T0 + ROLLING_WINDOW_MS], 'claim exactly 24 h old is dropped');
    const justInside = recordRewardedClaim(state, OD, T0 + ROLLING_WINDOW_MS - 1);
    assert.equal(justInside.recentClaimUtcMs.length, REWARDED_CLAIM_HISTORY_CAP, 'capped at 3');
    assert.deepEqual(justInside.recentClaimUtcMs, [T0 + HOUR, T0 + 2 * HOUR, T0 + ROLLING_WINDOW_MS - 1]);
    assert.equal(justInside.claimCount, 4);
    const allExpired = recordRewardedClaim(state, OD, T0 + 3 * ROLLING_WINDOW_MS);
    assert.deepEqual(allExpired.recentClaimUtcMs, [T0 + 3 * ROLLING_WINDOW_MS]);
    assert.equal(allExpired.claimCount, 4, 'claimCount is lifetime and keeps counting');
});

test('recordRewardedClaim: clock regression keeps ascending order and lastClaimUtcMs consistent; bad time throws', () => {
    const state = createFreshGameState();
    state.monetization.rewardedClaims[OD] = { placementId: OD, claimCount: 1, lastClaimUtcMs: T0 + HOUR, recentClaimUtcMs: [T0 + HOUR] };
    const regressed = recordRewardedClaim(state, OD, T0);
    assert.deepEqual(regressed.recentClaimUtcMs, [T0, T0 + HOUR]);
    assert.equal(regressed.lastClaimUtcMs, T0 + HOUR);
    assert.deepEqual(codes(stateWithClaim(regressed)), []);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
        assert.throws(() => recordRewardedClaim(state, OD, bad), RangeError);
    }
});

test('getRewardedClaimHistory returns a copy and [] for unknown placements', () => {
    const state = createFreshGameState();
    assert.deepEqual(getRewardedClaimHistory(state, OD), []);
    state.monetization.rewardedClaims[OD] = recordRewardedClaim(state, OD, T0);
    const copy = getRewardedClaimHistory(state, OD);
    copy.push(1);
    assert.deepEqual(getRewardedClaimHistory(state, OD), [T0]);
});

test('RewardedEligibility integration: quota reached after 3 recorded claims and frees after 24 h', () => {
    const state = createFreshGameState();
    const claimAt = (t: number) => { state.monetization.rewardedClaims[OD] = recordRewardedClaim(state, OD, t); };
    const evaluate = (now: number) => evaluateOfflineDoubleEligibility({
        nowUtcMs: now,
        hasCollectibleReport: true,
        effectiveOfflineSeconds: 7200,
        claimTimestampsUtcMs: getRewardedClaimHistory(state, OD),
    });
    claimAt(T0);
    claimAt(T0 + HOUR);
    assert.equal(evaluate(T0 + 2 * HOUR).eligible, true);
    claimAt(T0 + 2 * HOUR);
    const blocked = evaluate(T0 + 3 * HOUR);
    assert.equal(blocked.eligible, false);
    assert.equal(blocked.reason, 'quota_reached');
    assert.equal(blocked.claimsInWindow, 3);
    assert.equal(blocked.nextEligibleAtUtc, T0 + ROLLING_WINDOW_MS);
    assert.equal(evaluate(T0 + ROLLING_WINDOW_MS - 1).eligible, false);
    assert.equal(evaluate(T0 + ROLLING_WINDOW_MS).eligible, true);

    const overclock = evaluateExtendedOverclockEligibility({ nowUtcMs: T0 + 30 * 60_000, claimTimestampsUtcMs: [T0] });
    assert.equal(overclock.reason, 'min_interval', 'the migrated single last timestamp still enforces the interval');
});

test('persistence coordinator with fake storage: record, save, load round trip at v3', async () => {
    const storage = new InMemorySaveStorage({});
    const clock = new ManualTimeService({ utcIso: '2026-11-14T08:00:00.000Z', monotonicSeconds: 0 });
    const coordinator = new PersistenceCoordinator({
        repository: new AtomicSaveRepository(storage),
        timeService: clock,
        gameVersion: '0.1.0-test',
        contentVersion: 'test',
    });
    const state = createFreshGameState();
    state.monetization.rewardedClaims[OD] = recordRewardedClaim(state, OD, T0);
    state.monetization.rewardedClaims[OD] = recordRewardedClaim(state, OD, T0 + HOUR);
    const saved = await coordinator.requestSave(state, { intent: 'critical', reason: 'manual', markDirty: true });
    assert.equal(saved.status, 'saved');
    assert.equal(JSON.parse(storage.getFile(SAVE_MAIN_NAME)!).saveVersion, 3);
    const loaded = await coordinator.load();
    assert.equal(loaded.ok, true);
    assert.equal(loaded.status, 'loaded_main');
    assert.deepEqual(getRewardedClaimHistory(loaded.state!, OD), [T0, T0 + HOUR]);
    assert.deepEqual(loaded.state!.monetization.rewardedClaims[OD], state.monetization.rewardedClaims[OD]);
});

test('corrupted history in main (valid hash) is rejected and backup recovery is used; v2 main migrates', async () => {
    const good = fixture('v3_rewarded_claim_history.json');
    const bad = JSON.parse(good);
    bad.payload.monetization.rewardedClaims[OD].recentClaimUtcMs = [1787366500000, 5];
    bad.integrity.payloadHash = calculatePayloadHash(bad.payload);
    const recovered = await new AtomicSaveRepository(new InMemorySaveStorage({
        [SAVE_MAIN_NAME]: JSON.stringify(bad),
        [SAVE_BACKUP_NAME]: good,
    })).load();
    assert.equal(recovered.ok, true);
    assert.equal(recovered.status, 'recovered_backup');
    assert.deepEqual(getRewardedClaimHistory(recovered.state!, OD), [1787366500000]);

    const noBackup = await new AtomicSaveRepository(new InMemorySaveStorage({ [SAVE_MAIN_NAME]: JSON.stringify(bad) })).load();
    assert.equal(noBackup.status, 'fresh_started', 'invalid history is never silently accepted');
    assert.deepEqual(noBackup.state!.monetization.rewardedClaims, {});

    const v2Main = fixture('v2_rewarded_claims.json');
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: v2Main });
    const loaded = await new AtomicSaveRepository(storage).load();
    assert.equal(loaded.status, 'loaded_main');
    assert.equal(storage.getFile(SAVE_MAIN_NAME), v2Main, 'load does not rewrite main');
    assert.deepEqual(getRewardedClaimHistory(loaded.state!, OD), [1787366500000]);
});

test('a v2 device seed (previously installed build) still loads via migration', () => {
    const v3 = JSON.parse(buildUi003SeededSave(Date.now()));
    assert.equal(v3.saveVersion, CURRENT_SAVE_VERSION);
    const v2 = JSON.parse(JSON.stringify(v3));
    v2.saveVersion = 2;
    v2.integrity = { algorithm: v2.integrity.algorithm, payloadHash: calculatePayloadHash(v2.payload) };
    const result = deserializeGameStateFromSaveJson(JSON.stringify(v2));
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.envelope!.saveVersion, 3);
    assert.deepEqual(result.state, deserializeGameStateFromSaveJson(JSON.stringify(v3)).state);
});
