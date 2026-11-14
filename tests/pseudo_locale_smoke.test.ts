const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const KEY_PATTERN = /\b[a-z_]+(\.[a-z0-9_]+)+\b/;

async function setup() {
    const [localization, pseudo, config, embedded, stateModule, hud, panel, text, toast, eraTransition, offline, offlineVm, upgrades, settingsVm, userSettings, settingsLayout] = await Promise.all([
        imp('assets/scripts/localization/index.ts'),
        imp('assets/scripts/localization/PseudoLocale.ts'),
        imp('assets/scripts/config/ConfigLoader.ts'),
        imp('assets/scripts/config/EmbeddedEconomyConfig.ts'),
        imp('assets/scripts/state/index.ts'),
        imp('assets/scripts/presentation/HudViewModel.ts'),
        imp('assets/scripts/presentation/ProducerPanelViewModel.ts'),
        imp('assets/scripts/presentation/PresentationText.ts'),
        imp('assets/scripts/presentation/MilestoneToastText.ts'),
        imp('assets/scripts/presentation/EraTransition.ts'),
        imp('assets/scripts/presentation/OfflineReportText.ts'),
        imp('assets/scripts/presentation/OfflineReportViewModel.ts'),
        imp('assets/scripts/presentation/PermanentUpgradePanelViewModel.ts'),
        imp('assets/scripts/presentation/SettingsViewModel.ts'),
        imp('assets/scripts/settings/UserSettings.ts'),
        imp('assets/scripts/presentation/SettingsLayout.ts'),
    ]);
    const repository = config.loadGameConfigFromSources(embedded.getEmbeddedEconomyConfigSources());
    const english = localization.getDefaultTextCatalogue();
    const reports = [];
    const catalogue = pseudo.makePseudoLocaleCatalogue(english);
    catalogue.setMissingTextSink((report) => reports.push(report));
    return { localization, pseudo, repository, english, catalogue, reports, stateModule, hud, panel, text, toast, eraTransition, offline, offlineVm, upgrades, settingsVm, userSettings, settingsLayout };
}

test('pseudo catalogue: same keys, placeholders preserved verbatim, about +40% length on every entry, never a key', async () => {
    const { localization, pseudo, english, catalogue } = await setup();
    assert.equal(catalogue.locale, 'pseudo');
    assert.deepEqual(catalogue.keys().sort(), english.keys().sort());
    for (const key of english.keys()) {
        const en = english.template(key);
        const ps = catalogue.template(key);
        assert.deepEqual(localization.extractPlaceholders(ps), localization.extractPlaceholders(en), `${key}: placeholders`);
        assert.ok(localization.hasWellFormedPlaceholders(ps), `${key}: well-formed`);
        const visibleEn = en.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g, '').length;
        const visiblePs = ps.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g, '').length;
        assert.ok(visiblePs >= visibleEn * 1.4 - 1e-9, `${key}: expanded by 40% (${visibleEn} -> ${visiblePs})`);
        assert.ok(visiblePs <= visibleEn * 1.4 + 1, `${key}: not more than 40% + 1`);
    }
    assert.equal(pseudo.pseudoLocalizeTemplate('Lv {level}'), 'Lv {level}··');
    assert.equal(pseudo.PSEUDO_LOCALE_EXPANSION, 0.4);
});

test('every composer resolves with the pseudo catalogue: no throw, no leftover {param}, no raw key, no missing-text report', async () => {
    const { repository, catalogue, reports, stateModule, hud, panel, text, toast, eraTransition, offline, offlineVm, upgrades, settingsVm, userSettings } = await setup();
    const rendered = [];
    const addAll = (value) => {
        if (typeof value === 'string') rendered.push(value);
        else if (Array.isArray(value)) value.forEach(addAll);
        else if (value && typeof value === 'object') Object.values(value).forEach(addAll);
    };
    // HUD + panel across a few states.
    const fresh = stateModule.createFreshGameState();
    const richer = stateModule.createFreshGameState();
    richer.run.producers.fabricator = { level: 15, isUnlocked: true, isBuilt: true };
    for (const state of [fresh, richer]) {
        addAll(text.formatHudTexts(hud.createHudViewModel(repository, state), repository, catalogue));
        for (const producer of [null, ...repository.listProducers().map((item) => item.id)]) addAll(text.formatPanelTexts(panel.createProducerPanelViewModel(repository, state, producer), catalogue));
    }
    addAll(text.defaultHudTexts(catalogue));
    addAll(text.defaultPanelTexts(catalogue));
    for (const state of ['locked', 'ready', 'active', 'cooldown', 'suspended']) addAll(text.formatFreeOverclockState(state, 2, catalogue));
    addAll(text.formatAssemblyBatchText({ state: 'ready', progress: 0, remainingSeconds: null, payoutFormatted: '90' }, catalogue));
    addAll(text.formatAssemblyBatchText({ state: 'running', progress: 0.4, remainingSeconds: 9, payoutFormatted: '90' }, catalogue));
    // Toasts.
    const trigger = (kind, extra = {}) => ({ key: 'k', tier: 'major', kind, accent: 'amber', producerId: 'fabricator', breakthroughId: 'auto_feeder', milestoneId: null, threshold: 25, focusProducerId: null, sparks: false, pulse: false, eraId: null, focusSuppressed: false, ...extra });
    for (const kind of ['producer_milestone', 'automation', 'producer_constructed', 'breakthrough', 'robots_built']) {
        addAll(toast.formatMilestoneToast(trigger(kind), repository, 0, catalogue));
        addAll(toast.formatMilestoneToast(trigger(kind), repository, 4, catalogue));
    }
    for (const eraId of ['automated_factory', 'robotics_complex']) addAll(toast.formatMilestoneToast(eraTransition.buildEraTrigger(eraId), repository, 0, catalogue));
    for (const beat of ['reboot', 'ai_core', 'civilization']) addAll(toast.formatMilestoneToast(trigger('reboot_title', { reboot: { newCivilization: 2, aiCoresGranted: 3 } }), repository, 0, catalogue, beat));
    // Offline report.
    const ids = repository.listProducers().map((item) => item.id);
    addAll(offline.formatOfflineReportTexts({ ...offlineVm.HIDDEN_OFFLINE_REPORT_VIEW_MODEL, visible: true, effectiveSeconds: 12_000, capApplied: true, capSeconds: 28_800, reward: 1_200_000, robotsDelta: 3, showRobotsRow: true, notAutomatedProducerIds: ids, explainShown: true }, repository, catalogue));
    addAll(offline.formatOfflineCollectFailed(catalogue));
    // AI upgrades.
    for (const ranks of [{}, { optimized_fabrication: 3 }]) {
        const meta = stateModule.createFreshGameState();
        meta.meta.civilizationNumber = 2;
        meta.meta.aiCores = 6;
        meta.meta.permanentUpgradeRanks = ranks;
        const model = upgrades.createPermanentUpgradePanelViewModel(repository, meta, catalogue);
        // Only the display strings (the view model also carries ids and catalogue keys).
        addAll([model.texts, model.branches.map((branch) => branch.label), model.rows.map((row) => [row.name, row.rankText, row.effectText, row.lockedText, row.buyText])]);
    }
    // Settings.
    for (const on of [true, false]) addAll(settingsVm.createSettingsViewModel({ ...userSettings.DEFAULT_USER_SETTINGS, musicEnabled: on, sfxEnabled: on, vibrationEnabled: on }, catalogue));
    assert.ok(rendered.length > 100, `enough strings rendered (${rendered.length})`);
    for (const value of rendered) {
        if (typeof value !== 'string' || value.length === 0) continue;
        assert.doesNotMatch(value, /[{}]/, `unresolved placeholder in "${value}"`);
        assert.doesNotMatch(value, KEY_PATTERN, `raw key in "${value}"`);
    }
    assert.deepEqual(reports, []);
});

test('per-label length heuristic: pseudo-expanded Settings and toast labels still fit their boxes at the 20-unit minimum font (SHRINK handles the rest)', async () => {
    const { catalogue, settingsVm, userSettings, settingsLayout: L } = await setup();
    const model = settingsVm.createSettingsViewModel(userSettings.DEFAULT_USER_SETTINGS, catalogue);
    const layout = L.resolveSettingsPanelLayout();
    const GLYPH = 0.55; // average glyph width as a share of the font size (conservative for a bold sans).
    const fits = (text, boxWidth, label) => assert.ok(text.length * GLYPH * L.SETTINGS_MIN_BODY_FONT_SIZE <= boxWidth, `${label}: "${text}" (${text.length} chars) fits ${boxWidth} units at the minimum font`);
    model.rows.forEach((row, index) => {
        fits(row.label, layout.rows[index].label.w, `row label ${row.id}`);
        fits(row.valueText, layout.rows[index].pill.w, `pill ${row.id}`);
    });
    fits(model.texts.title, layout.title.w, 'title');
    fits(model.texts.close, layout.close.w, 'close');
    fits(model.texts.chip, 62, 'chip label');
    // Toast pill widths: the widest pseudo title of each tier still fits at the minimum font.
    const { MILESTONE_TOAST_LAYOUT } = await imp('assets/scripts/presentation/MilestoneToastLayout.ts');
    const toast = await imp('assets/scripts/presentation/MilestoneToastText.ts');
    const eraTransition = await imp('assets/scripts/presentation/EraTransition.ts');
    for (const eraId of ['automated_factory', 'robotics_complex']) {
        const title = toast.formatMilestoneToast(eraTransition.buildEraTrigger(eraId), null, 0, catalogue).title;
        fits(title, MILESTONE_TOAST_LAYOUT.exceptional.width - 2 * MILESTONE_TOAST_LAYOUT.exceptional.underlineInset, `era title ${eraId}`);
    }
});

test('the pseudo-locale is engine-free and is not a shipped language', async () => {
    const source = fs.readFileSync(path.join(repoRoot, 'assets/scripts/localization/PseudoLocale.ts'), 'utf8');
    assert.doesNotMatch(source, /from\s+['"]cc['"]/);
    const localization = await imp('assets/scripts/localization/index.ts');
    assert.equal(localization.listAvailableLanguages().includes('pseudo'), false);
    assert.equal(fs.existsSync(path.join(repoRoot, 'localization', 'pseudo.json')), false);
});
