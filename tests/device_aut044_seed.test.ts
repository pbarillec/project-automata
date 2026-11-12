import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { deserializeGameStateFromSaveJson } from '../assets/scripts/persistence/index.ts';
import { loadGameConfigFromSources } from '../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { evaluateBreakthroughEligibility, purchaseBreakthrough } from '../assets/scripts/progression/index.ts';
import { resolveNextGoal } from '../assets/scripts/progression/NextGoal.ts';
import { createHudViewModel } from '../assets/scripts/presentation/HudViewModel.ts';
import { resolveNextGoalAction } from '../assets/scripts/presentation/CoreLoopActions.ts';
import { resolveArcVisualState } from '../assets/scripts/presentation/AdvancedRoboticsComplexVisualStateResolver.ts';
import { resolveAutomatedCellVisualState } from '../assets/scripts/presentation/AutomatedCellVisualStateResolver.ts';
import { resolveRobotLineVisualState } from '../assets/scripts/presentation/RobotLineVisualStateResolver.ts';
import { isFirstRobotPresent } from '../assets/scripts/presentation/AssemblyVisualStateResolver.ts';
import { AUT044_SEED_VARIANTS, ARC_CONSTRUCTION_COST, buildAut044SeededSave, buildAut044SeededState, isAut044SeedVariant } from '../tools/device/seed_aut044.ts';

test('AUT-044 gate seed: unbuilt (affordable, buildable, Next Goal = the Advanced Robotics breakthrough), Lv1 and Lv10 variants round-trip through the save', () => {
    assert.deepEqual([...AUT044_SEED_VARIANTS], ['unbuilt', 'lv1', 'lv10']);
    assert.equal(isAut044SeedVariant('lv10'), true);
    assert.equal(isAut044SeedVariant('lv5'), false);

    const repository = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
    const unbuilt = buildAut044SeededState('unbuilt');
    assert.deepEqual(unbuilt.run.producers.advanced_robotics_complex, { level: 0, isUnlocked: true, isBuilt: false });
    assert.ok(unbuilt.run.industrialOutput >= ARC_CONSTRUCTION_COST, 'affordable');
    const breakthrough = evaluateBreakthroughEligibility(repository, unbuilt, 'advanced_robotics');
    assert.equal(breakthrough.status, 'eligible', 'the Advanced Robotics breakthrough (constructs the complex, enters robotics_complex) can be bought from the seed');
    assert.equal(breakthrough.isAffordable, true);
    assert.equal(breakthrough.cost, ARC_CONSTRUCTION_COST, 'the seed constant matches the economy data');
    assert.equal(resolveRobotLineVisualState(unbuilt).constructed, true, 'the Robot Line prerequisite is built');
    assert.equal(resolveAutomatedCellVisualState(unbuilt).constructed, true, 'the Automated Cell prerequisite is built');
    const goal = resolveNextGoal(repository, unbuilt);
    assert.equal(goal.category, 'breakthrough', 'the HUD Next Goal is a breakthrough (the only category with a HUD action)');
    assert.deepEqual(goal.focusTarget, { kind: 'breakthrough', breakthroughId: 'advanced_robotics' }, 'Next Goal (the HUD action the reveal capture taps) is exactly the Advanced Robotics breakthrough');
    assert.match(JSON.stringify(goal), /advanced_robotics/);
    assert.equal(isFirstRobotPresent(unbuilt), true, 'the population exists');
    assert.equal(unbuilt.run.currentEraId, 'robotics_complex', 'seed-only: the era is pre-entered so the Next Goal is a breakthrough goal and the HUD action exists');
    // With the natural era the goal is an era goal sourced by the same breakthrough, which the HUD has no action for.
    const natural = buildAut044SeededState('unbuilt');
    natural.run.currentEraId = 'automated_factory';
    const naturalGoal = resolveNextGoal(repository, natural);
    assert.equal(naturalGoal.category, 'era');
    assert.deepEqual(resolveNextGoalAction(createHudViewModel(repository, natural).nextGoal), { visible: false, enabled: false, command: null, breakthroughId: null }, 'the HUD would show no Next Goal action');
    // The seeded goal gives an enabled one-tap purchaseBreakthrough for exactly the Advanced Robotics breakthrough.
    assert.deepEqual(resolveNextGoalAction(createHudViewModel(repository, unbuilt).nextGoal), { visible: true, enabled: true, command: { type: 'purchaseBreakthrough', breakthroughId: 'advanced_robotics' }, breakthroughId: 'advanced_robotics' });

    // The one-tap purchase constructs the complex (state-level proof; the live sequence is the device capture).
    const bought = purchaseBreakthrough(repository, unbuilt, 'advanced_robotics');
    assert.equal(bought.status, 'success');
    if (bought.status === 'success') {
        assert.deepEqual(bought.state.run.producers.advanced_robotics_complex, { level: 1, isUnlocked: true, isBuilt: true });
        assert.equal(resolveArcVisualState(bought.state).phase, 'arc_lv1');
        assert.equal(bought.state.run.currentEraId, 'robotics_complex');
    }

    for (const [variant, level] of [['lv1', 1], ['lv10', 10]] as const) {
        const result = deserializeGameStateFromSaveJson(buildAut044SeededSave(variant, Date.now()));
        assert.deepEqual(result.diagnostics, []);
        assert.deepEqual(result.state.run.producers.advanced_robotics_complex, { level, isUnlocked: true, isBuilt: true });
        assert.equal(result.state.run.currentEraId, 'robotics_complex');
        assert.ok(result.state.run.purchasedBreakthroughIds.includes('advanced_robotics'));
        assert.equal(resolveArcVisualState(result.state).phase, level === 10 ? 'arc_lv10' : 'arc_lv1');
    }
    const loadedUnbuilt = deserializeGameStateFromSaveJson(buildAut044SeededSave('unbuilt', Date.now()));
    assert.deepEqual(loadedUnbuilt.diagnostics, []);
    assert.equal(resolveArcVisualState(loadedUnbuilt.state).phase, 'unbuilt');
    assert.deepEqual(resolveNextGoal(repository, loadedUnbuilt.state).focusTarget, goal.focusTarget, 'the saved unbuilt seed keeps the same Next Goal');
});

test('AUT-044 seed command is registered (npm script + CLI) and no device is touched by tests', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.match(pkg.scripts['device:seed-aut044'], /tools\/device\/cli\.ts seed-aut044$/);
    assert.match(pkg.scripts['device:seed-aut043'], /seed-aut043$/, 'the AUT-043 seed command is untouched');
    const cli = readFileSync(new URL('../tools/device/cli.ts', import.meta.url), 'utf8');
    assert.match(cli, /command === 'seed-aut044'/);
    assert.match(cli, /--variant/);
    assert.match(cli, /seed-aut044 \[--variant unbuilt\|lv1\|lv10\]/);
    assert.match(cli, /--scenario aut043\|aut044/);
});
