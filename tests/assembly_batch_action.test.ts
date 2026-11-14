const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// AUT-GP-001: the Assembly batch action (pure view model + text + layout split + binding + thin controller).

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

async function repository() {
    const { loadGameConfigFromSources } = await imp('assets/scripts/config/ConfigLoader.ts');
    const { getEmbeddedEconomyConfigSources } = await imp('assets/scripts/config/EmbeddedEconomyConfig.ts');
    return loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
}

async function assistedState(assemblyLevel = 1) {
    const { createFreshGameState } = await imp('assets/scripts/state/index.ts');
    const state = createFreshGameState();
    state.run.producers.fabricator = { level: 15, isUnlocked: true, isBuilt: true };
    state.run.purchasedBreakthroughIds = ['auto_feeder'];
    state.run.automation.fabricator = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: 'auto_feeder' };
    if (assemblyLevel > 0) state.run.producers.assembly_station = { level: assemblyLevel, isUnlocked: true, isBuilt: true };
    return state;
}

async function vmFor(state, selected = 'assembly_station') {
    const { createAssemblyBatchViewModel } = await imp('assets/scripts/presentation/AssemblyBatchViewModel.ts');
    return createAssemblyBatchViewModel(await repository(), state, selected);
}

test('view model: hidden unless the assisted Assembly Station is selected', async () => {
    assert.equal((await vmFor(await assistedState(1), 'fabricator')).state, 'hidden');
    assert.equal((await vmFor(await assistedState(1), null)).state, 'hidden');
    const levelZero = await vmFor(await assistedState(0));
    assert.deepEqual([levelZero.state, levelZero.visible, levelZero.enabled, levelZero.command], ['hidden', false, false, null]);

    const automated = await assistedState(10);
    automated.run.purchasedBreakthroughIds.push('worker_bot');
    automated.run.automation.assembly_station = { isAutomated: true, isOfflineEligible: false, unlockedByBreakthroughId: 'worker_bot' };
    assert.equal((await vmFor(automated)).state, 'hidden', 'after Worker Bot');

    const inherited = await assistedState(1);
    inherited.meta.permanentUpgradeRanks = { cached_procedures: 1, worker_templates: 2, inherited_automation: 1 };
    assert.equal((await vmFor(inherited)).state, 'hidden', 'A3 Inherited Automation');
});

test('view model: ready emits launchAssemblyBatch with the payout preview; running shows progress and no command', async () => {
    const state = await assistedState(1);
    const ready = await vmFor(state);
    assert.deepEqual(
        { state: ready.state, visible: ready.visible, enabled: ready.enabled, payout: ready.payout, payoutFormatted: ready.payoutFormatted, command: ready.command },
        { state: 'ready', visible: true, enabled: true, payout: 90, payoutFormatted: '90', command: { type: 'launchAssemblyBatch' } },
    );

    state.run.assistedBatches.assembly_station = { durationSeconds: 15, remainingSeconds: 8.5 };
    const before = JSON.stringify(state);
    const running = await vmFor(state);
    assert.equal(JSON.stringify(state), before, 'pure: the state is never mutated');
    assert.equal(running.state, 'running');
    assert.equal(running.visible, true);
    assert.equal(running.enabled, false);
    assert.equal(running.command, null, 'no queue: a running batch exposes no command');
    assert.ok(Math.abs(running.progress - 6.5 / 15) < 1e-12);
    assert.equal(running.remainingSeconds, 9);
});

test('text: catalogue captions for ready and running, empty while hidden, no missing keys', async () => {
    const { formatAssemblyBatchText } = await imp('assets/scripts/presentation/PresentationText.ts');
    const { TextCatalogue, parseTextCatalogueDocument } = await imp('assets/scripts/localization/TextCatalogue.ts');
    const reports = [];
    const document = parseTextCatalogueDocument(read('localization/en.json'));
    const catalogue = new TextCatalogue(document, (report) => reports.push(report));
    const state = await assistedState(1);
    assert.equal(formatAssemblyBatchText(await vmFor(state), catalogue), 'Launch batch +90');
    state.run.assistedBatches.assembly_station = { durationSeconds: 15, remainingSeconds: 9 };
    assert.equal(formatAssemblyBatchText(await vmFor(state), catalogue), 'Batch 40% • 9s');
    assert.equal(formatAssemblyBatchText(await vmFor(state, 'fabricator'), catalogue), '');
    assert.deepEqual(reports, []);
});

test('layout: the batch shares the bottom primary row with Manual Produce; card size and coverage are unchanged', async () => {
    const L = await imp('assets/scripts/presentation/UiLayout.ts');
    const card = L.PRODUCER_PANEL_LAYOUT;
    const full = L.cardActionRect(card, card.primaryAction.key);
    const { primary, secondary } = L.cardPrimaryActionSplitRects(card);
    assert.equal(primary.h, full.h);
    assert.equal(secondary.h, full.h);
    assert.equal(primary.y, full.y);
    assert.equal(primary.w, secondary.w);
    assert.equal(primary.x - primary.w / 2, full.x - full.w / 2, 'Manual Produce keeps the left edge');
    assert.equal(secondary.x + secondary.w / 2, full.x + full.w / 2, 'the batch ends at the right edge');
    assert.equal((secondary.x - secondary.w / 2) - (primary.x + primary.w / 2), L.PANEL_PRIMARY_SPLIT_GAP);
    assert.ok(primary.w * 1 >= 300, 'each half stays a comfortable touch target (design units)');

    const screen = { w: 1080, h: 2412 };
    const safe = { x: 0, y: 96, w: 1080, h: 2412 - 192 };
    const layout = L.computeUiLayout(screen, safe);
    const split = L.computePanelPrimarySplitRects(screen, safe);
    assert.ok(L.rectContains(layout.panel, split.primary, 0.01));
    assert.ok(L.rectContains(layout.panel, split.secondary, 0.01));
    assert.equal(L.rectsOverlap(split.primary, split.secondary), false);
    for (const key of L.PANEL_ACTION_KEYS) assert.equal(L.rectsOverlap(layout.buttons[key], split.secondary), false, key);
    assert.ok(Math.abs(split.primary.x - layout.hudButtons.ManualProduceAction.x) < 1e-9);
    assert.ok(Math.abs(split.primary.y - layout.hudButtons.ManualProduceAction.y) < 1e-9);
});

test('binding refreshes the batch sink with the panel on init, selection and fan-out', async () => {
    const { InMemorySaveStorage, SAVE_MAIN_NAME, serializeGameStateToSaveJson } = await imp('assets/scripts/persistence/index.ts');
    const { ManualTimeService } = await imp('assets/scripts/time/index.ts');
    const { bootstrapGameSession } = await imp('assets/scripts/lifecycle/index.ts');
    const { FactoryWorldStateBinding } = await imp('assets/scripts/presentation/FactoryWorldStateBinding.ts');
    const save = serializeGameStateToSaveJson(await assistedState(1), { saveVersion: 3, gameVersion: 'test', contentVersion: 'test', savedAtUtc: '2026-11-11T08:00:00.000Z' });
    const clock = new ManualTimeService({ utcIso: '2026-11-11T08:00:00.000Z', monotonicSeconds: 0 });
    const boot = await bootstrapGameSession({ storage: new InMemorySaveStorage({ [SAVE_MAIN_NAME]: save }), timeService: clock });
    const batch = { models: [], refresh(model) { batch.models.push(model); } };
    const observed = [];
    const binding = new FactoryWorldStateBinding({
        session: boot.startup.session,
        configRepository: boot.configRepository,
        automation: null,
        hud: null,
        panel: null,
        assemblyBatch: batch,
        observeDomainEvents: (events) => observed.push(...events.map((event) => event.type)),
    });

    binding.init();
    assert.equal(batch.models.at(-1).state, 'hidden');
    binding.onSelectionChanged('AssemblyStation');
    assert.equal(batch.models.at(-1).state, 'ready');

    const launched = await binding.submit(batch.models.at(-1).command);
    assert.equal(launched.execution.ok, true);
    assert.equal(batch.models.at(-1).state, 'running');
    assert.ok(observed.includes('assistedBatchLaunched'));

    clock.advanceMonotonicSeconds(6);
    await binding.tick(6);
    assert.equal(batch.models.at(-1).state, 'running');
    assert.ok(Math.abs(batch.models.at(-1).progress - 0.4) < 1e-9);

    clock.advanceMonotonicSeconds(10);
    await binding.tick(10);
    assert.equal(batch.models.at(-1).state, 'ready', 'completed: ready to relaunch');
    assert.ok(observed.includes('assistedBatchCompleted'));
});

test('controller is thin: renders through PresentationText, emits only an enabled view-model command, no game logic', async () => {
    const source = read('assets/scripts/presentation/AssemblyBatchActionController.ts');
    assert.match(source, /this\.label!\.string = formatAssemblyBatchText\(viewModel\);/);
    assert.match(source, /if \(viewModel\?\.enabled && viewModel\.command\) this\.commandEmitter\?\.\(viewModel\.command\);/);
    assert.doesNotMatch(source, /GameRuntime|progression\/|economy\/|state\/|launchAssistedBatch|assistedBatches/);
    assert.doesNotMatch(source, /['"`][a-z_]+(\.[a-z0-9_]+)+['"`]/, 'no catalogue key literal');
    assert.doesNotMatch(source, /Launch batch|Batch /, 'no hard-coded English');
    const vm = read('assets/scripts/presentation/AssemblyBatchViewModel.ts');
    assert.doesNotMatch(vm, /from\s+['"]cc(\/env)?['"]/);
    assert.doesNotMatch(vm, /localization|PresentationText/);
    for (const rel of ['assets/scripts/presentation/AssemblyBatchActionController.ts', 'assets/scripts/presentation/AssemblyBatchViewModel.ts', 'assets/scripts/progression/AssistedProduction.ts', 'assets/scripts/economy/AssistedProduction.ts']) {
        const meta = JSON.parse(read(`${rel}.meta`));
        assert.equal(meta.importer, 'typescript', rel);
        assert.match(meta.uuid, /^[0-9a-f-]{36}$/, rel);
    }
});

test('bootstrap: the batch node sits in the panel card and is wired only at session activation', async () => {
    const source = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(source, /const batch = this\.createAssemblyBatchAction\(panel\.node\);/);
    assert.match(source, /assemblyBatch: this\.sessionWiring\?\.batch \?\? null,/);
    assert.match(source, /wiring\.batch\.commandEmitter = \(command\) => \{ void binding\.submit\(command\); \};/);
    assert.match(source, /rects\[ASSEMBLY_BATCH_ACTION_KEY\] = batchNode\?\.active \? rectOf\(batchNode\) : null;/);
    const { DEVICE_EVENT_TYPES } = await imp('assets/scripts/presentation/DeviceDiagnostics.ts');
    assert.ok(DEVICE_EVENT_TYPES.includes('assembly_batch'));
});
