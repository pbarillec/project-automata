const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

test('strengths are light, medium, heavy', async () => {
    const { HAPTIC_STRENGTHS } = await imp('assets/scripts/services/HapticsService.ts');
    assert.deepEqual([...HAPTIC_STRENGTHS], ['light', 'medium', 'heavy']);
});

test('MockHapticsService records vibrations and honours the enabled flag', async () => {
    const { MockHapticsService } = await imp('assets/scripts/platform/mock/MockHapticsService.ts');
    const haptics = new MockHapticsService();
    haptics.vibrate('light');
    haptics.vibrate('heavy');
    assert.deepEqual(haptics.vibrations, ['light', 'heavy']);
    haptics.setEnabled(false);
    haptics.vibrate('medium');
    assert.deepEqual(haptics.vibrations, ['light', 'heavy']);
    haptics.setEnabled(true);
    haptics.vibrate('medium');
    assert.deepEqual(haptics.vibrations, ['light', 'heavy', 'medium']);
});

test('NoOpHapticsService never throws and tracks the flag', async () => {
    const { NoOpHapticsService } = await imp('assets/scripts/platform/noop/NoOpHapticsService.ts');
    const haptics = new NoOpHapticsService();
    assert.doesNotThrow(() => { haptics.vibrate('light'); haptics.vibrate('nope'); haptics.setEnabled(false); haptics.setEnabled(undefined); });
    assert.equal(haptics.isEnabled(), false);
    haptics.setEnabled(true);
    assert.equal(haptics.isEnabled(), true);
});

test('providers are exported through platform/index.ts and services/index.ts like the Ads providers', () => {
    const fs = require('node:fs');
    const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    assert.match(read('assets/scripts/platform/mock/index.ts'), /MockAudioService/);
    assert.match(read('assets/scripts/platform/mock/index.ts'), /MockHapticsService/);
    assert.match(read('assets/scripts/platform/noop/index.ts'), /SilentAudioService/);
    assert.match(read('assets/scripts/platform/noop/index.ts'), /NoOpHapticsService/);
    assert.match(read('assets/scripts/services/index.ts'), /AudioService/);
    assert.match(read('assets/scripts/services/index.ts'), /HapticsService/);
    assert.match(read('assets/scripts/platform/index.ts'), /\.\/mock/);
    assert.match(read('assets/scripts/platform/index.ts'), /\.\/noop/);
});
