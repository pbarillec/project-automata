const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const resolverUrl = pathToFileURL(path.join(__dirname, '..', 'assets', 'scripts', 'presentation', 'VisualStateResolver.ts')).href;

function state(level, built = level > 0, automated = false) {
    return {
        run: { producers: { fabricator: { level, isUnlocked: built, isBuilt: built } }, automation: automated ? { fabricator: { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: 'auto_feeder' } } : {}, currentEraId: 'manual_workshop' },
    };
}

test('VisualStateResolver maps arbitrary levels to cumulative Fabricator tiers', async () => {
    const { resolveFabricatorVisualState } = await import(resolverUrl);
    for (const [level, tier] of [[0, 0], [1, 1], [9, 1], [10, 10], [24, 10], [25, 25], [49, 25], [50, 50], [99, 50], [100, 100]]) {
        assert.equal(resolveFabricatorVisualState(state(level)).milestoneTier, tier);
    }
});

test('level zero is unconstructed and does not expose modules', async () => {
    const { resolveFabricatorVisualState } = await import(resolverUrl);
    const descriptor = resolveFabricatorVisualState(state(0, false));
    assert.equal(descriptor.constructed, false);
    assert.deepEqual(descriptor.modules, []);
});

test('Auto Feeder is independent of milestone tier', async () => {
    const { resolveFabricatorVisualState } = await import(resolverUrl);
    const descriptor = resolveFabricatorVisualState(state(9, true, true));
    assert.equal(descriptor.milestoneTier, 1);
    assert.equal(descriptor.automationActive, true);
    assert.ok(descriptor.modules.includes('auto_feeder_hopper'));
    assert.ok(descriptor.modules.includes('input_conveyor'));
});

test('debug forcing is presentation-only and does not mutate authoritative state', async () => {
    const { VisualStateResolver } = await import(resolverUrl);
    const authoritative = state(9, true, false);
    const before = JSON.stringify(authoritative);
    const resolver = new VisualStateResolver({ debugState: 'lv100' });
    assert.equal(resolver.resolve(authoritative).milestoneTier, 100);
    assert.equal(JSON.stringify(authoritative), before);
});

