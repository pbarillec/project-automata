const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const layoutModule = () => imp('assets/scripts/presentation/UiLayout.ts');

// AUT-R-036 reference screens (pixels): 16:9 HD/FHD, NE2215 FHD+, a 2772×1272 phone, and a
// 2412×1080 screen with a 100 px left inset (punch-hole / cutout side in landscape).
const SCREENS = [
    { name: '1280x720', w: 1280, h: 720, safe: null, ratio169: true },
    { name: '1920x1080', w: 1920, h: 1080, safe: null, ratio169: true },
    { name: '2412x1080', w: 2412, h: 1080, safe: null, ratio169: false },
    { name: '2772x1272', w: 2772, h: 1272, safe: null, ratio169: false },
    { name: '2412x1080 left inset 100', w: 2412, h: 1080, safe: { x: 100, y: 0, w: 2312, h: 1080 }, ratio169: false },
];

for (const screen of SCREENS) {
    test(`UiLayout ${screen.name}: cards and buttons fit the safe area, never overlap, and stay within the coverage budget`, async () => {
        const L = await layoutModule();
        const layout = L.computeUiLayout({ w: screen.w, h: screen.h }, screen.safe ?? undefined);
        const safe = layout.safeArea;
        for (const [name, rect] of [['hud', layout.hud], ['panel', layout.panel], ...Object.entries(layout.buttons)]) {
            assert.ok(L.rectContains(layout.screen, rect, 1), `${name} inside the screen`);
            assert.ok(L.rectContains(safe, rect, 1), `${name} inside the safe area`);
        }
        assert.equal(L.rectsOverlap(layout.hud, layout.panel), false, 'HUD and panel overlap');
        for (const [key, rect] of Object.entries(layout.buttons)) assert.ok(L.rectContains(layout.panel, rect, 1), `${key} inside the panel`);
        const coverage = (L.rectArea(layout.hud) + L.rectArea(layout.panel)) / L.rectArea(layout.screen);
        assert.ok(coverage <= L.UI_MAX_COVERAGE, `coverage ${coverage} > 35%`);
        if (screen.ratio169) assert.ok(coverage <= L.UI_MAX_COVERAGE_16_9, `16:9 coverage ${coverage} > 30%`);
        // Fit height: one design unit is screen.h / 720 pixels.
        assert.equal(layout.scale, screen.h / 720);
        if (screen.safe) assert.ok(layout.hud.x >= 100 && layout.panel.x >= 100, 'cards respect the left inset');
    });
}

test('UiLayout: 16:9 is the worst case and HUD + panel cover at most 30% there', async () => {
    const L = await layoutModule();
    const at169 = L.computeUiLayout({ w: 1280, h: 720 });
    const wide = L.computeUiLayout({ w: 2412, h: 1080 });
    const cover = (layout) => (L.rectArea(layout.hud) + L.rectArea(layout.panel)) / L.rectArea(layout.screen);
    assert.ok(cover(at169) >= cover(wide));
    assert.ok(cover(at169) <= 0.30, String(cover(at169)));
});

test('UiLayout: design resolution, margins, default corners and body font sizes', async () => {
    const L = await layoutModule();
    assert.deepEqual(L.UI_DESIGN_RESOLUTION, { width: 1280, height: 720 });
    assert.ok(L.UI_EDGE_MARGIN > 0);
    assert.equal(L.UI_MIN_BODY_FONT_SIZE, 20);
    for (const card of [L.CORE_HUD_LAYOUT, L.PRODUCER_PANEL_LAYOUT]) {
        for (const row of card.rows) {
            assert.ok(row.fontSize >= L.UI_MIN_BODY_FONT_SIZE, `${card.name}.${row.key} font ${row.fontSize}`);
            assert.ok(row.height >= row.fontSize, `${card.name}.${row.key} row shorter than its font`);
        }
    }
    assert.notEqual(L.CORE_HUD_LAYOUT.corner, L.PRODUCER_PANEL_LAYOUT.corner);
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

test('UiLayout widget alignment maps each corner to exactly one horizontal and one vertical edge', async () => {
    const L = await layoutModule();
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
        const a = L.widgetAlignment(corner);
        assert.equal(Number(a.top) + Number(a.bottom), 1, corner);
        assert.equal(Number(a.left) + Number(a.right), 1, corner);
    }
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

// AUT-UI-001: the HUD action row (Manual Produce, Next Goal unlock).
test('UiLayout AUT-UI-001: HUD action Buttons have their own rects inside the HUD, never overlap, and fit every screen', async () => {
    const L = await layoutModule();
    const row = L.CORE_HUD_LAYOUT.actionRow;
    assert.ok(row, 'CORE_HUD_LAYOUT has an action row');
    assert.deepEqual(row.actions.map((action) => action.key), [...L.HUD_ACTION_KEYS]);
    assert.equal(row.actions.reduce((sum, action) => sum + action.width, 0) + row.gap * (row.actions.length - 1), L.cardRowWidth(L.CORE_HUD_LAYOUT), 'buttons + gaps fill the row width');
    assert.ok(row.gap > 0);
    assert.ok(row.fontSize >= L.UI_MIN_BODY_FONT_SIZE && row.height >= row.fontSize);
    // Touch comfort: at least as tall as the panel's Buttons.
    const panelButtonHeight = Math.max(...L.PRODUCER_PANEL_LAYOUT.rows.filter((r) => r.key.startsWith('Action_')).map((r) => r.height));
    assert.ok(row.height >= panelButtonHeight, `action row ${row.height} < panel buttons ${panelButtonHeight}`);
    // The action row sits below the last label row, inside the card's padding.
    const card = L.CORE_HUD_LAYOUT;
    const lastIndex = card.rows.length - 1;
    const lastRowBottom = L.cardRowCenterY(card, lastIndex) - card.rows[lastIndex].height / 2;
    for (const key of L.HUD_ACTION_KEYS) {
        const local = L.cardActionRect(card, key);
        assert.ok(local.y + local.h / 2 <= lastRowBottom + 1e-9, `${key} below the label rows`);
        assert.ok(local.y - local.h / 2 >= -L.cardHeight(card) / 2 + card.padding - 1e-9, `${key} inside the bottom padding`);
        assert.ok(Math.abs(local.x) + local.w / 2 <= card.width / 2 - card.padding + 1e-9, `${key} inside the side padding`);
    }
    assert.throws(() => L.cardActionRect(card, 'Missing'), RangeError);
    assert.throws(() => L.cardActionRect(L.PRODUCER_PANEL_LAYOUT, 'ManualProduceAction'), RangeError);
    for (const screen of SCREENS) {
        const layout = L.computeUiLayout({ w: screen.w, h: screen.h }, screen.safe ?? undefined);
        const [manual, nextGoal] = L.HUD_ACTION_KEYS.map((key) => layout.hudButtons[key]);
        // Shared edges are not overlaps (float rounding at non-integer scales).
        const shrink = (r) => ({ x: r.x + 1e-6, y: r.y + 1e-6, w: r.w - 2e-6, h: r.h - 2e-6 });
        for (const [key, rect] of Object.entries(layout.hudButtons)) {
            assert.ok(L.rectContains(layout.hud, rect, 1), `${screen.name} ${key} inside the HUD`);
            assert.ok(L.rectContains(layout.safeArea, rect, 1), `${screen.name} ${key} inside the safe area`);
            assert.equal(L.rectsOverlap(rect, layout.panel), false, `${screen.name} ${key} overlaps the panel`);
            for (const row of Object.values(layout.rows.hud)) assert.equal(L.rectsOverlap(shrink(rect), row), false, `${screen.name} ${key} overlaps a HUD label row`);
        }
        assert.equal(L.rectsOverlap(manual, nextGoal), false, `${screen.name} HUD action Buttons overlap`);
        assert.ok(Math.abs(manual.h - row.height * layout.scale) < 1e-9);
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
    const row = L.CORE_HUD_LAYOUT.actionRow;
    for (const action of row.actions) {
        for (const text of samples[action.key]) {
            assert.doesNotMatch(text, /\{|\b[a-z_]+\.[a-z0-9_.]+\b/, `${action.key}: unresolved text ${text}`);
            const estimate = [...text].length * CHAR_WIDTH_PER_FONT_UNIT * row.fontSize;
            assert.ok(estimate <= action.width, `${action.key} "${text}" ≈ ${estimate.toFixed(0)} > ${action.width}`);
        }
    }
});
