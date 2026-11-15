import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { WORKER_BOT_SCALE } from '../assets/scripts/presentation/AssemblySliceLayout.ts';
import { DEVICE_EVENT_TYPES } from '../assets/scripts/presentation/DeviceDiagnostics.ts';
import {
    FOUNDER_ACCENT_PARTS,
    FOUNDER_BODY_HEIGHT,
    FOUNDER_CREST_ADDED_HEIGHT,
    FOUNDER_FALLBACK_SHELL_PARTS,
    FOUNDER_MAX_PARTS,
    FOUNDER_MAX_ROBOTS,
    FOUNDER_PALETTE,
    FOUNDER_POOL_FAR_MIN_VISIBLE,
    FOUNDER_POOL_MIN_VISIBLE,
    FOUNDER_POOL_SLOT_SMALL,
    FOUNDER_POOL_SLOT,
    FOUNDER_UNIT_MARK,
    contrastRatio,
    founderPartSize,
    founderRanks,
    founderShellColorForMaterialName,
    resolveFounderRobotSlots,
} from '../assets/scripts/presentation/FounderRobotVariant.ts';
import { resolveVisibleRobotCount, ROBOT_POPULATION_BASELINE_MAX } from '../assets/scripts/presentation/RobotPopulation.ts';
import { isFounderRobotCosmeticOwned } from '../assets/scripts/monetization/FounderOffer.ts';
import { CURRENT_SAVE_VERSION } from '../assets/scripts/persistence/index.ts';
import { FOUNDER_ROBOT_COSMETIC_ID } from '../assets/scripts/state/FounderOfferKeys.ts';
import { FOUNDER_SHOP_RELAUNCH_MARKER_EVT } from '../tools/device/founder_shop_checks.ts';
import { FOUNDER_PERF_P95_BUDGET_MS, evaluateFounderRobot, founderEventViolation, type FounderRobotTimelineEvent } from '../tools/device/founder_robot_checks.ts';
import { DEFAULT_REVEAL_EVENT_TYPES, REVEAL_SCENARIOS, evaluateRevealTimeline } from '../tools/device/reveal_capture.ts';
import { AUT062_SEED_VARIANTS, buildAut062PurchaseScriptFile, buildAut062SeededSave, buildAut062SeededState, isAut062SeedVariant } from '../tools/device/seed_aut062.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const NOW_MS = Date.parse('2026-11-15T12:00:00.000Z');

// ---------------------------------------------------------------- palette / parts

test('AUT-062 palette is the approved graphite / gold set, opaque, with graphite-vs-gold contrast >= 3:1', () => {
    assert.deepEqual({ ...FOUNDER_PALETTE.GRAPHITE_SHELL }, { r: 38, g: 40, b: 46, a: 255 });
    assert.deepEqual({ ...FOUNDER_PALETTE.GRAPHITE_DARK }, { r: 22, g: 24, b: 28, a: 255 });
    assert.deepEqual({ ...FOUNDER_PALETTE.GOLD_ACCENT }, { r: 204, g: 146, b: 40, a: 255 });
    assert.deepEqual({ ...FOUNDER_PALETTE.GOLD_HILITE }, { r: 240, g: 190, b: 92, a: 255 });
    for (const [key, color] of Object.entries(FOUNDER_PALETTE)) assert.equal(color.a, 255, `${key} is opaque (no alpha)`);
    for (const gold of [FOUNDER_PALETTE.GOLD_ACCENT, FOUNDER_PALETTE.GOLD_HILITE]) {
        for (const graphite of [FOUNDER_PALETTE.GRAPHITE_SHELL, FOUNDER_PALETTE.GRAPHITE_DARK]) {
            assert.ok(contrastRatio(gold, graphite) >= 3, `gold vs graphite ${contrastRatio(gold, graphite).toFixed(2)}:1`);
        }
    }
    assert.ok(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }) > 20.9, 'contrast helper sanity (21:1)');
});

test('AUT-062 accent parts: opaque palette colours only, UNIT 0001 plate with 4 pips, crest taller than a third of the body, bounded part count', () => {
    const palette = new Set(Object.keys(FOUNDER_PALETTE));
    for (const part of [...FOUNDER_ACCENT_PARTS, ...FOUNDER_FALLBACK_SHELL_PARTS]) {
        assert.ok(palette.has(part.color), `${part.id} uses a palette colour`);
        assert.ok(part.size.x > 0 && part.size.y > 0 && part.size.z > 0, `${part.id} has a size`);
    }
    assert.ok(FOUNDER_ACCENT_PARTS.some((part) => part.group === 'crest' && part.color === 'GOLD_ACCENT'));
    const cap = FOUNDER_ACCENT_PARTS.find((part) => part.id === 'crest_cap')!;
    assert.ok(cap.size.x >= 0.22 && cap.size.z >= 0.22, 'wide head cap');
    assert.ok(FOUNDER_ACCENT_PARTS.find((part) => part.id === 'crest_fin')!.size.x >= 0.10, 'fin widened');
    // Slot spread: the loop phase of the pooled Founder is far from rank 0 (phase 0).
    for (const slot of [FOUNDER_POOL_SLOT, FOUNDER_POOL_SLOT_SMALL]) {
        const phase = ((slot + 1) * 0.6180339887498949) % 1;
        assert.ok(Math.min(phase, 1 - phase) >= 0.3, `slot ${slot} phase ${phase.toFixed(2)} is far from rank 0`);
    }
    // Warm, not hazard yellow: green/red of the accent is below 0.75.
    assert.ok(FOUNDER_PALETTE.GOLD_ACCENT.g / FOUNDER_PALETTE.GOLD_ACCENT.r < 0.75);
    assert.equal(FOUNDER_ACCENT_PARTS.filter((part) => part.group === 'band').length, 3, 'two shoulder bands and one chest band');
    assert.equal(FOUNDER_ACCENT_PARTS.filter((part) => part.group === 'pip' && part.id.includes('front')).length, 4);
    assert.equal(FOUNDER_UNIT_MARK.pips, 4);
    assert.ok(FOUNDER_UNIT_MARK.kind === 'plate_with_pips', 'opaque plate + pips shipped (no alpha-blended text)');
    assert.ok(Math.abs(FOUNDER_BODY_HEIGHT - 4.513 * WORKER_BOT_SCALE) < 1e-9);
    assert.ok(FOUNDER_CREST_ADDED_HEIGHT >= FOUNDER_BODY_HEIGHT / 3, `crest adds ${FOUNDER_CREST_ADDED_HEIGHT.toFixed(3)} of ${FOUNDER_BODY_HEIGHT.toFixed(3)}`);
    const tip = FOUNDER_ACCENT_PARTS.find((part) => part.id === 'crest_tip');
    assert.ok(tip && tip.color === 'GOLD_HILITE');
    assert.ok(FOUNDER_MAX_PARTS <= 24, `${FOUNDER_MAX_PARTS} boxes per Founder robot, at most ${FOUNDER_MAX_ROBOTS} robots`);
    // The fallback enlarges only the gold bands / plates.
    const band = FOUNDER_ACCENT_PARTS.find((part) => part.id === 'band_chest')!;
    assert.ok(founderPartSize(band, true).x > founderPartSize(band, false).x);
    const fin = FOUNDER_ACCENT_PARTS.find((part) => part.id === 'crest_fin')!;
    assert.equal(founderPartSize(fin, true).x, founderPartSize(fin, false).x);
    assert.equal(founderShellColorForMaterialName('Black'), 'GRAPHITE_DARK');
    assert.equal(founderShellColorForMaterialName('Main'), 'GRAPHITE_SHELL');
    assert.equal(founderShellColorForMaterialName('Grey'), 'GRAPHITE_SHELL');
});

// ---------------------------------------------------------------- slot resolver

test('AUT-062 resolveFounderRobotSlots: not owned -> none; owned -> rank 0 and at most one pooled slot from 4 visible; never all; max 2; deterministic', () => {
    for (const visible of [0, 1, 3, 4, 14, 30]) {
        const none = resolveFounderRobotSlots(false, visible);
        assert.equal(none.workerBot, false);
        assert.deepEqual([...none.poolSlots], []);
        assert.deepEqual([...founderRanks(none)], []);
    }
    for (const visible of [0, 1, 2, 3]) {
        const owned = resolveFounderRobotSlots(true, visible);
        assert.equal(owned.workerBot, true, `rank 0 is the Founder robot at ${visible} visible (also before the first reveal)`);
        assert.deepEqual([...owned.poolSlots], []);
        assert.deepEqual([...founderRanks(owned)], [0]);
    }
    const small = resolveFounderRobotSlots(true, FOUNDER_POOL_MIN_VISIBLE);
    assert.deepEqual([...small.poolSlots], [FOUNDER_POOL_SLOT_SMALL], 'with 4 visible the farthest available slot is used');
    assert.deepEqual([...founderRanks(small)], [0, 1]);
    assert.ok(FOUNDER_POOL_SLOT_SMALL < FOUNDER_POOL_MIN_VISIBLE - 1);
    for (const visible of [FOUNDER_POOL_FAR_MIN_VISIBLE, 6, 7, 14, 30]) {
        const owned = resolveFounderRobotSlots(true, visible);
        assert.equal(owned.workerBot, true);
        assert.deepEqual([...owned.poolSlots], [FOUNDER_POOL_SLOT]);
        assert.ok(FOUNDER_POOL_SLOT < visible - 1, 'the pooled slot exists in the pool');
        assert.deepEqual([...founderRanks(owned)], [0, FOUNDER_POOL_SLOT + 1]);
        assert.ok(founderRanks(owned).length <= FOUNDER_MAX_ROBOTS && founderRanks(owned).length < visible);
        assert.deepEqual(resolveFounderRobotSlots(true, visible), owned, 'deterministic');
    }
    for (const bad of [-3, Number.NaN, Number.POSITIVE_INFINITY, 3.9]) {
        const slots = resolveFounderRobotSlots(true, bad);
        assert.equal(slots.workerBot, true);
        assert.deepEqual([...slots.poolSlots], [], `visible ${bad} never adds a pooled Founder robot`);
    }
    assert.equal(FOUNDER_POOL_MIN_VISIBLE, 4);
    assert.equal(FOUNDER_MAX_ROBOTS, 2);
});

test('AUT-062 the seeded many-robots state shows 7 visible robots so the rule yields exactly 2 Founder robots', () => {
    const state = buildAut062SeededState('owned_many_robots', NOW_MS);
    const visible = resolveVisibleRobotCount(state.run.robotsBuilt);
    assert.ok(visible >= FOUNDER_POOL_MIN_VISIBLE && visible <= ROBOT_POPULATION_BASELINE_MAX, `visible ${visible}`);
    const ranks = founderRanks(resolveFounderRobotSlots(isFounderRobotCosmeticOwned(state), visible));
    assert.equal(ranks.length, 2);
    assert.ok(ranks.length < visible);
});

// ---------------------------------------------------------------- source pins

test('AUT-062 the pure variant module imports no cc and keeps the rule out of the controllers', () => {
    const pure = read('assets/scripts/presentation/FounderRobotVariant.ts');
    const engine = ['c', 'c'].join('');
    assert.doesNotMatch(pure, new RegExp(`from\\s+['"]${engine}(/env)?['"]`), 'engine-free');
    assert.match(pure, /export function resolveFounderRobotSlots/);
    assert.ok(fs.existsSync(path.join(repoRoot, 'assets/scripts/presentation/FounderRobotVariant.ts.meta')));
    assert.ok(fs.existsSync(path.join(repoRoot, 'assets/scripts/presentation/FounderRobotVisual.ts.meta')));
});

test('AUT-062 FounderRobotVisual: unlit opaque child boxes, cloned material instances for the tint, created once, never destroyed, hidden by scale', () => {
    const source = code('assets/scripts/presentation/FounderRobotVisual.ts');
    assert.match(source, /effectName: 'builtin-unlit'/);
    assert.match(source, /USE_COLOR: true/);
    assert.match(source, /setProperty\('mainColor'/);
    assert.match(source, /primitives\.box\(/);
    assert.match(source, /getMaterialInstance\(/, 'the shell tint goes through a per-renderer material instance');
    assert.doesNotMatch(source, /getSharedMaterial\([^)]*\)[^;]*setProperty|sharedMaterial\s*=|\.sharedMaterials\s*=/, 'the shared robot material is never mutated');
    assert.doesNotMatch(source, /\.destroy\(|\.active\s*=\s*false|removeFromParent|emissive|Label|Sprite|UIOpacity/, 'never destroyed / deactivated; no glow, text or sprites');
    assert.doesNotMatch(source, /alpha|, 255\)\s*\*|\ba:\s*(?!255)/);
    assert.match(source, /container\.setScale\(0, 0, 0\)/);
    assert.match(source, /1 \/ WORKER_BOT_SCALE/, 'child units are converted from world units at the final robot scale');
    assert.match(source, /states\.get\(robot\)/, 'one state per robot node: created once, reused');
    assert.match(source, /if \(state\.applied === founder\) return/, 'idempotent');
    assert.match(source, /if \(!founder\) return infoOf\(undefined\)/, 'a robot that is not a Founder costs nothing');
});

test('AUT-062 controllers call the shared applier with the pure resolver; ownership is read from the cosmetic state only', () => {
    const worker = code('assets/scripts/presentation/FirstRobotPresentationController.ts');
    assert.match(worker, /isFounderRobotCosmeticOwned\(state\)/);
    assert.match(worker, /applyFounderRobotVariant\(this\.robotNode, resolveFounderRobotSlots\(this\.founderOwned, 0\)\.workerBot\)/);
    const pool = code('assets/scripts/presentation/RobotPopulationController.ts');
    assert.match(pool, /isFounderRobotCosmeticOwned\(state\)/);
    assert.match(pool, /resolveFounderRobotSlots\(this\.founderOwned, snapshot\.visible\)/);
    assert.match(pool, /applyFounderRobotVariant\(robot\.node, slots\.poolSlots\.includes\(robot\.variation\.slot\)\)/);
    assert.match(pool, /emitDeviceEvent\('robot_founder'/);
    for (const source of [worker, pool]) {
        assert.doesNotMatch(source, /submit\(|executeCommand|state\.meta\.\w+\s*=/, 'presentation never writes state');
    }
    // Both controllers re-derive on sync AND on every domain-event batch (mid-session purchase swaps in place, no reveal / pose reset).
    assert.equal((worker.match(/this\.founderOwned = isFounderRobotCosmeticOwned\(state\)/g) ?? []).length, 2);
    assert.equal((pool.match(/this\.founderOwned = isFounderRobotCosmeticOwned\(state\)/g) ?? []).length, 2);
    assert.equal(FOUNDER_ROBOT_COSMETIC_ID, 'cosmetic.founder_robot');
    assert.equal(CURRENT_SAVE_VERSION, 3, 'no save / schema change');
    assert.doesNotMatch(read('assets/scripts/domain/Events.ts'), /founderRobot/i, 'no new domain event');
});

test('AUT-062 the robot_founder DEBUG event is declared and captured by default', () => {
    assert.ok((DEVICE_EVENT_TYPES as readonly string[]).includes('robot_founder'));
    assert.ok(DEFAULT_REVEAL_EVENT_TYPES.includes('robot_founder'));
    assert.ok(DEFAULT_REVEAL_EVENT_TYPES.includes('robot_perf'));
});

// ---------------------------------------------------------------- device tooling

const ev = (tMs: number, event: Record<string, unknown>): FounderRobotTimelineEvent => ({ tMs, event: { v: 1, seq: tMs, ...event } as FounderRobotTimelineEvent['event'] });
const founderEv = (tMs: number, owned: boolean, visible: number, ranks: number[], extra: Record<string, unknown> = {}) => ev(tMs, { evt: 'robot_founder', phase: 'changed', owned, visible, pooled: Math.max(0, visible - 1), founderRanks: ranks, ...extra });
const failing = (checks: ReturnType<typeof evaluateFounderRobot>) => checks.filter((c) => !c.ok).map((c) => c.id);

test('AUT-062 founderEventViolation enforces the slot rule per event', () => {
    const e = (owned: unknown, visible: unknown, ranks: unknown) => ({ v: 1, seq: 1, evt: 'robot_founder', owned, visible, founderRanks: ranks }) as never;
    assert.equal(founderEventViolation(e(false, 7, [])), null);
    assert.equal(founderEventViolation(e(true, 7, [0, 3])), null);
    assert.equal(founderEventViolation(e(true, 0, [0])), null);
    assert.equal(founderEventViolation(e(true, 1, [0])), null);
    assert.equal(founderEventViolation(e(true, 3, [0])), null);
    assert.match(String(founderEventViolation(e(false, 7, [0]))), /not owned/);
    assert.match(String(founderEventViolation(e(true, 7, [0, 3, 5]))), /max 2/);
    assert.match(String(founderEventViolation(e(true, 3, [0, 1, 2]))), /max 2|minority/);
    assert.match(String(founderEventViolation(e(true, 7, [3]))), /rank 0/);
    assert.match(String(founderEventViolation(e(true, 7, [0]))), /expects 2/);
    assert.match(String(founderEventViolation(e(true, 2, [0, 1]))), /expects 1/);
    assert.match(String(founderEventViolation(e(true, 7, [0, 0]))), /duplicate/);
    assert.match(String(founderEventViolation(e('yes', 7, [])), 'x'), /boolean/);
});

test('AUT-062 evaluateFounderRobot: not_owned / owned_many / owned_first / mid_session / reload pass on consistent timelines and fail on broken ones', () => {
    const notOwned = [founderEv(0, false, 7, [], { phase: 'synced' }), ev(10, { evt: 'robot_population', visible: 7 })];
    assert.deepEqual(failing(evaluateFounderRobot(notOwned, 'not_owned')), []);
    assert.ok(failing(evaluateFounderRobot([founderEv(0, true, 7, [0, 3])], 'not_owned')).includes('founder_not_owned_all_events'));

    const many = [founderEv(0, true, 7, [0, 3], { phase: 'synced', shellTinted: [3, 3], fallbackShell: false }), founderEv(2000, true, 7, [0, 3], { phase: 'sample', crest: [{ rank: 0, rect: { x: 1, y: 2, w: 30, h: 50 } }] })];
    const manyChecks = evaluateFounderRobot(many, 'owned_many');
    assert.deepEqual(failing(manyChecks), []);
    assert.match(manyChecks.find((c) => c.id === 'founder_crest_rect_info')!.detail, /30x50/);
    assert.ok(failing(evaluateFounderRobot([founderEv(0, true, 7, [0])], 'owned_many')).includes('founder_slot_rule_holds'));
    assert.ok(failing(evaluateFounderRobot([founderEv(0, true, 3, [0, 1, 2])], 'owned_many')).includes('founder_slot_rule_holds'), 'every robot a Founder is rejected');
    assert.ok(failing(evaluateFounderRobot([...many, ev(5, { evt: 'error', message: 'x' })], 'owned_many')).includes('founder_no_errors'));

    const first = [founderEv(0, true, 0, [0], { phase: 'synced' }), founderEv(5000, true, 1, [0])];
    assert.deepEqual(failing(evaluateFounderRobot(first, 'owned_first')), []);
    assert.ok(failing(evaluateFounderRobot([founderEv(0, true, 1, [0])], 'owned_first')).includes('founder_first_robot_owned_before_reveal'));

    const mid = [founderEv(0, false, 7, [], { phase: 'synced' }), ev(1000, { evt: 'command_result', ok: true, command: { type: 'grantFounderPack' } }), founderEv(1100, true, 7, [0, 3]), ev(5000, { evt: FOUNDER_SHOP_RELAUNCH_MARKER_EVT, phase: 'relaunch' }), founderEv(6000, true, 7, [0, 3], { phase: 'synced' })];
    assert.deepEqual(failing(evaluateFounderRobot(mid, 'mid_session')), []);
    assert.ok(failing(evaluateFounderRobot([mid[0], mid[2]], 'mid_session')).includes('founder_mid_session_after_grant_command'));
    assert.ok(failing(evaluateFounderRobot([mid[0], mid[1], mid[2], mid[3]], 'mid_session')).includes('founder_owned_after_relaunch'));

    const reload = [founderEv(0, true, 7, [0, 3], { phase: 'synced' }), ev(4000, { evt: FOUNDER_SHOP_RELAUNCH_MARKER_EVT, phase: 'relaunch' }), founderEv(6000, true, 7, [0, 3], { phase: 'synced' })];
    assert.deepEqual(failing(evaluateFounderRobot(reload, 'reload')), []);
    const drift = [reload[0], reload[1], founderEv(6000, true, 14, [0, 3], { phase: 'synced' })];
    assert.ok(failing(evaluateFounderRobot(drift, 'reload')).includes('founder_ranks_deterministic_across_relaunch'));
    // No owned -> not owned flip.
    assert.ok(failing(evaluateFounderRobot([founderEv(0, true, 7, [0, 3]), founderEv(1, false, 7, [])], 'owned_many')).includes('founder_owned_never_flips_back'));
});

test('AUT-062 perf events must stay inside the AUT-041 budget (and are not required)', () => {
    const base = [founderEv(0, true, 7, [0, 3])];
    const perf = (p95Ms: number, fps: number) => ev(10, { evt: 'robot_perf', visible: 7, p95Ms, fps });
    const find = (events: FounderRobotTimelineEvent[]) => evaluateFounderRobot(events, 'owned_many').find((c) => c.id === 'founder_perf_within_aut041_budget')!;
    assert.equal(find(base).ok, true);
    assert.equal(find([...base, perf(22.3, 56.5)]).ok, true);
    assert.equal(find([...base, perf(FOUNDER_PERF_P95_BUDGET_MS + 3, 56)]).ok, false);
    assert.equal(find([...base, perf(20, 40)]).ok, false);
});

test('AUT-062 seeds: not_owned has no cosmetic, owned variants grant it through the real purchase path, first-robot seed has no Worker Bot yet, mid_session scripts one completed purchase', () => {
    assert.deepEqual([...AUT062_SEED_VARIANTS], ['not_owned', 'owned_before_first_robot', 'owned_many_robots', 'mid_session']);
    assert.ok(AUT062_SEED_VARIANTS.every((variant) => isAut062SeedVariant(variant)));
    assert.equal(isAut062SeedVariant('nope'), false);
    assert.equal(isFounderRobotCosmeticOwned(buildAut062SeededState('not_owned', NOW_MS)), false);
    assert.equal(isFounderRobotCosmeticOwned(buildAut062SeededState('mid_session', NOW_MS)), false);
    const first = buildAut062SeededState('owned_before_first_robot', NOW_MS);
    assert.equal(isFounderRobotCosmeticOwned(first), true);
    assert.equal(first.run.purchasedBreakthroughIds.includes('worker_bot'), false, 'the first Worker Bot is still to be revealed');
    assert.equal(first.run.progressionFlags['first_robot'], undefined);
    const many = buildAut062SeededState('owned_many_robots', NOW_MS);
    assert.equal(isFounderRobotCosmeticOwned(many), true);
    assert.equal(many.run.purchasedBreakthroughIds.includes('worker_bot'), true);
    for (const variant of AUT062_SEED_VARIANTS) {
        const parsed = JSON.parse(buildAut062SeededSave(variant, NOW_MS));
        assert.ok(parsed, variant);
    }
    assert.equal(buildAut062PurchaseScriptFile('not_owned'), null);
    assert.equal(buildAut062PurchaseScriptFile('owned_many_robots'), null);
    assert.deepEqual(JSON.parse(buildAut062PurchaseScriptFile('mid_session')!).outcomes, ['completed']);
});

test('AUT-062 reveal scenarios are registered and wired through cli.ts and reveal_capture.ts into evaluateRevealTimeline', () => {
    const wanted: Record<string, string> = { 'aut062-not-owned': 'not_owned', 'aut062-owned-first': 'owned_first', 'aut062-owned-many': 'owned_many', 'aut062-mid-session': 'mid_session', 'aut062-reload': 'reload' };
    for (const [id, expectation] of Object.entries(wanted)) {
        const scenario = REVEAL_SCENARIOS[id];
        assert.ok(scenario, id);
        assert.equal(scenario.expectFounderRobot, expectation, id);
    }
    assert.equal(REVEAL_SCENARIOS['aut062-owned-first'].trigger, 'next-goal');
    assert.equal(REVEAL_SCENARIOS['aut062-mid-session'].expectFounderShop, 'purchase_success');
    const cli = read('tools/device/cli.ts');
    assert.match(cli, /expectFounderRobot: scenario\.expectFounderRobot/);
    assert.match(cli, /seed-aut062/);
    const capture = read('tools/device/reveal_capture.ts');
    assert.match(capture, /expectFounderRobot: options\.expectFounderRobot/);
    assert.match(capture, /evaluateFounderRobot\(events, options\.expectFounderRobot\)/);
    assert.match(read('package.json'), /"device:seed-aut062"/);
    // The evaluator really runs from the timeline entry point.
    const checks = evaluateRevealTimeline([founderEv(0, false, 7, [])], { expectConstruction: null, expectFocus: false, triggered: false, frameCount: 5, expectFounderRobot: 'not_owned' });
    assert.ok(checks.some((c) => c.id === 'founder_slot_rule_holds' && c.ok));
});
