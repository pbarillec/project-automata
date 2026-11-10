const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const bootstrapPath = path.join(repoRoot, 'assets/scripts/presentation/FactoryWorldBootstrap.ts');
const hudPath = path.join(repoRoot, 'assets/scripts/presentation/CoreHudController.ts');
const panelPath = path.join(repoRoot, 'assets/scripts/presentation/ProducerPanelController.ts');
const cameraMathUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/camera/CameraMath.ts')).href;

// Cocos Creator 3.8.8 Layers.Enum values (cocos/scene-graph/layers.ts).
const LAYER_ALL = 0xffffffff;
const LAYER_UI_2D = 1 << 25;
const LAYER_DEFAULT = 1 << 30;

const NEW_VISIBILITY = 'camera.visibility = (Layers.Enum.ALL & ~Layers.Enum.UI_2D) >>> 0;';

function readSource(filePath) {
    return readFile(filePath, 'utf8');
}

function evaluateVisibility(source) {
    const match = source.match(/camera\.visibility\s*=\s*([^;]+);/);
    assert.ok(match, 'bootstrap assigns camera.visibility');
    const expression = match[1]
        .replace(/Layers\.Enum\.ALL/g, '0xffffffff')
        .replace(/Layers\.Enum\.UI_2D/g, '(1 << 25)')
        .replace(/Layers\.Enum\.DEFAULT/g, '(1 << 30)');
    assert.match(expression, /^[0-9a-fx()&|~<>\s]+$/i, `visibility expression is a pure layer mask: ${match[1]}`);
    return Function(`"use strict"; return (${expression});`)() >>> 0;
}

async function presentationSources() {
    const dirs = ['assets/scripts/presentation', 'assets/scripts/camera', 'assets/scripts/app'];
    const sources = [];
    for (const dir of dirs) {
        const absolute = path.join(repoRoot, dir);
        let entries = [];
        try {
            entries = await readdir(absolute);
        } catch {
            continue;
        }
        // Standalone spike scenes (AUT-031 CameraSpike, AUT-032 AssetRobotSpike) are out of the
        // FactoryWorld input path and keep their own single-camera setup.
        for (const entry of entries.filter((name) => name.endsWith('.ts') && !/Spike/.test(name))) {
            sources.push({ file: `${dir}/${entry}`, text: await readSource(path.join(absolute, entry)) });
        }
    }
    return sources;
}

const uiLayoutUrl = pathToFileURL(path.join(repoRoot, 'assets/scripts/presentation/UiLayout.ts')).href;
// AUT-R-036: both controllers size their root card from UiLayout.
const ROOT_SIZE_FROM_LAYOUT = /this\.node\.addComponent\(UITransform\);\s*transform\.setContentSize\(layout\.width, cardHeight\(layout\)\);/;

/** `new Node(...)` declarations in a source, with the variable each is assigned to. */
function createdNodes(source) {
    return [...source.matchAll(/const (\w+) = (?:[^;]*\?\? )?new Node\(/g)].map((m) => m[1]);
}

test('T1: the world camera visibility excludes UI_2D', async () => {
    const source = await readSource(bootstrapPath);
    assert.ok(source.includes(NEW_VISIBILITY), 'bootstrap uses the ALL & ~UI_2D visibility mask');
    assert.ok(!source.includes('visibility = Layers.Enum.ALL;'), 'bootstrap no longer gives the world camera Layers.Enum.ALL');
});

test('T2: two cameras exist; the UI camera sees exactly UI_2D and the WorldCamera is the only one seeing DEFAULT', async () => {
    const source = await readSource(bootstrapPath);
    // AUT-R-036: the WorldCamera (createCameraRig) plus the dedicated UI camera (createUiRoot), in that order.
    const cameraAdds = [...source.matchAll(/(\w+)\.getComponent\(Camera\) \?\? \1\.addComponent\(Camera\)/g)].map((m) => m[1]);
    assert.deepEqual(cameraAdds, ['cameraNode', 'cameraNode']);
    assert.equal((source.match(/addComponent\(Camera\)/g) ?? []).length, 2);
    const visibilities = [...source.matchAll(/(\w+)\.visibility\s*=\s*([^;]+);/g)].map((m) => ({ target: m[1], expression: m[2].trim() }));
    assert.deepEqual(visibilities, [
        { target: 'camera', expression: '(Layers.Enum.ALL & ~Layers.Enum.UI_2D) >>> 0' },
        { target: 'uiCamera', expression: 'Layers.Enum.UI_2D' },
    ]);
    const uiVisibility = LAYER_UI_2D;
    const worldVisibility = evaluateVisibility(source);
    assert.equal((uiVisibility & LAYER_DEFAULT) >>> 0, 0, 'the UI camera must not see DEFAULT');
    assert.notEqual((worldVisibility & LAYER_DEFAULT) >>> 0, 0, 'the WorldCamera sees DEFAULT');
    assert.equal((worldVisibility & LAYER_UI_2D) >>> 0, 0, 'the WorldCamera must not see UI_2D');
    for (const { file, text } of await presentationSources()) {
        assert.doesNotMatch(text, /visibility\s*=\s*Layers\.Enum\.ALL\s*;/, `${file} assigns visibility = ALL`);
        for (const assignment of text.match(/visibility\s*=[^;]*;/g) ?? []) {
            assert.doesNotMatch(assignment, /\|\s*[\w.]*UI_2D|UI_2D\s*\|/, `${file} ORs UI_2D into a visibility: ${assignment}`);
        }
    }
});

test('T3: HUD/panel touch listeners live only on their bounded root nodes', async () => {
    const [bootstrap, hud, panel] = await Promise.all([readSource(bootstrapPath), readSource(hudPath), readSource(panelPath)]);
    for (const [name, text] of [['CoreHudController', hud], ['ProducerPanelController', panel]]) {
        const touchCalls = text.match(/[\w.]+\.on\(Node\.EventType\.TOUCH_[A-Z]+/g) ?? [];
        assert.equal(touchCalls.length, 4, `${name} registers four TOUCH_* listeners`);
        for (const call of touchCalls) assert.match(call, /^this\.node\.on\(/, `${name}: ${call}`);
    }
    assert.match(bootstrap, /hud\.getComponent\(CoreHudController\) \?\? hud\.addComponent\(CoreHudController\)/);
    assert.match(bootstrap, /panel\.getComponent\(ProducerPanelController\) \?\? panel\.addComponent\(ProducerPanelController\)/);
    assert.doesNotMatch(bootstrap, /canvas\.(addComponent|getComponent)\((CoreHudController|ProducerPanelController)\)/);
    assert.doesNotMatch(bootstrap, /canvas\.on\(/);
    assert.doesNotMatch(bootstrap, /(canvas|container)\w*\.on\(Node\.EventType/);
    // AUT-R-036: no fixed canvas size (the Canvas aligns with the screen); card sizes come from UiLayout.
    assert.doesNotMatch(bootstrap, /canvasTransform\.setContentSize\(/);
    assert.match(hud, /const layout = CORE_HUD_LAYOUT;/);
    assert.match(panel, /const layout = PRODUCER_PANEL_LAYOUT;/);
    assert.match(hud, ROOT_SIZE_FROM_LAYOUT);
    assert.match(panel, ROOT_SIZE_FROM_LAYOUT);
    const L = await import(uiLayoutUrl);
    const design = L.UI_DESIGN_RESOLUTION;
    for (const card of [L.CORE_HUD_LAYOUT, L.PRODUCER_PANEL_LAYOUT]) {
        assert.ok(card.width < design.width && L.cardHeight(card) < design.height, `${card.name} fits the design resolution`);
        assert.notDeepEqual([card.width, L.cardHeight(card)], [640, 310]);
        assert.notDeepEqual([card.width, L.cardHeight(card)], [600, 330]);
    }
});

test('T4: panel Buttons are added on child nodes, never on the panel root', async () => {
    const panel = await readSource(panelPath);
    assert.match(panel, /(?<!this\.)\bnode\.addComponent\(Button\)/);
    assert.doesNotMatch(panel, /this\.node\.addComponent\(Button\)/);
});

test('T5: near-plane hit test through the world camera cannot let UI roots claim world touches', async () => {
    const { DEFAULT_CAMERA_TUNING } = await import(cameraMathUrl);
    const [bootstrap, hud, panel] = await Promise.all([readSource(bootstrapPath), readSource(hudPath), readSource(panelPath)]);

    // Focus bounds the bootstrap gives MobileCameraController (fall back to CameraMath defaults).
    const focusBound = (name, fallback) => {
        const match = bootstrap.match(new RegExp(`controller\\.${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`));
        return match ? Number(match[1]) : fallback;
    };
    const bounds = {
        minX: focusBound('focusMinX', DEFAULT_CAMERA_TUNING.focusBounds.minX),
        maxX: focusBound('focusMaxX', DEFAULT_CAMERA_TUNING.focusBounds.maxX),
        minZ: focusBound('focusMinZ', DEFAULT_CAMERA_TUNING.focusBounds.minZ),
        maxZ: focusBound('focusMaxZ', DEFAULT_CAMERA_TUNING.focusBounds.maxZ),
    };
    // MobileCameraController.focusHeight defaults to 0 and the bootstrap does not override it.
    assert.doesNotMatch(bootstrap, /focusHeight\s*=/);
    const focusHeight = 0;
    const { minPitchDeg, maxPitchDeg, minDistance, maxDistance } = DEFAULT_CAMERA_TUNING;

    // Camera pose as in MobileCameraController.applyCameraPose. screenToWorld(z = 0) lands on the
    // near plane (0.1 from the eye), so the camera position stands in for the hit-test world point.
    const samples = [];
    for (let yaw = 0; yaw < 360; yaw += 15) {
        for (const pitch of [minPitchDeg, (minPitchDeg + maxPitchDeg) / 2, maxPitchDeg]) {
            for (const distance of [minDistance, (minDistance + maxDistance) / 2, maxDistance]) {
                for (const fx of [bounds.minX, bounds.maxX]) {
                    for (const fz of [bounds.minZ, bounds.maxZ]) {
                        void fz; // z does not affect the 2D rect test; kept to cover the focus corners.
                        const yawRad = (yaw * Math.PI) / 180;
                        const pitchRad = (pitch * Math.PI) / 180;
                        const horizontal = distance * Math.cos(pitchRad);
                        samples.push({
                            x: fx + Math.sin(yawRad) * horizontal,
                            y: focusHeight + distance * Math.sin(pitchRad),
                        });
                    }
                }
            }
        }
    }
    assert.equal(samples.length, 24 * 3 * 3 * 4);
    const maxCameraY = Math.max(...samples.map((s) => s.y));
    assert.ok(maxCameraY <= 21.2, `camera y envelope ${maxCameraY}`);

    // Engine rule: a node is hit-testable through a camera only if (camera.visibility & node.layer) != 0.
    const claims = (visibility, rect) => {
        if (((visibility & rect.layer) >>> 0) === 0) return 0;
        return samples.filter((p) => Math.abs(p.x - rect.cx) <= rect.w / 2 && Math.abs(p.y - rect.cy) <= rect.h / 2).length;
    };

    // (a) Reproduce the original AUT-R-035 bug with its historical geometry (the pre-AUT-R-036 panel
    // root: centre (28, 150), 600×330, canvas at the world origin): with visibility = ALL it claims every sample.
    const historicalPanelRoot = { name: 'ProducerPanel (pre-AUT-R-036)', layer: LAYER_UI_2D, cx: 28, cy: 150, w: 600, h: 330 };
    assert.equal(claims(LAYER_ALL, historicalPanelRoot), samples.length);

    // AUT-R-036: every node the bootstrap and the controllers create for the UI is UI_2D, including the
    // controllers' label/Button rows (Cocos would otherwise default them to DEFAULT).
    for (const [name, text] of [['CoreHudController', hud], ['ProducerPanelController', panel]]) {
        const nodes = createdNodes(text);
        assert.ok(nodes.length >= 1, `${name} creates rows`);
        for (const variable of nodes) assert.match(text, new RegExp(`\\b${variable}\\.layer = Layers\\.Enum\\.UI_2D;`), `${name}: ${variable} is not UI_2D`);
        assert.doesNotMatch(text, /\.layer\s*=\s*Layers\.Enum\.(?!UI_2D\b)/, `${name} assigns a non-UI_2D layer`);
    }

    // UI roots and rows at their real AUT-R-036 places for several screens (canvas bottom-left at the
    // world origin, one design unit per world unit): all UI_2D.
    const L = await import(uiLayoutUrl);
    const rects = [];
    for (const screen of [{ w: 1280, h: 720 }, { w: 2412, h: 1080 }, { w: 2772, h: 1272 }]) {
        const layout = L.computeUiLayout(screen);
        const toWorld = (rect, name) => ({ name, layer: LAYER_UI_2D, cx: (rect.x + rect.w / 2) / layout.scale, cy: (rect.y + rect.h / 2) / layout.scale, w: rect.w / layout.scale, h: rect.h / layout.scale });
        rects.push(toWorld(layout.hud, 'CoreHUD'), toWorld(layout.panel, 'ProducerPanel'));
        for (const [key, rect] of Object.entries(layout.buttons)) rects.push(toWorld(rect, key));
    }

    // (b) With the bootstrap's actual mask, no UI_2D root or row is hit-testable through the world camera.
    const visibility = evaluateVisibility(bootstrap);
    assert.equal((visibility & LAYER_UI_2D) >>> 0, 0);
    assert.equal(claims(visibility, historicalPanelRoot), 0);
    for (const rect of rects) assert.equal(claims(visibility, rect), 0, `${rect.name} claims world touches`);
});
