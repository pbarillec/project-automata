const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const dataRoot = path.join(repoRoot, 'data');
const configModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/config/ConfigLoader.ts')).href;
const persistenceModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/persistence/index.ts')).href;
const runtimeModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/runtime/index.ts')).href;
const stateModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/state/index.ts')).href;
const timeModuleUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/time/index.ts')).href;

let repositoryPromise;
let persistenceModulePromise;
let runtimeModulePromise;
let stateModulePromise;
let timeModulePromise;

async function repository() {
    if (repositoryPromise === undefined) {
        repositoryPromise = (async () => {
            const { loadGameConfigFromSources } = await import(configModuleUrl);
            return loadGameConfigFromSources(await collectJsonSources(dataRoot));
        })();
    }

    return repositoryPromise;
}

async function persistenceModule() {
    if (persistenceModulePromise === undefined) {
        persistenceModulePromise = import(persistenceModuleUrl);
    }

    return persistenceModulePromise;
}

async function runtimeModule() {
    if (runtimeModulePromise === undefined) {
        runtimeModulePromise = import(runtimeModuleUrl);
    }

    return runtimeModulePromise;
}

async function freshState() {
    if (stateModulePromise === undefined) {
        stateModulePromise = import(stateModuleUrl);
    }

    const { createFreshGameState } = await stateModulePromise;
    return createFreshGameState();
}

async function timeModule() {
    if (timeModulePromise === undefined) {
        timeModulePromise = import(timeModuleUrl);
    }

    return timeModulePromise;
}

async function collectJsonSources(directoryPath) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const nestedSources = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(directoryPath, entry.name);

        if (entry.isDirectory()) {
            return collectJsonSources(entryPath);
        }

        if (!entry.isFile() || !entry.name.endsWith('.json')) {
            return [];
        }

        return [{
            filePath: path.relative(repoRoot, entryPath).replace(/\\/g, '/'),
            text: await readFile(entryPath, 'utf8'),
        }];
    }));

    return nestedSources.flat().sort((left, right) => left.filePath.localeCompare(right.filePath));
}

async function collectTypeScriptSources(directoryPath) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const nestedSources = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(directoryPath, entry.name);

        if (entry.isDirectory()) {
            return collectTypeScriptSources(entryPath);
        }

        if (!entry.isFile() || !entry.name.endsWith('.ts')) {
            return [];
        }

        return [entryPath];
    }));

    return nestedSources.flat().sort();
}

function setProducerLevel(state, producerId, level) {
    state.run.producers[producerId] = {
        level,
        isUnlocked: level > 0,
        isBuilt: level > 0,
    };
}

test('manual TimeService controls UTC and monotonic session time independently', async () => {
    const { ManualTimeService } = await timeModule();
    const clock = new ManualTimeService({
        utcIso: '2026-08-22T08:30:45.123Z',
        monotonicSeconds: 3,
    });

    assert.equal(clock.nowUtcIso(), '2026-08-22T08:30:45.123Z');
    assert.equal(clock.nowMonotonicSeconds(), 3);

    clock.advanceMonotonicSeconds(2.5);
    clock.setUtcIso('2026-08-21T08:30:45.123Z');

    assert.equal(clock.nowUtcIso(), '2026-08-21T08:30:45.123Z');
    assert.equal(clock.nowMonotonicSeconds(), 5.5);
    assert.equal(clock.elapsedMonotonicSecondsSince(3), 2.5);
});

test('manual monotonic time rejects invalid explicit advances without real waiting', async () => {
    const { ManualTimeService, TimeServiceInputError } = await timeModule();
    const clock = new ManualTimeService();

    for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        assert.throws(() => clock.advanceMonotonicSeconds(invalid), TimeServiceInputError);
        assert.throws(() => clock.advanceMonotonicMilliseconds(invalid), TimeServiceInputError);
        assert.throws(() => clock.setMonotonicSeconds(invalid), TimeServiceInputError);
    }

    assert.equal(clock.nowMonotonicSeconds(), 0);
});

test('UTC absence primitives use SaveEnvelope timestamp validation and clamp backwards elapsed time', async () => {
    const { calculateUtcElapsedSeconds } = await timeModule();

    assert.deepEqual(calculateUtcElapsedSeconds(
        '2026-08-22T08:30:45.000Z',
        '2026-08-22T08:32:15.500Z',
    ), {
        status: 'valid',
        elapsedSeconds: 90.5,
        rawElapsedSeconds: 90.5,
        startUtcIso: '2026-08-22T08:30:45.000Z',
        endUtcIso: '2026-08-22T08:32:15.500Z',
    });

    assert.deepEqual(calculateUtcElapsedSeconds(
        '2026-08-22T08:30:45.000Z',
        '2026-08-22T08:29:45.000Z',
    ), {
        status: 'backwards',
        elapsedSeconds: 0,
        rawElapsedSeconds: -60,
        startUtcIso: '2026-08-22T08:30:45.000Z',
        endUtcIso: '2026-08-22T08:29:45.000Z',
    });

    assert.equal(calculateUtcElapsedSeconds(null, '2026-08-22T08:29:45.000Z').status, 'missing_start');
    assert.equal(calculateUtcElapsedSeconds('2026-08-22T08:30:45.000Z', undefined).status, 'missing_end');
    assert.equal(calculateUtcElapsedSeconds('not-a-date', '2026-08-22T08:29:45.000Z').status, 'invalid_start');
    assert.equal(calculateUtcElapsedSeconds('2026-08-22T08:30:45.000Z', '2026-08-22T10:30:45.000+02:00').status, 'invalid_end');
    assert.equal(calculateUtcElapsedSeconds('2026-08-22T00:00:00.000Z', '2026-09-21T00:00:00.000Z').elapsedSeconds, 30 * 24 * 60 * 60);
});

test('lifecycle boundaries expose UTC suspend and resume timestamps without granting resources', async () => {
    const { LifecycleTimeTracker, ManualTimeService } = await timeModule();
    const clock = new ManualTimeService({
        utcIso: '2026-08-22T10:00:00.000Z',
        monotonicSeconds: 100,
    });
    const lifecycle = new LifecycleTimeTracker(clock);

    const suspend = lifecycle.recordSuspend();
    clock.setUtcIso('2026-08-22T12:30:00.000Z');
    const resume = lifecycle.recordResume(suspend.persistedUtcTimestamp);

    assert.equal(suspend.persistedUtcTimestamp, '2026-08-22T10:00:00.000Z');
    assert.equal(resume.resumedAtUtc.iso, '2026-08-22T12:30:00.000Z');
    assert.equal(resume.candidateAbsence.status, 'valid');
    assert.equal(resume.candidateAbsence.elapsedSeconds, 9000);
    assert.deepEqual(lifecycle.getSnapshot(), {
        lastSuspendedAtUtcIso: '2026-08-22T10:00:00.000Z',
        lastResumedAtUtcIso: '2026-08-22T12:30:00.000Z',
    });
});

test('runtime active-session advancement uses monotonic elapsed time and ignores UTC clock jumps', async () => {
    const repo = await repository();
    const { GameRuntime } = await runtimeModule();
    const { ManualTimeService } = await timeModule();
    const state = await freshState();
    setProducerLevel(state, 'fabricator', 10);
    const clock = new ManualTimeService({
        utcIso: '2026-08-22T08:00:00.000Z',
        monotonicSeconds: 0,
    });
    const runtime = new GameRuntime(repo, state, { timeService: clock });

    clock.advanceMonotonicSeconds(5);
    const first = runtime.advanceActiveSessionFromClock();
    clock.setUtcIso('2026-08-21T08:00:00.000Z');
    clock.advanceMonotonicSeconds(2);
    const second = runtime.advanceActiveSessionFromClock();

    assert.equal(first.elapsedSeconds, 5);
    assert.equal(second.elapsedSeconds, 2);
    assert.equal(runtime.getStateSnapshot().run.industrialOutput, 140);
});

test('UTC absence does not advance temporary boost timers without monotonic active time', async () => {
    const repo = await repository();
    const { GameRuntime } = await runtimeModule();
    const { LifecycleTimeTracker, ManualTimeService } = await timeModule();
    const state = await freshState();
    setProducerLevel(state, 'fabricator', 15);
    state.run.industrialOutput = 1500;
    state.run.progressionFlags.first_robot = true;
    const clock = new ManualTimeService({
        utcIso: '2026-08-22T08:00:00.000Z',
        monotonicSeconds: 0,
    });
    const runtime = new GameRuntime(repo, state, { timeService: clock });
    const lifecycle = new LifecycleTimeTracker(clock);

    runtime.execute({ type: 'purchaseBreakthrough', breakthroughId: 'auto_feeder' });
    runtime.execute({ type: 'activateFreeOverclock' });
    const suspend = lifecycle.recordSuspend();
    clock.setUtcIso('2026-08-22T16:00:00.000Z');
    const resume = lifecycle.recordResume(suspend.persistedUtcTimestamp);
    const zeroActive = runtime.advanceActiveSessionFromClock();

    assert.equal(resume.candidateAbsence.elapsedSeconds, 8 * 60 * 60);
    assert.equal(zeroActive.elapsedSeconds, 0);
    assert.equal(runtime.getStateSnapshot().boosts.activeBoosts.free_overclock.remainingSeconds, 60);

    clock.advanceMonotonicSeconds(10);
    runtime.advanceActiveSessionFromClock();
    assert.equal(runtime.getStateSnapshot().boosts.activeBoosts.free_overclock.remainingSeconds, 50);
});

test('save metadata consumes injected UTC time through the clock boundary', async () => {
    const { assertDeserializeGameStateFromSaveJson, serializeGameStateToSaveJson } = await persistenceModule();
    const { ManualTimeService, createSaveEnvelopeMetadataFromClock } = await timeModule();
    const clock = new ManualTimeService({ utcIso: '2026-08-22T08:30:45.123Z' });
    const metadata = createSaveEnvelopeMetadataFromClock(clock, {
        gameVersion: '0.1.0-test',
        contentVersion: '0.1.0-aut-026',
    });

    const result = assertDeserializeGameStateFromSaveJson(serializeGameStateToSaveJson(await freshState(), metadata));

    assert.equal(result.envelope.savedAtUtc, '2026-08-22T08:30:45.123Z');
    assert.equal(metadata.saveVersion, 1);
});

test('dirty save scheduling can consume monotonic elapsed time from TimeService', async () => {
    const { DirtySaveTracker } = await persistenceModule();
    const { ManualTimeService } = await timeModule();
    const clock = new ManualTimeService({
        utcIso: '2026-08-22T08:00:00.000Z',
        monotonicSeconds: 0,
    });
    const tracker = new DirtySaveTracker(clock.nowMonotonicSeconds());
    const policy = { debounceSeconds: 5, periodicSeconds: 25 };

    clock.advanceMonotonicSeconds(10);
    tracker.markDirty(clock.nowMonotonicSeconds());
    clock.setUtcIso('2026-08-21T08:00:00.000Z');
    clock.advanceMonotonicSeconds(4);
    assert.deepEqual(tracker.shouldSave(clock.nowMonotonicSeconds(), policy), { shouldSave: false, reason: 'waiting' });
    clock.advanceMonotonicSeconds(1);
    assert.deepEqual(tracker.shouldSave(clock.nowMonotonicSeconds(), policy), { shouldSave: true, reason: 'debounce_elapsed' });
});

test('pure domain and economy modules do not import TimeService', async () => {
    const sourceRoots = [
        path.join(repoRoot, 'assets', 'scripts', 'domain'),
        path.join(repoRoot, 'assets', 'scripts', 'economy'),
        path.join(repoRoot, 'assets', 'scripts', 'progression'),
    ];
    const sourceFiles = (await Promise.all(sourceRoots.map(collectTypeScriptSources))).flat();

    for (const sourceFile of sourceFiles) {
        const source = await readFile(sourceFile, 'utf8');
        const relativePath = path.relative(repoRoot, sourceFile);
        assert.equal(source.includes('../time'), false, `${relativePath} imports time boundary`);
        assert.equal(source.includes('TimeService'), false, `${relativePath} imports TimeService`);
    }
});
