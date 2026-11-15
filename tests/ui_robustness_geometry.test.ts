const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * AUT-070 screen-size / safe-area geometry matrix over every pure Layout module (no `cc`): HUD, Producer Panel, the five chips, the
 * milestone toast bands and every modal (offline card with every row combination, AI upgrades, Settings with and without the privacy row,
 * Reboot, Founder's Pack). Text content never changes these rects (labels shrink / truncate inside them: see ui_robustness_text.test.ts), so
 * this matrix is what pins "no overlap, inside the screen / safe area, buttons tall enough, modals fit".
 */
const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

/** Common phone sizes (pixels, portrait) with notch / camera cut-out insets on top and a gesture-bar inset at the bottom. */
const SCREENS = [
    { name: '1080x2412 reference', w: 1080, h: 2412, top: 0, bottom: 0 },
    { name: '1080x2412 notch 130 + gesture 63', w: 1080, h: 2412, top: 130, bottom: 63 },
    { name: '1080x1920', w: 1080, h: 1920, top: 0, bottom: 0 },
    { name: '1080x1920 notch 100 + gesture 48', w: 1080, h: 1920, top: 100, bottom: 48 },
    { name: '720x1280 small', w: 720, h: 1280, top: 0, bottom: 0 },
    { name: '720x1280 small notch 66 + gesture 32', w: 720, h: 1280, top: 66, bottom: 32 },
    { name: '1080x2640 tall', w: 1080, h: 2640, top: 0, bottom: 0 },
    { name: '1080x2640 tall notch 150 + gesture 63', w: 1080, h: 2640, top: 150, bottom: 63 },
    { name: '1272x2772 large', w: 1272, h: 2772, top: 120, bottom: 72 },
];

const safeAreaOf = (screen) => ({ x: 0, y: screen.bottom, w: screen.w, h: screen.h - screen.top - screen.bottom });

/** Design-unit height of a rect for a screen (the fixed-width canvas scales by w / 720). */
const unitsTall = (rect, screen) => rect.h / (screen.w / 720);

async function modules() {
    const [ui, settings, offline, upgrades, reboot, founder, extended, toast] = await Promise.all([
        imp('assets/scripts/presentation/UiLayout.ts'),
        imp('assets/scripts/presentation/SettingsLayout.ts'),
        imp('assets/scripts/presentation/OfflineReportLayout.ts'),
        imp('assets/scripts/presentation/PermanentUpgradeLayout.ts'),
        imp('assets/scripts/presentation/RebootLayout.ts'),
        imp('assets/scripts/presentation/FounderShopLayout.ts'),
        imp('assets/scripts/presentation/ExtendedOverclockLayout.ts'),
        imp('assets/scripts/presentation/MilestoneToastLayout.ts'),
    ]);
    return { ui, settings, offline, upgrades, reboot, founder, extended, toast };
}

const OFFLINE_FLAG_SETS = [];
for (const capReached of [false, true]) for (const robots of [false, true]) for (const note of [false, true]) for (const x2 of [false, true]) OFFLINE_FLAG_SETS.push({ capReached, robots, note, x2 });

function chipRects(m, screen, safe) {
    return {
        settings: m.settings.computeSettingsRects({ w: screen.w, h: screen.h }, safe).chip,
        aiUpgrades: m.upgrades.computePermanentUpgradeRects({ w: screen.w, h: screen.h }, safe).chip,
        reboot: m.reboot.computeRebootRects({ w: screen.w, h: screen.h }, safe).chip,
        founder: m.founder.computeFounderShopRects({ w: screen.w, h: screen.h }, safe).chip,
        extendedOverclock: m.extended.computeExtendedOverclockChipRect({ w: screen.w, h: screen.h }, safe),
    };
}

for (const screen of SCREENS) {
    const safe = safeAreaOf(screen);
    const size = { w: screen.w, h: screen.h };

    test(`geometry ${screen.name}: HUD and Producer Panel stay inside the safe area, never overlap, and leave a factory band`, async () => {
        const m = await modules();
        const layout = m.ui.computeUiLayout(size, safe);
        assert.ok(m.ui.rectContains(safe, layout.hud, 1), 'HUD inside the safe area');
        assert.ok(m.ui.rectContains(safe, layout.panel, 1), 'panel inside the safe area');
        assert.equal(m.ui.rectsOverlap(layout.hud, layout.panel), false, 'HUD / panel overlap');
        assert.ok(layout.factoryBand.h > 0, `factory band ${layout.factoryBand.h}px`);
        assert.ok(layout.factoryBand.h / (m.ui.rectArea(layout.screen) / layout.screen.w) >= 0.3, 'the factory keeps at least 30% of the screen height');
        for (const [key, rect] of [...Object.entries(layout.buttons), ...Object.entries(layout.hudButtons)]) {
            assert.ok(m.ui.rectContains(safe, rect, 1), `${key} hit rect inside the safe area`);
            // HUD / panel band Buttons keep their device-proven 52 design units (78 px at 1080 wide); modals and chips use >= 64 (below).
            assert.ok(unitsTall(rect, screen) >= 48 - 1e-6, `${key} is ${unitsTall(rect, screen).toFixed(1)} units tall`);
        }
    });

    test(`geometry ${screen.name}: the five chips sit below the HUD, above the panel, inside the safe area, >= 64 units tall and never overlap each other`, async () => {
        const m = await modules();
        const layout = m.ui.computeUiLayout(size, safe);
        const chips = chipRects(m, screen, safe);
        for (const [name, rect] of Object.entries(chips)) {
            assert.ok(m.ui.rectContains(safe, rect, 1), `${name} inside the safe area`);
            assert.ok(unitsTall(rect, screen) >= 64 - 1e-6, `${name} chip height`);
            assert.ok(rect.y + rect.h <= layout.hud.y + 1e-6, `${name} below the HUD`);
            assert.ok(rect.y >= layout.panel.y + layout.panel.h - 1e-6, `${name} above the panel`);
        }
        const names = Object.keys(chips);
        for (let i = 0; i < names.length; i += 1) {
            for (let j = i + 1; j < names.length; j += 1) assert.equal(m.ui.rectsOverlap(chips[names[i]], chips[names[j]]), false, `${names[i]} overlaps ${names[j]}`);
        }
    });

    test(`geometry ${screen.name}: milestone toast bands stay in the factory band; Major / Exceptional clear every chip, Minor clears the left chips`, async () => {
        const m = await modules();
        const layout = m.ui.computeUiLayout(size, safe);
        const chips = chipRects(m, screen, safe);
        for (const tier of ['minor', 'major', 'exceptional']) {
            const rect = m.toast.computeMilestoneToastRect(size, safe, tier);
            assert.ok(m.ui.rectContains(safe, rect, 1), `${tier} toast inside the safe area`);
            assert.equal(m.toast.milestoneToastFitsFactoryBand(size, safe, tier), true, `${tier} toast inside the factory band`);
            assert.equal(m.ui.rectsOverlap(rect, layout.hud), false, `${tier} toast over the HUD`);
            assert.equal(m.ui.rectsOverlap(rect, layout.panel), false, `${tier} toast over the panel`);
            for (const [name, chip] of Object.entries(chips)) {
                // The Minor band (384 wide since AUT-070) shares the first chip line with the Settings (left) and AI (right) chips and must clear both.
                if (tier === 'minor' && name !== 'settings' && name !== 'aiUpgrades') continue;
                assert.equal(m.ui.rectsOverlap(rect, chip), false, `${tier} toast overlaps the ${name} chip`);
            }
        }
    });

    test(`geometry ${screen.name}: every modal fits the safe area, its buttons are >= 64 units tall inside the card, and nothing inside overlaps`, async () => {
        const m = await modules();
        const inside = (outer, inner, label) => assert.ok(m.ui.rectContains(outer, inner, 1), `${label} inside its container`);
        const noOverlap = (rects, label) => {
            for (let i = 0; i < rects.length; i += 1) for (let j = i + 1; j < rects.length; j += 1) assert.equal(m.ui.rectsOverlap(shrink(rects[i]), shrink(rects[j])), false, `${label}: ${i} overlaps ${j}`);
        };
        const tall = (rect, label) => assert.ok(unitsTall(rect, screen) >= 64 - 1e-6, `${label} is ${unitsTall(rect, screen).toFixed(1)} units tall`);
        const heightCap = (rect, label) => assert.ok(rect.h <= safe.h * 0.9 + 1e-6, `${label} card height ${rect.h.toFixed(0)}px vs safe ${safe.h}px (cap 90%)`);

        for (const flags of OFFLINE_FLAG_SETS) {
            const r = m.offline.computeOfflineReportRects(size, safe, flags);
            const tag = `offline ${JSON.stringify(flags)}`;
            inside(safe, r.card, tag);
            heightCap(r.card, tag);
            inside(r.card, r.collect, `${tag} collect`);
            tall(r.collect, `${tag} collect`);
            const rows = Object.values(r.rows);
            for (const row of rows) inside(r.card, row, `${tag} row`);
            const hits = [r.collect, ...(r.double ? [r.double] : [])];
            if (r.double) { inside(r.card, r.double, `${tag} double`); tall(r.double, `${tag} double`); }
            noOverlap([...rows, ...hits], tag);
        }

        const up = m.upgrades.computePermanentUpgradeRects(size, safe);
        inside(safe, up.panel, 'upgrades panel');
        heightCap(up.panel, 'upgrades panel');
        for (const [name, list] of [['close', [up.close]], ['tab', up.tabs], ['buy', up.buys]]) for (const rect of list) { inside(up.panel, rect, `upgrades ${name}`); tall(rect, `upgrades ${name}`); }
        noOverlap([...up.tabs, ...up.rows, up.close], 'upgrades panel');
        up.buys.forEach((buy, index) => inside(up.rows[index], buy, `upgrades buy ${index} in its row`));

        for (const rowCount of [m.settings.SETTINGS_ROW_COUNT, m.settings.SETTINGS_ROW_COUNT_WITH_PRIVACY]) {
            const s = m.settings.computeSettingsRects(size, safe, rowCount);
            inside(safe, s.panel, `settings(${rowCount})`);
            heightCap(s.panel, `settings(${rowCount})`);
            inside(s.panel, s.close, 'settings close');
            tall(s.close, 'settings close');
            s.rows.forEach((row, index) => { inside(s.panel, row, `settings row ${index}`); inside(row, s.pills[index], `settings pill ${index}`); tall(row, `settings row ${index} (toggle hit rect)`); });
            noOverlap([...s.rows, s.close], `settings(${rowCount})`);
        }

        const rb = m.reboot.computeRebootRects(size, safe);
        inside(safe, rb.panel, 'reboot panel');
        heightCap(rb.panel, 'reboot panel');
        for (const [name, rect] of [['confirm', rb.confirm], ['cancel', rb.cancel]]) { inside(rb.panel, rect, `reboot ${name}`); tall(rect, `reboot ${name}`); }
        for (const column of rb.columns) inside(rb.panel, column, 'reboot column');
        noOverlap([rb.confirm, rb.cancel, ...rb.columns], 'reboot panel');

        const fd = m.founder.computeFounderShopRects(size, safe);
        inside(safe, fd.panel, 'founder panel');
        heightCap(fd.panel, 'founder panel');
        for (const [name, rect] of [['buy', fd.buy], ['close', fd.close]]) { inside(fd.panel, rect, `founder ${name}`); tall(rect, `founder ${name}`); }
        noOverlap([fd.buy, fd.close], 'founder panel');
    });
}

/** Rect shrunk by half a pixel so two rects that merely touch are not reported as overlapping. */
function shrink(rect) {
    return { x: rect.x + 0.5, y: rect.y + 0.5, w: Math.max(0, rect.w - 1), h: Math.max(0, rect.h - 1) };
}

test('geometry: the layout units pin the minimum sizes the matrix relies on (64-unit buttons and chips, 20-unit body font)', async () => {
    const m = await modules();
    for (const value of [m.settings.SETTINGS_MIN_BUTTON_HEIGHT, m.offline.OFFLINE_REPORT_MIN_COLLECT_HEIGHT, m.upgrades.PERMANENT_UPGRADE_MIN_BUTTON_HEIGHT, m.reboot.REBOOT_MIN_BUTTON_HEIGHT, m.founder.FOUNDER_MIN_BUTTON_HEIGHT, m.extended.EXTENDED_OVERCLOCK_MIN_BUTTON_HEIGHT]) assert.equal(value, 64);
    assert.equal(m.ui.UI_MIN_BODY_FONT_SIZE, 20);
});
