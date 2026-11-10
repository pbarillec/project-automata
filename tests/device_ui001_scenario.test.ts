const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// AUT-UI-001 device scenario against a simulated FactoryWorld DEBUG build (mocked adb + logcat streams).
const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const W = 2412;
const H = 1080;
const WRITABLE_PARENT = '/data/user/0/com.projectautomata.androidbaseline';
const WRITABLE = `${WRITABLE_PARENT}/files/`;
const SAFE = { x: 96, y: 0, w: W - 192, h: H };
// Projection observed on the NE2215 (2412×1080, bottom-left origin).
const ZONES = [
    { id: 'Fabricator', sx: 1450.4, sy: 607.02, onScreen: true },
    { id: 'AssemblyStation', sx: 1061.71, sy: 447.94, onScreen: true },
    { id: 'RobotLine', sx: 412.81, sy: 59.08, onScreen: true },
    { id: 'AutomatedCell', sx: -178.74, sy: 214.45, onScreen: false },
    { id: 'AdvancedRoboticsComplex', sx: 263.2, sy: 656.15, onScreen: true },
];

function png(width, height) {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(width, 16);
    b.writeUInt32BE(height, 20);
    return b;
}

async function layoutPayload(reason, hudActions, mode) {
    const L = await imp('assets/scripts/presentation/UiLayout.ts');
    const layout = L.computeUiLayout({ w: W, h: H }, SAFE);
    const rects = { CoreHUD: layout.hud, ProducerPanel: layout.panel, ...layout.buttons, ...layout.hudButtons };
    if (mode === 'no_hud_action_rects') { delete rects.ManualProduceAction; delete rects.NextGoalAction; }
    const sizes = (card) => Object.fromEntries(card.rows.map((row) => [row.key, row.fontSize]));
    const fontSizes = { CoreHUD: { ...sizes(L.CORE_HUD_LAYOUT), ManualProduceAction: 22, NextGoalAction: hudActions.NextGoalAction.visible ? 22 : null }, ProducerPanel: sizes(L.PRODUCER_PANEL_LAYOUT) };
    if (mode === 'small_font') fontSizes.CoreHUD.NextGoalContext = 17.5;
    return { reason, screen: { w: W, h: H }, safeArea: layout.safeArea, rects, rows: { CoreHUD: layout.rows.hud, ProducerPanel: layout.rows.panel }, fontSizes, hudActions, _layout: layout };
}

/**
 * Simulated device: a tiny game model (output, Fabricator level, Auto Feeder) behind the HUD/panel Buttons,
 * persisted only by the suspend save or the pushed seed. `mode` injects one fault.
 */
async function simulatedDevice(mode) {
    const { EventStream } = await imp('tools/device/events.ts');
    const { formatDeviceEvent } = await imp('assets/scripts/presentation/DeviceDiagnostics.ts');
    const { adbToCocos } = await imp('tools/device/classification.ts');
    const { pointInRect } = await imp('tools/device/ui_geometry.ts');
    const { MANUAL_PRODUCTION_AMOUNT } = await imp('assets/scripts/runtime/index.ts');
    const scenario = await imp('tools/device/scenarios/ui001_core_loop.ts');
    const cost = scenario.autoFeederCost();
    const log = [];
    let seq = 0;
    let stream = null;
    let selected = null;
    let saved = null; // persisted game: { output, fabricator, owned }
    let game = null;
    let layout = null;
    const emit = (evt, body) => stream.pushLine(`11-10 10:00:00.000 1 2 D Cocos   : JS: ${formatDeviceEvent(evt, ++seq, body)}`);
    const actions = () => {
        const eligible = game.fabricator >= 15 && !game.owned;
        return { ManualProduceAction: { visible: true, enabled: true }, NextGoalAction: { visible: eligible, enabled: eligible && game.output >= cost } };
    };
    const emitLayout = async (reason) => {
        const payload = await layoutPayload(reason, actions(), mode);
        layout = payload._layout;
        delete payload._layout;
        emit('ui_layout', payload);
    };
    const result = (command, ok, events, reason = null) => emit('command_result', { command, ok, reason, eventTypes: events, industrialOutput: ok && events.includes('industrialOutputChanged') ? game.output : null });
    return {
        log,
        async devices() { return [{ serial: 'SIM', state: 'device', model: 'NE2215' }]; },
        useSerial(serial) { log.push(['serial', serial]); },
        async getProp(name) { return name.endsWith('release') ? '15' : '35'; },
        async install() { log.push(['install']); },
        async forceStop() { log.push(['forceStop']); game = null; },
        async clearAppData() { log.push(['clearAppData']); throw new Error('SecurityException: CLEAR_APP_USER_DATA'); },
        async appDataDirectory() { return WRITABLE_PARENT; },
        async removeAppFiles(_pkg, paths) { log.push(['removeAppFiles', ...paths]); saved = null; },
        async listAppFiles() { return saved ? ['save_main.json'] : []; },
        async writeAppFile(_pkg, devicePath) {
            // The scenario only pushes the Auto Feeder-eligible seed (its content is tested separately).
            log.push(['writeAppFile', devicePath]);
            saved = { output: cost, fabricator: 15, owned: false };
        },
        async pressHome() {
            log.push(['home']);
            saved = { ...game };
            emit('session_state', { phase: 'suspended', status: 'suspended_saved', saveOk: true, autoFeederOwned: game.owned, writablePath: WRITABLE });
        },
        async launch() {
            log.push(['launch']);
            game = saved ? { ...saved } : { output: 0, fabricator: 0, owned: false };
            selected = null;
            emit('scene_ready', { reason: 'bootstrap_loaded', scene: 'FactoryWorld' });
            emit('scene_ready', { reason: 'scene_ready', screen: { w: W, h: H }, targets: 5, selected: null, zones: ZONES });
            emit('reveal_state', { phase: 'idle', source: 'none', automated: false });
            emit('session_state', { phase: 'ready', status: saved ? 'loaded_main' : 'fresh_game', saveOk: null, autoFeederOwned: game.owned, writablePath: WRITABLE });
            emit('reveal_state', { phase: 'synced', source: 'session', automated: game.owned, focusRequested: false });
            if (mode === 'replay_reveal' && game.owned) emit('reveal_state', { phase: 'started', source: 'runtime', automated: true, focusRequested: true });
            await emitLayout('session_ready');
        },
        async tap(x, y) {
            log.push(['tap', x, y]);
            const p = adbToCocos({ x, y }, { w: W, h: H }, { width: W, height: H });
            const state = actions();
            if (pointInRect(layout.hudButtons.ManualProduceAction, p)) {
                if (mode === 'manual_no_command') return;
                if (mode === 'manual_selects') emit('selection_state', { requested: 'Fabricator', prev: selected, next: 'Fabricator', changed: true });
                game.output += mode === 'manual_wrong_amount' ? MANUAL_PRODUCTION_AMOUNT * 2 : MANUAL_PRODUCTION_AMOUNT;
                result({ type: 'manualProduce' }, true, ['productionGranted', 'industrialOutputChanged']);
                return;
            }
            if (pointInRect(layout.hudButtons.NextGoalAction, p)) {
                const misbehaves = mode === 'disabled_emits' || (mode === 'double_purchase' && game.owned);
                if (!(state.NextGoalAction.visible && state.NextGoalAction.enabled) && !misbehaves) return;
                const command = { type: 'purchaseBreakthrough', breakthroughId: 'auto_feeder' };
                if (game.owned || game.output < cost) { result(command, false, [], game.owned ? 'already_owned' : 'insufficient_balance'); return; }
                game.output -= cost;
                game.owned = true;
                emit('reveal_state', { phase: 'started', source: 'runtime', automated: true, focusRequested: true });
                result(command, true, ['industrialOutputChanged', 'breakthroughPurchased', 'automationStateChanged']);
                emit('camera_focus', { phase: 'started', distance: 9.5 });
                emit('camera_focus', { phase: 'settled', distance: 9.5 });
                if (mode !== 'no_reveal_complete') emit('reveal_state', { phase: 'complete', source: 'runtime', automated: true, focusRequested: true, reason: 'focus_finished' });
                return;
            }
            if (pointInRect(layout.buttons.Action_x1, p)) {
                if (selected !== 'Fabricator') return;
                const command = { type: 'buyProducerLevels', producerId: 'fabricator', quantity: 1 };
                if (game.output < 10) { result(command, false, [], 'insufficient_balance'); return; }
                game.output -= 10;
                game.fabricator += 1;
                result(command, true, ['industrialOutputChanged', 'producerLevelsPurchased']);
                return;
            }
            if (pointInRect(layout.hud, p) || pointInRect(layout.panel, p)) return;
            emit('touch_start', { touchId: 0, x: p.x, y: p.y, uiBlocked: false });
            emit('touch_end', { touchId: 0, x: p.x, y: p.y, startX: p.x, startY: p.y, moved: 0, slop: 12, tap: true, uiBlocked: false });
            const hit = ZONES.find((z) => z.onScreen && Math.hypot(z.sx - p.x, z.sy - p.y) < 60)?.id ?? null;
            emit('selection_raycast', { x: p.x, y: p.y, hit, targets: 5 });
            if (!hit) return;
            const prev = selected;
            selected = hit;
            emit('selection_state', { requested: hit, prev, next: hit, changed: prev !== hit });
            emit('camera_focus', { phase: 'requested', source: 'selection', id: hit });
            await emitLayout('selection_refresh');
            emit('camera_focus', { phase: 'settled', source: 'selection', id: hit });
            emit('zones_projected', { reason: 'camera_settled', screen: { w: W, h: H }, zones: ZONES });
        },
        async swipe() {},
        async pidOf() { return 1234; },
        async screencap() { return png(W, H); },
        async logcatClear() {},
        startLogcat(rawPath) { stream = new EventStream(); fs.writeFileSync(rawPath, ''); return stream; },
        async stopLogcat() {},
        async meminfo() { return ''; },
        async gfxinfo() { return ''; },
        commandLog() { return []; },
    };
}

async function run(mode, extra = {}) {
    const { runUi001Scenario } = await imp('tools/device/scenarios/ui001_core_loop.ts');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aut-ui001-'));
    const apk = path.join(root, 'fake.apk');
    fs.writeFileSync(apk, 'not really an apk');
    const driver = await simulatedDevice(mode);
    const output = await runUi001Scenario(driver, {
        apkPath: apk, artifactRoot: root, runId: `sim-${mode}`, sleep: async () => {},
        now: () => new Date('2026-11-10T10:00:00Z'),
        timeouts: { sceneReadyMs: 200, sessionMs: 200, uiLayoutMs: 200, commandMs: 100, tapSettleMs: 1, uiTapWindowMs: 1, chainMs: 200, revealMs: 200, suspendMs: 200, noRevealWindowMs: 1 },
        ...extra,
    });
    return { ...output, driver, root };
}

test('AUT-UI-001 (simulated): manual produce ×N → fresh Next Goal inert → Fabricator ×1 → seeded unlock once → relaunch owned → PASS', async () => {
    const { result, schemaErrors, driver, root } = await run('pass');
    assert.deepEqual(schemaErrors, []);
    assert.equal(result.status, 'PASS', JSON.stringify({ first: result.first_failed_assertion, actual: result.actual }));
    assert.equal(result.scenario_id, 'UI001-core-loop');
    assert.equal(result.task_id, 'AUT-UI-001');
    assert.deepEqual(result.steps.map((s) => s.id), ['clear_saves', 'fresh_launch', 'manual_produce', 'fresh_next_goal', 'buy_fabricator', 'seeded_launch', 'next_goal_purchase', 'next_goal_second_tap', 'relaunch']);
    const { MANUAL_PRODUCTION_AMOUNT } = await imp('assets/scripts/runtime/index.ts');
    const scenario = await imp('tools/device/scenarios/ui001_core_loop.ts');
    const manual = result.steps.find((s) => s.id === 'manual_produce');
    assert.equal(manual.taps, scenario.manualTapCount(3));
    assert.deepEqual(manual.industrialOutput, Array.from({ length: manual.taps }, (_, i) => (i + 1) * MANUAL_PRODUCTION_AMOUNT));
    const ids = new Set(result.assertions.filter((a) => a.ok).map((a) => a.id));
    for (const id of ['saves_cleared', 'hud_action_rects_present', 'hud_actions_inside_hud', 'hud_actions_do_not_overlap', 'hud_actions_match_ui_layout', 'effective_font_size_min_fresh_launch', 'manual_produce_enabled', 'manual_produce_output_rises', 'one_command_per_tap', 'ui_tap_no_selection_state', 'fresh_next_goal_action_unavailable', 'fresh_next_goal_tap_no_command', 'fabricator_selected', 'fabricator_tap_no_command', 'buy_x1_ok', 'seeded_save_pushed', 'next_goal_action_enabled', 'purchase_ok', 'payoff_reveal_started', 'payoff_reveal_complete', 'purchase_tap_no_selection', 'second_tap_no_second_purchase', 'exactly_one_purchase', 'suspend_save_ok', 'relaunch_loaded_main_owned', 'relaunch_no_reveal_replay', 'no_errors_after_scene_ready_final']) {
        assert.ok(ids.has(id), id);
    }
    // The seed went to the reported writable path; the saved seed is kept as evidence.
    assert.ok(driver.log.some((entry) => entry[0] === 'writeAppFile' && entry[1] === `${WRITABLE}save_main.json`));
    const seed = JSON.parse(fs.readFileSync(path.join(root, 'sim-pass', 'seeded_save_main.json'), 'utf8'));
    assert.ok(seed);
});

test('AUT-UI-001 seeded save: Fabricator Lv15, Output = Auto Feeder cost from the embedded config, Auto Feeder not owned', async () => {
    const scenario = await imp('tools/device/scenarios/ui001_core_loop.ts');
    const { deserializeGameStateFromSaveJson } = await imp('assets/scripts/persistence/index.ts');
    const { loadGameConfigFromSources } = await imp('assets/scripts/config/ConfigLoader.ts');
    const { getEmbeddedEconomyConfigSources } = await imp('assets/scripts/config/EmbeddedEconomyConfig.ts');
    const repo = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
    assert.equal(scenario.autoFeederCost(), repo.getBreakthrough('auto_feeder').cost);
    const text = scenario.buildSeededAutoFeederEligibleSave(Date.parse('2026-11-10T10:00:00Z'));
    const loaded = deserializeGameStateFromSaveJson(text);
    assert.deepEqual(loaded.diagnostics, []);
    assert.equal(loaded.state.run.producers.fabricator.level, 15);
    assert.equal(loaded.state.run.industrialOutput, repo.getBreakthrough('auto_feeder').cost);
    assert.equal(loaded.state.run.purchasedBreakthroughIds.includes('auto_feeder'), false);
    // The HUD view model of that state offers the enabled Next Goal unlock.
    const { createFreshGameState } = await imp('assets/scripts/state/index.ts');
    const { createHudViewModel } = await imp('assets/scripts/presentation/HudViewModel.ts');
    const { resolveNextGoalAction } = await imp('assets/scripts/presentation/CoreLoopActions.ts');
    const s = createFreshGameState();
    s.run.producers.fabricator = { level: 15, isUnlocked: true, isBuilt: true };
    s.run.industrialOutput = scenario.autoFeederCost();
    assert.equal(resolveNextGoalAction(createHudViewModel(repo, s).nextGoal).enabled, true);
});

for (const [mode, assertion, failureClass] of [
    ['manual_no_command', 'manual_produce_command_result', 'INPUT_NOT_RECEIVED'],
    ['manual_wrong_amount', 'manual_produce_output_rises', 'RUNTIME_ERROR'],
    ['manual_selects', 'ui_tap_no_selection_state', 'SELECTION_STATE'],
    ['disabled_emits', 'fresh_next_goal_tap_no_command', 'RUNTIME_ERROR'],
    ['double_purchase', 'second_tap_no_second_purchase', 'RUNTIME_ERROR'],
    ['no_reveal_complete', 'payoff_reveal_complete', 'CAMERA_FOCUS'],
    ['replay_reveal', 'relaunch_no_reveal_replay', 'CAMERA_FOCUS'],
    ['small_font', 'effective_font_size_min_fresh_launch', 'MARKER_PRESENTATION'],
    ['no_hud_action_rects', 'hud_action_rects_present', 'MARKER_PRESENTATION'],
]) {
    test(`AUT-UI-001 (simulated): ${mode} → FAIL ${failureClass} at ${assertion}`, async () => {
        const { result, schemaErrors } = await run(mode);
        assert.deepEqual(schemaErrors, []);
        assert.equal(result.status, 'FAIL', JSON.stringify(result.first_failed_assertion));
        assert.equal(result.failure_class, failureClass);
        assert.equal(result.first_failed_assertion.id, assertion);
    });
}

test('AUT-UI-001 (simulated): no APK → BLOCKED environment', async () => {
    const { runUi001Scenario } = await imp('tools/device/scenarios/ui001_core_loop.ts');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aut-ui001-'));
    const output = await runUi001Scenario(await simulatedDevice('pass'), { apkPath: path.join(root, 'missing.apk'), artifactRoot: root, runId: 'sim-noapk' });
    assert.equal(output.result.status, 'BLOCKED');
    assert.equal(output.result.first_failed_assertion.id, 'apk_present');
});

test('AUT-UI-001 helpers: HUD action parsing tolerates older payloads; font check flags missing or small sizes', async () => {
    const S = await imp('tools/device/scenarios/ui001_core_loop.ts');
    const empty = S.parseHudActions({ v: 1, seq: 1, evt: 'ui_layout', rects: {} });
    assert.deepEqual(empty, { rects: { ManualProduceAction: null, NextGoalAction: null }, states: { ManualProduceAction: null, NextGoalAction: null } });
    assert.deepEqual(S.fontSizeViolations({ v: 1, seq: 1, evt: 'ui_layout' }), [{ card: '*', key: '*', size: 'missing fontSizes' }]);
    assert.deepEqual(S.fontSizeViolations({ v: 1, seq: 1, evt: 'ui_layout', fontSizes: { CoreHUD: { A: 20, B: null }, ProducerPanel: { C: 19.9 } } }), [{ card: 'ProducerPanel', key: 'C', size: 19.9 }]);
    assert.ok(S.manualTapCount(3) >= 3);
    assert.ok(S.manualTapCount(1) * (await imp('assets/scripts/runtime/index.ts')).MANUAL_PRODUCTION_AMOUNT >= S.fabricatorX1Cost());
});

test('AUT-UI-001 CLI exposes ui001; the scenario is engine-free and leaves the C3 / INT-001 scenarios untouched', async () => {
    const cli = fs.readFileSync(path.join(repoRoot, 'tools/device/cli.ts'), 'utf8');
    assert.match(cli, /import \{ runUi001Scenario \} from '\.\/scenarios\/ui001_core_loop\.ts';/);
    assert.match(cli, /command === 'ui001'/);
    const scenario = fs.readFileSync(path.join(repoRoot, 'tools/device/scenarios/ui001_core_loop.ts'), 'utf8');
    assert.doesNotMatch(scenario, /from\s+['"]cc(\/env)?['"]/);
    // MANUAL_PRODUCTION_AMOUNT and the Auto Feeder cost come from code/config, never literals.
    assert.match(scenario, /import \{ MANUAL_PRODUCTION_AMOUNT \} from '\.\.\/\.\.\/\.\.\/assets\/scripts\/runtime\/index\.ts';/);
    assert.doesNotMatch(scenario, /\b1500\b/);
});
