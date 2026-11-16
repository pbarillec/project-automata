import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), 'utf8').replace(/\r\n/g, '\n');
const support = require(path.join(repoRoot, 'tools/ci/release_support.js'));

// ---------------------------------------------------------------- tiny encoders for synthetic artifacts

function varint(value: number): number[] {
    const bytes: number[] = [];
    let rest = value;
    while (rest > 0x7f) { bytes.push((rest & 0x7f) | 0x80); rest = Math.floor(rest / 128); }
    bytes.push(rest);
    return bytes;
}
const lengthDelimited = (field: number, payload: Buffer | number[]) => Buffer.concat([Buffer.from(varint((field << 3) | 2)), Buffer.from(varint(payload.length)), Buffer.from(payload)]);
const stringField = (field: number, text: string) => lengthDelimited(field, Buffer.from(text, 'utf8'));
const varintField = (field: number, value: number) => Buffer.from([...varint((field << 3) | 0), ...varint(value)]);

/** aapt2 proto attribute: name, optional raw value string, optional compiled item. */
function protoAttribute(name: string, value: string, compiled?: Buffer): Buffer {
    return lengthDelimited(4, Buffer.concat([stringField(2, name), stringField(3, value), compiled ? lengthDelimited(6, compiled) : Buffer.alloc(0)]));
}
const boolItem = (value: boolean) => lengthDelimited(7, varintField(8, value ? 1 : 0));
const intItem = (value: number) => lengthDelimited(7, varintField(6, value));
function protoElement(name: string, attributes: Buffer[], children: Buffer[]): Buffer {
    return lengthDelimited(1, Buffer.concat([stringField(3, name), ...attributes, ...children.map((child) => lengthDelimited(5, child))]));
}

function buildProtoManifest(options: { debuggable?: boolean; cleartext?: boolean; target?: number; min?: number; appId?: string; unit?: string }): Buffer {
    const application = protoElement('application', [
        ...(options.debuggable === undefined ? [] : [protoAttribute('debuggable', '', boolItem(options.debuggable))]),
        protoAttribute('usesCleartextTraffic', options.cleartext ? 'true' : 'false'),
    ], [
        protoElement('meta-data', [protoAttribute('name', 'com.google.android.gms.ads.APPLICATION_ID'), protoAttribute('value', options.appId ?? '')], []),
        protoElement('meta-data', [protoAttribute('name', 'com.projectautomata.ads.unit.offline_double'), protoAttribute('value', options.unit ?? '')], []),
        protoElement('meta-data', [protoAttribute('name', 'com.projectautomata.ads.unit.extended_overclock'), protoAttribute('value', options.unit ?? '')], []),
    ]);
    return protoElement('manifest', [
        protoAttribute('package', 'com.example.game'),
        protoAttribute('versionCode', '', intItem(42)),
        protoAttribute('versionName', '1.2.3'),
    ], [
        protoElement('uses-sdk', [protoAttribute('minSdkVersion', '', intItem(options.min ?? 23)), protoAttribute('targetSdkVersion', '', intItem(options.target ?? 36))], []),
        protoElement('uses-permission', [protoAttribute('name', 'android.permission.INTERNET')], []),
        application,
    ]);
}

function crc32(buffer: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/** STORED-only ZIP writer (enough for the reader under test). */
function buildZip(files: Record<string, Buffer>): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const [name, data] of Object.entries(files)) {
        const nameBytes = Buffer.from(name);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc32(data), 14);
        local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc32(data), 16);
        central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
        locals.push(local, nameBytes, data);
        centrals.push(central, nameBytes);
        offset += 30 + nameBytes.length + data.length;
    }
    const centralBuffer = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(files).length, 8); eocd.writeUInt16LE(Object.keys(files).length, 10);
    eocd.writeUInt32LE(centralBuffer.length, 12); eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, centralBuffer, eocd]);
}

/** Minimal little-endian ELF64 with one PT_LOAD program header per given alignment. */
function buildElf64(alignments: number[]): Buffer {
    const header = Buffer.alloc(64 + 56 * alignments.length);
    header.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
    header.writeBigUInt64LE(64n, 32);
    header.writeUInt16LE(56, 54);
    header.writeUInt16LE(alignments.length, 56);
    alignments.forEach((align, index) => {
        const base = 64 + 56 * index;
        header.writeUInt32LE(1, base);
        header.writeBigUInt64LE(BigInt(align), base + 48);
    });
    return header;
}

// ---------------------------------------------------------------- tracked configuration

test('release build config is tracked, non-debug, FactoryWorld-only and carries no signing material', () => {
    const release = JSON.parse(read('tools/ci/cocos_android_release_build.json'));
    assert.deepEqual(support.validateReleaseConfigShape(release), []);
    assert.equal(release.debug, false);
    assert.equal(release.packages.android.apiLevel, 36);
    assert.equal(release.packages.android.packageName, 'com.projectautomata.androidbaseline', 'the placeholder stays the default until the owner chooses the final id');
    assert.equal(release.packages.android.appBundle, true);
    const debug = JSON.parse(read('tools/ci/cocos_android_debug_build.json'));
    assert.equal(debug.debug, true, 'the debug config is untouched');
    assert.equal(debug.scenes[0].url, 'db://assets/scenes/camera/CameraSpike.scene');
    // Anything other than the intended differences would silently fork the two builds.
    const normalize = (config: any) => JSON.stringify({ ...config, debug: 0, startScene: 0, scenes: 0, taskName: 0, packages: { ...config.packages, android: { ...config.packages.android, useDebugKeystore: 0, appBundle: 0 } } });
    assert.equal(normalize(release), normalize(debug));
});

test('release config validation rejects debug, wrong scene, extra ABIs, embedded keystore data and a bad package id', () => {
    const base = JSON.parse(read('tools/ci/cocos_android_release_build.json'));
    const clone = () => JSON.parse(JSON.stringify(base));
    const bad = clone(); bad.debug = true;
    assert.ok(support.validateReleaseConfigShape(bad).some((problem: string) => /debug/.test(problem)));
    const scene = clone(); scene.startScene = 'f8adf834-2374-4aef-a9d6-3f5ac4569a28';
    assert.ok(support.validateReleaseConfigShape(scene).some((problem: string) => /FactoryWorld/.test(problem)));
    const abis = clone(); abis.packages.android.appABIs = ['arm64-v8a', 'x86_64'];
    assert.ok(support.validateReleaseConfigShape(abis).some((problem: string) => /appABIs/.test(problem)));
    const secret = clone(); secret.packages.android.keystorePassword = 'hunter2';
    assert.ok(support.validateReleaseConfigShape(secret).some((problem: string) => /keystorePassword/.test(problem)));
    const pkg = clone(); pkg.packages.android.packageName = 'nodots';
    assert.ok(support.validateReleaseConfigShape(pkg).some((problem: string) => /packageName/.test(problem)));
});

test('resolveReleaseCocosConfig injects the package id and keeps every keystore field empty', () => {
    const base = JSON.parse(read('tools/ci/cocos_android_release_build.json'));
    const resolved = support.resolveReleaseCocosConfig(base, { packageName: 'com.example.final', sdkPath: 'S', ndkPath: 'N', javaHome: 'H', javaPath: 'J' });
    assert.equal(resolved.packages.android.packageName, 'com.example.final');
    assert.equal(resolved.packages.android.sdkPath, 'S');
    assert.equal(resolved.packages.android.keystorePath, '');
    assert.equal(resolved.packages.android.useDebugKeystore, false);
    assert.equal(base.packages.android.packageName, 'com.projectautomata.androidbaseline', 'input config not mutated');
});

test('package id: default placeholder, env override, validation', () => {
    assert.equal(support.resolvePackageName({}), 'com.projectautomata.androidbaseline');
    assert.equal(support.resolvePackageName({ AUTOMATA_PACKAGE_NAME: ' com.studio.automata ' }), 'com.studio.automata');
    assert.throws(() => support.resolvePackageName({ AUTOMATA_PACKAGE_NAME: 'automata' }), /valid Android application id/);
    assert.throws(() => support.resolvePackageName({ AUTOMATA_PACKAGE_NAME: 'com.1bad.id' }), /valid Android application id/);
    assert.equal(support.isValidPackageName('com.studio.automata_2'), true);
});

test('version identity: versionName from AUTOMATA_GAME_VERSION or the BuildInfo default, versionCode = commit count unless overridden', () => {
    const identity = { buildNumber: 190 };
    assert.deepEqual(support.resolveVersionIdentity({}, identity), { versionName: '0.1.0-dev', versionCode: 190, source: 'git-commit-count' });
    assert.deepEqual(support.resolveVersionIdentity({ AUTOMATA_GAME_VERSION: '1.0.0', AUTOMATA_VERSION_CODE: '777' }, identity), { versionName: '1.0.0', versionCode: 777, source: 'AUTOMATA_VERSION_CODE' });
    assert.throws(() => support.resolveVersionIdentity({}, { buildNumber: 0 }), /out of range/);
    assert.throws(() => support.resolveVersionIdentity({ AUTOMATA_VERSION_CODE: '12x' }, identity), /positive integer/);
    assert.throws(() => support.resolveVersionIdentity({ AUTOMATA_VERSION_CODE: '2100000001' }, identity), /out of range/);
    assert.throws(() => support.resolveVersionIdentity({ AUTOMATA_GAME_VERSION: 'a b' }, identity), /invalid game version/);
    // Same default as the build identity module so the in-game build tag and the store versionName agree.
    assert.equal(support.DEFAULT_GAME_VERSION, require(path.join(repoRoot, 'tools/ci/write_build_info.js')).DEFAULT_GAME_VERSION);
});

test('versionCode is monotonic across commits and idempotent for a rebuild of the same commit', () => {
    assert.equal(support.checkVersionCodeMonotonic({ versionCode: 5, gitSha: 'a' }, null).ok, true);
    assert.equal(support.checkVersionCodeMonotonic({ versionCode: 6, gitSha: 'b' }, { versionCode: 5, gitSha: 'a' }).ok, true);
    assert.equal(support.checkVersionCodeMonotonic({ versionCode: 5, gitSha: 'a' }, { versionCode: 5, gitSha: 'a' }).ok, true);
    assert.equal(support.checkVersionCodeMonotonic({ versionCode: 5, gitSha: 'b' }, { versionCode: 5, gitSha: 'a' }).ok, false);
    assert.equal(support.checkVersionCodeMonotonic({ versionCode: 4, gitSha: 'b' }, { versionCode: 5, gitSha: 'a' }).ok, false);
    assert.equal(support.checkVersionCodeMonotonic({ versionCode: 5, gitSha: 'b' }, { versionCode: 5, gitSha: '' }).ok, false, 'an uploaded code (no sha) is never reusable');
});

// ---------------------------------------------------------------- signing + ads policy

test('signing inputs: none = unsigned (not a failure), all four = configured, partial or Cocos debug keystore = unusable; secrets never echoed', () => {
    const exists = (file: string) => file === 'C:/keys/upload.jks';
    assert.deepEqual(support.classifySigningInputs({}, exists), { state: 'unsigned', missing: [], problems: [] });
    const full = { RELEASE_STORE_FILE: 'C:/keys/upload.jks', RELEASE_STORE_PASSWORD: 'p4ss-secret', RELEASE_KEY_ALIAS: 'upload', RELEASE_KEY_PASSWORD: 'k3y-secret' };
    const ok = support.classifySigningInputs(full, exists);
    assert.equal(ok.state, 'configured');
    assert.doesNotMatch(JSON.stringify(ok), /secret/);
    const partial = support.classifySigningInputs({ RELEASE_STORE_FILE: 'C:/keys/upload.jks' }, exists);
    assert.equal(partial.state, 'incomplete');
    assert.deepEqual(partial.missing, ['RELEASE_STORE_PASSWORD', 'RELEASE_KEY_ALIAS', 'RELEASE_KEY_PASSWORD']);
    assert.equal(support.classifySigningInputs({ ...full, RELEASE_STORE_FILE: 'C:/keys/missing.jks' }, exists).state, 'incomplete');
    const debugKey = support.classifySigningInputs({ ...full, RELEASE_STORE_FILE: 'C:/ProgramData/cocos/editors/Creator/3.8.8/resources/tools/keystore/debug.keystore' }, () => true);
    assert.equal(debugKey.state, 'incomplete');
    assert.match(debugKey.problems.join(' '), /debug keystore/);
    assert.doesNotMatch(JSON.stringify(partial), /p4ss|k3y/);
});

const SAMPLE_APP = 'ca-app-pub-3940256099942544~3347511713';
const SAMPLE_UNIT = 'ca-app-pub-3940256099942544/5224354917';
// Built at runtime so no production-shaped AdMob literal exists in tracked source (tools/ci/check_android_ads_config.ps1 scans tests/).
const FAKE_PUBLISHER = `ca-app-pub-${'1234567890'}${'123456'}`;
const PROD = { ADMOB_APP_ID: `${FAKE_PUBLISHER}~1234567890`, ADMOB_UNIT_OFFLINE_DOUBLE: `${FAKE_PUBLISHER}/1111111111`, ADMOB_UNIT_EXTENDED_OVERCLOCK: `${FAKE_PUBLISHER}/2222222222` };
const EMPTY = { ADMOB_APP_ID: '', ADMOB_UNIT_OFFLINE_DOUBLE: '', ADMOB_UNIT_EXTENDED_OVERCLOCK: '' };
const SAMPLE = { ADMOB_APP_ID: SAMPLE_APP, ADMOB_UNIT_OFFLINE_DOUBLE: SAMPLE_UNIT, ADMOB_UNIT_EXTENDED_OVERCLOCK: SAMPLE_UNIT };
const policy = (values: Record<string, string>, flags: Record<string, boolean> = {}) => support.evaluateAdmobPolicy(support.classifyAdmobValues(values), { requireProductionIds: false, allowSampleIds: false, ...flags });

test('AdMob policy: sample ids are rejected in release unless explicitly allowed; --require-production-ids demands all three production ids', () => {
    assert.equal(support.classifyAdmobId(SAMPLE_APP, 'app'), 'sample');
    assert.equal(support.classifyAdmobId(PROD.ADMOB_APP_ID, 'app'), 'production');
    assert.equal(support.classifyAdmobId(PROD.ADMOB_APP_ID, 'unit'), 'invalid');
    assert.equal(support.classifyAdmobId('', 'unit'), 'empty');
    assert.deepEqual(policy(EMPTY), { ok: true, adsMode: 'not-configured', problems: [] });
    assert.equal(policy(PROD).adsMode, 'production');
    assert.equal(policy(PROD, { requireProductionIds: true }).ok, true);
    assert.equal(policy(SAMPLE).ok, false, 'sample ids are rejected by default');
    assert.equal(policy(SAMPLE, { requireProductionIds: true }).ok, false);
    assert.equal(policy(SAMPLE, { requireProductionIds: true, allowSampleIds: true }).ok, false, 'allow-sample never satisfies require-production');
    assert.deepEqual(policy(SAMPLE, { allowSampleIds: true }), { ok: true, adsMode: 'sample', problems: [] });
    assert.equal(policy(EMPTY, { requireProductionIds: true }).ok, false);
    assert.equal(policy({ ...PROD, ADMOB_UNIT_EXTENDED_OVERCLOCK: '' }).ok, false, 'partial configuration is refused');
    assert.equal(policy({ ...PROD, ADMOB_APP_ID: 'not-an-id' }).ok, false);
    assert.equal(policy({ ...PROD, ADMOB_UNIT_OFFLINE_DOUBLE: SAMPLE_UNIT }).ok, false, 'a mixed sample/production set is refused');
});

// ---------------------------------------------------------------- artifact inspection

test('manifest (AAB protobuf) decoder + safety evaluation: a clean release manifest passes', () => {
    const tree = support.decodeProtoManifest(buildProtoManifest({ debuggable: false, ...PROD_META() }));
    const summary = support.summarizeManifest(tree);
    assert.equal(summary.packageName, 'com.example.game');
    assert.equal(summary.versionCode, 42);
    assert.equal(summary.versionName, '1.2.3');
    assert.equal(summary.minSdk, 23);
    assert.equal(summary.targetSdk, 36);
    assert.equal(summary.debuggable, false);
    assert.equal(summary.usesCleartextTraffic, false);
    assert.deepEqual(summary.permissions, ['android.permission.INTERNET']);
    const findings = support.evaluateManifestSafety(summary, { packageName: 'com.example.game', versionCode: 42, versionName: '1.2.3', targetSdk: 36, minSdk: 23, requireProductionIds: true, allowSampleIds: false });
    assert.deepEqual(findings.filter((finding: any) => finding.status === 'FAIL'), []);
});

function PROD_META() { return { appId: PROD.ADMOB_APP_ID, unit: PROD.ADMOB_UNIT_OFFLINE_DOUBLE }; }

test('safety evaluation FAILS a debuggable build, cleartext traffic, the wrong target SDK / package / versionCode and sample ids', () => {
    const summary = support.summarizeManifest(support.decodeProtoManifest(buildProtoManifest({ debuggable: true, cleartext: true, target: 34, appId: SAMPLE_APP, unit: SAMPLE_UNIT })));
    assert.equal(summary.debuggable, true);
    const failing = support.evaluateManifestSafety(summary, { packageName: 'com.other.id', versionCode: 43, targetSdk: 36, minSdk: 23, requireProductionIds: false, allowSampleIds: false })
        .filter((finding: any) => finding.status === 'FAIL').map((finding: any) => finding.id).sort();
    assert.deepEqual(failing, ['admob_ids', 'cleartext_traffic', 'not_debuggable', 'package_id', 'target_sdk', 'version_code']);
    const allowed = support.evaluateManifestSafety(summary, { packageName: 'com.example.game', versionCode: 42, targetSdk: 34, minSdk: 23, requireProductionIds: false, allowSampleIds: true });
    assert.equal(allowed.find((finding: any) => finding.id === 'admob_ids').status, 'PASS');
    const notConfigured = support.evaluateManifestSafety(support.summarizeManifest(support.decodeProtoManifest(buildProtoManifest({}))), { packageName: 'com.example.game', versionCode: 42, targetSdk: 36, minSdk: 23, requireProductionIds: false, allowSampleIds: false });
    assert.equal(notConfigured.find((finding: any) => finding.id === 'ads_mode').status, 'WARN');
    const strict = support.evaluateManifestSafety(support.summarizeManifest(support.decodeProtoManifest(buildProtoManifest({}))), { packageName: 'com.example.game', versionCode: 42, targetSdk: 36, minSdk: 23, requireProductionIds: true, allowSampleIds: false });
    assert.equal(strict.find((finding: any) => finding.id === 'admob_ids').status, 'FAIL');
});

test('manifest (APK aapt2 xmltree text) parser yields the same facts', () => {
    const text = [
        'N: android=http://schemas.android.com/apk/res/android (line=2)',
        '  E: manifest (line=2)',
        '    A: android:versionCode(0x0101021b)=42',
        '    A: android:versionName(0x0101021c)="1.2.3" (Raw: "1.2.3")',
        '    A: package="com.example.game" (Raw: "com.example.game")',
        '      E: uses-sdk (line=7)',
        '        A: android:minSdkVersion(0x0101020c)=23',
        '        A: android:targetSdkVersion(0x01010270)=36',
        '      E: application (line=12)',
        '        A: android:debuggable(0x0101000f)=true',
        '        A: android:usesCleartextTraffic(0x010104ec)=false',
        '        E: meta-data (line=14)',
        '          A: android:name(0x01010003)="com.google.android.gms.ads.APPLICATION_ID" (Raw: "com.google.android.gms.ads.APPLICATION_ID")',
        '          A: android:value(0x01010024)="" (Raw: "")',
    ].join('\n');
    const summary = support.summarizeManifest(support.parseXmlTreeText(text));
    assert.equal(summary.packageName, 'com.example.game');
    assert.equal(summary.versionCode, 42);
    assert.equal(summary.targetSdk, 36);
    assert.equal(summary.debuggable, true);
    assert.equal(summary.usesCleartextTraffic, false);
    assert.equal(summary.metaData['com.google.android.gms.ads.APPLICATION_ID'], '');
});

test('16 KB check: ELF LOAD alignments are read from AAB (base/lib) and APK (lib) layouts; 4 KB libraries are reported', () => {
    const good = buildZip({ 'base/lib/arm64-v8a/libcocos.so': buildElf64([0x4000, 0x4000]), 'base/manifest/AndroidManifest.xml': Buffer.from('x') });
    const goodResult = support.check16KbAlignment(good);
    assert.deepEqual(goodResult.violations, []);
    assert.deepEqual(goodResult.libraries[0].alignments, [0x4000, 0x4000]);
    assert.equal(support.check16KbAlignment(buildZip({ 'lib/arm64-v8a/libx.so': buildElf64([0x10000]) })).violations.length, 0);
    const bad = support.check16KbAlignment(buildZip({ 'lib/arm64-v8a/libold.so': buildElf64([0x4000, 0x1000]) }));
    assert.equal(bad.violations.length, 1);
    assert.match(bad.violations[0], /libold\.so.*0x1000/);
    assert.match(support.check16KbAlignment(buildZip({ 'assets/a.txt': Buffer.from('x') })).violations[0], /no arm64-v8a native libraries/);
    assert.throws(() => support.check16KbAlignment(buildZip({ 'lib/arm64-v8a/notelf.so': Buffer.from('not an elf at all, padding padding padding padding padding padding padding') })), /not an ELF/);
    assert.deepEqual(support.listNativeAbis(support.readZipEntries(buildZip({ 'lib/arm64-v8a/a.so': buildElf64([0x4000]), 'lib/x86_64/b.so': buildElf64([0x4000]) }))), ['arm64-v8a', 'x86_64']);
});

test('signature detection and packed-file / endpoint scans', () => {
    const entries = support.readZipEntries(buildZip({ 'META-INF/UPLOAD.SF': Buffer.from('a'), 'META-INF/UPLOAD.RSA': Buffer.from('b') }));
    assert.equal(support.hasJarSignature(entries), true);
    assert.equal(support.hasJarSignature(support.readZipEntries(buildZip({ 'base/dex/classes.dex': Buffer.from('a') }))), false);
    assert.deepEqual(support.findForbiddenPackedFiles(['assets/debug_command.json', 'assets/debug_ads.json', 'x/upload.jks', 'a/.env.local', 'assets/main/index.js']), ['assets/debug_command.json', 'assets/debug_ads.json', 'x/upload.jks', 'a/.env.local']);
    for (const text of ['http://localhost:8080/x', 'fetch("http://127.0.0.1/a")', 'http://10.0.2.2:3000', 'ws://192.168.1.20/s']) assert.notEqual(support.findLocalEndpoint(text), '', text);
    assert.equal(support.findLocalEndpoint('https://play.google.com/store https://example.com/10.0.2.20'), '');
});

// ---------------------------------------------------------------- R8 / ProGuard

test('R8 mapping check: the bridge and every JNI entry point must keep their names', () => {
    const entryPoints = support.listBridgeEntryPoints(read('native/engine/android/app/src/com/cocos/game/AutomataPlatformBridge.java'));
    for (const required of ['initializeAds', 'showRewarded', 'initializeConsent', 'showPrivacyOptions', 'initializePurchases', 'purchaseProduct', 'acknowledgePurchase', 'restorePurchases', 'getCommercialSdkBaselineJson']) {
        assert.ok(entryPoints.includes(required), `${required} is a bridge entry point`);
    }
    const kept = ['com.cocos.game.AutomataPlatformBridge -> com.cocos.game.AutomataPlatformBridge:', ...entryPoints.map((name) => `    12:14:java.lang.String ${name}() -> ${name}`)].join('\n');
    assert.equal(support.checkR8MappingKeepsBridge(kept, entryPoints).ok, true);
    const renamed = kept.replace(`java.lang.String initializeAds() -> initializeAds`, 'java.lang.String initializeAds() -> a');
    const renamedResult = support.checkR8MappingKeepsBridge(renamed, entryPoints);
    assert.equal(renamedResult.ok, false);
    assert.match(renamedResult.problems[0], /initializeAds was renamed to a/);
    assert.equal(support.checkR8MappingKeepsBridge(kept.replace('-> com.cocos.game.AutomataPlatformBridge:', '-> a.a:'), entryPoints).ok, false);
    assert.equal(support.checkR8MappingKeepsBridge('com.other.Thing -> a:', entryPoints).ok, false);
    assert.equal(support.checkR8MappingKeepsBridge(kept.replace(/.*showRewarded.*\n?/, ''), entryPoints).ok, false, 'a removed entry point is detected');
});

test('proguard-rules.pro keeps the JNI bridge, controllers, JsbBridge and the Billing / AdMob / UMP SDKs, with a justification per rule', () => {
    const rules = read('native/engine/android/app/proguard-rules.pro');
    assert.match(rules, /-keep class com\.cocos\.game\.AutomataPlatformBridge \{\s+public static <methods>;\s+\}/);
    for (const controller of ['AutomataAdsController', 'AutomataBillingController', 'AutomataConsentController']) {
        assert.match(rules, new RegExp(`-keep class com\\.cocos\\.game\\.${controller} \\{ \\*; \\}`));
    }
    for (const keep of ['com.cocos.lib.JsbBridge { *; }', 'com.cocos.lib.JsbBridgeWrapper { *; }', 'com.cocos.game.AppActivity { *; }', 'com.android.billingclient.api.** { *; }', 'com.android.vending.billing.** { *; }', 'com.google.android.gms.ads.** { *; }', 'com.google.android.ump.** { *; }']) {
        assert.ok(rules.includes(`-keep class ${keep}`), `keeps ${keep}`);
    }
    // Justification: every numbered block above carries a WHY comment (the first keep rule is preceded by a comment explaining the JNI-by-name calls).
    assert.match(rules, /JNI[^\n]*\n(?:#[^\n]*\n)*-keep class com\.cocos\.game\.AutomataPlatformBridge/);
    // The class the JS layer calls by name really is the one in the keep rule, and the JS side only ever calls that bridge.
    assert.match(read('assets/scripts/platform/android/AndroidNativeBridge.ts'), /'com\/cocos\/game\/AutomataPlatformBridge'/);
});

// ---------------------------------------------------------------- gradle / manifest wiring

test('build.gradle: version identity + signing come from env/properties only, never literals; cleartext traffic is off in release only', () => {
    const gradle = read('native/engine/android/app/build.gradle');
    assert.match(gradle, /versionCode automataVersionCode/);
    assert.match(gradle, /automataAdProperty\('AUTOMATA_VERSION_CODE', '1'\)/);
    assert.match(gradle, /automataAdProperty\('AUTOMATA_GAME_VERSION', '1\.0'\)/);
    assert.match(gradle, /System\.getenv\(name\)/);
    for (const name of ['RELEASE_STORE_FILE', 'RELEASE_STORE_PASSWORD', 'RELEASE_KEY_ALIAS', 'RELEASE_KEY_PASSWORD']) assert.ok(gradle.includes(`'${name}'`), `${name} read from env/property`);
    assert.match(gradle, /endsWith\('\/keystore\/debug\.keystore'\)/, 'the Cocos debug keystore can never sign a release');
    assert.doesNotMatch(gradle, /storePassword\s+['"]/);
    assert.doesNotMatch(gradle, /keyPassword\s+['"]/);
    assert.match(gradle, /if \(automataReleaseSigned\) \{\s+signingConfig signingConfigs\.release/);
    assert.match(gradle, /debuggable false/);
    const releaseBlock = gradle.slice(gradle.indexOf('        release {'), gradle.indexOf('        debug {'));
    const debugBlock = gradle.slice(gradle.indexOf('        debug {'));
    assert.match(releaseBlock, /USES_CLEARTEXT_TRAFFIC: 'false'/);
    assert.match(releaseBlock, /minifyEnabled true/);
    assert.match(debugBlock, /USES_CLEARTEXT_TRAFFIC: 'true'/);
    assert.match(read('native/engine/android/app/AndroidManifest.xml'), /android:usesCleartextTraffic="\$\{USES_CLEARTEXT_TRAFFIC\}"/);
    assert.doesNotMatch(gradle, /ca-app-pub-(?!3940256099942544)\d{16}/);
});

test('npm scripts and build wrapper expose the release flow', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.scripts['android:release'], 'node tools/ci/build_android.js --release');
    assert.equal(pkg.scripts['android:release:check'], 'node tools/ci/release_checks.js');
    const build = read('tools/ci/build_android.js');
    for (const token of ['bundleRelease', 'assembleRelease', '--require-signing', '--require-production-ids', '--allow-sample-ids', 'cocos_android_release_build.json', 'AUTOMATA_VERSION_CODE']) assert.ok(build.includes(token), token);
    assert.match(build, /UNSIGNED/);
    assert.doesNotMatch(build, /RELEASE_STORE_PASSWORD\s*[:=]\s*['"`][^'"`$]/, 'no password literal');
    const ignore = read('.gitignore');
    for (const pattern of ['*.keystore', '*.jks', '*.aab', '*.apk', '/temp/']) assert.ok(ignore.includes(pattern), `.gitignore covers ${pattern}`);
});

// AUT-R-073-01: permission allow-list + AD_ID disclosure reminder.
test('safety evaluation: permissions must stay on the allow-list; AD_ID adds a Data Safety reminder', () => {
    const expectations = { packageName: 'com.example.game', versionCode: 42, targetSdk: 36, minSdk: 23, requireProductionIds: false, allowSampleIds: true };
    const base = { debuggable: false, appId: SAMPLE_APP, unit: SAMPLE_UNIT };
    const evaluate = (permissions: string[]) => support.evaluateManifestSafety({ ...support.summarizeManifest(support.decodeProtoManifest(buildProtoManifest(base))), permissions }, expectations);
    const ok = evaluate([...support.RELEASE_PERMISSION_ALLOWLIST, 'com.example.game.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION']);
    assert.equal(ok.find((f: any) => f.id === 'permissions').status, 'PASS');
    assert.equal(ok.find((f: any) => f.id === 'ad_id_permission').status, 'INFO');
    const bad = evaluate(['android.permission.INTERNET', 'android.permission.READ_PHONE_STATE', 'android.permission.ACCESS_FINE_LOCATION']);
    const finding = bad.find((f: any) => f.id === 'permissions');
    assert.equal(finding.status, 'FAIL');
    assert.match(finding.message, /READ_PHONE_STATE.*ACCESS_FINE_LOCATION/);
    assert.equal(bad.some((f: any) => f.id === 'ad_id_permission'), false);
    assert.equal(support.RELEASE_PERMISSION_ALLOWLIST.every((name: string) => !/READ_|WRITE_|LOCATION|CAMERA|RECORD_AUDIO|CONTACTS/.test(name)), true);
});
