import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
    AI_CORE_ARC,
    AI_CORE_PARTS,
    AI_CORE_PEAK_SIZE,
    AI_CORE_PERSISTENT_SIZE,
    AI_CORE_SHELL_HALF_HEIGHT,
    DECAL_KINDS,
    DECAL_MAX_PARTS_PER_PRODUCER,
    DECAL_MAX_PARTS_TOTAL,
    DECAL_OUTSIDE_MARGIN,
    DECAL_PLACEMENT,
    PLATE_SCALE,
    DECAL_TAG,
    NUMBER_PLATE,
    DECAL_THICKNESS,
    ICON_NAMES,
    ICON_SHAPES,
    IDENTITY_COLOR_KEYS,
    IDENTITY_PALETTE,
    IDENTITY_PRODUCER_IDS,
    IDENTITY_SOURCE_RECORD,
    PLACEHOLDER_WORDMARK,
    SEVEN_SEG,
    aiCoreScaleFor,
    aiCoreSummary,
    decalPartBoundsXZ,
    decalPartsFor,
    decalRendererGroups,
    founderChipIconSlot,
    groupBoxesByColor,
    hudIndustrialIconSlot,
    hudOverclockIconSlot,
    identityZoneOf,
    isConvexPolygon,
    mergeBoxGeometry,
    milestoneIconFor,
    milestoneIconSlot,
    numberPlateBoxes,
    producerHeaderIconSlot,
    producerIconFor,
    ringArcBoxes,
    type IdentityBox,
} from '../assets/scripts/presentation/AutomataIdentity.ts';
import { aiMarkGeometry } from '../assets/scripts/presentation/PermanentUpgradeLayout.ts';
import { floorHeightAt } from '../assets/scripts/presentation/AssemblySliceLayout.ts';
import { ZONE_LAYOUT } from '../assets/scripts/presentation/FactoryZoneLayout.ts';
import { CORE_HUD_LAYOUT, PRODUCER_PANEL_LAYOUT, cardRowCenterY, cardRowWidth } from '../assets/scripts/presentation/UiLayout.ts';
import { MILESTONE_TOAST_LAYOUT } from '../assets/scripts/presentation/MilestoneToastLayout.ts';
import { FOUNDER_CHIP_HEIGHT, FOUNDER_CHIP_WIDTH } from '../assets/scripts/presentation/FounderShopLayout.ts';
import { REBOOT_CORE_PEAK_SIZE, REBOOT_CORE_PERSISTENT_SIZE, rebootCoreCenterY } from '../assets/scripts/presentation/RebootPresentation.ts';
import { FOUNDER_PALETTE } from '../assets/scripts/presentation/FounderRobotVariant.ts';
import { DEVICE_EVENT_TYPES } from '../assets/scripts/presentation/DeviceDiagnostics.ts';
import { DEFAULT_REVEAL_EVENT_TYPES, REVEAL_SCENARIOS, evaluateRevealTimeline } from '../tools/device/reveal_capture.ts';
import { evaluateIdentity } from '../tools/device/identity_checks.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');
const presentation = (file: string) => read(`assets/scripts/presentation/${file}`);
const code = (file: string) => presentation(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Same definition as the AUT-049 test: red = r dominates BOTH other channels by 1.5x (amber is warm but not red).
const isRed = (c: { r: number; g: number; b: number }) => c.r > c.g * 1.5 && c.r > c.b * 1.5;
const allBoxes = (): IdentityBox[] => [...AI_CORE_PARTS];

test('palette is frozen, never red, and the Founder gold is not a usable identity colour', () => {
    assert.deepEqual(IDENTITY_PALETTE.graphite, { r: 24, g: 29, b: 32 });
    assert.deepEqual(IDENTITY_PALETTE.offWhite, { r: 232, g: 236, b: 236 });
    assert.deepEqual(IDENTITY_PALETTE.cyan, { r: 88, g: 170, b: 184 });
    assert.deepEqual(IDENTITY_PALETTE.amber, { r: 224, g: 168, b: 72 });
    for (const key of IDENTITY_COLOR_KEYS) {
        const c = IDENTITY_PALETTE[key];
        assert.equal(isRed(c), false, `${key} is not red`);
    }
    assert.equal(IDENTITY_COLOR_KEYS.includes('founderGold' as never), false);
    assert.deepEqual(IDENTITY_PALETTE.founderGold, { r: 204, g: 146, b: 40 });
    const goldInFounder = Object.values(FOUNDER_PALETTE).some((c) => c.r === 204 && c.g === 146 && c.b === 40);
    assert.ok(goldInFounder, 'the Founder gold is the existing Founder robot gold');
});

test('every box uses only the allowed colours (no gold, no red) and the decals never use gold', () => {
    const boxes = [...allBoxes(), ...IDENTITY_PRODUCER_IDS.flatMap((id) => decalPartsFor(id, 1))];
    for (const box of boxes) assert.ok(IDENTITY_COLOR_KEYS.includes(box.color), `${box.kind} colour ${box.color}`);
});

test('decals: <= 5 merged parts per producer, <= 30 in total, 4 kinds, dims > 0 and inside the zone footprint, thin and above the surface', () => {
    assert.equal(IDENTITY_PRODUCER_IDS.length, 5);
    let total = 0;
    for (const producerId of IDENTITY_PRODUCER_IDS) {
        const parts = decalPartsFor(producerId, 1);
        const groups = decalRendererGroups(parts);
        total += groups.length;
        assert.ok(groups.length >= 1 && groups.length <= DECAL_MAX_PARTS_PER_PRODUCER, `${producerId}: ${groups.length} renderers`);
        assert.deepEqual([...new Set(parts.map((p) => p.kind))].sort(), [...DECAL_KINDS].sort(), `${producerId} has every decal kind`);
        const zone = ZONE_LAYOUT[identityZoneOf(producerId)!];
        for (const part of parts) {
            assert.ok(part.size.x > 0 && part.size.y > 0 && part.size.z > 0, `${producerId}/${part.kind} dims`);
            assert.equal(part.size.y, DECAL_THICKNESS, 'thin decals');
            assert.equal(part.face, 'top');
            const b = decalPartBoundsXZ(part);
            const inside = b.minX >= -zone.width / 2 - 1e-6 && b.maxX <= zone.width / 2 + 1e-6 && b.minZ >= -zone.depth / 2 - 1e-6 && b.maxZ <= zone.depth / 2 + 1e-6;
            const margin = DECAL_OUTSIDE_MARGIN - 1e-6;
            const clear = b.minX >= zone.width / 2 + margin || b.maxX <= -zone.width / 2 - margin || b.minZ >= zone.depth / 2 + margin || b.maxZ <= -zone.depth / 2 - margin;
            if (part.kind === 'numberPlate' || part.kind === 'zoneTag') assert.ok(clear, `${producerId}/${part.kind} sits >= 0.15 outside the footprint (machines never cover it)`);
            else if (part.kind === 'hazardStripe' && DECAL_PLACEMENT[identityZoneOf(producerId)!].stripeOnGround) assert.ok(!inside, `${producerId} stripe on the ground`);
            else assert.ok(inside, `${producerId}/${part.kind} inside the footprint`);
            // World-space: clear of every other zone, the logistics spine and inside the 20 x 16 site boundary.
            const wx0 = zone.x + b.minX; const wx1 = zone.x + b.maxX; const wz0 = zone.z + b.minZ; const wz1 = zone.z + b.maxZ;
            assert.ok(wx0 >= -10 && wx1 <= 10 && wz0 >= -7 && wz1 <= 9, `${producerId}/${part.kind} inside the site`);
            if (part.kind === 'numberPlate' || part.kind === 'zoneTag') {
                for (const [otherId, other] of Object.entries(ZONE_LAYOUT)) {
                    if (otherId === identityZoneOf(producerId)) continue;
                    const overlap = wx0 < other.x + other.width / 2 && wx1 > other.x - other.width / 2 && wz0 < other.z + other.depth / 2 && wz1 > other.z - other.depth / 2;
                    assert.equal(overlap, false, `${producerId}/${part.kind} not on ${otherId}`);
                }
                assert.equal(wx0 < 6.7 && wx1 > -6.3 && wz0 < 0.05 && wz1 > -0.65, false, `${producerId}/${part.kind} not on the logistics spine`);
                assert.equal(wx0 < -2.2 && wx1 > -8.2 && wz0 < -0.3 && wz1 > -5.1 && producerId !== 'fabricator', false, `${producerId}/${part.kind} not on the opening foundation`);
            }
            assert.ok(part.localPos.y > 0.01 && part.localPos.y >= floorHeightAt(zone.x + part.localPos.x, zone.z + part.localPos.z) + 0.01, 'above the surface under it (no z-fight)');
        }
        // A future bay (level 0) keeps the stripe + zone tag only.
        assert.deepEqual([...new Set(decalPartsFor(producerId, 0).map((p) => p.kind))].sort(), ['hazardStripe', 'zoneTag']);
    }
    assert.ok(total <= DECAL_MAX_PARTS_TOTAL, `${total} total renderers`);
    assert.deepEqual(decalPartsFor('nope', 1), []);
});

test('decals: layers stack by thickness (plates under glyphs) and the zone tag shows 1..5 pips = the producer number', () => {
    IDENTITY_PRODUCER_IDS.forEach((producerId, index) => {
        const tag = decalPartsFor(producerId, 1).filter((p) => p.kind === 'zoneTag');
        assert.equal(tag.filter((p) => p.color === 'amber').length, index + 1);
        const plate = tag.find((p) => p.color === 'graphite')!;
        assert.ok(tag.filter((p) => p.color === 'amber').every((p) => p.localPos.y > plate.localPos.y));
    });
});

test('plates and pips are enlarged separately (2.2x) and the pips fit the tag plate; no cyan in any decal (a cyan stripe is a machine light, not a decal)', () => {
    assert.equal(PLATE_SCALE, 2.2);
    assert.ok(NUMBER_PLATE.digitHeight >= 0.15 && DECAL_TAG.pip >= 0.1);
    assert.ok(4 * DECAL_TAG.pipGap + DECAL_TAG.pip <= DECAL_TAG.width);
    for (const producerId of IDENTITY_PRODUCER_IDS) for (const part of decalPartsFor(producerId, 1)) if (part.kind === 'hazardStripe') assert.ok(part.color === 'amber' || part.color === 'graphite');
    assert.ok(decalPartsFor('advanced_robotics_complex', 1).filter((p) => p.kind === 'hazardStripe').length === 3, 'the complex stripe is shortened');
});

test('seven-segment digits and the number plate: 01..14 produce segments, 1 has 2, 8 has 7', () => {
    assert.equal(SEVEN_SEG['1'].length, 2);
    assert.equal(SEVEN_SEG['8'].length, 7);
    for (let n = 1; n <= 14; n += 1) {
        const boxes = numberPlateBoxes(n);
        assert.ok(boxes.length >= 4, `n=${n} has segments`);
        assert.equal(new Set(boxes.map((b) => b.digit)).size, 2, 'two digits');
        for (const b of boxes) assert.ok(b.w > 0 && b.h > 0);
    }
    // Round 3: the '1' has a thicker stem, a foot serif and a top-left flag (a bare 2-segment '1' read as a bar: 'O I').
    const one = numberPlateBoxes(1).filter((b) => b.digit === 1);
    assert.equal(numberPlateBoxes(1).length, SEVEN_SEG['0'].length + one.length);
    assert.deepEqual(one.map((b) => b.segment).sort(), ['a', 'b', 'c', 'd']);
    const stem = one.find((b) => b.segment === 'b')!;
    const zeroStem = numberPlateBoxes(1).find((b) => b.digit === 0 && b.segment === 'b')!;
    assert.ok(stem.w > zeroStem.w * 1.5, 'thicker stem');
    const foot = one.find((b) => b.segment === 'd')!;
    assert.ok(foot.w > stem.w * 2, 'foot serif wider than the stem');
});

test('ring arcs: one gap, never a closed ring; the AI Core halo is 3 segments of 8 boxes', () => {
    const arcs = ringArcBoxes(0.3, 25, 12);
    assert.equal(arcs.length, 24);
    assert.equal(arcs.some((a) => a.index === 12), false);
    assert.equal(AI_CORE_ARC.segmentCount * AI_CORE_ARC.boxesPerSegment, 24);
    assert.equal(ringArcBoxes(0.3, 8, 3).length, 7);
});

test('AI Core: hex shell of 6 graphite bars stacked 2 high, floating off-white diamond with a cyan cap, cyan arcs; 3 renderers; hex from aiMarkGeometry', () => {
    const summary = aiCoreSummary();
    assert.deepEqual([summary.shellBars, summary.arcBoxes, summary.arcSegments, summary.renderers], [12, 24, 3, 3]);
    assert.deepEqual(groupBoxesByColor(AI_CORE_PARTS).map((g) => g.color), ['graphite', 'offWhite', 'cyan']);
    const shell = AI_CORE_PARTS.filter((p) => p.kind === 'shell');
    const hex = aiMarkGeometry(0, 0, 0.4).hexOuter;
    // Each bar sits on an edge midpoint of the AI mark hexagon (single source, no duplicated constants).
    for (const bar of shell.slice(0, 6)) {
        const hit = hex.some((a, i) => { const b = hex[(i + 1) % hex.length]; return Math.hypot((a.x + b.x) / 2 - bar.center.x, (a.y + b.y) / 2 - bar.center.z) < 1e-9; });
        assert.ok(hit, 'bar on a hexagon edge');
        assert.equal(bar.color, 'graphite');
    }
    assert.equal(new Set(shell.map((p) => p.center.y.toFixed(4))).size, 2, 'stacked 2 high');
    const diamond = AI_CORE_PARTS.find((p) => p.kind === 'diamond')!;
    const cap = AI_CORE_PARTS.find((p) => p.kind === 'cap')!;
    assert.equal(diamond.color, 'offWhite');
    // Tuning: the upper shell layer is an off-white rim (reads on the dark pedestal), the lower layer graphite; the cyan dot is bigger.
    assert.deepEqual([...new Set(shell.filter((p) => p.center.y > 0).map((p) => p.color))], ['offWhite']);
    assert.deepEqual([...new Set(shell.filter((p) => p.center.y < 0).map((p) => p.color))], ['graphite']);
    assert.ok(cap.size.x >= 0.1 && AI_CORE_ARC.width >= 0.04);
    assert.equal(cap.color, 'cyan');
    assert.ok(cap.center.y > diamond.center.y);
});

test('AI Core sizes: persistent 0.6 (round 3) < reveal peak 0.8, the shell scales together; the old cube sizes are gone', () => {
    assert.equal(AI_CORE_PERSISTENT_SIZE, 0.6);
    assert.equal(AI_CORE_PEAK_SIZE, 0.8);
    assert.ok(AI_CORE_PERSISTENT_SIZE < AI_CORE_PEAK_SIZE);
    assert.equal(REBOOT_CORE_PERSISTENT_SIZE, AI_CORE_PERSISTENT_SIZE);
    assert.equal(REBOOT_CORE_PEAK_SIZE, AI_CORE_PEAK_SIZE);
    assert.ok(Math.abs(aiCoreScaleFor(AI_CORE_PERSISTENT_SIZE) - 0.6 / 0.28) < 1e-12);
    assert.ok(AI_CORE_PERSISTENT_SIZE / 0.36 >= 1.65, 'round 3: the marker is >= 1.65x the round-2 size (~18 px -> >= 30 px)');
    assert.ok(Math.abs(rebootCoreCenterY(0.28) - (0.42 + AI_CORE_SHELL_HALF_HEIGHT)) < 1e-12, 'Reboot core height mirrors the AI Core shell');
    assert.ok(Math.abs(aiCoreScaleFor(AI_CORE_PEAK_SIZE) - 0.8 / 0.28) < 1e-12);
    assert.equal(aiCoreScaleFor(0), 0);
});

test('merged geometry: triangle winding matches the normals (rotated boxes included) and the bounds are exact', () => {
    const merged = mergeBoxGeometry(AI_CORE_PARTS);
    assert.equal(merged.positions.length / 3, AI_CORE_PARTS.length * 24);
    assert.equal(merged.indices.length, AI_CORE_PARTS.length * 36);
    for (let t = 0; t < merged.indices.length; t += 3) {
        const [a, b, c] = [merged.indices[t], merged.indices[t + 1], merged.indices[t + 2]];
        const p = (i: number) => [merged.positions[i * 3], merged.positions[i * 3 + 1], merged.positions[i * 3 + 2]];
        const [pa, pb, pc] = [p(a), p(b), p(c)];
        const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
        const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
        const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const n = [merged.normals[a * 3], merged.normals[a * 3 + 1], merged.normals[a * 3 + 2]];
        assert.ok(cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] > 0, `triangle ${t / 3} faces outward`);
    }
    assert.ok(merged.min.x < 0 && merged.max.x > 0 && merged.boundingRadius > 0);
    assert.equal(mergeBoxGeometry([]).indices.length, 0);
});

test('icons: 8 icons, every polygon is a convex closed polygon inside the 0..1 unit square', () => {
    assert.equal(ICON_NAMES.length, 8);
    assert.deepEqual(Object.keys(ICON_SHAPES).sort(), [...ICON_NAMES].sort());
    for (const name of ICON_NAMES) {
        assert.ok(ICON_SHAPES[name].length >= 2, `${name} has parts`);
        for (const polygon of ICON_SHAPES[name]) {
            assert.ok(polygon.points.length >= 3, `${name} closed polygon`);
            assert.equal(isConvexPolygon(polygon.points), true, `${name} convex`);
            for (const p of polygon.points) assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1, `${name} inside the unit square`);
        }
    }
    assert.equal(isConvexPolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0.2 }, { x: 1, y: 1 }, { x: 0, y: 1 }]), false);
    assert.equal(producerIconFor('fabricator'), 'industrial_output');
    assert.equal(producerIconFor(null), null);
    assert.equal(milestoneIconFor('breakthrough'), 'breakthrough');
    assert.equal(milestoneIconFor('era_title'), null);
});

test('icon slots sit inside existing rows / chips and leave the centred text alone', () => {
    const io = hudIndustrialIconSlot();
    const half = cardRowWidth(CORE_HUD_LAYOUT) / 2;
    assert.ok(io.x - io.size / 2 >= -half && io.x + io.size / 2 < -half + half * 0.12);
    assert.equal(io.y, cardRowCenterY(CORE_HUD_LAYOUT, 0));
    assert.ok(io.size <= CORE_HUD_LAYOUT.rows[0].height);
    const oc = hudOverclockIconSlot();
    assert.ok(oc.x - oc.size / 2 >= -half && oc.x + oc.size / 2 < -half + half * 0.2);
    assert.ok(oc.size <= 60);
    const header = producerHeaderIconSlot();
    assert.ok(header.size <= PRODUCER_PANEL_LAYOUT.rows[0].height && header.x - header.size / 2 >= -cardRowWidth(PRODUCER_PANEL_LAYOUT) / 2);
    for (const tier of ['minor', 'major', 'exceptional'] as const) {
        const slot = milestoneIconSlot(tier);
        const layout = MILESTONE_TOAST_LAYOUT[tier];
        assert.ok(slot.x - slot.size / 2 >= -layout.width / 2 && slot.size <= layout.titleLineHeight);
    }
    const founder = founderChipIconSlot();
    assert.ok(founder.x - founder.size / 2 >= -FOUNDER_CHIP_WIDTH / 2 && founder.size <= FOUNDER_CHIP_HEIGHT - 8);
});

test('round 3 toast: the Major / Exceptional bands start below every chip, the Minor band keeps the first line; every tier clear of the chips on 5 screens', async () => {
    const toast = await import('../assets/scripts/presentation/MilestoneToastLayout.ts');
    const settings = await import('../assets/scripts/presentation/SettingsLayout.ts');
    const extended = await import('../assets/scripts/presentation/ExtendedOverclockLayout.ts');
    const founder = await import('../assets/scripts/presentation/FounderShopLayout.ts');
    const reboot = await import('../assets/scripts/presentation/RebootLayout.ts');
    const ai = await import('../assets/scripts/presentation/PermanentUpgradeLayout.ts');
    const { rectsOverlap, computeUiLayout } = await import('../assets/scripts/presentation/UiLayout.ts');
    assert.equal(toast.milestoneToastTopOffsetFor('minor'), toast.milestoneToastTopOffset());
    assert.ok(toast.milestoneToastTopOffsetFor('major') > extended.extendedOverclockChipWidgetOffsets().top + 64 - 1e-9);
    assert.ok(toast.milestoneToastTopOffsetFor('exceptional') > founder.founderChipWidgetOffsets().top + 64 - 1e-9);
    for (const [w, h] of [[1080, 2412], [1080, 1920], [720, 1280], [1080, 2340], [1440, 3120]]) {
        const screen = { w, h };
        const chips = [settings.computeSettingsRects(screen).chip, extended.computeExtendedOverclockChipRect(screen), ai.computePermanentUpgradeRects(screen).chip, reboot.computeRebootRects(screen).chip, founder.computeFounderShopRects(screen).chip];
        for (const tier of ['major', 'exceptional'] as const) {
            const rect = toast.computeMilestoneToastRect(screen, undefined, tier);
            for (const chip of chips) assert.equal(rectsOverlap(rect, chip), false, `${w}x${h} ${tier} toast clear of every chip`);
            assert.equal(toast.milestoneToastFitsFactoryBand(screen, undefined, tier), true, `${w}x${h} ${tier} still inside the factory band`);
            const ui = computeUiLayout(screen);
            assert.ok(rect.y >= ui.factoryBand.y && rect.y + rect.h <= ui.hud.y);
        }
    }
    const controller = code('MilestonePresentationController.ts');
    assert.match(controller, /widget\.top = milestoneToastTopOffsetFor\(trigger\.tier\)/);
});

test('source record and placeholder wordmark (no final logo)', () => {
    assert.match(IDENTITY_SOURCE_RECORD, /procedurally/);
    assert.match(IDENTITY_SOURCE_RECORD, /no AI generation/);
    assert.deepEqual(PLACEHOLDER_WORDMARK, { text: 'AUTOMATA', font: 'engine-default', mark: 'ai_core', status: 'PLACEHOLDER' });
    for (const file of fs.readdirSync(path.join(repoRoot, 'assets/scripts/presentation')).filter((f) => f.endsWith('.ts') && f !== 'AutomataIdentity.ts')) {
        assert.doesNotMatch(read(`assets/scripts/presentation/${file}`), /PLACEHOLDER_WORDMARK/, `${file} does not wire the placeholder wordmark`);
    }
});

test('wiring pins: shared drawAiMark, no bespoke copies, fill-only drawing, decals + AI Core built from the pure module', () => {
    for (const file of ['PermanentUpgradeController.ts', 'RebootController.ts']) {
        const source = code(file);
        assert.match(source, /import \{ drawAiMark \} from '\.\/IdentityGraphics'/);
        assert.doesNotMatch(source, /private drawAiMark|aiMarkGeometry\(/, `${file}: no bespoke AI mark copy`);
    }
    const graphics = code('IdentityGraphics.ts');
    assert.doesNotMatch(graphics, /\.stroke\(|Sprite\b/);
    assert.match(graphics, /aiMarkGeometry\(cx, cy, size\)/);
    const mesh = code('AutomataIdentityMesh.ts');
    assert.match(mesh, /effectName: 'builtin-unlit', defines: \{ USE_COLOR: true \}/);
    assert.match(mesh, /materialCache/);
    assert.doesNotMatch(mesh, /\.active\s*=/);
    const applier = code('AutomataDecalApplier.ts');
    assert.match(applier, /decalPartsFor\(producerId, DECAL_BUILT_LEVEL\)/);
    assert.match(applier, /AI_CORE_PARTS/);
    const bootstrap = code('FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /applyAutomataDecalsToSite\(site\);/);
    assert.match(bootstrap, /buildAiCoreModel\(core\);/);
    assert.match(bootstrap, /emitDeviceEvent\('identity'/);
    assert.match(code('CoreHudController.ts'), /drawIcon\(graphics, 'overclock'/);
    assert.match(code('CoreHudController.ts'), /drawIcon\(graphics, 'industrial_output'/);
    assert.match(code('ProducerPanelController.ts'), /drawIcon\(graphics, icon, slot\.x/);
    assert.match(code('MilestonePresentationController.ts'), /drawIcon\(graphics, icon, slot\.x/);
    assert.match(code('FounderShopController.ts'), /drawIcon\(graphics, 'robot'/);
    assert.doesNotMatch(code('FounderShopController.ts'), /founderGold|204, 146, 40/, 'gold stays on the Founder robot');
    const reboot = code('RebootPresentationController.ts');
    assert.match(reboot, /aiCoreScaleFor\(frame\.coreSize\)/);
    assert.doesNotMatch(reboot, /EULER/);
});

test('diagnostics, scenarios and capture checks', () => {
    assert.ok((DEVICE_EVENT_TYPES as readonly string[]).includes('identity'));
    assert.ok(DEFAULT_REVEAL_EVENT_TYPES.includes('identity'));
    assert.equal(REVEAL_SCENARIOS['aut066-factory'].expectIdentity, 'factory');
    assert.equal(REVEAL_SCENARIOS['aut066-ai-core'].expectIdentity, 'ai_core');
    assert.equal(REVEAL_SCENARIOS['aut066-ai-core'].expectReboot, 'sequence');
    const cli = read('tools/device/cli.ts');
    assert.match(cli, /expectIdentity: scenario\.expectIdentity/);
    assert.match(read('tools/device/reveal_capture.ts'), /expectIdentity: options\.expectIdentity/);

    const ev = (tMs: number, evt: string, rest: Record<string, unknown>) => ({ tMs, event: { v: 1, seq: tMs, evt, ...rest } as never });
    const rect = { x: 10, y: 10, w: 40, h: 30 };
    const factory = ev(5000, 'identity', {
        decals: IDENTITY_PRODUCER_IDS.map((producerId) => ({ producerId, parts: 4, rect })),
        aiCore: {},
        icons: [{ slot: 'hud_industrial_output', icon: 'industrial_output', rect }, { slot: 'hud_overclock', icon: 'overclock', rect }],
    });
    assert.equal(evaluateIdentity([factory], 'factory').every((c) => c.ok), true);
    assert.equal(evaluateIdentity([], 'factory').some((c) => !c.ok), true, 'no identity event fails');
    const over = ev(5000, 'identity', { decals: IDENTITY_PRODUCER_IDS.map((producerId) => ({ producerId, parts: 6, rect })), icons: [] });
    assert.equal(evaluateIdentity([over], 'factory').some((c) => c.id === 'identity_decal_budget' && !c.ok), true);
    assert.equal(evaluateIdentity([over], 'factory').some((c) => c.id === 'identity_icons_drawn' && !c.ok), true);
    const core = ev(6000, 'identity', { decals: [], icons: [], aiCore: { ...aiCoreSummary(), built: true, modelRenderers: 3 } });
    const applied = ev(6100, 'reboot_presentation', { phase: 'effect_applied', part: 'core', aiCoreParts: 3 });
    const rebootToast = ev(6050, 'identity', { phase: 'toast_icon', kind: 'reboot_title', icon: 'reboot', tier: 'exceptional', topOffset: 232, chipsBottom: 224 });
    assert.equal(evaluateIdentity([core, applied, rebootToast], 'ai_core').every((c) => c.ok), true);
    assert.equal(evaluateIdentity([core], 'ai_core').some((c) => c.id === 'identity_ai_core_in_sequence' && !c.ok), true);
    assert.equal(evaluateIdentity([ev(1, 'error', {}), factory], 'factory').some((c) => c.id === 'identity_no_errors' && !c.ok), true);
    assert.equal(evaluateRevealTimeline([factory], { expectConstruction: null, expectFocus: false, triggered: false, frameCount: 10, expectIdentity: 'factory' }).some((c) => c.id.startsWith('identity_')), true);
    assert.equal(evaluateRevealTimeline([factory], { expectConstruction: null, expectFocus: false, triggered: false, frameCount: 10 }).some((c) => c.id.startsWith('identity_')), false);
});

test('round 3 capture checks: panel header icons per producer (>= 40 px), toast icon kinds and chip clearance', () => {
    const ev = (tMs: number, evt: string, rest: Record<string, unknown>) => ({ tMs, event: { v: 1, seq: tMs, evt, ...rest } as never });
    const r = { x: 10, y: 10, w: 45, h: 45 };
    const header = (icon: string, rect: unknown = r) => ev(1000, 'identity', { decals: [], icons: [{ slot: 'producer_header', icon, rect }], aiCore: {} });
    const good = [header('industrial_output'), header('automation'), header('robot')];
    assert.equal(evaluateIdentity(good, 'panel').every((c) => c.ok), true);
    assert.equal(evaluateIdentity([header('industrial_output'), header('robot')], 'panel').some((c) => c.id === 'identity_panel_header_icons' && !c.ok), true, 'a missing producer icon fails');
    assert.equal(evaluateIdentity([...good, header('robot', { x: 0, y: 0, w: 30, h: 30 })], 'panel').some((c) => c.id === 'identity_panel_header_rects' && !c.ok), true, 'a header icon under 40 px fails');
    const toastEv = (kind: string, icon: string, tier: string, topOffset: number) => ev(2000, 'identity', { phase: 'toast_icon', kind, icon, tier, topOffset, chipsBottom: 224 });
    const base = header('robot');
    assert.equal(evaluateIdentity([base, toastEv('breakthrough', 'breakthrough', 'major', 232)], 'toast_breakthrough').every((c) => c.ok), true);
    assert.equal(evaluateIdentity([base, toastEv('breakthrough', 'breakthrough', 'major', 100)], 'toast_breakthrough').some((c) => !c.ok), true, 'a band over the chips fails');
    assert.equal(evaluateIdentity([base, toastEv('breakthrough', 'milestone', 'major', 232)], 'toast_breakthrough').some((c) => !c.ok), true, 'wrong icon fails');
    const core = ev(6000, 'identity', { decals: [], icons: [], aiCore: { ...aiCoreSummary(), built: true, modelRenderers: 3 } });
    const applied = ev(6100, 'reboot_presentation', { phase: 'effect_applied', part: 'core', aiCoreParts: 3 });
    assert.equal(evaluateIdentity([core, applied, toastEv('reboot_title', 'reboot', 'exceptional', 232)], 'ai_core').every((c) => c.ok), true);
    assert.equal(evaluateIdentity([core, applied], 'ai_core').some((c) => c.id === 'identity_toast_icon_reboot_title' && !c.ok), true);
    assert.equal(REVEAL_SCENARIOS['aut066-panel'].trigger, 'select-producers');
    assert.equal(REVEAL_SCENARIOS['aut066-panel'].expectIdentity, 'panel');
    assert.equal(REVEAL_SCENARIOS['aut066-toast-breakthrough'].expectIdentity, 'toast_breakthrough');
    assert.deepEqual([milestoneIconFor('breakthrough'), milestoneIconFor('reboot_title'), milestoneIconFor('robots_built'), milestoneIconFor('automation'), milestoneIconFor('producer_milestone')], ['breakthrough', 'reboot', 'robot', 'automation', 'milestone']);
    assert.deepEqual(['fabricator', 'robot_line', 'advanced_robotics_complex'].map(producerIconFor), ['industrial_output', 'automation', 'robot']);
    assert.match(read('tools/device/reveal_capture.ts'), /trigger === 'select-producers'/);
});

test('.ts.meta files: typescript importer, unique a0660000 uuids; no asset was added', () => {
    const seen = new Set<string>();
    for (const file of ['AutomataIdentity', 'AutomataIdentityMesh', 'AutomataDecalApplier', 'IdentityGraphics']) {
        const meta = JSON.parse(presentation(`${file}.ts.meta`));
        assert.equal(meta.importer, 'typescript');
        assert.match(meta.uuid, /^a0660000-0000-4000-8000-\d{12}$/);
        seen.add(meta.uuid);
    }
    assert.equal(seen.size, 4);
    assert.match(read('docs/ASSET_MANIFEST.md'), /CUSTOM_AUTOMATA_DECALS_01/);
    assert.match(read('docs/ASSET_MANIFEST.md'), /CUSTOM_ADV_ROBOTICS_CORE_01[^\n]*NOT CREATED/);
});
