import assert from 'node:assert/strict';
import test from 'node:test';
import { deserializeGameStateFromSaveJson } from '../assets/scripts/persistence/index.ts';
import { resolveRobotLineVisualState } from '../assets/scripts/presentation/RobotLineVisualStateResolver.ts';
import { isFirstRobotPresent } from '../assets/scripts/presentation/AssemblyVisualStateResolver.ts';
import { AUT042_SEED_VARIANTS, ROBOT_LINE_CONSTRUCTION_COST, buildAut042SeededSave, buildAut042SeededState, isAut042SeedVariant } from '../tools/device/seed_aut042.ts';
import { readFileSync } from 'node:fs';

test('AUT-042 gate seed: unbuilt (affordable), Lv1 and Lv10 variants round-trip through the save', () => {
    assert.deepEqual([...AUT042_SEED_VARIANTS], ['unbuilt', 'lv1', 'lv10']);
    assert.equal(isAut042SeedVariant('lv10'), true);
    assert.equal(isAut042SeedVariant('lv5'), false);

    const unbuilt = buildAut042SeededState('unbuilt');
    assert.deepEqual(unbuilt.run.producers.robot_line, { level: 0, isUnlocked: true, isBuilt: false });
    assert.ok(unbuilt.run.industrialOutput >= ROBOT_LINE_CONSTRUCTION_COST, 'affordable');
    assert.equal(unbuilt.run.currentEraId, 'manual_workshop', 'the Era II change is still to be seen live');
    assert.equal(isFirstRobotPresent(unbuilt), true, 'the population exists so the Line -> Storage robots show');

    for (const [variant, level] of [['lv1', 1], ['lv10', 10]] as const) {
        const result = deserializeGameStateFromSaveJson(buildAut042SeededSave(variant, Date.now()));
        assert.deepEqual(result.diagnostics, []);
        assert.deepEqual(result.state.run.producers.robot_line, { level, isUnlocked: true, isBuilt: true });
        assert.equal(result.state.run.currentEraId, 'automated_factory');
        assert.equal(resolveRobotLineVisualState(result.state).phase, level === 10 ? 'line_lv10' : 'line_lv1');
    }
    const loadedUnbuilt = deserializeGameStateFromSaveJson(buildAut042SeededSave('unbuilt', Date.now()));
    assert.deepEqual(loadedUnbuilt.diagnostics, []);
    assert.equal(resolveRobotLineVisualState(loadedUnbuilt.state).phase, 'unbuilt');
});

test('AUT-042 seed command is registered (npm script + CLI) and no device is touched by tests', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.match(pkg.scripts['device:seed-aut042'], /tools\/device\/cli\.ts seed-aut042$/);
    const cli = readFileSync(new URL('../tools/device/cli.ts', import.meta.url), 'utf8');
    assert.match(cli, /command === 'seed-aut042'/);
    assert.match(cli, /--variant/);
});
