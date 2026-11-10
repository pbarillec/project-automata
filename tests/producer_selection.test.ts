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

test('AUT-R-035-02 selection builds its target index in start(), after the bootstrap assigned its targets', async () => {
    const source = await readFile(path.join(repoRoot, 'assets/scripts/presentation/ProducerSelectionController.ts'), 'utf8');
    const onLoadBody = source.match(/public onLoad\(\): void \{([\s\S]*?)\n    \}/);
    assert.ok(onLoadBody, 'onLoad body not found');
    assert.doesNotMatch(onLoadBody[1], /rebuildTargetIndex/);
    assert.doesNotMatch(onLoadBody[1], /new TouchGestureTracker/);
    assert.match(onLoadBody[1], /input\.on\(Input\.EventType\.TOUCH_START/);
    const startBody = source.match(/public start\(\): void \{([\s\S]*?)\n    \}/);
    assert.ok(startBody, 'start() method not found');
    assert.match(startBody[1], /new TouchGestureTracker/);
    assert.match(startBody[1], /this\.rebuildTargetIndex\(\)/);
});

test('AUT-R-035-02 HUD and producer panel swallow touches on their own area', async () => {
    for (const name of ['CoreHudController', 'ProducerPanelController']) {
        const source = await readFile(path.join(repoRoot, `assets/scripts/presentation/${name}.ts`), 'utf8');
        for (const type of ['TOUCH_START', 'TOUCH_MOVE', 'TOUCH_END', 'TOUCH_CANCEL']) {
            assert.match(source, new RegExp(`this\\.node\\.on\\(Node\\.EventType\\.${type}, this\\.swallowTouch, this\\)`), `${name} does not register ${type}`);
        }
        assert.match(source, /private swallowTouch\(event: EventTouch\): void \{ event\.propagationStopped = true; \}/, `${name} handler does not stop propagation`);
        assert.match(source, /if \(!this\.touchBlockRegistered\)/, `${name} registration is not guarded`);
    }
});

test('AUT-R-035-02 selection marker sits above module bases and fits inside its zone', async () => {
    const [bootstrap, highlight] = await Promise.all([
        readFile(path.join(repoRoot, 'assets/scripts/presentation/FactoryWorldBootstrap.ts'), 'utf8'),
        readFile(path.join(repoRoot, 'assets/scripts/presentation/ProducerHighlight.ts'), 'utf8'),
    ]);
    const target = bootstrap.match(/_SelectableTarget`\);[\s\S]*?target\.setPosition\(0, ([-\d.]+), 0\)/);
    assert.ok(target, 'selectable target position not found');
    const markerPosition = highlight.match(/this\.marker\.setPosition\(0, ([-\d.]+), 0\)/);
    const markerScale = highlight.match(/this\.marker\.setScale\(([-\d.]+), ([-\d.]+), ([-\d.]+)\)/);
    const cylinder = highlight.match(/primitives\.cylinder\(([\d.]+), ([\d.]+), ([\d.]+),/);
    assert.ok(markerPosition && markerScale && cylinder, 'marker transform or cylinder not found');
    const moduleBaseY = 0.14;
    const worldBottom = Number(target[1]) + Number(markerPosition[1]) - Number(cylinder[3]) / 2;
    assert.ok(worldBottom > moduleBaseY, `marker bottom ${worldBottom} cuts module bases at ${moduleBaseY}`);
    assert.ok(2 * Number(cylinder[1]) * Number(markerScale[1]) <= 1, 'marker footprint exceeds its zone on x');
    assert.ok(2 * Number(cylinder[1]) * Number(markerScale[3]) <= 1, 'marker footprint exceeds its zone on z');
});
