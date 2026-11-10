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

function numbersFrom(source, pattern, label) {
    const match = source.match(pattern);
    assert.ok(match, `could not parse ${label}`);
    return match.slice(1).map(Number);
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

const PANEL_ROOT_SIZE = /this\.node\.addComponent\(UITransform\); transform\.setContentSize\((\d+),\s*(\d+)\)/;
// CoreHudController root card size (CoreHudController.ts, `transform.setContentSize(640, 310)`).
const HUD_ROOT_SIZE = /transform\.setContentSize\((640),\s*(310)\)/;

test('T1: the world camera visibility excludes UI_2D', async () => {
    const source = await readSource(bootstrapPath);
    assert.ok(source.includes(NEW_VISIBILITY), 'bootstrap uses the ALL & ~UI_2D visibility mask');
    assert.ok(!source.includes('visibility = Layers.Enum.ALL;'), 'bootstrap no longer gives the world camera Layers.Enum.ALL');
});

test('T2: exactly one camera exists and no presentation camera sees UI_2D', async () => {
    const source = await readSource(bootstrapPath);
    assert.equal((source.match(/addComponent\(Camera\)/g) ?? []).length, 1);
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
    const [canvasW, canvasH] = numbersFrom(bootstrap, /canvasTransform\.setContentSize\((\d+),\s*(\d+)\)/, 'canvas size');
    const [hudW, hudH] = numbersFrom(hud, HUD_ROOT_SIZE, 'HUD root size');
    const [panelW, panelH] = numbersFrom(panel, PANEL_ROOT_SIZE, 'panel root size');
    assert.deepEqual([canvasW, canvasH], [720, 1280]);
    assert.deepEqual([hudW, hudH], [640, 310]);
    assert.deepEqual([panelW, panelH], [600, 330]);
    assert.ok(hudW < canvasW && hudH < canvasH && panelW < canvasW && panelH < canvasH);
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

    // UI roots: centre anchor, CoreHudCanvas at the origin.
    const [panelX, panelY] = numbersFrom(bootstrap, /panel\.setPosition\((-?\d+),\s*(-?\d+),/, 'panel position');
    const [hudX, hudY] = numbersFrom(bootstrap, /hud\.setPosition\((-?\d+),\s*(-?\d+),/, 'HUD position');
    const [panelW, panelH] = numbersFrom(panel, PANEL_ROOT_SIZE, 'panel size');
    const [hudW, hudH] = numbersFrom(hud, HUD_ROOT_SIZE, 'HUD size');
    const roots = [
        { name: 'ProducerPanel', layer: LAYER_UI_2D, cx: panelX, cy: panelY, w: panelW, h: panelH },
        { name: 'CoreHUD', layer: LAYER_UI_2D, cx: hudX, cy: hudY, w: hudW, h: hudH },
    ];

    // Panel action Buttons: child nodes with no explicit layer (Cocos default = DEFAULT),
    // positioned at local y = base - index * step (ProducerPanelController.ensureLayout).
    assert.doesNotMatch(panel, /\.layer\s*=/);
    const [baseY, stepY] = numbersFrom(panel, /new Vec3\(0, (\d+) - index \* (\d+), 0\)/, 'panel row layout');
    const [buttonW, buttonH] = numbersFrom(panel, /transform\.setContentSize\((\d+), (\d+)\);\s*const label/, 'row size');
    const entries = panel.match(/const entries = \[(.*?)\] as const/);
    assert.ok(entries, 'panel entries');
    const keys = [...entries[1].matchAll(/\['(\w+)'/g)].map((m) => m[1]);
    const buttons = keys
        .map((key, index) => ({ key, index }))
        .filter(({ key }) => key.startsWith('Action_'))
        .map(({ key, index }) => ({ name: key, layer: LAYER_DEFAULT, cx: panelX, cy: panelY + baseY - index * stepY, w: buttonW, h: buttonH }));
    assert.deepEqual(buttons.map((b) => b.cy), [136, 98, 60]);

    // Engine rule: a node is hit-testable through a camera only if (camera.visibility & node.layer) != 0.
    const claims = (visibility, rect) => {
        if (((visibility & rect.layer) >>> 0) === 0) return 0;
        return samples.filter((p) => Math.abs(p.x - rect.cx) <= rect.w / 2 && Math.abs(p.y - rect.cy) <= rect.h / 2).length;
    };

    // (a) Reproduce the bug: with visibility = ALL the panel root claims every sample.
    assert.equal(claims(LAYER_ALL, roots[0]), samples.length);

    // (b) With the bootstrap's actual mask, no UI_2D root is hit-testable through the world camera.
    const visibility = evaluateVisibility(bootstrap);
    assert.equal((visibility & LAYER_UI_2D) >>> 0, 0);
    for (const root of roots) assert.equal(claims(visibility, root), 0, `${root.name} claims world touches`);

    // (c) DEFAULT-layer Buttons stay world-visible but sit far above the camera envelope.
    for (const button of buttons) assert.equal(claims(visibility, button), 0, `${button.name} claims world touches`);
});
