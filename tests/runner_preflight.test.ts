import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const preflight = require('../tools/ci/runner_preflight.js');

const READY_FACTS = {
  nodeVersion: 'v24.1.0',
  platform: 'win32',
  gitVersion: 'git version 2.50.0',
  cocosExe: 'C:\\ProgramData\\cocos\\editors\\Creator\\3.8.8\\CocosCreator.exe',
  cocosExeExists: true,
  cocosEngineVersion: '3.8.8',
  sdkPath: 'C:\\sdk',
  sdkPlatformPresent: true,
  ndkPath: 'C:\\sdk\\ndk\\25.2.9519653',
  javaPath: 'C:\\jdk\\bin\\java.exe',
  workflowLabelsOk: true,
  runnerLabels: [],
};

test('runner preflight: a complete toolchain is READY with every check passing', () => {
  const result = preflight.evaluate(READY_FACTS);
  assert.equal(result.ready, true);
  assert.deepEqual(result.checks.map((c: { id: string }) => c.id), ['node', 'platform', 'git', 'cocos-exe', 'cocos-version', 'android-sdk', 'android-ndk', 'java', 'workflow-labels']);
  assert.ok(result.checks.every((c: { ok: boolean; hint: string }) => c.ok && c.hint === ''));
});

test('runner preflight: each missing or wrong prerequisite fails that check with a hint', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['node', { nodeVersion: 'v22.0.0' }],
    ['platform', { platform: 'linux' }],
    ['git', { gitVersion: '' }],
    ['cocos-exe', { cocosExeExists: false }],
    ['cocos-version', { cocosEngineVersion: '3.8.7' }],
    ['android-sdk', { sdkPlatformPresent: false }],
    ['android-sdk', { sdkPath: '' }],
    ['android-ndk', { ndkPath: '' }],
    ['java', { javaPath: '' }],
    ['workflow-labels', { workflowLabelsOk: false }],
  ];
  for (const [id, override] of cases) {
    const result = preflight.evaluate({ ...READY_FACTS, ...override });
    const failed = result.checks.filter((c: { ok: boolean }) => !c.ok);
    assert.equal(result.ready, false, id);
    assert.deepEqual(failed.map((c: { id: string }) => c.id), [id], id);
    assert.notEqual(failed[0].hint, '', id);
  }
});

test('runner preflight: pins match the build wrapper (Cocos 3.8.8, SDK android-36) and the real workflow satisfies the label check', () => {
  assert.equal(preflight.REQUIRED_CREATOR_VERSION, '3.8.8');
  assert.equal(preflight.REQUIRED_SDK_PLATFORM, 'android-36');
  const facts = preflight.collectFacts(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  assert.equal(facts.workflowLabelsOk, true);
  assert.match(preflight.format(preflight.evaluate(READY_FACTS)), /RUNNER READY/);
});
