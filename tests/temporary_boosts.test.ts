const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const progressionModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/progression/index.ts')).href;
const stateModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/state/index.ts')).href;

let progressionModulePromise;
let stateModulePromise;

async function progressionModule() {
    if (progressionModulePromise === undefined) {
        progressionModulePromise = import(progressionModuleUrl);
    }

    return progressionModulePromise;
}

async function freshState() {
    if (stateModulePromise === undefined) {
        stateModulePromise = import(stateModuleUrl);
    }

    const { createFreshGameState } = await stateModulePromise;
    return createFreshGameState();
}

test('Free Overclock unlocks after Worker Bot in Civilization #1 and from Civilization #2 start', async () => {
    const { isFreeOverclockUnlocked } = await progressionModule();
    const civilizationOne = await freshState();

    assert.equal(isFreeOverclockUnlocked(civilizationOne), false);

    civilizationOne.run.progressionFlags.first_robot = true;
    assert.equal(isFreeOverclockUnlocked(civilizationOne), true);

    const civilizationTwo = await freshState();
    civilizationTwo.meta.civilizationNumber = 2;
    assert.equal(isFreeOverclockUnlocked(civilizationTwo), true);
});

test('Free Overclock activates as a 60 second x2 production boost with 240 second cooldown', async () => {
    const {
        FREE_OVERCLOCK_BOOST_ID,
        activateFreeOverclock,
        advanceTemporaryBoosts,
        getEffectiveTemporaryProductionMultiplier,
    } = await progressionModule();
    const state = await freshState();
    state.run.progressionFlags.first_robot = true;

    const activation = activateFreeOverclock(state);
    assert.equal(activation.status, 'activated');
    assert.equal(activation.events.length, 1);
    assert.deepEqual(activation.events[0], {
        type: 'temporaryBoostActivated',
        boostId: FREE_OVERCLOCK_BOOST_ID,
        source: 'free',
        multiplier: 2,
        durationSeconds: 60,
        cooldownSeconds: 240,
        requestId: null,
    });
    assert.equal(activation.boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID].remainingSeconds, 60);
    assert.equal(getEffectiveTemporaryProductionMultiplier(activation.boosts), 2);

    const almostExpired = advanceTemporaryBoosts(activation.boosts, 59.5);
    assert.equal(almostExpired.boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID].remainingSeconds, 0.5);
    assert.equal(getEffectiveTemporaryProductionMultiplier(almostExpired.boosts), 2);

    const expired = advanceTemporaryBoosts(almostExpired.boosts, 0.5);
    assert.equal(expired.boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID], undefined);
    assert.equal(expired.boosts.cooldowns[FREE_OVERCLOCK_BOOST_ID].remainingSeconds, 240);
    assert.deepEqual(expired.events, [{
        type: 'temporaryBoostExpired',
        boostId: FREE_OVERCLOCK_BOOST_ID,
        source: 'free',
    }]);
    assert.equal(getEffectiveTemporaryProductionMultiplier(expired.boosts), 1);
});

test('Free Overclock cooldown consumes excess elapsed time across the active boundary', async () => {
    const { FREE_OVERCLOCK_BOOST_ID, activateFreeOverclock, advanceTemporaryBoosts } = await progressionModule();
    const state = await freshState();
    state.run.progressionFlags.first_robot = true;

    const activation = activateFreeOverclock(state);
    const advanced = advanceTemporaryBoosts(activation.boosts, 120);

    assert.equal(advanced.boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID], undefined);
    assert.equal(advanced.boosts.cooldowns[FREE_OVERCLOCK_BOOST_ID].remainingSeconds, 180);
    assert.equal(advanced.events.filter((event) => event.type === 'temporaryBoostExpired').length, 1);

    const cooledDown = advanceTemporaryBoosts(advanced.boosts, 180);
    assert.deepEqual(cooledDown.boosts.cooldowns, {});
    assert.deepEqual(cooledDown.events, []);
});

test('equivalent elapsed partitions produce equivalent Free Overclock state', async () => {
    const { activateFreeOverclock, advanceTemporaryBoosts } = await progressionModule();
    const state = await freshState();
    state.run.progressionFlags.first_robot = true;

    const activation = activateFreeOverclock(state);
    const singleStep = advanceTemporaryBoosts(activation.boosts, 301).boosts;
    const partitioned = [10, 50, 90, 151].reduce(
        (boosts, elapsedSeconds) => advanceTemporaryBoosts(boosts, elapsedSeconds).boosts,
        activation.boosts,
    );

    assert.deepEqual(partitioned, singleStep);
});

test('invalid temporary boost elapsed durations fail deterministically', async () => {
    const { TemporaryBoostInputError, advanceTemporaryBoosts } = await progressionModule();
    const state = await freshState();

    for (const elapsedSeconds of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        assert.throws(() => advanceTemporaryBoosts(state.boosts, elapsedSeconds), TemporaryBoostInputError);
    }
});

test('effective temporary production multiplier resolves to identity or the highest active boost', async () => {
    const {
        activateTemporaryProductionBoost,
        getEffectiveTemporaryProductionMultiplier,
    } = await progressionModule();
    const state = await freshState();

    assert.equal(getEffectiveTemporaryProductionMultiplier(state.boosts), 1);

    const firstX2 = activateTemporaryProductionBoost(state.boosts, {
        boostId: 'fixture_x2_a',
        multiplier: 2,
        durationSeconds: 30,
        source: 'fixture',
    });
    const secondX2 = activateTemporaryProductionBoost(firstX2.boosts, {
        boostId: 'fixture_x2_b',
        multiplier: 2,
        durationSeconds: 30,
        source: 'fixture',
    });
    assert.equal(getEffectiveTemporaryProductionMultiplier(secondX2.boosts), 2);

    const x3 = activateTemporaryProductionBoost(secondX2.boosts, {
        boostId: 'fixture_x3',
        multiplier: 3,
        durationSeconds: 30,
        source: 'fixture',
    });
    assert.equal(getEffectiveTemporaryProductionMultiplier(x3.boosts), 3);
});

test('suspending and resuming Free Overclock preserves exact remaining active duration', async () => {
    const {
        FREE_OVERCLOCK_BOOST_ID,
        activateFreeOverclock,
        advanceTemporaryBoosts,
        resumeTemporaryBoost,
        suspendTemporaryBoost,
    } = await progressionModule();
    const state = await freshState();
    state.run.progressionFlags.first_robot = true;

    const activation = activateFreeOverclock(state);
    const partiallyUsed = advanceTemporaryBoosts(activation.boosts, 12.25);
    const suspended = suspendTemporaryBoost(partiallyUsed.boosts, FREE_OVERCLOCK_BOOST_ID, 'fixture_extended_overclock');

    assert.equal(suspended.status, 'changed');
    assert.equal(suspended.boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID].remainingSeconds, 47.75);
    assert.equal(activateFreeOverclock({
        ...state,
        boosts: suspended.boosts,
    }).status, 'suspended');

    const advancedWhileSuspended = advanceTemporaryBoosts(suspended.boosts, 999);
    assert.equal(advancedWhileSuspended.boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID].remainingSeconds, 47.75);
    assert.deepEqual(advancedWhileSuspended.events, []);

    const resumed = resumeTemporaryBoost(advancedWhileSuspended.boosts, FREE_OVERCLOCK_BOOST_ID, 'fixture_extended_overclock');
    assert.equal(resumed.status, 'changed');
    assert.equal(resumed.boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID].remainingSeconds, 47.75);

    const expired = advanceTemporaryBoosts(resumed.boosts, 47.75);
    assert.equal(expired.boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID], undefined);
    assert.equal(expired.boosts.cooldowns[FREE_OVERCLOCK_BOOST_ID].remainingSeconds, 240);
});
