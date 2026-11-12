import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { deserializeGameStateFromSaveJson } from '../assets/scripts/persistence/index.ts';
import { loadGameConfigFromSources } from '../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { evaluateBreakthroughEligibility } from '../assets/scripts/progression/index.ts';
import { resolveNextGoal } from '../assets/scripts/progression/NextGoal.ts';
import { resolveAutomatedCellVisualState } from '../assets/scripts/presentation/AutomatedCellVisualStateResolver.ts';
import { resolveRobotLineVisualState } from '../assets/scripts/presentation/RobotLineVisualStateResolver.ts';
import { isFirstRobotPresent } from '../assets/scripts/presentation/AssemblyVisualStateResolver.ts';
import { AUT043_SEED_VARIANTS, AUTOMATED_CELL_CONSTRUCTION_COST, buildAut043SeededSave, buildAut043SeededState, isAut043SeedVariant } from '../tools/device/seed_aut043.ts';

test('AUT-043 gate seed: unbuilt (affordable, buildable), Lv1 and Lv10 variants round-trip through the save', () => {
    assert.deepEqual([...AUT043_SEED_VARIANTS], ['unbuilt', 'lv1', 'lv10']);
    assert.equal(isAut043SeedVariant('lv10'), true);
    assert.equal(isAut043SeedVariant('lv5'), false);

    const repository = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
    const unbuilt = buildAut043SeededState('unbuilt');
    assert.deepEqual(unbuilt.run.producers.automated_cell, { level: 0, isUnlocked: true, isBuilt: false });
    assert.ok(unbuilt.run.industrialOutput >= AUTOMATED_CELL_CONSTRUCTION_COST, 'affordable');
    const breakthrough = evaluateBreakthroughEligibility(repository, unbuilt, 'automated_cell_architecture');
    assert.equal(breakthrough.status, 'eligible', 'the Automated Cell Architecture breakthrough (constructs the cell) can be bought from the seed');
    assert.equal(breakthrough.isAffordable, true);
    assert.equal(breakthrough.cost, AUTOMATED_CELL_CONSTRUCTION_COST, 'the seed constant matches the economy data');
    assert.equal(resolveRobotLineVisualState(unbuilt).constructed, true, 'the Robot Line prerequisite is built');
    const goal = resolveNextGoal(repository, unbuilt);
    assert.match(JSON.stringify(goal), /automated_cell_architecture/, 'Next Goal (the HUD action the reveal capture taps) is the Automated Cell Architecture breakthrough');
    assert.equal(isFirstRobotPresent(unbuilt), true, 'the population exists so the Line / Cell -> Storage robots show');

    for (const [variant, level] of [['lv1', 1], ['lv10', 10]] as const) {
        const result = deserializeGameStateFromSaveJson(buildAut043SeededSave(variant, Date.now()));
        assert.deepEqual(result.diagnostics, []);
        assert.deepEqual(result.state.run.producers.automated_cell, { level, isUnlocked: true, isBuilt: true });
        assert.equal(result.state.run.currentEraId, 'automated_factory');
        assert.equal(resolveAutomatedCellVisualState(result.state).phase, level === 10 ? 'cell_lv10' : 'cell_lv1');
    }
    const loadedUnbuilt = deserializeGameStateFromSaveJson(buildAut043SeededSave('unbuilt', Date.now()));
    assert.deepEqual(loadedUnbuilt.diagnostics, []);
    assert.equal(resolveAutomatedCellVisualState(loadedUnbuilt.state).phase, 'unbuilt');
});

test('AUT-043 seed command is registered (npm script + CLI) and no device is touched by tests', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.match(pkg.scripts['device:seed-aut043'], /tools\/device\/cli\.ts seed-aut043$/);
    const cli = readFileSync(new URL('../tools/device/cli.ts', import.meta.url), 'utf8');
    assert.match(cli, /command === 'seed-aut043'/);
    assert.match(cli, /--variant/);
    assert.match(cli, /seed-aut043 \[--variant unbuilt\|lv1\|lv10\]/);
});
