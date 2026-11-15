import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { boxMaterialKey, boxMeshKey, KeyedCache } from '../assets/scripts/presentation/BoxPrimitiveCache.ts';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string): string => fs.readFileSync(path.join(root, file), 'utf8');

test('AUT-068 box material / mesh keys are stable and discriminate colour, alpha and size', () => {
    assert.equal(boxMaterialKey({ r: 10, g: 20, b: 30 }), boxMaterialKey({ r: 10, g: 20, b: 30, a: 255 }));
    assert.equal(boxMaterialKey({ r: 10.4, g: 20, b: 30 }), boxMaterialKey({ r: 10, g: 20, b: 30 }));
    assert.notEqual(boxMaterialKey({ r: 10, g: 20, b: 30 }), boxMaterialKey({ r: 10, g: 20, b: 31 }));
    assert.notEqual(boxMaterialKey({ r: 10, g: 20, b: 30 }), boxMaterialKey({ r: 10, g: 20, b: 30, a: 220 }));
    assert.equal(boxMeshKey({ x: 1, y: 1, z: 1 }), boxMeshKey({ x: 1.00001, y: 1, z: 1 }));
    assert.notEqual(boxMeshKey({ x: 1, y: 1, z: 1 }), boxMeshKey({ x: 1, y: 1, z: 1.01 }));
});

test('AUT-068 KeyedCache creates each key once and counts avoided creations', () => {
    const cache = new KeyedCache<{ id: number }>();
    let created = 0;
    const make = (): { id: number } => ({ id: (created += 1) });
    const a = cache.getOrCreate('a', make);
    assert.equal(cache.getOrCreate('a', make), a);
    cache.getOrCreate('b', make);
    assert.equal(created, 2);
    assert.equal(cache.size, 2);
    assert.equal(cache.requests, 3);
    cache.clear();
    assert.equal(cache.size, 0);
});

test('AUT-068 createBox shares material / mesh, and every runtime-recoloured box opts out', () => {
    const source = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    assert.match(source, /boxMaterialCache\.getOrCreate\(boxMaterialKey\(color\)/);
    assert.match(source, /boxMeshCache\.getOrCreate\(boxMeshKey\(size\)/);
    // era palette boxes (role) and the teaser seam pulse mutate their material
    assert.match(source, /box\.role !== undefined \|\| box\.id === 'teaser_seam'/);
    // shell boxes recoloured by the era palette, construction / milestone sparks recoloured per accent
    for (const pattern of [/'SiteBoundary'[^\n]*, true\);/, /'MainLogisticsSpine'[^\n]*, true\);/, /'FutureAccessBarrier'[^\n]*, true\);/, /ConstructionSpark_[^\n]*, true\);/]) {
        assert.match(source, pattern);
    }
    // the only runtime colour writers stay on boxes that opted out (guards a new shared-material mutation)
    const writers = ['EraEnvironmentVisualController.ts', 'MilestonePresentationController.ts'];
    for (const file of writers) assert.match(read(`assets/scripts/presentation/${file}`), /setProperty\('mainColor'/);
});

test('AUT-068 only the known files write a mainColor (new writers must opt their box out of material sharing)', () => {
    const dir = path.join(root, 'assets/scripts/presentation');
    const writers = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && /setProperty\(\s*'mainColor'/.test(fs.readFileSync(path.join(dir, f), 'utf8'))).sort();
    assert.deepEqual(writers, [
        'AutomataIdentityMesh.ts', 'CameraSpikeBootstrap.ts', 'EraEnvironmentVisualController.ts', 'FactoryWorldBootstrap.ts',
        'FounderRobotVisual.ts', 'MilestonePresentationController.ts', 'ProducerHighlight.ts',
    ]);
});
