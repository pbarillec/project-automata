const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

async function autoFeederSaveText() {
    const { loadGameConfigFromSources } = await imp('assets/scripts/config/ConfigLoader.ts');
    const { getEmbeddedEconomyConfigSources } = await imp('assets/scripts/config/EmbeddedEconomyConfig.ts');
    const { purchaseBreakthrough } = await imp('assets/scripts/progression/index.ts');
    const { createFreshGameState } = await imp('assets/scripts/state/index.ts');
    const { serializeGameStateToSaveJson } = await imp('assets/scripts/persistence/index.ts');
    const repo = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
    const state = createFreshGameState();
    state.run.producers.fabricator = { level: 15, isUnlocked: true, isBuilt: true };
    state.run.industrialOutput = 1500;
    const purchase = purchaseBreakthrough(repo, state, 'auto_feeder');
    assert.equal(purchase.status, 'success');
    return serializeGameStateToSaveJson(purchase.state, { saveVersion: 1, gameVersion: 'test', contentVersion: repo.contentVersion, savedAtUtc: '2026-11-10T08:00:00.000Z' });
}

async function readyForAutoFeederSaveText() {
    const { createFreshGameState } = await imp('assets/scripts/state/index.ts');
    const { serializeGameStateToSaveJson } = await imp('assets/scripts/persistence/index.ts');
    const state = createFreshGameState();
    state.run.producers.fabricator = { level: 15, isUnlocked: true, isBuilt: true };
    state.run.industrialOutput = 1500;
    return serializeGameStateToSaveJson(state, { saveVersion: 1, gameVersion: 'test', contentVersion: 'test', savedAtUtc: '2026-11-10T08:00:00.000Z' });
}

/** Mirrors FirstAutomationPresentationController: sync → syncFromState, events → consumeEvents (+ focus). */
async function automationSink() {
    const { AutomationPayoffViewModel } = await imp('assets/scripts/presentation/AutomationPayoffViewModel.ts');
    const viewModel = new AutomationPayoffViewModel();
    const sink = {
        calls: [],
        focusRequests: 0,
        snapshot: null,
        syncAutomationState(state) {
            sink.calls.push(['sync', state]);
            sink.snapshot = viewModel.syncFromState(state);
        },
        consumeDomainEvents(state, events) {
            sink.calls.push(['events', state, events]);
            sink.snapshot = viewModel.consumeEvents(state, events);
            if (sink.snapshot.focusBeatRequested) {
                sink.focusRequests += 1;
                viewModel.acknowledgeFocusBeat();
            }
        },
    };
    return sink;
}

function viewSink() {
    const sink = { models: [], refresh(model) { sink.models.push(model); } };
    return sink;
}

async function setup({ files = {}, sessionOverrides = {} } = {}) {
    const { InMemorySaveStorage } = await imp('assets/scripts/persistence/index.ts');
    const { ManualTimeService } = await imp('assets/scripts/time/index.ts');
    const { bootstrapGameSession } = await imp('assets/scripts/lifecycle/index.ts');
    const { FactoryWorldStateBinding } = await imp('assets/scripts/presentation/FactoryWorldStateBinding.ts');
    const storage = new InMemorySaveStorage(files);
    const clock = new ManualTimeService({ utcIso: '2026-11-10T08:00:00.000Z', monotonicSeconds: 0 });
    const boot = await bootstrapGameSession({ storage, timeService: clock });
    assert.equal(boot.startup.ok, true);
    const real = boot.startup.session;
    const spy = { execute: [], advance: [], suspend: 0, resume: 0 };
    const session = {
        getStateSnapshot: () => real.getStateSnapshot(),
        execute: (command, options) => { spy.execute.push([command, options]); return real.execute(command, options); },
        advanceActiveSessionFromClock: (options) => { spy.advance.push(options); return real.advanceActiveSessionFromClock(options); },
        suspend: () => { spy.suspend += 1; return real.suspend(); },
        resume: () => { spy.resume += 1; return real.resume(); },
        ...sessionOverrides,
    };
    const automation = await automationSink();
    const hud = viewSink();
    const panel = viewSink();
    const errors = [];
    const binding = new FactoryWorldStateBinding({
        session,
        configRepository: boot.configRepository,
        automation,
        hud,
        panel,
        reportError: (context, error) => errors.push([context, error]),
    });
    return { binding, real, spy, automation, hud, panel, errors, clock, storage, repo: boot.configRepository };
}

test('init syncs the loaded state (not events): an Auto Feeder save is automated with no focus beat', async () => {
    const { SAVE_MAIN_NAME } = await imp('assets/scripts/persistence/index.ts');
    const { createHudViewModel } = await imp('assets/scripts/presentation/HudViewModel.ts');
    const ctx = await setup({ files: { [SAVE_MAIN_NAME]: await autoFeederSaveText() } });

    ctx.binding.init();

    assert.deepEqual(ctx.automation.calls.map(([kind]) => kind), ['sync']);
    assert.equal(ctx.automation.snapshot.automationActive, true);
    assert.equal(ctx.automation.snapshot.activityIndicatorVisible, true);
    assert.equal(ctx.automation.snapshot.focusBeatRequested, false);
    assert.equal(ctx.automation.focusRequests, 0);
    assert.equal(ctx.binding.describe().autoFeederOwned, true);
    assert.deepEqual(ctx.hud.models, [createHudViewModel(ctx.repo, ctx.real.getStateSnapshot())]);
    assert.equal(ctx.panel.models.length, 1);
    assert.equal(ctx.panel.models[0].selectedProducerId, null);
    assert.deepEqual(ctx.errors, []);
});

test('accepted submit routes through session.execute with an ordinary save and fans events out once', async () => {
    const { createHudViewModel } = await imp('assets/scripts/presentation/HudViewModel.ts');
    const { createProducerPanelViewModel } = await imp('assets/scripts/presentation/ProducerPanelViewModel.ts');
    const ctx = await setup();
    ctx.binding.init();
    ctx.binding.onSelectionChanged('fabricator');
    ctx.automation.calls.length = 0;
    ctx.hud.models.length = 0;
    ctx.panel.models.length = 0;

    const result = await ctx.binding.submit({ type: 'manualProduce' });

    assert.equal(result.execution.ok, true);
    assert.deepEqual(ctx.spy.execute, [[{ type: 'manualProduce' }, { requestOrdinarySave: true }]]);
    const eventCalls = ctx.automation.calls.filter(([kind]) => kind === 'events');
    assert.equal(eventCalls.length, 1);
    assert.deepEqual(eventCalls[0][2], result.execution.events);
    const snapshot = ctx.real.getStateSnapshot();
    assert.deepEqual(eventCalls[0][1], snapshot);
    assert.deepEqual(ctx.hud.models, [createHudViewModel(ctx.repo, snapshot)]);
    assert.deepEqual(ctx.panel.models, [createProducerPanelViewModel(ctx.repo, snapshot, 'fabricator')]);
});

test('rejected submit produces no fan-out', async () => {
    const ctx = await setup();
    ctx.binding.init();
    ctx.automation.calls.length = 0;
    ctx.hud.models.length = 0;
    ctx.panel.models.length = 0;

    const result = await ctx.binding.submit({ type: 'purchaseBreakthrough', breakthroughId: 'auto_feeder' });

    assert.equal(result.execution.ok, false);
    assert.deepEqual(ctx.automation.calls, []);
    assert.deepEqual(ctx.hud.models, []);
    assert.deepEqual(ctx.panel.models, []);
});

test('purchasing Auto Feeder through submit requests exactly one focus beat (live payoff still works)', async () => {
    const { SAVE_MAIN_NAME } = await imp('assets/scripts/persistence/index.ts');
    const ctx = await setup({ files: { [SAVE_MAIN_NAME]: await readyForAutoFeederSaveText() } });
    ctx.binding.init();
    assert.equal(ctx.automation.snapshot.automationActive, false);

    const purchase = await ctx.binding.submit({ type: 'purchaseBreakthrough', breakthroughId: 'auto_feeder' });

    assert.equal(purchase.execution.ok, true);
    assert.equal(ctx.automation.focusRequests, 1);
    assert.equal(ctx.automation.snapshot.automationActive, true);
    assert.equal(ctx.binding.describe().autoFeederOwned, true);
});

test('tick advances the active clock, fans out events and requests an ordinary save at most once per second', async () => {
    const { SAVE_MAIN_NAME } = await imp('assets/scripts/persistence/index.ts');
    const ctx = await setup({ files: { [SAVE_MAIN_NAME]: await autoFeederSaveText() } });
    ctx.binding.init();
    ctx.automation.calls.length = 0;
    ctx.hud.models.length = 0;
    const before = ctx.real.getStateSnapshot().run.industrialOutput;

    ctx.clock.advanceMonotonicSeconds(0.5);
    await ctx.binding.tick(0.5);
    ctx.clock.advanceMonotonicSeconds(0.6);
    await ctx.binding.tick(0.6);
    ctx.clock.advanceMonotonicSeconds(0.2);
    await ctx.binding.tick(0.2);

    assert.deepEqual(ctx.spy.advance, [{ requestOrdinarySave: false }, { requestOrdinarySave: true }, { requestOrdinarySave: false }]);
    assert.ok(ctx.real.getStateSnapshot().run.industrialOutput > before);
    assert.equal(ctx.automation.calls.filter(([kind]) => kind === 'events').length, 3);
    assert.equal(ctx.hud.models.length, 3);
    assert.equal(ctx.automation.focusRequests, 0);
    assert.deepEqual(ctx.errors, []);
});

test('selection change builds the panel view model for the selected producer', async () => {
    const { createProducerPanelViewModel } = await imp('assets/scripts/presentation/ProducerPanelViewModel.ts');
    const ctx = await setup();
    ctx.binding.init();
    ctx.panel.models.length = 0;

    ctx.binding.onSelectionChanged('fabricator');

    assert.equal(ctx.binding.getSelectedProducerId(), 'fabricator');
    assert.deepEqual(ctx.panel.models, [createProducerPanelViewModel(ctx.repo, ctx.real.getStateSnapshot(), 'fabricator')]);
});

test('world selection ids (zone names) resolve to producer config ids for the panel', async () => {
    const { FACTORY_WORLD_SELECTION_PRODUCER_IDS, resolveSelectedProducerId } = await imp('assets/scripts/presentation/FactoryWorldStateBinding.ts');
    const { PRODUCER_ZONE_ORDER } = await imp('tools/device/scenarios/c3_producer_selection.ts');
    const ctx = await setup();
    const producerIds = ctx.repo.listProducers().map((producer) => producer.id);
    assert.deepEqual(Object.keys(FACTORY_WORLD_SELECTION_PRODUCER_IDS), [...PRODUCER_ZONE_ORDER]);
    for (const zoneId of PRODUCER_ZONE_ORDER) assert.ok(producerIds.includes(resolveSelectedProducerId(zoneId)), zoneId);
    assert.equal(resolveSelectedProducerId('fabricator'), 'fabricator');
    assert.equal(resolveSelectedProducerId(null), null);

    ctx.binding.init();
    ctx.panel.models.length = 0;
    ctx.binding.onSelectionChanged('Fabricator');
    assert.equal(ctx.binding.getSelectedProducerId(), 'fabricator');
    assert.equal(ctx.panel.models[0].selectedProducerId, 'fabricator');
    assert.equal(ctx.panel.models[0].displayNameKey, 'producer.fabricator.name');
});

test('suspend/resume delegate to the session; ticks are inert while suspended', async () => {
    const { SAVE_MAIN_NAME } = await imp('assets/scripts/persistence/index.ts');
    const ctx = await setup();
    ctx.binding.init();

    const suspended = await ctx.binding.suspend();
    assert.equal(suspended.status, 'suspended_saved');
    assert.equal(ctx.storage.hasFile(SAVE_MAIN_NAME), true);
    assert.equal(await ctx.binding.tick(1), null);
    assert.deepEqual(ctx.spy.advance, []);
    const resumed = ctx.binding.resume();
    assert.ok(resumed);
    assert.equal(ctx.spy.suspend, 1);
    assert.equal(ctx.spy.resume, 1);
    assert.ok(await ctx.binding.tick(0.1));
});

test('errors are reported, never thrown into the frame loop', async () => {
    const boom = () => { throw new Error('boom'); };
    const ctx = await setup({
        sessionOverrides: {
            execute: async () => { throw new Error('execute failed'); },
            advanceActiveSessionFromClock: async () => { throw new Error('advance failed'); },
            suspend: async () => { throw new Error('suspend failed'); },
            resume: boom,
        },
    });
    ctx.binding.init();
    ctx.hud.refresh = boom;

    assert.equal(await ctx.binding.submit({ type: 'manualProduce' }), null);
    assert.equal(await ctx.binding.tick(1), null);
    assert.equal(await ctx.binding.suspend(), null);
    assert.equal(ctx.binding.resume(), null);
    assert.doesNotThrow(() => ctx.binding.init());
    assert.doesNotThrow(() => ctx.binding.onSelectionChanged('fabricator'));
    assert.deepEqual(ctx.errors.map(([context]) => context), ['submit', 'tick', 'suspend', 'resume', 'init']);

    const broken = await setup({ sessionOverrides: { getStateSnapshot: () => { throw new Error('snapshot failed'); } } });
    assert.deepEqual(broken.binding.describe(), { autoFeederOwned: false });
    assert.deepEqual(broken.errors.map(([context]) => context), ['describe']);
});

test('the binding keeps no GameState copy between calls', async () => {
    const ctx = await setup();
    ctx.binding.init();
    await ctx.binding.submit({ type: 'manualProduce' });
    ctx.binding.onSelectionChanged('fabricator');
    for (const value of Object.values(ctx.binding)) {
        const isState = value !== null && typeof value === 'object' && 'run' in value && 'meta' in value;
        assert.equal(isState, false);
    }
});

test('FactoryWorldStateBinding.ts is engine-free and never builds or mutates state itself', async () => {
    const source = await readFile(path.join(repoRoot, 'assets/scripts/presentation/FactoryWorldStateBinding.ts'), 'utf8');
    assert.doesNotMatch(source, /from\s+['"]cc['"]|cc\/env/);
    assert.doesNotMatch(source, /GameRuntime|createFreshGameState|executeGameCommand|cloneGameState/);
});
