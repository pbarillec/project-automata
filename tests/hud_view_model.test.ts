const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const dataRoot = path.join(repoRoot, 'data');
const configUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/config/ConfigLoader.ts')).href;
const stateUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/state/index.ts')).href;
const hudUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/presentation/HudViewModel.ts')).href;

async function sources(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map(async (entry) => {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) return sources(file);
        return entry.isFile() && entry.name.endsWith('.json')
            ? [{ filePath: path.relative(repoRoot, file).replace(/\\/g, '/'), text: await readFile(file, 'utf8') }]
            : [];
    }))).flat().sort((left, right) => left.filePath.localeCompare(right.filePath));
}

async function fixture() {
    const [{ loadGameConfigFromSources }, { createFreshGameState }] = await Promise.all([import(configUrl), import(stateUrl)]);
    return { repository: loadGameConfigFromSources(await sources(dataRoot)), state: createFreshGameState() };
}

test('HUD maps fresh state without mutating the snapshot', async () => {
    const { repository, state } = await fixture();
    const before = JSON.stringify(state);
    const { createHudViewModel } = await import(hudUrl);
    const view = createHudViewModel(repository, state);
    assert.equal(view.industrialOutput.value, 0);
    assert.equal(view.productionPerSecond.value, 0);
    assert.equal(view.nextGoal.id, 'producer_build:fabricator:level_1');
    assert.equal(view.freeOverclock.state, 'locked');
    assert.equal(JSON.stringify(state), before);
});

test('HUD maps ready, active and cooldown Overclock states and remains idempotent', async () => {
    const { repository, state } = await fixture();
    const { createHudViewModel } = await import(hudUrl);
    state.run.progressionFlags.first_robot = true;
    state.run.industrialOutput = 12_345;
    const ready = createHudViewModel(repository, state);
    assert.equal(ready.freeOverclock.state, 'ready');
    const activation = (await import(pathToFileURL(path.join(repoRoot, 'assets/scripts/progression/index.ts')).href)).activateFreeOverclock(state);
    state.boosts = activation.boosts;
    const active = createHudViewModel(repository, state);
    assert.equal(active.freeOverclock.state, 'active');
    state.boosts = (await import(pathToFileURL(path.join(repoRoot, 'assets/scripts/progression/index.ts')).href)).advanceTemporaryBoosts(state.boosts, 60).boosts;
    const cooldown = createHudViewModel(repository, state);
    assert.equal(cooldown.freeOverclock.state, 'cooldown');
    assert.deepEqual(createHudViewModel(repository, state), cooldown);
});

test('HUD command contract emits the existing Free Overclock command only when ready', async () => {
    const { readFile } = require('node:fs/promises');
    const source = await readFile(path.join(repoRoot, 'assets/scripts/presentation/CoreHudController.ts'), 'utf8');
    assert.match(source, /type: 'activateFreeOverclock'/);
    assert.match(source, /freeOverclock\.canActivate/);
    assert.doesNotMatch(source, /GameState|industrialOutput\s*=/);
});
