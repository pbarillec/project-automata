const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

test('FactoryWorld attaches first automation presentation to the existing Fabricator composition and focus anchor', async () => {
    const source = await readFile(path.join(__dirname, '..', 'assets/scripts/presentation/FactoryWorldBootstrap.ts'), 'utf8');
    assert.match(source, /FirstAutomationPresentationController/);
    assert.match(source, /Fabricator_CompositionAnchor/);
    assert.match(source, /Fabricator_FocusAnchor/);
    assert.match(source, /connectFirstAutomationPresentation/);
    assert.match(source, /cameraController = parent\.getChildByName\('CameraRig'\)/);
    const registrySource = await readFile(path.join(__dirname, '..', 'assets/scripts/presentation/PresentationController.ts'), 'utf8');
    assert.match(registrySource, /consumeDomainEvents/);
    assert.match(registrySource, /syncAutomationState/);
});
