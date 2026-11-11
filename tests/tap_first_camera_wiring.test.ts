const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const read = (rel) => readFile(path.join(repoRoot, rel), 'utf8');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

function methodBody(source, signature) {
    const start = source.indexOf(signature);
    assert.ok(start >= 0, `${signature} not found`);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
    }
    throw new Error(`unterminated ${signature}`);
}

test('AUT-R-031-02: FactoryWorld enables one-finger pan only; CameraSpike keeps the default gesture set', async () => {
    const bootstrap = await read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    const rig = methodBody(bootstrap, 'private createCameraRig(parent: Node): void {');
    assert.match(rig, /controller\.oneFingerMode = 'pan';/);
    assert.match(rig, /controller\.multiTouchEnabled = false;/);
    // Framing values unchanged (portrait framing belongs to AUT-R-036-02).
    for (const line of ['controller.focusMinX = -9;', 'controller.focusMaxX = 9;', 'controller.focusMinZ = -6;', 'controller.focusMaxZ = 8;',
        'controller.defaultYawDeg = 135;', 'controller.defaultPitchDeg = 48;', 'controller.defaultDistance = 12.5;',
        'controller.defaultFocusX = -3.8;', 'controller.defaultFocusZ = -1.8;', 'controller.focusDistance = 9.5;']) {
        assert.ok(rig.includes(line), line);
    }
    const spike = await read('assets/scripts/presentation/CameraSpikeBootstrap.ts');
    assert.doesNotMatch(spike, /oneFingerMode|multiTouchEnabled|setFocusBounds/);
});

test('AUT-R-031-02: the reveal pushes in through focusOnRevealTarget; selection keeps focusOnWorldTarget', async () => {
    const reveal = await read('assets/scripts/presentation/FirstAutomationPresentationController.ts');
    assert.match(reveal, /this\.cameraController\.focusOnRevealTarget\(target\);/);
    assert.doesNotMatch(reveal, /focusOnWorldTarget/);
    const selection = await read('assets/scripts/presentation/ProducerSelectionController.ts');
    assert.match(selection, /this\.cameraController\?\.focusOnWorldTarget\(focusAnchor\.worldPosition\)/);
    assert.doesNotMatch(selection, /focusOnRevealTarget/);
});

test('AUT-R-031-02: the bootstrap uses the engine-free zone layout and feeds the pan bounds through the binding camera sink', async () => {
    const bootstrap = await read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /import \{ ZONE_LAYOUT \} from '\.\/FactoryZoneLayout\.ts';/);
    assert.doesNotMatch(bootstrap, /const ZONE_LAYOUT\b/);
    assert.match(bootstrap, /import \{ CAMERA_PAN_BOUNDS_MARGIN, resolveCameraPanBounds \} from '\.\/CameraPanBounds\.ts';/);
    const session = methodBody(bootstrap, 'private startPersistentSession(presentation: PresentationController | null): void {');
    assert.match(session, /camera: cameraController \? \{\s*syncPanBounds: \(snapshot\) => cameraController\.setFocusBounds\(resolveCameraPanBounds\(result\.configRepository, snapshot, ZONE_LAYOUT, CAMERA_PAN_BOUNDS_MARGIN, cameraController\.getGlobalFocusBounds\(\)\)\),\s*\} : null,/);
    // camera_state is DEBUG-only: hooked only when diagnostics are enabled, emitted two frames after the gesture ends.
    assert.match(bootstrap, /if \(isDeviceDiagnosticsEnabled\(\)\) controller\.onCameraGestureEnded = \(\) => this\.scheduleCameraStateDiagnostics\(\);/);
    const emit = methodBody(bootstrap, 'private emitCameraState(reason: string): void {');
    assert.match(emit, /emitDeviceEvent\('camera_state', \{/);
    for (const field of ['yaw: state.yawDeg', 'pitch: state.pitchDeg', 'distance: state.distance', 'focus: state.focus', 'bounds: controller.getFocusBounds()']) assert.ok(emit.includes(field), field);
});

test('AUT-R-031-02: the binding feeds the camera sink the same snapshots as the automation sink', async () => {
    const { FactoryWorldStateBinding } = await imp('assets/scripts/presentation/FactoryWorldStateBinding.ts');
    const snapshots = [{ id: 'init' }, { id: 'after_submit' }];
    let index = 0;
    const calls = [];
    const session = {
        getStateSnapshot: () => snapshots[Math.min(index, snapshots.length - 1)],
        execute: async () => { index = 1; return { execution: { ok: true, events: [{ type: 'ProducerPurchased' }] } }; },
        advanceActiveSessionFromClock: async () => ({ runtime: { execution: { ok: true, events: [] } } }),
        suspend: async () => null,
        resume: () => null,
    };
    const binding = new FactoryWorldStateBinding({
        session,
        configRepository: null,
        automation: {
            syncAutomationState: (s) => calls.push(['automation_sync', s.id]),
            consumeDomainEvents: (s) => calls.push(['automation_events', s.id]),
        },
        hud: null,
        panel: null,
        camera: { syncPanBounds: (s) => calls.push(['camera', s.id]) },
    });
    binding.init();
    await binding.submit({ type: 'BuyProducer', producerId: 'fabricator', quantity: 1 });
    await binding.tick(0.016);
    assert.deepEqual(calls, [['automation_sync', 'init'], ['camera', 'init'], ['automation_events', 'after_submit'], ['camera', 'after_submit']]);

    // The camera sink is optional.
    const noCamera = new FactoryWorldStateBinding({ session, configRepository: null, automation: null, hud: null, panel: null });
    noCamera.init();
    const source = await read('assets/scripts/presentation/FactoryWorldStateBinding.ts');
    assert.equal((source.match(/this\.camera\?\.syncPanBounds\(snapshot\);/g) || []).length, 2);
});

test('AUT-R-031-02: new modules are engine-free with committed metas; camera_state is a known diagnostic', async () => {
    for (const rel of ['assets/scripts/presentation/FactoryZoneLayout.ts', 'assets/scripts/presentation/CameraPanBounds.ts', 'assets/scripts/camera/CameraMath.ts']) {
        assert.doesNotMatch(await read(rel), /from\s+['"]cc(\/env)?['"]/, rel);
    }
    for (const rel of ['assets/scripts/presentation/FactoryZoneLayout.ts.meta', 'assets/scripts/presentation/CameraPanBounds.ts.meta']) {
        const meta = JSON.parse(await read(rel));
        assert.equal(meta.importer, 'typescript');
        assert.match(meta.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
    const { DEVICE_EVENT_TYPES } = await imp('assets/scripts/presentation/DeviceDiagnostics.ts');
    assert.ok(DEVICE_EVENT_TYPES.includes('camera_state'));
});
