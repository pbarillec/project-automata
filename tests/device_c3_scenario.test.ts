const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

const W = 2772;
const H = 1272;
const ZONES = { Fabricator: [1386, 636], AssemblyStation: [1700, 560], RobotLine: [2000, 420], AutomatedCell: [1500, 300], AdvancedRoboticsComplex: [900, 300] };

function png(width, height) {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(width, 16);
    b.writeUInt32BE(height, 20);
    return b;
}

/**
 * Simulated FactoryWorld device: answers adb operations and writes the `[AUT-DEVICE]`
 * lines a correct (or deliberately broken) build would emit.
 */
async function simulatedDevice(mode, devices = [{ serial: 'SIM', state: 'device', model: 'SimPhone' }]) {
    const { EventStream } = await imp('tools/device/events.ts');
    const { formatDeviceEvent } = await imp('assets/scripts/presentation/DeviceDiagnostics.ts');
    let seq = 0;
    let stream = null;
    let selected = null;
    const log = [];
    const emit = (evt, payload) => stream.pushLine(`11-05 16:44:57.872 1 2 D Cocos   : JS: ${formatDeviceEvent(evt, ++seq, payload)}`);
    const projection = (reason) => ({ reason, screen: { w: W, h: H, dpr: 1 }, slop: 38.16, targets: mode === 'empty_index' ? 0 : 5, selected, zones: mode === 'empty_index' ? [] : Object.entries(ZONES).map(([id, [x, y]]) => ({ id, sx: x, sy: y, sz: 0.9, onScreen: true })) });
    return {
        log,
        async devices() { return devices; },
        useSerial(s) { log.push(['serial', s]); },
        async getProp(name) { return name.endsWith('release') ? '16' : '36'; },
        async install() { if (mode === 'install_fail') throw new Error('INSTALL_FAILED'); log.push(['install']); },
        async forceStop() {},
        async launch() {
            emit('scene_ready', { reason: 'bootstrap_loaded' });
            if (mode === 'empty_index') {
                stream.pushLine("11-05 16:44:57.947 1 2 E Cocos   : 16:44:57 [ERROR]: JS: TypeError: Cannot read properties of null (reading 'lightProbeInfo')");
                stream.pushLine('11-05 16:44:57.947 1 2 E Cocos   :     at ProducerHighlight.ensureMarker (assets/main/index.js:1:1)');
            } else {
                emit('scene_ready', projection('scene_ready'));
            }
            emit('reveal_state', { state: 'automated' });
            emit('camera_focus', { phase: 'started' });
            emit('camera_focus', { phase: 'settled' });
            emit('zones_projected', projection('camera_settled'));
        },
        async pidOf() { return 1234; },
        async tap(x, y) {
            const cx = Math.round(x);
            const cy = H - Math.round(y);
            log.push(['tap', cx, cy]);
            emit('touch_start', { x: cx, y: cy, uiBlocked: false });
            emit('touch_end', { x: cx, y: cy, moved: 0, slop: 38.16, tap: true, uiBlocked: false });
            const zone = mode === 'empty_index' ? null : Object.entries(ZONES).find(([, [zx, zy]]) => Math.hypot(zx - cx, zy - cy) < 5)?.[0] ?? null;
            const hit = mode === 'raycast_miss' ? null : zone;
            emit('selection_raycast', { x: cx, y: cy, hit, targets: mode === 'empty_index' ? 0 : 5, zones: [] });
            if (!hit) return;
            const prev = selected;
            selected = hit;
            emit('selection_state', { requested: hit, prev, next: hit, changed: prev !== hit });
            if (prev && prev !== hit) emit('marker_state', { id: prev, exists: true, active: false, activeInHierarchy: false, hasMesh: true });
            emit('marker_state', { id: hit, exists: true, active: mode !== 'marker_hidden', activeInHierarchy: mode !== 'marker_hidden', hasMesh: true });
            emit('camera_focus', { phase: 'requested', source: 'selection', id: hit });
            emit('camera_focus', { phase: 'started' });
            emit('camera_focus', { phase: 'settled' });
            emit('zones_projected', projection('camera_settled'));
        },
        async swipe(x1, y1, x2, y2) {
            log.push(['swipe']);
            emit('touch_start', { x: x1, y: H - y1 });
            const tap = mode === 'swipe_as_tap';
            emit('touch_end', { x: x2, y: H - y2, moved: Math.hypot(x2 - x1, y2 - y1), slop: 38.16, tap });
            if (tap) emit('selection_raycast', { hit: 'Fabricator' });
        },
        async screencap() { return png(W, H); },
        async logcatClear() {},
        startLogcat(rawPath) { stream = new EventStream(); fs.writeFileSync(rawPath, ''); return stream; },
        async stopLogcat() {},
        async meminfo() { return 'TOTAL PSS: 1'; },
        async gfxinfo() { return 'Total frames rendered: 1'; },
        commandLog() { return []; },
    };
}

async function run(mode, extra = {}, devices) {
    const { runC3Scenario } = await imp('tools/device/scenarios/c3_producer_selection.ts');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aut-device-'));
    const apk = path.join(root, 'fake.apk');
    fs.writeFileSync(apk, 'not really an apk');
    const driver = await simulatedDevice(mode, devices);
    const output = await runC3Scenario(driver, {
        apkPath: apk, artifactRoot: root, runId: `sim-${mode}`, sleep: async () => {},
        now: () => new Date('2026-11-05T00:00:00Z'),
        timeouts: { sceneReadyMs: 200, revealMs: 200, settleMs: 200, chainMs: 200, projectionMs: 200, swipeMs: 1 },
        ...extra,
    });
    return { ...output, driver, root };
}

test('AUT-INFRA-001 C3 (simulated): correct build → PASS with ordered chain, swipe and evidence', async () => {
    const { result, schemaErrors, paths, driver } = await run('pass');
    assert.deepEqual(schemaErrors, []);
    assert.equal(result.status, 'PASS', JSON.stringify(result.first_failed_assertion));
    assert.equal(result.review_decision, 'PASS');
    assert.match(result.apk.sha256, /^[0-9a-f]{64}$/);
    assert.equal(result.device.serial, 'SIM');
    const taps = result.steps.filter((s) => String(s.id).startsWith('tap_'));
    assert.equal(taps.length, 5);
    assert.deepEqual(taps.map((s) => s.zone), ['Fabricator', 'AssemblyStation', 'RobotLine', 'AutomatedCell', 'AdvancedRoboticsComplex']);
    assert.ok(result.steps.some((s) => s.id === 'calibration' && s.ok));
    assert.ok(result.steps.some((s) => s.id === 'swipe' && s.ok));
    assert.ok(driver.log.some((entry) => entry[0] === 'swipe'));
    for (const file of [paths.result, paths.summary, paths.logcat, paths.events, paths.meminfo, paths.gfxinfo, paths.device, paths.commands]) assert.ok(fs.existsSync(file), file);
    assert.ok(result.evidence.screenshots.length >= 7);
    assert.equal(JSON.parse(fs.readFileSync(paths.result, 'utf8')).run_id, 'sim-pass');
    assert.ok(paths.runDir.endsWith('sim-pass'));
});

test('AUT-INFRA-001 C3 (simulated): each broken build yields its class and stops at the first failure', async () => {
    const cases = [['raycast_miss', 'RAYCAST_MISS', 'raycast_hit_zone'], ['marker_hidden', 'MARKER_PRESENTATION', 'marker_active'], ['swipe_as_tap', 'TAP_CLASSIFICATION', 'swipe_not_classified_tap']];
    for (const [mode, cls, assertion] of cases) {
        const { result, schemaErrors } = await run(mode);
        assert.deepEqual(schemaErrors, []);
        assert.equal(result.status, 'FAIL', mode);
        assert.equal(result.review_decision, 'CHANGES_REQUESTED');
        assert.equal(result.failure_class, cls, mode);
        assert.equal(result.first_failed_assertion.id, assertion);
        assert.equal(result.retry_without_code_change, false);
        assert.equal(result.assertions.filter((a) => !a.ok).length, 1, `${mode}: one failed assertion`);
    }
});

test('AUT-INFRA-001 C3 (simulated): selection start() exception → RUNTIME_ERROR with stack evidence and a secondary probe', async () => {
    const { result } = await run('empty_index');
    assert.equal(result.failure_class, 'RUNTIME_ERROR');
    assert.equal(result.first_failed_assertion.id, 'scene_ready');
    assert.ok(result.first_failed_assertion.evidence_lines.some((l) => /lightProbeInfo/.test(l)));
    assert.ok(result.first_failed_assertion.evidence_lines.some((l) => /ProducerHighlight\.ensureMarker/.test(l)));
    assert.deepEqual(result.actual.errorMessages, ["TypeError: Cannot read properties of null (reading 'lightProbeInfo')"]);
    const probe = result.steps.find((s) => s.id === 'post_failure_centre_tap');
    assert.equal(probe.secondary, true);
    assert.equal(probe.failure.assertion, 'raycast_hit_zone');
    assert.ok(result.steps.find((s) => s.id === 'post_failure_calibration').ok);
});

test('AUT-INFRA-001 C3: no device → BLOCKED/ENVIRONMENT, HUMAN_REVIEW_REQUIRED, only "connect and authorize"', async () => {
    for (const devices of [[], [{ serial: 'X', state: 'unauthorized' }]]) {
        const { result, schemaErrors, paths } = await run('pass', {}, devices);
        assert.deepEqual(schemaErrors, []);
        assert.equal(result.status, 'BLOCKED');
        assert.equal(result.failure_class, 'ENVIRONMENT');
        assert.equal(result.review_decision, 'HUMAN_REVIEW_REQUIRED');
        assert.equal(result.required_human_action, 'connect and authorize the Android device');
        assert.equal(result.retry_without_code_change, true);
        assert.equal(result.device, null);
        assert.ok(fs.existsSync(paths.result));
    }
});

test('AUT-INFRA-001 C3: install failure and missing APK are ENVIRONMENT blocks, not functional failures', async () => {
    const install = await run('install_fail');
    assert.equal(install.result.status, 'BLOCKED');
    assert.equal(install.result.first_failed_assertion.id, 'apk_installed');
    assert.equal(install.result.review_decision, 'BLOCKED');
    const missing = await run('pass', { apkPath: path.join(os.tmpdir(), 'does-not-exist.apk') });
    assert.equal(missing.result.status, 'BLOCKED');
    assert.equal(missing.result.first_failed_assertion.id, 'apk_present');
    assert.equal(missing.result.apk.sha256, null);
});

test('AUT-INFRA-001: run ids and artifact paths are deterministic and confined to the run directory', async () => {
    const { makeRunId, runPaths } = await imp('tools/device/artifacts.ts');
    assert.equal(makeRunId('C3-producer-selection', new Date('2026-11-05T08:44:43.123Z'), 'abcdef0123456789'), 'c3-producer-selection-20261105T084443Z-abcdef01');
    const p = runPaths('r1', path.join('temp', 'device'));
    assert.equal(p.runDir, path.join('temp', 'device', 'r1'));
    assert.equal(p.screenshot(3, 'tap 1/Fabricator'), path.join('temp', 'device', 'r1', 'screenshots', '03-tap_1_Fabricator.png'));
    assert.throws(() => runPaths('../escape'));
});
