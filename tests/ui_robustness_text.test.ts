const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * AUT-070 text robustness: every en.json entry is mapped to the UI slot (rect width, nominal font, minimum font, line count) it is rendered
 * in, rendered with worst-case parameters in English and in the pseudo-locales (+40% expansion, +100% expansion, wide glyphs), and run through
 * the shared TextFit rules. Pinned:
 *  - English never needs truncation and never goes below the minimum font (device-proven wording / geometry unchanged);
 *  - in every variant the fitted text fits its rect at the chosen font (lines <= slot lines, each line within the width, font >= minimum);
 *  - short action labels (buttons, tabs, ON/OFF, chips) are never truncated at +40%;
 *  - no raw key, no unresolved placeholder.
 * The slot table covers every catalogue key (a new key without a slot fails), so it doubles as the rect map of the localization.
 */
const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const english = JSON.parse(fs.readFileSync(path.join(repoRoot, 'localization/en.json'), 'utf8').replace(/\r\n/g, '\n')).entries;
const KEYS = Object.keys(english);

async function setup() {
    const [localization, pseudo, fit, ui, settings, offline, upgrades, reboot, founder, extended, toast, offlineText] = await Promise.all([
        imp('assets/scripts/localization/index.ts'),
        imp('assets/scripts/localization/PseudoLocale.ts'),
        imp('assets/scripts/presentation/TextFit.ts'),
        imp('assets/scripts/presentation/UiLayout.ts'),
        imp('assets/scripts/presentation/SettingsLayout.ts'),
        imp('assets/scripts/presentation/OfflineReportLayout.ts'),
        imp('assets/scripts/presentation/PermanentUpgradeLayout.ts'),
        imp('assets/scripts/presentation/RebootLayout.ts'),
        imp('assets/scripts/presentation/FounderShopLayout.ts'),
        imp('assets/scripts/presentation/ExtendedOverclockLayout.ts'),
        imp('assets/scripts/presentation/MilestoneToastLayout.ts'),
        imp('assets/scripts/presentation/OfflineReportText.ts'),
    ]);
    const base = localization.getDefaultTextCatalogue();
    const variants = {
        english: base,
        'pseudo +40%': pseudo.makePseudoLocaleCatalogue(base, 0.4),
        'pseudo +100%': pseudo.makePseudoLocaleCatalogue(base, 1.0),
        'wide glyph': pseudo.makeWideGlyphPseudoLocaleCatalogue(base),
    };
    return { localization, fit, ui, settings, offline, upgrades, reboot, founder, extended, toast, offlineText, variants };
}

/** Slots: [key regex, slot id, width, nominal font, min font, lines, "short label" (never truncated at +40%)]. */
function buildSlots(m) {
    const { ui, settings, offline, upgrades, reboot, founder, extended, toast } = m;
    const hudWidth = ui.cardRowWidth(ui.CORE_HUD_LAYOUT);
    const panelWidth = ui.cardRowWidth(ui.PRODUCER_PANEL_LAYOUT);
    const body = ui.UI_MIN_BODY_FONT_SIZE;
    const font = (card, key) => card.rows.find((row) => row.key === key).fontSize;
    const split = ui.cardPrimaryActionSplitRects(ui.PRODUCER_PANEL_LAYOUT).primary.w;
    const action = ui.PRODUCER_PANEL_LAYOUT.actionRow;
    const off = offline.resolveOfflineReportCardLayout({ capReached: true, robots: true, note: true, x2: true });
    const offRow = (key) => off.rows.find((row) => row.key === key);
    const up = upgrades.resolvePermanentUpgradePanelLayout();
    const st = settings.resolveSettingsPanelLayout(settings.SETTINGS_ROW_COUNT_WITH_PRIVACY);
    const rb = reboot.resolveRebootPanelLayout();
    const fd = founder.resolveFounderPanelLayout();
    const fdChip = founder.resolveFounderChipLayout();
    const ex = extended.resolveExtendedOverclockChipLayout();
    const T = toast.MILESTONE_TOAST_LAYOUT;
    const S = (re, id, width, fontSize, minFont, lines = 1, short = false) => ({ re, id, width, fontSize, minFont, lines, short });
    return [
        // HUD (UiLayout rows).
        S(/^hud\.industrial_output$/, 'hud.IndustrialOutputValue', hudWidth, font(ui.CORE_HUD_LAYOUT, 'IndustrialOutputValue'), body),
        S(/^hud\.production_per_second$/, 'hud.ProductionPerSecondValue', hudWidth, font(ui.CORE_HUD_LAYOUT, 'ProductionPerSecondValue'), body),
        S(/^hud\.(free|extended)_overclock\./, 'hud.OverclockAction rows', hudWidth - 6, font(ui.CORE_HUD_LAYOUT, 'FreeOverclockValue'), body),
        S(/^hud\.action\.manual_produce$/, 'hud.ManualProduceAction (split half)', split, ui.PRODUCER_PANEL_LAYOUT.primaryAction.fontSize, body, 1, true),
        S(/^hud\.action\.next_goal_unlock$/, 'hud.NextGoalAction', ui.CORE_HUD_LAYOUT.actionRow.actions[0].width, ui.CORE_HUD_LAYOUT.actionRow.fontSize, body, 1, true),
        S(/^next_goal\.(producer_build|producer_milestone|breakthrough|era)(\.generic)?$|^next_goal\.(reboot_ai_core|none|unknown)$/, 'hud.NextGoalValue', hudWidth, font(ui.CORE_HUD_LAYOUT, 'NextGoalValue'), body),
        S(/^next_goal\.(progress|cost|affordability\.|blocking\.)/, 'hud.NextGoalContext', hudWidth, font(ui.CORE_HUD_LAYOUT, 'NextGoalContext'), body),
        // Producer Panel.
        S(/^producer\.[a-z_]+\.name$/, 'panel.ProducerName', panelWidth, font(ui.PRODUCER_PANEL_LAYOUT, 'ProducerName'), body),
        S(/^producer_panel\.none_selected$/, 'panel.ProducerName', panelWidth, font(ui.PRODUCER_PANEL_LAYOUT, 'ProducerName'), body),
        S(/^producer_panel\.(level|production_per_second)$/, 'panel.ProducerLevel/Production', panelWidth, font(ui.PRODUCER_PANEL_LAYOUT, 'ProducerLevel'), body),
        S(/^producer_panel\.milestone\./, 'panel.ProducerMilestone', panelWidth, font(ui.PRODUCER_PANEL_LAYOUT, 'ProducerMilestone'), body),
        S(/^producer_panel\.(buy_1|buy_10|buy_max|action|action\.unavailable|action\.max|action\.max\.unavailable)$/, 'panel.Action_x* (2 lines)', action.actions[0].width, action.fontSize, body, action.captionLines),
        S(/^producer_panel\.assembly_batch\./, 'panel.AssemblyBatchAction (split half)', split, ui.PRODUCER_PANEL_LAYOUT.primaryAction.fontSize, body),
        // Offline report card.
        S(/^offline\.title$/, 'offline.title', offRow('title').w, offRow('title').fontSize, body),
        S(/^offline\.time_away$/, 'offline.timeAway', offRow('timeAway').w, offRow('timeAway').fontSize, body),
        S(/^offline\.cap_reached$/, 'offline.capReached', offRow('capReached').w, offRow('capReached').fontSize, body),
        S(/^offline\.reward$/, 'offline.reward', offRow('reward').w, offRow('reward').fontSize, body),
        S(/^offline\.(robots|robot_single)$/, 'offline.robots', offRow('robots').w, offRow('robots').fontSize, body),
        S(/^offline\.(explain\.|collect_failed$|double\.not_granted$)/, 'offline.note (2 lines)', offRow('note').w, offRow('note').fontSize, body, offRow('note').lines),
        S(/^offline\.collect$/, 'offline.collect', off.collect.w, off.collect.fontSize, offline.OFFLINE_REPORT_MIN_COLLECT_FONT_SIZE, 1, true),
        S(/^offline\.double\.button$/, 'offline.double', off.double.w - 24, off.double.fontSize, offline.OFFLINE_REPORT_MIN_COLLECT_FONT_SIZE),
        S(/^offline\.double\.tag$/, 'offline.double tag', off.double.w - 24, off.double.tagFontSize, body),
        // Extended Overclock chip.
        S(/^extended_overclock\.button$/, 'extended_overclock.label', ex.label.w, extended.EXTENDED_OVERCLOCK_LABEL_FONT_SIZE, body),
        S(/^extended_overclock\.(tag|not_granted)$/, 'extended_overclock.tag', ex.tag.w, extended.EXTENDED_OVERCLOCK_TAG_FONT_SIZE, body),
        // AI Upgrades panel.
        S(/^permanent_upgrade\.[a-z_]+\.name$/, 'upgrades.row name', up.rows[0].name.w, upgrades.PERMANENT_UPGRADE_NAME_FONT_SIZE, body),
        S(/^upgrades\.title$|^upgrades\.purchase_failed$/, 'upgrades.title', up.title.w, upgrades.PERMANENT_UPGRADE_HEADER_FONT_SIZE, body),
        S(/^upgrades\.chip$/, 'upgrades.chip', 92, upgrades.PERMANENT_UPGRADE_CHIP_FONT_SIZE, body, 1, true),
        S(/^upgrades\.balance$/, 'upgrades.balance', up.balance.w, upgrades.PERMANENT_UPGRADE_BALANCE_FONT_SIZE, body, 1, true),
        S(/^upgrades\.close$/, 'upgrades.close', up.close.w, upgrades.PERMANENT_UPGRADE_CLOSE_FONT_SIZE, upgrades.PERMANENT_UPGRADE_MIN_CLOSE_FONT_SIZE, 1, true),
        S(/^upgrades\.branch\./, 'upgrades.tab', up.tabs[0].w - 28, upgrades.PERMANENT_UPGRADE_TAB_FONT_SIZE, body, 1, true),
        S(/^upgrades\.rank$/, 'upgrades.rank', up.rows[0].rank.w, upgrades.PERMANENT_UPGRADE_RANK_FONT_SIZE, body),
        S(/^upgrades\.(buy|max|locked)$/, 'upgrades.buy', up.rows[0].buy.w - 12, upgrades.PERMANENT_UPGRADE_BUY_FONT_SIZE, body, 1, true),
        S(/^upgrades\.(needs|effect\.)/, 'upgrades.effect (2 lines)', up.rows[0].effect.w, upgrades.PERMANENT_UPGRADE_EFFECT_FONT_SIZE, body, 2),
        // Settings.
        S(/^settings\.title$/, 'settings.title', st.title.w, settings.SETTINGS_HEADER_FONT_SIZE, body),
        S(/^settings\.chip$/, 'settings.chip', 62, settings.SETTINGS_CHIP_FONT_SIZE, body, 1, true),
        S(/^settings\.(music|sfx|vibration|language|privacy)$/, 'settings.row label', st.rows[0].label.w, settings.SETTINGS_ROW_FONT_SIZE, body),
        S(/^settings\.(on|off|language\.[a-z]+|privacy\.open)$/, 'settings.pill', st.rows[0].pill.w - 8, settings.SETTINGS_PILL_FONT_SIZE, body, 1, true),
        S(/^settings\.close$/, 'settings.close', st.close.w, settings.SETTINGS_CLOSE_FONT_SIZE, settings.SETTINGS_MIN_CLOSE_FONT_SIZE, 1, true),
        // Reboot.
        S(/^reboot\.chip$/, 'reboot.chip', reboot.REBOOT_CHIP_LABEL.w, reboot.REBOOT_CHIP_FONT_SIZE, body, 1, true),
        S(/^reboot\.title$/, 'reboot.header', rb.header.w, reboot.REBOOT_HEADER_FONT_SIZE, body),
        S(/^reboot\.(reward|reward_single)$/, 'reboot.hero', rb.hero.w, reboot.REBOOT_HERO_FONT_SIZE, body),
        S(/^reboot\.(civilization|failed)$/, 'reboot.civilization', rb.civilization.w, reboot.REBOOT_CIVILIZATION_FONT_SIZE, body),
        S(/^reboot\.progress$/, 'reboot.progress', rb.progressLabel.w, reboot.REBOOT_PROGRESS_FONT_SIZE, body),
        S(/^reboot\.(resets_header|keeps_header)$/, 'reboot.column heading', rb.resets.heading.w - 26, reboot.REBOOT_COLUMN_HEADING_FONT_SIZE, body),
        S(/^reboot\.(reset|keep)\./, 'reboot.column line', rb.resets.lines[0].w, reboot.REBOOT_COLUMN_LINE_FONT_SIZE, body),
        S(/^reboot\.(confirm|cancel)$/, 'reboot.button', rb.confirm.w - 24, reboot.REBOOT_BUTTON_FONT_SIZE, reboot.REBOOT_MIN_BUTTON_FONT_SIZE, 1, true),
        // Founder's Pack.
        S(/^founder\.chip$/, 'founder.chip label', fdChip.label.w, founder.FOUNDER_CHIP_LABEL_FONT_SIZE, body),
        S(/^founder\.chip\.tag\./, 'founder.chip tag', fdChip.tag.w, founder.FOUNDER_CHIP_TAG_FONT_SIZE, body),
        S(/^founder\.title$/, 'founder.title', fd.title.w, founder.FOUNDER_TITLE_FONT_SIZE, body),
        S(/^founder\.content\./, 'founder.content row', fd.contentRows[0].w - 28, founder.FOUNDER_CONTENT_FONT_SIZE, body),
        S(/^founder\.price_label$/, 'founder.price label', fd.priceLabel.w, founder.FOUNDER_PRICE_FONT_SIZE, body),
        S(/^founder\.price\./, 'founder.price value', fd.priceValue.w, founder.FOUNDER_PRICE_FONT_SIZE, body),
        S(/^founder\.(status|note)\./, 'founder.note', fd.note.w, founder.FOUNDER_NOTE_FONT_SIZE, body),
        S(/^founder\.(buy|buy\.with_price|close)$/, 'founder.button', fd.buy.w, founder.FOUNDER_BUY_FONT_SIZE, body, 1, true),
        // Milestone toasts (title width = band width - 24 inside the band).
        S(/^toast\.(producer_milestone|automation|producer_constructed|producer_generic|extra)$/, 'toast.minor title', T.minor.width - 24, T.minor.titleFontSize, body),
        S(/^toast\.(breakthrough_generic|robots_built_title)$/, 'toast.major title', T.major.width - 24, T.major.titleFontSize, body),
        S(/^toast\.(breakthrough_subtitle|robots_built_subtitle)$/, 'toast.major subtitle', T.major.width - 24, T.major.subtitleFontSize, body),
        S(/^toast\.reboot_|^era\.[a-z_]+\.title_card$/, 'toast.exceptional title', T.exceptional.width - 24, T.exceptional.titleFontSize, body),
        // Display names reused on several surfaces: sized against the narrowest of the name slots.
        S(/^(breakthrough|era)\.[a-z_]+\.name$/, 'name (next goal / toast / panel)', hudWidth, font(ui.CORE_HUD_LAYOUT, 'NextGoalValue'), body),
    ];
}

/** Worst-case parameter values (the widest the formatters can produce) for a key, resolved through the same catalogue. */
function paramsFor(key, catalogue, offlineText) {
    const width = (text) => [...text].length;
    const named = (suffix) => KEYS.filter((k) => k.endsWith(suffix)).map((k) => catalogue.resolveText(k));
    const longest = (list) => list.reduce((a, b) => (width(b) > width(a) ? b : a));
    const allNames = named('.name');
    const producers = KEYS.filter((k) => /^producer\.[a-z_]+\.name$/.test(k)).map((k) => catalogue.resolveText(k));
    const params = {
        name: longest(allNames),
        names: producers.slice(0, 3).join(', '),
        value: '99.9T', current: '99.9T', required: '99.9T', cost: '99.9T', payout: '99.9T',
        level: 1000, threshold: 1000, remaining: 1000, count: 99, quantity: 9999, multiplier: 10, percent: 100, seconds: 59, minutes: 10, number: 9999, from: 99, to: 100,
        duration: offlineText.formatOfflineDuration(8 * 3600 + 59 * 60), price: 'CHF 999.99', rank: 5, max: 5,
        label: longest(['producer_panel.buy_1', 'producer_panel.buy_10', 'producer_panel.buy_max', 'hud.action.next_goal_unlock'].map((k) => catalogue.resolveText(k))),
        state: catalogue.resolveText('next_goal.affordability.unaffordable'),
        text: longest(producers),
        benefit: catalogue.resolveText('producer_panel.milestone.production_multiplier', { multiplier: 10 }),
    };
    if (key.startsWith('upgrades.')) { params.cost = 999; params.current = 5; }
    if (key === 'offline.robots') params.count = '999K';
    if (key === 'hud.free_overclock.timer') params.seconds = 86400;
    if (key === 'upgrades.effect.breakthrough_sooner' || key === 'upgrades.effect.starts_automated' || key === 'upgrades.needs') params.name = longest(named('.name').filter((n) => true));
    return params;
}

function assertInvariants(fit, slot, result, label) {
    assert.ok(result.fontSize >= slot.minFont - 1e-9, `${label}: font ${result.fontSize} < minimum ${slot.minFont}`);
    const lines = fit.wrapText(result.text, result.fontSize, slot.width);
    assert.ok(lines.length <= slot.lines, `${label}: ${lines.length} lines > ${slot.lines} ("${result.text}")`);
    for (const line of lines) assert.ok(fit.measureTextWidth(line, result.fontSize) <= slot.width + 1e-6, `${label}: line "${line}" wider than ${slot.width} at ${result.fontSize}`);
}

test('every en.json key is mapped to at least one UI slot (a new key needs a slot)', async () => {
    const m = await setup();
    const slots = buildSlots(m);
    const unmapped = KEYS.filter((key) => !slots.some((slot) => slot.re.test(key)));
    assert.deepEqual(unmapped, []);
    for (const slot of slots) {
        assert.ok(slot.width > 0 && slot.fontSize >= slot.minFont && slot.minFont >= 20 && slot.lines >= 1, `${slot.id}: ${JSON.stringify(slot)}`);
        assert.ok(KEYS.some((key) => slot.re.test(key)), `${slot.id}: matches no key (stale slot)`);
    }
});

for (const variantName of ['english', 'pseudo +40%', 'pseudo +100%', 'wide glyph']) {
    test(`text fit [${variantName}]: every key fits its slot after the TextFit rules; English and short labels are never truncated`, async () => {
        const m = await setup();
        const catalogue = m.variants[variantName];
        const slots = buildSlots(m);
        const truncated = [];
        const shrunk = [];
        let checked = 0;
        for (const key of KEYS) {
            const text = catalogue.resolveText(key, paramsFor(key, catalogue, m.offlineText));
            assert.doesNotMatch(text, /[{}]/, `${key}: placeholder left in "${text}"`);
            for (const slot of slots.filter((candidate) => candidate.re.test(key))) {
                const result = m.fit.fitText(text, { width: slot.width, fontSize: slot.fontSize, minFontSize: slot.minFont, maxLines: slot.lines });
                assertInvariants(m.fit, slot, result, `${variantName} ${key} @ ${slot.id}`);
                checked += 1;
                if (result.truncated) truncated.push(`${key} @ ${slot.id}`);
                if (result.shrunk) shrunk.push(`${key} @ ${slot.id}`);
                if (variantName === 'english') {
                    assert.equal(result.truncated, false, `English "${text}" needs truncation in ${slot.id}`);
                    assert.equal(result.text, text, 'English text is returned untouched');
                }
                if (variantName === 'pseudo +40%' && slot.short) assert.equal(result.truncated, false, `short label "${text}" truncated in ${slot.id}`);
            }
        }
        assert.ok(checked >= KEYS.length, `checked ${checked} slot renderings`);
        if (process.env.AUT070_REPORT) console.log(JSON.stringify({ variantName, truncated, shrunkCount: shrunk.length }, null, 1));
    });
}

test('TextFit rules: unchanged when it fits, shrink before truncating, ellipsis only at the minimum font, multi-line wrap, wide glyphs, no throw', async () => {
    const { fit } = await setup();
    const unchanged = fit.fitText('Lv 10', { width: 200, fontSize: 24, minFontSize: 20 });
    assert.deepEqual({ ...unchanged }, { text: 'Lv 10', fontSize: 24, lines: 1, shrunk: false, truncated: false });
    // Needs a smaller font but not an ellipsis: 30 chars * 0.48 * 24 = 345 > 330 > 288 (at 20).
    const shrunk = fit.fitText('x'.repeat(30), { width: 330, fontSize: 24, minFontSize: 20 });
    assert.equal(shrunk.truncated, false);
    assert.equal(shrunk.shrunk, true);
    assert.ok(shrunk.fontSize < 24 && shrunk.fontSize >= 20);
    const cut = fit.fitText('Automated producers kept working while you were away from the factory', { width: 300, fontSize: 22, minFontSize: 20 });
    assert.equal(cut.truncated, true);
    assert.equal(cut.fontSize, 20);
    assert.ok(cut.text.endsWith(fit.TEXT_ELLIPSIS));
    assert.ok(fit.measureTextWidth(cut.text, 20) <= 300);
    const twoLines = fit.fitText('Automated producers kept working. Manual: Fabricator.', { width: 300, fontSize: 22, minFontSize: 20, maxLines: 2 });
    assert.equal(twoLines.truncated, false);
    assert.equal(twoLines.lines <= 2, true);
    const longTwo = fit.fitText('Automated producers kept working. Manual: Fabricator, Assembly Station, Robot Line, Automated Cell and more.', { width: 300, fontSize: 22, minFontSize: 20, maxLines: 2 });
    assert.equal(longTwo.truncated, true);
    assert.ok(fit.wrapText(longTwo.text, 20, 300).length <= 2);
    assert.ok(longTwo.text.endsWith(fit.TEXT_ELLIPSIS));
    // One over-long word is broken by characters rather than overflowing.
    assert.ok(fit.wrapText('Supercalifragilisticexpialidocious', 20, 100).every((line) => fit.measureTextWidth(line, 20) <= 100));
    // Wide glyphs count a full em.
    assert.equal(fit.measureTextWidth('Ａ', 20), 20);
    assert.equal(fit.measureTextWidth('A', 20), 20 * fit.TEXT_GLYPH_WIDTH_PER_FONT_UNIT);
    // Degenerate input never throws.
    for (const [text, width] of [['', 100], ['   ', 100], ['a', 1], ['…', 0.1]]) assert.doesNotThrow(() => fit.fitText(text, { width, fontSize: 20, minFontSize: 20 }));
    assert.equal(fit.fitLabelText('Hi', { width: 100, fontSize: 20, minFontSize: 20 }), 'Hi');
});

test('TextFit is engine-free and every UI controller routes its label text through it', () => {
    const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');
    assert.doesNotMatch(read('assets/scripts/presentation/TextFit.ts'), /from\s+['"]cc['"]/);
    for (const rel of [
        'SettingsController', 'FounderShopController', 'ExtendedOverclockController', 'PermanentUpgradeController', 'RebootController',
        'OfflineReportController', 'MilestonePresentationController', 'CoreHudController', 'ProducerPanelController', 'AssemblyBatchActionController',
    ]) {
        assert.match(read(`assets/scripts/presentation/${rel}.ts`), /fitLabel\(/, `${rel} must fit its label text`);
    }
});

test('TextFit minimums equal the per-layout readable minimums (20 body, 28 primary button captions)', async () => {
    const m = await setup();
    assert.equal(m.fit.TEXT_MIN_BODY_FONT_SIZE, m.ui.UI_MIN_BODY_FONT_SIZE);
    for (const value of [m.settings.SETTINGS_MIN_BODY_FONT_SIZE, m.upgrades.PERMANENT_UPGRADE_MIN_BODY_FONT_SIZE, m.reboot.REBOOT_MIN_BODY_FONT_SIZE, m.founder.FOUNDER_MIN_BODY_FONT_SIZE, m.extended.EXTENDED_OVERCLOCK_MIN_FONT_SIZE]) assert.equal(value, m.fit.TEXT_MIN_BODY_FONT_SIZE);
    for (const value of [m.settings.SETTINGS_MIN_CLOSE_FONT_SIZE, m.upgrades.PERMANENT_UPGRADE_MIN_CLOSE_FONT_SIZE, m.reboot.REBOOT_MIN_BUTTON_FONT_SIZE, m.offline.OFFLINE_REPORT_MIN_COLLECT_FONT_SIZE]) assert.equal(value, m.fit.TEXT_MIN_BUTTON_FONT_SIZE);
});

test('new scripts ship their Cocos .meta files', () => {
    for (const name of ['TextFit', 'LabelFit']) assert.ok(fs.existsSync(path.join(repoRoot, `assets/scripts/presentation/${name}.ts.meta`)), name);
});
