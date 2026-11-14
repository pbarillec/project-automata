const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const read = (rel) => readFile(path.join(repoRoot, rel), 'utf8');
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const NOW_MS = Date.parse('2026-11-14T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const UPGRADE_IDS = ['optimized_fabrication', 'industrial_scaling', 'autonomous_optimization', 'cached_procedures', 'worker_templates', 'inherited_automation', 'compact_blueprints', 'era_compression'];

async function modules() {
    const [vm, layout, binding, seed, persistence, time, lifecycle, config, embedded, ui, diagnostics, localization, progression, reboot, state, checks, offlineVm] = await Promise.all([
        imp('assets/scripts/presentation/PermanentUpgradePanelViewModel.ts'),
        imp('assets/scripts/presentation/PermanentUpgradeLayout.ts'),
        imp('assets/scripts/presentation/FactoryWorldStateBinding.ts'),
        imp('tools/device/seed_aut050.ts'),
        imp('assets/scripts/persistence/index.ts'),
        imp('assets/scripts/time/index.ts'),
        imp('assets/scripts/lifecycle/index.ts'),
        imp('assets/scripts/config/ConfigLoader.ts'),
        imp('assets/scripts/config/EmbeddedEconomyConfig.ts'),
        imp('assets/scripts/presentation/UiLayout.ts'),
        imp('assets/scripts/presentation/DeviceDiagnostics.ts'),
        imp('assets/scripts/localization/index.ts'),
        imp('assets/scripts/progression/index.ts'),
        imp('assets/scripts/presentation/RebootPresentation.ts'),
        imp('assets/scripts/state/index.ts'),
        imp('tools/device/permanent_upgrade_checks.ts'),
        imp('assets/scripts/presentation/OfflineReportViewModel.ts'),
    ]);
    const repository = config.loadGameConfigFromSources(embedded.getEmbeddedEconomyConfigSources());
    return { vm, layout, binding, seed, persistence, time, lifecycle, config, embedded, ui, diagnostics, localization, progression, reboot, state, checks, offlineVm, repository };
}

function stateWith(m, { aiCores = 0, ranks = {}, civilization = 2 } = {}) {
    const state = m.state.createFreshGameState();
    state.meta.civilizationNumber = civilization;
    state.meta.aiCores = aiCores;
    state.meta.lifetimeAiCoresEarned = aiCores + 100;
    state.meta.permanentUpgradeRanks = { ...ranks };
    return state;
}

const rowOf = (model, id) => model.rows.find((row) => row.id === id);

// ---------------------------------------------------------------- view model

test('view model: all 8 upgrades in 3 branches with 19 ranks, rows read from the config', async () => {
    const m = await modules();
    const model = m.vm.createPermanentUpgradePanelViewModel(m.repository, stateWith(m, { aiCores: 0 }));
    assert.deepEqual(model.rows.map((row) => row.id), UPGRADE_IDS);
    assert.equal(model.rows.reduce((sum, row) => sum + row.maxRank, 0), 19);
    assert.deepEqual(model.branches.map((branch) => branch.id), ['production', 'automation', 'expansion']);
    assert.deepEqual(model.branches.map((branch) => branch.rowIds.length), [3, 3, 2]);
    assert.ok(model.branches.every((branch) => branch.rowIds.length <= 3), 'no scrolling: at most three rows per tab');
    for (const row of model.rows) {
        const config = m.repository.getPermanentUpgrade(row.id);
        assert.equal(row.nameKey, config.displayNameKey);
        assert.equal(row.branch, config.branch);
        assert.equal(row.maxRank, config.maxRank);
        assert.match(row.name, /^[A-Z][A-Za-z ]+$/, `${row.id} name is readable English, not a key`);
    }
    assert.equal(rowOf(model, 'optimized_fabrication').name, 'Optimized Fabrication');
    assert.equal(rowOf(model, 'era_compression').name, 'Era Compression');
});

test('view model: the four states come only from the authoritative rank state plus the balance', async () => {
    const m = await modules();
    const cases = [
        { aiCores: 5, ranks: {}, expect: { optimized_fabrication: 'affordable', industrial_scaling: 'locked', autonomous_optimization: 'locked', cached_procedures: 'affordable', era_compression: 'locked' } },
        { aiCores: 1, ranks: {}, expect: { optimized_fabrication: 'affordable', cached_procedures: 'insufficient', compact_blueprints: 'insufficient' } },
        { aiCores: 0, ranks: {}, expect: { optimized_fabrication: 'insufficient' } },
        { aiCores: 4, ranks: { optimized_fabrication: 2 }, expect: { optimized_fabrication: 'affordable', industrial_scaling: 'affordable', autonomous_optimization: 'insufficient' } },
        { aiCores: 9, ranks: { optimized_fabrication: 3 }, expect: { optimized_fabrication: 'maxed', autonomous_optimization: 'affordable' } },
    ];
    for (const item of cases) {
        const state = stateWith(m, item);
        const model = m.vm.createPermanentUpgradePanelViewModel(m.repository, state);
        for (const row of model.rows) {
            const rank = m.progression.evaluatePermanentUpgradeRankState(m.repository, state.meta, row.id);
            const expected = rank.status === 'max_rank' ? 'maxed' : rank.status === 'prerequisite_locked' ? 'locked' : state.meta.aiCores >= rank.nextRankCost ? 'affordable' : 'insufficient';
            assert.equal(row.state, expected, `${JSON.stringify(item)} ${row.id}`);
            assert.equal(row.currentRank, rank.currentRank);
            assert.equal(row.nextRankCost, rank.nextRankCost);
        }
        for (const [id, expected] of Object.entries(item.expect)) assert.equal(rowOf(model, id).state, expected, `${JSON.stringify(item)} ${id}`);
    }
});

test('view model: next cost advances with the rank and reads the config; a maxed row has no cost', async () => {
    const m = await modules();
    const config = m.repository.getPermanentUpgrade('optimized_fabrication');
    for (let rank = 0; rank < config.maxRank; rank += 1) {
        const row = rowOf(m.vm.createPermanentUpgradePanelViewModel(m.repository, stateWith(m, { aiCores: 99, ranks: { optimized_fabrication: rank } })), 'optimized_fabrication');
        assert.equal(row.nextRankCost, config.rankCosts[rank]);
        assert.equal(row.buyText, `${config.rankCosts[rank]} AI`);
        assert.equal(row.rankText, `Rank ${rank}/${config.maxRank}`);
        assert.deepEqual(row.command, { type: 'purchasePermanentUpgrade', upgradeId: 'optimized_fabrication' });
    }
    const maxed = rowOf(m.vm.createPermanentUpgradePanelViewModel(m.repository, stateWith(m, { aiCores: 99, ranks: { optimized_fabrication: 3 } })), 'optimized_fabrication');
    assert.equal(maxed.state, 'maxed');
    assert.equal(maxed.nextRankCost, null);
    assert.equal(maxed.buyText, 'MAX');
    assert.equal(maxed.rankText, 'Rank 3/3');
    assert.equal(maxed.command, null);
});

test('view model: locked rows resolve the missing prerequisite to a display name and rank; inert rows carry no command', async () => {
    const m = await modules();
    const model = m.vm.createPermanentUpgradePanelViewModel(m.repository, stateWith(m, { aiCores: 50, ranks: { optimized_fabrication: 1 } }));
    const ao = rowOf(model, 'autonomous_optimization');
    assert.equal(ao.state, 'locked');
    assert.deepEqual(ao.missingPrerequisites.map((p) => [p.upgradeId, p.name, p.requiredRank, p.currentRank]), [['optimized_fabrication', 'Optimized Fabrication', 2, 1]]);
    assert.equal(ao.lockedText, 'Needs Optimized Fabrication rank 2');
    assert.equal(ao.buyText, 'LOCKED');
    assert.equal(rowOf(model, 'inherited_automation').lockedText, 'Needs Worker Templates rank 2');
    assert.equal(rowOf(model, 'era_compression').lockedText, 'Needs Compact Blueprints rank 2');
    for (const row of model.rows) assert.equal(row.command !== null, row.state === 'affordable', `${row.id}: only an affordable row carries the purchase command`);
    // A locked row stays locked even with plenty of AI Cores (the balance never overrides the authoritative prerequisite).
    assert.equal(rowOf(model, 'industrial_scaling').state, 'affordable');
    const fresh = m.vm.createPermanentUpgradePanelViewModel(m.repository, stateWith(m, { aiCores: 999 }));
    assert.equal(rowOf(fresh, 'industrial_scaling').state, 'locked');
});

test('view model: tab dot (branchCanBuy) follows affordability per branch', async () => {
    const m = await modules();
    const canBuy = (state) => m.vm.createPermanentUpgradePanelViewModel(m.repository, state).branches.map((branch) => branch.canBuy);
    assert.deepEqual(canBuy(stateWith(m, { aiCores: 0 })), [false, false, false]);
    assert.deepEqual(canBuy(stateWith(m, { aiCores: 1 })), [true, false, false]);
    assert.deepEqual(canBuy(stateWith(m, { aiCores: 2 })), [true, true, true]);
    assert.deepEqual(canBuy(stateWith(m, { aiCores: 99, ranks: { optimized_fabrication: 3, industrial_scaling: 3, autonomous_optimization: 2 } })), [false, true, true]);
});

test('view model: effect text is the catalogue template filled with raw per-rank config numbers (no cumulative totals)', async () => {
    const m = await modules();
    const model = m.vm.createPermanentUpgradePanelViewModel(m.repository, stateWith(m, { aiCores: 0 }));
    assert.equal(rowOf(model, 'optimized_fabrication').effectText, '+25% production per rank');
    assert.equal(rowOf(model, 'industrial_scaling').effectText, 'Milestone bonuses +20% per rank');
    assert.equal(rowOf(model, 'autonomous_optimization').effectText, 'Automated producers x1.5 per rank');
    assert.equal(rowOf(model, 'cached_procedures').effectText, 'Unlocks Auto Feeder sooner and cheaper\nAuto Feeder cost x0.5');
    assert.equal(rowOf(model, 'worker_templates').effectText, 'Unlocks Worker Bot sooner and cheaper\nWorker Bot cost x0.5');
    assert.equal(rowOf(model, 'inherited_automation').effectText, 'Assembly Station starts automated');
    assert.equal(rowOf(model, 'compact_blueprints').effectText, 'New producers cost 15% less per rank');
    assert.equal(rowOf(model, 'era_compression').effectText, 'Major unlock requirements -10% per rank');
    // The optional breakthrough cost line is the config multiplier of the rank the player gets NEXT (the last rank once maxed).
    const advanced = rowOf(m.vm.createPermanentUpgradePanelViewModel(m.repository, stateWith(m, { aiCores: 0, ranks: { cached_procedures: 1 } })), 'cached_procedures');
    assert.match(advanced.effectText, /Auto Feeder cost x0\.2$/);
    const done = rowOf(m.vm.createPermanentUpgradePanelViewModel(m.repository, stateWith(m, { aiCores: 0, ranks: { cached_procedures: 2 } })), 'cached_procedures');
    assert.match(done.effectText, /Auto Feeder cost x0\.2$/);
    // The numbers move with the config, not with the rank (no multiplying, no compounding).
    const rank3 = rowOf(m.vm.createPermanentUpgradePanelViewModel(m.repository, stateWith(m, { aiCores: 0, ranks: { optimized_fabrication: 3 } })), 'optimized_fabrication');
    assert.equal(rank3.effectText, '+25% production per rank');
    // Effects are read from a changed config value too.
    const tweaked = JSON.parse(JSON.stringify(m.repository.listPermanentUpgrades().find((u) => u.id === 'optimized_fabrication')));
    tweaked.effects[0].multiplier = 1.4;
    const text = m.vm.createPermanentUpgradePanelViewModel({ listPermanentUpgrades: () => [tweaked], getPermanentUpgrade: (id) => m.repository.getPermanentUpgrade(id), getBreakthrough: (id) => m.repository.getBreakthrough(id), getProducer: (id) => m.repository.getProducer(id) }, stateWith(m, { aiCores: 0 })).rows[0].effectText;
    assert.equal(text, '+40% production per rank');
});

test('view model: texts, chip text and balance come from the catalogue with no raw keys', async () => {
    const m = await modules();
    const model = m.vm.createPermanentUpgradePanelViewModel(m.repository, stateWith(m, { aiCores: 6 }));
    assert.deepEqual({ ...model.texts }, { title: 'AI UPGRADES', close: 'CLOSE', chip: 'AI x6', balance: 'x 6', purchaseFailed: "Couldn't buy that upgrade. Try again." });
    assert.deepEqual(model.branches.map((branch) => branch.label), ['PRODUCTION', 'AUTOMATION', 'EXPANSION']);
    assert.equal(m.vm.formatAiCoreChipText(12), 'AI x12');
    const RAW_KEY = /\b[a-z_]+(\.[a-z0-9_]+)+\b/;
    for (const row of model.rows) for (const value of [row.name, row.rankText, row.effectText, row.buyText, row.lockedText ?? '']) assert.doesNotMatch(value, RAW_KEY, value);
    const reports = [];
    const catalogue = m.localization.getDefaultTextCatalogue();
    catalogue.setMissingTextSink((report) => reports.push(report));
    m.vm.createPermanentUpgradePanelViewModel(m.repository, stateWith(m, { aiCores: 6 }), catalogue);
    catalogue.setMissingTextSink(null);
    assert.deepEqual(reports, []);
    const keys = m.localization.getDefaultTextCatalogue().keys();
    for (const id of UPGRADE_IDS) assert.ok(keys.includes(`permanent_upgrade.${id}.name`), id);
    for (const key of ['upgrades.title', 'upgrades.chip', 'upgrades.close', 'upgrades.rank', 'upgrades.buy', 'upgrades.max', 'upgrades.locked', 'upgrades.needs', 'upgrades.purchase_failed']) assert.ok(keys.includes(key), key);
    const en = JSON.parse(await read('localization/en.json'));
    assert.match(en.entries['upgrades.effect.global_production'], /per rank/);
});

test('view model sources: no Math.pow / ** on effect values, the state helper is imported, no cost or rank arithmetic', async () => {
    const vm = stripComments(await read('assets/scripts/presentation/PermanentUpgradePanelViewModel.ts'));
    const controller = stripComments(await read('assets/scripts/presentation/PermanentUpgradeController.ts'));
    const layout = stripComments(await read('assets/scripts/presentation/PermanentUpgradeLayout.ts'));
    for (const [name, source] of [['view model', vm], ['controller', controller], ['layout', layout]]) {
        assert.doesNotMatch(source, /Math\.pow|\*\*/, `${name}: no exponentiation`);
        assert.doesNotMatch(source, /rankCosts/, `${name}: costs come from evaluatePermanentUpgradeRankState`);
        assert.doesNotMatch(source, /permanentUpgradeRanks/, `${name}: ranks come from evaluatePermanentUpgradeRankState`);
    }
    assert.match(vm, /import \{[^}]*\bevaluatePermanentUpgradeRankState\b[^}]*\} from '\.\.\/progression\/index\.ts';/);
    assert.match(vm, /evaluatePermanentUpgradeRankState\(repository, state\.meta, upgrade\.id\)/);
    assert.doesNotMatch(vm, /ModifierSet|resolvePermanent|createPermanentUpgradeModifierSet|economy\//, 'no effect math module is used by the UI');
    assert.doesNotMatch(controller, /evaluatePermanentUpgradeRankState|GameState|getStateSnapshot|executeGameCommand|runtime\./);
});

// ---------------------------------------------------------------- chip visibility

test('chip visibility equals shouldShowRelaySocket(aiCores, civilization)', async () => {
    const m = await modules();
    for (const [aiCores, civilization] of [[0, 1], [1, 1], [0, 2], [6, 2], [0, 5], [3, 1]]) {
        const model = m.vm.createPermanentUpgradePanelViewModel(m.repository, stateWith(m, { aiCores, civilization }));
        assert.equal(model.chipVisible, m.reboot.shouldShowRelaySocket(aiCores, civilization), `${aiCores}/${civilization}`);
    }
    assert.equal(m.vm.createPermanentUpgradePanelViewModel(m.repository, stateWith(m, { aiCores: 0, civilization: 1 })).chipVisible, false);
    const vm = stripComments(await read('assets/scripts/presentation/PermanentUpgradePanelViewModel.ts'));
    assert.match(vm, /import \{ shouldShowRelaySocket \} from '\.\/RebootPresentation\.ts';/);
    assert.match(vm, /chipVisible: shouldShowRelaySocket\(aiCores, state\.meta\.civilizationNumber\)/);
    assert.doesNotMatch(vm, /aiCores > 0|civilizationNumber >= 2/, 'the rule is not duplicated');
});

// ---------------------------------------------------------------- purchase through the real session

async function startSession(m, variant = 'mixed', overrides = {}) {
    const text = m.seed.buildAut050SeededSave(variant, NOW_MS);
    const storage = new m.persistence.InMemorySaveStorage({ [m.persistence.SAVE_MAIN_NAME]: text });
    const clock = new m.time.ManualTimeService({ utcIso: iso(NOW_MS), monotonicSeconds: 0 });
    const boot = await m.lifecycle.bootstrapGameSession({ storage, timeService: clock });
    assert.equal(boot.startup.ok, true);
    const sink = { models: [], refresh(model) { sink.models.push(model); } };
    const results = [];
    const binding = new m.binding.FactoryWorldStateBinding({
        session: boot.startup.session,
        configRepository: boot.configRepository,
        automation: null,
        hud: null,
        panel: null,
        permanentUpgrades: sink,
        reportCommandResult: (command, result) => results.push([command, result]),
        ...overrides,
    });
    return { binding, sink, results, storage, session: boot.startup.session, repository: boot.configRepository };
}

const savedMeta = async (ctx, m) => JSON.parse(await ctx.storage.readText(m.persistence.SAVE_MAIN_NAME));

test('purchase: success through FactoryWorldStateBinding.submit and the real coordinator (balance, rank, event order, critical save, sink refresh)', async () => {
    const m = await modules();
    const ctx = await startSession(m);
    ctx.binding.init();
    const before = ctx.session.getStateSnapshot();
    assert.equal(before.meta.aiCores, 4);
    const model = ctx.sink.models.at(-1);
    const row = rowOf(model, 'industrial_scaling');
    assert.equal(row.state, 'affordable');
    const result = await ctx.binding.submit(row.command);
    assert.equal(result.execution.ok, true);
    assert.deepEqual(result.execution.events.map((event) => event.type), ['aiCoreBalanceChanged', 'permanentUpgradePurchased']);
    const [balance, purchased] = result.execution.events;
    assert.equal(balance.reason, 'permanent_upgrade_purchase');
    assert.equal(balance.delta, -row.nextRankCost);
    assert.deepEqual({ upgradeId: purchased.upgradeId, previousRank: purchased.previousRank, newRank: purchased.newRank, cost: purchased.cost }, { upgradeId: 'industrial_scaling', previousRank: 0, newRank: 1, cost: 2 });
    const after = ctx.session.getStateSnapshot();
    assert.equal(after.meta.aiCores, 2);
    assert.equal(after.meta.permanentUpgradeRanks.industrial_scaling, 1);
    assert.equal(result.save.ok, true, 'a critical save was written before the result');
    const stored = await savedMeta(ctx, m);
    assert.equal(JSON.stringify(stored).includes('"industrial_scaling":1'), true, 'the saved envelope already holds the new rank');
    assert.equal(ctx.sink.models.at(-1).aiCores, 2, 'the sink refreshed from the fresh snapshot');
    assert.equal(rowOf(ctx.sink.models.at(-1), 'industrial_scaling').rankText, 'Rank 1/3');
    assert.equal(ctx.results.length, 1, 'reportCommandResult observed the purchase once');
    assert.equal(ctx.results[0][1].execution.ok, true);
});

test('purchase: insufficient, locked and maxed submits are rejected and change no state; the view model never offers them', async () => {
    const m = await modules();
    const ctx = await startSession(m);
    ctx.binding.init();
    const snapshot = () => JSON.stringify(ctx.session.getStateSnapshot());
    const baseline = snapshot();
    const attempts = [
        ['autonomous_optimization', 'insufficient_ai_cores'],
        ['worker_templates', 'permanent_upgrade_prerequisite_locked'],
        ['era_compression', 'permanent_upgrade_prerequisite_locked'],
        ['no_such_upgrade', 'unknown_permanent_upgrade'],
    ];
    for (const [upgradeId, reason] of attempts) {
        const result = await ctx.binding.submit({ type: 'purchasePermanentUpgrade', upgradeId });
        assert.equal(result.execution.ok, false, upgradeId);
        assert.equal(result.execution.reason, reason, upgradeId);
        assert.equal(result.save, null, 'a rejection requests no save');
        assert.equal(snapshot(), baseline, `${upgradeId} changed no state`);
    }
    const model = ctx.sink.models.at(-1);
    for (const id of ['autonomous_optimization', 'worker_templates', 'era_compression']) assert.equal(rowOf(model, id).command, null);
    const maxedCtx = await startSession(m, 'maxed');
    const maxedResult = await maxedCtx.binding.submit({ type: 'purchasePermanentUpgrade', upgradeId: 'optimized_fabrication' });
    assert.equal(maxedResult.execution.ok, false);
    assert.equal(maxedResult.execution.reason, 'permanent_upgrade_max_rank');
    assert.equal(maxedCtx.session.getStateSnapshot().meta.aiCores, 6);
});

test('purchase: persistence failure still fans the in-memory change out (no rollback) and reports the failed save', async () => {
    const m = await modules();
    const ctx = await startSession(m);
    ctx.binding.init();
    const original = ctx.session;
    const binding = new m.binding.FactoryWorldStateBinding({
        session: {
            getStateSnapshot: () => original.getStateSnapshot(),
            execute: (...args) => original.execute(...args),
            advanceActiveSessionFromClock: (...args) => original.advanceActiveSessionFromClock(...args),
            suspend: () => original.suspend(),
            resume: () => original.resume(),
            purchasePermanentUpgrade: async (id) => {
                const purchase = await original.purchasePermanentUpgrade(id);
                return { ...purchase, status: 'permanent_upgrade_persistence_failed', save: { ok: false, status: 'write_failed' } };
            },
        },
        configRepository: ctx.repository,
        automation: null,
        hud: null,
        panel: null,
        permanentUpgrades: ctx.sink,
    });
    const result = await binding.submit({ type: 'purchasePermanentUpgrade', upgradeId: 'optimized_fabrication' });
    assert.equal(result.execution.ok, true);
    assert.equal(result.save.ok, false);
    assert.equal(ctx.sink.models.at(-1).aiCores, 0, 'the sink shows the in-memory balance');
});

test('purchase: a port without the purchase transaction falls back to the normal execute path (still rejects / commits through the runtime)', async () => {
    const m = await modules();
    const ctx = await startSession(m);
    const original = ctx.session;
    const minimal = {
        getStateSnapshot: () => original.getStateSnapshot(),
        execute: (...args) => original.execute(...args),
        advanceActiveSessionFromClock: (...args) => original.advanceActiveSessionFromClock(...args),
        suspend: () => original.suspend(),
        resume: () => original.resume(),
    };
    const binding = new m.binding.FactoryWorldStateBinding({ session: minimal, configRepository: ctx.repository, automation: null, hud: null, panel: null, permanentUpgrades: ctx.sink });
    const result = await binding.submit({ type: 'purchasePermanentUpgrade', upgradeId: 'industrial_scaling' });
    assert.equal(result.execution.ok, true);
});

test('purchase: the controller guards a double tap (in-flight flag set before the emit, ignored while set), emits only the row command and ignores inert rows', async () => {
    const controller = stripComments(await read('assets/scripts/presentation/PermanentUpgradeController.ts'));
    const handler = controller.slice(controller.indexOf('public onBuyPressed('), controller.indexOf('private onPurchaseResult('));
    assert.match(handler, /if \(!this\.open \|\| !viewModel \|\| this\.inFlight\) return;/);
    assert.match(handler, /if \(!row \|\| row\.command === null\) return;/);
    assert.ok(handler.indexOf('this.inFlight = true') < handler.indexOf('emitter(row.command)'), 'the guard is set before the command leaves');
    assert.equal((controller.match(/emitter\(/g) ?? []).length, 1, 'one submit site');
    assert.match(controller, /this\.inFlight = false;/);
    assert.match(controller, /view\.button\.interactable = row\.state === 'affordable' && row\.command !== null;/, 'insufficient / maxed / locked rows are inert');
    // The only command the panel ever emits is the one the view model put on the row.
    assert.doesNotMatch(controller, /type: 'purchasePermanentUpgrade'/);
    assert.doesNotMatch(controller, /confirm/i, 'one tap, no confirm dialog');
    // Failure keeps the panel open and shows the note.
    const result = controller.slice(controller.indexOf('private onPurchaseResult('), controller.indexOf('private openPanel('));
    assert.match(result, /this\.note = this\.viewModel\?\.texts\.purchaseFailed/);
    assert.doesNotMatch(result, /closePanel/);
});

// ---------------------------------------------------------------- layout

const SCREENS = [
    { name: '720x1280', w: 720, h: 1280, safe: null },
    { name: '1080x1920', w: 1080, h: 1920, safe: null },
    { name: '1080x2412', w: 1080, h: 2412, safe: null },
    { name: '1272x2772', w: 1272, h: 2772, safe: null },
    { name: '1080x2412 top inset 130', w: 1080, h: 2412, safe: { x: 0, y: 0, w: 1080, h: 2412 - 130 } },
    { name: '1080x2412 symmetric inset 130', w: 1080, h: 2412, safe: { x: 0, y: 130, w: 1080, h: 2412 - 260 } },
];

for (const screen of SCREENS) {
    test(`layout ${screen.name}: panel inside the safe area and the factory band, clear of HUD / panel rects; chip clear of HUD, Overclock and Next Goal`, async () => {
        const m = await modules();
        const safe = screen.safe ?? { x: 0, y: 0, w: screen.w, h: screen.h };
        const base = m.ui.computeUiLayout({ w: screen.w, h: screen.h }, screen.safe ?? undefined);
        const r = m.layout.computePermanentUpgradeRects({ w: screen.w, h: screen.h }, screen.safe ?? undefined);
        const where = screen.name;
        const protectedRects = [base.hud, base.panel, ...Object.values(base.hudButtons), ...Object.values(base.buttons), ...Object.values(base.rows.hud), ...Object.values(base.rows.panel)];
        // Panel.
        assert.ok(m.ui.rectContains(safe, r.panel, 1e-6), `${where}: panel inside the safe area`);
        assert.ok(m.ui.rectContains(r.factoryBand, r.panel, 1e-6), `${where}: panel inside the factory band`);
        assert.ok(r.panel.h <= r.factoryBand.h * m.layout.PERMANENT_UPGRADE_PANEL_MAX_BAND_RATIO + 1e-6, `${where}: panel <= 75% of the band (${r.panel.h} vs ${r.factoryBand.h})`);
        for (const rect of protectedRects) assert.equal(m.ui.rectsOverlap(r.panel, rect), false, `${where}: panel overlaps a HUD / panel rect`);
        assert.ok(Math.abs(r.panel.y + r.panel.h / 2 - (r.factoryBand.y + r.factoryBand.h / 2)) < 1e-6, `${where}: centred in the factory band`);
        assert.ok(r.panel.w / r.scale >= 620 && r.panel.w / r.scale <= 680, `${where}: width about 640`);
        // Controls inside the panel, big enough, not overlapping each other.
        const controls = [r.close, ...r.tabs, ...r.rows, ...r.buys];
        for (const rect of controls) assert.ok(m.ui.rectContains(r.panel, rect, 1e-6), `${where}: control inside the panel`);
        for (const rect of [r.close, ...r.tabs, ...r.buys]) assert.ok(rect.h / r.scale >= m.layout.PERMANENT_UPGRADE_MIN_BUTTON_HEIGHT - 1e-9, `${where}: button >= 64 design units tall`);
        for (const rect of r.buys) assert.ok(rect.w / r.scale >= 150 - 1e-9, `${where}: buy >= 150 wide`);
        for (const rect of r.tabs) assert.ok(rect.w / r.scale >= 195, `${where}: tab wide enough for the label`);
        const buttons = [r.close, ...r.tabs, ...r.buys];
        buttons.forEach((a, i) => buttons.slice(i + 1).forEach((b) => assert.equal(m.ui.rectsOverlap(a, b), false, `${where}: buttons overlap`)));
        r.buys.forEach((buy, i) => assert.ok(m.ui.rectContains(r.rows[i], buy, 1e-6), `${where}: buy ${i} inside its row`));
        assert.equal(r.rows.length, 3, `${where}: at most three rows per tab`);
        assert.equal(r.tabs.length, 3);
        assert.deepEqual(r.backdrop, { x: 0, y: 0, w: screen.w, h: screen.h });
        // Chip.
        assert.ok(m.ui.rectContains(safe, r.chip, 1e-6), `${where}: chip inside the safe area`);
        assert.ok(m.ui.rectContains(r.factoryBand, r.chip, 1e-6), `${where}: chip inside the factory band (no added HUD height)`);
        for (const rect of protectedRects) assert.equal(m.ui.rectsOverlap(r.chip, rect), false, `${where}: chip overlaps a HUD / panel rect (Overclock rows, Next Goal button included)`);
        assert.ok(r.chip.h / r.scale >= 64 - 1e-9 && Math.abs(r.chip.w / r.scale - 150) < 1e-6, `${where}: chip 150 x 64`);
        assert.ok(Math.abs(r.chip.x + r.chip.w - (safe.x + safe.w - 16 * r.scale)) < 1e-6, `${where}: chip right-aligned at the edge margin`);
        assert.ok(Math.abs(r.chip.y + r.chip.h - (base.hud.y - m.layout.PERMANENT_UPGRADE_CHIP_GAP_BELOW_HUD * r.scale)) < 1e-6, `${where}: chip directly under the HUD band`);
    });
}

test('layout: pure invariants (fonts, fixed size, AI mark geometry, pulse ring)', async () => {
    const m = await modules();
    const L = m.layout;
    const layout = L.resolvePermanentUpgradePanelLayout();
    assert.equal(layout.width, 640);
    assert.ok(layout.height <= 585, 'at most 75% of the 780-unit band at 1280');
    assert.equal(layout.rows.length, 3);
    for (const size of [L.PERMANENT_UPGRADE_NAME_FONT_SIZE, L.PERMANENT_UPGRADE_RANK_FONT_SIZE, L.PERMANENT_UPGRADE_EFFECT_FONT_SIZE, L.PERMANENT_UPGRADE_TAB_FONT_SIZE, L.PERMANENT_UPGRADE_BUY_FONT_SIZE, L.PERMANENT_UPGRADE_HEADER_FONT_SIZE, L.PERMANENT_UPGRADE_CHIP_FONT_SIZE]) assert.ok(size >= L.PERMANENT_UPGRADE_MIN_BODY_FONT_SIZE, `font ${size} >= 20`);
    assert.ok(L.PERMANENT_UPGRADE_CLOSE_FONT_SIZE >= L.PERMANENT_UPGRADE_MIN_CLOSE_FONT_SIZE);
    assert.ok(L.PERMANENT_UPGRADE_BALANCE_FONT_SIZE >= 32);
    assert.ok(L.PERMANENT_UPGRADE_EFFECT_LINE_HEIGHT * 2 <= layout.rows[0].effect.h, 'two effect lines fit their box');
    assert.ok(layout.mark.w >= 32);
    // Header: the title and the balance never overlap.
    assert.ok(layout.title.x + layout.title.w / 2 <= layout.mark.x - layout.mark.w / 2 + 1e-9);
    assert.ok(layout.mark.x + layout.mark.w / 2 <= layout.balance.x - layout.balance.w / 2 + 1e-9);
    const mark = L.aiMarkGeometry(0, 0, 34);
    assert.equal(mark.hexOuter.length, 6);
    assert.equal(mark.hexInner.length, 6);
    assert.equal(mark.diamond.length, 4);
    assert.ok(Math.hypot(mark.hexInner[0].x, mark.hexInner[0].y) < Math.hypot(mark.hexOuter[0].x, mark.hexOuter[0].y));
    const target = { x: 0, y: 0, w: 600, h: 100 };
    assert.equal(L.pulseRingBars(target, 0).length, 4);
    assert.deepEqual(L.pulseRingBars(target, 1), []);
    assert.ok(L.PERMANENT_UPGRADE_PULSE_SECONDS <= 0.4, 'the pulse is brief');
    // Palette: never red; cyan accent and amber only for the buy.
    for (const colour of Object.values(L.PERMANENT_UPGRADE_COLORS)) assert.ok(!(colour.r > 180 && colour.g < 90 && colour.b < 90), 'no red');
    assert.deepEqual({ ...L.PERMANENT_UPGRADE_COLORS.cyan }, { r: 88, g: 170, b: 184, a: 255 });
    assert.equal(L.PERMANENT_UPGRADE_COLORS.backdrop.a, 150);
});

// ---------------------------------------------------------------- source pins

test('source pins: pure files are engine-free, explicit .ts imports, no constructor parameter properties', async () => {
    for (const name of ['PermanentUpgradePanelViewModel', 'PermanentUpgradeLayout']) {
        const source = await read(`assets/scripts/presentation/${name}.ts`);
        assert.doesNotMatch(source, /from\s+['"]cc(\/env)?['"]/, name);
        for (const match of source.matchAll(/from\s+'(\.[^']+)'/g)) assert.match(match[1], /\.ts$/, `${name} import ${match[1]}`);
        assert.doesNotMatch(source, /constructor\s*\([^)]*\b(public|private|protected|readonly)\b/, name);
    }
    for (const rel of ['tools/device/permanent_upgrade_checks.ts', 'tools/device/seed_aut050.ts']) assert.doesNotMatch(await read(rel), /from\s+['"]cc['"]/);
});

test('source pins: Graphics fills, scale visibility (no node.active), no spriteFrame-less Sprite, labels shrink with explicit line height, buttons on their own nodes', async () => {
    const source = stripComments(await read('assets/scripts/presentation/PermanentUpgradeController.ts'));
    assert.match(source, /addComponent\(Graphics\)/);
    assert.doesNotMatch(source, /Sprite/);
    assert.doesNotMatch(source, /\.active\s*=/);
    assert.doesNotMatch(source, /\bactive:\s*(true|false)/);
    assert.match(source, /setScale\(0, 0, 0\)/);
    assert.match(source, /Label\.Overflow\.SHRINK/);
    assert.match(source, /lineHeight = /);
    assert.match(source, /node\.addComponent\(Button\)/);
    assert.doesNotMatch(source, /this\.node\.addComponent\(Button\)/, 'no Button on the controller root');
    assert.doesNotMatch(source, /'AI UPGRADES'|'CLOSE'|'PRODUCTION'|Couldn|\bMAX\b/, 'no hardcoded English');
    assert.doesNotMatch(source, /GameCommand\b.*=\s*\{/, 'it builds no command');
    // Touch swallowing: backdrop (4) + card (4) + chip (4); the backdrop TOUCH_END closes the panel.
    assert.equal((source.match(/\.on\(Node\.EventType\.TOUCH_/g) ?? []).length, 12);
    assert.match(source, /backdrop\.on\(Node\.EventType\.TOUCH_END, this\.onBackdropTouchEnd, this\);/);
    // CLOSE and backdrop dismiss never depend on the in-flight purchase.
    const close = source.slice(source.indexOf('private closePanel('), source.indexOf('private onBackdropTouchEnd('));
    assert.doesNotMatch(close, /if \(this\.inFlight\)/);
    assert.match(source, /public onClosePressed\(\): void \{\s*this\.closePanel\('close_button'\);\s*\}/);
    // The brief purchase pulse is a Graphics ring (no particles / audio).
    assert.doesNotMatch(source, /ParticleSystem|AudioSource|audio/i);
    assert.match(source, /pulseRingBars\(/);
});

test('source pins: scripts have metas with unique a0500000-... uuids', async () => {
    const uuids = new Set();
    for (const name of ['PermanentUpgradePanelViewModel', 'PermanentUpgradeLayout', 'PermanentUpgradeController']) {
        const metaPath = path.join(repoRoot, `assets/scripts/presentation/${name}.ts.meta`);
        assert.ok(fs.existsSync(metaPath), `${name}.ts.meta`);
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        assert.match(meta.uuid, /^a0500000-0000-4000-8000-00000000000\d$/);
        assert.equal(meta.importer, 'typescript');
        uuids.add(meta.uuid);
    }
    assert.equal(uuids.size, 3);
    const all = new Set();
    for (const file of fs.readdirSync(path.join(repoRoot, 'assets/scripts/presentation')).filter((f) => f.endsWith('.ts.meta'))) {
        const uuid = JSON.parse(fs.readFileSync(path.join(repoRoot, 'assets/scripts/presentation', file), 'utf8')).uuid;
        assert.equal(all.has(uuid), false, `duplicate uuid ${uuid}`);
        all.add(uuid);
    }
});

test('source pins: the bootstrap wires the chip / panel through the binding; no new GameCommand; the entry point needs no HUD change', async () => {
    const bootstrap = await read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /createPermanentUpgrades\(\)/);
    assert.match(bootstrap, /permanentUpgrades: this\.sessionWiring\?\.permanentUpgrades \?\? null,/);
    assert.match(bootstrap, /wiring\.permanentUpgrades\.commandEmitter = \(command\) => binding\.submit\(command\);/);
    assert.match(bootstrap, /rects\.PermanentUpgradeChip/);
    assert.match(bootstrap, /rects\.PermanentUpgradePanel/);
    assert.match(bootstrap, /`PermanentUpgradeBuy\$\{index\}`/);
    assert.match(bootstrap, /`PermanentUpgradeTab\$\{index\}`/);
    // Below the offline card: the offline root is created last, so it stays the LAST child of the Canvas.
    assert.ok(bootstrap.indexOf('this.createPermanentUpgrades()') < bootstrap.indexOf('this.createOfflineReport()'));
    const binding = await read('assets/scripts/presentation/FactoryWorldStateBinding.ts');
    assert.match(binding, /purchasePermanentUpgrade\?\(upgradeId: string\): Promise<LifecyclePermanentUpgradePurchaseResult>;/);
    assert.match(binding, /command\.type === 'purchasePermanentUpgrade' && typeof this\.session\.purchasePermanentUpgrade === 'function'/);
    const commands = await read('assets/scripts/domain/Commands.ts');
    assert.doesNotMatch(commands, /openUpgrade|upgradePanel|respec|bulkPurchase|purchasePermanentUpgrades/i, 'no new GameCommand was added');
    assert.equal((commands.match(/'purchasePermanentUpgrade'/g) ?? []).length, 1);
    const hud = await read('assets/scripts/presentation/CoreHudController.ts');
    assert.doesNotMatch(hud, /PermanentUpgrade|AI CORES/i);
});

test('source pins: permanent_upgrades is in the diagnostics allow-list and the reveal event types; localization keys are present', async () => {
    const m = await modules();
    assert.ok(m.diagnostics.DEVICE_EVENT_TYPES.includes('permanent_upgrades'));
    const { DEFAULT_REVEAL_EVENT_TYPES } = await imp('tools/device/reveal_capture.ts');
    assert.ok(DEFAULT_REVEAL_EVENT_TYPES.includes('permanent_upgrades'));
    const lines = [];
    m.diagnostics.configureDeviceDiagnostics({ enabled: true, sink: (line) => lines.push(line) });
    m.diagnostics.emitDeviceEvent('permanent_upgrades', { phase: 'opened', aiCores: 4, chipRect: null });
    m.diagnostics.configureDeviceDiagnostics({ enabled: false });
    const parsed = m.diagnostics.parseDeviceEventLine(lines[0]);
    assert.equal(parsed.evt, 'permanent_upgrades');
    assert.equal(parsed.phase, 'opened');
    const controller = stripComments(await read('assets/scripts/presentation/PermanentUpgradeController.ts'));
    for (const phase of ['chip_shown', 'chip_hidden', 'opened', 'tab', 'row_tapped', 'purchase_result', 'closed']) assert.match(controller, new RegExp(`'${phase}'`), phase);
    for (const field of ['chipRect', 'panelRect', 'rowRects', 'buyRects', 'saveOk', 'rowState', 'upgradeId', 'aiCores', 'status', 'reason', 'texts', 'scale']) assert.match(controller, new RegExp(`\\b${field}\\b`), field);
    // Emitted only when diagnostics are enabled (DEBUG), like every device event.
    assert.match(controller, /if \(!isDeviceDiagnosticsEnabled\(\)\) return;/);
    const keys = m.localization.getDefaultTextCatalogue().keys().filter((key) => key.startsWith('upgrades.') || key.startsWith('permanent_upgrade.'));
    assert.equal(keys.length >= 29, true);
    const embedded = await read('assets/scripts/localization/EmbeddedTextCatalogue.ts');
    for (const key of keys) assert.ok(embedded.includes(key), `${key} embedded`);
});

// ---------------------------------------------------------------- device tooling

test('seed: a post-Reboot save with an unlocked affordable, an insufficient and locked rows; maxed variant; no offline card; consistent wallet', async () => {
    const m = await modules();
    assert.deepEqual([...m.seed.AUT050_SEED_VARIANTS], ['mixed', 'maxed']);
    assert.equal(m.seed.isAut050SeedVariant('maxed'), true);
    assert.equal(m.seed.isAut050SeedVariant('x'), false);
    for (const variant of m.seed.AUT050_SEED_VARIANTS) {
        const text = m.seed.buildAut050SeededSave(variant, NOW_MS + 700);
        assert.equal(JSON.parse(text).savedAtUtc, iso(NOW_MS - 5_000), `${variant}: a recent save`);
        const storage = new m.persistence.InMemorySaveStorage({ [m.persistence.SAVE_MAIN_NAME]: text });
        const boot = await m.lifecycle.bootstrapGameSession({ storage, timeService: new m.time.ManualTimeService({ utcIso: iso(NOW_MS), monotonicSeconds: 0 }) });
        assert.equal(boot.startup.ok, true, variant);
        assert.equal(boot.startup.status, 'loaded_main');
        assert.equal(m.offlineVm.createOfflineReportViewModel(boot.startup.offlinePreview).visible, false, `${variant}: no offline card over the chip`);
        const state = boot.startup.session.getStateSnapshot();
        assert.equal(state.meta.civilizationNumber, 2);
        assert.deepEqual(Object.values(state.run.automation).filter((a) => a.isAutomated), [], 'no automation');
        const model = m.vm.createPermanentUpgradePanelViewModel(boot.configRepository, state);
        assert.equal(model.chipVisible, true);
        const states = new Set(model.rows.map((row) => row.state));
        if (variant === 'mixed') {
            assert.equal(state.meta.aiCores, 4);
            assert.equal(state.meta.permanentUpgradeRanks.optimized_fabrication, 2);
            for (const expected of ['affordable', 'insufficient', 'locked']) assert.ok(states.has(expected), `${variant}: ${expected} row`);
            assert.equal(rowOf(model, 'autonomous_optimization').state, 'insufficient');
            assert.equal(rowOf(model, 'worker_templates').state, 'locked');
            assert.deepEqual(model.branches.map((branch) => branch.canBuy), [true, true, true]);
        } else {
            assert.equal(state.meta.permanentUpgradeRanks.optimized_fabrication, 3);
            assert.equal(rowOf(model, 'optimized_fabrication').state, 'maxed');
        }
        // lifetime earned covers the wallet plus the ranks already bought.
        const spent = Object.entries(state.meta.permanentUpgradeRanks).reduce((sum, [id, rank]) => sum + boot.configRepository.getPermanentUpgrade(id).rankCosts.slice(0, rank).reduce((a, b) => a + b, 0), 0);
        assert.equal(state.meta.lifetimeAiCoresEarned, state.meta.aiCores + spent);
    }
});

test('seed: seedAut050 force-stops, removes stale saves and the debug command, writes the save and relaunches', async () => {
    const m = await modules();
    const { DEBUG_COMMAND_FILE } = await imp('assets/scripts/presentation/DebugCommandFile.ts');
    const calls = [];
    const driver = {
        forceStop: async (pkg) => { calls.push(['forceStop', pkg]); },
        appDataDirectory: async () => '/data/data/pkg',
        removeAppFiles: async (pkg, paths) => { calls.push(['remove', paths]); },
        writeAppFile: async (pkg, devicePath, text) => { calls.push(['write', devicePath, JSON.parse(text).savedAtUtc]); },
        launch: async (pkg, activity) => { calls.push(['launch', pkg, activity]); },
    };
    const filesDir = await m.seed.seedAut050(driver, 'pkg', 'act', 'mixed', () => new Date(NOW_MS));
    assert.equal(filesDir, '/data/data/pkg/files/');
    assert.deepEqual(calls.map((call) => call[0]), ['forceStop', 'remove', 'write', 'launch']);
    assert.ok(calls[1][1].some((p) => p.endsWith(DEBUG_COMMAND_FILE)), 'stale debug_command.json removed');
    assert.ok(calls[1][1].some((p) => p.endsWith('save_main.json')));
    assert.deepEqual(calls[2], ['write', '/data/data/pkg/files/save_main.json', iso(NOW_MS - 5_000)]);
});

test('device: scenario, CLI and package script are registered', async () => {
    const { REVEAL_SCENARIOS } = await imp('tools/device/reveal_capture.ts');
    const scenario = REVEAL_SCENARIOS.aut050;
    assert.equal(scenario.id, 'aut050');
    assert.equal(scenario.trigger, 'none');
    assert.equal(scenario.expectPermanentUpgrades, 'purchase');
    assert.equal(scenario.expectOfflineReport, undefined);
    const cli = await read('tools/device/cli.ts');
    assert.match(cli, /command === 'seed-aut050'/);
    assert.match(cli, /seed-aut050 \[--variant mixed\|maxed\]/);
    assert.match(await read('package.json'), /"device:seed-aut050": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools\/device\/cli\.ts seed-aut050"/);
    const capture = await read('tools/device/reveal_capture.ts');
    assert.match(capture, /tapRect\('PermanentUpgradeChip'\)/);
    assert.match(capture, /tapRect\(`PermanentUpgradeBuy\$\{target\.index\}`\)/);
    assert.match(capture, /tapRect\('PermanentUpgradeTab1'\)/);
    assert.match(capture, /driver\.forceStop\(packageName\);\s*const relaunchCursor = stream\.cursor;\s*await driver\.launch\(packageName, activity\);/);
});

function ev(tMs, evt, extra = {}) { return { tMs, event: { v: 1, seq: tMs, evt, ...extra } }; }

function goodTimeline(overrides = {}) {
    const rows = [{ id: 'optimized_fabrication', state: 'affordable', cost: 4, rank: 2 }, { id: 'industrial_scaling', state: 'affordable', cost: 2, rank: 0 }, { id: 'autonomous_optimization', state: 'insufficient', cost: 5, rank: 0 }];
    const rect = { x: 10, y: 10, w: 100, h: 60 };
    const timeline = [
        ev(0, 'permanent_upgrades', { phase: 'chip_shown', aiCores: 4, chipRect: rect, ranks: { optimized_fabrication: 2 } }),
        ev(1000, 'permanent_upgrades', { phase: 'opened', tab: 'production', rows, panelRect: rect, aiCores: 4 }),
        ev(2000, 'permanent_upgrades', { phase: 'row_tapped', upgradeId: 'industrial_scaling', rowState: 'affordable', rank: 0, cost: 2, aiCores: 4 }),
        ev(2100, 'permanent_upgrades', { phase: 'purchase_result', upgradeId: 'industrial_scaling', status: 'purchased', saveOk: true, eventTypes: ['aiCoreBalanceChanged', 'permanentUpgradePurchased'], balanceDelta: -2, rank: 1, cost: 2, aiCores: 2 }),
        ev(3000, 'permanent_upgrades', { phase: 'tab', tab: 'automation', rows: [{ id: 'cached_procedures', state: 'affordable', cost: 2, rank: 0 }, { id: 'worker_templates', state: 'locked', cost: 3, rank: 0 }], aiCores: 2 }),
        ev(4000, 'capture_marker', { phase: 'relaunch' }),
        ev(9000, 'permanent_upgrades', { phase: 'chip_shown', aiCores: 2, chipRect: rect, ranks: { optimized_fabrication: 2, industrial_scaling: 1 } }),
    ];
    return timeline.filter((item) => !overrides.drop?.includes(item.event.phase)).map((item) => (overrides.patch?.[item.event.phase] ? { ...item, event: { ...item.event, ...overrides.patch[item.event.phase] } } : item));
}

test('device checks: the full chain passes; cost / balance / save / persistence regressions fail', async () => {
    const m = await modules();
    const failing = (checks) => checks.filter((c) => !c.ok).map((c) => c.id);
    assert.deepEqual(failing(m.checks.evaluatePermanentUpgrades(goodTimeline(), 'purchase')), []);
    assert.deepEqual(failing(m.checks.evaluatePermanentUpgrades(goodTimeline({ patch: { purchase_result: { cost: 3 } } }), 'purchase')), ['upgrades_purchase_cost_equals_config', 'upgrades_balance_delta_equals_minus_cost']);
    assert.deepEqual(failing(m.checks.evaluatePermanentUpgrades(goodTimeline({ patch: { purchase_result: { aiCores: 3 } } }), 'purchase')).includes('upgrades_balance_delta_equals_minus_cost'), true);
    assert.deepEqual(failing(m.checks.evaluatePermanentUpgrades(goodTimeline({ patch: { purchase_result: { eventTypes: ['permanentUpgradePurchased', 'aiCoreBalanceChanged'] } } }), 'purchase')), ['upgrades_event_order']);
    assert.deepEqual(failing(m.checks.evaluatePermanentUpgrades(goodTimeline({ patch: { purchase_result: { saveOk: false, status: 'purchased_persistence_failed' } } }), 'purchase')), ['upgrades_purchase_saved']);
    assert.ok(failing(m.checks.evaluatePermanentUpgrades(goodTimeline({ drop: ['purchase_result'] }), 'purchase')).includes('upgrades_purchase_saved'));
    assert.deepEqual(failing(m.checks.evaluatePermanentUpgrades(goodTimeline().map((item, i) => (i === 6 ? { ...item, event: { ...item.event, aiCores: 4 } } : item)), 'purchase')), ['upgrades_persisted_after_relaunch']);
    assert.deepEqual(failing(m.checks.evaluatePermanentUpgrades(goodTimeline().map((item, i) => (i === 6 ? { ...item, event: { ...item.event, ranks: { industrial_scaling: 0 } } } : item)), 'purchase')), ['upgrades_persisted_after_relaunch']);
    assert.deepEqual(failing(m.checks.evaluatePermanentUpgrades(goodTimeline({ drop: ['tab'] }), 'purchase')), ['upgrades_tab_switched_with_locked_row']);
    assert.deepEqual(failing(m.checks.evaluatePermanentUpgrades(goodTimeline({ drop: ['chip_shown'] }), 'purchase')).includes('upgrades_chip_shown_on_launch'), true);
    assert.equal(m.checks.configRankCost('industrial_scaling', 0), 2);
    assert.equal(m.checks.configRankCost('optimized_fabrication', 2), 4);
    assert.equal(m.checks.pickAffordableRow([{ id: 'a', state: 'insufficient', cost: 1 }, { id: 'b', state: 'affordable', cost: 4 }, { id: 'c', state: 'affordable', cost: 2 }]).row.id, 'c');
    assert.equal(m.checks.pickAffordableRow([{ id: 'a', state: 'locked', cost: 1 }]), null);
    const { evaluateRevealTimeline } = await imp('tools/device/reveal_capture.ts');
    const checks = evaluateRevealTimeline(goodTimeline(), { expectConstruction: null, expectFocus: false, triggered: true, frameCount: 5, expectPermanentUpgrades: 'purchase' });
    assert.deepEqual(failing(checks), []);
    assert.ok(checks.some((c) => c.id === 'upgrades_persisted_after_relaunch'));
});
