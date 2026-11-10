const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const WRITABLE = '/data/user/0/com.projectautomata.androidbaseline/files/';

function png(width, height) {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(width, 16);
    b.writeUInt32BE(height, 20);
    return b;
}

/**
 * Simulated FactoryWorld device. Each launch runs the real engine-free session path
 * (bootstrapGameSession → FileSaveStorage over the device files → FactoryWorldStateBinding)
 * and writes the `[AUT-DEVICE]` lines FactoryWorldBootstrap emits.
 */
async function simulatedDevice(mode, devices = [{ serial: 'SIM', state: 'device', model: 'SimPhone' }]) {
    const { EventStream } = await imp('tools/device/events.ts');
    const { formatDeviceEvent } = await imp('assets/scripts/presentation/DeviceDiagnostics.ts');
    const { FileSaveStorage } = await imp('assets/scripts/persistence/index.ts');
    const { ManualTimeService } = await imp('assets/scripts/time/index.ts');
    const { bootstrapGameSession } = await imp('assets/scripts/lifecycle/index.ts');
    const { FactoryWorldStateBinding } = await imp('assets/scripts/presentation/FactoryWorldStateBinding.ts');
    const { AutomationPayoffViewModel } = await imp('assets/scripts/presentation/AutomationPayoffViewModel.ts');
    const files = new Map();
    const log = [];
    let seq = 0;
    let stream = null;
    let binding = null;
    let launches = 0;
    const emit = (evt, payload) => stream.pushLine(`11-10 10:00:00.000 1 2 D Cocos   : JS: ${formatDeviceEvent(evt, ++seq, payload)}`);
    const port = {
        exists: (name) => files.has(WRITABLE + name),
        readText: (name) => files.get(WRITABLE + name),
        writeText: (name, text) => { files.set(WRITABLE + name, text); },
        move: (from, to) => { files.set(WRITABLE + to, files.get(WRITABLE + from)); files.delete(WRITABLE + from); },
        remove: (name) => { files.delete(WRITABLE + name); },
    };
    return {
        log,
        files,
        async devices() { return devices; },
        useSerial(serial) { log.push(['serial', serial]); },
        async getProp(name) { return name.endsWith('release') ? '16' : '36'; },
        async install() { log.push(['install']); },
        async forceStop() { log.push(['forceStop']); binding = null; },
        async clearAppData() {
            log.push(['clearAppData']);
            if (mode === 'pm_clear_refused') throw new Error('SecurityException: CLEAR_APP_USER_DATA');
            files.clear();
        },
        async appDataDirectory() { return WRITABLE.slice(0, -'/files/'.length); },
        async launch() {
            launches += 1;
            log.push(['launch', launches]);
            emit('scene_ready', { reason: 'bootstrap_loaded', scene: 'FactoryWorld' });
            emit('reveal_state', { phase: 'idle', source: 'none', automated: false });
            const viewModel = new AutomationPayoffViewModel();
            let payoff = null;
            const boot = await bootstrapGameSession({ storage: new FileSaveStorage(port), timeService: new ManualTimeService({ utcIso: '2026-11-10T10:00:00.000Z' }) });
            if (!boot.startup.ok) {
                emit('session_state', { phase: 'load_failed', status: boot.startup.status, saveOk: null, autoFeederOwned: false, writablePath: WRITABLE });
                return;
            }
            binding = new FactoryWorldStateBinding({
                session: boot.startup.session,
                configRepository: boot.configRepository,
                automation: {
                    syncAutomationState: (state) => { payoff = viewModel.syncFromState(state); },
                    consumeDomainEvents: (state, events) => { payoff = viewModel.consumeEvents(state, events); },
                },
                hud: null,
                panel: null,
            });
            binding.init();
            emit('scene_ready', { reason: 'scene_ready', targets: 5 });
            emit('session_state', { phase: 'ready', status: boot.startup.status, saveOk: null, autoFeederOwned: binding.describe().autoFeederOwned, writablePath: WRITABLE });
            emit('reveal_state', { phase: 'synced', source: 'session', automated: payoff.activityIndicatorVisible, focusRequested: false });
            if (mode === 'replay' && payoff.activityIndicatorVisible) emit('reveal_state', { phase: 'started', source: 'runtime', automated: true, focusRequested: true });
            if (mode === 'error_after_ready' && launches === 2) emit('error', { source: 'session', context: 'tick', message: 'boom' });
        },
        async pressHome() {
            log.push(['home']);
            const result = await binding.suspend();
            if (mode === 'lost_save') files.clear();
            emit('session_state', { phase: 'suspended', status: result.status, saveOk: result.save.ok, autoFeederOwned: binding.describe().autoFeederOwned, writablePath: WRITABLE });
        },
        async listAppFiles(_pkg, dir) { return [...files.keys()].filter((p) => p.startsWith(dir)).map((p) => p.slice(dir.length)); },
        async writeAppFile(_pkg, devicePath, text) { log.push(['writeAppFile', devicePath]); files.set(devicePath, text); },
        async removeAppFiles(_pkg, paths) { log.push(['removeAppFiles', ...paths]); for (const p of paths) files.delete(p); },
        async pidOf() { return 1234; },
        async tap() {},
        async swipe() {},
        async screencap() { return png(2772, 1272); },
        async logcatClear() {},
        startLogcat(rawPath) { stream = new EventStream(); fs.writeFileSync(rawPath, ''); return stream; },
        async stopLogcat() {},
        async meminfo() { return ''; },
        async gfxinfo() { return ''; },
        commandLog() { return []; },
    };
}

async function run(mode, devices, extra = {}) {
    const { runInt001Scenario } = await imp('tools/device/scenarios/int001_session_persistence.ts');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aut-int001-'));
    const apk = path.join(root, 'fake.apk');
    fs.writeFileSync(apk, 'not really an apk');
    const driver = await simulatedDevice(mode, devices);
    const output = await runInt001Scenario(driver, {
        apkPath: apk, artifactRoot: root, runId: `sim-${mode}`, sleep: async () => {},
        now: () => new Date('2026-11-10T10:00:00Z'),
        timeouts: { sceneReadyMs: 200, sessionMs: 200, suspendMs: 200, noRevealWindowMs: 1 },
        ...extra,
    });
    return { ...output, driver, root };
}

test('AUT-INT-001 (simulated): fresh → suspend → loaded_main → seeded Auto Feeder save is automated without replay → PASS', async () => {
    const { result, schemaErrors, paths, driver } = await run('pass');
    assert.deepEqual(schemaErrors, []);
    assert.equal(result.status, 'PASS', JSON.stringify(result.first_failed_assertion));
    assert.equal(result.scenario_id, 'INT001-session-persistence');
    assert.equal(result.task_id, 'AUT-INT-001');
    const ids = result.assertions.filter((a) => a.ok).map((a) => a.id);
    for (const id of ['saves_cleared', 'fresh_session_ready', 'suspend_save_ok', 'save_main_on_disk', 'relaunch_loaded_main', 'seeded_save_pushed', 'seeded_loaded_main', 'seeded_auto_feeder_owned', 'seeded_reveal_automated', 'seeded_no_focus_replay']) {
        assert.ok(ids.includes(id), id);
    }
    assert.deepEqual(result.steps.map((s) => s.id), ['fresh_launch', 'suspend', 'relaunch', 'seeded_launch']);
    assert.equal(result.steps[0].session.status, 'fresh_game');
    assert.equal(result.steps[2].session.status, 'loaded_main');
    assert.equal(result.steps[3].session.autoFeederOwned, true);
    assert.ok(driver.log.some(([op]) => op === 'clearAppData'));
    assert.ok(driver.log.some(([op, p]) => op === 'writeAppFile' && p === `${WRITABLE}save_main.json`));
    assert.ok(fs.existsSync(path.join(paths.runDir, 'seeded_save_main.json')));
    for (const file of [paths.result, paths.summary, paths.logcat, paths.events, paths.device, paths.commands]) assert.ok(fs.existsSync(file), file);
});

test('AUT-INT-001 (simulated): OEM refusing pm clear falls back to deleting the save files via run-as', async () => {
    const { result, driver } = await run('pm_clear_refused');
    assert.equal(result.status, 'PASS', JSON.stringify(result.first_failed_assertion));
    assert.ok(result.warnings.some((w) => /pm clear refused/.test(w)));
    assert.deepEqual(result.steps[0], { id: 'clear_saves', method: 'run-as rm', directory: WRITABLE });
    assert.ok(driver.log.some(([op, ...paths]) => op === 'removeAppFiles' && paths.includes(`${WRITABLE}save_main.json`)));
});

test('AUT-INT-001 (simulated): replayed focus beat, lost save and runtime errors fail with the right class', async () => {
    const replay = await run('replay');
    assert.deepEqual(replay.schemaErrors, []);
    assert.equal(replay.result.status, 'FAIL');
    assert.equal(replay.result.failure_class, 'CAMERA_FOCUS');
    assert.equal(replay.result.first_failed_assertion.id, 'seeded_no_focus_replay');

    const lost = await run('lost_save');
    assert.equal(lost.result.status, 'FAIL');
    assert.equal(lost.result.failure_class, 'RUNTIME_ERROR');
    assert.equal(lost.result.first_failed_assertion.id, 'save_main_on_disk');

    const errored = await run('error_after_ready');
    assert.equal(errored.result.status, 'FAIL');
    assert.equal(errored.result.failure_class, 'RUNTIME_ERROR');
    assert.match(errored.result.first_failed_assertion.id, /^no_errors_after_scene_ready_/);
});

test('AUT-INT-001 (simulated): no device → BLOCKED needing a human to connect the phone', async () => {
    const { result, schemaErrors } = await run('pass', []);
    assert.deepEqual(schemaErrors, []);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.failure_class, 'ENVIRONMENT');
    assert.equal(result.first_failed_assertion.id, 'device_ready');
    assert.match(result.required_human_action, /connect/);
});

test('seeded save is a valid current-version envelope that owns Auto Feeder', async () => {
    const { buildSeededAutoFeederSave } = await imp('tools/device/scenarios/int001_session_persistence.ts');
    const { assertDeserializeGameStateFromSaveJson, CURRENT_SAVE_VERSION } = await imp('assets/scripts/persistence/index.ts');
    const { GAME_SESSION_DEV_GAME_VERSION } = await imp('assets/scripts/lifecycle/index.ts');
    const { resolveAutomationPayoff } = await imp('assets/scripts/presentation/AutomationPayoffViewModel.ts');
    const text = buildSeededAutoFeederSave(Date.parse('2026-11-10T10:00:00Z'));
    const { envelope, state } = assertDeserializeGameStateFromSaveJson(text);
    assert.equal(envelope.saveVersion, CURRENT_SAVE_VERSION);
    assert.equal(envelope.gameVersion, GAME_SESSION_DEV_GAME_VERSION);
    assert.equal(envelope.savedAtUtc, '2026-11-10T09:59:00.000Z');
    assert.ok(state.run.purchasedBreakthroughIds.includes('auto_feeder'));
    assert.equal(resolveAutomationPayoff(state).automationActive, true);
});

test('adb helpers only interpolate safe absolute device paths and use run-as for app storage', async () => {
    const { AdbClient, assertSafeDevicePath } = await imp('tools/device/adb.ts');
    assert.equal(assertSafeDevicePath(`${WRITABLE}save_main.json`), `${WRITABLE}save_main.json`);
    for (const bad of ['relative/x', '/a b', "/a'b", '/a;rm', '/a/../b', '/a$(x)']) assert.throws(() => assertSafeDevicePath(bad), bad);
    const calls = [];
    const client = new AdbClient(async (args) => { calls.push(args); return { code: 0, stdout: Buffer.from('Success\nsave_main.json\n'), stderr: '', timedOut: false, durationMs: 1 }; }, 'SER');
    await client.writeAppFile('pkg', `${WRITABLE}save_main.json`, '{"a":1}');
    await client.pressHome();
    await client.clearAppData('pkg');
    assert.deepEqual(await client.listAppFiles('pkg', WRITABLE), ['Success', 'save_main.json']);
    const b64 = Buffer.from('{"a":1}').toString('base64');
    assert.deepEqual(calls[0], ['-s', 'SER', 'shell', 'run-as', 'pkg', 'sh', '-c', `'echo ${b64} | base64 -d > ${WRITABLE}save_main.json'`]);
    assert.deepEqual(calls[1], ['-s', 'SER', 'shell', 'input', 'keyevent', 'KEYCODE_HOME']);
    assert.deepEqual(calls[2], ['-s', 'SER', 'shell', 'pm', 'clear', 'pkg']);
});

test('device CLI exposes the int001 scenario', async () => {
    const source = fs.readFileSync(path.join(repoRoot, 'tools/device/cli.ts'), 'utf8');
    assert.match(source, /command === 'int001'/);
    assert.match(source, /runInt001Scenario\(new AdbDeviceDriver\(\)/);
});
