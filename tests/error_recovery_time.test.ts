// AUT-071 error handling and recovery matrix: TIME cells (clock backwards, huge forward jump, invalid / NaN timestamps, timezone change).
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

const T0 = '2026-11-10T08:00:00.000Z';
const EIGHT_HOURS_SECONDS = 8 * 60 * 60;

async function config() {
    const { loadGameConfigFromSources } = await imp('assets/scripts/config/ConfigLoader.ts');
    const { getEmbeddedEconomyConfigSources } = await imp('assets/scripts/config/EmbeddedEconomyConfig.ts');
    return loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
}

/** A state with an automated Fabricator, so a positive absence yields a positive offline reward. */
async function eligibleState() {
    const repository = await config();
    const { createFreshGameState } = await imp('assets/scripts/state/index.ts');
    const { purchaseBreakthrough } = await imp('assets/scripts/progression/index.ts');
    const state = createFreshGameState();
    state.run.producers.fabricator = { level: 15, isUnlocked: true, isBuilt: true };
    state.run.industrialOutput = 1500;
    const purchased = purchaseBreakthrough(repository, state, 'auto_feeder');
    assert.equal(purchased.status, 'success');
    return purchased.state;
}

async function saveTextAt(state, savedAtUtc, saveVersion = 3) {
    const { serializeGameStateToSaveJson } = await imp('assets/scripts/persistence/index.ts');
    return serializeGameStateToSaveJson(state, { saveVersion, gameVersion: '0.1.0-test', contentVersion: 'aut-071', savedAtUtc });
}

async function start(files, clockIso) {
    const { AtomicSaveRepository, InMemorySaveStorage, PersistenceCoordinator } = await imp('assets/scripts/persistence/index.ts');
    const { ManualTimeService } = await imp('assets/scripts/time/index.ts');
    const { LifecycleSessionCoordinator } = await imp('assets/scripts/lifecycle/index.ts');
    const storage = new InMemorySaveStorage(files);
    const clock = new ManualTimeService({ utcIso: clockIso, monotonicSeconds: 0 });
    const persistence = new PersistenceCoordinator({ repository: new AtomicSaveRepository(storage), timeService: clock, gameVersion: '0.1.0-test', contentVersion: 'aut-071' });
    const configRepository = await config();
    const startup = await LifecycleSessionCoordinator.startup({ configRepository, persistence, timeService: clock });
    return { storage, clock, persistence, configRepository, startup };
}

test('AUT-071 TIME clock moved backwards at launch: no reward, no pending report, no progression loss, play continues', async () => {
    const { SAVE_MAIN_NAME } = await imp('assets/scripts/persistence/index.ts');
    const state = await eligibleState();
    const main = await saveTextAt(state, '2026-11-10T12:00:00.000Z');
    const { startup } = await start({ [SAVE_MAIN_NAME]: main }, T0); // the clock is 4 h BEFORE the saved boundary

    assert.equal(startup.ok, true);
    assert.equal(startup.status, 'loaded_main');
    assert.equal(startup.offlinePreview.status, 'no_reward');
    assert.equal(startup.offlinePreview.utcElapsedStatus, 'backwards');
    assert.equal(startup.offlinePreview.totalIndustrialOutputReward, 0);
    assert.equal(startup.offlinePreview.effectiveOfflineSeconds, 0);
    assert.equal(startup.session.getPendingOfflinePreview(), null);
    assert.equal(startup.session.getStateSnapshot().run.industrialOutput, state.run.industrialOutput);
    const collect = await startup.session.collectPendingOffline();
    assert.equal(collect.status, 'no_pending_preview');
    const tap = await startup.session.execute({ type: 'manualProduce' });
    assert.equal(tap.execution.ok, true);
});

test('AUT-071 TIME clock moved backwards between suspend and resume: no reward, no duplicate on the next resume, nothing lost', async () => {
    const state = await eligibleState();
    const { SAVE_MAIN_NAME } = await imp('assets/scripts/persistence/index.ts');
    const { startup, clock } = await start({ [SAVE_MAIN_NAME]: await saveTextAt(state, T0) }, T0);
    assert.equal(startup.status, 'loaded_main');
    const session = startup.session;
    const before = session.getStateSnapshot().run.industrialOutput;

    clock.setUtcIso('2026-11-10T10:00:00.000Z');
    const suspended = await session.suspend();
    assert.equal(suspended.status, 'suspended_saved');
    clock.setUtcIso('2026-11-10T06:00:00.000Z'); // the clock moved back 4 h while backgrounded
    const resumed = session.resume();

    assert.equal(resumed.status, 'preview_created');
    assert.equal(resumed.offlinePreview.status, 'no_reward');
    assert.equal(resumed.offlinePreview.utcElapsedStatus, 'backwards');
    assert.equal(session.getPendingOfflinePreview(), null);
    assert.equal(session.getStateSnapshot().run.industrialOutput, before);
    assert.equal(session.resume().status, 'no_absence', 'the boundary is consumed: a second resume cannot invent a duplicate report');
});

test('AUT-071 TIME huge forward jump is capped: years of absence pay exactly the 8 hour reward and nothing more', async () => {
    const { SAVE_MAIN_NAME } = await imp('assets/scripts/persistence/index.ts');
    const state = await eligibleState();
    const main = await saveTextAt(state, T0);
    const atCap = await start({ [SAVE_MAIN_NAME]: main }, '2026-11-10T16:00:00.000Z');
    const huge = await start({ [SAVE_MAIN_NAME]: main }, '2126-11-10T08:00:00.000Z'); // +100 years
    const maxYear = await start({ [SAVE_MAIN_NAME]: main }, '9999-12-31T23:59:59.999Z');

    assert.equal(atCap.startup.offlinePreview.status, 'preview_ready');
    for (const run of [huge, maxYear]) {
        const preview = run.startup.offlinePreview;
        assert.equal(preview.status, 'preview_ready');
        assert.equal(preview.capApplied, true);
        assert.equal(preview.effectiveOfflineSeconds, EIGHT_HOURS_SECONDS);
        assert.equal(preview.totalIndustrialOutputReward, atCap.startup.offlinePreview.totalIndustrialOutputReward);
        assert.equal(preview.robotsBuiltDelta, atCap.startup.offlinePreview.robotsBuiltDelta);
    }

    // The single collect pays the capped amount once; a repeat pays nothing.
    const before = huge.startup.session.getStateSnapshot().run.industrialOutput;
    const first = await huge.startup.session.collectPendingOffline();
    const second = await huge.startup.session.collectPendingOffline();
    assert.equal(first.status, 'collected_saved');
    assert.equal(huge.startup.session.getStateSnapshot().run.industrialOutput, before + atCap.startup.offlinePreview.totalIndustrialOutputReward);
    assert.equal(second.status, 'no_pending_preview');
});

test('AUT-071 TIME a huge forward jump during an ACTIVE session changes nothing (active time is monotonic, not wall clock)', async () => {
    const { startup, clock } = await start({}, T0);
    const session = startup.session;
    const before = session.getStateSnapshot();
    clock.setUtcIso('2126-11-10T08:00:00.000Z');
    const tick = await session.advanceActiveSessionFromClock();

    assert.equal(tick.runtime.execution.ok, true);
    assert.deepEqual(session.getStateSnapshot().run.industrialOutput, before.run.industrialOutput);
});

test('AUT-071 TIME invalid / NaN / malformed UTC inputs never produce a reward or a thrown error', async () => {
    const { calculateUtcElapsedSeconds } = await imp('assets/scripts/time/index.ts');
    const { createOfflineProgressPreviewFromUtc, collectOfflineProgress } = await imp('assets/scripts/offline/index.ts');
    const repository = await config();
    const state = await eligibleState();
    const bad = ['', 'NaN', 'garbage', '2026-13-45T99:99:99.000Z', '2026-11-10T08:00:00+05:00', '2026-11-10 08:00:00', '9999-12-31T23:59:59.999+00:00', '0000-00-00T00:00:00.000Z'];

    for (const value of bad) {
        for (const [start, end] of [[value, T0], [T0, value]]) {
            const elapsed = calculateUtcElapsedSeconds(start, end);
            assert.equal(elapsed.elapsedSeconds, 0, `elapsed for ${start} -> ${end}`);
            assert.notEqual(elapsed.status, 'valid');
            const preview = createOfflineProgressPreviewFromUtc(repository, state, { persistedAtUtcIso: start, currentUtcIso: end });
            assert.equal(preview.status, 'invalid_time');
            assert.equal(preview.totalIndustrialOutputReward, 0);
            const collect = collectOfflineProgress(repository, state, { persistedAtUtcIso: start, currentUtcIso: end });
            assert.equal(collect.status, 'invalid_time');
            assert.equal('state' in collect, false, 'an invalid interval returns no state to apply');
        }
    }
    for (const missing of [null, undefined]) {
        assert.equal(createOfflineProgressPreviewFromUtc(repository, state, { persistedAtUtcIso: missing, currentUtcIso: T0 }).status, 'invalid_time');
        assert.equal(createOfflineProgressPreviewFromUtc(repository, state, { persistedAtUtcIso: T0, currentUtcIso: missing }).status, 'invalid_time');
    }
});

test('AUT-071 TIME a save whose savedAtUtc is invalid / non-canonical is unreadable (backup or fresh), never a bogus offline reward', async () => {
    const { SAVE_MAIN_NAME, SAVE_BACKUP_NAME } = await imp('assets/scripts/persistence/index.ts');
    const state = await eligibleState();
    const good = await saveTextAt(state, T0);
    for (const badStamp of ['NaN', '2026-11-10T08:00:00+05:00', '2026-13-45T00:00:00.000Z', '']) {
        const bad = JSON.stringify({ ...JSON.parse(good), savedAtUtc: badStamp });
        const withBackup = await start({ [SAVE_MAIN_NAME]: bad, [SAVE_BACKUP_NAME]: good }, '2026-11-10T09:00:00.000Z');
        assert.equal(withBackup.startup.status, 'recovered_backup', badStamp);
        assert.equal(withBackup.startup.offlinePreview.status, 'preview_ready');
        assert.equal(withBackup.startup.offlinePreview.rawAbsenceSeconds, 3600);
        const alone = await start({ [SAVE_MAIN_NAME]: bad }, '2026-11-10T09:00:00.000Z');
        assert.equal(alone.startup.status, 'fresh_game', badStamp);
        assert.equal(alone.startup.offlinePreview, null);
    }
});

test('AUT-071 TIME an unreadable wall clock at launch (NaN / out of range) still starts the session with an invalid_time preview and no reward', async () => {
    const { SAVE_MAIN_NAME } = await imp('assets/scripts/persistence/index.ts');
    const { AtomicSaveRepository, InMemorySaveStorage, PersistenceCoordinator } = await imp('assets/scripts/persistence/index.ts');
    const { ManualTimeService } = await imp('assets/scripts/time/index.ts');
    const { LifecycleSessionCoordinator } = await imp('assets/scripts/lifecycle/index.ts');
    const state = await eligibleState();
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: await saveTextAt(state, T0) });
    const clock = new ManualTimeService({ utcIso: T0, monotonicSeconds: 0 });
    clock.nowUtcIso = () => { throw new Error('Date.now() is NaN'); };
    clock.nowUtc = () => { throw new Error('Date.now() is NaN'); };
    const persistence = new PersistenceCoordinator({ repository: new AtomicSaveRepository(storage), timeService: clock, gameVersion: '0.1.0-test', contentVersion: 'aut-071' });

    const startup = await LifecycleSessionCoordinator.startup({ configRepository: await config(), persistence, timeService: clock });

    assert.equal(startup.ok, true);
    assert.equal(startup.offlinePreview.status, 'invalid_time');
    assert.equal(startup.offlinePreview.totalIndustrialOutputReward, 0);
    assert.equal(startup.session.getPendingOfflinePreview(), null);
    assert.equal(startup.session.getStateSnapshot().run.industrialOutput, state.run.industrialOutput);
});

test('AUT-071 TIME an unreadable clock turns a save into a typed failed result (nothing written, tracker stays dirty), then recovers', async () => {
    const { SAVE_MAIN_NAME } = await imp('assets/scripts/persistence/index.ts');
    const { startup, clock, storage, persistence } = await start({}, T0);
    const session = startup.session;
    const realNowIso = clock.nowUtcIso.bind(clock);
    clock.nowUtcIso = () => { throw new Error('clock broken'); };

    persistence.markDirty();
    const failed = await persistence.requestSave(session.getStateSnapshot(), { intent: 'critical', reason: 'manual' });
    assert.equal(failed.ok, false);
    assert.equal(failed.save.reason, 'clock_unavailable');
    assert.equal(storage.hasFile(SAVE_MAIN_NAME), false);

    clock.nowUtcIso = realNowIso;
    const retried = await persistence.requestSave(session.getStateSnapshot(), { intent: 'critical', reason: 'manual' });
    assert.equal(retried.ok, true);
    assert.equal(storage.hasFile(SAVE_MAIN_NAME), true);
});

test('AUT-071 TIME monotonic time never goes backwards: a regressing monotonic reading advances nothing and never throws', async () => {
    const { calculateMonotonicElapsedSeconds, calculateMonotonicElapsedMilliseconds, TimeServiceInputError } = await imp('assets/scripts/time/index.ts');
    assert.equal(calculateMonotonicElapsedSeconds(10, 4), 0);
    assert.equal(calculateMonotonicElapsedMilliseconds(10_000, 4_000), 0);
    assert.throws(() => calculateMonotonicElapsedSeconds(Number.NaN, 4), TimeServiceInputError);
});

test('AUT-071 TIME timezone change: UTC stamps are canonical Z strings in any local zone, and an offset-bearing stamp is rejected rather than shifted', () => {
    const script = [
        "import(process.argv[1]).then((time) => {",
        "const clock = new time.ManualTimeService({ utcIso: '2026-11-10T08:00:00.000Z' });",
        "const out = { iso: clock.nowUtcIso(), localHour: new Date(clock.nowUtc().unixMilliseconds).getHours() };",
        "console.log(JSON.stringify(out)); });",
    ].join(' ');
    const url = pathToFileURL(path.join(repoRoot, 'assets/scripts/time/index.ts')).href;
    const results = ['UTC', 'Asia/Kolkata', 'Pacific/Kiritimati', 'America/Los_Angeles'].map((TZ) => {
        const output = execFileSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '-e', script, url], { env: { ...process.env, TZ }, encoding: 'utf8' });
        return JSON.parse(output.trim());
    });
    for (const result of results) assert.equal(result.iso, T0);
    assert.equal(new Set(results.map((result) => result.localHour)).size > 1, true, 'the local clock really differs between the zones');
});

test('AUT-071 TIME the binding survives a throwing clock at suspend / resume: errors are reported, the session is not left paused', async () => {
    const { FactoryWorldStateBinding } = await imp('assets/scripts/presentation/FactoryWorldStateBinding.ts');
    const errors = [];
    const session = {
        getStateSnapshot: () => ({}),
        suspend: async () => { throw new Error('clock broken'); },
        resume: () => { throw new Error('clock broken'); },
        advanceActiveSessionFromClock: async () => ({ runtime: { execution: { ok: true, events: [] } }, save: null }),
    };
    const binding = new FactoryWorldStateBinding({ session, configRepository: await config(), automation: null, hud: null, panel: null, reportError: (context) => errors.push(context) });

    assert.equal(await binding.suspend(), null);
    assert.equal(await binding.tick(1), null, 'ticks are held while suspended');
    assert.equal(binding.resume(), null);
    const tick = await binding.tick(1);
    assert.notEqual(tick, null, 'a failed resume still un-pauses the session');
    assert.deepEqual(errors, ['suspend', 'resume']);
});
