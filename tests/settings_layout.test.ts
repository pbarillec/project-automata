const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

async function modules() {
    const [layout, ui, aiLayout, toast, offline] = await Promise.all([
        imp('assets/scripts/presentation/SettingsLayout.ts'),
        imp('assets/scripts/presentation/UiLayout.ts'),
        imp('assets/scripts/presentation/PermanentUpgradeLayout.ts'),
        imp('assets/scripts/presentation/MilestoneToastLayout.ts'),
        imp('assets/scripts/presentation/OfflineReportLayout.ts'),
    ]);
    return { layout, ui, aiLayout, toast, offline };
}

const SCREENS = [
    { name: '720x1280', w: 720, h: 1280, safe: null },
    { name: '1080x1920', w: 1080, h: 1920, safe: null },
    { name: '1080x2412', w: 1080, h: 2412, safe: null },
    { name: '1272x2772', w: 1272, h: 2772, safe: null },
    { name: '1080x2412 top inset 130', w: 1080, h: 2412, safe: { x: 0, y: 0, w: 1080, h: 2412 - 130 } },
    { name: '1080x2412 symmetric inset 130', w: 1080, h: 2412, safe: { x: 0, y: 130, w: 1080, h: 2412 - 260 } },
];

for (const screen of SCREENS) {
    test(`layout ${screen.name}: chip clear of the AI chip / HUD / Overclock rows / toast band; panel centred and clear of the HUD; targets >= 64`, async () => {
        const m = await modules();
        const safe = screen.safe ?? { x: 0, y: 0, w: screen.w, h: screen.h };
        const base = m.ui.computeUiLayout({ w: screen.w, h: screen.h }, screen.safe ?? undefined);
        const r = m.layout.computeSettingsRects({ w: screen.w, h: screen.h }, screen.safe ?? undefined);
        const ai = m.aiLayout.computePermanentUpgradeRects({ w: screen.w, h: screen.h }, screen.safe ?? undefined);
        const where = screen.name;
        const protectedRects = [base.hud, base.panel, ...Object.values(base.hudButtons), ...Object.values(base.buttons), ...Object.values(base.rows.hud), ...Object.values(base.rows.panel)];
        // Chip.
        assert.ok(m.ui.rectContains(safe, r.chip, 1e-6), `${where}: chip inside the safe area`);
        assert.ok(m.ui.rectContains(r.factoryBand, r.chip, 1e-6), `${where}: chip inside the factory band (no added HUD height)`);
        assert.ok(r.chip.w / r.scale >= 64 - 1e-9 && r.chip.h / r.scale >= 64 - 1e-9, `${where}: chip >= 64 x 64 design units`);
        assert.ok(Math.abs(r.chip.x - (safe.x + 16 * r.scale)) < 1e-6, `${where}: chip left-aligned at the edge margin`);
        assert.ok(Math.abs(r.chip.y + r.chip.h - (base.hud.y - m.layout.SETTINGS_CHIP_GAP_BELOW_HUD * r.scale)) < 1e-6, `${where}: chip directly under the HUD band`);
        assert.ok(Math.abs(r.chip.y - ai.chip.y) < 1e-6 && Math.abs(r.chip.h - ai.chip.h) < 1e-6, `${where}: same top line as the AI chip`);
        for (const rect of protectedRects) assert.equal(m.ui.rectsOverlap(r.chip, rect), false, `${where}: chip overlaps a HUD / panel rect (Overclock rows, Next Goal button included)`);
        assert.equal(m.ui.rectsOverlap(r.chip, ai.chip), false, `${where}: chip overlaps the AI chip`);
        assert.ok(r.chip.x + r.chip.w < ai.chip.x, `${where}: chip entirely left of the AI chip`);
        const minorToast = m.toast.computeMilestoneToastRect({ w: screen.w, h: screen.h }, screen.safe ?? undefined, 'minor');
        assert.equal(m.ui.rectsOverlap(r.chip, minorToast), false, `${where}: chip overlaps the Minor milestone toast (the toast never moves; the chip stays narrow)`);
        assert.ok(r.chip.x + r.chip.w <= minorToast.x + 1e-6, `${where}: chip left of the toast band`);
        // Panel.
        assert.ok(m.ui.rectContains(safe, r.panel, 1e-6), `${where}: panel inside the safe area`);
        assert.ok(m.ui.rectContains(r.factoryBand, r.panel, 1e-6), `${where}: panel inside the factory band`);
        for (const rect of protectedRects) assert.equal(m.ui.rectsOverlap(r.panel, rect), false, `${where}: panel overlaps a HUD / panel rect`);
        assert.ok(Math.abs(r.panel.y + r.panel.h / 2 - (r.factoryBand.y + r.factoryBand.h / 2)) < 1e-6, `${where}: centred in the factory band`);
        assert.ok(Math.abs(r.panel.w / r.scale - 640) < 1e-6, `${where}: 640 wide`);
        assert.ok(Math.abs(r.panel.x + r.panel.w / 2 - (safe.x + safe.w / 2)) < 1e-6, `${where}: centred horizontally`);
        // Controls: inside the panel, >= 64 tall, no overlaps, hit rect = whole row.
        const controls = [r.close, ...r.rows];
        for (const rect of controls) assert.ok(m.ui.rectContains(r.panel, rect, 1e-6), `${where}: control inside the panel`);
        for (const rect of controls) assert.ok(rect.h / r.scale >= m.layout.SETTINGS_MIN_BUTTON_HEIGHT - 1e-9, `${where}: control >= 64 design units tall`);
        controls.forEach((a, i) => controls.slice(i + 1).forEach((b) => assert.equal(m.ui.rectsOverlap(a, b), false, `${where}: controls overlap`)));
        r.pills.forEach((pill, i) => assert.ok(m.ui.rectContains(r.rows[i], pill, 1e-6), `${where}: pill ${i} inside its row`));
        assert.equal(r.rows.length, 4);
        assert.deepEqual(r.backdrop, { x: 0, y: 0, w: screen.w, h: screen.h });
        assert.ok(r.close.h / r.scale >= 64 - 1e-9, `${where}: CLOSE 64 tall`);
    });
}

test('layout: fonts, panel size and palette invariants', async () => {
    const { layout: L, offline } = await modules();
    const layout = L.resolveSettingsPanelLayout();
    assert.equal(layout.width, 640);
    assert.ok(layout.height <= 585, 'at most 75% of the 780-unit band at 1280');
    for (const size of [L.SETTINGS_ROW_FONT_SIZE, L.SETTINGS_PILL_FONT_SIZE, L.SETTINGS_HEADER_FONT_SIZE, L.SETTINGS_CHIP_FONT_SIZE]) assert.ok(size >= L.SETTINGS_MIN_BODY_FONT_SIZE, `font ${size} >= 20`);
    assert.ok(L.SETTINGS_ROW_FONT_SIZE >= 21, 'body font >= 21 (margin over the 20 floor)');
    assert.ok(L.SETTINGS_CLOSE_FONT_SIZE >= L.SETTINGS_MIN_CLOSE_FONT_SIZE);
    assert.equal(L.SETTINGS_CLOSE_HEIGHT, 64);
    assert.ok(L.SETTINGS_ROW_HEIGHT >= 64);
    assert.equal(L.SETTINGS_BACKDROP_ALPHA, 150);
    assert.equal(L.SETTINGS_COLORS.backdrop.a, 150);
    assert.equal(L.settingsPanelCenterOffsetY(), offline.offlineReportCardCenterOffsetY());
    // Labels never overlap their pill; the pill is not colour-only (ON / OFF text comes from the view model).
    for (const row of layout.rows) {
        assert.ok(row.label.x + row.label.w / 2 <= row.pill.x - row.pill.w / 2 + 1e-9, 'label clear of the pill');
        assert.ok(row.pill.h >= 40);
        assert.equal(row.slot.h, L.SETTINGS_ROW_HEIGHT);
    }
    for (const colour of Object.values(L.SETTINGS_COLORS)) assert.ok(!(colour.r > 180 && colour.g < 90 && colour.b < 90), 'no red');
    const gear = L.gearPoints(0, 0, 15, 11, 8);
    assert.equal(gear.length, 32);
    assert.ok(gear.every((p) => Math.hypot(p.x, p.y) <= 15 + 1e-9));
});

test('the chip top offset is the same formula as the AI chip and the toast band', async () => {
    const { layout: L, aiLayout, toast } = await modules();
    assert.equal(L.settingsChipWidgetOffsets().top, aiLayout.permanentUpgradeChipWidgetOffsets().top);
    assert.equal(L.settingsChipWidgetOffsets().top, toast.milestoneToastTopOffset());
    assert.equal(L.settingsChipWidgetOffsets().left, aiLayout.permanentUpgradeChipWidgetOffsets().right, 'mirrored edge margin');
});
