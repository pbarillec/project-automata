const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

test('producer panel view-model delegates all purchase and milestone resolution to authoritative APIs', async () => {
    const source = await readFile(path.join(repoRoot, 'assets/scripts/presentation/ProducerPanelViewModel.ts'), 'utf8');
    assert.match(source, /calculateProducerProgressionPurchase/);
    assert.match(source, /calculateMaxAffordableProducerProgressionPurchase/);
    assert.match(source, /calculateSustainedProducerProductionRateContributions/);
    assert.match(source, /repository\.listMilestones\(\)/);
    assert.match(source, /state: 'complete'/);
    assert.doesNotMatch(source, /threshold:\s*(10|25|50|100)/);
    assert.doesNotMatch(source, /baseCost\s*\*/);
});

test('producer panel explicitly disables zero-resolution MAX and locked producers', async () => {
    const source = await readFile(path.join(repoRoot, 'assets/scripts/presentation/ProducerPanelViewModel.ts'), 'utf8');
    assert.match(source, /isLocked \? EMPTY_ACTIONS/);
    assert.match(source, /max\.quantity > 0/);
    assert.match(source, /isEnabled: isAffordable/);
});
