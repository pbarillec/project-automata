const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// AUT-UI-001: HUD action wiring, command emission, the binding's command-result hook and touch ownership.
const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const read = (rel) => readFile(path.join(repoRoot, rel), 'utf8');
const HUD = 'assets/scripts/presentation/CoreHudController.ts';
const BOOTSTRAP = 'assets/scripts/presentation/FactoryWorldBootstrap.ts';
const BINDING = 'assets/scripts/presentation/FactoryWorldStateBinding.ts';

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

/**
 * Runs the real CoreHudController action methods (their source bodies are plain JS) against a fake `this`,
 * so emission is tested without loading `cc`.
 */
async function hudActionHarness() {
    const source = await read(HUD);
    const actions = await imp('assets/scripts/presentation/CoreLoopActions.ts');
    const compile = (signature) => new Function('resolveManualProduceAction', 'resolveNextGoalAction', `return function () {${methodBody(source, signature)}};`)(actions.resolveManualProduceAction, actions.resolveNextGoalAction);
    const manualProduce = compile('public manualProduce(): void {');
    const purchaseNextGoal = compile('public purchaseNextGoal(): void {');
    // Cocos calls EventHandler handlers with (event, customEventData) (ComponentEventHandler.emit).
    const pressed = new Function(`return function (_event, actionId) {${methodBody(source, 'public onActionPressed(_event: unknown, actionId: string): void {')}};`)();
    const emitted = [];
    const host = { latest: null, commandEmitter: (command) => emitted.push(command) };
    host.manualProduce = () => manualProduce.call(host);
    host.purchaseNextGoal = () => purchaseNextGoal.call(host);
    host.onActionPressed = (id) => pressed.call(host, { type: 'click' }, id);
    return { host, emitted };
}

async function hudModels() {
    const { loadGameConfigFromSources } = await imp('assets/scripts/config/ConfigLoader.ts');
    const { getEmbeddedEconomyConfigSources } = await imp('assets/scripts/config/EmbeddedEconomyConfig.ts');
    const { createFreshGameState } = await imp('assets/scripts/state/index.ts');
    const { createHudViewModel } = await imp('assets/scripts/presentation/HudViewModel.ts');
    const repo = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
    const cost = repo.getBreakthrough('auto_feeder').cost;
    const at = (level, output) => {
        const state = createFreshGameState();
        if (level > 0) state.run.producers.fabricator = { level, isUnlocked: true, isBuilt: true };
        state.run.industrialOutput = output;
        return createHudViewModel(repo, state);
    };
    return { fresh: at(0, 0), unaffordable: at(15, cost - 1), affordable: at(15, cost) };
}

test('HUD actions emit only through commandEmitter and re-check the latest snapshot; nothing while disabled', async () => {
    const { host, emitted } = await hudActionHarness();
    const models = await hudModels();

    host.onActionPressed('ManualProduceAction');
    assert.deepEqual(emitted.map((c) => ({ ...c })), [{ type: 'manualProduce' }], 'Manual Produce works even before a snapshot');

    for (const model of [null, models.fresh, models.unaffordable]) {
        host.latest = model;
        host.onActionPressed('NextGoalAction');
    }
    assert.equal(emitted.length, 1, 'no purchase while hidden or disabled');

    host.latest = models.affordable;
    host.onActionPressed('NextGoalAction');
    assert.deepEqual({ ...emitted[1] }, { type: 'purchaseBreakthrough', breakthroughId: 'auto_feeder' });

    // The latest snapshot moved on (e.g. not affordable anymore): the tap is re-checked and dropped.
    host.latest = models.unaffordable;
    host.onActionPressed('NextGoalAction');
    host.onActionPressed('Unknown');
    assert.equal(emitted.length, 2);

    host.latest = models.affordable;
    host.commandEmitter = null;
    host.onActionPressed('NextGoalAction');
    host.onActionPressed('ManualProduceAction');
    assert.equal(emitted.length, 2, 'inert until the session wires commandEmitter');
});

test('HUD Buttons live on child nodes; the root keeps exactly its four TOUCH swallow listeners', async () => {
    const source = await read(HUD);
    const touchCalls = source.match(/[\w.]+\.on\(Node\.EventType\.TOUCH_[A-Z]+[^)]*\)/g) ?? [];
    assert.deepEqual(touchCalls, ['START', 'MOVE', 'END', 'CANCEL'].map((phase) => `this.node.on(Node.EventType.TOUCH_${phase}, this.swallowTouch, this)`));
    assert.equal((source.match(/addComponent\(Button\)/g) ?? []).length, 1);
    assert.match(source, /const node = new Node\(key\);\s*node\.layer = Layers\.Enum\.UI_2D;\s*node\.parent = this\.node;/);
    assert.match(source, /const button = node\.addComponent\(Button\);/);
    assert.doesNotMatch(source, /this\.node\.addComponent\(Button\)/);
    assert.match(source, /event\.handler = 'onActionPressed'; event\.customEventData = key;/);
    assert.match(source, /for \(const key of HUD_ACTION_KEYS\) \{/);
    // Every command leaves through commandEmitter; the HUD never touches the session or state.
    assert.equal((source.match(/this\.commandEmitter\?\.\(/g) ?? []).length, 3);
    assert.doesNotMatch(source, /\bbinding\??\.\w|\.submit\(|\bGameState\b|executeGameCommand|getStateSnapshot/);
    // Label + Button rows are fixed-size; the label shrinks (no wrap) rather than resizing the Button.
    const actionLoop = source.slice(source.indexOf('for (const key of HUD_ACTION_KEYS) {'));
    assert.match(actionLoop, /label\.overflow = Label\.Overflow\.SHRINK;\s*label\.enableWrapText = false;/);
    assert.match(methodBody(source, 'private applyActionStates(): void {'), /button\.interactable = states\[key\]\.visible && states\[key\]\.enabled;/);
});

test('Fabricator world tap stays selection only: the selection path never imports or emits a GameCommand', async () => {
    for (const rel of ['assets/scripts/presentation/ProducerSelectionController.ts', 'assets/scripts/presentation/SelectionInput.ts']) {
        const source = await read(rel);
        assert.doesNotMatch(source, /GameCommand|domain\/Commands|commandEmitter|manualProduce|submit\(/, rel);
    }
    const bootstrap = await read(BOOTSTRAP);
    assert.match(bootstrap, /selection\.onSelectionChanged = \(producerId\) => \{\s*panel\.replaceSelection\(producerId\);\s*this\.binding\?\.onSelectionChanged\(producerId\);\s*\};/);
    // Exactly the two existing emitters (HUD, panel) reach binding.submit.
    assert.deepEqual([...bootstrap.matchAll(/(\w+)\.commandEmitter = \(command\) => \{ void binding\.submit\(command\); \};/g)].map((m) => m[1]), ['hud', 'panel']);
    assert.equal((bootstrap.match(/binding\.submit\(/g) ?? []).length, 2);
});

test('the bootstrap passes a DEBUG-only command_result emitter to the binding hook', async () => {
    const bootstrap = await read(BOOTSTRAP);
    assert.match(bootstrap, /reportCommandResult: \(command, commandResult\) => this\.emitCommandResult\(command, commandResult\),/);
    const emit = methodBody(bootstrap, 'private emitCommandResult(command: GameCommand, result: LifecycleCommandResult): void {');
    assert.match(emit, /^\s*if \(!isDeviceDiagnosticsEnabled\(\)\) return;/);
    assert.match(emit, /emitDeviceEvent\('command_result', \{\s*command,\s*ok: execution\.ok,\s*reason: execution\.ok \? null : execution\.reason,\s*eventTypes: execution\.events\.map\(\(event\) => event\.type\),\s*industrialOutput,\s*\}\);/);
    assert.doesNotMatch(emit, /submit|execute\(|commandEmitter|refresh\(/);
    const { DEVICE_EVENT_TYPES } = await imp('assets/scripts/presentation/DeviceDiagnostics.ts');
    assert.ok(DEVICE_EVENT_TYPES.includes('command_result'));
});

async function bindingSetup(options = {}) {
    const { InMemorySaveStorage } = await imp('assets/scripts/persistence/index.ts');
    const { ManualTimeService } = await imp('assets/scripts/time/index.ts');
    const { bootstrapGameSession } = await imp('assets/scripts/lifecycle/index.ts');
    const { FactoryWorldStateBinding } = await imp(BINDING);
    const boot = await bootstrapGameSession({ storage: new InMemorySaveStorage({}), timeService: new ManualTimeService({ utcIso: '2026-11-10T08:00:00.000Z', monotonicSeconds: 0 }) });
    assert.equal(boot.startup.ok, true);
    const session = boot.startup.session;
    const errors = [];
    const hud = { models: [], refresh(model) { hud.models.push(model); } };
    const binding = new FactoryWorldStateBinding({
        session, configRepository: boot.configRepository, automation: null, hud, panel: null,
        reportError: (context, error) => errors.push([context, error]),
        ...options,
    });
    binding.init();
    return { binding, session, errors, hud };
}

test('binding hook: receives accepted and rejected results after submit, once each, after the fan-out', async () => {
    const { MANUAL_PRODUCTION_AMOUNT } = await imp('assets/scripts/runtime/index.ts');
    const reported = [];
    let ctx = null;
    ctx = await bindingSetup({ reportCommandResult: (command, result) => reported.push({ command, result, hudModels: ctx.hud.models.length }) });

    const accepted = await ctx.binding.submit({ type: 'manualProduce' });
    const rejected = await ctx.binding.submit({ type: 'purchaseBreakthrough', breakthroughId: 'auto_feeder' });

    assert.equal(reported.length, 2);
    assert.deepEqual(reported[0].command, { type: 'manualProduce' });
    assert.equal(reported[0].result, accepted);
    assert.equal(accepted.execution.ok, true);
    assert.equal(reported[0].hudModels, 2, 'hook runs after the accepted fan-out');
    const changed = accepted.execution.events.filter((e) => e.type === 'industrialOutputChanged').pop();
    assert.equal(changed.newAmount, MANUAL_PRODUCTION_AMOUNT);
    assert.deepEqual(reported[1].command, { type: 'purchaseBreakthrough', breakthroughId: 'auto_feeder' });
    assert.equal(reported[1].result, rejected);
    assert.equal(rejected.execution.ok, false);
    assert.equal(ctx.hud.models.length, 2, 'a rejected command still fans nothing out');
    assert.deepEqual(ctx.errors, []);
});

test('binding hook: optional (submit unchanged without it) and a throwing hook is reported, never thrown', async () => {
    const plain = await bindingSetup();
    const result = await plain.binding.submit({ type: 'manualProduce' });
    assert.equal(result.execution.ok, true);
    assert.equal(plain.session.getStateSnapshot().run.industrialOutput, 1);
    assert.deepEqual(plain.errors, []);

    const throwing = await bindingSetup({ reportCommandResult: () => { throw new Error('observer failed'); } });
    const after = await throwing.binding.submit({ type: 'manualProduce' });
    assert.equal(after.execution.ok, true, 'submit still returns the session result');
    assert.equal(throwing.errors.length, 1);
    assert.equal(throwing.errors[0][0], 'command_result');
});

test('CoreLoopActions.ts has a Cocos .ts.meta with a unique uuid', async () => {
    const meta = JSON.parse(await read('assets/scripts/presentation/CoreLoopActions.ts.meta'));
    assert.equal(meta.importer, 'typescript');
    assert.match(meta.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const { execFileSync } = require('node:child_process');
    const metas = execFileSync('git', ['ls-files', '*.meta'], { cwd: repoRoot, encoding: 'utf8' }).split('\n').filter(Boolean);
    for (const rel of metas) {
        const text = await readFile(path.join(repoRoot, rel), 'utf8').catch(() => '');
        if (rel.endsWith('CoreLoopActions.ts.meta')) continue;
        assert.ok(!text.includes(meta.uuid), `uuid collides with ${rel}`);
    }
});
