const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const importModule = (relativePath) => import(pathToFileURL(path.join(repoRoot, relativePath)).href);

const tracked = (eventId, params, tMs = 0) => ({ tMs, event: { evt: 'analytics', phase: 'tracked', eventId, params: { session_id: 'sabc123def456', ...params } } });

const offlineStream = () => [
    tracked('offline_report_shown', { reason: 'startup', absence_bucket: '2_8h', cap_applied: false }),
    tracked('rewarded_opportunity', { placement: 'offline_double', opportunity_id: 'ofd_1', absence_bucket: '2_8h', base_reward_mag: 4, multiplier: 2 }),
    tracked('rewarded_start', { placement: 'offline_double', request_id: 'offline_double:1:1', opportunity_id: 'ofd_1' }),
    tracked('rewarded_complete', { placement: 'offline_double', request_id: 'offline_double:1:1', opportunity_id: 'ofd_1' }),
    tracked('offline_bonus_granted', { request_id: 'offline_double:1:1', opportunity_id: 'ofd_1', multiplier: 2, base_reward_mag: 4, bonus_reward_mag: 4, claims_in_window: 1 }),
    tracked('offline_collected', { absence_bucket: '2_8h', cap_applied: false, doubled: true }),
];

const overclockStream = () => [
    tracked('rewarded_opportunity', { placement: 'extended_overclock', opportunity_id: 'xoc_1' }),
    tracked('rewarded_start', { placement: 'extended_overclock', request_id: 'extended_overclock:1:1', opportunity_id: 'xoc_1' }),
    tracked('rewarded_complete', { placement: 'extended_overclock', request_id: 'extended_overclock:1:1', opportunity_id: 'xoc_1' }),
    tracked('extended_overclock_activated', { request_id: 'extended_overclock:1:1', opportunity_id: 'xoc_1', claims_in_window: 1, multiplier: 2, run_age_bucket: 'unknown', era_id: 'era_1', civilization: 1, next_goal_id: 'producer_build:fabricator:level_1' }),
];

const founderStream = () => [
    tracked('purchase_offer_shown', { product: 'founder_pack', since_unlock_bucket: 'unknown', before_first_reboot: true }),
    tracked('purchase_start', { product: 'founder_pack', request_id: 'founder_pack:1:1' }),
    tracked('purchase_complete', { product: 'founder_pack', request_id: 'founder_pack:1:1', since_unlock_bucket: 'unknown', before_first_reboot: true }),
];

const failing = (checks) => checks.filter((c) => !c.ok).map((c) => c.id);

test('analytics checks: clean offline double / extended overclock / founder purchase streams pass', async () => {
    const { evaluateAnalytics } = await importModule('tools/device/analytics_checks.ts');
    assert.deepEqual(failing(evaluateAnalytics(offlineStream(), 'offline_double')), []);
    assert.deepEqual(failing(evaluateAnalytics(overclockStream(), 'extended_overclock')), []);
    assert.deepEqual(failing(evaluateAnalytics(founderStream(), 'founder_purchase')), []);
});

test('analytics checks: inflated opportunities, unlinked opt-in, duplicate completion, invalid / failed events and price text are caught', async () => {
    const { evaluateAnalytics } = await importModule('tools/device/analytics_checks.ts');
    const twice = [...offlineStream(), tracked('rewarded_opportunity', { placement: 'offline_double', opportunity_id: 'ofd_2' })];
    assert.ok(failing(evaluateAnalytics(twice, 'offline_double')).includes('analytics_one_opportunity_per_episode'));

    const unlinked = offlineStream().map((e) => (e.event.eventId === 'rewarded_start' ? tracked('rewarded_start', { placement: 'offline_double', request_id: 'r:1', opportunity_id: 'ofd_9' }) : e));
    assert.ok(failing(evaluateAnalytics(unlinked, 'offline_double')).includes('analytics_opt_in_linked_to_opportunity'));

    const doubleComplete = [...founderStream(), founderStream()[2]];
    assert.ok(failing(evaluateAnalytics(doubleComplete, 'founder_purchase')).includes('analytics_founder_single_complete'));

    const invalid = [...offlineStream(), { tMs: 1, event: { evt: 'analytics', phase: 'invalid', eventId: 'rewarded_start', issues: [] } }];
    assert.ok(failing(evaluateAnalytics(invalid, 'offline_double')).includes('analytics_no_invalid_or_failure'));
    const failure = [...offlineStream(), { tMs: 1, event: { evt: 'analytics', phase: 'provider_failure', eventId: 'rewarded_start', consecutive: 1 } }];
    assert.ok(failing(evaluateAnalytics(failure, 'offline_double')).includes('analytics_no_invalid_or_failure'));

    const badParams = [...founderStream(), tracked('purchase_start', { product: 'founder_pack', request_id: 'r', price: '$4.99' })];
    const badChecks = failing(evaluateAnalytics(badParams, 'founder_purchase'));
    assert.ok(badChecks.includes('analytics_tracked_params_valid'));
    assert.ok(badChecks.includes('analytics_no_price_text'));

    assert.ok(failing(evaluateAnalytics([], 'offline_double')).includes('analytics_events_tracked'));
});

test('analytics checks: a second launch (after the relaunch marker) and a second session id are separated', async () => {
    const { evaluateAnalytics } = await importModule('tools/device/analytics_checks.ts');
    const relaunched = [...offlineStream(), { tMs: 5, event: { evt: 'capture_marker', phase: 'relaunch' } }, { tMs: 6, event: { evt: 'analytics', phase: 'tracked', eventId: 'first_robot', params: { session_id: 'sother000000' } } }];
    assert.deepEqual(failing(evaluateAnalytics(relaunched, 'offline_double')), []);
    const mixed = [...offlineStream(), { tMs: 6, event: { evt: 'analytics', phase: 'tracked', eventId: 'first_robot', params: { session_id: 'sother000000' } } }];
    assert.ok(failing(evaluateAnalytics(mixed, 'offline_double')).includes('analytics_single_opaque_session_id'));
});

test('reveal capture wiring: the AUT-055 / AUT-056 / AUT-059 success scenarios carry expectAnalytics and evaluateRevealTimeline runs the checks', async () => {
    const reveal = await importModule('tools/device/reveal_capture.ts');
    assert.equal(reveal.REVEAL_SCENARIOS['aut055-success'].expectAnalytics, 'offline_double');
    assert.equal(reveal.REVEAL_SCENARIOS['aut056-success'].expectAnalytics, 'extended_overclock');
    assert.equal(reveal.REVEAL_SCENARIOS['aut059-purchase-success'].expectAnalytics, 'founder_purchase');
    const others = Object.entries(reveal.REVEAL_SCENARIOS).filter(([, s]) => s.expectAnalytics !== undefined).map(([id]) => id).sort();
    assert.deepEqual(others, ['aut055-success', 'aut056-success', 'aut059-purchase-success']);
    const base = { expectConstruction: null, expectFocus: false, triggered: false, frameCount: 0 };
    const withAnalytics = reveal.evaluateRevealTimeline(offlineStream(), { ...base, expectAnalytics: 'offline_double' });
    assert.ok(withAnalytics.some((c) => c.id === 'analytics_one_opportunity_per_episode'));
    assert.ok(!reveal.evaluateRevealTimeline(offlineStream(), base).some((c) => c.id.startsWith('analytics_')));
});

test('cli wiring: the reveal-capture command forwards expectAnalytics to the capture', async () => {
    const { readFile } = require('node:fs/promises');
    const cli = (await readFile(path.join(repoRoot, 'tools/device/cli.ts'), 'utf8')).replace(/\r\n/g, '\n');
    assert.match(cli, /expectAnalytics: scenario\.expectAnalytics/);
    const reveal = (await readFile(path.join(repoRoot, 'tools/device/reveal_capture.ts'), 'utf8')).replace(/\r\n/g, '\n');
    assert.match(reveal, /expectAnalytics: options\.expectAnalytics/);
});
