import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadGameConfigFromSources } from '../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { bootstrapGameSession } from '../assets/scripts/lifecycle/index.ts';
import { getDefaultTextCatalogue } from '../assets/scripts/localization/index.ts';
import { EXTENDED_OVERCLOCK_CLAIM_KEY } from '../assets/scripts/monetization/RewardedEligibility.ts';
import { CURRENT_SAVE_VERSION, InMemorySaveStorage, SAVE_MAIN_NAME } from '../assets/scripts/persistence/index.ts';
import { EXTENDED_OVERCLOCK_DURATION_SECONDS } from '../assets/scripts/progression/index.ts';
import { GameRuntime } from '../assets/scripts/runtime/index.ts';
import { BoostPresentationModel } from '../assets/scripts/presentation/BoostPresentation.ts';
import { createExtendedOverclockChipViewModel } from '../assets/scripts/presentation/ExtendedOverclockViewModel.ts';
import type { ExtendedOverclockFlowState } from '../assets/scripts/presentation/ExtendedOverclockFlow.ts';
import * as X from '../assets/scripts/presentation/ExtendedOverclockLayout.ts';
import { createHudViewModel, resolveOverclockDisplayState } from '../assets/scripts/presentation/HudViewModel.ts';
import { formatHudTexts } from '../assets/scripts/presentation/PresentationText.ts';
import { computePermanentUpgradeRects } from '../assets/scripts/presentation/PermanentUpgradeLayout.ts';
import { computeMilestoneToastRect } from '../assets/scripts/presentation/MilestoneToastLayout.ts';
import { computeRebootRects } from '../assets/scripts/presentation/RebootLayout.ts';
import { computeSettingsRects } from '../assets/scripts/presentation/SettingsLayout.ts';
import { computeUiLayout, rectContains, rectsOverlap, type UiRect } from '../assets/scripts/presentation/UiLayout.ts';
import { ManualTimeService } from '../assets/scripts/time/index.ts';
import { evaluateExtendedOverclock } from '../tools/device/extended_overclock_checks.ts';
import { AUT056_SEED_VARIANTS, buildAut056AdsScriptFile, buildAut056SeededSave, buildAut056SeededState } from '../tools/device/seed_aut056.ts';
import { REVEAL_SCENARIOS } from '../tools/device/reveal_capture.ts';
import { buildAut047SeededState } from '../tools/device/seed_aut047.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const repo = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
const NOW_MS = Date.parse('2026-11-14T12:00:00.000Z');
const KEY = EXTENDED_OVERCLOCK_CLAIM_KEY;

const SCREENS = [
    { name: '720x1280', w: 720, h: 1280, safe: null },
    { name: '1080x1920', w: 1080, h: 1920, safe: null },
    { name: '1080x2412', w: 1080, h: 2412, safe: null },
    { name: '1272x2772', w: 1272, h: 2772, safe: null },
    { name: '1080x2412 top inset 130', w: 1080, h: 2412, safe: { x: 0, y: 0, w: 1080, h: 2412 - 130 } },
    { name: '1080x2412 symmetric inset 130', w: 1080, h: 2412, safe: { x: 0, y: 130, w: 1080, h: 2412 - 260 } },
];

for (const screen of SCREENS) {
    test(`AUT-056 layout ${screen.name}: chip >= 64 units, inside the safe area, below the Settings chip, clear of every other rect`, () => {
        const screenPx = { w: screen.w, h: screen.h };
        const safe: UiRect = screen.safe ?? { x: 0, y: 0, w: screen.w, h: screen.h };
        const chip = X.computeExtendedOverclockChipRect(screenPx, screen.safe ?? undefined);
        const base = computeUiLayout(screenPx, screen.safe ?? undefined);
        const settings = computeSettingsRects(screenPx, screen.safe ?? undefined);
        const ai = computePermanentUpgradeRects(screenPx, screen.safe ?? undefined);
        const reboot = computeRebootRects(screenPx, screen.safe ?? undefined);
        const scale = screen.w / 720;
        assert.ok(chip.h / scale >= 64 - 1e-9 && chip.w / scale >= 64);
        assert.ok(rectContains(safe, chip, 1e-6), 'inside the safe area');
        assert.ok(rectContains(base.factoryBand, chip, 1e-6), 'inside the factory band (no added HUD height)');
        assert.ok(Math.abs(chip.x - (safe.x + 16 * scale)) < 1e-6, 'left-aligned at the edge margin');
        assert.ok(Math.abs((settings.chip.y - 8 * scale) - (chip.y + chip.h)) < 1e-6, 'directly under the Settings chip');
        const others = [base.hud, base.panel, settings.chip, ai.chip, reboot.chip,
            ...Object.values(base.hudButtons), ...Object.values(base.buttons), ...Object.values(base.rows.hud), ...Object.values(base.rows.panel),
            computeMilestoneToastRect(screenPx, screen.safe ?? undefined, 'minor')];
        for (const rect of others) assert.equal(rectsOverlap(chip, rect), false);
    });
}

test('AUT-056 layout: label and tag fit inside the chip, fonts stay readable, outline is two fillRects of the chip size', () => {
    const layout = X.resolveExtendedOverclockChipLayout();
    for (const slot of [layout.label, layout.tag]) {
        assert.ok(Math.abs(slot.x) + slot.w / 2 <= X.EXTENDED_OVERCLOCK_CHIP_WIDTH / 2);
        assert.ok(Math.abs(slot.y) + slot.h / 2 <= X.EXTENDED_OVERCLOCK_CHIP_HEIGHT / 2);
    }
    assert.ok(layout.label.y - layout.label.h / 2 >= layout.tag.y + layout.tag.h / 2, 'two lines do not overlap');
    assert.ok(X.EXTENDED_OVERCLOCK_TAG_FONT_SIZE >= X.EXTENDED_OVERCLOCK_MIN_FONT_SIZE && X.EXTENDED_OVERCLOCK_LABEL_FONT_SIZE >= X.EXTENDED_OVERCLOCK_MIN_FONT_SIZE);
    const o = X.extendedOverclockOutlineRects();
    assert.deepEqual([o.outer.w, o.outer.h], [340, 64]);
    assert.deepEqual([o.inner.w, o.inner.h], [336, 60]);
});

const flowState = (patch: Partial<ExtendedOverclockFlowState>): ExtendedOverclockFlowState => ({ offer: true, blockedBy: null, inFlight: false, eligibility: null, adAvailable: true, ...patch });

test('AUT-056 view model: visible only when offered, dimmed and inert while the ad is in flight, note replaces the tag only while shown', () => {
    const catalogue = getDefaultTextCatalogue();
    const shown = createExtendedOverclockChipViewModel(flowState({}), false, catalogue);
    assert.deepEqual([shown.visible, shown.interactable, shown.alpha, shown.label, shown.tag], [true, true, 255, 'Extended Overclock 10 min', 'Rewarded Ad']);
    const hidden = createExtendedOverclockChipViewModel(flowState({ offer: false, blockedBy: 'player' }), true, catalogue);
    assert.deepEqual([hidden.visible, hidden.interactable, hidden.noteShown], [false, false, false]);
    assert.equal(createExtendedOverclockChipViewModel(null, false, catalogue).visible, false);
    const busy = createExtendedOverclockChipViewModel(flowState({ inFlight: true }), true, catalogue);
    assert.deepEqual([busy.visible, busy.interactable, busy.alpha, busy.noteShown, busy.tag], [true, false, X.EXTENDED_OVERCLOCK_DIMMED_ALPHA, false, 'Rewarded Ad']);
    const note = createExtendedOverclockChipViewModel(flowState({}), true, catalogue);
    assert.deepEqual([note.noteShown, note.tag], [true, 'No bonus this time.']);
});

test('AUT-056 text: the "10 min" label equals the duration; every key exists and is in the embedded catalogue', () => {
    assert.equal(EXTENDED_OVERCLOCK_DURATION_SECONDS / 60, 10);
    const en = JSON.parse(read('localization/en.json')) as Record<string, unknown>;
    const entries = (en.entries ?? en) as Record<string, string>;
    const catalogue = getDefaultTextCatalogue();
    for (const key of ['hud.extended_overclock.active', 'hud.extended_overclock.timer', 'extended_overclock.button', 'extended_overclock.tag', 'extended_overclock.not_granted']) {
        assert.ok(key in entries, key);
        assert.ok(catalogue.resolveText(key, { multiplier: 2, time: '9:59' }).length > 0, key);
    }
    assert.match(catalogue.resolveText('extended_overclock.button'), /10 min/);
});

function runtimeWith(extended: boolean, free: boolean): GameRuntime {
    const runtime = new GameRuntime(repo, buildAut047SeededState('ready'));
    if (free) assert.equal(runtime.execute({ type: 'activateFreeOverclock' }).ok, true);
    if (extended) assert.equal(runtime.execute({ type: 'activateExtendedOverclock', requestId: 'r', claimedAtUtcMs: NOW_MS }).ok, true);
    return runtime;
}

test('AUT-056 HUD view model: Extended reports active with an m:ss timer, the pill shows active, Free cannot be activated meanwhile', () => {
    const none = createHudViewModel(repo, runtimeWith(false, false).getStateSnapshot());
    assert.equal(none.extendedOverclock.active, false);
    assert.equal(none.freeOverclock.canActivate, true);
    const ext = createHudViewModel(repo, runtimeWith(true, false).getStateSnapshot());
    assert.deepEqual([ext.extendedOverclock.active, ext.extendedOverclock.multiplier, ext.extendedOverclock.remainingSeconds, ext.extendedOverclock.remainingFormatted], [true, 2, 600, '10:00']);
    assert.equal(ext.freeOverclock.canActivate, false);
    assert.equal(resolveOverclockDisplayState(ext), 'active');
    const both = createHudViewModel(repo, runtimeWith(true, true).getStateSnapshot());
    assert.equal(both.freeOverclock.state, 'suspended');
    assert.equal(resolveOverclockDisplayState(both), 'active');
    assert.equal(resolveOverclockDisplayState(none), none.freeOverclock.state);
    const texts = formatHudTexts(ext, null, getDefaultTextCatalogue());
    assert.match(JSON.stringify(texts), /Extended Overclock/);
    assert.match(JSON.stringify(texts), /10:00/);
});

test('AUT-056 boost presentation: impulse on Extended activation (also over an active Free), silent on load and on a Free resume', () => {
    // Over a suspended-free state: Extended activation reports 'active' with an impulse.
    const runtime = runtimeWith(false, true);
    const model = new BoostPresentationModel();
    model.syncFromState(runtime.getStateSnapshot());
    assert.equal(model.getMode(), 'active');
    const result = runtime.execute({ type: 'activateExtendedOverclock', requestId: 'r', claimedAtUtcMs: NOW_MS });
    const started = model.consumeEvents(runtime.getStateSnapshot(), result.events);
    assert.ok(started);
    assert.deepEqual([started.phase, started.impulse, started.mode, started.multiplier], ['started', true, 'active', 2]);
    // Load with Extended already active: silent.
    const loaded = new BoostPresentationModel().syncFromState(runtime.getStateSnapshot());
    assert.equal(loaded.impulse, false);
    // Extended expires: Free resumes, which is a silent state change (no impulse, no transition while still active).
    const expiry = runtime.execute({ type: 'advanceAutomation', elapsedSeconds: 601 });
    const after = model.consumeEvents(runtime.getStateSnapshot(), expiry.events);
    assert.ok(after === null || after.impulse === false);
});

test('AUT-056 controller source: fillRect only (no stroke), scale visibility (no node.active), Button on the chip, no state write', () => {
    const c = code('assets/scripts/presentation/ExtendedOverclockController.ts');
    assert.doesNotMatch(c, /\.stroke\(/);
    assert.match(c, /fillRect/);
    assert.doesNotMatch(c, /\.active\s*=/);
    assert.match(c, /setScale\(/);
    assert.doesNotMatch(c, /addComponent\(Sprite\)/);
    assert.match(c, /overflow = Label\.Overflow\.SHRINK/);
    assert.match(c, /lineHeight =/);
    assert.match(c, /chip\.addComponent\(Button\)/);
    assert.match(c, /UiRect/);
    const boot = code('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(boot, /ExtendedOverclockAction/);
});

async function sessionFor(variant: (typeof AUT056_SEED_VARIANTS)[number]) {
    const storage = new InMemorySaveStorage({ [SAVE_MAIN_NAME]: buildAut056SeededSave(variant, NOW_MS) });
    const clock = new ManualTimeService({ utcIso: new Date(NOW_MS).toISOString(), monotonicSeconds: 0 });
    const boot = await bootstrapGameSession({ storage, timeService: clock });
    if (!boot.startup.ok) throw new Error('startup failed');
    return boot.startup.session;
}

test('AUT-056 seeds: every variant loads at the current save version and produces the intended offer', async () => {
    const expected: Record<string, { eligible: boolean; reason?: string; blocked: boolean }> = {
        eligible: { eligible: true, blocked: false },
        free_active: { eligible: true, blocked: false },
        quota: { eligible: false, reason: 'quota_reached', blocked: false },
        interval: { eligible: false, reason: 'min_interval', blocked: false },
        resume: { eligible: false, reason: 'min_interval', blocked: true },
    };
    for (const variant of AUT056_SEED_VARIANTS) {
        assert.equal(JSON.parse(buildAut056SeededSave(variant, NOW_MS)).saveVersion ?? CURRENT_SAVE_VERSION, CURRENT_SAVE_VERSION);
        const session = await sessionFor(variant);
        const offer = session.getExtendedOverclockOffer();
        assert.equal(offer.eligibility.eligible, expected[variant].eligible, variant);
        if (expected[variant].reason) assert.equal(offer.eligibility.reason, expected[variant].reason, variant);
        // The 1 s old seed leaves a sub-minute offline preview pending (documented); only the resume seed is blocked by the boost itself.
        if (expected[variant].blocked) assert.equal(offer.activeBlocked, true, variant);
        else assert.ok(offer.blockedReason === null || offer.blockedReason === 'offline_pending', variant);
    }
    const free = buildAut056SeededState('free_active', NOW_MS).boosts.activeBoosts['free_overclock'];
    assert.ok(free && !free.isSuspended);
    const resume = buildAut056SeededState('resume', NOW_MS).boosts.activeBoosts;
    assert.equal(resume['extended_overclock']?.remainingSeconds, 15);
    assert.equal(resume['free_overclock']?.isSuspended, true);
});

test('AUT-056 tooling: ads script file, package script, CLI command and scenario definitions', () => {
    assert.deepEqual(JSON.parse(buildAut056AdsScriptFile('closed')), { extendedOverclock: ['closed'] });
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    assert.match(pkg.scripts['device:seed-aut056'], /seed-aut056/);
    assert.match(read('tools/device/cli.ts'), /seed-aut056/);
    const ids = ['aut056-success', 'aut056-free-active', 'aut056-resume', 'aut056-closed', 'aut056-failed', 'aut056-quota', 'aut056-interval'];
    for (const id of ids) {
        const scenario = (REVEAL_SCENARIOS as Record<string, { id: string; expectExtendedOverclock?: string }>)[id];
        assert.ok(scenario, id);
        assert.ok(scenario.expectExtendedOverclock, id);
    }
    assert.ok((REVEAL_SCENARIOS as Record<string, { durationMs: number }>)['aut056-resume'].durationMs >= 70_000);
});

test('AUT-056 checks: an empty timeline never passes a success expectation; a quota timeline passes only with the right offer and no chip', () => {
    const empty = evaluateExtendedOverclock([], 'success');
    assert.ok(empty.some((c) => !c.ok));
    const ev = (e: Record<string, unknown>, tMs = 0) => ({ tMs, event: { ...e } as never });
    const good = [ev({ evt: 'extended_overclock', phase: 'offer', eligible: false, reason: 'quota_reached', blockedBy: 'player' })];
    assert.ok(evaluateExtendedOverclock(good, 'quota').every((c) => c.ok));
    const wrongReason = [ev({ evt: 'extended_overclock', phase: 'offer', eligible: false, reason: 'min_interval', blockedBy: 'player' })];
    assert.ok(evaluateExtendedOverclock(wrongReason, 'quota').some((c) => !c.ok));
    const withAd = [...good, ev({ evt: 'extended_overclock', phase: 'ad_started' })];
    assert.ok(evaluateExtendedOverclock(withAd, 'quota').some((c) => !c.ok));
    const withError = [...good, ev({ evt: 'error' })];
    assert.ok(evaluateExtendedOverclock(withError, 'quota').some((c) => !c.ok));
});

test('AUT-056 layering and script meta: new presentation files are cc-free where pure, and every new .ts has a unique .meta', () => {
    for (const f of ['ExtendedOverclockFlow', 'ExtendedOverclockLayout', 'ExtendedOverclockViewModel']) {
        assert.doesNotMatch(read(`assets/scripts/presentation/${f}.ts`), /from\s+['"]cc['"]/, f);
    }
    const uuids = new Set<string>();
    for (const f of ['ExtendedOverclockFlow', 'ExtendedOverclockLayout', 'ExtendedOverclockViewModel', 'ExtendedOverclockController']) {
        const meta = JSON.parse(read(`assets/scripts/presentation/${f}.ts.meta`)) as { uuid: string };
        assert.ok(meta.uuid && !uuids.has(meta.uuid));
        uuids.add(meta.uuid);
    }
    for (const f of ['seed_aut056', 'extended_overclock_checks']) assert.ok(read(`tools/device/${f}.ts`).length > 0);
    assert.equal(KEY, 'rewarded.extended_overclock');
});
