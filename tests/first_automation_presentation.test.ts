const test = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

test('first automation controller is presentation-only and uses bounded camera focus', async () => {
    const source = await readFile(path.join(__dirname, '..', 'assets/scripts/presentation/FirstAutomationPresentationController.ts'), 'utf8');
    assert.match(source, /consumeDomainEvents/);
    assert.match(source, /syncFromGameState/);
    assert.match(source, /focusOnRevealTarget/);
    assert.match(source, /autonomous_cycle_indicator/);
    assert.doesNotMatch(source, /purchaseBreakthrough|industrialOutput\s*[+\-*/]?=|isAutomated\s*=/);
});

const repoRoot = path.join(__dirname, '..');

function listSources(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listSources(full));
        else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
}

test('AUT-038 closure: the temporary human-gate showcase and debug logs are gone from assets/scripts', async () => {
    const forbidden = [/HUMAN_GATE/, /human_gate/, /\[AUT-038-HG\]/, /debugSetVisibleModules/, /SELECTION_DEBUG_LOG/, /formatSelectionDebugLine/];
    const hits = [];
    for (const file of listSources(path.join(repoRoot, 'assets/scripts'))) {
        const text = await readFile(file, 'utf8');
        for (const pattern of forbidden) if (pattern.test(text)) hits.push(`${path.relative(repoRoot, file)}: ${pattern}`);
    }
    assert.deepEqual(hits, []);
});

test('AUT-038 closure: start() schedules no reveal and reports idle; the runtime focus beat drives the reveal', async () => {
    const source = await readFile(path.join(repoRoot, 'assets/scripts/presentation/FirstAutomationPresentationController.ts'), 'utf8');
    const start = source.match(/public start\(\): void \{([\s\S]*?)\r?\n    \}/);
    assert.ok(start, 'start() body not found');
    assert.match(start[1], /emitDeviceEvent\('reveal_state', \{ phase: 'idle', source: 'none'/);
    assert.doesNotMatch(source, /scheduleOnce/);
    assert.match(source, /if \(this\.snapshotValue\.focusBeatRequested\) \{\s*this\.requestBoundedFocus\(\);/);
    assert.match(source, /const visible =\s*this\.snapshotValue\?\.activityIndicatorVisible === true;/);
});

test('AUT-038 closure: device diagnostics are enabled only by FactoryWorldBootstrap from DEBUG', async () => {
    const enablers = [];
    for (const file of listSources(path.join(repoRoot, 'assets/scripts'))) {
        if (file.endsWith('DeviceDiagnostics.ts')) continue;
        const text = await readFile(file, 'utf8');
        if (/configureDeviceDiagnostics\(/.test(text)) enablers.push(path.basename(file));
    }
    assert.deepEqual(enablers, ['FactoryWorldBootstrap.ts']);
    const bootstrap = await readFile(path.join(repoRoot, 'assets/scripts/presentation/FactoryWorldBootstrap.ts'), 'utf8');
    assert.match(bootstrap, /configureDeviceDiagnostics\(\{ enabled: DEBUG === true \}\)/);
});
