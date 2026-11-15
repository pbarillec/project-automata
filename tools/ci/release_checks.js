#!/usr/bin/env node
// AUT-073: release-safety checks run on the BUILT AAB / APK (never on sources), plus the versionCode ledger.
//
//   npm run android:release:check -- <file.aab|file.apk>... [--package <id>] [--version-code <n>] [--require-production-ids] [--allow-sample-ids] [--require-signing]
//
// Used in-process by `npm run android:release` (tools/ci/build_android.js --release) and standalone for any artifact.
// The pure decisions live in release_support.js (unit tested); this file only does file / process I/O.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const support = require('./release_support.js');

const repoRoot = path.resolve(__dirname, '..', '..');
const ledgerPath = path.join(repoRoot, 'temp', 'release', 'version_ledger.json');
const MAX_SCAN_BYTES = 8 * 1024 * 1024;
const TEXT_ENTRY_PATTERN = /\.(?:js|json|txt|xml|html|cfg|properties|plist|map)$/iu;

function readLedger() {
  try {
    return JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  } catch {
    return null;
  }
}

/** versionCode must be strictly greater than the last recorded/uploaded one for a different commit. */
function checkVersionCodeAgainstLedger(plan, env = process.env) {
  const fromEnv = (env.AUTOMATA_PREVIOUS_VERSION_CODE || '').trim();
  let previous = null;
  if (fromEnv) {
    if (!/^\d+$/u.test(fromEnv)) return { ok: false, note: 'AUTOMATA_PREVIOUS_VERSION_CODE must be an integer' };
    previous = { versionCode: Number.parseInt(fromEnv, 10), gitSha: '' };
  } else {
    previous = readLedger();
  }
  return support.checkVersionCodeMonotonic({ versionCode: plan.version.versionCode, gitSha: plan.gitIdentity.gitSha }, previous);
}

function recordVersionCode(plan) {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, `${JSON.stringify({ versionCode: plan.version.versionCode, gitSha: plan.gitIdentity.gitSha, recordedAt: new Date().toISOString() }, null, 2)}${os.EOL}`, 'utf8');
}

function resolveBuildTool(sdkPath, name) {
  const root = path.join(sdkPath || '', 'build-tools');
  if (!sdkPath || !fs.existsSync(root)) return '';
  const versions = fs.readdirSync(root).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).reverse();
  for (const version of versions) {
    for (const candidate of [`${name}.exe`, `${name}.bat`, name]) {
      const full = path.join(root, version, candidate);
      if (fs.existsSync(full)) return full;
    }
  }
  return '';
}

function runTool(command, args) {
  const isBatch = command.toLowerCase().endsWith('.bat');
  const result = spawnSync(isBatch ? 'cmd.exe' : command, isBatch ? ['/d', '/c', command, ...args] : args, { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error };
}

/** Text of every text-like entry whose name matches `filter` (bounded size), for the endpoint / debug scans. */
function* textEntries(zipBuffer, entries, filter) {
  for (const entry of entries) {
    if (!filter(entry.name) || !TEXT_ENTRY_PATTERN.test(entry.name) || entry.uncompressedSize > MAX_SCAN_BYTES) continue;
    yield { name: entry.name, text: support.extractZipEntry(zipBuffer, entry).toString('utf8') };
  }
}

function scanArtifactContent(zipBuffer, entries, add, label) {
  const isApk = !entries.some((entry) => entry.name.startsWith('base/'));
  const assetPrefix = isApk ? 'assets/' : 'base/assets/';
  const hits = [];
  for (const item of textEntries(zipBuffer, entries, (name) => name.startsWith(assetPrefix))) {
    const endpoint = support.findLocalEndpoint(item.text);
    if (endpoint) hits.push(`${item.name} (${endpoint})`);
  }
  add('no_local_endpoints', hits.length ? 'FAIL' : 'PASS', hits.length ? `local/test endpoint strings in: ${hits.slice(0, 5).join(', ')}` : `no localhost / 127.0.0.1 / 10.0.2.2 / LAN endpoints in the packaged game assets of ${label}`);

  const forbidden = support.findForbiddenPackedFiles(entries.map((entry) => entry.name));
  add('no_debug_or_secret_files', forbidden.length ? 'FAIL' : 'PASS', forbidden.length ? `forbidden files packed: ${forbidden.join(', ')}` : 'no debug_*.json scripts, keystores or .env files are packed');

  const flags = support.findDebugBuildFlags(Array.from(textEntries(zipBuffer, entries, (name) => name.startsWith(assetPrefix))));
  add('debug_flag_off', flags.ok ? 'PASS' : 'FAIL', flags.message);
}

function inspectAab(aabPath, ctx, add) {
  const buffer = fs.readFileSync(aabPath);
  const entries = support.readZipEntries(buffer);
  const manifestEntry = entries.find((entry) => entry.name === 'base/manifest/AndroidManifest.xml');
  if (!manifestEntry) {
    add('manifest', 'FAIL', 'base/manifest/AndroidManifest.xml is missing from the AAB');
    return;
  }
  const summary = support.summarizeManifest(support.decodeProtoManifest(support.extractZipEntry(buffer, manifestEntry)));
  for (const finding of support.evaluateManifestSafety(summary, ctx.expectations)) add(finding.id, finding.status, finding.message);

  const alignment = support.check16KbAlignment(buffer);
  add('native_16kb', alignment.violations.length ? 'FAIL' : 'PASS', alignment.violations.length ? alignment.violations.join('; ') : `${alignment.libraries.length} arm64-v8a native libraries, every LOAD segment aligned >= 16 KB (${alignment.libraries.map((lib) => path.basename(lib.name)).join(', ')})`);
  const abis = support.listNativeAbis(entries);
  add('abis', abis.length === 1 && abis[0] === 'arm64-v8a' ? 'PASS' : 'FAIL', `native ABIs: ${abis.join(', ') || 'none'} (expected arm64-v8a only)`);

  const signed = support.hasJarSignature(entries);
  if (ctx.flags.requireSigning && !signed) add('signing', 'FAIL', 'AAB is not signed (--require-signing)');
  else add('signing', signed ? 'PASS' : 'WARN', signed ? 'AAB carries a JAR signature (upload key)' : 'AAB is UNSIGNED: sign with the upload key before uploading to Play');
  if (ctx.plan.signing.state === 'configured' && !signed) add('signing_consistency', 'FAIL', 'signing inputs were supplied but the AAB is unsigned');

  scanArtifactContent(buffer, entries, add, 'the AAB');

  const mappingEntry = entries.find((entry) => entry.name === 'BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map');
  let mappingText = '';
  if (mappingEntry) mappingText = support.extractZipEntry(buffer, mappingEntry).toString('utf8');
  else if (ctx.mappingPath && fs.existsSync(ctx.mappingPath)) mappingText = fs.readFileSync(ctx.mappingPath, 'utf8');
  if (!mappingText) {
    add('r8_bridge_kept', 'FAIL', 'no R8 mapping found (is minifyEnabled true?)');
  } else {
    const source = fs.readFileSync(path.join(repoRoot, 'native', 'engine', 'android', 'app', 'src', 'com', 'cocos', 'game', 'AutomataPlatformBridge.java'), 'utf8');
    const entryPoints = support.listBridgeEntryPoints(source);
    const mapping = support.checkR8MappingKeepsBridge(mappingText, entryPoints);
    add('r8_bridge_kept', mapping.ok ? 'PASS' : 'FAIL', mapping.ok ? `R8 kept AutomataPlatformBridge and its ${mapping.keptMethods.length} JNI entry points under their original names; mapping.txt ${mappingEntry ? 'is bundled in the AAB' : 'found beside the build'}` : mapping.problems.join('; '));
    for (const controller of ['AutomataAdsController', 'AutomataBillingController', 'AutomataConsentController']) {
      const kept = mappingText.includes(`com.cocos.game.${controller} -> com.cocos.game.${controller}:`);
      add(`r8_${controller}_kept`, kept ? 'PASS' : 'FAIL', kept ? `${controller} not renamed` : `${controller} missing or renamed in mapping.txt`);
    }
  }
}

function inspectApk(apkPath, ctx, add) {
  const buffer = fs.readFileSync(apkPath);
  const entries = support.readZipEntries(buffer);
  const aapt2 = resolveBuildTool(ctx.sdkPath, 'aapt2');
  if (!aapt2) {
    add('apk_manifest', 'FAIL', 'aapt2 was not found in the Android SDK build-tools');
  } else {
    const dump = runTool(aapt2, ['dump', 'xmltree', apkPath, '--file', 'AndroidManifest.xml']);
    const tree = dump.status === 0 ? support.parseXmlTreeText(dump.stdout) : null;
    if (!tree) add('apk_manifest', 'FAIL', `aapt2 could not dump the APK manifest (exit ${dump.status})`);
    else for (const finding of support.evaluateManifestSafety(support.summarizeManifest(tree), ctx.expectations)) add(`apk_${finding.id}`, finding.status, finding.message);
  }
  const alignment = support.check16KbAlignment(buffer);
  add('apk_native_16kb', alignment.violations.length ? 'FAIL' : 'PASS', alignment.violations.length ? alignment.violations.join('; ') : `${alignment.libraries.length} arm64-v8a native libraries aligned >= 16 KB`);
  const abis = support.listNativeAbis(entries);
  add('apk_abis', abis.length === 1 && abis[0] === 'arm64-v8a' ? 'PASS' : 'FAIL', `native ABIs: ${abis.join(', ') || 'none'}`);

  const apksigner = resolveBuildTool(ctx.sdkPath, 'apksigner');
  let signed = false;
  if (apksigner) {
    const verify = runTool(apksigner, ['verify', '--print-certs', apkPath]);
    signed = verify.status === 0;
    const digest = /certificate SHA-256 digest: ([0-9a-f]+)/iu.exec(verify.stdout);
    add('apk_signing', signed ? 'PASS' : (ctx.flags.requireSigning ? 'FAIL' : 'WARN'), signed ? `APK signature verifies (apksigner)${digest ? `; signer certificate SHA-256 ${digest[1]}` : ''}` : 'APK is UNSIGNED or its signature does not verify (cannot be installed until signed)');
  } else {
    add('apk_signing', 'WARN', 'apksigner not found; signature not verified');
  }
  if (ctx.plan.signing.state === 'configured' && !signed) add('apk_signing_consistency', 'FAIL', 'signing inputs were supplied but the APK signature does not verify');
  scanArtifactContent(buffer, entries, (id, status, message) => add(`apk_${id}`, status, message), 'the APK');
}

/** Runs every check on the given artifacts. Returns { ok, findings, report }. */
function runArtifactChecks(ctx) {
  const findings = [];
  const expectations = {
    packageName: ctx.plan.packageName,
    versionCode: ctx.plan.version.versionCode,
    versionName: ctx.plan.version.versionName,
    targetSdk: support.REQUIRED_TARGET_SDK,
    minSdk: support.RECORDED_MIN_SDK,
    requireProductionIds: !!ctx.flags.requireProductionIds,
    allowSampleIds: !!ctx.flags.allowSampleIds,
  };
  const full = { ...ctx, expectations };
  const safe = (label, fn) => {
    try {
      fn();
    } catch (error) {
      findings.push({ id: `${label}_error`, status: 'FAIL', message: String(error.message || error) });
    }
  };
  const addFor = (artifact) => (id, status, message) => findings.push({ id, status, message, artifact });
  if (ctx.aabPath) safe('aab', () => inspectAab(ctx.aabPath, full, addFor(path.basename(ctx.aabPath))));
  if (ctx.apkPath) safe('apk', () => inspectApk(ctx.apkPath, full, addFor(path.basename(ctx.apkPath))));
  const monotonic = checkVersionCodeAgainstLedger(ctx.plan);
  findings.push({ id: 'version_code_monotonic', status: monotonic.ok ? 'PASS' : 'FAIL', message: `versionCode ${ctx.plan.version.versionCode}: ${monotonic.note}` });
  const ok = findings.every((finding) => finding.status !== 'FAIL');
  return {
    ok,
    findings,
    report: {
      generatedAt: new Date().toISOString(),
      ok,
      packageName: ctx.plan.packageName,
      versionCode: ctx.plan.version.versionCode,
      versionName: ctx.plan.version.versionName,
      signing: ctx.plan.signing.state,
      adsMode: ctx.plan.adsMode,
      artifacts: [ctx.aabPath, ctx.apkPath].filter(Boolean).map((file) => path.basename(file)),
      findings,
    },
  };
}

function printReport(result, log) {
  log('AUT-073 release safety report');
  for (const finding of result.findings) log(`  [${finding.status}] ${finding.id}: ${finding.message}`);
  log(result.ok ? 'AUT-073 release safety: PASS (WARN/INFO lines are not failures)' : 'AUT-073 release safety: FAIL');
}

function main(argv) {
  const files = [];
  const flags = { requireProductionIds: false, allowSampleIds: false, requireSigning: false };
  let packageName = '';
  let versionCode = 0;
  let sdkPath = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : '');
  const workspaceSdk = path.join(repoRoot, 'temp', 'ci', 'android-sdk');
  if (fs.existsSync(workspaceSdk)) sdkPath = workspaceSdk;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--require-production-ids') flags.requireProductionIds = true;
    else if (arg === '--allow-sample-ids') flags.allowSampleIds = true;
    else if (arg === '--require-signing') flags.requireSigning = true;
    else if (arg === '--package') packageName = argv[++index] || '';
    else if (arg === '--version-code') versionCode = Number.parseInt(argv[++index] || '0', 10);
    else if (arg.startsWith('--')) { console.error(`Unknown argument: ${arg}`); return 2; }
    else files.push(path.resolve(arg));
  }
  if (files.length === 0) { console.error('usage: release_checks.js <file.aab|file.apk>... [--package id] [--version-code n] [--require-production-ids] [--allow-sample-ids] [--require-signing]'); return 2; }
  const plan = {
    packageName: packageName || support.resolvePackageName(process.env),
    version: { versionName: '', versionCode },
    gitIdentity: { gitSha: 'unknown' },
    signing: { state: 'unsigned' },
    adsMode: 'unknown',
  };
  if (!versionCode) { console.error('--version-code is required for standalone checks'); return 2; }
  const result = runArtifactChecks({
    repoRoot, sdkPath, flags, plan,
    aabPath: files.find((file) => file.toLowerCase().endsWith('.aab')) || '',
    apkPath: files.find((file) => file.toLowerCase().endsWith('.apk')) || '',
    mappingPath: '',
  });
  printReport(result, console.log);
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
} else {
  module.exports = { checkVersionCodeAgainstLedger, printReport, recordVersionCode, runArtifactChecks };
}
