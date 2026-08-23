const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const scenePath = path.join(repoRoot, 'assets/scenes/camera/CameraSpike.scene');
const buildConfigPath = path.join(repoRoot, 'tools/ci/cocos_android_debug_build.json');
const androidBuildWrapperPath = path.join(repoRoot, 'tools/ci/build_android.js');
const bootstrapMetaPath = path.join(repoRoot, 'assets/scripts/presentation/CameraSpikeBootstrap.ts.meta');
const bootstrapGeneratedImportMapPath = path.join(repoRoot, 'temp/programming/packer-driver/targets/preview/import-map.json');
const controllerSourcePath = path.join(repoRoot, 'assets/scripts/camera/MobileCameraController.ts');
const bootstrapSourcePath = path.join(repoRoot, 'assets/scripts/presentation/CameraSpikeBootstrap.ts');
const {
    findFatalCocosDiagnosticsInText,
    isAcceptableCocosExit,
    isAcceptableCocosGenerationEvidence,
} = require(androidBuildWrapperPath);

async function readGeneratedComponentRegistration(scriptPath: string, scriptUuid: string) {
    const importMap = JSON.parse(await readFile(bootstrapGeneratedImportMapPath, 'utf8'));
    const scriptImport = Object.entries(importMap.imports).find(([sourcePath]) => sourcePath.endsWith(`/${scriptPath.replaceAll('\\', '/')}`));
    assert.ok(scriptImport, `Generated Cocos import map does not contain ${scriptPath}`);

    const generatedChunkPath = path.resolve(path.dirname(bootstrapGeneratedImportMapPath), scriptImport[1] as string);
    const generatedChunk = await readFile(generatedChunkPath, 'utf8');
    const registration = generatedChunk.match(/_RF\.push\(\{\},\s*"([^"]+)",\s*"([^"]+)"/);
    assert.ok(registration, `Generated Cocos chunk for ${scriptPath} has no runtime registration`);

    return {
        chunkPath: generatedChunkPath,
        classId: registration[1],
        fileName: registration[2],
        source: generatedChunk,
        scriptUuid,
    };
}

test('camera spike scene has the expected bootstrap component and is included in Android build config', async () => {
    const scene = JSON.parse(await readFile(scenePath, 'utf8'));
    const buildConfig = JSON.parse(await readFile(buildConfigPath, 'utf8'));
    const bootstrapMeta = JSON.parse(await readFile(bootstrapMetaPath, 'utf8'));

    assert.equal(scene[0]._name, 'CameraSpike');
    assert.equal(scene[1]._name, 'CameraSpike');
    assert.equal(bootstrapMeta.uuid, '64612f11-58b6-4ad4-81ac-98a2d3326cc5');
    const root = scene.find((entry) => entry.__type__ === 'cc.Node' && entry._name === 'CameraSpikeRoot');
    assert.ok(root, 'CameraSpikeRoot node is missing');
    const serializedComponentId = root._components?.[0]?.__id__;
    assert.equal(typeof serializedComponentId, 'number');
    const serializedComponent = scene[serializedComponentId];
    assert.ok(serializedComponent, 'CameraSpikeRoot component record is missing');
    const registration = await readGeneratedComponentRegistration(
        'assets/scripts/presentation/CameraSpikeBootstrap.ts',
        bootstrapMeta.uuid,
    );
    assert.equal(registration.fileName, 'CameraSpikeBootstrap');
    assert.match(registration.source, /ccclass\('CameraSpikeBootstrap'\)/);
    assert.match(registration.source, /class CameraSpikeBootstrap extends Component/);
    assert.equal(serializedComponent.__type__, registration.classId, `Scene class ID does not match generated registration in ${registration.chunkPath}`);
    assert.equal(buildConfig.startScene, scene[1]._id);
    assert.deepEqual(buildConfig.scenes.map((entry) => entry.uuid), [scene[1]._id]);
    assert.ok(buildConfig.scenes.some((entry) => entry.uuid === scene[1]._id && /CameraSpike\.scene$/.test(entry.url)));
});

test('camera spike sources stay presentation-only and do not import gameplay state or economy', async () => {
    const sources = [
        ['MobileCameraController.ts', await readFile(controllerSourcePath, 'utf8')],
        ['CameraSpikeBootstrap.ts', await readFile(bootstrapSourcePath, 'utf8')],
    ];

    for (const [name, source] of sources) {
        assert.equal(/GameState|assets[\\/]scripts[\\/]state|assets[\\/]scripts[\\/]economy|assets[\\/]scripts[\\/]runtime|assets[\\/]scripts[\\/]services/.test(source), false, `${name} imports or references gameplay state/economy`);
        assert.equal(/IndustrialOutputChanged|BuyProducer|Reboot|AI Cores/.test(source), false, `${name} contains gameplay command/event behavior`);
    }
});

test('Android build wrapper only accepts bounded Cocos exit 36 after clean fresh generation evidence', () => {
    const completeEvidence = {
        freshGeneratedOutputs: true,
        completionMarker: true,
        outputShape: true,
        fatalDiagnostics: [],
    };

    assert.equal(isAcceptableCocosGenerationEvidence(completeEvidence), true);
    assert.equal(isAcceptableCocosExit(36, completeEvidence), true);
    assert.equal(isAcceptableCocosExit(1, completeEvidence), false);
    assert.equal(isAcceptableCocosExit(0, { ...completeEvidence, completionMarker: false }), false);
    assert.equal(isAcceptableCocosExit(36, { ...completeEvidence, freshGeneratedOutputs: false }), false);
    assert.equal(isAcceptableCocosExit(36, { ...completeEvidence, fatalDiagnostics: ['SyntaxError'] }), false);
});

test('Android build wrapper treats known Cocos diagnostics as fatal', () => {
    const diagnostics = findFatalCocosDiagnosticsInText([
        'warn: Missing class: abc123',
        'error: Script attached to Canvas in scene Main is missing or invalid.',
        'SyntaxError: bad TypeScript',
        'build task Build Assets failed',
        'EPERM: operation not permitted',
    ].join('\n'));

    assert.ok(diagnostics.some((item) => /Missing class/i.test(item)));
    assert.ok(diagnostics.some((item) => /missing or invalid/i.test(item)));
    assert.ok(diagnostics.some((item) => /SyntaxError/i.test(item)));
    assert.ok(diagnostics.some((item) => /build task/i.test(item)));
    assert.ok(diagnostics.some((item) => /EPERM/i.test(item)));
});

test('Android build wrapper requires Gradle success text and named fresh debug APK', async () => {
    const source = await readFile(androidBuildWrapperPath, 'utf8');

    assert.match(source, /BUILD SUCCESSFUL/);
    assert.match(source, /ProjectAutomata-debug\.apk/);
    assert.match(source, /findFreshDebugApk/);
});
