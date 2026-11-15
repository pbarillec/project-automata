import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { BUILD_INFO_DATA } from '../assets/scripts/logging/BuildInfoData.ts';
import { BUILD_INFO_ENGINE, buildInfoEventPayload, createBuildInfo, formatBuildTag } from '../assets/scripts/logging/BuildInfo.ts';
import { LOG_CATEGORIES, LOG_LEVELS, createLogger, isLogLevelEnabled, minimumLogLevel, sanitizeLogMessage, type LogEntry } from '../assets/scripts/logging/Log.ts';
import { CURRENT_SAVE_VERSION } from '../assets/scripts/persistence/SaveEnvelope.ts';
import { GAME_SESSION_DEV_GAME_VERSION } from '../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import { DEVICE_EVENT_TYPES, configureDeviceDiagnostics, emitDeviceEvent } from '../assets/scripts/presentation/DeviceDiagnostics.ts';
import { describeBuildInfo, renderRevealSummary, DEFAULT_REVEAL_EVENT_TYPES, type TimelineEvent } from '../tools/device/reveal_capture.ts';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const tool = require('../tools/ci/write_build_info.js') as {
    DEFAULT_GAME_VERSION: string;
    renderBuildInfoData: (values: Record<string, unknown>) => string;
    applyBuildInfo: (options: { targetPath: string; identity: Record<string, unknown> }) => () => void;
    readGitIdentity: (cwd?: string) => { gitSha: string; buildNumber: number; gitDirty: boolean };
};

test('committed BuildInfoData is the safe default and needs no build step', () => {
    assert.deepEqual({ ...BUILD_INFO_DATA }, { gameVersion: '0.1.0-dev', buildNumber: 0, gitSha: 'unknown', gitDirty: false });
    assert.equal(GAME_SESSION_DEV_GAME_VERSION, BUILD_INFO_DATA.gameVersion);
    assert.equal(tool.DEFAULT_GAME_VERSION, BUILD_INFO_DATA.gameVersion);
});

test('BuildInfo has the full shape from one source of truth', () => {
    const info = createBuildInfo({ contentVersion: '0.1.0-aut-010', buildType: 'DEBUG', platform: 'android' });
    assert.deepEqual({ ...info }, {
        gameVersion: '0.1.0-dev', buildNumber: 0, saveVersion: CURRENT_SAVE_VERSION, contentVersion: '0.1.0-aut-010',
        engine: 'cocos-creator 3.8.8', gitSha: 'unknown', gitDirty: false, buildType: 'DEBUG', platform: 'android',
    });
    assert.equal(BUILD_INFO_ENGINE, 'cocos-creator 3.8.8');
    assert.equal(createBuildInfo({ contentVersion: 'c', buildType: 'RELEASE' }).platform, 'unknown');
    const stamped = createBuildInfo({ contentVersion: 'c', buildType: 'RELEASE', data: { gameVersion: '1.2.3', buildNumber: 42, gitSha: 'abcd1234', gitDirty: true } });
    assert.equal(formatBuildTag(stamped), 'abcd1234+ RELEASE');
    assert.equal(formatBuildTag(info), 'unknown DEBUG');
    assert.deepEqual(Object.keys(buildInfoEventPayload(stamped)).sort(), ['buildNumber', 'buildType', 'contentVersion', 'engine', 'gameVersion', 'gitDirty', 'gitSha', 'platform', 'saveVersion']);
});

test('log categories and levels are the standard set', () => {
    assert.deepEqual([...LOG_CATEGORIES], ['game', 'build', 'save', 'time', 'economy', 'ads', 'purchase', 'consent', 'analytics', 'presentation', 'perf', 'debug']);
    assert.deepEqual([...LOG_LEVELS], ['debug', 'info', 'warn', 'error']);
});

test('release policy logs only warn/error, DEBUG logs everything', () => {
    assert.equal(minimumLogLevel('RELEASE'), 'warn');
    assert.equal(minimumLogLevel('DEBUG'), 'debug');
    const run = (buildType: 'DEBUG' | 'RELEASE') => {
        const lines: LogEntry[] = [];
        const log = createLogger({ buildType, sink: (e) => lines.push(e) });
        log.debug('game', 'd'); log.info('build', 'i'); log.warn('save', 'w'); log.error('perf', 'e');
        return lines.map((l) => `${l.level}:${l.category}:${l.message}`);
    };
    assert.deepEqual(run('RELEASE'), ['warn:save:w', 'error:perf:e']);
    assert.deepEqual(run('DEBUG'), ['debug:game:d', 'info:build:i', 'warn:save:w', 'error:perf:e']);
    assert.equal(isLogLevelEnabled('RELEASE', 'info'), false);
    assert.equal(isLogLevelEnabled('DEBUG', 'debug'), true);
});

test('pinned [AUT-0xx] prefixes pass through verbatim and a throwing sink never reaches the caller', () => {
    const lines: string[] = [];
    const log = createLogger({ buildType: 'RELEASE', sink: (e) => lines.push(e.message) });
    log.warn('save', '[AUT-071] Save load failed (read_error): disk full');
    log.warn('presentation', '[AUT-044] Missing serialized prefab for chassis.');
    assert.deepEqual(lines, ['[AUT-071] Save load failed (read_error): disk full', '[AUT-044] Missing serialized prefab for chassis.']);
    const bad = createLogger({ buildType: 'DEBUG', sink: () => { throw new Error('sink down'); } });
    assert.doesNotThrow(() => { bad.error('game', 'x'); bad.rawLine('x'); });
});

test('sanitization removes tokens, receipts, ids, prices and emails but keeps normal diagnostics', () => {
    const cases: Array<[string, RegExp[]]> = [
        ['purchaseToken=abcDEF123456 granted', [/purchaseToken=\[redacted\]/]],
        ['receipt: "GPA.1234-5678-9012-34567" ok', [/receipt: "\[redacted\]/]],
        ['Authorization: Bearer eyJhbGciOi.payload.sig', [/Bearer \[redacted\]/]],
        ['playerId=12345 userId:u-9', [/playerId=\[redacted\]/, /userId:\[redacted\]/]],
        ['advertisingId=38400000-8cf0-11bd-b23e-10b96e40000d', [/advertisingId=\[redacted\]/]],
        ['mail me at someone@example.com now', [/\[redacted\] now/]],
        ['price=$4.99 shown', [/price=\[redacted\]/]],
        ['costs $4.99 or 3,49 EUR', [/costs \[price\] or \[price\]/]],
        [`opaque ${'A1b2C3d4'.repeat(6)} blob`, [/opaque \[redacted\] blob/]],
    ];
    for (const [input, expected] of cases) {
        const out = sanitizeLogMessage(input);
        for (const pattern of expected) assert.match(out, pattern, `${input} -> ${out}`);
        assert.doesNotMatch(out, /abcDEF123456|GPA\.1234|eyJhbGciOi|12345|u-9|38400000|someone@|4\.99|3,49|A1b2C3d4/);
    }
    const keep = '[AUT-039] Missing serialized prefab for b0330000-0000-4000-8000-000000000010.';
    assert.equal(sanitizeLogMessage(keep), keep);
    assert.equal(sanitizeLogMessage('[AUT-071] Save recovery: loaded_backup (unreadable copy preserved: ok).'), '[AUT-071] Save recovery: loaded_backup (unreadable copy preserved: ok).');
    // The facade applies it on every entry, in DEBUG too.
    const lines: string[] = [];
    createLogger({ buildType: 'DEBUG', sink: (e) => lines.push(e.message) }).info('purchase', 'token=secret123 receipt=abc');
    assert.equal(lines[0], 'token=[redacted] receipt=[redacted]');
});

test('emitDeviceEvent stays DEBUG-gated and build_info is a registered, captured event', () => {
    assert.ok(DEVICE_EVENT_TYPES.includes('build_info'));
    assert.ok(DEFAULT_REVEAL_EVENT_TYPES.includes('build_info'));
    const lines: string[] = [];
    configureDeviceDiagnostics({ enabled: false, sink: (l) => lines.push(l) });
    emitDeviceEvent('build_info', { gitSha: 'abc' });
    assert.equal(lines.length, 0);
    configureDeviceDiagnostics({ enabled: true, sink: (l) => lines.push(l) });
    emitDeviceEvent('build_info', buildInfoEventPayload(createBuildInfo({ contentVersion: 'c', buildType: 'DEBUG' })));
    configureDeviceDiagnostics({ enabled: false });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^\[AUT-DEVICE\] \{"v":1,"seq":1,"evt":"build_info"/);
    assert.match(lines[0], /"gitSha":"unknown"/);
    // Bootstrap wiring: configured from DEBUG, build_info emitted only when diagnostics are enabled.
    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /configureLog\(\{ buildType: DEBUG === true \? 'DEBUG' : 'RELEASE' \}\)/);
    assert.match(bootstrap, /if \(!isDeviceDiagnosticsEnabled\(\)\) return;\s+const info = createBuildInfo/);
});

test('reveal summary identifies the build', () => {
    const ev = (evt: string, extra: Record<string, unknown>): TimelineEvent => ({ tMs: 0, event: { v: 1, seq: 1, evt, ...extra } });
    const withBuild = [ev('build_info', { gitSha: 'abcd1234', gitDirty: false, buildType: 'DEBUG', gameVersion: '0.1.0-dev', buildNumber: 7, saveVersion: 3, contentVersion: 'c1', engine: 'cocos-creator 3.8.8' })];
    assert.match(describeBuildInfo(withBuild), /^build: abcd1234 DEBUG \(version 0\.1\.0-dev #7, save v3, content c1, cocos-creator 3\.8\.8\)$/);
    assert.match(renderRevealSummary('x', [], withBuild, []), /\nbuild: abcd1234 DEBUG /);
    assert.equal(describeBuildInfo([]), 'build: unknown (no build_info event)');
});

test('write_build_info renders, validates and restores the tracked file byte-for-byte', () => {
    const rendered = tool.renderBuildInfoData({ gameVersion: '0.1.0-dev', gitSha: 'abcd1234', buildNumber: 12, gitDirty: true });
    assert.match(rendered, /gitSha: 'abcd1234',/);
    assert.match(rendered, /buildNumber: 12,/);
    assert.match(rendered, /gitDirty: true,/);
    // The default render equals the committed file (apart from the generated-file header comment).
    const body = (text: string) => text.replace(/^\/\/.*\n/gm, '');
    assert.equal(body(tool.renderBuildInfoData({})), body(read('assets/scripts/logging/BuildInfoData.ts')));
    assert.throws(() => tool.renderBuildInfoData({ gitSha: "x'; evil" }), /invalid gitSha/);
    assert.throws(() => tool.renderBuildInfoData({ gameVersion: "1'\n" }), /invalid gameVersion/);
    assert.throws(() => tool.renderBuildInfoData({ buildNumber: -1 }), /invalid buildNumber/);

    const dir = mkdtempSync(path.join(tmpdir(), 'aut072-'));
    try {
        const target = path.join(dir, 'BuildInfoData.ts');
        const original = Buffer.from('// committed\r\nexport const X = 1;\r\n');
        writeFileSync(target, original);
        const restore = tool.applyBuildInfo({ targetPath: target, identity: { gitSha: 'deadbeef', buildNumber: 5, gitDirty: false } });
        assert.match(readFileSync(target, 'utf8'), /gitSha: 'deadbeef'/);
        restore();
        restore();
        assert.ok(readFileSync(target).equals(original));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
    const identity = tool.readGitIdentity();
    assert.ok(identity.gitSha === 'unknown' || /^[0-9a-f]{4,40}$/.test(identity.gitSha));
    assert.ok(Number.isInteger(identity.buildNumber) && identity.buildNumber >= 0);
    const buildScript = read('tools/ci/build_android.js');
    assert.match(buildScript, /const restoreBuildInfo = applyBuildInfo\(\);/);
    assert.match(buildScript, /finally \{\s+restoreBuildInfo\(\);/);
});

/** Files allowed to call console.* directly: the facade itself and the pre-facade spike scenes. */
const CONSOLE_ALLOW_LIST = new Set([
    'assets/scripts/logging/Log.ts',
    'assets/scripts/app/AppStartup.ts',
    'assets/scripts/presentation/AssetRobotSpike.ts',
    'assets/scripts/presentation/CameraSpikeBootstrap.ts',
]);

function listTs(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) out.push(...listTs(full));
        else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full);
    }
    return out;
}

test('no direct console.* in assets/scripts outside the documented allow-list', () => {
    const offenders: string[] = [];
    for (const file of listTs(path.join(REPO_ROOT, 'assets', 'scripts'))) {
        const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
        if (CONSOLE_ALLOW_LIST.has(rel)) continue;
        read(rel).split('\n').forEach((line, index) => {
            const code = line.trim();
            if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
            if (/\bconsole\s*\./.test(code)) offenders.push(`${rel}:${index + 1}`);
        });
    }
    assert.deepEqual(offenders, [], 'route logging through assets/scripts/logging/Log.ts');
    for (const rel of CONSOLE_ALLOW_LIST) assert.ok(statSync(path.join(REPO_ROOT, rel)).isFile(), `${rel} allow-list entry must exist`);
});

test('migrated call sites keep their pinned prefixes', () => {
    const expectations: Array<[string, RegExp]> = [
        ['assets/scripts/presentation/FactoryWorldBootstrap.ts', /Log\.warn\('save', `\[AUT-071\] Save load failed \(/],
        ['assets/scripts/presentation/FactoryWorldBootstrap.ts', /Log\.warn\('save', `\[AUT-071\] Save recovery: /],
        ['assets/scripts/presentation/RobotPopulationController.ts', /Log\.warn\('perf', `\[AUT-041\] benchmark override ignored: /],
        ['assets/scripts/presentation/FabricatorVisualController.ts', /Log\.warn\('presentation', `\[AUT-038\] Missing serialized prefab for /],
        ['assets/scripts/presentation/FounderRobotVisual.ts', /Log\.warn\('presentation', `\[AUT-062\] shell tint skipped/],
    ];
    for (const [file, pattern] of expectations) assert.match(read(file), pattern, file);
});
