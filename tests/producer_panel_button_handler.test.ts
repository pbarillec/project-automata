const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// AUT-UI-001 retry 1: regression for the pre-existing AUT-037 panel Button handler defect. Cocos calls
// EventHandler handlers as handler(clickEvent, customEventData) (ComponentEventHandler.emit), so the
// action id is the SECOND argument.
const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const read = (rel) => readFile(path.join(repoRoot, rel), 'utf8');
const PANEL = 'assets/scripts/presentation/ProducerPanelController.ts';
const HUD = 'assets/scripts/presentation/CoreHudController.ts';
const HANDLER_SIGNATURE = 'public onActionPressed(_event: unknown, actionId: string): void {';

function methodBody(source, signature) {
    const start = source.indexOf(signature);
    assert.ok(start >= 0, `${signature} not found`);
    const open = source.indexOf('{', start + signature.length - 1);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(open + 1, i);
        }
    }
    throw new Error(`unterminated ${signature}`);
}

/** The real panel onActionPressed + purchase bodies (plain JS) on a fake host, invoked the way Cocos does. */
async function panelHarness() {
    const source = await read(PANEL);
    const pressed = new Function(`return function (_event, actionId) {${methodBody(source, HANDLER_SIGNATURE)}};`)();
    const purchase = new Function(`return function (id) {${methodBody(source, 'public purchase(id: ProducerPanelActionId): void {')}};`)();
    const emitted = [];
    const host = { latest: null, commandEmitter: (command) => emitted.push(command) };
    host.purchase = (id) => purchase.call(host, id);
    const click = (customEventData) => pressed.apply(host, [{ type: 'click' }, customEventData]);
    return { host, emitted, click };
}

async function panelModel(output) {
    const { loadGameConfigFromSources } = await imp('assets/scripts/config/ConfigLoader.ts');
    const { getEmbeddedEconomyConfigSources } = await imp('assets/scripts/config/EmbeddedEconomyConfig.ts');
    const { createFreshGameState } = await imp('assets/scripts/state/index.ts');
    const { createProducerPanelViewModel } = await imp('assets/scripts/presentation/ProducerPanelViewModel.ts');
    const state = createFreshGameState();
    state.run.industrialOutput = output;
    return createProducerPanelViewModel(loadGameConfigFromSources(getEmbeddedEconomyConfigSources()), state, 'fabricator');
}

test('panel Buttons: EventHandler targets onActionPressed with customEventData x1 / x10 / xMax', async () => {
    const source = await read(PANEL);
    assert.match(source, /event\.handler = 'onActionPressed'; event\.customEventData = key\.slice\('Action_'\.length\);/);
    const L = await imp('assets/scripts/presentation/UiLayout.ts');
    assert.deepEqual(L.PANEL_ACTION_KEYS.map((key) => key.slice('Action_'.length)), ['x1', 'x10', 'xMax']);
});

test('panel click (clickEvent, id) emits exactly the enabled action command via commandEmitter', async () => {
    const { host, emitted, click } = await panelHarness();
    host.latest = await panelModel(1e6);
    assert.equal(host.latest.actions.x10.isEnabled, true);
    click('x10');
    assert.deepEqual(emitted.map((c) => ({ ...c })), [{ type: 'buyProducerLevels', producerId: 'fabricator', quantity: 10 }]);
    click('xMax');
    assert.deepEqual({ ...emitted[1] }, { type: 'buyMaxProducerLevels', producerId: 'fabricator' });
    click('x1');
    assert.deepEqual({ ...emitted[2] }, { type: 'buyProducerLevels', producerId: 'fabricator', quantity: 1 });
    assert.equal(emitted.length, 3);
});

test('panel click: a disabled action or an unknown id emits nothing', async () => {
    const { host, emitted, click } = await panelHarness();
    host.latest = await panelModel(0);
    for (const id of ['x1', 'x10', 'xMax']) assert.equal(host.latest.actions[id].isEnabled, false, id);
    for (const id of ['x1', 'x10', 'xMax', 'Action_x1', 'unknown', undefined]) click(id);
    host.latest = await panelModel(1e6);
    click('unknown');
    click(undefined);
    assert.deepEqual(emitted, []);
});

test('both HUD and panel click handlers take (event, customEventData)', async () => {
    for (const rel of [PANEL, HUD]) {
        const source = await read(rel);
        assert.ok(source.includes(HANDLER_SIGNATURE), `${rel} onActionPressed must be (_event: unknown, actionId: string)`);
        assert.doesNotMatch(source, /onActionPressed\(actionId: string\)/, rel);
    }
});

// AUT-R-037-01: native Button.interactable mirrors the latest snapshot; ×MAX caption shows the resolved quantity.
test('panel Buttons: applyActionStates (real body) maps each action to interactable; no snapshot / locked / pending is all disabled', async () => {
    const source = await read(PANEL);
    const { isProducerPanelActionInteractable } = await imp('assets/scripts/presentation/ProducerPanelViewModel.ts');
    const apply = new Function('isProducerPanelActionInteractable', `return function () {${methodBody(source, 'private applyActionStates(): void {')}};`)(isProducerPanelActionInteractable);
    const buttons = new Map(['x1', 'x10', 'xMax'].map((id) => [id, { interactable: true }]));
    const host = { buttons, latest: null };
    const states = () => Object.fromEntries([...buttons].map(([id, b]) => [id, b.interactable]));
    const run = () => apply.call(host);

    run(); // startup / pending selection: no snapshot
    assert.deepEqual(states(), { x1: false, x10: false, xMax: false });

    host.latest = await panelModel(1e6); // affordable
    run();
    assert.deepEqual(states(), { x1: true, x10: true, xMax: true });

    host.latest = await panelModel(0); // insufficient funds / zero MAX
    assert.equal(host.latest.actions.xMax.quantity, 0);
    run();
    assert.deepEqual(states(), { x1: false, x10: false, xMax: false });

    const partial = await panelModel(1e6);
    host.latest = { ...partial, actions: { ...partial.actions, x10: { ...partial.actions.x10, isEnabled: false, command: null } } }; // each action independent
    run();
    assert.deepEqual(states(), { x1: true, x10: false, xMax: true });

    host.latest = { ...partial, status: 'locked', actions: null }; // locked: actions null
    run();
    assert.deepEqual(states(), { x1: false, x10: false, xMax: false });

    host.latest = partial; // a refresh restores
    run();
    assert.deepEqual(states(), { x1: true, x10: true, xMax: true });
    host.latest = null; // replaceSelection invalidates
    run();
    assert.deepEqual(states(), { x1: false, x10: false, xMax: false });
    assert.equal(isProducerPanelActionInteractable({ isEnabled: true, command: null }), false);
});

test('panel controller wires Button sync on layout, refresh and replaceSelection', async () => {
    const source = await read(PANEL);
    assert.match(methodBody(source, 'public refresh(viewModel: ProducerPanelViewModel): void {'), /this\.applyActionStates\(\);/);
    assert.match(methodBody(source, 'public replaceSelection(selectedProducerId: string | null): void {'), /this\.latest = null;[\s\S]*this\.applyActionStates\(\);/);
    assert.match(source, /this\.buttons\.set\(key\.slice\('Action_'\.length\) as ProducerPanelActionId, button\);/);
});

test('×MAX caption shows the resolved quantity and cost; zero MAX stays disabled; ×1/×10 captions unchanged', async () => {
    const { formatPanelTexts } = await imp('assets/scripts/presentation/PresentationText.ts');
    const rich = await panelModel(1e6);
    const texts = formatPanelTexts(rich);
    assert.equal(texts.actions.xMax, `Buy ×MAX (×${rich.actions.xMax.quantity}) ${rich.actions.xMax.costFormatted}`);
    assert.match(texts.actions.x10, /^Buy ×10 \S+$/);
    const zero = await panelModel(0);
    assert.equal(zero.actions.xMax.quantity, 0);
    assert.equal(zero.actions.xMax.isEnabled, false);
    assert.equal(zero.actions.xMax.command, null);
    assert.equal(formatPanelTexts(zero).actions.xMax, `Buy ×MAX (×0) ${zero.actions.xMax.costFormatted} • Unavailable`);
});
