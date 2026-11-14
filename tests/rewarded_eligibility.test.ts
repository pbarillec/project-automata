const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const modulePath = path.resolve(path.dirname(__filename), '../assets/scripts/monetization/RewardedEligibility.ts');
const mod = () => import(pathToFileURL(modulePath).href);

const MIN = 60_000;
const H = 60 * MIN;
const NOW = 1_800_000_000_000;

const offline = (m, over) => m.evaluateOfflineDoubleEligibility({
    nowUtcMs: NOW, hasCollectibleReport: true, effectiveOfflineSeconds: 1800, claimTimestampsUtcMs: [], ...over,
});

test('offline double minimum boundary 29:59 / 30:00', async () => {
    const m = await mod();
    const below = offline(m, { effectiveOfflineSeconds: 1799 });
    assert.equal(below.eligible, false);
    assert.equal(below.reason, 'below_min_offline');
    assert.equal(below.nextEligibleAtUtc, null);
    const ok = offline(m, { effectiveOfflineSeconds: 1800 });
    assert.equal(ok.eligible, true);
    assert.equal(ok.reason, 'ok');
    assert.equal(ok.remainingQuota, 3);
    assert.equal(ok.claimsInWindow, 0);
});

test('offline double needs a collectible report; undefined history is empty', async () => {
    const m = await mod();
    assert.equal(offline(m, { hasCollectibleReport: false }).reason, 'no_offline_report');
    assert.equal(offline(m, { effectiveOfflineSeconds: undefined }).reason, 'no_offline_report');
    assert.equal(offline(m, { claimTimestampsUtcMs: undefined }).eligible, true);
    assert.equal(offline(m, { claimTimestampsUtcMs: null }).claimsInWindow, 0);
});

test('offline double quota reached with next eligible time', async () => {
    const m = await mod();
    const claims = [NOW - 5 * H, NOW - 20 * H, NOW - 1 * H];
    const r = offline(m, { claimTimestampsUtcMs: claims });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, 'quota_reached');
    assert.equal(r.remainingQuota, 0);
    assert.equal(r.claimsInWindow, 3);
    assert.equal(r.nextEligibleAtUtc, NOW - 20 * H + 24 * H);
    const two = offline(m, { claimTimestampsUtcMs: claims.slice(0, 2) });
    assert.equal(two.eligible, true);
    assert.equal(two.remainingQuota, 1);
});

test('quota pruning boundary: exactly 24h outside, just inside counts', async () => {
    const m = await mod();
    assert.deepEqual(m.pruneClaimsToRollingWindow([NOW - 24 * H], NOW), []);
    assert.deepEqual(m.pruneClaimsToRollingWindow([NOW - 24 * H + 1], NOW), [NOW - 24 * H + 1]);
    assert.deepEqual(m.pruneClaimsToRollingWindow([NOW - 24 * H - 1], NOW), []);
    assert.deepEqual(m.pruneClaimsToRollingWindow(undefined, NOW), []);
    assert.deepEqual(m.pruneClaimsToRollingWindow([NOW - H, NOW - 3 * H], NOW), [NOW - 3 * H, NOW - H]);
    const aged = offline(m, { claimTimestampsUtcMs: [NOW - 24 * H, NOW - 2 * H, NOW - H] });
    assert.equal(aged.eligible, true);
    assert.equal(aged.claimsInWindow, 2);
});

const ext = (m, claims) => m.evaluateExtendedOverclockEligibility({ nowUtcMs: NOW, claimTimestampsUtcMs: claims });

test('extended overclock eligibility matrix and interval boundary', async () => {
    const m = await mod();
    const fresh = ext(m, []);
    assert.equal(fresh.eligible, true);
    assert.equal(fresh.remainingQuota, 3);
    const justInside = ext(m, [NOW - 60 * MIN + 1]);
    assert.equal(justInside.reason, 'min_interval');
    assert.equal(justInside.nextEligibleAtUtc, NOW + 1);
    assert.equal(justInside.remainingQuota, 2);
    const exact = ext(m, [NOW - 60 * MIN]);
    assert.equal(exact.eligible, true);
    assert.equal(exact.reason, 'ok');
});

test('extended overclock quota reached: next eligible honours window and interval', async () => {
    const m = await mod();
    const spaced = ext(m, [NOW - 23 * H, NOW - 10 * H, NOW - 2 * H]);
    assert.equal(spaced.reason, 'quota_reached');
    assert.equal(spaced.nextEligibleAtUtc, NOW - 23 * H + 24 * H);
    const tight = ext(m, [NOW - 23 * H - 30 * MIN, NOW - 23 * H - 20 * MIN, NOW - 30 * MIN]);
    assert.equal(tight.reason, 'quota_reached');
    assert.equal(tight.nextEligibleAtUtc, Math.max(NOW - 30 * MIN + 60 * MIN, NOW - 23 * H - 30 * MIN + 24 * H));
});

test('future-dated claims and bad clocks are conservative and never throw', async () => {
    const m = await mod();
    const future = ext(m, [NOW + 5 * H]);
    assert.equal(future.eligible, false);
    assert.equal(future.reason, 'suspicious_time');
    assert.equal(future.nextEligibleAtUtc, null);
    assert.equal(future.claimsInWindow, 1);
    assert.equal(future.remainingQuota, 2);
    const back = offline(m, { claimTimestampsUtcMs: [NOW + H, NOW - H, NOW - 2 * H] });
    assert.equal(back.eligible, false);
    assert.equal(back.reason, 'suspicious_time');
    assert.equal(back.remainingQuota, 0);
    assert.equal(offline(m, { nowUtcMs: Number.NaN }).reason, 'suspicious_time');
    assert.equal(ext(m, [Number.NaN]).reason, 'suspicious_time');
    assert.equal(m.evaluateExtendedOverclockEligibility({ nowUtcMs: Number.POSITIVE_INFINITY }).reason, 'suspicious_time');
});

test('ad availability is independent of player eligibility', async () => {
    const m = await mod();
    const eligible = ext(m, []);
    const blocked = ext(m, [NOW - MIN]);
    assert.equal(eligible.eligible, true);
    assert.deepEqual(m.canOfferRewarded(eligible, false), { offer: false, blockedBy: 'ad' });
    assert.deepEqual(m.canOfferRewarded(eligible, true), { offer: true, blockedBy: null });
    assert.deepEqual(m.canOfferRewarded(blocked, true), { offer: false, blockedBy: 'player' });
    assert.deepEqual(m.canOfferRewarded(blocked, false), { offer: false, blockedBy: 'player' });
    assert.equal(Object.keys(eligible).includes('adAvailable'), false);
});

test('source has no imports (no cc, platform, services)', async () => {
    const src = await readFile(modulePath, 'utf8');
    assert.equal(/^\s*import\s/m.test(src), false);
    assert.equal(/from\s+['"]/.test(src), false);
    assert.equal(/require\(/.test(src), false);
});

test('documented constants mirror MONETIZATION.md', async () => {
    const m = await mod();
    assert.equal(m.OFFLINE_DOUBLE_RULES.minimumOfflineMinutes, 30);
    assert.equal(m.OFFLINE_DOUBLE_RULES.maxClaimsPerRolling24h, 3);
    assert.equal(m.EXTENDED_OVERCLOCK_RULES.maxClaimsPerRolling24h, 3);
    assert.equal(m.EXTENDED_OVERCLOCK_RULES.minimumIntervalMinutes, 60);
});
