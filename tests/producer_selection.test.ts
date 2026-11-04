const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

test('producer selection exposes exactly the five stable presentation identifiers', async () => {
    const source = await readFile(path.join(repoRoot, 'assets/scripts/presentation/ProducerSelectionController.ts'), 'utf8');
    for (const id of ['Fabricator', 'AssemblyStation', 'RobotLine', 'AutomatedCell', 'AdvancedRoboticsComplex']) {
        assert.match(source, new RegExp(`'${id}'`));
        assert.match(source, new RegExp(`\\$\\{producerId\\}_FocusAnchor`));
    }
    assert.match(source, /selectProducer\(current/);
    assert.match(source, /current === next \? current : next/);
});

test('selection is presentation-only, single-valued, highlighted structurally, and camera-focused through AUT-031', async () => {
    const [selection, highlight] = await Promise.all([
        readFile(path.join(repoRoot, 'assets/scripts/presentation/ProducerSelectionController.ts'), 'utf8'),
        readFile(path.join(repoRoot, 'assets/scripts/presentation/ProducerHighlight.ts'), 'utf8'),
    ]);
    assert.doesNotMatch(selection, /GameState|economy|gameplay|persistence|progression/);
    assert.match(selection, /private selectedProducerId: ProducerSelectionState = null/);
    assert.match(selection, /setHighlight\(previousId, false\)/);
    assert.match(selection, /focusOnWorldTarget/);
    assert.match(selection, /TouchGestureTracker/);
    assert.match(selection, /output.type !== 'tap'/);
    assert.match(highlight, /ProducerSelectionMarker/);
    assert.match(highlight, /primitives\.cylinder/);
    assert.match(highlight, /this\.marker\?\.isValid/);
});

test('AUT-R-035 highlight cylinder uses the Cocos 3.8.8 positional cylinder signature', async () => {
    const highlight = await readFile(path.join(repoRoot, 'assets/scripts/presentation/ProducerHighlight.ts'), 'utf8');
    assert.match(highlight, /primitives\.cylinder\(\s*0\.92\s*,\s*0\.92\s*,\s*0\.035\s*,\s*\{\s*radialSegments:\s*32\s*\}\s*\)/);
    assert.doesNotMatch(highlight, /primitives\.cylinder\(\s*\{/);
    assert.doesNotMatch(highlight, /\bsegments\s*:/);

    const { readdir } = require('node:fs/promises');
    for (const dir of ['assets/scripts/presentation', 'assets/scripts/camera']) {
        const files = (await readdir(path.join(repoRoot, dir))).filter((name) => name.endsWith('.ts'));
        for (const name of files) {
            const source = await readFile(path.join(repoRoot, dir, name), 'utf8');
            assert.doesNotMatch(source, /primitives\.(cylinder|cone|sphere|torus)\(\s*\{/, `${dir}/${name} passes an options object as the first primitive argument`);
        }
    }
});
