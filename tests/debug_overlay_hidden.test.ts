import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../assets/scripts/presentation/FactoryWorldBootstrap.ts', import.meta.url), 'utf8');

test('FactoryWorldBootstrap hides the engine FPS/debug overlay before diagnostics are configured', () => {
    assert.match(source, /\bprofiler,/);
    const hide = source.indexOf('profiler.hideStats()');
    assert.ok(hide > 0, 'profiler.hideStats() missing');
    assert.ok(hide < source.indexOf('configureDeviceDiagnostics({'), 'overlay hidden in onLoad');
});
