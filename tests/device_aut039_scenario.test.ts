const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// AUT-039 device scenario: pure helpers (seeded frontier save, loop evaluation, reveal focus target).
const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

const waypoint = (stopId, x, z, extra = {}) => ({ v: 1, seq: 1, evt: 'robot_state', phase: 'waypoint', mode: 'loop', clip: 'Robot_Walking', stopId, x, z, ...extra });

test('aut039 seeded save is a valid current-version save at the Worker Bot frontier', async () => {
    const scenario = await imp('tools/device/scenarios/aut039_first_robot.ts');
    const { deserializeGameStateFromSaveJson, CURRENT_SAVE_VERSION } = await imp('assets/scripts/persistence/index.ts');
    const { resolveAssemblyVisualState } = await imp('assets/scripts/presentation/AssemblyVisualStateResolver.ts');
    const json = scenario.buildAut039SeededSave(Date.parse('2026-11-12T08:00:00Z'));
    assert.equal(JSON.parse(json).saveVersion, CURRENT_SAVE_VERSION);
    const parsed = deserializeGameStateFromSaveJson(json);
    assert.deepEqual(parsed.diagnostics, []);
    assert.equal(parsed.state.run.producers.assembly_station.level, 10);
    assert.equal(parsed.state.run.purchasedBreakthroughIds.includes('worker_bot'), false);
    assert.equal(parsed.state.run.industrialOutput, scenario.workerBotCost());
    assert.equal(resolveAssemblyVisualState(parsed.state).phase, 'worker_bot_frontier');
});

test('aut039 evaluates the robot loop: count, cyclic order, on-route positions, allowed clips', async () => {
    const scenario = await imp('tools/device/scenarios/aut039_first_robot.ts');
    const loop = [
        waypoint('station', -1.8, -1.3, { clip: 'Robot_Idle' }),
        waypoint('spine_crossing', -1.39, -0.28),
        waypoint('storage_pick', -0.8, 0.45, { clip: 'Robot_Idle' }),
        waypoint('return', -1.21, -0.31),
        waypoint('station', -1.8, -1.3, { clip: 'Robot_Idle' }),
    ];
    assert.equal(scenario.evaluateRobotLoop('s', loop, 5).ok, true);
    assert.equal(scenario.evaluateRobotLoop('s', loop.slice(1), 5).failure.assertion, 'robot_loop_waypoints');
    const swapped = [loop[0], loop[2], loop[1], loop[3], loop[4]];
    assert.equal(scenario.evaluateRobotLoop('s', swapped, 5).failure.assertion, 'robot_loop_order');
    const off = [...loop.slice(0, 4), waypoint('station', 0, 0)];
    assert.equal(scenario.evaluateRobotLoop('s', off, 5).failure.assertion, 'robot_loop_on_route');
    const running = [...loop.slice(0, 4), waypoint('station', -1.8, -1.3, { clip: 'Robot_Running' })];
    const clip = scenario.evaluateRobotLoop('s', running, 5);
    assert.equal(clip.failure.assertion, 'robot_loop_clips');
    assert.equal(clip.failure.failureClass, 'MARKER_PRESENTATION');
    // Reveal-mode (entry) waypoints are not loop evidence.
    assert.equal(scenario.evaluateRobotLoop('s', loop.map((e) => ({ ...e, mode: 'reveal' })), 1).failure.assertion, 'robot_loop_waypoints');
});

test('aut039 reveal focus check targets the first-robot reveal anchor', async () => {
    const scenario = await imp('tools/device/scenarios/aut039_first_robot.ts');
    const { FIRST_ROBOT_REVEAL_TARGET } = await imp('assets/scripts/presentation/AssemblySliceLayout.ts');
    const started = { v: 1, seq: 2, evt: 'camera_focus', phase: 'started', kind: 'reveal', target: { ...FIRST_ROBOT_REVEAL_TARGET } };
    assert.equal(scenario.isRevealFocusOnTarget(started), true);
    assert.equal(scenario.isRevealFocusOnTarget({ ...started, kind: 'selection' }), false);
    assert.equal(scenario.isRevealFocusOnTarget({ ...started, target: { x: -6, y: 0.2, z: -2.85 } }), false);
    assert.equal(scenario.isRevealFocusOnTarget(null), false);
});

test('aut039 is registered in the device CLI and npm scripts', () => {
    const cli = readFileSync(path.join(repoRoot, 'tools/device/cli.ts'), 'utf8');
    assert.match(cli, /runAut039Scenario/);
    assert.match(cli, /command === 'aut039'/);
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    assert.match(pkg.scripts['device:aut039'], /cli\.ts aut039$/);
});
