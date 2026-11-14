import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadGameConfigFromSources } from '../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { GameRuntime } from '../assets/scripts/runtime/GameRuntime.ts';
import { createFreshGameState } from '../assets/scripts/state/index.ts';
import { createHudViewModel, type HudViewModel } from '../assets/scripts/presentation/HudViewModel.ts';
import { resolveOverclockAction } from '../assets/scripts/presentation/CoreLoopActions.ts';
import { formatFreeOverclockState, formatFreeOverclockTimer, formatHudTexts } from '../assets/scripts/presentation/PresentationText.ts';
import { BOOST_HUD_AMBER, BOOST_HUD_DISABLED_TEXT, resolveBoostHudPill, resolveOverclockRowText } from '../assets/scripts/presentation/BoostHudPill.ts';
import * as L from '../assets/scripts/presentation/UiLayout.ts';
import { buildUi003SeededSave, buildUi003SeededState } from '../tools/device/seed_ui003.ts';
import { deserializeGameStateFromSaveJson } from '../assets/scripts/persistence/index.ts';
import { REVEAL_SCENARIOS, evaluateRevealTimeline, type TimelineEvent } from '../tools/device/reveal_capture.ts';
import { parseHudActions } from '../tools/device/scenarios/ui001_core_loop.ts';

/*
 * AUT-UI-003 Free Overclock HUD action: the two Overclock rows are the Button. Mapping state -> action, controller wiring,
 * layout (rect = the two rows, touch target, no overlap, every reference screen), text reuse, device seed / scenario / checks.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), 'utf8');
const repository = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());

function methodBody(source: string, signature: string): string {
    const start = source.indexOf(signature);
    assert.ok(start >= 0, `${signature} not found`);
    const open = source.indexOf('{', start + signature.length - 1);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(open + 1, i); }
    }
    throw new Error(`unterminated ${signature}`);
}

/** HUD view models for locked / ready / active / cooldown / suspended through a real runtime. */
function stateModels(): Record<'locked' | 'ready' | 'active' | 'cooldown' | 'suspended', HudViewModel> {
    const hud = (runtime: GameRuntime) => createHudViewModel(repository, runtime.getStateSnapshot());
    const runtime = new GameRuntime(repository, buildUi003SeededState());
    const ready = hud(runtime);
    assert.equal(runtime.execute({ type: 'activateFreeOverclock' }).ok, true);
    const active = hud(runtime);
    runtime.execute({ type: 'advanceAutomation', elapsedSeconds: 61 });
    const cooldown = hud(runtime);
    const locked = createHudViewModel(repository, createFreshGameState());
    const suspendedState = buildUi003SeededState();
    suspendedState.boosts.activeBoosts.free_overclock = { boostId: 'free_overclock', remainingSeconds: 30, cooldownSeconds: 240, source: 'free', requestId: null, effect: { type: 'productionMultiplier', multiplier: 2 }, isSuspended: true, suspendedByBoostId: 'other' };
    const suspended = createHudViewModel(repository, suspendedState);
    return { locked, ready, active, cooldown, suspended };
}

test('AUT-UI-003 mapping: enabled only when ready; locked / active / cooldown / suspended are visible-disabled; ready -> active -> cooldown -> ready', () => {
    const models = stateModels();
    assert.deepEqual(Object.fromEntries(Object.entries(models).map(([k, m]) => [k, m.freeOverclock.state])), { locked: 'locked', ready: 'ready', active: 'active', cooldown: 'cooldown', suspended: 'suspended' });
    assert.deepEqual({ ...resolveOverclockAction(models.ready.freeOverclock) }, { visible: true, enabled: true, command: { type: 'activateFreeOverclock' } });
    for (const key of ['locked', 'active', 'cooldown', 'suspended'] as const) {
        assert.deepEqual({ ...resolveOverclockAction(models[key].freeOverclock) }, { visible: true, enabled: false, command: null }, key);
    }
    assert.equal(resolveOverclockAction(null).enabled, false);
    assert.equal(resolveOverclockAction(undefined).enabled, false);

    // Texts are the existing hud.free_overclock.* strings: countdown while active, cooldown seconds while cooling down.
    assert.equal(formatFreeOverclockState('ready', 2), 'Activate Overclock');
    assert.equal(formatFreeOverclockState('active', 2), 'Free Overclock: ×2');
    assert.equal(formatFreeOverclockTimer(models.active.freeOverclock.remainingSeconds), '60s');
    assert.equal(formatFreeOverclockState('cooldown', 2), 'Free Overclock: Cooldown');
    assert.ok(models.cooldown.freeOverclock.remainingSeconds > 0 && models.cooldown.freeOverclock.remainingSeconds < 240);

    // Full cycle through the real runtime: ready again after the cooldown ends, then enabled again.
    const runtime = new GameRuntime(repository, buildUi003SeededState());
    runtime.execute({ type: 'activateFreeOverclock' });
    runtime.execute({ type: 'advanceAutomation', elapsedSeconds: 61 });
    assert.equal(resolveOverclockAction(createHudViewModel(repository, runtime.getStateSnapshot()).freeOverclock).enabled, false);
    runtime.execute({ type: 'advanceAutomation', elapsedSeconds: 240 });
    assert.equal(resolveOverclockAction(createHudViewModel(repository, runtime.getStateSnapshot()).freeOverclock).enabled, true, 're-enabled after the cooldown');
});

test('AUT-UI-003 ready outline pill (no fill), locked / cooldown dimmed without a pill, active / suspended keep the AUT-047 pill; ready timer line is empty', () => {
    const ready = resolveBoostHudPill('ready');
    assert.deepEqual([ready.visible, ready.fill, ready.outline], [true, null, BOOST_HUD_AMBER]);
    assert.notDeepEqual(ready.key, resolveBoostHudPill('active').key);
    for (const dim of ['locked', 'cooldown'] as const) { const p = resolveBoostHudPill(dim); assert.deepEqual([p.visible, p.fill, p.outline], [false, null, null], dim); }
    assert.equal(resolveOverclockRowText('ready'), null);
    const models = stateModels();
    assert.equal(formatHudTexts(models.ready, null).freeOverclockTimer, '', 'no 0s under Ready');
    assert.equal(formatHudTexts(models.ready, null).freeOverclock, 'Activate Overclock');
    assert.equal(formatHudTexts(models.active, null).freeOverclockTimer, '60s');
    assert.match(formatHudTexts(models.cooldown, null).freeOverclockTimer, /^[0-9]+s$/);
    assert.deepEqual(resolveOverclockRowText('locked'), BOOST_HUD_DISABLED_TEXT);
    assert.deepEqual(resolveOverclockRowText('cooldown'), BOOST_HUD_DISABLED_TEXT);
    assert.equal(resolveOverclockRowText('active'), null);
    assert.equal(resolveOverclockRowText('suspended'), null);
});

test('AUT-UI-003 controller: the tap re-checks the latest snapshot and emits only the existing command through commandEmitter', () => {
    const source = read('assets/scripts/presentation/CoreHudController.ts');
    const emitted: unknown[] = [];
    const models = stateModels();
    const activate = new Function(`return function () {${methodBody(source, 'public activateFreeOverclock(): void {')}};`)() as () => void;
    const host: Record<string, unknown> = { latest: null, commandEmitter: (c: unknown) => emitted.push(c) };
    const pressed = new Function(`return function (_event, actionId) {${methodBody(source, 'public onActionPressed(_event: unknown, actionId: string): void {')}};`)() as (this: unknown, e: unknown, id: string) => void;
    host.activateFreeOverclock = () => activate.call(host);
    host.manualProduce = () => undefined;
    host.purchaseNextGoal = () => undefined;
    const tap = () => pressed.call(host, { type: 'click' }, 'OverclockAction');

    tap();
    assert.equal(emitted.length, 0, 'inert before the first snapshot');
    for (const key of ['locked', 'active', 'cooldown', 'suspended'] as const) { host.latest = models[key]; tap(); }
    assert.equal(emitted.length, 0, 'nothing while disabled');
    host.latest = models.ready;
    tap();
    assert.deepEqual(emitted.map((c) => ({ ...(c as object) })), [{ type: 'activateFreeOverclock' }]);
    host.latest = models.active; // the snapshot moved on: a second tap is dropped
    tap();
    host.latest = models.ready;
    host.commandEmitter = null;
    tap();
    assert.equal(emitted.length, 1, 'inert until the session wires commandEmitter');

    assert.match(source, /resolveOverclockAction\(this\.latest\?\.freeOverclock\)/);
    assert.match(source, /OverclockAction: null/, 'the Overclock Button has no label of its own (the rows are the control)');
    // AUT-056: while Extended Overclock is active the rows / pill show its ACTIVE look (the display state resolver decides).
    assert.match(source, /const overclockState = resolveOverclockDisplayState\(viewModel\);/);
    assert.match(source, /this\.applyOverclockRowText\(overclockState\);/);
    assert.match(methodBody(source, 'private applyActionStates(): void {'), /button\.interactable = states\[key\]\.visible && states\[key\]\.enabled;/);
});

test('AUT-UI-003 layout: OverclockAction is exactly the two Overclock rows, a full-width HUD Button of at least the panel Button height', () => {
    assert.deepEqual([...L.HUD_ACTION_KEYS], ['ManualProduceAction', 'NextGoalAction', 'OverclockAction']);
    const card = L.CORE_HUD_LAYOUT;
    assert.equal(L.hudActionCard('OverclockAction'), card);
    const first = card.rows.findIndex((row) => row.key === 'FreeOverclockValue');
    assert.deepEqual(card.rowActions, [{ key: 'OverclockAction', firstRow: first, lastRow: first + 1 }]);
    assert.equal(card.rows[first + 1].key, 'FreeOverclockTimer');
    const rect = L.cardActionRect(card, 'OverclockAction');
    assert.equal(rect.h, card.rows[first].height + card.rows[first + 1].height);
    assert.equal(rect.w, L.cardRowWidth(card));
    assert.ok(rect.h >= L.PRODUCER_PANEL_LAYOUT.actionRow!.height, 'touch target at least as tall as the panel Buttons');
    assert.ok(rect.h * 1.5 >= 90, 'at least 90 px tall at 1080 px wide');
    assert.equal(rect.y, (L.cardRowCenterY(card, first) + L.cardRowCenterY(card, first + 1)) / 2);
    assert.equal(L.cardActionFontSize(card, 'OverclockAction'), card.rows[first].fontSize);
    assert.ok(card.rows[first].fontSize >= L.UI_MIN_BODY_FONT_SIZE);
    assert.equal(card.actionRow!.actions.some((a) => a.key === 'OverclockAction'), false, 'it adds no action-row slot');
});

for (const screen of [
    { name: '720x1280', w: 720, h: 1280, safe: undefined },
    { name: '1080x1920', w: 1080, h: 1920, safe: undefined },
    { name: '1080x2412', w: 1080, h: 2412, safe: undefined },
    { name: '1272x2772', w: 1272, h: 2772, safe: undefined },
    { name: '1080x2412 top inset 130', w: 1080, h: 2412, safe: { x: 0, y: 0, w: 1080, h: 2412 - 130 } },
    { name: '1080x2412 symmetric inset 130', w: 1080, h: 2412, safe: { x: 0, y: 130, w: 1080, h: 2412 - 260 } },
]) {
    test(`AUT-UI-003 layout ${screen.name}: the Overclock Button covers its two rows, sits inside the HUD / safe area and overlaps no other row, action or the panel`, () => {
        const layout = L.computeUiLayout({ w: screen.w, h: screen.h }, screen.safe);
        const rect = layout.hudButtons.OverclockAction;
        const shrink = (r: L.UiRect): L.UiRect => ({ x: r.x + 1e-6, y: r.y + 1e-6, w: r.w - 2e-6, h: r.h - 2e-6 });
        assert.ok(L.rectContains(layout.hud, rect, 1) && L.rectContains(layout.safeArea, rect, 1) && L.rectContains(layout.screen, rect, 1));
        const rowA = layout.rows.hud.FreeOverclockValue;
        const rowB = layout.rows.hud.FreeOverclockTimer;
        assert.ok(Math.abs(rect.x - rowA.x) < 1e-6 && Math.abs(rect.w - rowA.w) < 1e-6);
        assert.ok(Math.abs(rect.y - Math.min(rowA.y, rowB.y)) < 1e-6 && Math.abs(rect.h - (rowA.h + rowB.h)) < 1e-6, 'exactly the two rows');
        for (const [key, row] of Object.entries(layout.rows.hud)) {
            if (key === 'FreeOverclockValue' || key === 'FreeOverclockTimer') continue;
            assert.equal(L.rectsOverlap(shrink(rect), row), false, `${key} overlaps the Overclock Button`);
        }
        assert.equal(L.rectsOverlap(shrink(rect), layout.hudButtons.NextGoalAction), false);
        assert.equal(L.rectsOverlap(rect, layout.hudButtons.ManualProduceAction), false);
        assert.equal(L.rectsOverlap(rect, layout.panel), false);
        for (const button of Object.values(layout.buttons)) assert.equal(L.rectsOverlap(rect, button), false);
        // Touch target: at least 90 px tall at 1080 px wide (60 design units) at this screen's scale.
        assert.ok(rect.h >= 60 * layout.scale - 1e-6);
    });
}

test('AUT-UI-003 Overclock captions (every state) fit the full row width at the nominal font size', async () => {
    const { getDefaultTextCatalogue } = await import('../assets/scripts/localization/index.ts');
    const c = getDefaultTextCatalogue();
    const width = L.cardRowWidth(L.CORE_HUD_LAYOUT);
    const size = L.cardActionFontSize(L.CORE_HUD_LAYOUT, 'OverclockAction');
    for (const state of ['locked', 'ready', 'active', 'cooldown', 'suspended']) {
        const text = c.resolveText(`hud.free_overclock.${state}`, { multiplier: 2 });
        assert.doesNotMatch(text, /\{|\bhud\./);
        assert.ok([...text].length * 0.48 * size <= width, text);
    }
});

test('AUT-UI-003 seed: Free Overclock READY from the existing unlock rule, round-trips through the save', () => {
    const state = buildUi003SeededState();
    const hud = createHudViewModel(repository, state);
    assert.deepEqual([hud.freeOverclock.state, hud.freeOverclock.canActivate], ['ready', true]);
    assert.equal(state.boosts.activeBoosts.free_overclock, undefined);
    assert.equal(state.boosts.cooldowns.free_overclock, undefined);
    const loaded = deserializeGameStateFromSaveJson(buildUi003SeededSave(Date.UTC(2026, 10, 13, 12, 0, 0)), repository.contentVersion);
    assert.equal(createHudViewModel(repository, loaded.state).freeOverclock.canActivate, true);
});

test('AUT-UI-003 device tooling: ui003 scenario, overclock trigger, seed command, command_result + boost checks, rect parsing', () => {
    const scenario = REVEAL_SCENARIOS.ui003;
    assert.deepEqual([scenario.id, scenario.label, scenario.expectConstruction, scenario.expectFocus, scenario.trigger], ['ui003', 'ui003-overclock-action', null, false, 'overclock']);
    assert.ok(scenario.durationMs! >= 20_000, 'the capture shows the active countdown');
    assert.ok(scenario.expectBoostPhases!.includes('started'));
    assert.deepEqual(scenario.expectCommands, ['activateFreeOverclock']);

    const pkg = JSON.parse(read('package.json'));
    assert.match(pkg.scripts['device:seed-ui003'], /tools\/device\/cli\.ts seed-ui003$/);
    const cli = read('tools/device/cli.ts');
    assert.match(cli, /command === 'seed-ui003'/);
    assert.match(cli, /seed-ui003 \[--serial <id>\]/);
    assert.match(cli, /aut046\|aut047\|ui003\|aut048\|aut048-era3\|aut048-era3-live\|aut049\|aut049-post\|aut050\|aut051\|aut051-reload\|aut051-short\|aut052\|rbt001\|aut055-success\|aut055-closed\|aut055-failed\|aut055-ineligible\|aut056-success\|aut056-free-active\|aut056-resume\|aut056-closed\|aut056-failed\|aut056-quota\|aut056-interval\]/);
    assert.match(cli, /--trigger next-goal\|overclock\|robot-line-build\|none/);
    assert.match(cli, /expectCommands: scenario\.expectCommands/);
    const capture = read('tools/device/reveal_capture.ts');
    assert.match(capture, /trigger === 'overclock' \? 'OverclockAction'/);
    assert.match(capture, /export type RevealTrigger = 'none' \| 'next-goal' \| 'overclock' \| 'robot-line-build' \| 'offline-collect';/);

    const event = (tMs: number, evt: string, extra: Record<string, unknown>): TimelineEvent => ({ tMs, event: { v: 1, seq: tMs, evt, ...extra } as TimelineEvent['event'] });
    const chain = [
        event(50, 'command_result', { command: { type: 'activateFreeOverclock' }, ok: true, reason: null, eventTypes: ['temporaryBoostActivated'], industrialOutput: null }),
        event(80, 'boost_presentation', { phase: 'started', mode: 'active' }),
        event(500, 'boost_presentation', { phase: 'effect_applied', timeScale: 1.3, anchorResolved: true }),
    ];
    const options = { expectConstruction: null, expectFocus: false, triggered: true, frameCount: 20, expectBoostPhases: scenario.expectBoostPhases, expectCommands: scenario.expectCommands };
    assert.ok(evaluateRevealTimeline(chain, options).every((check) => check.ok));
    const rejected = [event(50, 'command_result', { command: { type: 'activateFreeOverclock' }, ok: false, reason: 'boost_on_cooldown', eventTypes: [] }), ...chain.slice(1)];
    assert.deepEqual(evaluateRevealTimeline(rejected, options).filter((check) => !check.ok).map((check) => check.id), ['command_activateFreeOverclock_ok']);
    assert.deepEqual(evaluateRevealTimeline(chain.slice(0, 1), options).filter((check) => !check.ok).map((check) => check.id), ['boost_started', 'boost_effect_applied']);

    const layout = L.computeUiLayout({ w: 1080, h: 2412 });
    const parsed = parseHudActions({ v: 1, seq: 1, evt: 'ui_layout', rects: { OverclockAction: layout.hudButtons.OverclockAction }, hudActions: { OverclockAction: { visible: true, enabled: true } } } as never);
    assert.deepEqual(parsed.rects.OverclockAction, layout.hudButtons.OverclockAction);
    assert.deepEqual(parsed.states.OverclockAction, { visible: true, enabled: true });
});

test('AUT-UI-003 pill is inset from the Button rect (no contact with the row above) and the READY line is centred', () => {
    const hud = readFileSync(path.join(repoRoot, 'assets/scripts/presentation/CoreHudController.ts'), 'utf8');
    assert.match(hud, /const PILL_INSET = 3;/);
    assert.ok(hud.includes("bottom + PILL_INSET, width, top - bottom - (PILL_INSET * 2)"));
    assert.ok(hud.includes("state === \"ready\" ? cardActionRect(layout, \"OverclockAction\").y".replace(/\"/g, String.fromCharCode(39))));
});
