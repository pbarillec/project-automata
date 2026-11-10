const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const load = () => import(pathToFileURL(path.join(repoRoot, 'tools/device/gate_build.ts')).href);
const trackedConfig = path.join(repoRoot, 'tools/ci/cocos_android_debug_build.json');

function sandbox() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aut-gate-'));
    const configPath = path.join(dir, 'cocos_android_debug_build.json');
    const original = fs.readFileSync(trackedConfig); // exact tracked bytes (CRLF/LF preserved)
    fs.writeFileSync(configPath, original);
    const builtApkPath = path.join(dir, 'built.apk');
    return { dir, configPath, original, builtApkPath, deps: { configPath, backupDir: path.join(dir, 'backup'), isConfigDirty: () => false, verifyClean: () => true, builtApkPath, outputApkPath: path.join(dir, 'gate', 'out.apk') } };
}

test('AUT-INFRA-001 gate build: switches to FactoryWorld only during the build, then restores the exact bytes', async () => {
    const { runGateBuild, FACTORY_WORLD_SCENE } = await load();
    const s = sandbox();
    let seenDuringBuild = null;
    const result = runGateBuild({ ...s.deps, runBuild: () => { seenDuringBuild = JSON.parse(fs.readFileSync(s.configPath, 'utf8')); fs.writeFileSync(s.builtApkPath, 'apk-bytes'); return 0; } });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.restored, true);
    assert.equal(seenDuringBuild.startScene, FACTORY_WORLD_SCENE.uuid);
    assert.deepEqual(seenDuringBuild.scenes, [FACTORY_WORLD_SCENE]);
    assert.equal(seenDuringBuild.packages.android.packageName, 'com.projectautomata.androidbaseline', 'other settings unchanged');
    assert.ok(fs.readFileSync(s.configPath).equals(s.original), 'config restored byte-for-byte');
    assert.equal(fs.readFileSync(result.apkPath, 'utf8'), 'apk-bytes');
    assert.match(result.apkSha256, /^[0-9a-f]{64}$/);
});

test('AUT-INFRA-001 gate build: build failure or exception still restores the config', async () => {
    const { runGateBuild } = await load();
    for (const runBuild of [() => 1, () => { throw new Error('cocos crashed'); }]) {
        const s = sandbox();
        const result = runGateBuild({ ...s.deps, runBuild });
        assert.equal(result.ok, false);
        assert.equal(result.restored, true);
        assert.match(result.message, /build failed/);
        assert.ok(fs.readFileSync(s.configPath).equals(s.original));
    }
});

test('AUT-INFRA-001 gate build: refuses a dirty config and reports a failed restore verification', async () => {
    const { runGateBuild } = await load();
    const s = sandbox();
    let built = false;
    const dirty = runGateBuild({ ...s.deps, isConfigDirty: () => true, runBuild: () => { built = true; return 0; } });
    assert.equal(dirty.ok, false);
    assert.equal(built, false);
    assert.match(dirty.message, /refusing/);
    const unverified = runGateBuild({ ...s.deps, verifyClean: () => false, runBuild: () => 0 });
    assert.equal(unverified.ok, false);
    assert.match(unverified.message, /NOT RESTORED/);
});

test('AUT-INFRA-001 gate build: interrupted runs can be recovered from the checksummed backup', async () => {
    const { runGateBuild, restoreFromBackup } = await load();
    const s = sandbox();
    runGateBuild({ ...s.deps, runBuild: () => 1 });
    fs.writeFileSync(s.configPath, '{"corrupted":true}');
    assert.equal(restoreFromBackup(s.configPath, s.deps.backupDir), true);
    assert.ok(fs.readFileSync(s.configPath).equals(s.original));
    assert.equal(restoreFromBackup(s.configPath, path.join(s.dir, 'nothing')), false);
});
