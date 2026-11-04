const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'assets/scripts/presentation/AutomationPayoffViewModel.ts')).href;

function state(automated = false) {
    return {
        run: {
            producers: { fabricator: { level: 15, isUnlocked: true, isBuilt: true } },
            automation: automated ? { fabricator: { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: 'auto_feeder' } } : {},
            currentEraId: 'manual_workshop',
        },
    };
}

const event = {
    type: 'automationStateChanged', producerId: 'fabricator', isAutomated: true,
    isOfflineEligible: true, unlockedByBreakthroughId: 'auto_feeder',
};

test('manual and reconstructed automated states are deterministic and mutation-free', async () => {
    const { AutomationPayoffViewModel } = await import(moduleUrl);
    const manual = state(false);
    const before = JSON.stringify(manual);
    assert.equal(new AutomationPayoffViewModel().syncFromState(manual).machineActivity, 'manual');
    assert.equal(JSON.stringify(manual), before);
    const automated = new AutomationPayoffViewModel().syncFromState(state(true));
    assert.equal(automated.activityIndicatorVisible, true);
    assert.ok(automated.fabricator.modules.includes('auto_feeder_hopper'));
    assert.ok(automated.fabricator.modules.includes('input_conveyor'));
    assert.equal(automated.focusBeatRequested, false);
});

test('first automation evidence requests one focus beat and repeated delivery is idempotent', async () => {
    const { AutomationPayoffViewModel } = await import(moduleUrl);
    const model = new AutomationPayoffViewModel();
    const automated = state(true);
    const first = model.consumeEvents(automated, [event]);
    assert.equal(first.focusBeatId, 1);
    assert.equal(first.focusBeatRequested, true);
    model.acknowledgeFocusBeat();
    const repeated = model.consumeEvents(automated, [event, event]);
    assert.equal(repeated.focusBeatId, 1);
    assert.equal(repeated.focusBeatRequested, false);
    assert.equal(model.handledEventCount, 1);
});

test('interrupting the payoff focus preserves the authoritative automated visual state', async () => {
    const { AutomationPayoffViewModel } = await import(moduleUrl);
    const model = new AutomationPayoffViewModel();
    model.consumeEvents(state(true), [event]);
    model.interruptFocusBeat();
    const snapshot = model.syncFromState(state(true));
    assert.equal(snapshot.focusBeatRequested, false);
    assert.equal(snapshot.automationActive, true);
    assert.ok(snapshot.fabricator.modules.includes('input_conveyor'));
});
