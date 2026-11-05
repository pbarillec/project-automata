const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const diagnosticsPath = path.join(repoRoot, 'assets/scripts/presentation/DeviceDiagnostics.ts');
const load = () => import(pathToFileURL(diagnosticsPath).href);

test('AUT-INFRA-001: disabled diagnostics produce zero output (release default)', async () => {
    const d = await load();
    const lines = [];
    d.configureDeviceDiagnostics({ enabled: false, sink: (line) => lines.push(line) });
    d.emitDeviceEvent('touch_end', { x: 1 });
    d.emitDeviceEvent('scene_ready', {});
    assert.equal(d.isDeviceDiagnosticsEnabled(), false);
    assert.deepEqual(lines, []);
});

test('AUT-INFRA-001: format/parse round-trip with prefix, version and monotonic seq', async () => {
    const d = await load();
    const lines = [];
    d.configureDeviceDiagnostics({ enabled: true, sink: (line) => lines.push(line) });
    d.emitDeviceEvent('touch_end', { x: 100.456, y: 200.123, tap: true, nested: { v: 1.23456 }, skip: undefined });
    d.emitDeviceEvent('selection_state', { prev: null, next: 'Fabricator' });
    d.emitDeviceEvent('error', { message: 'boom' });
    assert.equal(lines.length, 3);
    for (const line of lines) assert.ok(line.startsWith('[AUT-DEVICE] {"v":1,"seq":'), line);
    const parsed = lines.map((line) => d.parseDeviceEventLine(`11-05 16:30:22.730 29996 10090 D Cocos   : 16:30:22 [DEBUG]: JS: ${line}`));
    assert.deepEqual(parsed.map((e) => e.seq), [1, 2, 3]);
    assert.deepEqual(parsed.map((e) => e.evt), ['touch_end', 'selection_state', 'error']);
    assert.equal(parsed[0].x, 100.46);
    assert.equal(parsed[0].nested.v, 1.23);
    assert.equal('skip' in parsed[0], false);
    assert.equal(parsed[1].prev, null);
    d.configureDeviceDiagnostics({ enabled: false });
});

test('AUT-INFRA-001: payload cannot override protocol fields and non-finite numbers stay valid JSON', async () => {
    const d = await load();
    const line = d.formatDeviceEvent('touch_end', 7, { evt: 'spoof', seq: 99, v: 5, value: Number.NaN, inf: Infinity });
    const parsed = d.parseDeviceEventLine(line);
    assert.equal(parsed.evt, 'touch_end');
    assert.equal(parsed.seq, 7);
    assert.equal(parsed.v, 1);
    assert.equal(parsed.value, 'NaN');
    assert.equal(parsed.inf, 'Infinity');
});

test('AUT-INFRA-001: malformed lines are tolerated', async () => {
    const d = await load();
    assert.equal(d.parseDeviceEventLine('no prefix here'), null);
    assert.equal(d.parseDeviceEventLine('[AUT-DEVICE] {not json'), null);
    assert.equal(d.parseDeviceEventLine('[AUT-DEVICE] {"evt":"x"}'), null);
    assert.equal(d.parseDeviceEventLine('[AUT-DEVICE] 42'), null);
});

test('AUT-INFRA-001: a throwing sink never reaches the caller', async () => {
    const d = await load();
    d.configureDeviceDiagnostics({ enabled: true, sink: () => { throw new Error('sink failure'); } });
    assert.doesNotThrow(() => d.emitDeviceEvent('touch_end', {}));
    d.configureDeviceDiagnostics({ enabled: false, sink: () => {} });
});

test('AUT-INFRA-001: error hook chains the existing native handler and is inert when disabled', async () => {
    const d = await load();
    const lines = [];
    const calls = [];
    const host = { __errorHandler: (...args) => { calls.push(args); return 'previous'; } };
    d.configureDeviceDiagnostics({ enabled: false, sink: (line) => lines.push(line) });
    d.installDeviceErrorHook(host);
    assert.equal(host.__autDeviceErrorHookInstalled, undefined, 'disabled diagnostics must not install hooks');

    const listeners = {};
    host.addEventListener = (type, listener) => { listeners[type] = listener; };
    d.configureDeviceDiagnostics({ enabled: true, sink: (line) => lines.push(line) });
    d.installDeviceErrorHook(host);
    d.installDeviceErrorHook(host); // idempotent
    assert.equal(host.__errorHandler('a.js', 12, 'TypeError: x', 'stack'), 'previous');
    assert.deepEqual(calls, [['a.js', 12, 'TypeError: x', 'stack']]);
    listeners.error({ message: 'window boom', error: { stack: 's' } });
    const events = lines.map((line) => d.parseDeviceEventLine(line));
    assert.deepEqual(events.map((e) => [e.evt, e.source]), [['error', 'native_error_handler'], ['error', 'window_error']]);
    assert.equal(events[0].message, 'TypeError: x');
    d.configureDeviceDiagnostics({ enabled: false });
});

test('AUT-INFRA-001: protocol module is engine-free and only DEBUG builds enable it', async () => {
    const source = await readFile(diagnosticsPath, 'utf8');
    assert.doesNotMatch(source, /from\s+['"]cc(\/env)?['"]/);
    assert.match(source, /enabled: false/);
    const bootstrap = await readFile(path.join(repoRoot, 'assets/scripts/presentation/FactoryWorldBootstrap.ts'), 'utf8');
    assert.match(bootstrap, /import \{ DEBUG \} from 'cc\/env';/);
    assert.match(bootstrap, /configureDeviceDiagnostics\(\{ enabled: DEBUG === true \}\)/);
    const enableCalls = [];
    for (const file of ['ProducerSelectionController.ts', 'FirstAutomationPresentationController.ts', 'FactoryWorldBootstrap.ts']) {
        const text = await readFile(path.join(repoRoot, 'assets/scripts/presentation', file), 'utf8');
        if (/configureDeviceDiagnostics\(/.test(text)) enableCalls.push(file);
    }
    const camera = await readFile(path.join(repoRoot, 'assets/scripts/camera/MobileCameraController.ts'), 'utf8');
    assert.doesNotMatch(camera, /configureDeviceDiagnostics\(/);
    assert.deepEqual(enableCalls, ['FactoryWorldBootstrap.ts'], 'only the FactoryWorld bootstrap may enable diagnostics');
});

test('AUT-INFRA-001: diagnostics hooks are emit-only (every emit is a plain statement)', async () => {
    for (const file of ['presentation/ProducerSelectionController.ts', 'presentation/FirstAutomationPresentationController.ts', 'camera/MobileCameraController.ts']) {
        const text = await readFile(path.join(repoRoot, 'assets/scripts', file), 'utf8');
        assert.doesNotMatch(text, /=\s*emitDeviceEvent\(/, `${file} must not use an emit return value`);
        assert.doesNotMatch(text, /if\s*\(\s*!?emitDeviceEvent/, `${file} must not branch on emit`);
    }
});
