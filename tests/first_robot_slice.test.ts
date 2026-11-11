const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// AUT-039 Assembly + first Worker Bot slice: pure resolver, view model, route and runtime → presentation smoke.
const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

async function economy() {
    const { loadGameConfigFromSources } = await imp('assets/scripts/config/ConfigLoader.ts');
    const { getEmbeddedEconomyConfigSources } = await imp('assets/scripts/config/EmbeddedEconomyConfig.ts');
    return loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
}

async function freshState() {
    const { createFreshGameState } = await imp('assets/scripts/state/index.ts');
    return createFreshGameState();
}

/** Assembly Station at `level`, Fabricator automated, optional Worker Bot / civilization. */
async function stateWith({ level = 0, workerBot = false, automated = workerBot, civilization = 1, output = 0 } = {}) {
    const state = await freshState();
    state.run.producers.fabricator = { level: 15, isUnlocked: true, isBuilt: true };
    state.run.purchasedBreakthroughIds = ['auto_feeder'];
    state.run.automation.fabricator = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: 'auto_feeder' };
    if (level > 0) state.run.producers.assembly_station = { level, isUnlocked: true, isBuilt: true };
    if (workerBot) {
        state.run.purchasedBreakthroughIds.push('worker_bot');
        state.run.progressionFlags.first_robot = true;
    }
    if (automated) state.run.automation.assembly_station = { isAutomated: true, isOfflineEligible: false, unlockedByBreakthroughId: workerBot ? 'worker_bot' : null };
    state.meta.civilizationNumber = civilization;
    state.run.industrialOutput = output;
    return state;
}

test('AUT-039 Assembly resolver: unbuilt foundation, Lv1 workstation, Lv10 frontier, automated by Worker Bot', async () => {
    const { resolveAssemblyVisualState } = await imp('assets/scripts/presentation/AssemblyVisualStateResolver.ts');
    const unbuilt = resolveAssemblyVisualState(await stateWith());
    assert.equal(unbuilt.phase, 'unbuilt');
    assert.deepEqual(unbuilt.modules, []);
    assert.equal(unbuilt.placeholderVisible, true);
    assert.equal(unbuilt.robotPresent, false);

    const lv1 = resolveAssemblyVisualState(await stateWith({ level: 1 }));
    assert.equal(lv1.phase, 'workstation');
    assert.deepEqual(lv1.modules, ['foundation_slab', 'workstation_bed', 'input_corner']);
    assert.equal(lv1.placeholderVisible, false);
    assert.equal(lv1.panelLit, false);

    const lv10 = resolveAssemblyVisualState(await stateWith({ level: 10 }));
    assert.equal(lv10.phase, 'worker_bot_frontier');
    assert.deepEqual(lv10.modules, ['foundation_slab', 'workstation_bed', 'input_corner', 'assembly_arm', 'status_panel', 'robot_bay', 'storage_crate']);
    assert.equal(lv10.bayLit, false);
    assert.equal(lv10.robotPresent, false);

    const automated = resolveAssemblyVisualState(await stateWith({ level: 10, workerBot: true }));
    assert.equal(automated.phase, 'automated');
    assert.equal(automated.robotPresent, true);
    assert.equal(automated.panelLit, true);
    assert.equal(automated.bayLit, true);
    assert.deepEqual(automated.modules, lv10.modules);

    // Lv25+ states are out of scope: they keep the Lv10 composition.
    assert.deepEqual(resolveAssemblyVisualState(await stateWith({ level: 60, workerBot: true })).modules, lv10.modules);
});

test('AUT-039 Assembly resolver: Worker Templates (Worker Bot below Lv10) and A3 inherited automation', async () => {
    const { resolveAssemblyVisualState } = await imp('assets/scripts/presentation/AssemblyVisualStateResolver.ts');
    const templates = resolveAssemblyVisualState(await stateWith({ level: 5, workerBot: true }));
    assert.equal(templates.phase, 'automated');
    assert.equal(templates.robotPresent, true);
    for (const id of ['status_panel', 'robot_bay', 'storage_crate']) assert.ok(templates.modules.includes(id), id);
    assert.equal(templates.modules.includes('assembly_arm'), false);

    // A3: Assembly starts automated without the Worker Bot breakthrough → automated, but no robot.
    const inherited = resolveAssemblyVisualState(await stateWith({ level: 1, automated: true }));
    assert.equal(inherited.phase, 'automated');
    assert.equal(inherited.robotPresent, false);
    assert.equal(inherited.bayLit, false);
    assert.equal(inherited.modules.includes('robot_bay'), false);
});

test('AUT-039 view model: a loaded Worker Bot save rebuilds the loop with no reveal; projection never mutates state', async () => {
    const { FirstRobotPresentationViewModel } = await imp('assets/scripts/presentation/FirstRobotPresentationViewModel.ts');
    const owned = await stateWith({ level: 10, workerBot: true });
    const before = JSON.stringify(owned);
    const model = new FirstRobotPresentationViewModel();
    const synced = model.syncFromState(owned);
    assert.equal(synced.robotMode, 'loop');
    assert.equal(synced.revealRequested, false);
    assert.equal(synced.revealId, null);
    // A later firstRobotProduced (e.g. a duplicate delivery) never replays the reveal once the robot is in its loop.
    const later = model.consumeEvents(owned, [{ type: 'firstRobotProduced', breakthroughId: 'worker_bot' }]);
    assert.equal(later.robotMode, 'loop');
    assert.equal(later.revealRequested, false);
    assert.equal(JSON.stringify(owned), before);

    const hidden = new FirstRobotPresentationViewModel().syncFromState(await stateWith({ level: 10 }));
    assert.equal(hidden.robotMode, 'hidden');
});

test('AUT-039 view model: Civilization 1 firstRobotProduced requests exactly one reveal; Civilization 2+ skips it', async () => {
    const { FirstRobotPresentationViewModel } = await imp('assets/scripts/presentation/FirstRobotPresentationViewModel.ts');
    const event = { type: 'firstRobotProduced', breakthroughId: 'worker_bot' };
    const model = new FirstRobotPresentationViewModel();
    model.syncFromState(await stateWith({ level: 10 }));
    const owned = await stateWith({ level: 10, workerBot: true });
    const first = model.consumeEvents(owned, [event, event]);
    assert.equal(first.robotMode, 'reveal');
    assert.equal(first.revealRequested, true);
    assert.equal(first.revealId, 1);
    model.acknowledgeReveal();
    const repeated = model.consumeEvents(owned, [event]);
    assert.equal(repeated.revealRequested, false);
    assert.equal(repeated.revealId, 1);
    assert.equal(model.handledEventCount, 1);
    model.completeReveal();
    assert.equal(model.mode, 'loop');

    // Device race (AUT-039 run 1): the tick fan-out delivers the post-purchase snapshot before the purchase batch.
    const raced = new FirstRobotPresentationViewModel();
    raced.syncFromState(await stateWith({ level: 10 }));
    const tickFirst = raced.consumeEvents(owned, [{ type: 'productionGranted', amount: 1 }]);
    assert.equal(tickFirst.robotMode, 'reveal');
    assert.equal(tickFirst.revealRequested, true);
    raced.acknowledgeReveal();
    const purchaseBatch = raced.consumeEvents(owned, [event]);
    assert.equal(purchaseBatch.revealRequested, false);
    assert.equal(purchaseBatch.revealId, 1);

    // Unrelated events (no firstRobotProduced) never start a reveal.
    const quiet = new FirstRobotPresentationViewModel();
    quiet.syncFromState(await stateWith({ level: 10 }));
    assert.equal(quiet.consumeEvents(await stateWith({ level: 10 }), [{ type: 'breakthroughPurchased', breakthroughId: 'auto_feeder' }]).robotMode, 'hidden');

    // Civilization 2+: the short acknowledgement is deferred, so the robot appears in its loop with no focus beat.
    const civ2 = new FirstRobotPresentationViewModel();
    civ2.syncFromState(await stateWith({ level: 10, civilization: 2 }));
    const civ2Snapshot = civ2.consumeEvents(await stateWith({ level: 10, workerBot: true, civilization: 2 }), [event]);
    assert.equal(civ2Snapshot.robotMode, 'loop');
    assert.equal(civ2Snapshot.revealRequested, false);
    assert.equal(civ2Snapshot.civilizationNumber, 2);

    // Reboot (the run loses Worker Bot) hides the robot again.
    assert.equal(model.consumeEvents(await stateWith({ level: 0 }), []).robotMode, 'hidden');
});

test('AUT-039 runtime smoke: the Worker Bot purchase emits firstRobotProduced, creates presentation only, and a reloaded save does not replay', async () => {
    const repository = await economy();
    const { GameRuntime } = await imp('assets/scripts/runtime/index.ts');
    const { FirstRobotPresentationViewModel } = await imp('assets/scripts/presentation/FirstRobotPresentationViewModel.ts');
    const { serializeGameStateToSaveJson, deserializeGameStateFromSaveJson, CURRENT_SAVE_VERSION } = await imp('assets/scripts/persistence/index.ts');
    const cost = repository.getBreakthrough('worker_bot').cost;
    const runtime = new GameRuntime(repository, await stateWith({ level: 10, output: cost }));
    const model = new FirstRobotPresentationViewModel();
    assert.equal(model.syncFromState(runtime.getStateSnapshot()).robotMode, 'hidden');

    const beforePurchase = runtime.getStateSnapshot();
    const result = runtime.execute({ type: 'purchaseBreakthrough', breakthroughId: 'worker_bot' });
    assert.equal(result.ok, true);
    const types = result.events.map((e) => e.type);
    assert.ok(types.includes('firstRobotProduced'), types.join(','));
    const afterPurchase = runtime.getStateSnapshot();
    const frozen = JSON.stringify(afterPurchase);
    const snapshot = model.consumeEvents(afterPurchase, result.events);
    assert.equal(snapshot.robotMode, 'reveal');
    assert.equal(snapshot.revealRequested, true);
    // No economic worker entity: presentation consumption leaves the authoritative state untouched,
    // the robots counters are runtime-owned and unchanged by the reveal, and no producer was added.
    assert.equal(JSON.stringify(afterPurchase), frozen);
    assert.equal(afterPurchase.run.robotsBuilt, beforePurchase.run.robotsBuilt);
    assert.deepEqual(Object.keys(afterPurchase.run.producers).sort(), Object.keys(beforePurchase.run.producers).sort());
    assert.deepEqual(JSON.parse(JSON.stringify(runtime.getStateSnapshot())), JSON.parse(frozen));

    const json = serializeGameStateToSaveJson(afterPurchase, { saveVersion: CURRENT_SAVE_VERSION, gameVersion: '0.1.0-dev', contentVersion: repository.contentVersion, savedAtUtc: '2026-11-12T08:00:00.000Z' });
    const reloaded = deserializeGameStateFromSaveJson(json);
    assert.deepEqual(reloaded.diagnostics, []);
    const restored = new FirstRobotPresentationViewModel().syncFromState(reloaded.state);
    assert.equal(restored.robotMode, 'loop');
    assert.equal(restored.revealRequested, false);
    assert.equal(restored.assembly.phase, 'automated');
});

test('AUT-039 seeded frontier save offers Worker Bot as the Next Goal one-tap unlock', async () => {
    const repository = await economy();
    const { createHudViewModel } = await imp('assets/scripts/presentation/HudViewModel.ts');
    const { resolveNextGoalAction } = await imp('assets/scripts/presentation/CoreLoopActions.ts');
    const { buildAut039SeededState } = await imp('tools/device/scenarios/aut039_first_robot.ts');
    const action = resolveNextGoalAction(createHudViewModel(repository, buildAut039SeededState()).nextGoal);
    assert.equal(action.enabled, true);
    assert.deepEqual(action.command, { type: 'purchaseBreakthrough', breakthroughId: 'worker_bot' });
});

test('AUT-039 route: deterministic entry (ThumbsUp once, then Walking) from the bay to the station', async () => {
    const R = await imp('assets/scripts/presentation/WorkerBotRoute.ts');
    const start = R.sampleEntryPose(0);
    assert.deepEqual([start.x, start.z, start.clip, start.phase], [-3.4, 0.7, 'Robot_ThumbsUp', 'activation']);
    assert.equal(R.sampleEntryPose(R.WORKER_BOT_ACTIVATION_SECONDS - 0.01).clip, 'Robot_ThumbsUp');
    assert.equal(R.sampleEntryPose(R.WORKER_BOT_ACTIVATION_SECONDS + 0.01).clip, 'Robot_Walking');
    const end = R.sampleEntryPose(R.WORKER_BOT_ENTRY_SECONDS);
    assert.ok(Math.abs(end.x + 1.8) < 1e-9 && Math.abs(end.z + 1.3) < 1e-9, JSON.stringify(end));
    // Passes through the Art Director's bay exit (-2.6, 0.3).
    const exit = R.sampleEntryPose(R.WORKER_BOT_ACTIVATION_SECONDS + (Math.hypot(0.8, 0.4) / R.WORKER_BOT_WALK_SPEED));
    assert.ok(Math.abs(exit.x + 2.6) < 1e-9 && Math.abs(exit.z - 0.3) < 1e-9, JSON.stringify(exit));
    assert.equal(R.WORKER_BOT_REVEAL_SECONDS, 3.0);
    assert.ok(R.WORKER_BOT_REVEAL_SECONDS >= 2.5 && R.WORKER_BOT_REVEAL_SECONDS <= 3.5);
    assert.ok(R.WORKER_BOT_ENTRY_SECONDS > R.WORKER_BOT_REVEAL_SECONDS);
    assert.deepEqual(R.sampleEntryPose(1.234), R.sampleEntryPose(1.234));
});

test('AUT-039 route: closed work loop station → spine → storage → return, Idle at the station, no Running clip', async () => {
    const R = await imp('assets/scripts/presentation/WorkerBotRoute.ts');
    assert.deepEqual(R.WORKER_BOT_LOOP_ROUTE.map((s) => [s.id, s.x, s.z]), [
        ['station', -1.8, -1.3], ['spine_crossing', -1.4, -0.3], ['storage_pick', -0.8, 0.45], ['return', -1.2, -0.3],
    ]);
    const atStart = R.sampleLoopPose(0);
    assert.deepEqual([atStart.x, atStart.z, atStart.clip, atStart.headingDeg], [-1.8, -1.3, 'Robot_Idle', -90]);
    const lap = R.sampleLoopPose(R.WORKER_BOT_LOOP_SECONDS);
    assert.ok(Math.abs(lap.x + 1.8) < 1e-9 && Math.abs(lap.z + 1.3) < 1e-9);
    const clips = new Set();
    for (let t = 0; t < R.WORKER_BOT_LOOP_SECONDS; t += 0.05) {
        const pose = R.sampleLoopPose(t);
        clips.add(pose.clip);
        assert.ok(Number.isFinite(pose.y) && pose.y >= 0 && pose.y <= 0.24, `floor height ${pose.y}`);
    }
    for (let t = 0; t <= R.WORKER_BOT_ENTRY_SECONDS; t += 0.05) clips.add(R.sampleEntryPose(t).clip);
    assert.deepEqual([...clips].sort(), ['Robot_Idle', 'Robot_ThumbsUp', 'Robot_Walking']);
    const source = readFileSync(path.join(repoRoot, 'assets/scripts/presentation/WorkerBotRoute.ts'), 'utf8');
    assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, ''), /'Robot_Running'/);
});

test('AUT-039 route player: reveal → loop transition, beat end at 3.0 s, ordered arrivals even with large steps', async () => {
    const R = await imp('assets/scripts/presentation/WorkerBotRoute.ts');
    const player = new R.WorkerBotRoutePlayer();
    assert.equal(player.advance(1).mode, 'hidden');
    player.startReveal();
    const arrivals = [];
    let beatAt = null;
    let loopAt = null;
    let t = 0;
    while (t < R.WORKER_BOT_ENTRY_SECONDS + (2 * R.WORKER_BOT_LOOP_SECONDS)) {
        const step = player.advance(0.1);
        t += 0.1;
        arrivals.push(...step.arrivals);
        if (step.revealBeatEnded) beatAt = t;
        if (step.loopStarted) loopAt = t;
    }
    assert.ok(Math.abs(beatAt - 3.0) < 0.11, `beat ${beatAt}`);
    assert.ok(Math.abs(loopAt - R.WORKER_BOT_ENTRY_SECONDS) < 0.11, `loop ${loopAt}`);
    assert.deepEqual(arrivals.slice(0, 6), ['bay_exit', 'station', 'spine_crossing', 'storage_pick', 'return', 'station']);
    assert.equal(player.mode, 'loop');

    const jump = new R.WorkerBotRoutePlayer();
    jump.startLoop();
    const step = jump.advance(R.WORKER_BOT_LOOP_SECONDS * 2);
    assert.deepEqual(step.arrivals, ['spine_crossing', 'storage_pick', 'return', 'station', 'spine_crossing', 'storage_pick', 'return', 'station']);
    assert.equal(step.lap, 2);
    jump.hide();
    assert.equal(jump.pose(), null);
});

test('AUT-039 pure modules stay engine-free and never emit commands or touch the runtime', () => {
    for (const file of ['AssemblySliceLayout.ts', 'AssemblyVisualStateResolver.ts', 'FirstRobotPresentationViewModel.ts', 'WorkerBotRoute.ts']) {
        const source = readFileSync(path.join(repoRoot, 'assets/scripts/presentation', file), 'utf8');
        assert.doesNotMatch(source, /from\s+['"]cc(\/env)?['"]/, file);
        assert.doesNotMatch(source, /runtime\/|GameRuntime|GameCommand|execute\(|submit\(|commandEmitter/, file);
    }
    for (const file of ['AssemblyVisualController.ts', 'FirstRobotPresentationController.ts']) {
        const source = readFileSync(path.join(repoRoot, 'assets/scripts/presentation', file), 'utf8');
        assert.doesNotMatch(source, /runtime\/|GameRuntime|GameCommand|\.execute\(|submit\(|commandEmitter|scripts[\\/]economy|RobotPopulationController/, file);
        assert.doesNotMatch(source, /state\.run\.[a-zA-Z.]+\s*=[^=]/, file);
    }
});
