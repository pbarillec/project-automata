const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { readFile, readdir, stat } = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(path.dirname(__filename), '..');
const assetRoot = path.join(repoRoot, 'assets/art/aut032');
const scenePath = path.join(repoRoot, 'assets/scenes/spikes/AssetRobotSpike.scene');
const scriptPath = path.join(repoRoot, 'assets/scripts/presentation/AssetRobotSpike.ts');

const factoryAssets = [
    'box-large.glb', 'conveyor-corner.glb', 'conveyor-junction-t.glb', 'conveyor.glb',
    'hopper-square.glb', 'machine-bed.glb', 'machine.glb', 'pipe-large.glb',
    'robot-arm-a.glb', 'robot-arm-b.glb', 'screen-panel-wide.glb', 'structure-high.glb',
];
const requiredAnimations = ['Robot_Idle', 'Robot_Walking', 'Robot_Running', 'Robot_ThumbsUp'];

async function sha256(filePath: string): Promise<string> {
    return crypto.createHash('sha256').update(await readFile(filePath)).digest('hex').toUpperCase();
}

async function glbJson(filePath: string): Promise<any> {
    const bytes = await readFile(filePath);
    const jsonLength = bytes.readUInt32LE(12);
    return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
}

test('AUT-032 contains exactly the approved runtime asset subset', async () => {
    const factoryDir = path.join(assetRoot, 'factory');
    const entries = (await readdir(factoryDir)).filter((entry: string) => entry.endsWith('.glb')).sort();
    assert.deepEqual(entries, [...factoryAssets].sort());
    assert.deepEqual((await readdir(path.join(assetRoot, 'robot'))).filter((entry: string) => entry.endsWith('.glb')), ['Robot.glb']);
    assert.equal((await stat(path.join(assetRoot, 'robot/Robot.glb'))).size, 623504);
    assert.equal(await sha256(path.join(assetRoot, 'robot/Robot.glb')), 'BC4F886BA8660B5C658DBFDBCECFF1F2260F6E29DAE12CDC6BA578C2C7D34BD1');
    const robot = await glbJson(path.join(assetRoot, 'robot/Robot.glb'));
    assert.equal(robot.skins?.length, 1);
    for (const animation of requiredAnimations) assert.ok(robot.animations?.some((entry: { name?: string }) => entry.name === animation), `GLB is missing ${animation}`);
});

test('AUT-032 scene references the isolated assets and required robot clips', async () => {
    const scene = await readFile(scenePath, 'utf8');
    const source = await readFile(scriptPath, 'utf8');
    assert.match(scene, /AssetRobotSpikeRoot/);
    assert.equal((scene.match(/"__uuid__"/g) ?? []).length, factoryAssets.length + 1);
    assert.match(scene, /a0320000-0000-4000-8000-000000000003@68751/);
    assert.equal((scene.match(/"__uuid__":"a0320000-0000-4000-8000-0000000000[0-9a-f]+@/g) ?? []).length, factoryAssets.length + 1);
    for (const animation of requiredAnimations) assert.match(source, new RegExp(animation));
    assert.match(source, /auto-cycle 3s/);
});

test('AUT-032 keeps provenance and presentation-only boundaries', async () => {
    const [kenneyLicense, robotLicense, doc, source] = await Promise.all([
        readFile(path.join(repoRoot, 'docs/licenses/kenney-factory-kit.txt'), 'utf8'),
        readFile(path.join(repoRoot, 'docs/licenses/quaternius-animated-robot.txt'), 'utf8'),
        readFile(path.join(repoRoot, 'docs/AUT-032_3D_ASSET_ROBOT_SPIKE.md'), 'utf8'),
        readFile(scriptPath, 'utf8'),
    ]);
    assert.match(kenneyLicense, /CC0/i);
    assert.match(robotLicense, /CC0/i);
    assert.match(doc, /KENNEY_FACTORY_01|Factory Kit/);
    assert.match(doc, /QUAT_ROBOT_01|Quaternius/);
    assert.equal(/GameState|scripts[\\/]economy|scripts[\\/]gameplay|scripts[\\/]persistence|scripts[\\/]progression|scripts[\\/]simulation/.test(source), false);
});
