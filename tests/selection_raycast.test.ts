const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const load = () => import(pathToFileURL(path.join(repoRoot, 'assets/scripts/presentation/SelectionRaycast.ts')).href);

/** Verbatim copy of the pre-AUT-INFRA-001 ProducerSelectionController.producerAtScreenPoint loop. */
function referencePick(ray, targets) {
    let bestId = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const { id, position, scale } of targets) {
        const halfWidth = Math.max(0.5, scale.x / 2);
        const halfDepth = Math.max(0.5, scale.z / 2);
        if (Math.abs(ray.d.y) < 0.0001) continue;
        const distance = (position.y - ray.o.y) / ray.d.y;
        const hitX = ray.o.x + ray.d.x * distance;
        const hitZ = ray.o.z + ray.d.z * distance;
        if (distance >= 0 && Math.abs(hitX - position.x) <= halfWidth && Math.abs(hitZ - position.z) <= halfDepth && distance < bestDistance) {
            bestDistance = distance; bestId = id;
        }
    }
    return bestId;
}

// FactoryWorldBootstrap ZONE_LAYOUT targets (y = 0.2, scale = width x 1 x depth).
const ZONES = [
    { id: 'Fabricator', position: { x: -6, y: 0.2, z: -3 }, scale: { x: 5, y: 1, z: 4 } },
    { id: 'AssemblyStation', position: { x: -2, y: 0.2, z: -1.8 }, scale: { x: 4, y: 1, z: 3.5 } },
    { id: 'RobotLine', position: { x: 3.5, y: 0.2, z: -1.2 }, scale: { x: 6, y: 1, z: 3.5 } },
    { id: 'AutomatedCell', position: { x: 2.3, y: 0.2, z: 1.9 }, scale: { x: 2.0, y: 1, z: 1.7 } }, // AUT-043 owner-moved zone
    { id: 'AdvancedRoboticsComplex', position: { x: 2, y: 0.2, z: 6 }, scale: { x: 6, y: 1, z: 5.5 } },
];

function rayTo(origin, point) {
    const d = { x: point.x - origin.x, y: point.y - origin.y, z: point.z - origin.z };
    const len = Math.hypot(d.x, d.y, d.z);
    return { o: origin, d: { x: d.x / len, y: d.y / len, z: d.z / len } };
}

test('AUT-INFRA-001: extracted hit test equals the original loop on hits, misses, edges and overlaps', async () => {
    const { pickSelectionTarget } = await load();
    const origin = { x: 4, y: 9, z: 6 };
    const cases = [];
    for (const zone of ZONES) {
        cases.push(rayTo(origin, zone.position));
        cases.push(rayTo(origin, { x: zone.position.x + zone.scale.x / 2, y: 0.2, z: zone.position.z }));        // exact edge
        cases.push(rayTo(origin, { x: zone.position.x + zone.scale.x / 2 + 0.01, y: 0.2, z: zone.position.z })); // just outside
    }
    cases.push(rayTo(origin, { x: -3.75, y: 0.2, z: -2 }));  // Fabricator/AssemblyStation overlap strip
    cases.push(rayTo(origin, { x: 30, y: 0.2, z: 30 }));     // floor miss
    cases.push({ o: origin, d: { x: 1, y: 0, z: 0 } });     // parallel to the plane
    cases.push({ o: origin, d: { x: 0, y: 1, z: 0 } });     // pointing away (distance < 0)
    cases.push({ o: { x: -6, y: -1, z: -3 }, d: { x: 0, y: -1, z: 0 } }); // target behind the origin
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let i = 0; i < 500; i += 1) cases.push(rayTo({ x: rand() * 20 - 10, y: 2 + rand() * 15, z: rand() * 20 - 10 }, { x: rand() * 24 - 12, y: 0.2, z: rand() * 20 - 8 }));
    for (const ray of cases) {
        const result = pickSelectionTarget(ray, ZONES);
        assert.equal(result.hit, referencePick(ray, ZONES), JSON.stringify(ray));
        assert.equal(result.zones.length, ZONES.length);
    }
});

test('AUT-INFRA-001: per-zone diagnostics explain the decision', async () => {
    const { pickSelectionTarget } = await load();
    const result = pickSelectionTarget(rayTo({ x: 4, y: 9, z: 6 }, { x: -6, y: 0.2, z: -3 }), ZONES);
    assert.equal(result.hit, 'Fabricator');
    const fab = result.zones.find((z) => z.id === 'Fabricator');
    assert.equal(fab.inside, true);
    assert.ok(Math.abs(fab.dx) < 1e-9 && Math.abs(fab.dz) < 1e-9);
    assert.equal(fab.halfWidth, 2.5);
    assert.equal(fab.halfDepth, 2);
    const parallel = pickSelectionTarget({ o: { x: 0, y: 5, z: 0 }, d: { x: 1, y: 0, z: 0 } }, ZONES);
    assert.equal(parallel.hit, null);
    assert.ok(parallel.zones.every((z) => z.distance === null && z.inside === false));
});

test('AUT-INFRA-001: the selection controller delegates to the extracted hit test and keeps local scale', async () => {
    const source = await readFile(path.join(repoRoot, 'assets/scripts/presentation/ProducerSelectionController.ts'), 'utf8');
    assert.match(source, /pickSelectionTarget\(/);
    assert.match(source, /position: target\.worldPosition, scale: target\.scale/);
    const raycast = await readFile(path.join(repoRoot, 'assets/scripts/presentation/SelectionRaycast.ts'), 'utf8');
    assert.doesNotMatch(raycast, /from\s+['"]cc['"]/);
});
