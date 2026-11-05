const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const load = () => import(pathToFileURL(path.join(repoRoot, 'tools/device/adb.ts')).href);

const ok = (stdout = '') => ({ code: 0, stdout: Buffer.from(stdout), stderr: '', timedOut: false, durationMs: 1 });

test('AUT-INFRA-001: adb devices -l parsing (ready, unauthorized, offline, no permissions)', async () => {
    const { parseAdbDevices } = await load();
    const devices = parseAdbDevices([
        '* daemon not running; starting now at tcp:5037',
        'List of devices attached',
        '3B15BH0050L00000       device product:CPH2747 model:CPH2747 device:OP611FL1 transport_id:1',
        'R58M123               unauthorized usb:1-1 transport_id:2',
        'emulator-5554          offline',
        'XYZ                    no permissions (user in plugdev group); see [http://developer.android.com/tools/device.html]',
        '',
    ].join('\r\n'));
    assert.deepEqual(devices.map((d) => [d.serial, d.state]), [['3B15BH0050L00000', 'device'], ['R58M123', 'unauthorized'], ['emulator-5554', 'offline'], ['XYZ', 'no permissions']]);
    assert.equal(devices[0].model, 'CPH2747');
    assert.equal(devices[0].transportId, '1');
});

test('AUT-INFRA-001: explicit device selection; missing/unauthorized devices ask the human to connect and authorize', async () => {
    const { selectDevice, CONNECT_DEVICE_ACTION } = await load();
    assert.equal(CONNECT_DEVICE_ACTION, 'connect and authorize the Android device');
    const ready = { serial: 'A', state: 'device' };
    const ready2 = { serial: 'B', state: 'device' };
    const unauth = { serial: 'C', state: 'unauthorized' };
    const none = selectDevice([]);
    assert.equal(none.ok, false);
    assert.equal(none.reason, 'no_device');
    assert.equal(none.requiredHumanAction, CONNECT_DEVICE_ACTION);
    assert.equal(selectDevice([unauth]).reason, 'unauthorized');
    assert.equal(selectDevice([unauth]).requiredHumanAction, CONNECT_DEVICE_ACTION);
    assert.equal(selectDevice([{ serial: 'D', state: 'offline' }]).reason, 'offline');
    assert.equal(selectDevice([ready]).device.serial, 'A');
    assert.equal(selectDevice([ready, unauth]).device.serial, 'A');
    assert.equal(selectDevice([ready, ready2]).reason, 'multiple_devices');
    assert.equal(selectDevice([ready, ready2], 'B').device.serial, 'B');
    assert.equal(selectDevice([ready], 'Z').reason, 'serial_not_found');
    assert.equal(selectDevice([unauth], 'C').reason, 'unauthorized');
});

test('AUT-INFRA-001: every adb call has a timeout and failures are typed', async () => {
    const { AdbClient, AdbError } = await load();
    const calls = [];
    const exec = async (args, options) => {
        calls.push({ args, options });
        if (args.includes('tap')) return { code: null, stdout: Buffer.alloc(0), stderr: '', timedOut: true, durationMs: options.timeoutMs };
        if (args.includes('force-stop')) return { code: 1, stdout: Buffer.alloc(0), stderr: 'boom', timedOut: false, durationMs: 1 };
        if (args[0] === 'devices') return { code: 127, stdout: Buffer.alloc(0), stderr: 'spawn adb ENOENT', timedOut: false, durationMs: 1 };
        if (args.includes('install')) return ok('Performing Streamed Install\nFailure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]');
        return ok('ok');
    };
    const client = new AdbClient(exec, 'SER');
    await assert.rejects(client.tap(1, 2), (e) => e instanceof AdbError && e.kind === 'timeout');
    await assert.rejects(client.forceStop('pkg'), (e) => e instanceof AdbError && e.kind === 'command' && /boom/.test(e.detail));
    await assert.rejects(client.devices(), (e) => e instanceof AdbError && e.kind === 'missing_binary');
    await assert.rejects(client.install('x.apk'), (e) => e instanceof AdbError && /INSTALL_FAILED/.test(e.detail));
    await client.swipe(10.4, 20.6, 30, 40, 400);
    for (const call of calls) assert.ok(call.options.timeoutMs > 0, JSON.stringify(call.args));
    const swipe = calls.find((c) => c.args.includes('swipe'));
    assert.deepEqual(swipe.args, ['-s', 'SER', 'shell', 'input', 'swipe', '10', '21', '30', '40', '400']);
    assert.equal(calls.find((c) => c.args.includes('install')).options.timeoutMs, 180000);
    assert.deepEqual(client.logcatStreamArgs().slice(0, 4), ['-s', 'SER', 'logcat', '-v']);
    assert.ok(client.commandLog.length >= 5);
});

test('AUT-INFRA-001: screencap must return a PNG; size comes from the header', async () => {
    const { AdbClient, pngSize } = await load();
    const png = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.writeUInt32BE(2772, 16);
    png.writeUInt32BE(1272, 20);
    assert.deepEqual(pngSize(png), { width: 2772, height: 1272 });
    assert.equal(pngSize(Buffer.from('not a png at all, definitely not')), null);
    const good = new AdbClient(async () => ({ code: 0, stdout: png, stderr: '', timedOut: false, durationMs: 1 }));
    assert.equal((await good.screencap()).length, 33);
    const bad = new AdbClient(async () => ok('error: no devices'));
    await assert.rejects(bad.screencap());
});

test('AUT-INFRA-001: adb path resolution prefers ADB_PATH, then the SDK, then PATH', async () => {
    const { resolveAdbPath } = await load();
    const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
    assert.equal(resolveAdbPath({ ADB_PATH: '/x/adb' }, () => true), '/x/adb');
    const sdk = path.join('C:/Users/u/AppData/Local', 'Android', 'Sdk', 'platform-tools', exe);
    assert.equal(resolveAdbPath({ LOCALAPPDATA: 'C:/Users/u/AppData/Local' }, (p) => p === sdk), sdk);
    assert.equal(resolveAdbPath({}, () => false), exe);
});
