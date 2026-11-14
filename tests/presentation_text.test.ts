const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const RAW_KEY = /\b[a-z_]+(\.[a-z0-9_]+)+\b/;

async function setup() {
    const [config, embedded, stateModule, hud, panel, text, localization, progression] = await Promise.all([
        imp('assets/scripts/config/ConfigLoader.ts'),
        imp('assets/scripts/config/EmbeddedEconomyConfig.ts'),
        imp('assets/scripts/state/index.ts'),
        imp('assets/scripts/presentation/HudViewModel.ts'),
        imp('assets/scripts/presentation/ProducerPanelViewModel.ts'),
        imp('assets/scripts/presentation/PresentationText.ts'),
        imp('assets/scripts/localization/index.ts'),
        imp('assets/scripts/progression/index.ts'),
    ]);
    const repository = config.loadGameConfigFromSources(embedded.getEmbeddedEconomyConfigSources());
    const reports = [];
    const used = new Set();
    const base = localization.createTextCatalogue(await readFile(path.join(repoRoot, 'localization/en.json'), 'utf8'), (report) => reports.push(report));
    // Same behaviour as the real catalogue; records which keys composition actually resolves.
    const catalogue = {
        locale: base.locale,
        has: (key) => base.has(key),
        keys: () => base.keys(),
        template: (key) => base.template(key),
        setMissingTextSink: (sink) => base.setMissingTextSink(sink),
        resolveText: (key, params) => { used.add(key); return base.resolveText(key, params); },
    };
    return { repository, reports, used, base, catalogue, stateModule, hud, panel, text, progression };
}

function stateAt(stateModule, step) {
    const state = stateModule.createFreshGameState();
    if (step === 'fresh') return state;
    state.run.producers.fabricator = { level: step === 'lv15' ? 15 : 1, isUnlocked: true, isBuilt: true };
    if (step === 'lv1' || step === 'lv15') return state;
    state.run.producers.fabricator.level = 15;
    state.run.purchasedBreakthroughIds = ['auto_feeder'];
    state.run.automation.fabricator = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: 'auto_feeder' };
    state.run.industrialOutput = 5_000;
    return state;
}

function assertNoRawKey(strings, label) {
    for (const value of strings) assert.doesNotMatch(value, RAW_KEY, `${label}: "${value}" contains a key pattern`);
}

const hudStrings = (texts) => [texts.industrialOutput, texts.productionPerSecond, texts.nextGoal, texts.nextGoalContext, texts.freeOverclock, texts.freeOverclockTimer];
const panelStrings = (texts) => [texts.name, texts.level, texts.production, texts.milestone, texts.actions.x1, texts.actions.x10, texts.actions.xMax];

test('representative HUD and panel states compose readable English with zero missing-text reports', async () => {
    const ctx = await setup();
    const { repository, catalogue, reports, stateModule, hud, panel, text } = ctx;
    for (const step of ['fresh', 'lv1', 'lv15', 'auto_feeder_owned']) {
        const state = stateAt(stateModule, step);
        assertNoRawKey(hudStrings(text.formatHudTexts(hud.createHudViewModel(repository, state), repository, catalogue)), `${step} HUD`);
        assertNoRawKey(hudStrings(text.formatHudTexts(hud.createHudViewModel(repository, state), null, catalogue)), `${step} HUD without names`);
        assertNoRawKey(panelStrings(text.formatPanelTexts(panel.createProducerPanelViewModel(repository, state, null), catalogue)), `${step} no selection`);
        for (const producer of repository.listProducers()) {
            const texts = text.formatPanelTexts(panel.createProducerPanelViewModel(repository, state, producer.id), catalogue);
            assertNoRawKey(panelStrings(texts), `${step} ${producer.id}`);
            assert.equal(texts.name, producer.name, `${producer.id} panel name equals producers.json name`);
        }
        assertNoRawKey(panelStrings(text.pendingSelectionPanelTexts('fabricator', catalogue)), `${step} pending selection`);
    }
    assertNoRawKey(hudStrings(text.defaultHudTexts(catalogue)), 'HUD defaults');
    assertNoRawKey(panelStrings(text.defaultPanelTexts(catalogue)), 'panel defaults');
    assertNoRawKey(panelStrings(text.pendingSelectionPanelTexts(null, catalogue)), 'pending none');
    assert.deepEqual(reports, []);
});

test('Next Goal names come from the catalogue: fresh, Lv1, Lv15 Auto Feeder, Assembly Station build', async () => {
    const { repository, catalogue, reports, stateModule, hud, text } = await setup();
    const goal = (step, names = repository) => text.formatHudTexts(hud.createHudViewModel(repository, stateAt(stateModule, step)), names, catalogue).nextGoal;
    assert.equal(goal('fresh'), 'Build Fabricator');
    assert.equal(goal('lv1'), 'Reach Fabricator Lv 10');
    assert.equal(goal('lv15'), 'Unlock Auto Feeder');
    assert.equal(goal('auto_feeder_owned'), 'Build Assembly Station');
    assert.equal(goal('lv15', null), 'Unlock next breakthrough');
    assert.equal(goal('auto_feeder_owned', null), 'Build next producer');
    assert.deepEqual(reports, []);
});

test('composed captions: Industrial Output, per-second, panel level, milestone and actions', async () => {
    const { repository, catalogue, stateModule, hud, panel, text } = await setup();
    const state = stateAt(stateModule, 'lv1');
    state.run.industrialOutput = 12;
    const hudTexts = text.formatHudTexts(hud.createHudViewModel(repository, state), repository, catalogue);
    assert.equal(hudTexts.industrialOutput, 'Industrial Output: 12');
    assert.match(hudTexts.productionPerSecond, /^\S+\/s$/);
    assert.equal(hudTexts.freeOverclock, 'Free Overclock: Locked');
    assert.equal(hudTexts.freeOverclockTimer, '0s');
    const panelTexts = text.formatPanelTexts(panel.createProducerPanelViewModel(repository, state, 'fabricator'), catalogue);
    assert.equal(panelTexts.name, 'Fabricator');
    assert.equal(panelTexts.level, 'Lv 1');
    assert.match(panelTexts.production, /\/s$/);
    assert.equal(panelTexts.milestone, 'Next milestone Lv 10: ×2 production (9 to go)');
    assert.match(panelTexts.actions.x1, /^Buy ×1 \S+( • Unavailable)?$/);
    assert.match(panelTexts.actions.x10, /^Buy ×10 \S+( • Unavailable)?$/);
    assert.equal(panelTexts.actions.xMax.startsWith('Buy ×MAX '), true);
    assert.deepEqual(text.defaultPanelTexts(catalogue).actions, { x1: 'Buy ×1', x10: 'Buy ×10', xMax: 'Buy ×MAX' });
    assert.equal(text.defaultPanelTexts(catalogue).name, 'Tap a producer');
});

test('coverage: every producer, breakthrough and era displayNameKey resolves', async () => {
    const { repository, base, reports } = await setup();
    const keys = [
        ...repository.listProducers().map((item) => item.displayNameKey),
        ...repository.listBreakthroughs().map((item) => item.displayNameKey),
        ...repository.listEras().map((item) => item.displayNameKey),
    ];
    assert.ok(keys.length >= 14);
    for (const key of keys) {
        assert.ok(base.has(key), key);
        assertNoRawKey([base.resolveText(key)], key);
    }
    for (const producer of repository.listProducers()) assert.equal(base.resolveText(producer.displayNameKey), producer.name);
    assert.deepEqual(reports, []);
});

test('coverage: every Next Goal semanticKey × category (named, unnamed, unknown id) resolves', async () => {
    const { repository, catalogue, reports, text } = await setup();
    const goalVm = (category, semanticKey, objective, progress = { currentValue: 1, requiredValue: 10, currentFormatted: '1', requiredFormatted: '10', ratio: 0.1 }) => ({
        id: `${category}:test`, category, semanticKey, objective: { category, ...objective }, progress,
        affordability: { state: 'not_applicable', cost: null, costFormatted: null, balance: 0, balanceFormatted: '0' },
        blocking: { state: 'unblocked', requirements: [] }, focusTarget: { kind: 'progression_target', targetKind: 'reboot_ai_core' },
    });
    const cases = [];
    for (const producer of repository.listProducers()) {
        cases.push([goalVm('producer_build', 'next_goal.producer_build', { producerId: producer.id }), `Build ${producer.name}`]);
        cases.push([goalVm('producer_milestone', 'next_goal.producer_milestone', { producerId: producer.id }), `Reach ${producer.name} Lv 10`]);
    }
    for (const breakthrough of repository.listBreakthroughs()) {
        cases.push([goalVm('breakthrough', 'next_goal.breakthrough', { breakthroughId: breakthrough.id, eligibilityStatus: 'locked' }), null]);
    }
    for (const era of repository.listEras()) cases.push([goalVm('era', 'next_goal.era', { eraId: era.id }), null]);
    cases.push([goalVm('reboot_ai_core', 'next_goal.reboot_ai_core', {}), 'Reboot Civilization']);
    cases.push([goalVm('none', 'next_goal.none', {}, null), null]);
    for (const [vm, expected] of cases) {
        const named = text.formatNextGoalText(vm, repository, catalogue);
        const unnamed = text.formatNextGoalText(vm, null, catalogue);
        const unknownId = text.formatNextGoalText({ ...vm, objective: { category: vm.category, producerId: 'nope', breakthroughId: 'nope', eraId: 'nope' } }, repository, catalogue);
        assertNoRawKey([named, unnamed, unknownId], vm.semanticKey);
        if (expected) assert.equal(named, expected);
    }
    assert.equal(text.formatNextGoalText(goalVm('future_category', 'next_goal.future', {}), repository, catalogue), 'Next Goal');
    assert.deepEqual(reports, []);
});

test('coverage: every blocking and affordability state composes a context without keys', async () => {
    const { catalogue, reports, text } = await setup();
    const base = { id: 'x', category: 'producer_build', semanticKey: 'next_goal.producer_build', objective: { category: 'producer_build' }, focusTarget: null };
    const contexts = [];
    for (const state of ['affordable', 'unaffordable']) {
        contexts.push(text.formatNextGoalContext({ ...base, progress: null, affordability: { state, cost: 10, costFormatted: '10', balance: 0, balanceFormatted: '0' }, blocking: { state: 'unblocked', requirements: [] } }, catalogue));
    }
    for (const state of ['unblocked', 'requirement_locked']) {
        contexts.push(text.formatNextGoalContext({ ...base, progress: null, affordability: { state: 'not_applicable', cost: null, costFormatted: null, balance: 0, balanceFormatted: '0' }, blocking: { state, requirements: [] } }, catalogue));
    }
    contexts.push(text.formatNextGoalContext({ ...base, progress: { currentValue: 1, requiredValue: 10, currentFormatted: '1', requiredFormatted: '10', ratio: 0.1 }, affordability: { state: 'unaffordable', cost: 5, costFormatted: '5', balance: 0, balanceFormatted: '0' }, blocking: { state: 'unblocked', requirements: [] } }, catalogue));
    assert.deepEqual(contexts, ['10 • Affordable', '10 • Not affordable', 'Ready', 'Locked', '1/10']);
    assertNoRawKey(contexts, 'context');
    assert.deepEqual(reports, []);
});

test('coverage: every Free Overclock state, including real ready/active/cooldown snapshots', async () => {
    const { repository, catalogue, reports, stateModule, hud, text, progression } = await setup();
    const states = ['locked', 'ready', 'active', 'cooldown', 'suspended'];
    const rendered = states.map((state) => text.formatFreeOverclockState(state, 2, catalogue));
    assert.deepEqual(rendered, ['Free Overclock: Locked', 'Activate Overclock', 'Free Overclock: ×2', 'Free Overclock: Cooldown', 'Free Overclock: Paused']);
    assert.equal(text.formatFreeOverclockTimer(59.2, catalogue), '60s');

    const state = stateModule.createFreshGameState();
    state.run.progressionFlags.first_robot = true;
    const seen = [];
    seen.push(text.formatHudTexts(hud.createHudViewModel(repository, state), repository, catalogue));
    state.boosts = progression.activateFreeOverclock(state).boosts;
    seen.push(text.formatHudTexts(hud.createHudViewModel(repository, state), repository, catalogue));
    state.boosts = progression.advanceTemporaryBoosts(state.boosts, 60).boosts;
    seen.push(text.formatHudTexts(hud.createHudViewModel(repository, state), repository, catalogue));
    assert.deepEqual(seen.map((texts) => texts.freeOverclock), ['Activate Overclock', 'Free Overclock: ×2', 'Free Overclock: Cooldown']);
    assert.equal(seen[1].freeOverclockTimer, '60s');
    for (const texts of seen) assertNoRawKey(hudStrings(texts), 'overclock');
    assert.deepEqual(reports, []);
});

test('coverage: every panel action labelKey, milestone key and availability resolves', async () => {
    const { catalogue, reports, text } = await setup();
    const action = (id, labelKey, isEnabled) => ({ id, labelKey, quantity: 1, cost: 10, costFormatted: '10', isAffordable: isEnabled, isEnabled, command: null });
    const vm = (milestone, enabled) => ({
        selectedProducerId: 'fabricator', displayNameKey: 'producer.fabricator.name', level: 100, status: 'available',
        productionPerSecond: 1, productionPerSecondFormatted: '1', industrialOutput: 0, industrialOutputFormatted: '0', milestone,
        actions: { x1: action('x1', 'producer_panel.buy_1', enabled), x10: action('x10', 'producer_panel.buy_10', enabled), xMax: action('xMax', 'producer_panel.buy_max', enabled) },
    });
    const complete = text.formatPanelTexts(vm({ state: 'complete', nextThreshold: null, levelsRemaining: null, benefit: null }, true), catalogue);
    const next = text.formatPanelTexts(vm({ state: 'next', nextThreshold: 25, levelsRemaining: 3, benefit: null }, false), catalogue);
    const locked = text.formatPanelTexts({ ...vm(null, false), status: 'locked', actions: null }, catalogue);
    assert.equal(complete.milestone, 'All milestones reached');
    assert.equal(next.milestone, 'Next milestone Lv 25 (3 to go)');
    assert.deepEqual(complete.actions, { x1: 'Buy ×1 10', x10: 'Buy ×10 10', xMax: 'Buy ×MAX 10' });
    assert.deepEqual(next.actions, { x1: 'Buy ×1 10 • Unavailable', x10: 'Buy ×10 10 • Unavailable', xMax: 'Buy ×MAX 10 • Unavailable' });
    assert.deepEqual(locked.actions, { x1: '—', x10: '—', xMax: '—' });
    for (const texts of [complete, next, locked]) assertNoRawKey(panelStrings(texts), 'panel');
    assert.deepEqual(reports, []);
});

test('template params match exactly what PresentationText supplies', async () => {
    const { base } = await setup();
    const { extractPlaceholders } = await imp('assets/scripts/localization/TextCatalogue.ts');
    const expected = {
        'hud.industrial_output': ['value'],
        'hud.production_per_second': ['value'],
        'hud.free_overclock.active': ['multiplier'],
        'hud.free_overclock.timer': ['seconds'],
        'next_goal.producer_build': ['name'],
        'next_goal.producer_milestone': ['name', 'level'],
        'next_goal.producer_milestone.generic': ['level'],
        'next_goal.breakthrough': ['name'],
        'next_goal.era': ['name'],
        'next_goal.progress': ['current', 'required'],
        'next_goal.cost': ['cost', 'state'],
        'producer_panel.level': ['level'],
        'producer_panel.production_per_second': ['value'],
        'producer_panel.milestone.next': ['threshold', 'remaining'],
        'producer_panel.milestone.next_with_benefit': ['threshold', 'benefit', 'remaining'],
        'producer_panel.milestone.production_multiplier': ['multiplier'],
        'producer_panel.action': ['label', 'cost'],
        'producer_panel.action.unavailable': ['label', 'cost'],
        'producer_panel.assembly_batch.ready': ['payout'],
        'producer_panel.assembly_batch.running': ['percent', 'seconds'],
        // AUT-051 Offline Factory Report.
        'offline.time_away': ['duration'],
        'offline.cap_reached': ['duration'],
        'offline.reward': ['value'],
        'offline.robots': ['count'],
        'offline.explain.manual': ['names'],
        'offline.explain.more': ['names', 'count'],
        // AUT-050 AI Upgrades.
        'upgrades.chip': ['count'],
        'upgrades.balance': ['count'],
        'upgrades.rank': ['current', 'max'],
        'upgrades.buy': ['cost'],
        'upgrades.needs': ['name', 'rank'],
        'upgrades.effect.global_production': ['percent'],
        'upgrades.effect.milestone_power': ['percent'],
        'upgrades.effect.automated_multiplier': ['multiplier'],
        'upgrades.effect.breakthrough_sooner': ['name'],
        'upgrades.effect.breakthrough_cost': ['name', 'multiplier'],
        'upgrades.effect.starts_automated': ['name'],
        'upgrades.effect.construction_cost': ['percent'],
        'upgrades.effect.major_requirement': ['percent'],
        // AUT-RBT-001 Reboot chip / modal.
        'reboot.chip': ['count'],
        'reboot.reward': ['count'],
        'reboot.civilization': ['from', 'to'],
        'reboot.progress': ['percent'],
        // AUT-052 toasts (moved from MILESTONE_TEXT_TEMPLATES, identical wording).
        'toast.producer_milestone': ['name', 'level'],
        'toast.automation': ['name'],
        'toast.producer_constructed': ['name'],
        'toast.robots_built_title': ['count'],
        'toast.extra': ['text', 'count'],
        'toast.reboot_ai_core': ['count'],
        'toast.reboot_civilization': ['number'],
    };
    for (const key of base.keys()) {
        assert.deepEqual(extractPlaceholders(base.template(key)).sort(), (expected[key] ?? []).slice().sort(), key);
    }
    for (const key of Object.keys(expected)) assert.ok(base.has(key), key);
});

test('every catalogue entry is reachable from the composition paths (no dead keys)', async () => {
    const ctx = await setup();
    const { repository, catalogue, used, base, stateModule, hud, panel, text } = ctx;
    for (const step of ['fresh', 'lv1', 'lv15', 'auto_feeder_owned']) {
        const state = stateAt(stateModule, step);
        text.formatHudTexts(hud.createHudViewModel(repository, state), repository, catalogue);
        for (const producer of [null, ...repository.listProducers().map((item) => item.id)]) {
            text.formatPanelTexts(panel.createProducerPanelViewModel(repository, state, producer), catalogue);
        }
    }
    text.defaultHudTexts(catalogue);
    text.defaultPanelTexts(catalogue);
    for (const state of ['locked', 'ready', 'active', 'cooldown', 'suspended']) text.formatFreeOverclockState(state, 2, catalogue);
    const goal = (category, semanticKey, objective) => ({ category, semanticKey, objective: { category, ...objective }, progress: { currentValue: 0, requiredValue: 1, currentFormatted: '0', requiredFormatted: '1', ratio: 0 } });
    for (const breakthrough of repository.listBreakthroughs()) text.formatNextGoalText(goal('breakthrough', 'next_goal.breakthrough', { breakthroughId: breakthrough.id }), repository, catalogue);
    for (const era of repository.listEras()) text.formatNextGoalText(goal('era', 'next_goal.era', { eraId: era.id }), repository, catalogue);
    for (const producer of repository.listProducers()) text.formatNextGoalText(goal('producer_build', 'next_goal.producer_build', { producerId: producer.id }), repository, catalogue);
    for (const [category, key] of [['producer_build', 'next_goal.producer_build'], ['producer_milestone', 'next_goal.producer_milestone'], ['breakthrough', 'next_goal.breakthrough'], ['era', 'next_goal.era']]) {
        text.formatNextGoalText(goal(category, key, {}), null, catalogue);
    }
    text.formatNextGoalText(goal('reboot_ai_core', 'next_goal.reboot_ai_core', {}), null, catalogue);
    text.formatNextGoalText(goal('none', 'next_goal.none', {}), null, catalogue);
    text.formatNextGoalText(goal('future', 'next_goal.future', {}), null, catalogue);
    const affordability = (state) => ({ state, cost: 1, costFormatted: '1', balance: 0, balanceFormatted: '0' });
    for (const state of ['affordable', 'unaffordable']) text.formatNextGoalContext({ progress: null, affordability: affordability(state), blocking: { state: 'unblocked' } }, catalogue);
    for (const state of ['unblocked', 'requirement_locked']) text.formatNextGoalContext({ progress: null, affordability: { ...affordability('not_applicable'), costFormatted: null }, blocking: { state } }, catalogue);
    text.formatPanelTexts({ selectedProducerId: 'fabricator', displayNameKey: 'producer.fabricator.name', level: 100, productionPerSecondFormatted: '0', milestone: { state: 'complete' }, actions: null }, catalogue);
    text.formatPanelTexts({ selectedProducerId: 'fabricator', displayNameKey: 'producer.fabricator.name', level: 1, productionPerSecondFormatted: '0', milestone: { state: 'next', nextThreshold: 10, levelsRemaining: 9, benefit: null }, actions: null }, catalogue);
    // AUT-GP-001 Assembly batch captions.
    for (const state of ['ready', 'running', 'hidden']) text.formatAssemblyBatchText({ state, progress: 0.4, remainingSeconds: 9, payoutFormatted: '90' }, catalogue);
    // AUT-051 Offline Factory Report: every offline.* key (cap, robots, educational with and without overflow, retry line).
    const offline = await imp('assets/scripts/presentation/OfflineReportText.ts');
    const offlineVm = await imp('assets/scripts/presentation/OfflineReportViewModel.ts');
    const producerIds = repository.listProducers().map((item) => item.id);
    for (const ids of [[], producerIds.slice(0, 2), producerIds.slice(0, 4)]) {
        offline.formatOfflineReportTexts({ ...offlineVm.HIDDEN_OFFLINE_REPORT_VIEW_MODEL, visible: true, effectiveSeconds: 12_000, capApplied: true, capSeconds: 28_800, reward: 1_200_000, robotsDelta: 3, showRobotsRow: true, notAutomatedProducerIds: ids, explainShown: true }, repository, catalogue);
    }
    offline.formatOfflineReportTexts({ ...offlineVm.HIDDEN_OFFLINE_REPORT_VIEW_MODEL, visible: true, effectiveSeconds: 12_000, reward: 5, robotsDelta: 1, showRobotsRow: true }, repository, catalogue);
    offline.formatOfflineCollectFailed(catalogue);
    // AUT-050 AI Upgrades: a fresh post-Reboot meta (locked rows resolve "Needs ..."), then a maxed row ("MAX").
    const upgrades = await imp('assets/scripts/presentation/PermanentUpgradePanelViewModel.ts');
    for (const ranks of [{}, { optimized_fabrication: 3 }]) {
        const meta = stateModule.createFreshGameState();
        meta.meta.civilizationNumber = 2;
        meta.meta.aiCores = 6;
        meta.meta.permanentUpgradeRanks = ranks;
        upgrades.createPermanentUpgradePanelViewModel(repository, meta, catalogue);
    }
    // AUT-052 toasts: every trigger kind, the "+N" collapse, the two era cards and the three Reboot beats.
    const toast = await imp('assets/scripts/presentation/MilestoneToastText.ts');
    const eraTransition = await imp('assets/scripts/presentation/EraTransition.ts');
    const trigger = (kind, extra = {}) => ({ key: 'k', tier: 'major', kind, accent: 'amber', producerId: 'fabricator', breakthroughId: 'auto_feeder', milestoneId: null, threshold: 25, focusProducerId: null, sparks: false, pulse: false, eraId: null, focusSuppressed: false, ...extra });
    for (const kind of ['producer_milestone', 'automation', 'producer_constructed', 'breakthrough', 'robots_built', 'unknown_kind']) {
        toast.formatMilestoneToast(trigger(kind), repository, 0, catalogue);
        toast.formatMilestoneToast(trigger(kind, { producerId: null, breakthroughId: null }), null, 3, catalogue);
    }
    for (const eraId of ['automated_factory', 'robotics_complex', 'nope']) toast.formatMilestoneToast(eraTransition.buildEraTrigger(eraId) ?? trigger('era_title', { eraId }), repository, 0, catalogue);
    for (const beat of ['reboot', 'ai_core', 'civilization']) toast.formatMilestoneToast(trigger('reboot_title', { reboot: { newCivilization: 2, aiCoresGranted: 3 } }), repository, 0, catalogue, beat);
    // AUT-052 Settings panel: every settings.* key (ON and OFF, the language row).
    const settingsVm = await imp('assets/scripts/presentation/SettingsViewModel.ts');
    const userSettings = await imp('assets/scripts/settings/UserSettings.ts');
    for (const on of [true, false]) settingsVm.createSettingsViewModel({ ...userSettings.DEFAULT_USER_SETTINGS, musicEnabled: on, sfxEnabled: on, vibrationEnabled: on }, catalogue);
    // AUT-RBT-001 Reboot chip / modal: the plural and the singular reward, the progress and every list line.
    const rebootVm = await imp('assets/scripts/presentation/RebootPanelViewModel.ts');
    for (const reward of [1, 5]) {
        const rebootState = stateModule.createFreshGameState();
        rebootState.run.prestigePowerPeak = repository.getPrestigeConfig().p0PrestigePower * (reward === 1 ? 0.05 : 1.2);
        assert.equal(rebootVm.createRebootPanelViewModel(repository, rebootState, catalogue).visible, true);
    }
    assert.deepEqual(base.keys().filter((key) => !used.has(key)), []);
});

test('PresentationText.ts is engine-free and keeps view models key-based', async () => {
    const source = await readFile(path.join(repoRoot, 'assets/scripts/presentation/PresentationText.ts'), 'utf8');
    assert.doesNotMatch(source, /from\s+['"]cc(\/env)?['"]/);
    assert.match(source, /export type DisplayNameSource = Pick<GameConfigRepository, 'getProducer' \| 'getBreakthrough' \| 'getEra'>;/);
    for (const rel of ['assets/scripts/presentation/HudViewModel.ts', 'assets/scripts/presentation/ProducerPanelViewModel.ts']) {
        assert.doesNotMatch(await readFile(path.join(repoRoot, rel), 'utf8'), /localization|PresentationText/, rel);
    }
});
