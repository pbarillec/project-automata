const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

test('first automation controller is presentation-only and uses bounded camera focus', async () => {
    const source = await readFile(path.join(__dirname, '..', 'assets/scripts/presentation/FirstAutomationPresentationController.ts'), 'utf8');
    assert.match(source, /consumeDomainEvents/);
    assert.match(source, /syncFromGameState/);
    assert.match(source, /focusOnWorldTarget/);
    assert.match(source, /autonomous_cycle_indicator/);
    assert.doesNotMatch(source, /purchaseBreakthrough|industrialOutput\s*[+\-*/]?=|isAutomated\s*=/);
});
