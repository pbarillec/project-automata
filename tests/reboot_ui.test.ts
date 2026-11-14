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

async function modules() {
    const [vm, layout, binding, seed, seed049, seed050, seed051, persistence, time, lifecycle, config, embedded, ui, diagnostics, localization, progression, state, checks, aiLayout, settingsLayout, toast, offlineVm] = await Promise.all([
        imp('assets/scripts/presentation/RebootPanelViewModel.ts'),
        imp('assets/scripts/presentation/RebootLayout.ts'),
        imp('assets/scripts/presentation/FactoryWorldStateBinding.ts'),
        imp('tools/device/seed_rbt001.ts'),
        imp('tools/device/seed_aut049.ts'),
        imp('tools/device/seed_aut050.ts'),
        imp('tools/device/seed_aut051.ts'),
        imp('assets/scripts/persistence/index.ts'),
        imp('assets/scripts/time/index.ts'),
        imp('assets/scripts/lifecycle/index.ts'),
        imp('assets/scripts/config/ConfigLoader.ts'),
        imp('assets/scripts/config/EmbeddedEconomyConfig.ts'),
        imp('assets/scripts/presentation/UiLayout.ts'),
        imp('assets/scripts/presentation/DeviceDiagnostics.ts'),
        imp('assets/scripts/localization/index.ts'),
        imp('assets/scripts/progression/index.ts'),
        imp('assets/scripts/state/index.ts'),
        imp('tools/device/reboot_ui_checks.ts'),
        imp('assets/scripts/presentation/PermanentUpgradeLayout.ts'),
        imp('assets/scripts/presentation/SettingsLayout.ts'),
        imp('assets/scripts/presentation/MilestoneToastLayout.ts'),
        imp('assets/scripts/presentation/OfflineReportViewModel.ts'),
    ]);
    const repository = config.loadGameConfigFromSources(embedded.getEmbeddedEconomyConfigSources());
    return { vm, layout, binding, seed, seed049, seed050, seed051, persistence, time, lifecycle, config, embedded, ui, diagnostics, localization, progression, state, checks, aiLayout, settingsLayout, toast, offlineVm, repository };
}

const p0Of = (m) => m.repository.getPrestigeConfig().p0PrestigePower;

function stateWithPeak(m, multiplier, { aiCores = 0, civilization = 1 } = {}) {
    const state = m.state.createFreshGameState();
    state.run.prestigePowerPeak = p0Of(m) * multiplier;
    state.meta.aiCores = aiCores;
    state.meta.civilizationNumber = civilization;
    return state;
}

// ---------------------------------------------------------------- view model

test('view model: ineligible state is hidden with no command', async () => {
    const m = await modules();
    for (const multiplier of [0, 0.001, 0.03]) {
        const model = m.vm.createRebootPanelViewModel(m.repository, stateWithPeak(m, multiplier));
        assert.equal(model.visible, false, `peak x${multiplier}`);
        assert.equal(model.command, null);
        assert.equal(model.aiCoresToGain, 0);
        assert.equal(m.progression.createRebootPreview(m.repository, stateWithPeak(m, multiplier)).eligibility, 'not_eligible');
    }
});

test('view model: eligible fields equal createRebootPreview; visibility equals eligibility; the command is the confirmed Reboot', async () => {
    const m = await modules();
    for (const [multiplier, aiCores, civilization] of [[1, 0, 1], [1.2, 0, 1], [4, 7, 3], [0.05, 2, 2], [100, 0, 9]]) {
        const state = stateWithPeak(m, multiplier, { aiCores, civilization });
        const preview = m.progression.createRebootPreview(m.repository, state);
        const model = m.vm.createRebootPanelViewModel(m.repository, state);
        assert.equal(model.visible, preview.eligibility === 'eligible', `x${multiplier}`);
        assert.equal(model.visible, m.progression.createPrestigePreview(m.repository, state).currentAiCoreReward > 0, 'cheap stage equals the full eligibility');
        assert.equal(model.aiCoresToGain, preview.aiCoresToGain);
        assert.equal(model.currentAiCores, preview.currentAiCores);
        assert.equal(model.resultingAiCores, preview.resultingAiCores);
        assert.equal(model.currentCivilization, preview.currentCivilization);
        assert.equal(model.resultingCivilization, preview.resultingCivilization);
        assert.equal(model.progressRatio, preview.prestigePreview.progressToNextCore);
        assert.equal(model.progressPercent, Math.round(preview.prestigePreview.progressToNextCore * 100));
        assert.deepEqual(model.command, { type: 'rebootCivilization', confirmed: true });
        assert.equal(model.texts.chip, `REBOOT +${preview.aiCoresToGain}`);
        assert.equal(model.texts.civilization, `Civilization #${preview.currentCivilization} to #${preview.resultingCivilization}`);
        assert.equal(model.texts.progress, `Next AI Core ${model.progressPercent}%`);
    }
});

test('view model: singular reward text, plural reward text, and the seed numbers (reward 5, about 45%)', async () => {
    const m = await modules();
    const single = m.vm.createRebootPanelViewModel(m.repository, stateWithPeak(m, 0.05));
    assert.equal(single.aiCoresToGain, 1);
    assert.equal(single.texts.reward, '+1 AI CORE');
    assert.equal(single.texts.chip, 'REBOOT +1');
    const seeded = m.vm.createRebootPanelViewModel(m.repository, m.seed.buildRbt001SeededState());
    assert.equal(seeded.visible, true);
    assert.equal(seeded.aiCoresToGain, 5);
    assert.equal(seeded.texts.reward, '+5 AI CORES');
    assert.equal(seeded.texts.title, 'REBOOT CIVILIZATION');
    assert.ok(seeded.progressPercent >= 44 && seeded.progressPercent <= 46, `progress ${seeded.progressPercent}`);
    assert.equal(seeded.texts.confirm, 'REBOOT');
    assert.equal(seeded.texts.cancel, 'CANCEL');
    assert.equal(seeded.texts.failed, "Couldn't reboot. Try again.");
    assert.equal(seeded.progressPercent <= 100 && seeded.progressPercent >= 0, true);
});

test('view model: RESETS / KEEPS lists come from the catalogue (five lines each, no raw keys, never the word "reset" for the action)', async () => {
    const m = await modules();
    const model = m.vm.createRebootPanelViewModel(m.repository, m.seed.buildRbt001SeededState());
    assert.deepEqual([...model.resets], ['Industrial Output', 'Producers and levels', 'Breakthroughs, automation', 'Era and Robots Built', 'Temporary boosts']);
    assert.deepEqual([...model.persists], ['AI Cores', 'Permanent AI upgrades', 'Civilization number', 'Records and statistics', 'Settings and purchases']);
    assert.equal(model.texts.resetsHeader, 'RESETS');
    assert.equal(model.texts.keepsHeader, 'KEEPS');
    const RAW_KEY = /\b[a-z_]+(\.[a-z0-9_]+)+\b/;
    for (const value of [...Object.values(model.texts), ...model.resets, ...model.persists]) assert.doesNotMatch(value, RAW_KEY, value);
    for (const value of [model.texts.chip, model.texts.title, model.texts.confirm, model.texts.cancel, model.texts.reward]) assert.doesNotMatch(value, /reset/i, `the action is REBOOT: ${value}`);
    for (const item of [...model.resets, ...model.persists]) assert.ok(item.length <= 25, item);
    const reports = [];
    const catalogue = m.localization.getDefaultTextCatalogue();
    catalogue.setMissingTextSink((report) => reports.push(report));
    m.vm.createRebootPanelViewModel(m.repository, m.seed.buildRbt001SeededState(), catalogue);
    catalogue.setMissingTextSink(null);
    assert.deepEqual(reports, []);
    const keys = catalogue.keys().filter((key) => key.startsWith('reboot.'));
    assert.equal(keys.length, 21);
    const embedded = await read('assets/scripts/localization/EmbeddedTextCatalogue.ts');
    for (const key of keys) assert.ok(embedded.includes(key), `${key} embedded`);
});

test('view model sources: no reward math, imports the authoritative previews, the command literal lives in the view model', async () => {
    const vm = stripComments(await read('assets/scripts/presentation/RebootPanelViewModel.ts'));
    const controller = stripComments(await read('assets/scripts/presentation/RebootController.ts'));
    const layout = stripComments(await read('assets/scripts/presentation/RebootLayout.ts'));
    for (const [name, source] of [['view model', vm], ['controller', controller], ['layout', layout]]) {
        assert.doesNotMatch(source, /Math\.pow|\*\*/, `${name}: no exponentiation`);
        assert.doesNotMatch(source, /\b5 \*|p0|remainingPrestigePowerForNextCore|calculateAiCoreReward|AI_CORE_REWARD_COEFFICIENT/, `${name}: no reward formula`);
    }
    assert.match(vm, /import \{[^}]*\bcreateRebootPreview\b[^}]*\} from '\.\.\/progression\/index\.ts';/);
    assert.match(vm, /import \{[^}]*\bcreatePrestigePreview\b[^}]*\} from '\.\.\/progression\/index\.ts';/);
    assert.match(vm, /Math\.round\(progressRatio \* 100\)/, 'the percent is formatting only');
    assert.match(vm, /command: Object\.freeze\(\{ type: 'rebootCivilization', confirmed: true \} as const\)/);
    assert.doesNotMatch(controller, /confirmed: true|type: 'rebootCivilization'/, 'the controller submits only the view model command');
    assert.doesNotMatch(controller, /persistence|runtime\/|GameRuntime|GameState|getStateSnapshot|createRebootPreview|rebootCivilizationConfirmed/, 'no persistence / runtime access in the controller');
});

test('view model: the full preview is computed only when the cheap stage says eligible, and memoized (no per-frame clone)', async () => {
    const m = await modules();
    let calls = 0;
    const counting = Object.create(m.repository);
    counting.getPrestigeConfig = () => { calls += 1; return m.repository.getPrestigeConfig(); };
    const ineligible = stateWithPeak(m, 0.001);
    for (let i = 0; i < 30; i += 1) m.vm.createRebootPanelViewModel(counting, ineligible);
    assert.equal(calls, 30, 'ineligible: exactly the cheap stage per call (one config read, no full preview)');
    calls = 0;
    const eligible = stateWithPeak(m, 1.2);
    const first = m.vm.createRebootPanelViewModel(counting, eligible);
    assert.equal(calls, 2, 'first eligible call: cheap stage + the full preview');
    calls = 0;
    for (let i = 0; i < 30; i += 1) assert.equal(m.vm.createRebootPanelViewModel(counting, eligible), first);
    assert.equal(calls, 30, 'memoized: the cheap stage only, the same model object');
    calls = 0;
    eligible.run.prestigePowerPeak = p0Of(m) * 1.3;
    const changed = m.vm.createRebootPanelViewModel(counting, eligible);
    assert.equal(calls, 2, 'a changed Prestige Power peak recomputes the full preview');
    assert.notEqual(changed, first);
    calls = 0;
    eligible.meta.aiCores = 3;
    m.vm.createRebootPanelViewModel(counting, eligible);
    assert.equal(calls, 2, 'a changed AI Core balance recomputes it');
    assert.equal(m.vm.createRebootPanelViewModel(counting, eligible).resultingAiCores, eligible.meta.aiCores + m.progression.createRebootPreview(m.repository, eligible).aiCoresToGain);
});

test('result mapping: success, persistence failure, blocked by the pending offline report, exception and rejection', async () => {
    const m = await modules();
    const ok = (events, save) => ({ execution: { ok: true, command: { type: 'rebootCivilization', confirmed: true }, events }, save });
    const types = ['aiCoresGranted', 'civilizationChanged', 'rebootCompleted'].map((type) => ({ type }));
    const success = m.vm.resolveRebootResult(ok(types, { ok: true }), false);
    assert.deepEqual({ status: success.status, close: success.closeModal, note: success.showFailureNote, saveOk: success.saveOk }, { status: 'rebooted', close: true, note: false, saveOk: true });
    assert.deepEqual([...success.eventTypes], ['aiCoresGranted', 'civilizationChanged', 'rebootCompleted']);
    const failed = m.vm.resolveRebootResult(ok(types.slice(0, 2), { ok: false }), false);
    assert.deepEqual({ status: failed.status, close: failed.closeModal, note: failed.showFailureNote, saveOk: failed.saveOk }, { status: 'rebooted_persistence_failed', close: true, note: false, saveOk: false });
    const blocked = m.vm.resolveRebootResult(null, true);
    assert.deepEqual({ status: blocked.status, close: blocked.closeModal, note: blocked.showFailureNote }, { status: 'blocked_pending_offline', close: true, note: false });
    const error = m.vm.resolveRebootResult(null, false);
    assert.deepEqual({ status: error.status, close: error.closeModal, note: error.showFailureNote }, { status: 'error', close: false, note: true });
    const rejected = m.vm.resolveRebootResult({ execution: { ok: false, reason: 'reboot_not_eligible', message: 'x', events: [] }, save: null }, false);
    assert.deepEqual({ status: rejected.status, close: rejected.closeModal, note: rejected.showFailureNote, reason: rejected.reason, saveOk: rejected.saveOk }, { status: 'rejected', close: false, note: true, reason: 'reboot_not_eligible', saveOk: null });
});

// ---------------------------------------------------------------- real session

async function startSession(m, text, overrides = {}, storageOptions = {}) {
    const storage = new m.persistence.InMemorySaveStorage({ [m.persistence.SAVE_MAIN_NAME]: text });
    const clock = new m.time.ManualTimeService({ utcIso: iso(NOW_MS), monotonicSeconds: 0 });
    const boot = await m.lifecycle.bootstrapGameSession({ storage, timeService: clock });
    assert.equal(boot.startup.ok, true);
    const sink = { models: [], refresh(model) { sink.models.push(model); } };
    const batches = [];
    const results = [];
    const binding = new m.binding.FactoryWorldStateBinding({
        session: boot.startup.session,
        configRepository: boot.configRepository,
        automation: { syncAutomationState() {}, consumeDomainEvents: (state, events) => batches.push(events.map((e) => e.type)) },
        hud: null,
        panel: null,
        reboot: sink,
        reportCommandResult: (command, result) => results.push([command, result]),
        ...overrides,
    });
    void storageOptions;
    return { binding, sink, batches, results, storage, session: boot.startup.session };
}

test('real session: confirm through binding.submit grants the announced AI Cores, hides the chip, emits rebootCompleted, saves critically', async () => {
    const m = await modules();
    const ctx = await startSession(m, m.seed.buildRbt001SeededSave(NOW_MS));
    ctx.binding.init();
    const before = ctx.sink.models.at(-1);
    assert.equal(before.visible, true);
    assert.equal(before.aiCoresToGain, 5);
    assert.equal(ctx.session.getPendingOfflinePreview(), null, 'no pending offline report on the seeded save');
    const result = await ctx.binding.submit(before.command);
    assert.equal(result.execution.ok, true);
    assert.equal(result.save.ok, true, 'LifecycleCommandResult.save.ok is the critical save result');
    assert.deepEqual(result.execution.events.map((e) => e.type), ['aiCoresGranted', 'civilizationChanged', 'rebootCompleted']);
    assert.equal(result.execution.events[0].amount, before.aiCoresToGain);
    const after = ctx.session.getStateSnapshot();
    assert.equal(after.meta.aiCores, before.aiCoresToGain, 'AI Cores == the announced reward');
    assert.equal(after.meta.civilizationNumber, 2);
    assert.equal(ctx.sink.models.at(-1).visible, false, 'the chip hides after the Reboot');
    assert.equal(ctx.sink.models.at(-1).command, null);
    const resolved = m.vm.resolveRebootResult(result, false);
    assert.equal(resolved.status, 'rebooted');
    assert.equal(ctx.results.length, 1);
    const again = await ctx.binding.submit(before.command);
    assert.equal(again.execution.ok, false, 'a second submit is rejected (no longer eligible)');
});

test('real session: persistence failure changes the state, emits no rebootCompleted and maps to rebooted_persistence_failed', async () => {
    const m = await modules();
    const ctx = await startSession(m, m.seed.buildRbt001SeededSave(NOW_MS));
    ctx.binding.init();
    ctx.storage.failNext({ operation: 'replace', fromName: m.persistence.SAVE_TEMP_NAME, toName: m.persistence.SAVE_MAIN_NAME, mode: 'after_delete_destination', message: 'durability failure' });
    const result = await ctx.binding.submit(ctx.sink.models.at(-1).command);
    assert.equal(result.execution.ok, true);
    assert.equal(result.save.ok, false);
    assert.equal(result.execution.events.map((e) => e.type).includes('rebootCompleted'), false);
    const outcome = m.vm.resolveRebootResult(result, false);
    assert.deepEqual({ status: outcome.status, close: outcome.closeModal, saveOk: outcome.saveOk }, { status: 'rebooted_persistence_failed', close: true, saveOk: false });
});

test('real session: a pending offline report blocks the Reboot (null result, callback, nothing executed); the modal closes instead of stacking', async () => {
    const m = await modules();
    let blocked = 0;
    const ctx = await startSession(m, m.seed051.buildAut051SeededSave('first', NOW_MS), { onRebootBlockedByPendingOffline: () => { blocked += 1; } });
    ctx.binding.init();
    const snapshot = JSON.stringify(ctx.session.getStateSnapshot());
    const result = await ctx.binding.submit({ type: 'rebootCivilization', confirmed: true });
    assert.equal(result, null);
    assert.equal(blocked, 1);
    assert.equal(JSON.stringify(ctx.session.getStateSnapshot()), snapshot);
    const outcome = m.vm.resolveRebootResult(result, blocked > 0);
    assert.deepEqual({ status: outcome.status, close: outcome.closeModal }, { status: 'blocked_pending_offline', close: true });
    assert.equal(m.vm.resolveRebootResult(result, false).status, 'error', 'a null result without the callback is an exception: the modal stays open with the note');
});

test('real session: a rejected Reboot keeps the modal open with the note; the live model decides when it closes', async () => {
    const m = await modules();
    const ctx = await startSession(m, m.seed050.buildAut050SeededSave('mixed', NOW_MS));
    ctx.binding.init();
    assert.equal(ctx.sink.models.at(-1).visible, false);
    const result = await ctx.binding.submit({ type: 'rebootCivilization', confirmed: true });
    assert.equal(result.execution.ok, false);
    assert.equal(result.save, null);
    const outcome = m.vm.resolveRebootResult(result, false);
    assert.deepEqual({ status: outcome.status, close: outcome.closeModal, note: outcome.showFailureNote }, { status: 'rejected', close: false, note: true });
});

test('controller guards: in-flight set before the emit and checked first, one submit site, cancel and backdrop submit nothing', async () => {
    const controller = stripComments(await read('assets/scripts/presentation/RebootController.ts'));
    const confirm = controller.slice(controller.indexOf('public onConfirmPressed('), controller.indexOf('private onRebootResult('));
    assert.match(confirm, /if \(!this\.open \|\| !viewModel \|\| viewModel\.command === null \|\| this\.inFlight\) return;/);
    assert.ok(confirm.indexOf('this.inFlight = true') < confirm.indexOf('emitter(command)'), 'the guard is set before the command leaves');
    assert.match(confirm, /void emitter\(command\)\.then\(\(result\) => this\.onRebootResult\(result\), \(\) => this\.onRebootResult\(null\)\);/);
    assert.equal((controller.match(/emitter\(/g) ?? []).length, 1, 'one submit site');
    const cancel = controller.slice(controller.indexOf('public onCancelPressed('), controller.indexOf('public onConfirmPressed('));
    assert.match(cancel, /if \(!this\.open \|\| this\.inFlight\) return;/);
    assert.doesNotMatch(cancel, /emitter/);
    const backdrop = controller.slice(controller.indexOf('private onBackdropTouchEnd('), controller.indexOf('private swallowTouch('));
    assert.match(backdrop, /if \(this\.inFlight\) return;/);
    assert.doesNotMatch(backdrop, /emitter/);
    assert.match(controller, /this\.closePanel\('cancel'\)/);
    assert.match(controller, /this\.closePanel\('backdrop'\)/);
    assert.match(controller, /this\.closePanel\('no_longer_eligible'\)/);
    assert.match(controller, /'blocked_pending_offline'/);
    assert.match(controller, /resolveRebootResult\(result, blocked\)/);
    assert.doesNotMatch(controller, /hold|longPress|TOUCH_HOLD/i, 'no hold-to-confirm');
    assert.match(controller, /confirmButton\.interactable = !this\.inFlight/);
    assert.match(controller, /cancelButton\.interactable = !this\.inFlight/);
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
    test(`layout ${screen.name}: chip a fixed second line clear of HUD / panel / AI chip / SET chip / toast; modal inside the band, buttons >= 64`, async () => {
        const m = await modules();
        const safe = screen.safe ?? { x: 0, y: 0, w: screen.w, h: screen.h };
        const base = m.ui.computeUiLayout({ w: screen.w, h: screen.h }, screen.safe ?? undefined);
        const r = m.layout.computeRebootRects({ w: screen.w, h: screen.h }, screen.safe ?? undefined);
        const ai = m.aiLayout.computePermanentUpgradeRects({ w: screen.w, h: screen.h }, screen.safe ?? undefined);
        const settings = m.settingsLayout.computeSettingsRects({ w: screen.w, h: screen.h }, screen.safe ?? undefined);
        const where = screen.name;
        const protectedRects = [base.hud, base.panel, ...Object.values(base.hudButtons), ...Object.values(base.buttons), ...Object.values(base.rows.hud), ...Object.values(base.rows.panel)];
        // Chip.
        assert.ok(m.ui.rectContains(safe, r.chip, 1e-6), `${where}: chip inside the safe area`);
        assert.ok(m.ui.rectContains(r.factoryBand, r.chip, 1e-6), `${where}: chip inside the factory band`);
        for (const rect of protectedRects) assert.equal(m.ui.rectsOverlap(r.chip, rect), false, `${where}: chip overlaps a HUD / panel rect (Overclock rows, Next Goal included)`);
        assert.equal(m.ui.rectsOverlap(r.chip, ai.chip), false, `${where}: chip overlaps the AI chip`);
        assert.equal(m.ui.rectsOverlap(r.chip, settings.chip), false, `${where}: chip overlaps the SET chip`);
        assert.ok(Math.abs(r.chip.w / r.scale - 200) < 1e-6 && Math.abs(r.chip.h / r.scale - 64) < 1e-6, `${where}: chip 200 x 64`);
        assert.ok(Math.abs(r.chip.x + r.chip.w - (safe.x + safe.w - 16 * r.scale)) < 1e-6, `${where}: right-aligned at the edge margin`);
        assert.ok(Math.abs((ai.chip.y - (r.chip.y + r.chip.h)) / r.scale - 8) < 1e-6, `${where}: directly under the AI chip (8 units)`);
        const minorToast = m.toast.computeMilestoneToastRect({ w: screen.w, h: screen.h }, screen.safe ?? undefined, 'minor');
        assert.equal(m.ui.rectsOverlap(r.chip, minorToast), false, `${where}: chip overlaps the Minor toast (first line)`);
        // Modal.
        assert.ok(m.ui.rectContains(safe, r.panel, 1e-6), `${where}: panel inside the safe area`);
        assert.ok(m.ui.rectContains(r.factoryBand, r.panel, 1e-6), `${where}: panel inside the factory band`);
        assert.ok(r.panel.h <= r.factoryBand.h * m.layout.REBOOT_PANEL_MAX_BAND_RATIO + 1e-6, `${where}: panel <= 75% of the band`);
        for (const rect of protectedRects) assert.equal(m.ui.rectsOverlap(r.panel, rect), false, `${where}: panel overlaps a HUD / panel rect`);
        assert.ok(Math.abs(r.panel.y + r.panel.h / 2 - (r.factoryBand.y + r.factoryBand.h / 2)) < 1e-6, `${where}: centred in the factory band`);
        assert.ok(Math.abs(r.panel.w / r.scale - 640) < 1e-6, `${where}: 640 wide`);
        for (const rect of [r.confirm, r.cancel, ...r.columns]) assert.ok(m.ui.rectContains(r.panel, rect, 1e-6), `${where}: control inside the panel`);
        for (const rect of [r.confirm, r.cancel]) assert.ok(rect.h / r.scale >= 64 - 1e-9, `${where}: button >= 64 design units tall`);
        assert.equal(m.ui.rectsOverlap(r.confirm, r.cancel), false, `${where}: buttons overlap`);
        assert.ok(r.confirm.y > r.cancel.y, `${where}: Confirm on top of Cancel`);
        assert.ok(Math.abs((r.confirm.y - (r.cancel.y + r.cancel.h)) / r.scale - 10) < 1e-6, `${where}: 10 unit gap`);
        assert.equal(m.ui.rectsOverlap(r.columns[0], r.columns[1]), false, `${where}: columns overlap`);
        assert.deepEqual(r.backdrop, { x: 0, y: 0, w: screen.w, h: screen.h });
    });
}

test('layout: pure invariants (fonts, sizes, palette, column geometry, AI mark reuse)', async () => {
    const m = await modules();
    const L = m.layout;
    const layout = L.resolveRebootPanelLayout();
    assert.equal(layout.width, 640);
    assert.ok(layout.height <= 585, `panel ${layout.height} <= 75% of the 780-unit band`);
    assert.ok(layout.height >= 540 && layout.height <= 570, 'about 554');
    for (const size of [L.REBOOT_CHIP_FONT_SIZE, L.REBOOT_HEADER_FONT_SIZE, L.REBOOT_HERO_FONT_SIZE, L.REBOOT_CIVILIZATION_FONT_SIZE, L.REBOOT_PROGRESS_FONT_SIZE, L.REBOOT_COLUMN_HEADING_FONT_SIZE, L.REBOOT_COLUMN_LINE_FONT_SIZE]) assert.ok(size >= L.REBOOT_MIN_BODY_FONT_SIZE, `font ${size} >= 20`);
    assert.ok(L.REBOOT_COLUMN_LINE_FONT_SIZE >= 21 && L.REBOOT_PROGRESS_FONT_SIZE >= 21, 'body fonts carry a margin over 20');
    assert.ok(L.REBOOT_BUTTON_FONT_SIZE >= L.REBOOT_MIN_BUTTON_FONT_SIZE);
    assert.ok(L.REBOOT_BUTTON_HEIGHT >= L.REBOOT_MIN_BUTTON_HEIGHT);
    assert.equal(L.REBOOT_COLUMN_LINE_HEIGHT, 28);
    assert.ok(L.REBOOT_COLUMN_LINE_FONT_SIZE <= L.REBOOT_COLUMN_LINE_HEIGHT - 4);
    assert.equal(layout.resets.lines.length, 5);
    assert.equal(layout.keeps.lines.length, 5);
    assert.ok(layout.resets.slot.x + layout.resets.slot.w / 2 < layout.keeps.slot.x - layout.keeps.slot.w / 2, 'RESETS left of KEEPS');
    assert.equal(layout.resets.slot.w, 300);
    assert.equal(layout.keeps.slot.x - layout.resets.slot.x - 300, 16, 'column gap 16');
    for (const column of [layout.resets, layout.keeps]) for (const line of column.lines) assert.ok(line.x - line.w / 2 >= column.slot.x - column.slot.w / 2 + 28, 'the marker has room left of the line');
    assert.ok(layout.progressBar.h >= 12 && layout.progressBar.h <= 16);
    assert.equal(L.REBOOT_BACKDROP_ALPHA, 150);
    assert.equal(L.REBOOT_COLORS.backdrop.a, 150);
    assert.deepEqual({ ...L.REBOOT_COLORS.cyan }, { r: 88, g: 170, b: 184, a: 255 });
    for (const colour of Object.values(L.REBOOT_COLORS)) {
        assert.ok(!(colour.r > 180 && colour.g < 90 && colour.b < 90), 'no red');
        assert.ok(!(colour.r > 200 && colour.g > 150 && colour.b < 100), 'no amber');
    }
    assert.equal(L.rebootPanelCenterOffsetY(), (await imp('assets/scripts/presentation/OfflineReportLayout.ts')).offlineReportCardCenterOffsetY());
    assert.equal(L.rebootChipWidgetOffsets().top, m.aiLayout.permanentUpgradeChipWidgetOffsets().top + 64 + 8);
    assert.equal(L.rebootChipWidgetOffsets().right, 16);
    assert.equal(L.aiMarkGeometry, m.aiLayout.aiMarkGeometry, 'the AI mark geometry is reused');
});

// ---------------------------------------------------------------- source pins

test('source pins: pure files are engine-free with explicit .ts imports; the controller draws Graphics, scale visibility, Buttons on child nodes', async () => {
    for (const name of ['RebootPanelViewModel', 'RebootLayout']) {
        const source = await read(`assets/scripts/presentation/${name}.ts`);
        assert.doesNotMatch(source, /from\s+['"]cc(\/env)?['"]/, name);
        for (const match of source.matchAll(/from\s+'(\.[^']+)'/g)) assert.match(match[1], /\.ts$/, `${name} import ${match[1]}`);
    }
    for (const rel of ['tools/device/reboot_ui_checks.ts', 'tools/device/seed_rbt001.ts']) assert.doesNotMatch(await read(rel), /from\s+['"]cc['"]/);
    const source = stripComments(await read('assets/scripts/presentation/RebootController.ts'));
    assert.match(source, /addComponent\(Graphics\)/);
    assert.doesNotMatch(source, /Sprite/);
    assert.doesNotMatch(source, /\.active\s*=/);
    assert.doesNotMatch(source, /\bactive:\s*(true|false)/);
    assert.match(source, /setScale\(0, 0, 0\)/);
    assert.match(source, /Label\.Overflow\.SHRINK/);
    assert.match(source, /lineHeight = /);
    assert.match(source, /node\.addComponent\(Button\)/);
    assert.doesNotMatch(source, /this\.node\.addComponent\(Button\)/, 'no Button on the controller root');
    assert.doesNotMatch(source, /'REBOOT|'CANCEL'|Couldn|'RESETS'|'KEEPS'/, 'no hardcoded English');
    assert.equal((source.match(/\.on\(Node\.EventType\.TOUCH_/g) ?? []).length, 12);
    assert.match(source, /backdrop\.on\(Node\.EventType\.TOUCH_END, this\.onBackdropTouchEnd, this\);/);
    assert.match(source, /this\.redrawGuard|panelKey/);
});

test('source pins: scripts have metas with unique a0b10000-... uuids', async () => {
    const uuids = new Set();
    for (const name of ['RebootPanelViewModel', 'RebootLayout', 'RebootController']) {
        const metaPath = path.join(repoRoot, `assets/scripts/presentation/${name}.ts.meta`);
        assert.ok(fs.existsSync(metaPath), `${name}.ts.meta`);
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        assert.match(meta.uuid, /^a0b10000-0000-4000-8000-00000000000\d$/);
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

test('source pins: the bootstrap wires the chip / modal through the binding; created before the offline root; suppression; no new GameCommand; HUD untouched', async () => {
    const bootstrap = await read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /reboot: this\.sessionWiring\?\.reboot \?\? null,/);
    assert.match(bootstrap, /wiring\.reboot\.commandEmitter = \(command\) => binding\.submit\(command\);/);
    assert.match(bootstrap, /rects\.RebootChip/);
    assert.match(bootstrap, /rects\.RebootPanel/);
    assert.match(bootstrap, /rects\.RebootConfirm/);
    assert.match(bootstrap, /rects\.RebootCancel/);
    assert.ok(bootstrap.indexOf('this.createSettings();') < bootstrap.indexOf('this.createReboot();'));
    assert.ok(bootstrap.indexOf('this.createReboot();') < bootstrap.indexOf('this.createOfflineReport();'), 'the offline root stays the LAST Canvas child');
    assert.match(bootstrap, /wiring\.reboot\.setSuppressed\(wiring\.offlineReport\.isVisible\(\) \|\| rebootCard\);/);
    assert.match(bootstrap, /this\.rebootBlockedByPendingOffline = true;/);
    const binding = await read('assets/scripts/presentation/FactoryWorldStateBinding.ts');
    assert.match(binding, /this\.reboot\?\.refresh\(createRebootPanelViewModel\(this\.configRepository, snapshot\)\);/);
    const commands = await read('assets/scripts/domain/Commands.ts');
    assert.equal((commands.match(/'rebootCivilization'/g) ?? []).length, 1, 'no new GameCommand');
    assert.doesNotMatch(commands, /openReboot|rebootPanel|cancelReboot/i);
    const hud = await read('assets/scripts/presentation/CoreHudController.ts');
    assert.doesNotMatch(hud, /Reboot/i, 'the HUD Next Goal row is unchanged');
});

test('source pins: reboot_ui is in the diagnostics allow-list and the reveal event types; the controller reports every phase', async () => {
    const m = await modules();
    assert.ok(m.diagnostics.DEVICE_EVENT_TYPES.includes('reboot_ui'));
    const { DEFAULT_REVEAL_EVENT_TYPES } = await imp('tools/device/reveal_capture.ts');
    assert.ok(DEFAULT_REVEAL_EVENT_TYPES.includes('reboot_ui'));
    const controller = stripComments(await read('assets/scripts/presentation/RebootController.ts'));
    for (const phase of ['chip_shown', 'chip_hidden', 'opened', 'cancel_tapped', 'closed', 'confirm_tapped', 'result']) assert.match(controller, new RegExp(`'${phase}'`), phase);
    for (const reason of ['cancel', 'backdrop', 'confirmed', 'no_longer_eligible', 'blocked_pending_offline']) assert.match(controller, new RegExp(`'${reason}'`), reason);
    for (const field of ['aiCoresToGain', 'currentAiCores', 'resultingAiCores', 'currentCivilization', 'resultingCivilization', 'progressPercent', 'resetsCount', 'keepsCount', 'panelRect', 'confirmRect', 'cancelRect', 'saveOk', 'eventTypes']) assert.match(controller, new RegExp(`\\b${field}\\b`), field);
    assert.match(controller, /if \(!isDeviceDiagnosticsEnabled\(\)\) return;/);
});

// ---------------------------------------------------------------- device tooling

test('seed: Reboot-eligible Civilization #1, reward 5, progress about 45%, no pending offline report, no command file', async () => {
    const m = await modules();
    const text = m.seed.buildRbt001SeededSave(NOW_MS + 700);
    assert.equal(JSON.parse(text).savedAtUtc, iso(NOW_MS - 5_000));
    const storage = new m.persistence.InMemorySaveStorage({ [m.persistence.SAVE_MAIN_NAME]: text });
    const boot = await m.lifecycle.bootstrapGameSession({ storage, timeService: new m.time.ManualTimeService({ utcIso: iso(NOW_MS), monotonicSeconds: 0 }) });
    assert.equal(boot.startup.ok, true);
    assert.equal(m.offlineVm.createOfflineReportViewModel(boot.startup.offlinePreview).visible, false);
    assert.equal(boot.startup.session.getPendingOfflinePreview(), null);
    const state = boot.startup.session.getStateSnapshot();
    assert.equal(state.meta.civilizationNumber, 1);
    assert.deepEqual(Object.values(state.run.automation).filter((a) => a.isAutomated), []);
    const model = m.vm.createRebootPanelViewModel(boot.configRepository, state);
    assert.equal(model.visible, true);
    assert.equal(model.aiCoresToGain, 5);
    assert.ok(model.progressPercent >= 44 && model.progressPercent <= 46);
    const peak = m.seed049.buildAut049SeededState('reboot').run.prestigePowerPeak;
    assert.equal(m.seed.buildRbt001SeededState().run.prestigePowerPeak, peak * 1.2);
});

test('seed: seedRbt001 force-stops, removes stale saves AND the debug command, writes only the save and relaunches', async () => {
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
    const filesDir = await m.seed.seedRbt001(driver, 'pkg', 'act', () => new Date(NOW_MS));
    assert.equal(filesDir, '/data/data/pkg/files/');
    assert.deepEqual(calls.map((call) => call[0]), ['forceStop', 'remove', 'write', 'launch']);
    assert.ok(calls[1][1].some((p) => p.endsWith(DEBUG_COMMAND_FILE)), 'stale debug_command.json removed');
    assert.ok(calls[1][1].some((p) => p.endsWith('save_main.json')));
    assert.equal(calls.filter((call) => call[0] === 'write').length, 1, 'no debug_command.json written');
    assert.deepEqual(calls[2], ['write', '/data/data/pkg/files/save_main.json', iso(NOW_MS - 5_000)]);
});

test('device: scenario, CLI, package script and expectation pass-through are registered', async () => {
    const { REVEAL_SCENARIOS } = await imp('tools/device/reveal_capture.ts');
    const scenario = REVEAL_SCENARIOS.rbt001;
    assert.equal(scenario.id, 'rbt001');
    assert.equal(scenario.trigger, 'none');
    assert.equal(scenario.expectRebootUi, 'confirm_flow');
    assert.equal(scenario.expectOfflineReport, undefined);
    const cli = await read('tools/device/cli.ts');
    assert.match(cli, /command === 'seed-rbt001'/);
    assert.match(cli, /seed-rbt001 \[--serial <id>\]/);
    assert.match(cli, /expectRebootUi: scenario\.expectRebootUi,/);
    assert.match(await read('package.json'), /"device:seed-rbt001": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools\/device\/cli\.ts seed-rbt001"/);
    const capture = await read('tools/device/reveal_capture.ts');
    assert.match(capture, /expectRebootUi: options\.expectRebootUi \}\);/);
    assert.match(capture, /tapRect\('RebootChip'\)/);
    assert.match(capture, /tapRect\('RebootCancel'\)/);
    assert.match(capture, /tapRect\('RebootConfirm'\)/);
    assert.match(capture, /\[500, 1_500, 2_500, 3_500, 5_000\]/);
    assert.match(capture, /driver\.forceStop\(packageName\);\s*const relaunchCursor = stream\.cursor;\s*await driver\.launch\(packageName, activity\);/);
});

function ev(tMs, evt, extra = {}) { return { tMs, event: { v: 1, seq: tMs, evt, ...extra } }; }

function goodTimeline(overrides = {}) {
    const rect = { x: 10, y: 10, w: 400, h: 100 };
    const layoutOpen = { RebootChip: null, RebootPanel: rect, RebootConfirm: { x: 10, y: 10, w: 800, h: 128 }, RebootCancel: { x: 10, y: 200, w: 800, h: 128 } };
    const timeline = [
        ev(0, 'reboot_ui', { phase: 'chip_shown', aiCoresToGain: 5, chipText: 'REBOOT +5', chipRect: rect }),
        ev(100, 'ui_layout', { screen: { w: 1080, h: 2412 }, rects: layoutOpen }),
        ev(1000, 'reboot_ui', { phase: 'opened', aiCoresToGain: 5, currentAiCores: 0, resultingAiCores: 5, currentCivilization: 1, resultingCivilization: 2, progressPercent: 45, texts: { reward: '+5 AI CORES', civilization: 'Civilization #1 to #2', progress: 'Next AI Core 45%' }, resetsCount: 5, keepsCount: 5, panelRect: rect }),
        ev(1000, 'reboot_ui', { phase: 'chip_hidden', modalOpen: true }),
        ev(1500, 'reboot_ui', { phase: 'cancel_tapped' }),
        ev(1500, 'reboot_ui', { phase: 'closed', reason: 'cancel' }),
        ev(1500, 'reboot_ui', { phase: 'chip_shown', aiCoresToGain: 5, chipRect: rect }),
        ev(2500, 'reboot_ui', { phase: 'opened', aiCoresToGain: 5, currentAiCores: 0, resultingAiCores: 5, currentCivilization: 1, resultingCivilization: 2, progressPercent: 45, texts: { reward: '+5 AI CORES' }, resetsCount: 5, keepsCount: 5, panelRect: rect }),
        ev(2500, 'reboot_ui', { phase: 'chip_hidden', modalOpen: true }),
        ev(3000, 'reboot_ui', { phase: 'confirm_tapped', aiCoresToGain: 5 }),
        ev(3100, 'command_result', { command: { type: 'rebootCivilization', confirmed: true }, ok: true, eventTypes: ['aiCoresGranted', 'civilizationChanged', 'rebootCompleted'] }),
        ev(3100, 'reboot_presentation', { phase: 'sequence_started', aiCoresGranted: 5, newCivilization: 2 }),
        ev(3100, 'reboot_ui', { phase: 'result', status: 'rebooted', saveOk: true, eventTypes: ['aiCoresGranted', 'civilizationChanged', 'rebootCompleted'] }),
        ev(3100, 'reboot_ui', { phase: 'closed', reason: 'confirmed' }),
        ev(3300, 'permanent_upgrades', { phase: 'chip_shown', aiCores: 5 }),
        ev(3500, 'reboot_presentation', { phase: 'title_applied', labelText: 'REBOOT' }),
        ev(4500, 'reboot_presentation', { phase: 'title_applied', labelText: 'AI CORE ×5' }),
        ev(5500, 'reboot_presentation', { phase: 'title_applied', labelText: 'CIVILIZATION #2' }),
        ev(7000, 'reboot_presentation', { phase: 'sequence_finished', elapsedSeconds: 4.0 }),
        ev(9000, 'ui_layout', { screen: { w: 1080, h: 2412 }, rects: { RebootChip: null, RebootPanel: null, RebootConfirm: null, RebootCancel: null } }),
        ev(10000, 'capture_marker', { phase: 'relaunch' }),
        ev(15000, 'permanent_upgrades', { phase: 'chip_shown', aiCores: 5 }),
    ];
    return timeline.filter((item) => !overrides.drop?.some((d) => d(item))).map((item) => overrides.patch?.(item) ?? item);
}

test('device checks: the full chain passes; cancel, amount, sequence, hidden and persistence regressions fail', async () => {
    const m = await modules();
    const failing = (timeline) => m.checks.evaluateRebootUi(timeline, 'confirm_flow').filter((c) => !c.ok).map((c) => c.id);
    assert.deepEqual(failing(goodTimeline()), []);
    const phaseOf = (phase) => (item) => item.event.evt === 'reboot_ui' && item.event.phase === phase;
    assert.ok(failing(goodTimeline({ drop: [phaseOf('chip_shown')] })).includes('rbt_chip_shown'));
    assert.ok(failing(goodTimeline({ drop: [phaseOf('cancel_tapped')] })).includes('rbt_cancel_submits_nothing'));
    assert.deepEqual(failing(goodTimeline({ patch: (item) => (item.event.evt === 'command_result' ? { ...item, tMs: 1200 } : item) })).includes('rbt_cancel_submits_nothing'), true);
    assert.ok(failing(goodTimeline({ patch: (item) => (item.event.evt === 'reboot_presentation' && item.event.phase === 'sequence_started' ? { ...item, event: { ...item.event, aiCoresGranted: 4 } } : item) })).includes('rbt_granted_equals_announced'));
    assert.ok(failing(goodTimeline({ patch: (item) => (item.event.evt === 'command_result' ? { ...item, event: { ...item.event, eventTypes: ['aiCoresGranted', 'civilizationChanged'] } } : item) })).includes('rbt_confirm_command_ok'));
    assert.ok(failing(goodTimeline({ patch: (item) => (item.event.phase === 'sequence_finished' ? { ...item, event: { ...item.event, elapsedSeconds: 4.5 } } : item) })).includes('rbt_single_sequence_within_cap'));
    assert.ok(failing(goodTimeline({ patch: (item) => (item.event.evt === 'reboot_presentation' && item.event.labelText === 'REBOOT' ? { ...item, event: { ...item.event, labelText: 'RESET' } } : item) })).includes('rbt_sequence_beats'));
    assert.ok(failing(goodTimeline({ patch: (item) => (item.event.evt === 'ui_layout' && item.tMs === 9000 ? { ...item, event: { ...item.event, rects: { RebootChip: { x: 1, y: 1, w: 5, h: 5 }, RebootPanel: null } } } : item) })).includes('rbt_modal_and_chip_hidden_after'));
    assert.ok(failing(goodTimeline({ patch: (item) => (item.event.evt === 'permanent_upgrades' && item.tMs === 3300 ? { ...item, event: { ...item.event, aiCores: 4 } } : item) })).includes('rbt_ai_chip_balance_equals_reward'));
    assert.ok(failing(goodTimeline({ patch: (item) => (item.event.evt === 'permanent_upgrades' && item.tMs === 15000 ? { ...item, event: { ...item.event, aiCores: 0 } } : item) })).includes('rbt_persisted_after_relaunch'));
    assert.ok(failing(goodTimeline({ patch: (item) => (item.event.evt === 'ui_layout' && item.tMs === 100 ? { ...item, event: { ...item.event, rects: { ...item.event.rects, RebootConfirm: { x: 1, y: 1, w: 800, h: 60 } } } } : item) })).includes('rbt_buttons_at_least_64_design_units'));
    const { evaluateRevealTimeline } = await imp('tools/device/reveal_capture.ts');
    const checks = evaluateRevealTimeline(goodTimeline(), { expectConstruction: null, expectFocus: false, triggered: true, frameCount: 9, expectRebootUi: 'confirm_flow' });
    assert.deepEqual(checks.filter((c) => !c.ok).map((c) => c.id), []);
    assert.ok(checks.some((c) => c.id === 'rbt_persisted_after_relaunch'), 'the expectation is passed through evaluateRevealTimeline');
});
