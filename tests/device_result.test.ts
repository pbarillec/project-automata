const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const load = () => import(pathToFileURL(path.join(repoRoot, 'tools/device/result.ts')).href);

const SHA = 'a'.repeat(64);
const evidence = { run_dir: 'temp/device/r', result: 'temp/device/r/result.json', logcat: 'temp/device/r/logcat.txt', events: 'temp/device/r/events.jsonl', screenshots: [], meminfo: null, gfxinfo: null, summary: null };

function input(failure, blocked = null) {
    return {
        taskId: 'AUT-INFRA-001', scenarioId: 'C3-producer-selection', runId: 'c3-20261105T000000Z-aaaaaaaa',
        startedAt: '2026-11-05T00:00:00.000Z', finishedAt: '2026-11-05T00:01:00.000Z',
        apk: { path: 'temp/gate/x.apk', sha256: SHA }, device: { serial: 'S', model: 'CPH2747', android_release: '16', sdk: '36' },
        failure, blocked, assertions: [{ id: 'a', step: 's', ok: !failure }], warnings: [], steps: [], evidence,
    };
}

const failureOf = (failureClass) => ({ failureClass, assertion: 'raycast_hit_zone', step: 'tap_1_Fabricator', expected: { hit: 'Fabricator' }, actual: { hit: null }, evidenceLines: ['[AUT-DEVICE] {}'] });

test('AUT-INFRA-001: PASS result validates against the schema', async () => {
    const { buildResult, validateDeviceResult, RESULT_SCHEMA_VERSION } = await load();
    const r = buildResult(input(null));
    assert.equal(r.schema_version, RESULT_SCHEMA_VERSION);
    assert.equal(r.status, 'PASS');
    assert.equal(r.review_decision, 'PASS');
    assert.equal(r.retry_without_code_change, false);
    assert.deepEqual(validateDeviceResult(r), []);
});

test('AUT-INFRA-001: functional failure → FAIL / CHANGES_REQUESTED routed to the class owner', async () => {
    const { buildResult, validateDeviceResult } = await load();
    for (const [cls, owner] of [['RAYCAST_MISS', 'implementer'], ['MARKER_PRESENTATION', 'scene-presentation'], ['RUNTIME_ERROR', 'implementer']]) {
        const r = buildResult(input(failureOf(cls)));
        assert.equal(r.status, 'FAIL');
        assert.equal(r.review_decision, 'CHANGES_REQUESTED');
        assert.equal(r.failure_class, cls);
        assert.equal(r.next_owner, owner);
        assert.equal(r.retry_without_code_change, false);
        assert.equal(r.first_failed_assertion.id, 'raycast_hit_zone');
        assert.deepEqual(r.expected, { hit: 'Fabricator' });
        assert.deepEqual(validateDeviceResult(r), []);
    }
});

test('AUT-INFRA-001: missing device → BLOCKED/ENVIRONMENT with HUMAN_REVIEW_REQUIRED and the connect action only', async () => {
    const { buildResult, validateDeviceResult } = await load();
    const env = { ...failureOf('ENVIRONMENT'), assertion: 'device_ready', step: 'environment' };
    const r = buildResult({ ...input(env, { requiredHumanAction: 'connect and authorize the Android device' }), device: null });
    assert.equal(r.status, 'BLOCKED');
    assert.equal(r.failure_class, 'ENVIRONMENT');
    assert.equal(r.review_decision, 'HUMAN_REVIEW_REQUIRED');
    assert.equal(r.required_human_action, 'connect and authorize the Android device');
    assert.equal(r.next_owner, 'human');
    assert.equal(r.retry_without_code_change, true);
    assert.deepEqual(validateDeviceResult(r), []);
    const install = buildResult(input({ ...env, assertion: 'apk_installed' }, { requiredHumanAction: 'inspect harness environment', nextOwner: 'technical-lead' }));
    assert.equal(install.review_decision, 'BLOCKED');
    assert.equal(install.next_owner, 'technical-lead');
});

test('AUT-INFRA-001: schema and cross-field rules reject inconsistent results', async () => {
    const { buildResult, validateDeviceResult } = await load();
    const good = buildResult(input(failureOf('RAYCAST_MISS')));
    const broken = [
        { ...good, schema_version: 'v0' },
        { ...good, status: 'MAYBE' },
        { ...good, failure_class: 'SOMETHING_ELSE' },
        { ...good, apk: { path: 'x', sha256: 'nothex' } },
        { ...good, run_id: 'has space' },
        { ...good, evidence: { ...good.evidence, screenshots: 'none' } },
        { ...good, status: 'PASS', review_decision: 'PASS' },
        { ...good, status: 'BLOCKED' },
        { ...good, retry_without_code_change: true },
        { ...good, review_decision: 'PASS' },
        (() => { const r = { ...good }; delete r.next_owner; return r; })(),
    ];
    for (const r of broken) assert.ok(validateDeviceResult(r).length > 0, JSON.stringify({ status: r.status, cls: r.failure_class, v: r.schema_version }));
});
