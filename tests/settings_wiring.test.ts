const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const BOOTSTRAP = 'assets/scripts/presentation/FactoryWorldBootstrap.ts';
const CONTROLLER = 'assets/scripts/presentation/SettingsController.ts';

function methodBody(source, signature) {
    const start = source.indexOf(signature);
    assert.ok(start >= 0, `method not found: ${signature}`);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
    }
    throw new Error('unbalanced');
}

// ---------------------------------------------------------------- bootstrap wiring

test('bootstrap loads the user settings BEFORE any UI is built, and builds the Settings root below the offline report root', () => {
    const source = stripComments(read(BOOTSTRAP));
    const start = methodBody(source, 'public start(): void {');
    assert.ok(start.indexOf('this.loadUserSettings();') >= 0);
    assert.ok(start.indexOf('this.loadUserSettings();') < start.indexOf('this.createUiRoot(site);'), 'settings load before the UI root');
    assert.ok(start.indexOf('this.loadUserSettings();') < start.indexOf('this.createCoreHud();'), 'settings load before the HUD paints');
    assert.ok(start.indexOf('this.createPermanentUpgrades();') < start.indexOf('this.createSettings();'));
    assert.ok(start.indexOf('this.createSettings();') < start.indexOf('this.createOfflineReport();'), 'the offline report root stays the LAST Canvas child');
    assert.match(start, /this\.sessionWiring = \{[^}]*settings, reboot, extendedOverclock \}/);
    // The load is synchronous and contained; later changes follow the store through its subscription.
    const load = methodBody(source, 'private loadUserSettings(): void {');
    assert.match(load, /new SettingsStore\(new CocosFileSystemPort\(\)/);
    assert.match(load, /this\.applyUserSettings\(store\.load\(\)\);/);
    assert.match(load, /store\.subscribe\(\(settings\) => this\.applyUserSettings\(settings\)\);/);
    assert.match(load, /catch \(error\)/);
    const apply = methodBody(source, 'private applyUserSettings(settings: UserSettings): void {');
    assert.match(apply, /this\.audio\.applySettings\(/);
    assert.match(apply, /this\.haptics\.setEnabled\(settings\.vibrationEnabled\);/);
    // The chip is suppressed while the offline card or the Reboot title card is up.
    const suppress = methodBody(source, 'private updateSettingsSuppression(): void {');
    assert.match(suppress, /offlineReport\.isVisible\(\)/);
    assert.match(suppress, /isRebootCardActive\(\)/);
    assert.match(suppress, /settings\.setSuppressed\(/);
    // DEBUG ui_layout reports the Settings rects.
    const layout = methodBody(source, 'private emitUiLayout(reason: string): void {');
    for (const key of ['SettingsChip', 'SettingsPanel', 'SettingsClose', 'SettingsRow']) assert.ok(layout.includes(key), key);
});

test('the Settings root and the AI Upgrades root keep the offline report as the last Canvas child; the bootstrap keeps its command emitter wiring', () => {
    const source = read(BOOTSTRAP);
    assert.equal((source.match(/commandEmitter =/g) ?? []).length, 5, 'settings add no command emitter; AUT-RBT-001 adds one (the Reboot modal)');
    assert.doesNotMatch(methodBody(stripComments(source), 'private createSettings(): SettingsController {'), /commandEmitter|submit\(/);
});

// ---------------------------------------------------------------- controller

test('SettingsController only observes the store and submits no GameCommand', () => {
    const source = stripComments(read(CONTROLLER));
    assert.doesNotMatch(source, /GameCommand|commandEmitter|binding|\.submit\(|LifecycleSession|GameState|AudioService|HapticsService/);
    assert.match(source, /store\.update\(row\.patch\)/);
    assert.match(source, /createSettingsViewModel\(store\.get\(\), getTextCatalogue\(store\.get\(\)\.language\)\)/);
});

test('SettingsController source pins: Graphics fills, scale-based visibility, per-row Buttons with hit rect = drawn rect, backdrop swallow, inert language row', () => {
    const source = stripComments(read(CONTROLLER));
    assert.match(source, /Graphics/);
    assert.doesNotMatch(source, /node\.active|\.active\s*=|Sprite\b/);
    assert.match(source, /setScale\(0, 0, 0\)/);
    // Every row is a Button on its own node; the Button node is the drawn row slot.
    assert.match(source, /const node = this\.newNode\(`SettingsRow\$\{i\}`, card, rowLayout\.slot\.w, rowLayout\.slot\.h\);/);
    assert.match(source, /const button = this\.newButton\(node, 'onRowPressed', String\(i\)\);/);
    assert.match(source, /this\.newButton\(close, 'onClosePressed', ''\);/);
    assert.match(source, /this\.newButton\(action, 'onChipPressed', ''\);/);
    assert.match(source, /view\.button\.interactable = row\.tappable;/);
    // Backdrop: swallows touches; a tap closes; CLOSE always works.
    assert.match(source, /backdrop\.on\(Node\.EventType\.TOUCH_END, this\.onBackdropTouchEnd, this\)/);
    assert.match(source, /event\.propagationStopped = true/);
    assert.match(source, /this\.closePanel\('backdrop'\)/);
    assert.match(source, /label\.overflow = Label\.Overflow\.SHRINK/);
    // Suppression closes the panel and hides the chip by scale; the chip handler is inert while suppressed.
    assert.match(source, /if \(suppressed && this\.open\) this\.closePanel\('suppressed'\);/);
    assert.match(source, /if \(this\.chipVisible !== true \|\| this\.suppressed \|\| !this\.viewModel\) return;/);
    // Chip anchors: top below the HUD and LEFT, behind the HUD cards / toast band.
    assert.match(source, /widget\.isAlignLeft = true;/);
    assert.match(source, /chip\.setSiblingIndex\(0\);/);
});

test('the Reboot title card flag is observable and read-only for presentation', () => {
    const source = stripComments(read('assets/scripts/presentation/MilestonePresentationController.ts'));
    assert.match(source, /public isRebootCardActive\(\): boolean \{\s*return this\.rebootCardActive;\s*\}/);
    assert.match(source, /this\.rebootCardActive = tick\.frame\?\.item\.trigger\.kind === 'reboot_title';/);
});

test('no new GameCommand, no save schema change, no native / Java change, no audio asset', () => {
    assert.doesNotMatch(read('assets/scripts/domain/Commands.ts'), /ettings|udio|ibrat/);
    const state = read('assets/scripts/state/GameState.ts');
    assert.match(state, /export interface SettingsState \{\s*musicVolume: number;\s*sfxVolume: number;\s*vibrationEnabled: boolean;\s*languageCode: string \| null;\s*reducedMotion: boolean;\s*\}/, 'the dormant SettingsState is untouched');
    assert.equal(fs.existsSync(path.join(repoRoot, 'assets', 'audio')), false);
    assert.doesNotMatch(stripComments(read(BOOTSTRAP)), /native\.reflection/);
});

test('diagnostics: the settings event is allow-listed and the capture records it', async () => {
    const { DEVICE_EVENT_TYPES } = await imp('assets/scripts/presentation/DeviceDiagnostics.ts');
    assert.ok(DEVICE_EVENT_TYPES.includes('settings'));
    const { DEFAULT_REVEAL_EVENT_TYPES } = await imp('tools/device/reveal_capture.ts');
    assert.ok(DEFAULT_REVEAL_EVENT_TYPES.includes('settings'));
});

test('every new .ts under assets has a .meta with a unique uuid (and the settings directory has one)', () => {
    const files = [
        'assets/scripts/settings/UserSettings.ts', 'assets/scripts/settings/SettingsStore.ts', 'assets/scripts/settings/index.ts',
        'assets/scripts/services/AudioService.ts', 'assets/scripts/services/HapticsService.ts',
        'assets/scripts/platform/noop/SilentAudioService.ts', 'assets/scripts/platform/noop/NoOpHapticsService.ts',
        'assets/scripts/platform/mock/MockAudioService.ts', 'assets/scripts/platform/mock/MockHapticsService.ts',
        'assets/scripts/presentation/AudioCueMapper.ts', 'assets/scripts/presentation/SettingsLayout.ts', 'assets/scripts/presentation/SettingsViewModel.ts', 'assets/scripts/presentation/SettingsController.ts',
        'assets/scripts/localization/PseudoLocale.ts',
    ];
    const uuids = new Set();
    for (const rel of [...files.map((f) => `${f}.meta`), 'assets/scripts/settings.meta']) {
        const meta = JSON.parse(read(rel));
        assert.match(meta.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, rel);
        assert.equal(uuids.has(meta.uuid), false, `${rel}: duplicate uuid`);
        uuids.add(meta.uuid);
    }
    // Unique against every other meta in the repo's scripts folder.
    const all = new Map();
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.meta')) {
                const uuid = JSON.parse(fs.readFileSync(full, 'utf8')).uuid;
                assert.equal(all.has(uuid), false, `${path.relative(repoRoot, full)} duplicates ${all.get(uuid)}`);
                all.set(uuid, path.relative(repoRoot, full));
            }
        }
    };
    walk(path.join(repoRoot, 'assets', 'scripts'));
});

// ---------------------------------------------------------------- device tooling

const NOW_MS = Date.parse('2026-11-14T12:00:00.000Z');

test('device: scenario, CLI (usage + seed command + options pass-through) and package script are registered', async () => {
    const { REVEAL_SCENARIOS } = await imp('tools/device/reveal_capture.ts');
    const scenario = REVEAL_SCENARIOS.aut052;
    assert.equal(scenario.id, 'aut052');
    assert.equal(scenario.trigger, 'none');
    assert.equal(scenario.expectSettings, 'toggle_persist');
    assert.equal(scenario.expectPermanentUpgrades, undefined);
    const cli = read('tools/device/cli.ts');
    assert.match(cli, /command === 'seed-aut052'/);
    assert.match(cli, /seed-aut052 \[--serial <id>\]/);
    assert.match(cli, /aut051-short\|aut052\|rbt001\|aut055-success\|aut055-closed\|aut055-failed\|aut055-ineligible\|aut056-success\|aut056-free-active\|aut056-resume\|aut056-closed\|aut056-failed\|aut056-quota\|aut056-interval\|aut057-offline-double\|aut057-extended\|aut057-no-fill\]/);
    // The AUT-050 omission must not repeat: the CLI hands expectSettings to the capture, and the capture hands it to the evaluator.
    assert.match(cli, /expectSettings: scenario\.expectSettings,/);
    const capture = read('tools/device/reveal_capture.ts');
    assert.match(capture, /readonly expectSettings\?: SettingsExpectation;/);
    assert.match(capture, /expectSettings: options\.expectSettings, expectRebootUi: options\.expectRebootUi \}\);/);
    assert.match(capture, /if \(options\.expectSettings !== undefined\) checks\.push\(\.\.\.evaluateSettings\(events, options\.expectSettings\)\);/);
    assert.match(capture, /tapRect\('SettingsChip'\)/);
    assert.match(capture, /tapRect\('SettingsRow0'\)/);
    assert.match(capture, /tapRect\('SettingsClose'\)/);
    assert.match(capture, /driver\.forceStop\(packageName\);\s*const relaunchCursor = stream\.cursor;\s*await driver\.launch\(packageName, activity\);/);
    assert.match(read('package.json'), /"device:seed-aut052": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools\/device\/cli\.ts seed-aut052"/);
    for (const rel of ['tools/device/seed_aut052.ts', 'tools/device/settings_checks.ts']) assert.doesNotMatch(read(rel), /from\s+['"]cc['"]/);
});

test('device: the seed writes the post-Reboot save (5 s old) and clears the stale settings / debug / save files first', async () => {
    const { seedAut052, buildAut052SeededSave } = await imp('tools/device/seed_aut052.ts');
    const { SETTINGS_FILE, SETTINGS_TEMP_FILE } = await imp('assets/scripts/settings/SettingsStore.ts');
    const { DEBUG_COMMAND_FILE } = await imp('assets/scripts/presentation/DebugCommandFile.ts');
    const calls = [];
    const driver = {
        forceStop: async (pkg) => calls.push(['forceStop', pkg]),
        appDataDirectory: async () => '/data/data/pkg',
        removeAppFiles: async (_pkg, files) => calls.push(['remove', files]),
        writeAppFile: async (_pkg, file, text) => calls.push(['write', file, JSON.parse(text).savedAtUtc ?? JSON.parse(text).envelope?.savedAtUtc]),
        launch: async (pkg, activity) => calls.push(['launch', pkg, activity]),
    };
    const filesDir = await seedAut052(driver, 'pkg', 'act', () => new Date(NOW_MS));
    assert.equal(filesDir, '/data/data/pkg/files/');
    assert.deepEqual(calls.map((call) => call[0]), ['forceStop', 'remove', 'write', 'launch']);
    const removed = calls[1][1];
    for (const name of [SETTINGS_FILE, SETTINGS_TEMP_FILE, DEBUG_COMMAND_FILE, 'save_main.json']) assert.ok(removed.some((file) => file.endsWith(`/${name}`)), name);
    assert.equal(calls[2][1], '/data/data/pkg/files/save_main.json');
    assert.equal(calls[2][2], new Date(NOW_MS - 5_000).toISOString());
    const save = JSON.parse(buildAut052SeededSave(NOW_MS));
    assert.equal(JSON.stringify(save).includes('"civilizationNumber":2'), true, 'post-Reboot: Civilization #2 so the AI chip is visible too');
});

function ev(tMs, evt, extra = {}) { return { tMs, event: { v: 1, seq: tMs, evt, ...extra } }; }
const R = (x, y, w = 100, h = 64) => ({ x, y, w, h });
const ALL_ON = { musicEnabled: true, sfxEnabled: true, vibrationEnabled: true, language: 'en' };

function goodTimeline() {
    return [
        ev(0, 'settings', { phase: 'loaded', source: 'default', settings: ALL_ON, missingText: 0 }),
        ev(10, 'ui_layout', { rects: { SettingsChip: R(16, 1000, 112), PermanentUpgradeChip: R(554, 1000, 150) } }),
        ev(20, 'settings', { phase: 'chip_shown', chipRect: R(16, 1000, 112), missingText: 0 }),
        ev(1000, 'settings', { phase: 'opened', panelRect: R(40, 400, 640, 480), rowRects: [R(1, 1), R(1, 2), R(1, 3), R(1, 4)], closeRect: R(1, 5), missingText: 0 }),
        ev(1500, 'settings', { phase: 'saved', settings: { ...ALL_ON, musicEnabled: false } }),
        ev(1501, 'settings', { phase: 'toggled', setting: 'musicEnabled', value: false, saved: true, missingText: 0 }),
        ev(2000, 'settings', { phase: 'closed', reason: 'close_button' }),
        ev(3000, 'capture_marker', { phase: 'relaunch' }),
        ev(3100, 'settings', { phase: 'loaded', source: 'file', settings: { ...ALL_ON, musicEnabled: false }, missingText: 0 }),
        ev(4000, 'settings', { phase: 'toggled', setting: 'musicEnabled', value: true, saved: true, missingText: 0 }),
    ];
}

test('device checks: a good timeline passes every check', async () => {
    const { evaluateSettings } = await imp('tools/device/settings_checks.ts');
    const checks = evaluateSettings(goodTimeline(), 'toggle_persist');
    assert.deepEqual(checks.filter((c) => !c.ok), []);
    assert.deepEqual(checks.map((c) => c.id), [
        'settings_first_launch_defaults', 'settings_chip_shown', 'settings_chip_clear_of_ai_chip', 'settings_panel_opened', 'settings_music_toggled_off',
        'settings_saved_after_toggle', 'settings_panel_closed', 'settings_persisted_after_relaunch', 'settings_music_toggled_back_on', 'settings_no_missing_text',
    ]);
});

test('device checks: each failure mode is detected', async () => {
    const { evaluateSettings } = await imp('tools/device/settings_checks.ts');
    const failing = (timeline) => evaluateSettings(timeline, 'toggle_persist').filter((c) => !c.ok).map((c) => c.id);
    const good = goodTimeline();
    // Not persisted: the relaunch loads defaults.
    assert.deepEqual(failing(good.map((e) => (e.tMs === 3100 ? ev(3100, 'settings', { phase: 'loaded', source: 'default', settings: ALL_ON, missingText: 0 }) : e))), ['settings_persisted_after_relaunch']);
    // A save failure.
    assert.ok(failing([...good, ev(5000, 'settings', { phase: 'save_failed', message: 'boom' })]).includes('settings_saved_after_toggle'));
    // Overlapping chips.
    assert.ok(failing(good.map((e) => (e.tMs === 10 ? ev(10, 'ui_layout', { rects: { SettingsChip: R(500, 1000, 112), PermanentUpgradeChip: R(554, 1000, 150) } }) : e))).includes('settings_chip_clear_of_ai_chip'));
    // A missing-text report.
    assert.ok(failing([...good, ev(6000, 'settings', { phase: 'missing_text', report: {}, missingText: 1 })]).includes('settings_no_missing_text'));
    // Nothing happened at all.
    assert.ok(failing([]).length >= 8);
    // No relaunch marker: persistence cannot pass.
    assert.ok(failing(good.filter((e) => e.event.evt !== 'capture_marker')).includes('settings_persisted_after_relaunch'));
});
