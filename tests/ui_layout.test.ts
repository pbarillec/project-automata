const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const layoutModule = () => imp('assets/scripts/presentation/UiLayout.ts');

// AUT-R-036-02 portrait reference screens (pixels): 16:9 HD/FHD, the NE2215 FHD+ (1080×2412), a
// 1272×2772 phone, and the NE2215 with a top inset (status bar / punch-hole) alone and symmetric
// (cc.SafeArea's default mirrors it at the bottom).
const SCREENS = [
    { name: '720x1280', w: 720, h: 1280, safe: null },
    { name: '1080x1920', w: 1080, h: 1920, safe: null },
    { name: '1080x2412', w: 1080, h: 2412, safe: null },
    { name: '1272x2772', w: 1272, h: 2772, safe: null },
    { name: '1080x2412 top inset 130', w: 1080, h: 2412, safe: { x: 0, y: 0, w: 1080, h: 2412 - 130 }, topInset: 130 },
    { name: '1080x2412 symmetric inset 130', w: 1080, h: 2412, safe: { x: 0, y: 130, w: 1080, h: 2412 - 260 }, topInset: 130 },
];

for (const screen of SCREENS) {
    test(`UiLayout ${screen.name}: full-width bands and buttons fit the safe area, never overlap, and stay within the coverage budget`, async () => {
        const L = await layoutModule();
        const layout = L.computeUiLayout({ w: screen.w, h: screen.h }, screen.safe ?? undefined);
        const safe = layout.safeArea;
        for (const [name, rect] of [['hud', layout.hud], ['panel', layout.panel], ...Object.entries(layout.buttons), ...Object.entries(layout.hudButtons)]) {
            assert.ok(L.rectContains(layout.screen, rect, 1), `${name} inside the screen`);
            assert.ok(L.rectContains(safe, rect, 1), `${name} inside the safe area`);
        }
        assert.equal(L.rectsOverlap(layout.hud, layout.panel), false, 'HUD and panel overlap');
        for (const [key, rect] of Object.entries(layout.buttons)) assert.ok(L.rectContains(layout.panel, rect, 1), `${key} inside the panel`);
        const coverage = (L.rectArea(layout.hud) + L.rectArea(layout.panel)) / L.rectArea(layout.screen);
        assert.ok(coverage <= L.UI_MAX_COVERAGE, `coverage ${coverage} > 35%`);
        // Fixed width: one design unit is screen.w / 720 pixels.
        assert.equal(layout.scale, screen.w / 720);
        const margin = L.UI_EDGE_MARGIN * layout.scale;
        // HUD = top band, panel = bottom band, both full width (margin on each side) and centred.
        for (const rect of [layout.hud, layout.panel]) {
            assert.ok(Math.abs(rect.w - L.UI_BAND_WIDTH * layout.scale) < 1e-9, 'band width');
            assert.ok(Math.abs(rect.x - margin) < 1e-6 && Math.abs(screen.w - (rect.x + rect.w) - margin) < 1e-6, 'band centred with the edge margin');
        }
        assert.ok(Math.abs(layout.hud.y + layout.hud.h - (safe.y + safe.h - margin)) < 1e-6, 'HUD at the safe-area top');
        assert.ok(Math.abs(layout.panel.y - (safe.y + margin)) < 1e-6, 'panel at the safe-area bottom');
        assert.ok(layout.hud.y > layout.panel.y + layout.panel.h, 'HUD above the panel');
        // The factory band lies between the two cards, full width, and nothing of the UI is inside it.
        assert.deepEqual(layout.factoryBand, { x: 0, y: layout.panel.y + layout.panel.h, w: screen.w, h: layout.hud.y - (layout.panel.y + layout.panel.h) });
        assert.equal(L.rectsOverlap(layout.factoryBand, layout.hud) || L.rectsOverlap(layout.factoryBand, layout.panel), false);
        if (screen.topInset) assert.ok(layout.hud.y + layout.hud.h <= screen.h - screen.topInset - margin + 1e-6, 'HUD clears the top inset');
    });
}

test('UiLayout: 16:9 portrait is the worst case and the factory keeps at least 65% there', async () => {
    const L = await layoutModule();
    const at169 = L.computeUiLayout({ w: 720, h: 1280 });
    const tall = L.computeUiLayout({ w: 1080, h: 2412 });
    const cover = (layout) => (L.rectArea(layout.hud) + L.rectArea(layout.panel)) / L.rectArea(layout.screen);
    assert.ok(cover(at169) >= cover(tall));
    assert.ok(cover(at169) <= L.UI_MAX_COVERAGE, String(cover(at169)));
    assert.ok(1 - cover(at169) >= 0.65);
    // NE2215: about 26% UI.
    assert.ok(cover(tall) < 0.28, String(cover(tall)));
});

test('UiLayout: design resolution, margins, band anchors and body font sizes', async () => {
    const L = await layoutModule();
    assert.deepEqual(L.UI_DESIGN_RESOLUTION, { width: 720, height: 1280 });
    assert.ok(L.UI_EDGE_MARGIN > 0);
    assert.equal(L.UI_BAND_WIDTH, 720 - 2 * L.UI_EDGE_MARGIN);
    assert.equal(L.UI_MIN_BODY_FONT_SIZE, 20);
    for (const card of [L.CORE_HUD_LAYOUT, L.PRODUCER_PANEL_LAYOUT]) {
        assert.equal(card.width, L.UI_BAND_WIDTH, `${card.name} is a full-width band`);
        for (const row of card.rows) {
            assert.ok(row.fontSize >= L.UI_MIN_BODY_FONT_SIZE, `${card.name}.${row.key} font ${row.fontSize}`);
            assert.ok(row.height >= row.fontSize, `${card.name}.${row.key} row shorter than its font`);
        }
    }
    assert.equal(L.CORE_HUD_LAYOUT.corner, 'top');
    assert.equal(L.PRODUCER_PANEL_LAYOUT.corner, 'bottom');
});

test('UiLayout AUT-R-036-02: ×1/×10/×MAX sit side by side in one panel row with two-line captions', async () => {
    const L = await layoutModule();
    const card = L.PRODUCER_PANEL_LAYOUT;
    const row = card.actionRow;
    assert.ok(row, 'panel has an action row');
    assert.deepEqual(row.actions.map((a) => a.key), [...L.PANEL_ACTION_KEYS]);
    assert.equal(row.actions.reduce((sum, a) => sum + a.width, 0) + row.gap * (row.actions.length - 1), L.cardRowWidth(card), 'buttons + gaps fill the row width');
    assert.ok(row.gap > 0 && row.fontSize >= L.UI_MIN_BODY_FONT_SIZE);
    assert.equal(row.captionLines, 2);
    assert.ok(row.lineHeight >= row.fontSize && row.lineHeight * row.captionLines <= row.height, 'two lines fit the Button height');
    assert.ok(card.rows.every((r) => !r.key.startsWith('Action_')), 'no stacked action rows');
    const lastIndex = card.rows.length - 1;
    const lastRowBottom = L.cardRowCenterY(card, lastIndex) - card.rows[lastIndex].height / 2;
    const ys = new Set();
    for (const key of L.PANEL_ACTION_KEYS) {
        const local = L.cardActionRect(card, key);
        ys.add(local.y);
        assert.ok(local.y + local.h / 2 <= lastRowBottom + 1e-9, `${key} below the label rows`);
        assert.ok(local.y - local.h / 2 >= -L.cardHeight(card) / 2 + card.padding - 1e-9, `${key} inside the bottom padding`);
    }
    assert.equal(ys.size, 1, 'one row');
    for (const screen of SCREENS) {
        const layout = L.computeUiLayout({ w: screen.w, h: screen.h }, screen.safe ?? undefined);
        const rects = L.PANEL_ACTION_KEYS.map((key) => layout.buttons[key]);
        const shrink = (r) => ({ x: r.x + 1e-6, y: r.y + 1e-6, w: r.w - 2e-6, h: r.h - 2e-6 });
        for (let i = 0; i < rects.length; i += 1) {
            for (let j = i + 1; j < rects.length; j += 1) assert.equal(L.rectsOverlap(shrink(rects[i]), rects[j]), false, `${screen.name} panel Buttons ${i}/${j} overlap`);
            for (const labelRow of Object.values(layout.rows.panel)) assert.equal(L.rectsOverlap(shrink(rects[i]), labelRow), false, `${screen.name} Button over a label row`);
        }
    }
});

test('UiLayout rows stack top-down inside the card and match the controller entry order', async () => {
    const L = await layoutModule();
    const sources = {
        CoreHUD: await readFile(path.join(repoRoot, 'assets/scripts/presentation/CoreHudController.ts'), 'utf8'),
        ProducerPanel: await readFile(path.join(repoRoot, 'assets/scripts/presentation/ProducerPanelController.ts'), 'utf8'),
    };
    for (const card of [L.CORE_HUD_LAYOUT, L.PRODUCER_PANEL_LAYOUT]) {
        const entries = sources[card.name].match(/const entries = \[(.*?)\] as const/);
        assert.ok(entries, `${card.name} entries`);
        assert.deepEqual(card.rows.map((row) => row.key), [...entries[1].matchAll(/\['(\w+)'/g)].map((m) => m[1]));
        const half = L.cardHeight(card) / 2;
        let previous = Infinity;
        card.rows.forEach((row, index) => {
            const y = L.cardRowCenterY(card, index);
            assert.ok(y < previous, `${card.name} rows go down`);
            assert.ok(y + row.height / 2 <= half - card.padding + 1e-9 && y - row.height / 2 >= -half + card.padding - 1e-9, `${card.name}.${row.key} inside the card`);
            previous = y;
        });
        assert.throws(() => L.cardRowCenterY(card, card.rows.length), RangeError);
    }
});

test('UiLayout widget alignment maps each band to one vertical edge plus the horizontal centre (no stretch)', async () => {
    const L = await layoutModule();
    for (const corner of ['top', 'bottom']) {
        const a = L.widgetAlignment(corner);
        assert.equal(Number(a.top) + Number(a.bottom), 1, corner);
        assert.equal(a.left || a.right, false, corner);
        assert.equal(a.horizontalCenter, true, corner);
    }
    assert.equal(L.widgetAlignment('top').top, true);
    assert.equal(L.widgetAlignment('bottom').bottom, true);
});

test('UiLayout geometry helpers', async () => {
    const L = await layoutModule();
    const outer = { x: 0, y: 0, w: 10, h: 10 };
    assert.equal(L.rectContains(outer, { x: 1, y: 1, w: 2, h: 2 }), true);
    assert.equal(L.rectContains(outer, { x: 9, y: 1, w: 2, h: 2 }), false);
    assert.equal(L.rectContains(outer, { x: 9, y: 1, w: 1.5, h: 2 }, 1), true);
    assert.equal(L.rectsOverlap(outer, { x: 10, y: 0, w: 2, h: 2 }), false);
    assert.equal(L.rectsOverlap(outer, { x: 9, y: 9, w: 2, h: 2 }), true);
    assert.equal(L.rectArea({ x: 0, y: 0, w: -1, h: 5 }), 0);
    assert.equal(L.rectContainsPoint(outer, 5, 5), true);
    assert.equal(L.rectContainsPoint(outer, 11, 5), false);
});

test('UiLayout is engine-free', async () => {
    const source = await readFile(path.join(repoRoot, 'assets/scripts/presentation/UiLayout.ts'), 'utf8');
    assert.doesNotMatch(source, /from\s+['"]cc(\/env)?['"]/);
});

// AUT-R-036 retry 1: rows are sized for the longest representative real catalogue strings at their
// nominal font size; Label SHRINK is only a safety net. Width estimate: 0.48 × fontSize per character,
// a margin over the 0.42–0.46 measured for the default font on the NE2215 (gate screenshots: "Industrial
// Output: 0" @32, "Buy ×10 193.4 • Unavailable" @22, "Next milestone Lv 10: ×2 production (10 to go)" @20).
const CHAR_WIDTH_PER_FONT_UNIT = 0.48;
// formatCompactNumber never exceeds 5 characters below 1e15 ("99.9T", "9.99T", "999.5").
const WIDE_NUMBER = '99.9T';

async function representativeStrings() {
    const { getDefaultTextCatalogue } = await imp('assets/scripts/localization/index.ts');
    const { formatCompactNumber } = await imp('assets/scripts/presentation/NumberFormatter.ts');
    assert.ok(formatCompactNumber(999.5e12).length <= WIDE_NUMBER.length);
    const c = getDefaultTextCatalogue();
    const doc = JSON.parse(await readFile(path.join(repoRoot, 'localization/en.json'), 'utf8'));
    const keys = Object.keys(doc.entries);
    const names = (prefix) => keys.filter((k) => k.startsWith(prefix) && k.endsWith('.name')).map((k) => c.resolveText(k));
    const producers = names('producer.');
    const goalNames = [...producers, ...names('breakthrough.'), ...names('era.')];
    const milestones = JSON.parse(await readFile(path.join(repoRoot, 'data/economy/milestones.json'), 'utf8')).items;
    const maxThreshold = Math.max(...milestones.map((m) => m.threshold));
    const maxGap = Math.max(...milestones.map((m, i) => m.threshold - (i === 0 ? 0 : milestones[i - 1].threshold)));
    const maxMultiplier = Math.max(...milestones.map((m) => m.productionMultiplier));
    const states = ['locked', 'ready', 'active', 'cooldown', 'suspended'];
    const action = (labelKey) => c.resolveText('producer_panel.action.unavailable', { label: c.resolveText(labelKey), cost: WIDE_NUMBER });
    return {
        IndustrialOutputValue: [c.resolveText('hud.industrial_output', { value: WIDE_NUMBER })],
        ProductionPerSecondValue: [c.resolveText('hud.production_per_second', { value: WIDE_NUMBER })],
        NextGoalValue: [
            ...goalNames.flatMap((name) => ['next_goal.producer_build', 'next_goal.breakthrough', 'next_goal.era'].map((k) => c.resolveText(k, { name }))),
            ...producers.map((name) => c.resolveText('next_goal.producer_milestone', { name, level: maxThreshold })),
            ...['next_goal.reboot_ai_core', 'next_goal.none', 'next_goal.producer_build.generic', 'next_goal.breakthrough.generic', 'next_goal.era.generic'].map((k) => c.resolveText(k)),
        ],
        NextGoalContext: [
            c.resolveText('next_goal.progress', { current: WIDE_NUMBER, required: WIDE_NUMBER }),
            c.resolveText('next_goal.cost', { cost: WIDE_NUMBER, state: c.resolveText('next_goal.affordability.unaffordable') }),
        ],
        FreeOverclockValue: states.map((s) => c.resolveText(`hud.free_overclock.${s}`, { multiplier: 2 })),
        FreeOverclockTimer: [c.resolveText('hud.free_overclock.timer', { seconds: 86400 })],
        ProducerName: [...producers, c.resolveText('producer_panel.none_selected')],
        ProducerLevel: [c.resolveText('producer_panel.level', { level: 1000 })],
        ProducerProduction: [c.resolveText('producer_panel.production_per_second', { value: WIDE_NUMBER })],
        ProducerMilestone: [
            c.resolveText('producer_panel.milestone.next_with_benefit', { threshold: maxThreshold, remaining: maxGap, benefit: c.resolveText('producer_panel.milestone.production_multiplier', { multiplier: maxMultiplier }) }),
            c.resolveText('producer_panel.milestone.complete'),
        ],
        Action_x1: [action('producer_panel.buy_1')],
        Action_x10: [action('producer_panel.buy_10')],
        Action_xMax: [action('producer_panel.buy_max')],
    };
}

test('UiLayout rows fit the longest representative catalogue strings at their nominal font size', async () => {
    const L = await layoutModule();
    const strings = await representativeStrings();
    for (const card of [L.CORE_HUD_LAYOUT, L.PRODUCER_PANEL_LAYOUT]) {
        for (const row of card.rows) {
            const samples = strings[row.key];
            assert.ok(samples && samples.length > 0, `${card.name}.${row.key} has representative strings`);
            for (const text of samples) {
                assert.doesNotMatch(text, /\{|\b[a-z_]+\.[a-z0-9_.]+\b/, `${row.key}: unresolved text ${text}`);
                const estimate = [...text].length * CHAR_WIDTH_PER_FONT_UNIT * row.fontSize;
                assert.ok(estimate <= L.cardRowWidth(card), `${card.name}.${row.key} "${text}" ≈ ${estimate.toFixed(0)} > ${L.cardRowWidth(card)}`);
            }
        }
    }
});

// AUT-R-036-02: the panel captions word-wrap (greedy, like the Cocos label) onto at most `captionLines`
// lines, each within the Button width at the nominal font size.
test('UiLayout AUT-R-036-02: ×1/×10/×MAX captions fit their Button in two lines at the nominal font size', async () => {
    const L = await layoutModule();
    const strings = await representativeStrings();
    const row = L.PRODUCER_PANEL_LAYOUT.actionRow;
    const width = (text) => [...text].length * CHAR_WIDTH_PER_FONT_UNIT * row.fontSize;
    for (const action of row.actions) {
        const samples = strings[action.key];
        assert.ok(samples && samples.length > 0, `${action.key} has representative strings`);
        for (const text of samples) {
            assert.doesNotMatch(text, /\{|\b[a-z_]+\.[a-z0-9_.]+\b/, `${action.key}: unresolved text ${text}`);
            const lines = [];
            for (const word of text.split(' ')) {
                const candidate = lines.length ? `${lines[lines.length - 1]} ${word}` : word;
                if (lines.length && width(candidate) <= action.width) lines[lines.length - 1] = candidate;
                else lines.push(word);
            }
            assert.ok(lines.length <= row.captionLines, `${action.key} "${text}" needs ${lines.length} lines`);
            for (const line of lines) assert.ok(width(line) <= action.width, `${action.key} line "${line}" ≈ ${width(line).toFixed(0)} > ${action.width}`);
        }
    }
});

// AUT-UI-001: the HUD-owned actions. AUT-R-036-02: Next Goal stays in the HUD action row; Manual Produce is
// the panel band's full-width primary action at the bottom (GAME_DESIGN §20 thumb zone).
test('UiLayout AUT-UI-001 / AUT-R-036-02: Next Goal in the HUD, Manual Produce full width at the bottom of the panel band', async () => {
    const L = await layoutModule();
    const row = L.CORE_HUD_LAYOUT.actionRow;
    assert.ok(row, 'CORE_HUD_LAYOUT has an action row');
    assert.deepEqual(row.actions.map((action) => action.key), ['NextGoalAction']);
    assert.equal(L.hudActionCard('NextGoalAction'), L.CORE_HUD_LAYOUT);
    assert.equal(L.hudActionCard('ManualProduceAction'), L.PRODUCER_PANEL_LAYOUT);
    const primary = L.PRODUCER_PANEL_LAYOUT.primaryAction;
    assert.equal(primary.key, 'ManualProduceAction');
    assert.ok(primary.fontSize >= L.UI_MIN_BODY_FONT_SIZE && primary.height >= primary.fontSize && primary.gap >= 0);
    assert.ok(primary.height >= L.PRODUCER_PANEL_LAYOUT.actionRow.height, 'Manual Produce at least as tall as ×1/×10/×MAX');
    assert.equal(L.cardActionFontSize(L.PRODUCER_PANEL_LAYOUT, 'ManualProduceAction'), primary.fontSize);
    assert.equal(L.cardActionFontSize(L.CORE_HUD_LAYOUT, 'NextGoalAction'), row.fontSize);
    assert.throws(() => L.cardActionFontSize(L.CORE_HUD_LAYOUT, 'ManualProduceAction'), RangeError);
    const panelCard = L.PRODUCER_PANEL_LAYOUT;
    const manualLocal = L.cardActionRect(panelCard, 'ManualProduceAction');
    assert.equal(manualLocal.w, L.cardRowWidth(panelCard), 'full row width');
    assert.ok(Math.abs(manualLocal.y - manualLocal.h / 2 - (-L.cardHeight(panelCard) / 2 + panelCard.padding)) < 1e-9, 'bottom of the panel card');
    for (const key of L.PANEL_ACTION_KEYS) {
        const local = L.cardActionRect(panelCard, key);
        assert.ok(local.y - local.h / 2 >= manualLocal.y + manualLocal.h / 2 + primary.gap - 1e-9, `${key} above Manual Produce`);
    }
    for (const screen of SCREENS) {
        const layout = L.computeUiLayout({ w: screen.w, h: screen.h }, screen.safe ?? undefined);
        const manual = layout.hudButtons.ManualProduceAction;
        assert.ok(L.rectContains(layout.panel, manual, 1), `${screen.name} Manual Produce inside the panel band`);
        assert.ok(L.rectContains(layout.safeArea, manual, 1), `${screen.name} Manual Produce inside the safe area`);
        assert.ok(manual.y + manual.h <= layout.factoryBand.y, `${screen.name} Manual Produce below the factory band`);
        const shrinkRect = (r) => ({ x: r.x + 1e-6, y: r.y + 1e-6, w: r.w - 2e-6, h: r.h - 2e-6 });
        for (const rect of [...Object.values(layout.buttons), ...Object.values(layout.rows.panel)]) assert.equal(L.rectsOverlap(shrinkRect(manual), rect), false, `${screen.name} Manual Produce overlaps a panel row or Button`);
    }
    {
        const rowHud = L.CORE_HUD_LAYOUT.actionRow;
        assert.equal(rowHud.actions.reduce((s, a) => s + a.width, 0), L.cardRowWidth(L.CORE_HUD_LAYOUT));
    }
});

test('UiLayout AUT-UI-001: the Next Goal Button has its own rect inside the HUD and fits every screen', async () => {
    const L = await layoutModule();
    const row = L.CORE_HUD_LAYOUT.actionRow;
    assert.equal(row.actions.reduce((sum, action) => sum + action.width, 0) + row.gap * (row.actions.length - 1), L.cardRowWidth(L.CORE_HUD_LAYOUT), 'buttons + gaps fill the row width');
    assert.ok(row.gap > 0);
    assert.ok(row.fontSize >= L.UI_MIN_BODY_FONT_SIZE && row.height >= row.fontSize);
    // Touch comfort: at least as tall as the panel's Buttons.
    const panelButtonHeight = L.PRODUCER_PANEL_LAYOUT.actionRow.height;
    assert.ok(row.height >= panelButtonHeight, `action row ${row.height} < panel buttons ${panelButtonHeight}`);
    // The action row sits below the last label row, inside the card's padding.
    const card = L.CORE_HUD_LAYOUT;
    const lastIndex = card.rows.length - 1;
    const lastRowBottom = L.cardRowCenterY(card, lastIndex) - card.rows[lastIndex].height / 2;
    for (const key of ['NextGoalAction']) {
        const local = L.cardActionRect(card, key);
        assert.ok(local.y + local.h / 2 <= lastRowBottom + 1e-9, `${key} below the label rows`);
        assert.ok(local.y - local.h / 2 >= -L.cardHeight(card) / 2 + card.padding - 1e-9, `${key} inside the bottom padding`);
        assert.ok(Math.abs(local.x) + local.w / 2 <= card.width / 2 - card.padding + 1e-9, `${key} inside the side padding`);
    }
    assert.throws(() => L.cardActionRect(card, 'Missing'), RangeError);
    assert.throws(() => L.cardActionRect(card, 'ManualProduceAction'), RangeError);
    for (const screen of SCREENS) {
        const layout = L.computeUiLayout({ w: screen.w, h: screen.h }, screen.safe ?? undefined);
        const [manual, nextGoal] = L.HUD_ACTION_KEYS.map((key) => layout.hudButtons[key]);
        // Shared edges are not overlaps (float rounding at non-integer scales).
        const shrink = (r) => ({ x: r.x + 1e-6, y: r.y + 1e-6, w: r.w - 2e-6, h: r.h - 2e-6 });
        for (const [key, rect] of Object.entries(layout.hudButtons).filter(([key]) => key === 'NextGoalAction')) {
            assert.ok(L.rectContains(layout.hud, rect, 1), `${screen.name} ${key} inside the HUD`);
            assert.ok(L.rectContains(layout.safeArea, rect, 1), `${screen.name} ${key} inside the safe area`);
            assert.equal(L.rectsOverlap(rect, layout.panel), false, `${screen.name} ${key} overlaps the panel`);
            for (const row of Object.values(layout.rows.hud)) assert.equal(L.rectsOverlap(shrink(rect), row), false, `${screen.name} ${key} overlaps a HUD label row`);
        }
        assert.equal(L.rectsOverlap(manual, nextGoal), false, `${screen.name} HUD action Buttons overlap`);
        assert.ok(Math.abs(nextGoal.h - row.height * layout.scale) < 1e-9);
    }
});

test('UiLayout AUT-UI-001: HUD action captions fit their Button at the nominal font size', async () => {
    const L = await layoutModule();
    const { getDefaultTextCatalogue } = await imp('assets/scripts/localization/index.ts');
    const c = getDefaultTextCatalogue();
    const label = c.resolveText('hud.action.next_goal_unlock');
    const samples = {
        ManualProduceAction: [c.resolveText('hud.action.manual_produce')],
        NextGoalAction: [
            c.resolveText('producer_panel.action', { label, cost: WIDE_NUMBER }),
            c.resolveText('producer_panel.action.unavailable', { label, cost: WIDE_NUMBER }),
        ],
    };
    // AUT-R-036-02: each caption at its own card's font and Button width (Manual Produce in the panel band).
    for (const key of L.HUD_ACTION_KEYS) {
        const card = L.hudActionCard(key);
        const { w } = L.cardActionRect(card, key);
        const fontSize = L.cardActionFontSize(card, key);
        for (const text of samples[key]) {
            assert.doesNotMatch(text, /\{|\b[a-z_]+\.[a-z0-9_.]+\b/, `${key}: unresolved text ${text}`);
            const estimate = [...text].length * CHAR_WIDTH_PER_FONT_UNIT * fontSize;
            assert.ok(estimate <= w, `${key} "${text}" ≈ ${estimate.toFixed(0)} > ${w}`);
        }
    }
});
