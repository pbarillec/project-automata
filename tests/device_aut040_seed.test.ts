import assert from 'node:assert/strict';
import test from 'node:test';
import { deserializeGameStateFromSaveJson } from '../assets/scripts/persistence/index.ts';
import { buildAut040SeededSave, buildAut040SeededState } from '../tools/device/seed_aut040.ts';

test('AUT-040 gate seed: Assembly unlocked but unbuilt, affordable, and the save round-trips', () => {
    const state = buildAut040SeededState();
    assert.deepEqual(state.run.producers.assembly_station, { level: 0, isUnlocked: true, isBuilt: false });
    assert.ok(state.run.industrialOutput >= 1500);
    const result = deserializeGameStateFromSaveJson(buildAut040SeededSave(Date.now()));
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.state.run.producers.assembly_station, { level: 0, isUnlocked: true, isBuilt: false });
});
