#!/usr/bin/env node
// AUT-R-074-01: read-only readiness check for the self-hosted `cocos` Android runner. It registers nothing and changes nothing;
// it reports whether this machine could run `.github/workflows/android-build.yml` (the same resolution rules as build_android.js).
//
//   node tools/ci/runner_preflight.js [--json]      exit 0 = READY, 1 = NOT_READY
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const REQUIRED_CREATOR_VERSION = '3.8.8';
const REQUIRED_NODE_MAJOR = 24;
const REQUIRED_SDK_PLATFORM = 'android-36';
const DEFAULT_COCOS_EXE = 'C:\\ProgramData\\cocos\\editors\\Creator\\3.8.8\\CocosCreator.exe';

/** Pure: turn probed facts into ordered checks. `facts` comes from collectFacts() (or a test fixture). */
function evaluate(facts) {
  const checks = [];
  const add = (id, ok, detail, hint) => checks.push({ id, ok: !!ok, detail, hint: ok ? '' : hint });

  const nodeMajor = Number.parseInt(String(facts.nodeVersion || '').replace(/^v/, ''), 10);
  add('node', nodeMajor === REQUIRED_NODE_MAJOR, `node ${facts.nodeVersion}`, `Install Node ${REQUIRED_NODE_MAJOR}.x (tests run .ts via built-in type stripping).`);
  add('platform', facts.platform === 'win32', `platform ${facts.platform}`, 'The workflow targets a Windows runner (tools/ci scripts call powershell.exe).');
  add('git', !!facts.gitVersion, facts.gitVersion || 'git not found', 'Install git and put it on PATH.');
  add('cocos-exe', facts.cocosExeExists, facts.cocosExe, `Install Cocos Creator ${REQUIRED_CREATOR_VERSION} at the default path or set COCOS_CREATOR_EXE.`);
  add('cocos-version', facts.cocosEngineVersion === REQUIRED_CREATOR_VERSION,
    `engine ${facts.cocosEngineVersion || 'unknown'}`, `Cocos Creator must be exactly ${REQUIRED_CREATOR_VERSION}.`);
  add('android-sdk', !!facts.sdkPath && facts.sdkPlatformPresent, `${facts.sdkPath || 'no SDK found'} (${REQUIRED_SDK_PLATFORM}: ${facts.sdkPlatformPresent ? 'yes' : 'no'})`,
    `Set ANDROID_HOME/ANDROID_SDK_ROOT to an SDK with platform ${REQUIRED_SDK_PLATFORM}.`);
  add('android-ndk', !!facts.ndkPath, facts.ndkPath || 'no NDK found', 'Install the NDK (25.2.9519653) under <sdk>/ndk or set ANDROID_NDK_HOME.');
  add('java', !!facts.javaPath, facts.javaPath || 'java not found', 'Set JAVA_HOME or put java.exe on PATH.');
  const tag = facts.runnerLabels && facts.runnerLabels.length ? facts.runnerLabels.join(',') : '(runner labels are not visible locally)';
  add('workflow-labels', facts.workflowLabelsOk, `workflow runs-on [self-hosted, windows, cocos]; ${tag}`, 'android-build.yml must keep runs-on: [self-hosted, windows, cocos] and no pull_request trigger.');
  return { ready: checks.every((c) => c.ok), checks };
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  return r.status === 0 ? (r.stdout || '').trim() : '';
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function collectFacts(repoRoot, env = process.env) {
  const cocosExe = (env.COCOS_CREATOR_EXE || '').trim() || DEFAULT_COCOS_EXE;
  const cocosExeExists = fs.existsSync(cocosExe);
  const enginePackage = path.join(path.dirname(cocosExe), 'resources', 'resources', '3d', 'engine', 'package.json');
  const workspaceSdk = path.join(repoRoot, 'temp', 'ci', 'android-sdk');
  const sdkCandidates = [
    fs.existsSync(path.join(workspaceSdk, 'platforms', REQUIRED_SDK_PLATFORM)) ? workspaceSdk : '',
    (env.ANDROID_HOME || '').trim(), (env.ANDROID_SDK_ROOT || '').trim(),
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Android', 'Sdk') : '',
  ].filter((p) => p && fs.existsSync(p));
  const sdkPath = sdkCandidates[0] || '';
  const ndkRoot = sdkPath ? path.join(sdkPath, 'ndk') : '';
  const ndks = ndkRoot && fs.existsSync(ndkRoot) ? fs.readdirSync(ndkRoot).filter((n) => fs.existsSync(path.join(ndkRoot, n, 'source.properties'))).sort() : [];
  const ndkConfigured = (env.ANDROID_NDK_HOME || env.ANDROID_NDK_ROOT || '').trim();
  const javaHome = (env.JAVA_HOME || '').trim();
  const javaFromHome = javaHome ? path.join(javaHome, 'bin', 'java.exe') : '';
  const javaPath = javaFromHome && fs.existsSync(javaFromHome) ? javaFromHome : run('where.exe', ['java']).split(/\r?\n/u)[0] || '';
  let workflow = '';
  try { workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'android-build.yml'), 'utf8'); } catch { /* reported below */ }
  return {
    nodeVersion: process.version,
    platform: os.platform(),
    gitVersion: run('git', ['--version']),
    cocosExe,
    cocosExeExists,
    cocosEngineVersion: (readJsonSafe(enginePackage) || {}).version || '',
    sdkPath,
    sdkPlatformPresent: !!sdkPath && fs.existsSync(path.join(sdkPath, 'platforms', REQUIRED_SDK_PLATFORM)),
    ndkPath: ndkConfigured && fs.existsSync(ndkConfigured) ? ndkConfigured : ndks.length ? path.join(ndkRoot, ndks[ndks.length - 1]) : '',
    javaPath,
    workflowLabelsOk: /runs-on:\s*\[self-hosted,\s*windows,\s*cocos\]/.test(workflow) && !/pull_request/.test(workflow),
    runnerLabels: [],
  };
}

function format(result) {
  const lines = result.checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.id.padEnd(16)} ${c.detail}${c.ok ? '' : `\n      -> ${c.hint}`}`);
  lines.push('', result.ready ? 'RUNNER READY (registration is still an owner action; see docs/AUT-R-074-01_ANDROID_RUNNER_ACTIVATION.md)' : 'RUNNER NOT READY');
  return lines.join('\n');
}

if (require.main === module) {
  const result = evaluate(collectFacts(path.resolve(__dirname, '..', '..')));
  console.log(process.argv.includes('--json') ? JSON.stringify(result, null, 2) : format(result));
  process.exit(result.ready ? 0 : 1);
}

module.exports = { evaluate, collectFacts, format, REQUIRED_CREATOR_VERSION, REQUIRED_NODE_MAJOR, REQUIRED_SDK_PLATFORM };
