const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// AUT-UI-001: HUD view model → core-loop action mapping (Manual Produce, Next Goal unlock) and captions.
const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const RAW_KEY = /\b[a-z_]+(\.[a-z0-9_]+)+\b/;

async function setup() {
    const [config, embedded, stateModule, hud, actions, text, progression, localization] = await Promise.all([
        imp('assets/scripts/config/ConfigLoader.ts'),
        imp('assets/scripts/config/EmbeddedEconomyConfig.ts'),
        imp('assets/scripts/state/index.ts'),
        imp('assets/scripts/presentation/HudViewModel.ts'),
        imp('assets/scripts/presentation/CoreLoopActions.ts'),
        imp('assets/scripts/presentation/PresentationText.ts'),
        imp('assets/scripts/progression/index.ts'),
        imp('assets/scripts/localization/index.ts'),
    ]);
    const repository = config.loadGameConfigFromSources(embedded.getEmbeddedEconomyConfigSources());
    const autoFeederCost = repository.getBreakthrough('auto_feeder').cost;
    const reports = [];
    const catalogue = localization.createTextCatalogue(await readFile(path.join(repoRoot, 'localization/en.json'), 'utf8'), (report) => reports.push(report));
    const goalOf = (state) => hud.createHudViewModel(repository, state).nextGoal;
    const fabricatorAt = (level, output) => {
        const state = stateModule.createFreshGameState();
        state.run.producers.fabricator = { level, isUnlocked: true, isBuilt: true };
        state.run.industrialOutput = output;
        return state;
    };
    return { repository, autoFeederCost, stateModule, hud, actions, text, progression, catalogue, reports, goalOf, fabricatorAt };
}

test('Manual Produce is always visible and enabled and maps to manualProduce', async () => {
    const { actions } = await setup();
    const action = actions.resolveManualProduceAction();
    assert.deepEqual({ ...action, command: { ...action.command } }, { visible: true, enabled: true, command: { type: 'manualProduce' } });
    assert.ok(Object.isFrozen(action) && Object.isFrozen(action.command));
});

test('fresh save: the Next Goal is a producer build, so no Next Goal action is visible', async () => {
    const { actions, stateModule, goalOf } = await setup();
    const goal = goalOf(stateModule.createFreshGameState());
    assert.equal(goal.category, 'producer_build');
    assert.deepEqual(actions.resolveNextGoalAction(goal), { visible: false, enabled: false, command: null, breakthroughId: null });
});

test('locked breakthrough goal: visible but disabled (documented choice), no command', async () => {
    const { actions, goalOf, fabricatorAt, autoFeederCost } = await setup();
    // The resolver shows Auto Feeder only once it is eligible; a locked breakthrough goal is exercised with the same VM shape.
    const eligible = goalOf(fabricatorAt(15, autoFeederCost));
    const locked = { ...eligible, objective: { ...eligible.objective, eligibilityStatus: 'locked' } };
    assert.deepEqual(actions.resolveNextGoalAction(locked), { visible: true, enabled: false, command: null, breakthroughId: 'auto_feeder' });
});

test('eligible but unaffordable Auto Feeder: visible, disabled, no command', async () => {
    const { actions, goalOf, fabricatorAt, autoFeederCost } = await setup();
    const goal = goalOf(fabricatorAt(15, autoFeederCost - 1));
    assert.equal(goal.category, 'breakthrough');
    assert.equal(goal.objective.eligibilityStatus, 'eligible');
    assert.equal(goal.affordability.state, 'unaffordable');
    assert.deepEqual(actions.resolveNextGoalAction(goal), { visible: true, enabled: false, command: null, breakthroughId: 'auto_feeder' });
});

test('eligible and affordable Auto Feeder: enabled, purchaseBreakthrough with the goal breakthroughId', async () => {
    const { actions, goalOf, fabricatorAt, autoFeederCost } = await setup();
    const action = actions.resolveNextGoalAction(goalOf(fabricatorAt(15, autoFeederCost)));
    assert.equal(action.visible, true);
    assert.equal(action.enabled, true);
    assert.deepEqual({ ...action.command }, { type: 'purchaseBreakthrough', breakthroughId: 'auto_feeder' });
});

test('owned breakthrough: the action is hidden (owned goal VM and the real post-purchase goal)', async () => {
    const { actions, goalOf, fabricatorAt, autoFeederCost, repository, progression } = await setup();
    const eligible = goalOf(fabricatorAt(15, autoFeederCost));
    const owned = { ...eligible, objective: { ...eligible.objective, eligibilityStatus: 'already_owned' } };
    assert.deepEqual(actions.resolveNextGoalAction(owned), { visible: false, enabled: false, command: null, breakthroughId: null });
    const purchase = progression.purchaseBreakthrough(repository, fabricatorAt(15, autoFeederCost), 'auto_feeder');
    assert.equal(purchase.status, 'success');
    const after = goalOf(purchase.state);
    assert.notEqual(after.id, 'breakthrough:auto_feeder');
    const action = actions.resolveNextGoalAction(after);
    assert.ok(action.command === null || action.command.breakthroughId !== 'auto_feeder');
});

test('non-breakthrough categories, unknown eligibility, a missing id or no goal never produce an action', async () => {
    const { actions, goalOf, fabricatorAt, autoFeederCost } = await setup();
    const eligible = goalOf(fabricatorAt(15, autoFeederCost));
    const hidden = { visible: false, enabled: false, command: null, breakthroughId: null };
    for (const category of ['producer_build', 'producer_milestone', 'era', 'reboot_ai_core', 'none']) {
        assert.deepEqual(actions.resolveNextGoalAction({ ...eligible, category }), hidden, category);
    }
    assert.deepEqual(actions.resolveNextGoalAction({ ...eligible, objective: { ...eligible.objective, eligibilityStatus: 'unknown_breakthrough' } }), hidden);
    assert.deepEqual(actions.resolveNextGoalAction({ ...eligible, objective: { category: 'breakthrough', eligibilityStatus: 'eligible' } }), hidden);
    assert.deepEqual(actions.resolveNextGoalAction(null), hidden);
    assert.deepEqual(actions.resolveNextGoalAction(undefined), hidden);
});

test('HUD action captions resolve through the catalogue with no raw key and no missing text', async () => {
    const { text, hud, repository, stateModule, catalogue, reports, fabricatorAt, autoFeederCost } = await setup();
    const textsFor = (state) => text.formatHudTexts(hud.createHudViewModel(repository, state), repository, catalogue);
    const fresh = textsFor(stateModule.createFreshGameState());
    assert.equal(fresh.manualProduceAction, 'Manual Produce');
    assert.equal(fresh.nextGoalAction, '');
    assert.equal(textsFor(fabricatorAt(15, autoFeederCost)).nextGoalAction, 'Unlock 1.5K');
    assert.equal(textsFor(fabricatorAt(15, 0)).nextGoalAction, 'Unlock 1.5K • Unavailable');
    const defaults = text.defaultHudTexts(catalogue);
    assert.equal(defaults.manualProduceAction, 'Manual Produce');
    assert.equal(defaults.nextGoalAction, '');
    for (const value of [fresh.manualProduceAction, textsFor(fabricatorAt(15, autoFeederCost)).nextGoalAction, textsFor(fabricatorAt(15, 0)).nextGoalAction]) {
        assert.doesNotMatch(value, RAW_KEY, value);
    }
    assert.deepEqual(reports, []);
    assert.ok(catalogue.has('hud.action.manual_produce') && catalogue.has('hud.action.next_goal_unlock'));
});

test('CoreLoopActions.ts is engine-free and only reads view-model data', async () => {
    const source = await readFile(path.join(repoRoot, 'assets/scripts/presentation/CoreLoopActions.ts'), 'utf8');
    assert.doesNotMatch(source, /from\s+['"]cc(\/env)?['"]/);
    assert.doesNotMatch(source, /GameState|GameRuntime|GameConfigRepository|import(?!\s+type)[^;]*(runtime|economy|progression|state)\//);
});
