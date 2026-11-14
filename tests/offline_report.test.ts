const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const read = (rel) => readFile(path.join(repoRoot, rel), 'utf8');

const NOW_MS = Date.parse('2026-11-14T12:00:00.000Z');
const HOUR_MS = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();

async function modules() {
    const [vm, text, layout, binding, seed, persistence, time, lifecycle, config, embedded, ui, diagnostics, localization] = await Promise.all([
        imp('assets/scripts/presentation/OfflineReportViewModel.ts'),
        imp('assets/scripts/presentation/OfflineReportText.ts'),
        imp('assets/scripts/presentation/OfflineReportLayout.ts'),
        imp('assets/scripts/presentation/FactoryWorldStateBinding.ts'),
        imp('tools/device/seed_aut051.ts'),
        imp('assets/scripts/persistence/index.ts'),
        imp('assets/scripts/time/index.ts'),
        imp('assets/scripts/lifecycle/index.ts'),
        imp('assets/scripts/config/ConfigLoader.ts'),
        imp('assets/scripts/config/EmbeddedEconomyConfig.ts'),
        imp('assets/scripts/presentation/UiLayout.ts'),
        imp('assets/scripts/presentation/DeviceDiagnostics.ts'),
        imp('assets/scripts/localization/index.ts'),
    ]);
    return { vm, text, layout, binding, seed, persistence, time, lifecycle, config, embedded, ui, diagnostics, localization };
}

/** A real session (LifecycleSessionCoordinator over in-memory storage) loaded from a seeded save that is `hours` old. */
async function startSession({ variant = 'first', files, storage: givenStorage, clock: givenClock, nowMs = NOW_MS, offsetMs = 0 } = {}) {
    const m = await modules();
    const storage = givenStorage ?? new m.persistence.InMemorySaveStorage(files ?? { [m.persistence.SAVE_MAIN_NAME]: m.seed.buildAut051SeededSave(variant, nowMs) });
    const clock = givenClock ?? new m.time.ManualTimeService({ utcIso: iso(nowMs + offsetMs), monotonicSeconds: 0 });
    const boot = await m.lifecycle.bootstrapGameSession({ storage, timeService: clock });
    assert.equal(boot.startup.ok, true);
    return { m, storage, clock, boot, session: boot.startup.session, repo: boot.configRepository, startup: boot.startup };
}

async function savedAtOf(ctx) {
    return JSON.parse(await ctx.storage.readText(ctx.m.persistence.SAVE_MAIN_NAME)).savedAtUtc;
}

function viewSink() {
    const sink = { models: [], refresh(model) { sink.models.push(model); } };
    return sink;
}

async function bindingFor(ctx, { sessionOverride, onRebootBlocked } = {}) {
    const hud = viewSink();
    const errors = [];
    const session = sessionOverride ? sessionOverride(ctx.session) : ctx.session;
    const binding = new ctx.m.binding.FactoryWorldStateBinding({
        session,
        configRepository: ctx.repo,
        automation: null,
        hud,
        panel: viewSink(),
        reportError: (context, error) => errors.push([context, error]),
        onRebootBlockedByPendingOffline: onRebootBlocked,
    });
    return { binding, hud, errors };
}

// ---------------------------------------------------------------- view model

test('view model: only a preview_ready preview is visible; null / no_reward / invalid hide the card', async () => {
    const { vm } = await modules();
    const ctx = await startSession();
    const ready = ctx.startup.offlinePreview;
    assert.equal(ready.status, 'preview_ready');
    assert.equal(vm.createOfflineReportViewModel(ready).visible, true);
    for (const hidden of [null, undefined, { ...ready, status: 'no_reward' }, { ...ready, status: 'invalid_time', reason: 'x' }, { ...ready, status: 'invalid_config', reason: 'x' }]) {
        assert.equal(vm.createOfflineReportViewModel(hidden).visible, false);
        assert.equal(vm.createOfflineReportViewModel(hidden), vm.HIDDEN_OFFLINE_REPORT_VIEW_MODEL);
    }
});

test('view model: fields are mapped from the preview, never recomputed', async () => {
    const { vm } = await modules();
    const ctx = await startSession();
    const preview = ctx.startup.offlinePreview;
    const model = vm.createOfflineReportViewModel(preview);
    assert.equal(model.effectiveSeconds, preview.effectiveOfflineSeconds);
    assert.equal(model.effectiveSeconds, 3 * 3600);
    assert.equal(model.rawSeconds, preview.rawAbsenceSeconds);
    assert.equal(model.capApplied, false);
    assert.equal(model.capSeconds, preview.capSeconds);
    assert.equal(model.reward, preview.totalIndustrialOutputReward);
    assert.ok(model.reward > 0);
    assert.equal(model.robotsDelta, 0);
    assert.equal(model.showRobotsRow, false);
});

test('view model: the robots row exists only when robots were built', async () => {
    const { vm } = await modules();
    const ctx = await startSession();
    const base = ctx.startup.offlinePreview;
    assert.equal(vm.createOfflineReportViewModel({ ...base, robotsBuiltDelta: 0 }).showRobotsRow, false);
    assert.equal(vm.createOfflineReportViewModel({ ...base, robotsBuiltDelta: -3 }).showRobotsRow, false);
    const some = vm.createOfflineReportViewModel({ ...base, robotsBuiltDelta: 12 });
    assert.equal(some.showRobotsRow, true);
    assert.equal(some.robotsDelta, 12);
});

test('view model: the educational line needs a built producer that is not automated; D2 is one boolean input', async () => {
    const { vm } = await modules();
    const first = await startSession({ variant: 'first' });
    const compact = await startSession({ variant: 'compact' });
    const withManual = vm.createOfflineReportViewModel(first.startup.offlinePreview);
    assert.deepEqual([...withManual.notAutomatedProducerIds], ['assembly_station']);
    assert.equal(withManual.explainShown, true);
    const allAutomated = vm.createOfflineReportViewModel(compact.startup.offlinePreview);
    assert.deepEqual([...allAutomated.notAutomatedProducerIds], []);
    assert.equal(allAutomated.explainShown, false);
    // D2: a single boolean switches the policy off without touching state or persistence.
    const disabled = vm.createOfflineReportViewModel(first.startup.offlinePreview, { showEducationalLine: false });
    assert.equal(disabled.explainShown, false);
    assert.deepEqual([...disabled.notAutomatedProducerIds], ['assembly_station']);
    assert.equal(vm.OFFLINE_REPORT_SHOW_EDUCATIONAL_LINE, true);
    // Producers that are not built are never listed.
    const notBuilt = { ...first.startup.offlinePreview, producerContributions: [{ producerId: 'robot_line', isEligible: false, reason: 'not_built', productionPerSecond: 0, industrialOutputReward: 0 }] };
    assert.equal(vm.createOfflineReportViewModel(notBuilt).explainShown, false);
});

test('view model: collect outcomes map every session status', async () => {
    const { vm } = await modules();
    const at = vm.resolveOfflineCollectOutcome;
    assert.equal(at({ status: 'collected_saved' }), 'close');
    assert.equal(at({ status: 'no_reward_saved' }), 'close');
    assert.equal(at({ status: 'collected_persistence_failed' }), 'close_unsaved');
    assert.equal(at({ status: 'no_reward_persistence_failed' }), 'close_unsaved');
    assert.equal(at({ status: 'no_pending_preview' }), 'close_stale');
    assert.equal(at({ status: 'collect_failed' }), 'keep_retry');
    assert.equal(at(null), 'keep_retry');
});

// ---------------------------------------------------------------- text

test('text: duration formatter edge cases', async () => {
    const { text } = await modules();
    const f = text.formatOfflineDuration;
    assert.equal(f(0), '<1m');
    assert.equal(f(59), '<1m');
    assert.equal(f(60), '1m');
    assert.equal(f(45 * 60 + 59), '45m');
    assert.equal(f(3600), '1h');
    assert.equal(f(3 * 3600 + 20 * 60), '3h 20m');
    assert.equal(f(8 * 3600), '8h');
    assert.equal(f(8 * 3600 + 59), '8h');
    assert.equal(f(-5), '<1m');
    assert.equal(f(Number.NaN), '<1m');
    assert.equal(f(Number.POSITIVE_INFINITY), '<1m');
});

test('text: card strings compose from the catalogue (reward via NumberFormatter, no raw keys)', async () => {
    const { text, vm, localization } = await modules();
    const ctx = await startSession({ variant: 'cap' });
    const model = vm.createOfflineReportViewModel(ctx.startup.offlinePreview);
    assert.equal(model.capApplied, true);
    const reports = [];
    const catalogue = localization.createTextCatalogue(await read('localization/en.json'), (report) => reports.push(report));
    const texts = text.formatOfflineReportTexts(model, ctx.repo, catalogue);
    assert.equal(texts.title, 'FACTORY REPORT');
    assert.equal(texts.timeAway, 'Away 8h');
    assert.equal(texts.capReached, 'Offline cap reached (8h)');
    assert.match(texts.reward, /^\+[\d.]+[KMBT]? Industrial Output$/);
    assert.equal(texts.robots, null);
    assert.equal(texts.explain, 'Automated producers kept working. Manual: Assembly Station.');
    assert.equal(texts.collect, 'COLLECT');
    assert.deepEqual(reports, []);
    const rawKey = /\b[a-z_]+(\.[a-z0-9_]+)+\b/;
    for (const value of Object.values(texts)) if (typeof value === 'string') assert.doesNotMatch(value, rawKey);
    const short = text.formatOfflineReportTexts({ ...model, effectiveSeconds: 12_000, capApplied: false, showRobotsRow: true, robotsDelta: 1200 }, ctx.repo, catalogue);
    assert.equal(short.timeAway, 'Away 3h 20m');
    assert.equal(short.capReached, null);
    assert.equal(short.robots, '+1.2K Robots Built');
    assert.equal(text.formatOfflineReportTexts({ ...model, showRobotsRow: true, robotsDelta: 1 }, ctx.repo, catalogue).robots, '+1 Robot Built');
    assert.equal(text.formatOfflineReportTexts({ ...model, showRobotsRow: true, robotsDelta: 2 }, ctx.repo, catalogue).robots, '+2 Robots Built');
    assert.equal(text.formatOfflineCollectFailed(catalogue), "Couldn't collect. Tap to try again.");
});

test('text: the educational line names at most two producers, then "and N more"; unresolved ids are dropped', async () => {
    const { text, vm, localization } = await modules();
    const ctx = await startSession();
    const catalogue = localization.createTextCatalogue(await read('localization/en.json'));
    const ids = ctx.repo.listProducers().map((producer) => producer.id);
    const line = (list) => text.formatOfflineExplainLine(list, ctx.repo, catalogue);
    assert.equal(line([]), null);
    assert.equal(line(['nope']), null);
    assert.equal(line(ids.slice(0, 1)), 'Automated producers kept working. Manual: Fabricator.');
    assert.equal(line(ids.slice(0, 2)), 'Automated producers kept working. Manual: Fabricator, Assembly Station.');
    assert.equal(line(ids.slice(0, 3)), 'Automated producers kept working. Manual: Fabricator, Assembly Station and 1 more.');
    assert.equal(line(ids), 'Automated producers kept working. Manual: Fabricator, Assembly Station and 3 more.');
    assert.equal(line(['nope', ...ids.slice(0, 1)]), 'Automated producers kept working. Manual: Fabricator.');
    assert.equal(text.formatOfflineExplainLine(ids, null, catalogue), null);
    assert.equal(vm.OFFLINE_REPORT_MAX_NAMED_PRODUCERS, 2);
});

test('text: every offline.* key lives in en.json and in the embedded catalogue; the catalogue holds 94 entries (65 + 29 AUT-050 upgrades.* / permanent_upgrade.* keys)', async () => {
    const { localization } = await modules();
    const parsed = JSON.parse(await read('localization/en.json'));
    const keys = ['offline.title', 'offline.time_away', 'offline.cap_reached', 'offline.reward', 'offline.robots', 'offline.robot_single', 'offline.explain.manual', 'offline.explain.more', 'offline.collect', 'offline.collect_failed'];
    const embedded = localization.getDefaultTextCatalogue();
    for (const key of keys) {
        assert.equal(typeof parsed.entries[key], 'string', key);
        assert.ok(embedded.has(key), `${key} embedded`);
        assert.equal(embedded.template(key), parsed.entries[key]);
    }
    assert.equal(Object.keys(parsed.entries).length, 94);
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
const FLAG_SETS = [
    { capReached: true, robots: true, note: true },
    { capReached: false, robots: false, note: false },
    { capReached: false, robots: true, note: true },
    { capReached: true, robots: false, note: false },
];

for (const screen of SCREENS) {
    test(`layout ${screen.name}: card inside the safe area and the factory band, clear of HUD rows and panel buttons, COLLECT large`, async () => {
        const { layout, ui } = await modules();
        const base = ui.computeUiLayout({ w: screen.w, h: screen.h }, screen.safe ?? undefined);
        for (const flags of FLAG_SETS) {
            const r = layout.computeOfflineReportRects({ w: screen.w, h: screen.h }, screen.safe ?? undefined, flags);
            const safe = screen.safe ?? { x: 0, y: 0, w: screen.w, h: screen.h };
            const where = `${screen.name} ${JSON.stringify(flags)}`;
            assert.ok(ui.rectContains(safe, r.card, 1e-6), `${where}: card inside the safe area`);
            assert.ok(ui.rectContains(r.factoryBand, r.card, 1e-6), `${where}: card inside the factory band`);
            assert.ok(ui.rectContains(r.card, r.collect, 1e-6), `${where}: COLLECT inside the card`);
            for (const rect of [base.hud, base.panel, ...Object.values(base.hudButtons), ...Object.values(base.buttons), ...Object.values(base.rows.hud), ...Object.values(base.rows.panel)]) {
                assert.equal(ui.rectsOverlap(r.card, rect), false, `${where}: card overlaps a HUD / panel rect`);
            }
            assert.ok(r.card.h <= screen.h * layout.OFFLINE_REPORT_MAX_HEIGHT_RATIO, `${where}: card height ${r.card.h} <= 30% of ${screen.h}`);
            assert.ok(r.collect.h / r.scale >= layout.OFFLINE_REPORT_MIN_COLLECT_HEIGHT - 1e-9, `${where}: COLLECT >= 64 design units`);
            assert.ok(r.card.w / r.scale >= 620 && r.card.w / r.scale <= 680, `${where}: width 620..680`);
            assert.deepEqual(r.backdrop, { x: 0, y: 0, w: screen.w, h: screen.h });
            // Centred between the HUD band and the panel.
            const centreY = r.card.y + r.card.h / 2;
            assert.ok(Math.abs(centreY - (r.factoryBand.y + r.factoryBand.h / 2)) < 1e-6, `${where}: centred in the factory band`);
        }
    });
}

test('layout: pure card layout invariants (rows omitted not blank, COLLECT size and font, fonts above the body minimum)', async () => {
    const { layout, ui } = await modules();
    const full = layout.resolveOfflineReportCardLayout({ capReached: true, robots: true, note: true });
    const minimal = layout.resolveOfflineReportCardLayout({ capReached: false, robots: false, note: false });
    assert.deepEqual(full.rows.map((row) => row.key), ['title', 'timeAway', 'capReached', 'reward', 'robots', 'note']);
    assert.deepEqual(minimal.rows.map((row) => row.key), ['title', 'timeAway', 'reward']);
    assert.ok(full.height <= 360 && full.height > minimal.height);
    for (const card of [full, minimal]) {
        assert.ok(card.collect.h >= layout.OFFLINE_REPORT_MIN_COLLECT_HEIGHT);
        assert.ok(card.collect.fontSize >= layout.OFFLINE_REPORT_MIN_COLLECT_FONT_SIZE);
        assert.ok(card.width >= 620 && card.width <= 680);
        // Rows stack without overlap and stay above COLLECT, inside the card.
        const spans = card.rows.map((row) => [row.y - row.h / 2, row.y + row.h / 2]);
        for (let i = 1; i < spans.length; i += 1) assert.ok(spans[i][1] <= spans[i - 1][0] + 1e-9);
        assert.ok(spans[spans.length - 1][0] >= card.collect.y + card.collect.h / 2);
        assert.ok(spans[0][1] <= card.height / 2);
        for (const row of card.rows) {
            assert.ok(row.fontSize >= ui.UI_MIN_BODY_FONT_SIZE + 2, `${row.key} font has margin over the minimum`);
            assert.ok(row.lineHeight >= row.fontSize * 0.8);
            assert.ok(row.lines * row.lineHeight <= row.h, `${row.key} lines fit its row`);
        }
    }
    const reward = full.rows.find((row) => row.key === 'reward');
    for (const row of full.rows) if (row !== reward) assert.ok(reward.fontSize > row.fontSize, 'the reward is the largest text');
    assert.ok(full.collect.fontSize < reward.fontSize);
    assert.equal(layout.offlineReportCardCenterOffsetY(), (ui.cardHeight(ui.PRODUCER_PANEL_LAYOUT) - ui.cardHeight(ui.CORE_HUD_LAYOUT)) / 2);
});

test('layout: colours follow the AUT-046/048/049 language (graphite pill, off-white, amber reward, cyan secondary, never red)', async () => {
    const { layout } = await modules();
    const c = layout.OFFLINE_REPORT_COLORS;
    assert.deepEqual([c.pill.r, c.pill.g, c.pill.b, c.pill.a], [24, 29, 32, 245]);
    assert.deepEqual([c.text.r, c.text.g, c.text.b], [238, 241, 233]);
    assert.deepEqual([c.amber.r, c.amber.g, c.amber.b], [240, 176, 64]);
    assert.deepEqual([c.cyan.r, c.cyan.g, c.cyan.b], [88, 170, 184]);
    assert.ok(layout.OFFLINE_REPORT_BACKDROP_ALPHA >= 0.55 * 255 && layout.OFFLINE_REPORT_BACKDROP_ALPHA <= 0.65 * 255);
    for (const color of Object.values(c)) assert.ok(!(color.r > 180 && color.g < 80 && color.b < 80), 'no red');
});

// ---------------------------------------------------------------- session / binding integration

test('startup with an old savedAtUtc keeps a pending preview and the binding exposes it', async () => {
    const ctx = await startSession();
    const { binding } = await bindingFor(ctx);
    const pending = binding.getPendingOfflinePreview();
    assert.ok(pending);
    assert.equal(pending.status, 'preview_ready');
    assert.equal(pending, ctx.session.getPendingOfflinePreview());
    assert.equal(pending.effectiveOfflineSeconds, 3 * 3600);
});

test('collect: updates Industrial Output, clears pending, saves critically with the collection cursor, refreshes the HUD', async () => {
    const ctx = await startSession();
    const { binding, hud, errors } = await bindingFor(ctx);
    const before = ctx.session.getStateSnapshot().run.industrialOutput;
    const reward = binding.getPendingOfflinePreview().totalIndustrialOutputReward;
    binding.init();
    hud.models.length = 0;

    const result = await binding.collectOfflineReport();

    assert.equal(result.status, 'collected_saved');
    assert.equal(result.save.reason, 'offline_collect');
    assert.equal(result.save.intent, 'critical');
    assert.equal(ctx.session.getStateSnapshot().run.industrialOutput, before + reward);
    assert.equal(binding.getPendingOfflinePreview(), null);
    assert.equal(await savedAtOf(ctx), iso(NOW_MS), 'the collect cursor advanced to "now"');
    assert.equal(hud.models.length, 1, 'the HUD refreshed from the fresh snapshot');
    assert.deepEqual(errors, []);
});

test('collect is idempotent: a second collect grants nothing and does not refresh', async () => {
    const ctx = await startSession();
    const { binding, hud } = await bindingFor(ctx);
    await binding.collectOfflineReport();
    const afterFirst = ctx.session.getStateSnapshot().run.industrialOutput;
    hud.models.length = 0;
    const second = await binding.collectOfflineReport();
    assert.equal(second.status, 'no_pending_preview');
    assert.equal(ctx.session.getStateSnapshot().run.industrialOutput, afterFirst);
    assert.equal(hud.models.length, 0);
});

test('collect: a persistence failure still closes the card (state applied, durability not claimed)', async () => {
    const ctx = await startSession();
    const { vm } = ctx.m;
    const { binding } = await bindingFor(ctx);
    ctx.storage.failNext({ operation: 'replace', fromName: ctx.m.persistence.SAVE_TEMP_NAME, toName: ctx.m.persistence.SAVE_MAIN_NAME, mode: 'after_delete_destination', message: 'durability failure' });
    const result = await binding.collectOfflineReport();
    assert.equal(result.status, 'collected_persistence_failed');
    assert.equal(result.save.ok, false);
    assert.equal(binding.getPendingOfflinePreview(), null);
    assert.equal((await modules()).vm.resolveOfflineCollectOutcome(result), 'close_unsaved');
    void vm;
});

test('collect_failed keeps the pending preview and a retry succeeds', async () => {
    const ctx = await startSession();
    const m = ctx.m;
    const good = ctx.session.getPendingOfflinePreview();
    ctx.session.pendingOfflinePreview = { ...good, totalIndustrialOutputReward: Number.POSITIVE_INFINITY };
    const { binding, hud } = await bindingFor(ctx);
    hud.models.length = 0;
    const failed = await binding.collectOfflineReport();
    assert.equal(failed.status, 'collect_failed');
    assert.equal(m.vm.resolveOfflineCollectOutcome(failed), 'keep_retry');
    assert.ok(binding.getPendingOfflinePreview(), 'the card stays: the preview is still pending');
    assert.equal(hud.models.length, 0, 'nothing was applied, nothing refreshed');
    ctx.session.pendingOfflinePreview = good;
    const retry = await binding.collectOfflineReport();
    assert.equal(retry.status, 'collected_saved');
});

test('a throwing session is reported, never thrown (collect resolves null)', async () => {
    const ctx = await startSession();
    const { binding, errors } = await bindingFor(ctx, { sessionOverride: (real) => ({ ...wrap(real), collectPendingOffline: async () => { throw new Error('boom'); } }) });
    assert.equal(await binding.collectOfflineReport(), null);
    assert.equal(errors.length, 1);
    assert.equal(errors[0][0], 'collect_offline');
});

function wrap(real) {
    return {
        getStateSnapshot: () => real.getStateSnapshot(),
        execute: (command, options) => real.execute(command, options),
        advanceActiveSessionFromClock: (options) => real.advanceActiveSessionFromClock(options),
        suspend: () => real.suspend(),
        resume: () => real.resume(),
        rebootCivilizationConfirmed: () => real.rebootCivilizationConfirmed(),
        getPendingOfflinePreview: () => real.getPendingOfflinePreview(),
        collectPendingOffline: () => real.collectPendingOffline(),
    };
}

test('a port without offline support stays inert', async () => {
    const ctx = await startSession();
    const minimal = (real) => ({
        getStateSnapshot: () => real.getStateSnapshot(),
        execute: (c, o) => real.execute(c, o),
        advanceActiveSessionFromClock: (o) => real.advanceActiveSessionFromClock(o),
        suspend: () => real.suspend(),
        resume: () => real.resume(),
    });
    const { binding, errors } = await bindingFor(ctx, { sessionOverride: minimal });
    assert.equal(binding.getPendingOfflinePreview(), null);
    assert.equal(await binding.collectOfflineReport(), null);
    assert.deepEqual(errors, []);
});

test('resume while a report is pending refreshes the same preview (no stacking); a new absence after collect creates one; no_reward is never retained', async () => {
    const ctx = await startSession();
    const { binding } = await bindingFor(ctx);
    const first = binding.getPendingOfflinePreview();
    await binding.suspend();
    ctx.clock.advanceUtcSeconds(3600);
    const resumed = binding.resume();
    assert.equal(resumed.status, 'existing_pending_preview');
    assert.equal(binding.getPendingOfflinePreview(), first, 'same pending report (the card refreshes its text, never stacks)');
    await binding.collectOfflineReport();
    assert.equal(binding.getPendingOfflinePreview(), null);
    await binding.suspend();
    ctx.clock.advanceUtcSeconds(2 * 3600);
    const second = binding.resume();
    assert.equal(second.status, 'preview_created');
    assert.equal(binding.getPendingOfflinePreview().effectiveOfflineSeconds, 2 * 3600);
    await binding.collectOfflineReport();
    // A 0 s absence has no reward: not retained, no card.
    await binding.suspend();
    const none = binding.resume();
    assert.notEqual(none.offlinePreview?.status, 'preview_ready');
    assert.equal(binding.getPendingOfflinePreview(), null);
});

test('a state with nothing automated has no collectible report at startup (no card)', async () => {
    const m = await modules();
    const { createFreshGameState } = await imp('assets/scripts/state/index.ts');
    const text = m.persistence.serializeGameStateToSaveJson(createFreshGameState(), {
        saveVersion: m.persistence.CURRENT_SAVE_VERSION,
        gameVersion: 'test',
        contentVersion: (await startSession()).repo.contentVersion,
        savedAtUtc: iso(NOW_MS - 5 * HOUR_MS),
    });
    const ctx = await startSession({ files: { [m.persistence.SAVE_MAIN_NAME]: text } });
    assert.notEqual(ctx.startup.offlinePreview?.status, 'preview_ready');
    assert.equal(ctx.session.getPendingOfflinePreview(), null);
    const { binding } = await bindingFor(ctx);
    assert.equal(binding.getPendingOfflinePreview(), null);
});

test('Reboot while a report is pending is blocked (callback once), then proceeds past the pending gate after Collect', async () => {
    const ctx = await startSession();
    let blocked = 0;
    const { binding } = await bindingFor(ctx, { onRebootBlocked: () => { blocked += 1; } });
    const before = JSON.stringify(ctx.session.getStateSnapshot());
    const direct = await ctx.session.rebootCivilizationConfirmed();
    assert.equal(direct.status, 'pending_offline_preview');
    const result = await binding.submit({ type: 'rebootCivilization', confirmed: true });
    assert.equal(result, null);
    assert.equal(blocked, 1);
    assert.equal(JSON.stringify(ctx.session.getStateSnapshot()), before, 'nothing executed');
    await binding.collectOfflineReport();
    const after = await ctx.session.rebootCivilizationConfirmed();
    assert.notEqual(after.status, 'pending_offline_preview');
    const again = await binding.submit({ type: 'rebootCivilization', confirmed: true });
    assert.equal(blocked, 1, 'no further block once collected');
    assert.notEqual(again, null);
});

test('collect emits no domain event: no robot-threshold / milestone toast can start from it', async () => {
    const ctx = await startSession();
    const consumed = [];
    const hud = viewSink();
    const binding = new ctx.m.binding.FactoryWorldStateBinding({
        session: ctx.session,
        configRepository: ctx.repo,
        automation: { syncAutomationState: () => undefined, consumeDomainEvents: (state, events) => consumed.push(events) },
        hud,
        panel: viewSink(),
        observeDomainEvents: (events) => consumed.push(events),
    });
    const result = await binding.collectOfflineReport();
    assert.equal(result.status, 'collected_saved');
    assert.deepEqual(consumed, []);
    assert.equal(Object.hasOwn(result, 'events'), false);
});

// ---------------------------------------------------------------- D1: the report survives a reload

test('D1: ordinary saves while a report is pending keep the absence-start savedAtUtc', async () => {
    const ctx = await startSession();
    const absenceStart = iso(NOW_MS - 3 * HOUR_MS);
    assert.equal(await savedAtOf(ctx), absenceStart);
    ctx.clock.advanceUtcSeconds(40);
    ctx.clock.advanceMonotonicSeconds(40);
    const run = await ctx.session.execute({ type: 'manualProduce' }, { requestOrdinarySave: true });
    assert.equal(run.save.status, 'saved');
    assert.equal(run.save.intent, 'ordinary');
    assert.equal(await savedAtOf(ctx), absenceStart, 'the ordinary save did not stamp "now"');
    ctx.clock.advanceUtcSeconds(40);
    ctx.clock.advanceMonotonicSeconds(40);
    const tick = await ctx.session.advanceActiveSessionFromClock({ requestOrdinarySave: true });
    assert.ok(tick.save === null || (await savedAtOf(ctx)) === absenceStart);
    assert.equal(await savedAtOf(ctx), absenceStart);
    // suspend (a critical save) also keeps the cursor while pending.
    const suspended = await ctx.session.suspend();
    assert.equal(suspended.save.ok, true);
    assert.equal(await savedAtOf(ctx), absenceStart);
});

test('D1: killing the app before Collect and relaunching recomputes an equivalent report; Collect then advances the cursor', async () => {
    const first = await startSession();
    const originalPreview = first.session.getPendingOfflinePreview();
    first.clock.advanceUtcSeconds(60);
    first.clock.advanceMonotonicSeconds(60);
    const run = await first.session.execute({ type: 'manualProduce' }, { requestOrdinarySave: true });
    assert.equal(run.save.status, 'saved');

    // "Kill": a new process loads the same storage 90 s after the first launch.
    const second = await startSession({ storage: first.storage, offsetMs: 90_000 });
    const relaunched = second.session.getPendingOfflinePreview();
    assert.ok(relaunched, 'the report is still pending after the relaunch');
    assert.equal(relaunched.status, 'preview_ready');
    assert.equal(relaunched.effectiveOfflineSeconds, originalPreview.effectiveOfflineSeconds + 90);
    const drift = Math.abs(relaunched.totalIndustrialOutputReward - originalPreview.totalIndustrialOutputReward) / originalPreview.totalIndustrialOutputReward;
    assert.ok(drift < 0.01, `equivalent reward (drift ${drift})`);
    assert.ok(second.session.getStateSnapshot().run.industrialOutput > 0);

    const collect = await second.session.collectPendingOffline();
    assert.equal(collect.status, 'collected_saved');
    const collectedAt = iso(NOW_MS + 90_000);
    assert.equal(await savedAtOf(second), collectedAt, 'after Collect the cursor is the collection time');

    // A third launch right after Collect has nothing to collect.
    const third = await startSession({ storage: second.storage, offsetMs: 90_000 });
    assert.equal(third.session.getPendingOfflinePreview(), null);
});

test('D1: a preview created by resume keeps the suspend boundary through ordinary saves', async () => {
    const ctx = await startSession({ variant: 'first', offsetMs: 0 });
    await ctx.session.collectPendingOffline();
    const suspend = await ctx.session.suspend();
    const boundary = suspend.boundary.persistedUtcTimestamp;
    assert.equal(await savedAtOf(ctx), boundary);
    ctx.clock.advanceUtcSeconds(2 * 3600);
    ctx.clock.advanceMonotonicSeconds(2 * 3600);
    const resumed = ctx.session.resume();
    assert.equal(resumed.status, 'preview_created');
    const run = await ctx.session.execute({ type: 'manualProduce' }, { requestOrdinarySave: true });
    assert.equal(run.save.status, 'saved');
    assert.equal(await savedAtOf(ctx), boundary, 'the absence start survives ordinary saves');
    const relaunch = await startSession({ storage: ctx.storage, offsetMs: 2 * 3600 * 1000 + 1000 });
    assert.equal(relaunch.session.getPendingOfflinePreview().effectiveOfflineSeconds, 2 * 3600 + 1);
});

test('D1: with no pending report ordinary saves still stamp "now" (behaviour unchanged)', async () => {
    const ctx = await startSession();
    await ctx.session.collectPendingOffline();
    ctx.clock.advanceUtcSeconds(120);
    ctx.clock.advanceMonotonicSeconds(120);
    const run = await ctx.session.execute({ type: 'manualProduce' }, { requestOrdinarySave: true });
    assert.equal(run.save.status, 'saved');
    assert.equal(await savedAtOf(ctx), iso(NOW_MS + 120_000));
});

// ---------------------------------------------------------------- AUT-051b: sub-minute absences produce no card

test('AUT-051b: boundary 59.9 s hides the card (auto-collect), 60 s shows it; the gate uses the raw absence', async () => {
    const { vm } = await modules();
    assert.equal(vm.OFFLINE_REPORT_MIN_ABSENCE_SECONDS, 60);
    const ctx = await startSession();
    const base = ctx.startup.offlinePreview;
    const at = (rawAbsenceSeconds, extra = {}) => vm.createOfflineReportViewModel({ ...base, rawAbsenceSeconds, effectiveOfflineSeconds: rawAbsenceSeconds, ...extra });
    for (const [seconds, visible] of [[0.5, false], [30, false], [59, false], [59.9, false], [60, true], [60.1, true], [3600, true]]) {
        const model = at(seconds);
        assert.equal(model.visible, visible, `${seconds}s visible`);
        assert.equal(model.autoCollect, !visible, `${seconds}s autoCollect`);
    }
    // Capped absence: the raw absence (before the cap) decides, so a capped report is always above the threshold.
    const capped = vm.createOfflineReportViewModel({ ...base, rawAbsenceSeconds: 10 * 3600, effectiveOfflineSeconds: 8 * 3600, capApplied: true });
    assert.equal(capped.visible, true);
    assert.equal(capped.capApplied, true);
    // Raw absence missing: the effective seconds are used.
    assert.equal(vm.createOfflineReportViewModel({ ...base, rawAbsenceSeconds: undefined, effectiveOfflineSeconds: 30 }).autoCollect, true);
    // Non-collectible previews are neither shown nor auto-collected (nothing pending).
    for (const none of [null, undefined, { ...base, status: 'no_reward' }]) assert.equal(vm.createOfflineReportViewModel(none).autoCollect, false);
});

test('AUT-051b: a zero-reward preview at / above 60 s never shows "+0": it auto-collects without a card', async () => {
    const { vm } = await modules();
    const ctx = await startSession();
    const zero = vm.createOfflineReportViewModel({ ...ctx.startup.offlinePreview, totalIndustrialOutputReward: 0 });
    assert.equal(zero.visible, false);
    assert.equal(zero.autoCollect, true);
    assert.equal(vm.createOfflineReportViewModel({ ...ctx.startup.offlinePreview, totalIndustrialOutputReward: Number.NaN }).visible, false);
});

test('AUT-051b cold launch: a ~30 s absence has no card; the silent auto-collect applies the reward through the normal critical save and Reboot is not blocked', async () => {
    const ctx = await startSession({ variant: 'short' });
    const { vm } = ctx.m;
    const { binding, hud, errors } = await bindingFor(ctx);
    const pending = binding.getPendingOfflinePreview();
    const model = vm.createOfflineReportViewModel(pending);
    assert.equal(pending.status, 'preview_ready');
    assert.equal(model.visible, false);
    assert.equal(model.autoCollect, true);
    assert.ok(model.rawSeconds < 60 && model.reward > 0);
    const before = ctx.session.getStateSnapshot().run.industrialOutput;
    binding.init();
    hud.models.length = 0;
    // What the controller does for autoCollect: the same collect path as COLLECT.
    const result = await binding.collectOfflineReport();
    assert.equal(result.status, 'collected_saved');
    assert.equal(result.save.reason, 'offline_collect');
    assert.equal(result.save.intent, 'critical');
    assert.equal(ctx.session.getStateSnapshot().run.industrialOutput, before + model.reward, 'the reward is still applied');
    assert.equal(binding.getPendingOfflinePreview(), null);
    assert.equal(await savedAtOf(ctx), iso(NOW_MS), 'the collection cursor advanced');
    assert.equal(hud.models.length, 1);
    assert.deepEqual(errors, []);
    const reboot = await ctx.session.rebootCivilizationConfirmed();
    assert.notEqual(reboot.status, 'pending_offline_preview');
});

test('AUT-051b resume path: 59 s away auto-collects, 60 s away shows the card, a capped absence always shows it', async () => {
    const ctx = await startSession();
    const { vm } = ctx.m;
    await ctx.session.collectPendingOffline();
    const away = async (seconds) => {
        await ctx.session.suspend();
        ctx.clock.advanceUtcSeconds(seconds);
        ctx.clock.advanceMonotonicSeconds(seconds);
        const resumed = ctx.session.resume();
        assert.equal(resumed.status, 'preview_created', `${seconds}s`);
        return vm.createOfflineReportViewModel(ctx.session.getPendingOfflinePreview());
    };
    const short = await away(59);
    assert.deepEqual([short.visible, short.autoCollect, short.rawSeconds], [false, true, 59]);
    assert.equal((await ctx.session.collectPendingOffline()).status, 'collected_saved');
    const boundary = await away(60);
    assert.deepEqual([boundary.visible, boundary.autoCollect, boundary.rawSeconds], [true, false, 60]);
    await ctx.session.collectPendingOffline();
    const capped = await away(12 * 3600);
    assert.equal(capped.visible, true);
    assert.equal(capped.capApplied, true);
    assert.ok(capped.rawSeconds > capped.effectiveSeconds);
});

test('AUT-051b D1: a reload scenario with hours of absence still shows the same card (the gate does not touch persistence)', async () => {
    const first = await startSession({ variant: 'reload' });
    const { vm } = first.m;
    assert.equal(vm.createOfflineReportViewModel(first.session.getPendingOfflinePreview()).visible, true);
    const second = await startSession({ storage: first.storage, offsetMs: 8_000 });
    const model = vm.createOfflineReportViewModel(second.session.getPendingOfflinePreview());
    assert.equal(model.visible, true);
    assert.equal(model.effectiveSeconds, 3 * 3600 + 8);
});

test('AUT-051b source pins: the controller auto-collects silently through the collect emitter and reports auto_collected; no economy change', async () => {
    const source = await read('assets/scripts/presentation/OfflineReportController.ts');
    assert.match(source, /viewModel\.autoCollect/);
    assert.match(source, /autoCollectSilently/);
    assert.match(source, /'auto_collected'/);
    assert.match(source, /rawSeconds: viewModel\.rawSeconds, reward: viewModel\.reward, saveOk/);
    const diagnostics = await read('assets/scripts/presentation/DeviceDiagnostics.ts');
    assert.match(diagnostics, /'auto_collected'/);
    const offlineDir = fs.readdirSync(path.join(repoRoot, 'assets/scripts/offline')).filter((name) => name.endsWith('.ts'));
    for (const name of offlineDir) assert.doesNotMatch(fs.readFileSync(path.join(repoRoot, 'assets/scripts/offline', name), 'utf8'), /OFFLINE_REPORT_MIN_ABSENCE_SECONDS/);
});

// ---------------------------------------------------------------- source pins

test('source pins: pure files are engine-free, explicit .ts imports, no constructor parameter properties', async () => {
    for (const name of ['OfflineReportViewModel', 'OfflineReportText', 'OfflineReportLayout']) {
        const source = await read(`assets/scripts/presentation/${name}.ts`);
        assert.doesNotMatch(source, /from\s+['"]cc(\/env)?['"]/, name);
        for (const match of source.matchAll(/from\s+'(\.[^']+)'/g)) assert.match(match[1], /\.ts$/, `${name} import ${match[1]}`);
        assert.doesNotMatch(source, /constructor\s*\([^)]*\b(public|private|protected|readonly)\b/, name);
    }
    const checks = await read('tools/device/offline_report_checks.ts');
    assert.doesNotMatch(checks, /from\s+['"]cc['"]/);
});

test('source pins: the controller uses Graphics fills and scale visibility, no node.active toggle, no ad / rewarded affordance, no hardcoded English', async () => {
    const source = (await read('assets/scripts/presentation/OfflineReportController.ts')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.match(source, /addComponent\(Graphics\)/);
    assert.doesNotMatch(source, /addComponent\(Sprite\)/);
    assert.doesNotMatch(source, /\.active\s*=/);
    assert.doesNotMatch(source, /\bactive:\s*(true|false)/);
    assert.doesNotMatch(source, /rewarded|AdsService|\bads?\b|double|x2|×2/i);
    assert.doesNotMatch(source, /'COLLECT'|FACTORY REPORT|Industrial Output|Robots Built|Couldn/);
    assert.doesNotMatch(source, /uiBlockerNodes/);
    assert.match(source, /Label\.Overflow\.SHRINK/);
    assert.match(source, /lineHeight = /);
    assert.match(source, /Button/);
    assert.match(source, /setScale\(0, 0, 0\)/);
    assert.doesNotMatch(source, /GameCommand|executeCommand|runtime\./, 'it submits no command and owns no authority');
    // Touch swallowing only on the backdrop and the card.
    assert.equal((source.match(/\.on\(Node\.EventType\.TOUCH_/g) ?? []).length, 8);
});

test('source pins: scripts have metas with unique a0510000-... uuids', async () => {
    const uuids = new Set();
    for (const name of ['OfflineReportText', 'OfflineReportViewModel', 'OfflineReportLayout', 'OfflineReportController']) {
        const metaPath = path.join(repoRoot, `assets/scripts/presentation/${name}.ts.meta`);
        assert.ok(fs.existsSync(metaPath), `${name}.ts.meta`);
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        assert.match(meta.uuid, /^a0510000-0000-4000-8000-00000000000\d$/);
        assert.equal(meta.importer, 'typescript');
        uuids.add(meta.uuid);
    }
    assert.equal(uuids.size, 4);
});

test('source pins: the bootstrap wires the card through the binding (startup, resume, Reboot block), never a GameCommand', async () => {
    const bootstrap = await read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /createOfflineReport\(\)/);
    assert.match(bootstrap, /wiring\.offlineReport\.collectEmitter = \(\) => binding\.collectOfflineReport\(\);/);
    assert.match(bootstrap, /this\.showOfflineReport\('startup'\)/);
    assert.match(bootstrap, /this\.showOfflineReport\('resumed'\)/);
    assert.match(bootstrap, /onRebootBlockedByPendingOffline/);
    assert.match(bootstrap, /rects\.OfflineReportCard/);
    assert.match(bootstrap, /rects\.OfflineReportCollect/);
    // The root is the LAST child of the Canvas (above the HUD, the panel and the toast band) and hidden by scale.
    assert.match(bootstrap, /stretched\(canvas, 'OfflineReport'\)/);
    const binding = await read('assets/scripts/presentation/FactoryWorldStateBinding.ts');
    assert.match(binding, /getPendingOfflinePreview\?\(\): OfflinePreviewResult \| null;/);
    assert.match(binding, /collectPendingOffline\?\(\): Promise<LifecycleCollectResult>;/);
    const domain = await read('assets/scripts/domain/Commands.ts');
    assert.doesNotMatch(domain, /collectOffline/i, 'no CollectOffline GameCommand was added');
});

test('source pins: offline_report is in the diagnostics allow-list and the reveal event types', async () => {
    const { diagnostics } = await modules();
    assert.ok(diagnostics.DEVICE_EVENT_TYPES.includes('offline_report'));
    const { DEFAULT_REVEAL_EVENT_TYPES } = await imp('tools/device/reveal_capture.ts');
    assert.ok(DEFAULT_REVEAL_EVENT_TYPES.includes('offline_report'));
    // Disabled by default: no output until enabled; the line is a normal AUT-DEVICE line when enabled.
    const lines = [];
    diagnostics.configureDeviceDiagnostics({ enabled: true, sink: (line) => lines.push(line) });
    diagnostics.emitDeviceEvent('offline_report', { phase: 'shown', reward: 12.345 });
    diagnostics.configureDeviceDiagnostics({ enabled: false });
    const parsed = diagnostics.parseDeviceEventLine(lines[0]);
    assert.equal(parsed.evt, 'offline_report');
    assert.equal(parsed.phase, 'shown');
    assert.equal(parsed.reward, 12.35);
});

// ---------------------------------------------------------------- device tooling

test('seed: variants build valid saves with the intended absence and producer automation', async () => {
    const { seed, persistence, lifecycle, time, vm } = await modules();
    assert.deepEqual([...seed.AUT051_SEED_VARIANTS], ['first', 'compact', 'cap', 'reload', 'short']);
    assert.equal(seed.isAut051SeedVariant('cap'), true);
    assert.equal(seed.isAut051SeedVariant('nope'), false);
    for (const [variant, hours, educational, capApplied] of [['first', 3, true, false], ['compact', 3, false, false], ['cap', 10, true, true], ['reload', 3, true, false]]) {
        const text = seed.buildAut051SeededSave(variant, NOW_MS + 700);
        const envelope = JSON.parse(text);
        assert.equal(envelope.savedAtUtc, iso(NOW_MS - hours * HOUR_MS), `${variant} savedAtUtc = now - ${hours} h (whole seconds)`);
        const storage = new persistence.InMemorySaveStorage({ [persistence.SAVE_MAIN_NAME]: text });
        const clock = new time.ManualTimeService({ utcIso: iso(NOW_MS), monotonicSeconds: 0 });
        const boot = await lifecycle.bootstrapGameSession({ storage, timeService: clock });
        assert.equal(boot.startup.ok, true, variant);
        assert.equal(boot.startup.status, 'loaded_main');
        const model = vm.createOfflineReportViewModel(boot.startup.offlinePreview);
        assert.equal(model.visible, true, variant);
        assert.equal(model.explainShown, educational, variant);
        assert.equal(model.capApplied, capApplied, variant);
        assert.equal(model.effectiveSeconds, Math.min(hours * 3600, 8 * 3600), variant);
    }
    // AUT-051b: the short variant (~30 s) is under the minimum: no card, a silent auto-collect with a positive reward.
    const shortText = seed.buildAut051SeededSave('short', NOW_MS + 700);
    assert.equal(JSON.parse(shortText).savedAtUtc, iso(NOW_MS - 30_000));
    const shortBoot = await lifecycle.bootstrapGameSession({ storage: new persistence.InMemorySaveStorage({ [persistence.SAVE_MAIN_NAME]: shortText }), timeService: new time.ManualTimeService({ utcIso: iso(NOW_MS), monotonicSeconds: 0 }) });
    const shortModel = vm.createOfflineReportViewModel(shortBoot.startup.offlinePreview);
    assert.equal(shortModel.visible, false);
    assert.equal(shortModel.autoCollect, true);
    assert.ok(shortModel.reward > 0);
    const state = seed.buildAut051SeededState('first');
    assert.equal(state.run.automation.fabricator.isAutomated, true);
    assert.equal(state.run.automation.fabricator.isOfflineEligible, true);
    assert.equal(state.run.producers.assembly_station.isBuilt, true);
    assert.equal(seed.buildAut051SeededState('compact').run.producers.assembly_station?.isBuilt === true, false);
});

test('seed: seedAut051 force-stops, removes stale saves and the debug command, writes the save and relaunches', async () => {
    const { seed } = await modules();
    const { DEBUG_COMMAND_FILE } = await imp('assets/scripts/presentation/DebugCommandFile.ts');
    const calls = [];
    const driver = {
        forceStop: async (pkg) => { calls.push(['forceStop', pkg]); },
        appDataDirectory: async () => '/data/data/pkg',
        removeAppFiles: async (pkg, paths) => { calls.push(['remove', paths]); },
        writeAppFile: async (pkg, devicePath, text) => { calls.push(['write', devicePath, JSON.parse(text).savedAtUtc]); },
        launch: async (pkg, activity) => { calls.push(['launch', pkg, activity]); },
    };
    const filesDir = await seed.seedAut051(driver, 'pkg', 'act', 'cap', () => new Date(NOW_MS));
    assert.equal(filesDir, '/data/data/pkg/files/');
    assert.deepEqual(calls.map((call) => call[0]), ['forceStop', 'remove', 'write', 'launch']);
    const removed = calls[1][1];
    assert.ok(removed.some((p) => p.endsWith(DEBUG_COMMAND_FILE)));
    assert.ok(removed.some((p) => p.endsWith('save_main.json')));
    assert.deepEqual(calls[2], ['write', '/data/data/pkg/files/save_main.json', iso(NOW_MS - 10 * HOUR_MS)]);
});

test('device: scenarios, CLI usage and package script are registered', async () => {
    const { REVEAL_SCENARIOS } = await imp('tools/device/reveal_capture.ts');
    const collect = REVEAL_SCENARIOS.aut051;
    assert.equal(collect.trigger, 'offline-collect');
    assert.equal(collect.expectOfflineReport, 'collect');
    const reload = REVEAL_SCENARIOS['aut051-reload'];
    assert.equal(reload.trigger, 'none');
    assert.equal(reload.expectOfflineReport, 'reload');
    const cli = await read('tools/device/cli.ts');
    assert.match(cli, /command === 'seed-aut051'/);
    assert.match(cli, /seed-aut051 \[--variant first\|compact\|cap\|reload\|short\]/);
    assert.match(cli, /aut049\|aut049-post\|aut050\|aut051\|aut051-reload\|aut051-short\]/);
    const short = REVEAL_SCENARIOS['aut051-short'];
    assert.equal(short.trigger, 'none');
    assert.equal(short.expectOfflineReport, 'short');
    assert.match(await read('package.json'), /"device:seed-aut051": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools\/device\/cli\.ts seed-aut051"/);
});

function ev(tMs, evt, extra = {}) { return { tMs, event: { v: 1, seq: tMs, evt, ...extra } }; }

test('device checks: collect scenario passes on a full chain and fails on regressions', async () => {
    const { evaluateOfflineReport, OFFLINE_RELAUNCH_MARKER_EVT } = await imp('tools/device/offline_report_checks.ts');
    const rect = { x: 100, y: 500, w: 800, h: 130 };
    const shown = ev(100, 'offline_report', { phase: 'shown', reward: 5000, effectiveSeconds: 10800, explainShown: true, cardRect: { x: 80, y: 400, w: 920, h: 480 }, collectRect: rect, texts: { title: 'FACTORY REPORT', collect: 'COLLECT', reward: '+5K Industrial Output' } });
    const good = [
        shown,
        ev(3000, 'offline_report', { phase: 'collect_tapped' }),
        ev(3050, 'offline_report', { phase: 'collect_result', status: 'collected_saved', saveOk: true }),
        ev(3060, 'offline_report', { phase: 'hidden', scale: 0 }),
        ev(8000, OFFLINE_RELAUNCH_MARKER_EVT, { phase: 'relaunch' }),
        ev(9000, 'offline_report', { phase: 'skipped', status: 'no_reward' }),
    ];
    const run = (events) => evaluateOfflineReport(events, 'collect');
    assert.ok(run(good).every((c) => c.ok), JSON.stringify(run(good).filter((c) => !c.ok)));
    const failing = (events, id) => run(events).find((c) => c.id === id)?.ok === false;
    assert.ok(failing(good.filter((e) => e.event.phase !== 'hidden'), 'offline_card_hidden_after_collect'));
    assert.ok(failing([...good.slice(0, 5), ev(9000, 'offline_report', { phase: 'shown', reward: 5000, cardRect: rect, collectRect: rect })], 'offline_no_original_report_after_relaunch'));
    assert.ok(failing([...good.slice(0, 4), ev(3070, 'milestone_presentation', { phase: 'toast_started' }), ...good.slice(4)], 'offline_collect_no_fanfare'));
    assert.ok(failing(good.map((e) => (e.event.phase === 'collect_result' ? ev(3050, 'offline_report', { phase: 'collect_result', status: 'collected_persistence_failed', saveOk: false }) : e)), 'offline_collect_saved'));
    assert.ok(failing([ev(100, 'offline_report', { ...shown.event, texts: { collect: 'Watch ad for x2' } }), ...good.slice(1)], 'offline_no_ad_affordance'));
    assert.ok(failing(good.slice(1), 'offline_card_shown_on_launch'));
    // AUT-051b: the sub-minute relaunch gap is silent (a card after the relaunch fails even when small).
    assert.ok(failing([...good.slice(0, 5), ev(9000, 'offline_report', { phase: 'shown', reward: 10, effectiveSeconds: 8, cardRect: rect, collectRect: rect })], 'offline_relaunch_gap_silent'));
    assert.ok(run([...good.slice(0, 5), ev(9000, 'offline_report', { phase: 'auto_collected', status: 'collected_saved', saveOk: true, rawSeconds: 8, reward: 10 })]).every((c) => c.ok));
});

test('device checks: reload scenario needs the card again after the kill with an equivalent reward and no Collect', async () => {
    const { evaluateOfflineReport, OFFLINE_RELAUNCH_MARKER_EVT } = await imp('tools/device/offline_report_checks.ts');
    const rect = { x: 100, y: 500, w: 800, h: 130 };
    const shown = (t, reward) => ev(t, 'offline_report', { phase: 'shown', reward, effectiveSeconds: 10800, cardRect: rect, collectRect: rect, texts: {} });
    const marker = ev(5000, OFFLINE_RELAUNCH_MARKER_EVT, { phase: 'relaunch' });
    const ok = evaluateOfflineReport([shown(100, 5000), marker, shown(9000, 5003)], 'reload');
    assert.ok(ok.every((c) => c.ok), JSON.stringify(ok.filter((c) => !c.ok)));
    assert.equal(evaluateOfflineReport([shown(100, 5000), marker], 'reload').find((c) => c.id === 'offline_report_reloaded_after_kill').ok, false);
    assert.equal(evaluateOfflineReport([shown(100, 5000), marker, shown(9000, 9000)], 'reload').find((c) => c.id === 'offline_report_reloaded_after_kill').ok, false);
    assert.equal(evaluateOfflineReport([shown(100, 5000), ev(200, 'offline_report', { phase: 'collect_tapped' }), marker, shown(9000, 5000)], 'reload').find((c) => c.id === 'offline_no_collect_in_reload').ok, false);
});
