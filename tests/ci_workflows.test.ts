import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (name: string): string => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');

test('ci.yml gates PRs and main with npm run check on Node 24', () => {
  const ci = read('ci.yml');
  assert.match(ci, /pull_request:/);
  assert.match(ci, /branches: \[main\]/);
  assert.match(ci, /node-version: 24\.x/);
  assert.match(ci, /run: npm run check/);
  assert.match(ci, /runs-on: windows-latest/);
  assert.doesNotMatch(ci, /godot/i);
});

test('android-build.yml runs the gate then builds and uploads artifacts on a cocos runner', () => {
  const wf = read('android-build.yml');
  assert.match(wf, /self-hosted, windows, cocos/);
  assert.match(wf, /fetch-depth: 0/);
  assert.ok(wf.indexOf('npm run check') < wf.indexOf('npm run android:build'));
  assert.match(wf, /npm run android:release -- --apk/);
  assert.match(wf, /\*\.aab/);
  assert.doesNotMatch(wf, /pull_request/);
  assert.doesNotMatch(wf, /godot/i);
});

test('workflows never inline secrets', () => {
  for (const name of ['ci.yml', 'android-build.yml']) {
    const text = read(name);
    for (const m of text.matchAll(/(PASSWORD|ADMOB_[A-Z_]+|KEY_ALIAS):\s*(.+)/g)) {
      assert.match(m[2], /^\$\{\{ secrets\.[A-Z_]+ \}\}$/, `${name}: ${m[1]} must come from secrets`);
    }
  }
});
