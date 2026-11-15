const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const dataRoot = path.join(repoRoot, 'data');

async function importModule(relativePath) {
    return import(pathToFileURL(path.join(repoRoot, relativePath)).href);
}

async function readText(relativePath) {
    return (await readFile(path.join(repoRoot, relativePath), 'utf8')).replace(/\r\n/g, '\n');
}

async function collectJsonSources(directoryPath) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) return collectJsonSources(entryPath);
        if (!entry.isFile() || !entry.name.endsWith('.json')) return [];
        return [{ filePath: path.relative(repoRoot, entryPath).replace(/\\/g, '/'), text: await readFile(entryPath, 'utf8') }];
    }));
    return nested.flat().sort((a, b) => a.filePath.localeCompare(b.filePath));
}

const load = async () => ({
    events: await importModule('assets/scripts/services/AnalyticsEvents.ts'),
    validator: await importModule('assets/scripts/services/AnalyticsValidator.ts'),
    mapper: await importModule('assets/scripts/services/AnalyticsEventMapper.ts'),
    trackerModule: await importModule('assets/scripts/services/AnalyticsTracker.ts'),
    observerModule: await importModule('assets/scripts/presentation/AnalyticsObserver.ts'),
    debugModule: await importModule('assets/scripts/platform/mock/DebugAnalyticsService.ts'),
    derivation: await importModule('tools/analytics/MonetizationMetricsDerivation.ts'),
});

/** A scripted observer: fake clock, deterministic session id, mutable read-only state. */
function makeSession(m, options = {}) {
    const clock = { nowMs: options.startMs ?? 1_000_000_000_000 };
    const service = new m.debugModule.DebugAnalyticsService((e) => options.onEvent?.(e, clock.nowMs));
    const diagnostics = [];
    const tracker = new m.trackerModule.AnalyticsTracker(service, { validation: 'strict', onDiagnostic: (d) => diagnostics.push(d), ...(options.tracker ?? {}) });
    const state = { value: options.state ?? { eraId: 'era_1', civilization: 1, nextGoalId: 'producer_build:fabricator:level_1', lifetimeEarned: 0 } };
    const observer = new m.observerModule.AnalyticsObserver(tracker, {
        now: () => clock.nowMs,
        createSessionId: () => options.sessionId ?? 'sess_a',
        readState: () => state.value,
    });
    return { service, diagnostics, clock, state, observer, tracker };
}

const OFFERED = { eligible: true, reason: 'ok', adAvailable: true, blockedBy: null };
const HIDDEN = { eligible: false, reason: 'cooldown', adAvailable: false, blockedBy: 'player' };
const ids = (service) => service.events.map((e) => e.eventId);
const invalid = (diagnostics) => diagnostics.filter((d) => d.kind === 'invalid');

// ---------------------------------------------------------------- rewarded offline

test('offline double: one opportunity per episode with duration + base reward context; retries and re-reads do not inflate it', async () => {
    const m = await load();
    const { service, observer, diagnostics } = makeSession(m);
    const p = 'offline_double';
    observer.observeOfflineSignal({ kind: 'shown', reason: 'startup', rawSeconds: 4000, capApplied: false });
    const offer = { ...OFFERED, projectedReward: 2_500_000, multiplier: 2, claimsInWindow: 0 };
    observer.observeRewardedPhase(p, 'offer', offer);
    observer.observeRewardedPhase(p, 'offer', offer); // card refresh
    observer.observeRewardedPhase(p, 'ad_started', { requestId: 'offline_double:1:1' });
    observer.observeRewardedPhase(p, 'ad_result', { status: 'closed', rewardVerified: false, duplicate: false });
    observer.observeRewardedPhase(p, 'offer', offer); // re-read after the failed attempt
    observer.observeRewardedPhase(p, 'ad_started', { requestId: 'offline_double:1:2' });
    observer.observeRewardedPhase(p, 'ad_result', { status: 'rewarded', rewardVerified: true, duplicate: false });
    observer.observeRewardedPhase(p, 'granted', { baseReward: 1_250_000, grantedReward: 2_500_000, multiplier: 2, claimCount: 1, claimsInWindow: 1, saveOk: true });
    observer.observeOfflineSignal({ kind: 'collected', rawSeconds: 4000, capApplied: false, doubled: true, saveOk: null });
    assert.deepEqual(ids(service), [
        'offline_report_shown',
        'rewarded_opportunity',
        'rewarded_start', 'rewarded_failure',
        'rewarded_start', 'rewarded_complete',
        'offline_bonus_granted',
        'offline_collected',
    ]);
    const opportunity = service.events[1].params;
    assert.equal(opportunity.opportunity_id, 'ofd_1');
    assert.equal(opportunity.absence_bucket, '30m_2h');
    assert.equal(opportunity.multiplier, 2);
    assert.equal(opportunity.base_reward_mag, 6); // 1.25M -> 10^6
    const granted = service.events.find((e) => e.eventId === 'offline_bonus_granted').params;
    assert.deepEqual({ ...granted, session_id: undefined }, { request_id: 'offline_double:1:2', opportunity_id: 'ofd_1', multiplier: 2, base_reward_mag: 6, bonus_reward_mag: 6, claims_in_window: 1, session_id: undefined });
    assert.deepEqual(service.events.filter((e) => e.eventId === 'rewarded_start').map((e) => e.params.opportunity_id), ['ofd_1', 'ofd_1']);
    assert.equal(invalid(diagnostics).length, 0);
});

test('offline double: a new episode opens only after the offer went away; an ad flap inside the episode is reported once and never re-counts the opportunity', async () => {
    const m = await load();
    const { service, observer } = makeSession(m);
    const p = 'offline_double';
    observer.observeRewardedPhase(p, 'offer', OFFERED);
    observer.observeRewardedPhase(p, 'offer', { eligible: true, reason: 'ok', adAvailable: false, blockedBy: 'ad' });
    observer.observeRewardedPhase(p, 'offer', { eligible: true, reason: 'ok', adAvailable: false, blockedBy: 'ad' });
    observer.observeRewardedPhase(p, 'offer', OFFERED); // ad back: same episode
    observer.observeRewardedPhase(p, 'offer', HIDDEN); // report collected
    observer.observeRewardedPhase(p, 'offer', OFFERED); // next report
    assert.deepEqual(ids(service), ['rewarded_opportunity', 'rewarded_unavailable', 'rewarded_opportunity']);
    assert.deepEqual(service.events.map((e) => e.params.opportunity_id), ['ofd_1', 'ofd_1', 'ofd_2']);
});

// ---------------------------------------------------------------- extended overclock

test('extended overclock: opportunity -> opt-in -> activation with run age, era, civilization, next goal; expiry reports a bucketed production gain', async () => {
    const m = await load();
    const { service, observer, clock, state, diagnostics } = makeSession(m);
    const p = 'extended_overclock';
    observer.observeDomainEvents([{ type: 'rebootCompleted', oldCivilization: 1, newCivilization: 2, aiCoresGranted: 1, prestigePower: 1 }]);
    clock.nowMs += 40 * 60 * 1000; // 40 minutes into the run
    state.value = { eraId: 'era_2', civilization: 2, nextGoalId: 'breakthrough:bt_robotics', lifetimeEarned: 1_000_000 };
    observer.observeRewardedPhase(p, 'offer', OFFERED);
    observer.observeRewardedPhase(p, 'ad_started', { requestId: 'extended_overclock:1:1' });
    observer.observeRewardedPhase(p, 'ad_result', { status: 'rewarded', rewardVerified: true, duplicate: false });
    observer.observeRewardedPhase(p, 'granted', { requestId: 'extended_overclock:1:1', multiplier: 2, durationSeconds: 600, claimsInWindow: 1, claimCount: 1, saveOk: true });
    clock.nowMs += 600 * 1000;
    state.value = { ...state.value, lifetimeEarned: 1_000_000 + 40_000_000 };
    observer.observeDomainEvents([{ type: 'temporaryBoostExpired', boostId: 'extended_overclock', source: 'rewarded' }]);
    assert.deepEqual(ids(service), ['reboot_completed', 'rewarded_opportunity', 'rewarded_start', 'rewarded_complete', 'extended_overclock_activated', 'extended_overclock_ended']);
    const { session_id: _s1, ...activated } = service.events[4].params;
    assert.deepEqual(activated, { request_id: 'extended_overclock:1:1', opportunity_id: 'xoc_1', claims_in_window: 1, multiplier: 2, run_age_bucket: '30m_1h', era_id: 'era_2', civilization: 2, next_goal_id: 'breakthrough:bt_robotics' });
    const { session_id: _s2, ...ended } = service.events[5].params;
    // delta 40M x (2 - 1) / 2 = 20M -> 10^7
    assert.deepEqual(ended, { request_id: 'extended_overclock:1:1', outcome: 'expired', production_gain_mag: 7 });
    assert.equal(invalid(diagnostics).length, 0);
});

test('extended overclock: expiry without an observed activation (previous session) reports no gain; other boosts are ignored; a throwing state reader is harmless', async () => {
    const m = await load();
    const { service, observer, state } = makeSession(m);
    observer.observeDomainEvents([
        { type: 'temporaryBoostExpired', boostId: 'free_overclock', source: 'free' },
        { type: 'temporaryBoostExpired', boostId: 'extended_overclock', source: 'rewarded' },
    ]);
    assert.deepEqual(service.events.map((e) => [e.eventId, e.params.production_gain_mag]), [['extended_overclock_ended', undefined]]);
    observer.setStateReader(() => { throw new Error('state'); });
    observer.observeRewardedPhase('extended_overclock', 'offer', OFFERED);
    assert.doesNotThrow(() => observer.observeRewardedPhase('extended_overclock', 'granted', { multiplier: 2, claimsInWindow: 1 }));
    const activated = service.events.find((e) => e.eventId === 'extended_overclock_activated');
    assert.equal(activated.params.run_age_bucket, 'unknown');
    assert.equal(activated.params.era_id, undefined);
    assert.equal(state.value.civilization, 1);
});

// ---------------------------------------------------------------- founder

test('founder: impression and completion carry the time since unlock bucket and before_first_reboot; restore carries its context; no price text', async () => {
    const m = await load();
    const { service, observer, clock, state, diagnostics } = makeSession(m);
    observer.observeDomainEvents([{ type: 'firstRobotProduced' }]);
    clock.nowMs += 20 * 60 * 1000;
    const refresh = { offer: 'available', store: 'ready', priceShown: true, price: '$4.99', pending: false };
    observer.observePurchasePhase('refresh', refresh);
    observer.observePurchasePhase('refresh', refresh);
    clock.nowMs += 70 * 60 * 1000; // 1 h 30 after the unlock
    observer.observePurchasePhase('purchase_started', { requestId: 'founder_pack:1:1' });
    observer.observeDomainEvents([{ type: 'founderPackApplied', origin: 'purchase', requestId: 'founder_pack:1:1', entitlementGranted: true, cosmeticGranted: true, surgesGranted: 2, changed: true }]);
    observer.observePurchasePhase('applied', { status: 'applied_saved', restoreOnly: false, requestId: 'founder_pack:1:1' });
    // A later store-query restore (no purchase attempt open) after the First Reboot.
    state.value = { ...state.value, civilization: 2 };
    observer.observeDomainEvents([{ type: 'founderPackApplied', origin: 'restore', requestId: null, entitlementGranted: true, cosmeticGranted: false, surgesGranted: 0, changed: true }]);
    assert.deepEqual(ids(service), ['first_robot', 'purchase_offer_shown', 'purchase_start', 'purchase_complete', 'purchase_restore']);
    assert.equal(service.events[1].params.since_unlock_bucket, '15_30m');
    assert.equal(service.events[1].params.before_first_reboot, true);
    assert.equal(service.events[3].params.since_unlock_bucket, '1_3h');
    assert.equal(service.events[3].params.before_first_reboot, true);
    assert.equal(service.events[4].params.restore_context, 'store_query');
    assert.doesNotMatch(JSON.stringify(service.events), /4\.99|price|currency|\$/i);
    assert.equal(invalid(diagnostics).length, 0);
});

test('founder: a restore reached through a purchase attempt is labelled purchase_attempt; an unobserved unlock stays unknown; after a Reboot before_first_reboot is false', async () => {
    const m = await load();
    const { service, observer, state } = makeSession(m, { state: { eraId: 'era_3', civilization: 2, nextGoalId: null, lifetimeEarned: 5 } });
    observer.observePurchasePhase('purchase_started', { requestId: 'founder_pack:9:1' });
    observer.observeDomainEvents([{ type: 'founderPackApplied', origin: 'restore', requestId: 'founder_pack:9:1', entitlementGranted: true, cosmeticGranted: true, surgesGranted: 0, changed: true }]);
    observer.observePurchasePhase('applied', { status: 'applied_saved', restoreOnly: true, requestId: 'founder_pack:9:1' });
    observer.observePurchasePhase('refresh', { offer: 'available', store: 'ready', priceShown: true, price: '4,99 EUR', pending: false });
    observer.observeDomainEvents([{ type: 'founderPackApplied', origin: 'purchase', requestId: 'founder_pack:9:2', entitlementGranted: true, cosmeticGranted: true, surgesGranted: 2, changed: true }]);
    assert.equal(service.events.find((e) => e.eventId === 'purchase_restore').params.restore_context, 'purchase_attempt');
    const shown = service.events.find((e) => e.eventId === 'purchase_offer_shown').params;
    assert.equal(shown.since_unlock_bucket, 'unknown');
    assert.equal(shown.before_first_reboot, false);
    assert.equal(service.events.find((e) => e.eventId === 'purchase_complete').params.before_first_reboot, false);
    assert.equal(state.value.civilization, 2);
    assert.doesNotMatch(JSON.stringify(service.events), /EUR|4,99/);
});

test('founder: the worker_bot breakthrough also starts the unlock clock; a duplicate / replayed delivery does not add a completion', async () => {
    const m = await load();
    const { service, observer, clock } = makeSession(m);
    observer.observeDomainEvents([{ type: 'breakthroughPurchased', breakthroughId: 'worker_bot', cost: 1 }]);
    clock.nowMs += 6 * 60 * 1000;
    const delivery = (changed) => ({ type: 'founderPackApplied', origin: 'purchase', requestId: 'founder_pack:1:1', entitlementGranted: changed, cosmeticGranted: changed, surgesGranted: changed ? 2 : 0, changed });
    observer.observeDomainEvents([delivery(true)]);
    observer.observeDomainEvents([delivery(false)]);
    observer.observePurchasePhase('purchase_result', { status: 'completed', requestId: 'founder_pack:1:1', duplicate: true });
    assert.deepEqual(ids(service), ['breakthrough_purchase', 'purchase_complete']);
    assert.equal(service.events[1].params.since_unlock_bucket, '5_15m');
});

// ---------------------------------------------------------------- ids / privacy / non-authoritative

test('correlation ids are opaque: one session id per observer (no timestamp), opportunity ids are session-local counters', async () => {
    const m = await load();
    const service = new m.debugModule.DebugAnalyticsService();
    const make = () => new m.observerModule.AnalyticsObserver(new m.trackerModule.AnalyticsTracker(service, { validation: 'strict' }), { now: () => 1_700_000_000_000 });
    const a = make();
    const b = make();
    a.observeRewardedPhase('offline_double', 'offer', OFFERED);
    b.observeRewardedPhase('offline_double', 'offer', OFFERED);
    a.observeDomainEvents([{ type: 'firstRobotProduced' }]);
    const sessions = service.events.map((e) => e.params.session_id);
    assert.equal(sessions[0], sessions[2]);
    assert.notEqual(sessions[0], sessions[1]);
    for (const session of sessions) {
        assert.match(session, /^s[a-z0-9]{12}$/);
        assert.doesNotMatch(session, /\d{10}/);
    }
    for (const e of service.events.filter((x) => x.eventId === 'rewarded_opportunity')) assert.match(e.params.opportunity_id, /^ofd_[0-9]{1,3}$/);
    assert.deepEqual(service.events.filter((x) => x.eventId === 'rewarded_opportunity').map((e) => e.params.opportunity_id), ['ofd_1', 'ofd_1']);
});

test('catalogue: AUT-064 events are valid with the documented params and reject price / free-text params', async () => {
    const { validator, events } = await load();
    const v = validator.validateAnalyticsEvent;
    assert.equal(v('offline_bonus_granted', { opportunity_id: 'ofd_1', multiplier: 2, base_reward_mag: 3, bonus_reward_mag: 3, claims_in_window: 1, session_id: 's1' }).ok, true);
    assert.equal(v('extended_overclock_activated', { multiplier: 2, claims_in_window: 1, run_age_bucket: 'unknown' }).ok, true);
    assert.equal(v('extended_overclock_activated', { multiplier: 2, claims_in_window: 1, run_age_bucket: '12 minutes' }).ok, false);
    assert.equal(v('extended_overclock_ended', { outcome: 'expired' }).ok, true);
    assert.equal(v('purchase_offer_shown', { product: 'founder_pack', since_unlock_bucket: 'lt_5m', before_first_reboot: true }).ok, true);
    assert.equal(v('purchase_offer_shown', { product: 'founder_pack', since_unlock_bucket: 'lt_5m', before_first_reboot: true, price_tier: 'tier_1' }).ok, false);
    assert.equal(v('purchase_offer_shown', { product: 'founder_pack', before_first_reboot: true }).ok, false);
    assert.equal(v('purchase_restore', { product: 'founder_pack', restore_context: 'store_query' }).ok, true);
    assert.equal(v('purchase_restore', { product: 'founder_pack', restore_context: 'somewhere' }).ok, false);
    assert.equal(events.bucketElapsedSeconds(null), 'unknown');
    assert.equal(events.bucketElapsedSeconds(299), 'lt_5m');
    assert.equal(events.bucketElapsedSeconds(300), '5_15m');
    assert.equal(events.bucketElapsedSeconds(30 * 3600), 'gt_8h');
    assert.equal(events.rewardMagnitude(5), 0);
    assert.equal(events.rewardMagnitude(12_345), 4);
    assert.equal(events.rewardMagnitude(Number.POSITIVE_INFINITY), 0);
    assert.equal(Object.keys(events.ANALYTICS_EVENT_SCHEMAS).every((id) => 'session_id' in events.ANALYTICS_EVENT_SCHEMAS[id].params), true);
});

test('price tier is not exposed: the product metadata has no tier / currency field and no analytics schema has one', async () => {
    const purchaseService = await readText('assets/scripts/services/PurchaseService.ts');
    assert.doesNotMatch(purchaseService, /tier|currencyCode|priceAmount|priceMicros/i);
    const { events } = await load();
    for (const schema of Object.values(events.ANALYTICS_EVENT_SCHEMAS)) {
        for (const name of Object.keys(schema.params)) assert.doesNotMatch(name, /tier|currency|price/);
    }
});

test('non-authoritative: a failing provider never reaches the flows and the observer never reads anything back', async () => {
    const m = await load();
    const throwing = { initialize: async () => ({ kind: 'analytics', status: 'ready' }), getStatus: () => ({ kind: 'analytics', status: 'ready' }), track() { throw new Error('boom'); } };
    const tracker = new m.trackerModule.AnalyticsTracker(throwing, { validation: 'strict', maxConsecutiveFailures: 2 });
    const observer = new m.observerModule.AnalyticsObserver(tracker, { readState: () => { throw new Error('state'); } });
    for (let i = 0; i < 6; i += 1) {
        assert.doesNotThrow(() => {
            observer.observeRewardedPhase('extended_overclock', 'offer', OFFERED);
            observer.observeRewardedPhase('extended_overclock', 'granted', { multiplier: 2, claimsInWindow: 1 });
            observer.observePurchasePhase('refresh', { offer: 'available', store: 'ready', priceShown: true });
            observer.observeDomainEvents([{ type: 'temporaryBoostExpired', boostId: 'extended_overclock', source: 'rewarded' }]);
        });
    }
    assert.equal(tracker.isEnabled(), false);
});

test('state context: real config next-goal ids fit the catalogue; a failing resolver only drops the optional id', async () => {
    const { loadGameConfigFromSources } = await importModule('assets/scripts/config/ConfigLoader.ts');
    const { createFreshGameState } = await importModule('assets/scripts/state/index.ts');
    const { createAnalyticsStateContext } = await importModule('assets/scripts/presentation/AnalyticsStateContext.ts');
    const { validateAnalyticsEvent } = await load().then((m) => m.validator);
    const repo = loadGameConfigFromSources(await collectJsonSources(dataRoot));
    const state = createFreshGameState();
    const context = createAnalyticsStateContext(repo, state);
    assert.equal(context.civilization, 1);
    assert.equal(typeof context.eraId, 'string');
    assert.equal(typeof context.nextGoalId, 'string');
    assert.equal(validateAnalyticsEvent('extended_overclock_activated', { multiplier: 2, claims_in_window: 1, run_age_bucket: 'unknown', era_id: context.eraId, civilization: context.civilization, next_goal_id: context.nextGoalId }).ok, true);
    const before = JSON.stringify(state);
    createAnalyticsStateContext(repo, state);
    assert.equal(JSON.stringify(state), before);
    assert.equal(createAnalyticsStateContext({}, state).nextGoalId, null);
});

// ---------------------------------------------------------------- derivation (opt-in, use frequency, conversion, time to purchase)

/** Drives an observer with a scripted clock and returns ingest-style records (the backend adds tsMs and userKey). */
function recorder(m, userKey, sessionId) {
    const records = [];
    // The ingest backend stamps each event with its arrival time: the provider sink reads the scripted clock at emission.
    const session = makeSession(m, { sessionId, onEvent: (e, tsMs) => records.push({ eventId: e.eventId, params: e.params, tsMs, userKey }) });
    return { ...session, records, at(tsMs) { session.clock.nowMs = tsMs; return this; }, flush() { /* records are stamped at emission */ } };
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = 1_800_000_000_000;

test('derivation: opt-in rate, attempts, multiplier used, bonus buckets and claims per rolling day come from clean rewarded-offline events', async () => {
    const m = await load();
    const p = 'offline_double';
    const all = [];
    // Player A: two offline reports in one day; opts in on the first (after one failed attempt), skips the second.
    const a = recorder(m, 'A', 'sess_a1');
    a.at(T0);
    a.observer.observeOfflineSignal({ kind: 'shown', reason: 'startup', rawSeconds: 4000, capApplied: false });
    a.observer.observeRewardedPhase(p, 'offer', { ...OFFERED, projectedReward: 2000, multiplier: 2, claimsInWindow: 0 });
    a.observer.observeRewardedPhase(p, 'ad_started', { requestId: 'offline_double:1:1' });
    a.observer.observeRewardedPhase(p, 'ad_result', { status: 'failed', rewardVerified: false, duplicate: false });
    a.observer.observeRewardedPhase(p, 'offer', { ...OFFERED, projectedReward: 2000, multiplier: 2, claimsInWindow: 0 });
    a.observer.observeRewardedPhase(p, 'ad_started', { requestId: 'offline_double:1:2' });
    a.observer.observeRewardedPhase(p, 'ad_result', { status: 'rewarded', rewardVerified: true, duplicate: false });
    a.at(T0 + 5_000).observer.observeRewardedPhase(p, 'granted', { baseReward: 1000, grantedReward: 2000, multiplier: 2, claimCount: 1, claimsInWindow: 1, saveOk: true });
    a.observer.observeRewardedPhase(p, 'offer', HIDDEN);
    a.at(T0 + 3 * HOUR).observer.observeOfflineSignal({ kind: 'shown', reason: 'resumed', rawSeconds: 20_000, capApplied: false });
    a.observer.observeRewardedPhase(p, 'offer', { ...OFFERED, projectedReward: 80_000, multiplier: 2, claimsInWindow: 1 });
    a.flush();
    // Player B: one short absence, never opts in (card collected with the free button).
    const b = recorder(m, 'B', 'sess_b1');
    b.at(T0 + HOUR);
    b.observer.observeOfflineSignal({ kind: 'shown', reason: 'startup', rawSeconds: 400, capApplied: false });
    b.observer.observeRewardedPhase(p, 'offer', { ...OFFERED, projectedReward: 100, multiplier: 2, claimsInWindow: 0 });
    b.observer.observeRewardedPhase(p, 'offer', HIDDEN);
    b.flush();
    all.push(...a.records, ...b.records);
    const r = m.derivation.deriveMonetizationMetrics(all).rewardedOffline;
    assert.equal(r.opportunities, 3);
    assert.equal(r.optIns, 1);
    assert.ok(Math.abs(r.optInRate - 1 / 3) < 1e-9);
    assert.equal(r.attempts, 2); // two ad attempts of the SAME opportunity: a retry never adds an opportunity
    assert.equal(r.completions, 1);
    assert.equal(r.grants, 1);
    assert.deepEqual(r.multiplierUsed, { 2: 1 });
    assert.deepEqual(r.byAbsenceBucket['30m_2h'], { opportunities: 1, optIns: 1, optInRate: 1 });
    assert.deepEqual(r.byAbsenceBucket['2_8h'], { opportunities: 1, optIns: 0, optInRate: 0 });
    assert.deepEqual(r.byAbsenceBucket['5_30m'], { opportunities: 1, optIns: 0, optInRate: 0 });
    assert.deepEqual(r.baseRewardMagDistribution, { 3: 1 });
    assert.deepEqual(r.bonusRewardMagDistribution, { 3: 1 });
    assert.equal(r.maxClaimsInRollingDay, 1);
    assert.equal(r.maxReportedClaimsInWindow, 1);
});

test('derivation: Extended Overclock opt-in, uses per player-day, run age, era, goal and gain from clean events', async () => {
    const m = await load();
    const p = 'extended_overclock';
    const state = (era, goal, earned) => ({ eraId: era, civilization: 1, nextGoalId: goal, lifetimeEarned: earned });
    const a = recorder(m, 'A', 'sess_a1');
    a.at(T0).observer.observeDomainEvents([{ type: 'firstRobotProduced' }]);
    const use = (rec, tsMs, era, goal, requestId, claims, earnedAtStart, earnedAtEnd) => {
        rec.at(tsMs);
        rec.state.value = state(era, goal, earnedAtStart);
        rec.observer.observeRewardedPhase(p, 'offer', OFFERED);
        rec.observer.observeRewardedPhase(p, 'ad_started', { requestId });
        rec.observer.observeRewardedPhase(p, 'ad_result', { status: 'rewarded', rewardVerified: true, duplicate: false });
        rec.observer.observeRewardedPhase(p, 'granted', { requestId, multiplier: 2, claimsInWindow: claims, claimCount: claims });
        rec.at(tsMs + 10 * MIN);
        rec.state.value = state(era, goal, earnedAtEnd);
        rec.observer.observeDomainEvents([{ type: 'temporaryBoostExpired', boostId: 'extended_overclock', source: 'rewarded' }]);
    };
    use(a, T0 + 30 * MIN, 'era_1', 'producer_build:fabricator:level_5', 'extended_overclock:1:1', 1, 100, 100 + 2_000);
    use(a, T0 + 2 * HOUR, 'era_2', 'breakthrough:bt_a', 'extended_overclock:1:2', 2, 5_000, 5_000 + 200_000);
    // An offered-but-ignored opportunity (a skipped chip) on a later day.
    a.at(T0 + DAY + HOUR).observer.observeRewardedPhase(p, 'offer', HIDDEN);
    a.observer.observeRewardedPhase(p, 'offer', OFFERED);
    a.flush();
    const b = recorder(m, 'B', 'sess_b1');
    b.at(T0).observer.observeDomainEvents([{ type: 'firstRobotProduced' }]);
    use(b, T0 + DAY + 3 * HOUR, 'era_2', 'breakthrough:bt_a', 'extended_overclock:2:1', 1, 10, 10 + 20_000);
    b.flush();
    const r = m.derivation.deriveMonetizationMetrics([...a.records, ...b.records]).extendedOverclock;
    assert.equal(r.opportunities, 4);
    assert.equal(r.optIns, 3);
    assert.equal(r.optInRate, 0.75);
    assert.equal(r.attempts, 3);
    assert.equal(r.activations, 3);
    // (A day0: 2 uses), (B day1: 1 use) -> 1.5 per active player-day, max 2.
    assert.equal(r.usesPerActivePlayerDay, 1.5);
    assert.equal(r.maxUsesPerPlayerDay, 2);
    assert.deepEqual(r.byEra, { era_1: 1, era_2: 2 });
    assert.deepEqual(r.byNextGoal, { 'producer_build:fabricator:level_5': 1, 'breakthrough:bt_a': 2 });
    assert.deepEqual(r.runAgeBucketDistribution, { unknown: 3 });
    // Exact run age from backend timestamps (run start = the player's first event): 30 min, 2 h, 27 h (B: DAY + 3 h).
    assert.equal(r.medianRunAgeSeconds, 2 * 3600);
    assert.equal(r.endedCount, 3);
    assert.deepEqual(r.productionGainMagDistribution, { 3: 1, 5: 1, 4: 1 });
});

test('derivation: Founder impression-to-purchase conversion, time from unlock to purchase and before-first-reboot split from clean events', async () => {
    const m = await load();
    const refresh = { offer: 'available', store: 'ready', priceShown: true, price: '$4.99', pending: false };
    const buy = (rec, requestId, tsMs) => {
        rec.at(tsMs);
        rec.observer.observePurchasePhase('purchase_started', { requestId });
        rec.observer.observeDomainEvents([{ type: 'founderPackApplied', origin: 'purchase', requestId, entitlementGranted: true, cosmeticGranted: true, surgesGranted: 2, changed: true }]);
        rec.observer.observePurchasePhase('applied', { status: 'applied_saved', requestId });
    };
    // A: unlock, impression 10 min later, purchase 50 min after the unlock (before the first reboot).
    const a = recorder(m, 'A', 'sess_a1');
    a.at(T0).observer.observeDomainEvents([{ type: 'firstRobotProduced' }]);
    a.at(T0 + 10 * MIN).observer.observePurchasePhase('refresh', refresh);
    buy(a, 'founder_pack:1:1', T0 + 50 * MIN);
    a.flush();
    // B: impression, never buys.
    const b = recorder(m, 'B', 'sess_b1');
    b.at(T0).observer.observeDomainEvents([{ type: 'firstRobotProduced' }]);
    b.at(T0 + 20 * MIN).observer.observePurchasePhase('refresh', refresh);
    b.at(T0 + 25 * MIN).observer.observePurchasePhase('purchase_started', { requestId: 'founder_pack:2:1' });
    b.observer.observePurchasePhase('purchase_result', { status: 'cancelled', requestId: 'founder_pack:2:1', duplicate: false });
    b.flush();
    // C: impression and a later purchase after the first reboot (civilization 2); then a restore on a new install.
    const c = recorder(m, 'C', 'sess_c1');
    c.at(T0).observer.observeDomainEvents([{ type: 'breakthroughPurchased', breakthroughId: 'worker_bot', cost: 1 }]);
    c.at(T0 + 5 * MIN).observer.observePurchasePhase('refresh', refresh);
    c.state.value = { ...c.state.value, civilization: 2 };
    buy(c, 'founder_pack:3:1', T0 + 3 * HOUR);
    c.observer.observeDomainEvents([{ type: 'founderPackApplied', origin: 'restore', requestId: null, entitlementGranted: false, cosmeticGranted: false, surgesGranted: 0, changed: true }]);
    c.flush();
    const f = m.derivation.deriveMonetizationMetrics([...a.records, ...b.records, ...c.records]).founder;
    assert.equal(f.impressions, 3);
    assert.equal(f.impressionPlayers, 3);
    assert.equal(f.starts, 3);
    assert.equal(f.purchases, 2);
    assert.ok(Math.abs(f.conversion - 2 / 3) < 1e-9);
    assert.deepEqual([...f.timeToPurchaseSeconds].sort((x, y) => x - y), [50 * 60, 3 * 3600]);
    assert.equal(f.medianTimeToPurchaseSeconds, (50 * 60 + 3 * 3600) / 2);
    assert.equal(f.beforeFirstRebootPurchases, 1);
    assert.deepEqual(f.sinceUnlockBucketAtPurchase, { '30m_1h': 1, '3_8h': 1 });
    assert.deepEqual(f.sinceUnlockBucketAtImpression, { '5_15m': 2, '15_30m': 1 });
    assert.equal(f.restores, 1);
});

test('derivation: pure, never mutates the stream, tolerates an empty stream and records without correlation ids', async () => {
    const m = await load();
    const empty = m.derivation.deriveMonetizationMetrics([]);
    assert.equal(empty.rewardedOffline.optInRate, 0);
    assert.equal(empty.extendedOverclock.usesPerActivePlayerDay, 0);
    assert.equal(empty.founder.conversion, 0);
    assert.equal(empty.founder.medianTimeToPurchaseSeconds, null);
    const records = Object.freeze([Object.freeze({ eventId: 'rewarded_opportunity', params: Object.freeze({ placement: 'offline_double' }), tsMs: 1 })]);
    assert.equal(m.derivation.deriveMonetizationMetrics(records).rewardedOffline.opportunities, 0);
});

// ---------------------------------------------------------------- wiring / scope

test('wiring: the bootstrap feeds the read-only state reader, the derivation is not imported by runtime code, and no save schema field was added', async () => {
    const bootstrap = await readText('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /setStateReader\(/);
    assert.match(bootstrap, /createAnalyticsStateContext\(/);
    const walk = async (dir) => (await readdir(dir, { withFileTypes: true })).flatMap((e) => (e.isDirectory() ? [] : [path.join(dir, e.name)]));
    const dirs = (await readdir(path.join(repoRoot, 'assets', 'scripts'), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => path.join(repoRoot, 'assets', 'scripts', e.name));
    for (const dir of dirs) {
        for (const file of (await walk(dir)).filter((f) => f.endsWith('.ts'))) {
            assert.doesNotMatch(await readFile(file, 'utf8'), /MonetizationMetricsDerivation/, path.basename(file));
        }
    }
    const state = await readText('assets/scripts/state/GameState.ts');
    assert.doesNotMatch(state, /analytics|unlockedAt|runStarted/i);
});
