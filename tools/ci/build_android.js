#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const debugBuildConfig = path.join(__dirname, 'cocos_android_debug_build.json');
const releaseBuildConfig = path.join(__dirname, 'cocos_android_release_build.json');
// AUT-073: --release switches the Cocos config, task name and Gradle tasks; everything else is shared with the debug path.
let buildConfig = debugBuildConfig;
const buildRoot = path.join(repoRoot, 'build', 'android');
const gradleProject = path.join(buildRoot, 'proj');
const gradleWrapper = path.join(gradleProject, 'gradlew.bat');
const gradleProperties = path.join(gradleProject, 'gradle.properties');
const gradleModule = 'ProjectAutomata';
const expectedDebugApkName = 'ProjectAutomata-debug.apk';
let taskName = 'AUT-CX-004 Android Debug';
let releaseExpectedPackageName = '';
const progressIntervalMs = 30000;
const requiredCreatorVersion = '3.8.8';
const { applyBuildInfo, readGitIdentity } = require('./write_build_info.js');
const releaseSupport = require('./release_support.js');
const releaseChecks = require('./release_checks.js');

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv) {
  const options = {
    cocosCreatorPath: process.env.COCOS_CREATOR_EXE || '',
    cocosTimeoutSeconds: 1200,
    gradleTimeoutSeconds: 1200,
    gradleOffline: false,
    standardGradleUserHome: false,
    skipGeneration: false,
    release: false,
    apk: false,
    requireSigning: false,
    requireProductionIds: false,
    allowSampleIds: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--skip-generation' || arg === '-SkipGeneration') {
      options.skipGeneration = true;
    } else if (arg === '--release') {
      options.release = true;
    } else if (arg === '--apk') {
      options.apk = true;
    } else if (arg === '--require-signing') {
      options.requireSigning = true;
    } else if (arg === '--require-production-ids') {
      options.requireProductionIds = true;
    } else if (arg === '--allow-sample-ids') {
      options.allowSampleIds = true;
    } else if (arg === '--gradle-offline' || arg === '-GradleOffline') {
      options.gradleOffline = true;
    } else if (arg === '--isolated-gradle-user-home' || arg === '-IsolatedGradleUserHome') {
      options.standardGradleUserHome = false;
    } else if (arg === '--standard-gradle-user-home' || arg === '-StandardGradleUserHome') {
      options.standardGradleUserHome = true;
    } else if (arg === '--cocos-creator-path' || arg === '-CocosCreatorPath') {
      options.cocosCreatorPath = argv[++index] || '';
    } else if (arg === '--cocos-timeout-seconds' || arg === '-CocosTimeoutSeconds') {
      options.cocosTimeoutSeconds = Number(argv[++index]);
    } else if (arg === '--gradle-timeout-seconds' || arg === '-GradleTimeoutSeconds') {
      options.gradleTimeoutSeconds = Number(argv[++index]);
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }

  if (!options.release && (options.apk || options.requireSigning || options.requireProductionIds || options.allowSampleIds)) {
    fail('--apk, --require-signing, --require-production-ids and --allow-sample-ids are only valid with --release.');
  }

  if (!Number.isFinite(options.cocosTimeoutSeconds) || options.cocosTimeoutSeconds <= 0) {
    fail(`Invalid Cocos timeout: ${options.cocosTimeoutSeconds}`);
  }
  if (!Number.isFinite(options.gradleTimeoutSeconds) || options.gradleTimeoutSeconds <= 0) {
    fail(`Invalid Gradle timeout: ${options.gradleTimeoutSeconds}`);
  }

  if (!options.cocosCreatorPath.trim()) {
    options.cocosCreatorPath = 'C:\\ProgramData\\cocos\\editors\\Creator\\3.8.8\\CocosCreator.exe';
  }

  return options;
}

function formatElapsed(startMs) {
  const totalSeconds = Math.max(0, Math.round((Date.now() - startMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function logPhase(message) {
  console.log(`[AUT-CX-004 ${new Date().toISOString()}] ${message}`);
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function nonEmptyFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function freshNonEmptyFile(filePath, sinceMs) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0 && stat.mtimeMs >= sinceMs;
  } catch {
    return false;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function canOpenReadWrite(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r+');
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removeFileIfExists(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
  }
}

function removeDirIfExists(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
  }
}

function assertInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`Refusing to operate outside ${parent}: ${target}`);
  }
}

function resolveAndroidSdkPath() {
  const workspaceSdk = path.join(repoRoot, 'temp', 'ci', 'android-sdk');
  if (fs.existsSync(path.join(workspaceSdk, 'platforms', 'android-36'))) {
    return workspaceSdk;
  }

  if (process.env.ANDROID_HOME && process.env.ANDROID_HOME.trim()) {
    return process.env.ANDROID_HOME.trim();
  }
  if (process.env.ANDROID_SDK_ROOT && process.env.ANDROID_SDK_ROOT.trim()) {
    return process.env.ANDROID_SDK_ROOT.trim();
  }
  if (process.env.LOCALAPPDATA) {
    const defaultSdk = path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk');
    if (fs.existsSync(defaultSdk)) {
      return defaultSdk;
    }
  }
  return '';
}

function resolveAndroidNdkPath(sdkPath) {
  const configuredNdk = process.env.ANDROID_NDK_HOME || process.env.ANDROID_NDK_ROOT || '';
  if (configuredNdk.trim() && fs.existsSync(configuredNdk.trim())) {
    return configuredNdk.trim();
  }

  const expectedNdk = path.join(sdkPath, 'ndk', '25.2.9519653');
  if (fs.existsSync(expectedNdk)) {
    return expectedNdk;
  }

  const ndkRoot = path.join(sdkPath, 'ndk');
  if (fs.existsSync(ndkRoot)) {
    const versions = fs.readdirSync(ndkRoot)
      .map((name) => path.join(ndkRoot, name))
      .filter((candidate) => fs.existsSync(path.join(candidate, 'source.properties')))
      .sort();
    if (versions.length > 0) {
      return versions[versions.length - 1];
    }
  }

  return '';
}

function resolveJavaPaths() {
  const javaHome = process.env.JAVA_HOME?.trim() || '';
  const javaFromHome = javaHome ? path.join(javaHome, 'bin', 'java.exe') : '';
  if (javaHome && fileExists(javaFromHome)) {
    return { javaHome, javaPath: javaFromHome };
  }

  const whereResult = spawnSync('where.exe', ['java'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const javaPath = (whereResult.stdout || '').split(/\r?\n/u).map((line) => line.trim()).find(Boolean) || '';
  if (javaPath && fileExists(javaPath)) {
    return { javaHome: path.dirname(path.dirname(javaPath)), javaPath };
  }

  return { javaHome: '', javaPath: '' };
}

function resolveStandardGradleUserHome() {
  const userProfile = process.env.USERPROFILE?.trim() || os.homedir();
  return path.join(userProfile, '.gradle');
}

function createResolvedCocosBuildConfig(logDir, sdkPath, ndkPath, javaHome, javaPath, releasePackageName) {
  let resolvedConfig = readJson(buildConfig);
  if (releasePackageName) {
    resolvedConfig = releaseSupport.resolveReleaseCocosConfig(resolvedConfig, { packageName: releasePackageName, sdkPath, ndkPath, javaHome, javaPath });
  } else {
    resolvedConfig.packages = resolvedConfig.packages || {};
    resolvedConfig.packages.android = resolvedConfig.packages.android || {};
    resolvedConfig.packages.android.sdkPath = sdkPath;
    resolvedConfig.packages.android.ndkPath = ndkPath;
    resolvedConfig.packages.android.javaHome = javaHome;
    resolvedConfig.packages.android.javaPath = javaPath;
  }

  const resolvedConfigPath = path.join(logDir, path.basename(buildConfig).replace(/.json$/u, '.resolved.json'));
  fs.writeFileSync(resolvedConfigPath, `${JSON.stringify(resolvedConfig, null, 2)}${os.EOL}`, 'utf8');
  return resolvedConfigPath;
}

function copyDirectoryContents(source, destination) {
  ensureDir(destination);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryContents(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      ensureDir(path.dirname(destinationPath));
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function ensureWritableEngineMirror(sourceEnginePath, fallbackParent) {
  const defaultMirrorRoot = path.join(repoRoot, 'temp', 'ci', `cocos-engine-${requiredCreatorVersion}`);
  let mirrorRoot = defaultMirrorRoot;
  let markerPath = path.join(mirrorRoot, '.automata-engine-mirror.json');
  let importMapPath = path.join(mirrorRoot, 'bin', '.cache', 'dev', 'editor', 'import-map.json');
  const sourcePackage = readJson(path.join(sourceEnginePath, 'package.json'));
  const expectedMarker = {
    source: sourceEnginePath,
    version: sourcePackage.version,
  };

  try {
    const marker = readJson(markerPath);
    if (marker.source === expectedMarker.source
      && marker.version === expectedMarker.version
      && fileExists(path.join(mirrorRoot, 'package.json'))
      && fileExists(importMapPath)
      && canOpenReadWrite(importMapPath)) {
      logPhase(`Cocos engine mirror: reusing ${mirrorRoot}`);
      return mirrorRoot;
    }
  } catch {
  }

  if (fs.existsSync(defaultMirrorRoot)) {
    mirrorRoot = path.join(fallbackParent, `cocos-engine-${requiredCreatorVersion}`);
    markerPath = path.join(mirrorRoot, '.automata-engine-mirror.json');
    importMapPath = path.join(mirrorRoot, 'bin', '.cache', 'dev', 'editor', 'import-map.json');
    logPhase(`Cocos engine mirror: default mirror is not writable; using per-run mirror at ${mirrorRoot}`);
  }

  assertInside(repoRoot, mirrorRoot);
  logPhase(`Cocos engine mirror: creating writable mirror at ${mirrorRoot}`);
  const mirrorStartedAt = Date.now();
  removeDirIfExists(mirrorRoot);
  copyDirectoryContents(sourceEnginePath, mirrorRoot);
  fs.writeFileSync(markerPath, `${JSON.stringify(expectedMarker, null, 2)}${os.EOL}`, 'utf8');
  logPhase(`Cocos engine mirror: ready after ${formatElapsed(mirrorStartedAt)}`);
  return mirrorRoot;
}

function writeCocosEngineProfile(cocosHome, customEnginePath) {
  const profilePath = path.join(cocosHome, '.CocosCreator', 'profiles', 'v2', 'packages', 'engine.json');
  ensureDir(path.dirname(profilePath));
  const profile = {
    __version__: '1.0.12',
    engine: {
      388: {
        javascript: {
          builtin: false,
          custom: customEnginePath,
        },
        native: {
          builtin: true,
        },
      },
    },
  };
  fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}${os.EOL}`, 'utf8');
  logPhase(`Cocos generation: wrote isolated engine profile ${profilePath}`);
}

function testCocosOutputShape() {
  const requiredFiles = [
    path.join(buildRoot, 'proj', 'gradlew.bat'),
    path.join(buildRoot, 'proj', 'gradle.properties'),
    path.join(buildRoot, 'proj', 'settings.gradle'),
    path.join(buildRoot, 'data', 'main.js'),
    path.join(buildRoot, 'data', 'application.js'),
    path.join(buildRoot, 'data', 'src', 'settings.json'),
    path.join(buildRoot, 'cocos.compile.config.json'),
  ];

  if (!requiredFiles.every(nonEmptyFile)) {
    return false;
  }

  let compileConfig;
  try {
    compileConfig = readJson(path.join(buildRoot, 'cocos.compile.config.json'));
  } catch {
    return false;
  }

  const abis = Array.isArray(compileConfig?.packages?.android?.appABIs)
    ? compileConfig.packages.android.appABIs
    : [];

  return compileConfig.stage === 'build'
    && compileConfig.name === 'ProjectAutomata'
    && compileConfig.platform === 'android'
    && compileConfig.outputName === 'android'
    && compileConfig.taskName === taskName
    && compileConfig.packages?.android?.apiLevel === 36
    && (!releaseExpectedPackageName || compileConfig.packages?.android?.packageName === releaseExpectedPackageName)
    && abis.length === 1
    && abis[0] === 'arm64-v8a';
}

function testFreshCocosGeneratedOutput(sinceMs) {
  if (!testCocosOutputShape()) {
    return false;
  }

  const generatedEvidenceFiles = [
    path.join(buildRoot, 'cocos.compile.config.json'),
    path.join(buildRoot, 'data', 'main.js'),
    path.join(buildRoot, 'data', 'application.js'),
    path.join(buildRoot, 'data', 'src', 'settings.json'),
  ];

  return generatedEvidenceFiles.every((filePath) => freshNonEmptyFile(filePath, sinceMs));
}

function testCocosBuildLogCompleted(logPath, sinceMs) {
  if (!freshNonEmptyFile(logPath, sinceMs)) {
    return false;
  }

  return readTextIfExists(logPath).includes(`build Task (${taskName}) Finished`);
}

const fatalCocosDiagnosticPatterns = [
  /Missing class/iu,
  /is missing or invalid/iu,
  /invalid scene script/iu,
  /SyntaxError/iu,
  /buildScriptCommand[^\r\n]*(?:fail|error)/iu,
  /(?:fail|error)[^\r\n]*buildScriptCommand/iu,
  /build task[^\r\n]*(?:fail|error)/iu,
  /(?:fail|error)[^\r\n]*build task/iu,
  /EPERM/iu,
  /Access is denied/iu,
  /Failed to load the custom engine/iu,
  /Load engine modules or register macro config failed/iu,
  /Message does not exist: engine - query-engine-info/iu,
];

function findFatalCocosDiagnosticsInText(logs) {
  return fatalCocosDiagnosticPatterns
    .map((pattern) => pattern.exec(logs)?.[0] || '')
    .filter(Boolean);
}

function findFatalCocosDiagnostics(logPaths) {
  return findFatalCocosDiagnosticsInText(logPaths.map(readTextIfExists).join('\n'));
}

function collectCocosGenerationEvidence(sinceMs, cocosBuildLog, logPaths) {
  const freshGeneratedOutputs = testFreshCocosGeneratedOutput(sinceMs);
  const completionMarker = testCocosBuildLogCompleted(cocosBuildLog, sinceMs);
  const outputShape = testCocosOutputShape();
  const fatalDiagnostics = findFatalCocosDiagnostics(logPaths);

  return {
    freshGeneratedOutputs,
    completionMarker,
    outputShape,
    fatalDiagnostics,
    succeeded: isAcceptableCocosGenerationEvidence({
      freshGeneratedOutputs,
      completionMarker,
      outputShape,
      fatalDiagnostics,
    }),
  };
}

function isAcceptableCocosGenerationEvidence(evidence) {
  return evidence.freshGeneratedOutputs
    && evidence.completionMarker
    && evidence.outputShape
    && evidence.fatalDiagnostics.length === 0;
}

function isAcceptableCocosExit(exitCode, evidence) {
  if (!isAcceptableCocosGenerationEvidence(evidence)) {
    return false;
  }

  return exitCode === 0 || exitCode === 36;
}

function formatCocosEvidence(evidence) {
  return `freshOutputs=${evidence.freshGeneratedOutputs}; completionMarker=${evidence.completionMarker}; outputShape=${evidence.outputShape}; fatalDiagnostics=${evidence.fatalDiagnostics.length}`;
}

function failCocosGeneration(message, logPaths, evidence) {
  printLastRelevantLogLines(logPaths);
  const fatalDetail = evidence?.fatalDiagnostics?.length > 0
    ? ` Fatal diagnostics: ${evidence.fatalDiagnostics.join('; ')}.`
    : '';
  const evidenceDetail = evidence ? ` Evidence: ${formatCocosEvidence(evidence)}.` : '';
  fail(`${message}${fatalDetail}${evidenceDetail} Logs: ${logPaths.join(' ')}`);
}

function assertAcceptedCocosGeneration(sinceMs, cocosBuildLog, logPaths) {
  const evidence = collectCocosGenerationEvidence(sinceMs, cocosBuildLog, logPaths);
  if (!evidence.succeeded) {
    failCocosGeneration('Cocos Android generation did not produce acceptable deterministic success evidence.', logPaths, evidence);
  }

  return evidence;
}

function assertAcceptableCocosExit(exitCode, startedAtMs, cocosBuildLog, logPaths) {
  const evidence = collectCocosGenerationEvidence(startedAtMs, cocosBuildLog, logPaths);
  if (isAcceptableCocosExit(exitCode, evidence)) {
    return evidence;
  }

  failCocosGeneration(`Cocos Android generation exited with code ${exitCode} without acceptable deterministic success evidence.`, logPaths, evidence);
}

function testAcceptableCocosPostSuccessExit(exitCode, startedAtMs, cocosBuildLog, logPaths) {
  const evidence = collectCocosGenerationEvidence(startedAtMs, cocosBuildLog, logPaths);
  return exitCode === 36 && evidence.succeeded;
}

function testCocosGenerationSucceeded(sinceMs, cocosBuildLog, logPaths = [cocosBuildLog]) {
  return collectCocosGenerationEvidence(sinceMs, cocosBuildLog, logPaths).succeeded;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tailFileLines(filePath, maxLines = 40) {
  const text = readTextIfExists(filePath);
  if (!text.trim()) {
    return [`${filePath}: <empty or missing>`];
  }

  const lines = text.replace(/\r\n/gu, '\n').split('\n').filter((line) => line.length > 0);
  return [`${filePath}:`, ...lines.slice(-maxLines)];
}

function printLastRelevantLogLines(logPaths) {
  logPhase('Last relevant log lines:');
  for (const logPath of logPaths) {
    for (const line of tailFileLines(logPath)) {
      console.error(line);
    }
  }
}

async function stopSpawnedProcessTree(child, phase) {
  if (!child?.pid) {
    return;
  }
  if (child.exitCode !== null || child.signalCode !== null) {
    logPhase(`${phase}: child PID ${child.pid} already exited`);
    return;
  }

  logPhase(`${phase}: terminating spawned process tree for PID ${child.pid}`);
  spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) {
      logPhase(`${phase}: child PID ${child.pid} exited after termination`);
      return;
    }
    await sleep(250);
  }

  logPhase(`${phase}: child PID ${child.pid} did not report exit after taskkill; continuing after bounded wait`);
}

function psSingleQuoted(value) {
  return `'${String(value).replace(/'/gu, "''")}'`;
}

function stopCocosProcessesForProfile(profileRoot, phase) {
  const script = [
    `$profileRoot = ${psSingleQuoted(profileRoot)}`,
    "$matches = Get-CimInstance Win32_Process -Filter \"name = 'CocosCreator.exe'\" | Where-Object { $_.CommandLine -like \"*$profileRoot*\" }",
    'foreach ($process in $matches) { Stop-Process -Id $process.ProcessId -Force }',
    'Write-Output (($matches | Measure-Object).Count)',
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const stoppedCount = Number.parseInt((result.stdout || '').trim(), 10) || 0;
  if (stoppedCount > 0) {
    logPhase(`${phase}: terminated ${stoppedCount} lingering Cocos process(es) for ${profileRoot}`);
  }
}

function getCocosCreatorProcessIds() {
  const script = "Get-Process CocosCreator -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return new Set((result.stdout || '')
    .split(/\r?\n/u)
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0));
}

function stopNewCocosProcesses(initialProcessIds, phase) {
  const initial = [...initialProcessIds].join(',');
  const script = [
    `$initial = @(${initial})`,
    "$matches = Get-Process CocosCreator -ErrorAction SilentlyContinue | Where-Object { $initial -notcontains [int]$_.Id }",
    'foreach ($process in $matches) { Stop-Process -Id $process.Id -Force }',
    'Write-Output (($matches | Measure-Object).Count)',
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const stoppedCount = Number.parseInt((result.stdout || '').trim(), 10) || 0;
  if (stoppedCount > 0) {
    logPhase(`${phase}: terminated ${stoppedCount} new lingering Cocos process(es)`);
  }
}

function wireLiveLog(child, streamName, logStream, consoleStream) {
  child[streamName].on('data', (chunk) => {
    logStream.write(chunk);
    consoleStream.write(chunk);
  });
}

function closeStream(stream) {
  return new Promise((resolve) => {
    stream.end(resolve);
  });
}

async function runCocosGeneration(options, startedAtMs, sdkPath, ndkPath, javaHome, javaPath, sourceEnginePath, releasePackageName) {
  const logDir = path.join(repoRoot, 'temp', 'ci', `cocos-run-${process.pid}-${Date.now()}`);
  ensureDir(logDir);

  const stdoutLog = path.join(logDir, 'cocos_android_build.stdout.log');
  const stderrLog = path.join(logDir, 'cocos_android_build.stderr.log');
  const cocosBuildLog = path.join(logDir, 'cocos-cli.log');
  const cocosLogPaths = [cocosBuildLog, stdoutLog, stderrLog];
  const resolvedBuildConfig = createResolvedCocosBuildConfig(logDir, sdkPath, ndkPath, javaHome, javaPath, releasePackageName);

  [
    stdoutLog,
    stderrLog,
    cocosBuildLog,
    path.join(buildRoot, 'cocos.compile.config.json'),
    path.join(buildRoot, 'data', 'main.js'),
    path.join(buildRoot, 'data', 'application.js'),
    path.join(buildRoot, 'data', 'src', 'settings.json'),
  ].forEach(removeFileIfExists);

  const buildArgument = `stage=build;configPath=${resolvedBuildConfig};logDest=${cocosBuildLog};`;
  const phase = 'Cocos generation';
  const phaseStartMs = Date.now();
  const cocosProfileRoot = path.join(logDir, `cocos-profile-${process.pid}-${phaseStartMs}`);
  const cocosHome = path.join(cocosProfileRoot, 'Home');
  const cocosCreatorHome = path.join(cocosHome, '.CocosCreator');
  const cocosUserData = path.join(cocosProfileRoot, 'ElectronUserData');
  const cocosDiskCache = path.join(cocosProfileRoot, 'DiskCache');
  [cocosHome, cocosCreatorHome, cocosUserData, cocosDiskCache].forEach(ensureDir);
  const writableEnginePath = ensureWritableEngineMirror(sourceEnginePath, logDir);
  writeCocosEngineProfile(cocosHome, writableEnginePath);

  logPhase(`${phase}: start`);
  logPhase(`${phase}: Creator executable ${options.cocosCreatorPath} (Creator 3.8.8)`);
  logPhase(`${phase}: resolved build config ${resolvedBuildConfig}`);
  logPhase(`${phase}: Android SDK ${sdkPath}`);
  logPhase(`${phase}: Android NDK ${ndkPath}`);
  logPhase(`${phase}: Java home ${javaHome}`);
  logPhase(`${phase}: logDest ${cocosBuildLog}`);
  logPhase(`${phase}: isolated Cocos home ${cocosCreatorHome}`);
  logPhase(`${phase}: isolated user data ${cocosUserData}`);

  const stdoutStream = fs.createWriteStream(stdoutLog, { flags: 'w' });
  const stderrStream = fs.createWriteStream(stderrLog, { flags: 'w' });
  const cocosEnv = {
    ...process.env,
    ANDROID_HOME: sdkPath,
    ANDROID_SDK_ROOT: sdkPath,
    ELECTRON_DISABLE_GPU: '1',
  };
  const cocosArgs = [
    '--home',
    cocosCreatorHome,
    `--user-data-dir=${cocosUserData}`,
    `--disk-cache-dir=${cocosDiskCache}`,
    '--disable-gpu',
    '--disable-gpu-sandbox',
    '--no-sandbox',
    '--no-quick-compile',
    '--project',
    repoRoot,
    '--build',
    buildArgument,
  ];

  logPhase(`${phase}: launch ${options.cocosCreatorPath} ${cocosArgs.join(' ')}`);
  const cocosProcessIdsBeforeLaunch = getCocosCreatorProcessIds();
  const child = spawn(
    options.cocosCreatorPath,
    cocosArgs,
    {
      cwd: repoRoot,
      env: cocosEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  logPhase(`${phase}: Creator PID ${child.pid || '<not-started>'}`);

  wireLiveLog(child, 'stdout', stdoutStream, process.stdout);
  wireLiveLog(child, 'stderr', stderrStream, process.stderr);

  let exitResult = null;
  child.on('exit', (code, signal) => {
    exitResult = { code, signal };
  });

  child.on('error', (error) => {
    exitResult = { code: 127, signal: null, error };
  });

  const deadlineMs = phaseStartMs + (options.cocosTimeoutSeconds * 1000);
  let nextProgressMs = Date.now() + progressIntervalMs;
  let successSinceMs = 0;
  let terminatedAfterGeneration = false;

  logPhase(`${phase}: waiting for generation evidence`);
  try {
    while (!exitResult) {
      if (Date.now() > deadlineMs) {
        logPhase(`${phase}: timed out after ${formatElapsed(phaseStartMs)}; Creator PID ${child.pid}`);
        printLastRelevantLogLines(cocosLogPaths);
        await stopSpawnedProcessTree(child, phase);
        fail(`Cocos Android generation timed out after ${options.cocosTimeoutSeconds} seconds. Logs: ${cocosLogPaths.join(' ')}`);
      }

      const evidence = collectCocosGenerationEvidence(startedAtMs, cocosBuildLog, cocosLogPaths);
      if (evidence.fatalDiagnostics.length > 0) {
        await stopSpawnedProcessTree(child, phase);
        failCocosGeneration('Cocos Android generation produced a fatal diagnostic.', cocosLogPaths, evidence);
      }

      if (evidence.succeeded) {
        if (successSinceMs === 0) {
          successSinceMs = Date.now();
          logPhase(`${phase}: generation evidence detected (${formatCocosEvidence(evidence)}); waiting 5s before terminating Creator if it remains alive`);
        } else if (Date.now() - successSinceMs >= 5000) {
          logPhase(`${phase}: Creator still alive after success evidence`);
          await stopSpawnedProcessTree(child, phase);
          terminatedAfterGeneration = true;
          break;
        }
      }

      if (Date.now() >= nextProgressMs) {
        const logSize = fileExists(cocosBuildLog) ? fs.statSync(cocosBuildLog).size : 0;
        logPhase(`${phase}: still waiting after ${formatElapsed(phaseStartMs)}; PID ${child.pid}; ${formatCocosEvidence(evidence)}; logBytes=${logSize}`);
        nextProgressMs += progressIntervalMs;
      }

      await sleep(2000);
    }
  } finally {
    stopCocosProcessesForProfile(cocosProfileRoot, phase);
    stopNewCocosProcesses(cocosProcessIdsBeforeLaunch, phase);
    child.stdout?.destroy();
    child.stderr?.destroy();
    await Promise.all([closeStream(stdoutStream), closeStream(stderrStream)]);
  }

  if (exitResult?.error) {
    fail(`Failed to start Cocos Creator: ${exitResult.error.message}`, 127);
  }

  if (!terminatedAfterGeneration) {
    logPhase(`${phase}: Creator exited after ${formatElapsed(phaseStartMs)} with code=${exitResult?.code ?? '<none>'} signal=${exitResult?.signal || '<none>'}`);
    const exitCode = exitResult?.code ?? 1;
    assertAcceptableCocosExit(exitCode, startedAtMs, cocosBuildLog, cocosLogPaths);

    if (exitCode !== 0) {
      logPhase(`${phase}: Creator exited with code ${exitCode} after fresh generated outputs, completion marker, expected Android project shape, and no fatal Cocos diagnostics; continuing to Gradle verification`);
    }
  }

  assertAcceptedCocosGeneration(startedAtMs, cocosBuildLog, cocosLogPaths);

  logPhase(`${phase}: complete after ${formatElapsed(phaseStartMs)}`);
}

function getGradleProperties() {
  const properties = new Map();
  const lines = fs.readFileSync(gradleProperties, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = /^([^#=\s][^=]*)=(.*)$/.exec(line);
    if (match) {
      properties.set(match[1].trim(), match[2].trim());
    }
  }
  return properties;
}

function setGradleProperty(name, value) {
  const pattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=`);
  const lines = fileExists(gradleProperties)
    ? fs.readFileSync(gradleProperties, 'utf8').split(/\r?\n/)
    : [];
  let updated = false;

  const next = lines.map((line) => {
    if (pattern.test(line)) {
      updated = true;
      return `${name}=${value}`;
    }
    return line;
  });

  if (!updated) {
    next.push(`${name}=${value}`);
  }

  fs.writeFileSync(gradleProperties, `${next.join(os.EOL).replace(/\s+$/u, '')}${os.EOL}`, 'utf8');
}

function getCMakeVersion() {
  const properties = getGradleProperties();
  const propertyVersion = properties.get('PROP_CMAKE_VERSION');
  if (propertyVersion) {
    return propertyVersion;
  }

  const appBuildGradle = path.join(repoRoot, 'native', 'engine', 'android', 'app', 'build.gradle');
  const match = /version\s+"([^"]+)"/.exec(readTextIfExists(appBuildGradle));
  return match ? match[1] : '';
}

function walkFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) {
    return files;
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function removeExistingApks(buildPath) {
  assertInside(repoRoot, buildPath);
  for (const filePath of walkFiles(buildPath)) {
    if (filePath.toLowerCase().endsWith('.apk') || filePath.toLowerCase().endsWith('.aab')) {
      try {
        fs.rmSync(filePath, { force: true });
      } catch (error) {
        console.warn(`Could not remove stale APK ${filePath}; continuing because fresh APK verification uses build start time. ${error.message}`);
      }
    }
  }
}

function removeGeneratedGradleProblemReport() {
  const reportPath = path.join(gradleProject, 'build', 'reports', 'problems');
  assertInside(repoRoot, reportPath);
  try {
    fs.rmSync(reportPath, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Could not remove generated Gradle problems report directory; continuing with --no-problems-report. ${error.message}`);
    }
  }
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
  });

  if (result.error) {
    fail(`${command} failed to start: ${result.error.message}`, 127);
  }

  if (result.status !== 0) {
    const detail = options.capture ? `${result.stdout || ''}${result.stderr || ''}`.trim() : '';
    fail(`${command} failed with exit code ${result.status}.${detail ? `\n${detail}` : ''}`);
  }

  return result;
}

async function runTimedLoggedChild({
  phase,
  command,
  args,
  cwd = repoRoot,
  env = process.env,
  timeoutSeconds,
  stdoutLog,
  stderrLog,
}) {
  ensureDir(path.dirname(stdoutLog));
  ensureDir(path.dirname(stderrLog));
  removeFileIfExists(stdoutLog);
  removeFileIfExists(stderrLog);

  const phaseStartMs = Date.now();
  logPhase(`${phase}: launch ${command} ${args.join(' ')}`);

  const stdoutStream = fs.createWriteStream(stdoutLog, { flags: 'w' });
  const stderrStream = fs.createWriteStream(stderrLog, { flags: 'w' });
  const child = spawn(command, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  logPhase(`${phase}: child PID ${child.pid || '<not-started>'}`);
  wireLiveLog(child, 'stdout', stdoutStream, process.stdout);
  wireLiveLog(child, 'stderr', stderrStream, process.stderr);

  const exitPromise = new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
    child.on('error', (error) => resolve({ code: 127, signal: null, error }));
  });

  let nextProgressMs = Date.now() + progressIntervalMs;
  while (true) {
    const result = await Promise.race([exitPromise, sleep(1000).then(() => null)]);
    if (result) {
      await Promise.all([closeStream(stdoutStream), closeStream(stderrStream)]);
      if (result.error) {
        printLastRelevantLogLines([stdoutLog, stderrLog]);
        fail(`${phase}: failed to start after ${formatElapsed(phaseStartMs)}: ${result.error.message}`, 127);
      }

      logPhase(`${phase}: child PID ${child.pid} exited after ${formatElapsed(phaseStartMs)} with code=${result.code} signal=${result.signal || '<none>'}`);
      if (result.code !== 0) {
        printLastRelevantLogLines([stdoutLog, stderrLog]);
        fail(`${phase}: failed with exit code ${result.code}. Logs: ${stdoutLog} ${stderrLog}`);
      }

      return;
    }

    if (Date.now() >= nextProgressMs) {
      logPhase(`${phase}: still running after ${formatElapsed(phaseStartMs)}; child PID ${child.pid}`);
      nextProgressMs += progressIntervalMs;
    }

    if (Date.now() - phaseStartMs > timeoutSeconds * 1000) {
      logPhase(`${phase}: timed out after ${formatElapsed(phaseStartMs)}; child PID ${child.pid}`);
      printLastRelevantLogLines([stdoutLog, stderrLog]);
      await stopSpawnedProcessTree(child, phase);
      await Promise.all([closeStream(stdoutStream), closeStream(stderrStream)]);
      fail(`${phase}: timed out after ${timeoutSeconds} seconds. Logs: ${stdoutLog} ${stderrLog}`, 124);
    }
  }
}

function findFreshDebugApk(sinceMs) {
  return walkFiles(path.join(gradleProject, 'build'))
    .filter((filePath) => filePath.toLowerCase().endsWith('.apk'))
    .filter((filePath) => path.basename(filePath) === expectedDebugApkName)
    .map((filePath) => ({ filePath, stat: fs.statSync(filePath) }))
    .filter((item) => item.stat.size > 0 && item.stat.mtimeMs >= sinceMs)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0]?.filePath || '';
}

function assertGradleBuildSuccessful(stdoutLog, stderrLog) {
  const logs = `${readTextIfExists(stdoutLog)}\n${readTextIfExists(stderrLog)}`;
  if (!/\bBUILD SUCCESSFUL\b/u.test(logs)) {
    printLastRelevantLogLines([stdoutLog, stderrLog]);
    fail(`Gradle completed with exit code 0 but did not report BUILD SUCCESSFUL. Logs: ${stdoutLog} ${stderrLog}`);
  }
}

function assertNativeLibraries16Kb(apkPath) {
  // AUT-073: the ZIP/ELF inspection moved to release_support.js so the release AAB/APK checks share the exact same implementation.
  const result = releaseSupport.check16KbAlignment(fs.readFileSync(apkPath));
  if (result.violations.length > 0) {
    fail(`16 KB page-size check failed for ${apkPath}: ${result.violations.join('; ')}`);
  }
}

/**
 * AUT-073: validates every release input BEFORE any slow step and returns the resolved release plan. Secrets are only
 * classified (present/absent), never printed. Exits non-zero with a clear message when a requested guarantee cannot be met.
 */
function prepareRelease(options) {
  buildConfig = releaseBuildConfig;
  taskName = 'AUT-073 Android Release';
  const shapeProblems = releaseSupport.validateReleaseConfigShape(readJson(buildConfig));
  if (shapeProblems.length > 0) {
    fail(`${buildConfig} is not a valid release config: ${shapeProblems.join('; ')}`);
  }

  let packageName;
  let version;
  try {
    packageName = releaseSupport.resolvePackageName(process.env);
    version = releaseSupport.resolveVersionIdentity(process.env, readGitIdentity());
  } catch (error) {
    fail(String(error.message || error));
  }
  releaseExpectedPackageName = packageName;

  const signing = releaseSupport.classifySigningInputs(process.env, fileExists);
  if (signing.state === 'incomplete') {
    fail(`Release signing inputs are unusable: ${signing.problems.join('; ')}.`);
  }
  if (signing.state === 'unsigned' && options.requireSigning) {
    fail('--require-signing: RELEASE_STORE_FILE, RELEASE_STORE_PASSWORD, RELEASE_KEY_ALIAS and RELEASE_KEY_PASSWORD must all be set in the environment. Refusing to build.');
  }

  const admobValues = {};
  for (const name of releaseSupport.ADMOB_ENV_NAMES) admobValues[name] = process.env[name] || '';
  const admobPolicy = releaseSupport.evaluateAdmobPolicy(releaseSupport.classifyAdmobValues(admobValues), options);
  if (!admobPolicy.ok) {
    fail(`AdMob configuration rejected: ${admobPolicy.problems.join('; ')}.`);
  }

  const gitIdentity = readGitIdentity();
  const plan = { packageName, version, signing, adsMode: admobPolicy.adsMode, gitIdentity };
  const monotonic = releaseChecks.checkVersionCodeAgainstLedger(plan, process.env);
  if (!monotonic.ok) {
    fail(`Release versionCode check failed: ${monotonic.note}`);
  }

  logPhase(`Release plan: package=${packageName} versionName=${version.versionName} versionCode=${version.versionCode} (${version.source}) gitSha=${gitIdentity.gitSha}${gitIdentity.gitDirty ? '+dirty-assets' : ''}`);
  logPhase(`Release plan: signing=${signing.state === 'configured' ? 'CONFIGURED (upload key from environment)' : 'UNSIGNED (no RELEASE_* inputs; the bundle must be signed before Play upload)'}; ads=${admobPolicy.adsMode}; versionCode note: ${monotonic.note}`);
  return plan;
}

function findFreshReleaseArtifact(extension, sinceMs) {
  return walkFiles(path.join(gradleProject, 'build', gradleModule, 'outputs'))
    .filter((filePath) => filePath.toLowerCase().endsWith(extension) && /[\\/]release[\\/]/u.test(filePath))
    .map((filePath) => ({ filePath, stat: fs.statSync(filePath) }))
    .filter((item) => item.stat.size > 0 && item.stat.mtimeMs >= sinceMs)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0]?.filePath || '';
}

async function finishRelease(options, release, gradleStartedAtMs, sdkPath) {
  logPhase('Release verification: locating fresh bundle' + (options.apk ? ' and APK' : ''));
  const aabPath = findFreshReleaseArtifact('.aab', gradleStartedAtMs);
  if (!aabPath) fail(`Gradle completed but no fresh non-empty release .aab was found under ${path.join(gradleProject, 'build', gradleModule, 'outputs')}.`);
  const apkPath = options.apk ? findFreshReleaseArtifact('.apk', gradleStartedAtMs) : '';
  if (options.apk && !apkPath) fail('Gradle completed but no fresh non-empty release .apk was found.');

  const outDir = path.join(repoRoot, 'temp', 'release');
  ensureDir(outDir);
  const label = `${release.version.versionName}-${release.version.versionCode}-${release.signing.state === 'configured' ? 'signed' : 'UNSIGNED'}`;
  const copies = {};
  copies.aab = path.join(outDir, `ProjectAutomata-${label}.aab`);
  fs.copyFileSync(aabPath, copies.aab);
  if (apkPath) {
    copies.apk = path.join(outDir, `ProjectAutomata-${label}.apk`);
    fs.copyFileSync(apkPath, copies.apk);
  }

  logPhase('Release safety checks: running on the built artifacts');
  const result = releaseChecks.runArtifactChecks({
    repoRoot,
    sdkPath,
    aabPath: copies.aab,
    apkPath: copies.apk || '',
    mappingPath: path.join(gradleProject, 'build', gradleModule, 'outputs', 'mapping', 'release', 'mapping.txt'),
    plan: release,
    flags: { requireProductionIds: options.requireProductionIds, allowSampleIds: options.allowSampleIds, requireSigning: options.requireSigning },
  });
  releaseChecks.printReport(result, console.log);
  ensureDir(outDir);
  fs.writeFileSync(path.join(outDir, 'release_checks.json'), `${JSON.stringify(result.report, null, 2)}${os.EOL}`, 'utf8');
  if (!result.ok) {
    fail('Release safety checks FAILED (see above). The artifacts were left under temp/release/ for inspection only; do not upload them.');
  }
  releaseChecks.recordVersionCode(release);
  console.log(`Release AAB: ${copies.aab}${release.signing.state === 'configured' ? '' : '  (UNSIGNED: sign with the upload key before Play upload)'}`);
  if (copies.apk) console.log(`Release APK: ${copies.apk}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const release = options.release ? prepareRelease(options) : null;
  logPhase(`start: repo=${repoRoot}`);
  logPhase(`start: skipGeneration=${options.skipGeneration}; gradleOffline=${options.gradleOffline}; gradleUserHome=${options.standardGradleUserHome ? 'standard' : 'workspace'}; cocosTimeoutSeconds=${options.cocosTimeoutSeconds}; gradleTimeoutSeconds=${options.gradleTimeoutSeconds}`);

  if (!fileExists(options.cocosCreatorPath)) {
    fail(`Cocos Creator executable not found: ${options.cocosCreatorPath}`, 127);
  }

  const creatorRoot = path.dirname(options.cocosCreatorPath);
  const sourceEnginePath = path.join(creatorRoot, 'resources', 'resources', '3d', 'engine');
  const creatorEnginePackage = path.join(sourceEnginePath, 'package.json');
  if (!fileExists(creatorEnginePackage)) {
    fail(`Could not find Cocos engine package metadata at ${creatorEnginePackage}.`);
  }

  const creatorVersion = readJson(creatorEnginePackage).version;
  if (creatorVersion !== requiredCreatorVersion) {
    fail(`Cocos Creator must remain locked to 3.8.8. Found ${creatorVersion} in ${creatorEnginePackage}.`);
  }

  const sdkPath = resolveAndroidSdkPath();
  if (!sdkPath || !fs.existsSync(path.join(sdkPath, 'platforms', 'android-36'))) {
    fail('Android SDK platform android-36 was not found. Set ANDROID_HOME or ANDROID_SDK_ROOT to an SDK with API 36 installed.');
  }
  const ndkPath = resolveAndroidNdkPath(sdkPath);
  if (!ndkPath || !fs.existsSync(path.join(ndkPath, 'source.properties'))) {
    fail(`Android NDK was not found under ${sdkPath}.`);
  }
  const { javaHome, javaPath } = resolveJavaPaths();
  if (!javaHome || !javaPath) {
    fail('Java was not found. Set JAVA_HOME or put java.exe on PATH.');
  }

  const startedAtMs = Date.now() - 1000;

  if (!options.skipGeneration) {
    // AUT-072: stamp the build identity (git sha / build number) into BuildInfoData.ts only while Cocos compiles the scripts.
    const restoreBuildInfo = applyBuildInfo();
    try {
      await runCocosGeneration(options, startedAtMs, sdkPath, ndkPath, javaHome, javaPath, sourceEnginePath, release ? release.packageName : '');
    } finally {
      restoreBuildInfo();
    }
  }

  if (!fileExists(gradleWrapper)) {
    fail(`Gradle wrapper was not generated at ${gradleWrapper}.`);
  }

  setGradleProperty('PROP_MIN_SDK_VERSION', '23');
  if (!getGradleProperties().get('PROP_NDK_VERSION')) {
    setGradleProperty('PROP_NDK_VERSION', '25.2.9519653');
  }

  const properties = getGradleProperties();
  const compileSdk = properties.get('PROP_COMPILE_SDK_VERSION') || '';
  const targetSdk = properties.get('PROP_TARGET_SDK_VERSION') || '';
  const minSdk = properties.get('PROP_MIN_SDK_VERSION') || '';
  const abi = properties.get('PROP_APP_ABI') || '';
  const ndkVersion = properties.get('PROP_NDK_VERSION') || '';
  const cmakeVersion = getCMakeVersion();

  if (compileSdk !== '36' || targetSdk !== '36') {
    fail(`Generated Android project must compile/target SDK 36. Found compile=${compileSdk} target=${targetSdk}.`);
  }
  if (Number.parseInt(minSdk, 10) < 23) {
    fail(`Generated Android project minSdk must be >=23. Found ${minSdk}.`);
  }
  if (abi !== 'arm64-v8a') {
    fail(`Generated Android project must target only arm64-v8a. Found ${abi}.`);
  }

  if (release) {
    if (minSdk !== String(releaseSupport.RECORDED_MIN_SDK)) fail(`Release minSdk must be the recorded ${releaseSupport.RECORDED_MIN_SDK}. Found ${minSdk}.`);
    if (properties.get('PROP_IS_DEBUG') !== 'false') fail(`Generated release project must have PROP_IS_DEBUG=false. Found ${properties.get('PROP_IS_DEBUG')}.`);
    if (properties.get('APPLICATION_ID') !== release.packageName) fail(`Generated APPLICATION_ID ${properties.get('APPLICATION_ID')} does not match the requested ${release.packageName}.`);
  }

  console.log(`Observed Android config: compileSdk=${compileSdk} targetSdk=${targetSdk} minSdk=${minSdk} abi=${abi} ndk=${ndkVersion} cmake=${cmakeVersion} sdk=${sdkPath}`);
  console.log('Java:');
  runChecked('java.exe', ['-version']);

  logPhase('Gradle build: preparing generated project');
  removeExistingApks(path.join(gradleProject, 'build'));
  removeGeneratedGradleProblemReport();
  const gradleStartedAtMs = Date.now() - 1000;
  const gradleEnv = {
    ...process.env,
    GRADLE_USER_HOME: options.standardGradleUserHome
      ? resolveStandardGradleUserHome()
      : path.join(buildRoot, 'gradle-user'),
  };
  if (release) {
    // Read by native/engine/android/app/build.gradle (versionCode / versionName). Signing + AdMob inputs are already in process.env.
    gradleEnv.AUTOMATA_VERSION_CODE = String(release.version.versionCode);
    gradleEnv.AUTOMATA_GAME_VERSION = release.version.versionName;
  }
  const observedGradleUserHome = gradleEnv.GRADLE_USER_HOME;
  logPhase(`Gradle build: user home ${observedGradleUserHome}${options.standardGradleUserHome ? ' (standard)' : ' (workspace)'}`);
  const gradleArgs = [
    '/d',
    '/c',
    gradleWrapper,
    '--no-problems-report',
    ...(release
      ? [`:${gradleModule}:bundleRelease`, ...(options.apk ? [`:${gradleModule}:assembleRelease`] : [])]
      : [`:${gradleModule}:assembleDebug`]),
    '--no-daemon',
    '--console=plain',
    // AUT-073: lint-vital needs com.android.tools.lint:lint-gradle, which is not available in the offline Gradle cache (verified: "No cached version ... available for offline mode").
    // It is an Android Lint analysis step, not part of the shipped artifact; the project's own release-safety checks (tools/ci/release_checks.js) replace it.
    ...(release ? ['-x', 'lintVitalAnalyzeRelease', '-x', 'lintVitalReportRelease', '-x', 'lintVitalRelease'] : []),
  ];
  if (options.gradleOffline) {
    gradleArgs.splice(3, 0, '--offline');
  }
  const gradleLogDir = path.join(repoRoot, 'temp', 'ci', `gradle-run-${process.pid}-${Date.now()}`);
  const gradleStdoutLog = path.join(gradleLogDir, 'gradle_android_build.stdout.log');
  const gradleStderrLog = path.join(gradleLogDir, 'gradle_android_build.stderr.log');
  await runTimedLoggedChild({
    phase: 'Gradle build',
    command: 'cmd.exe',
    args: gradleArgs,
    cwd: gradleProject,
    env: gradleEnv,
    timeoutSeconds: options.gradleTimeoutSeconds,
    stdoutLog: gradleStdoutLog,
    stderrLog: gradleStderrLog,
  });
  assertGradleBuildSuccessful(gradleStdoutLog, gradleStderrLog);

  if (release) {
    await finishRelease(options, release, gradleStartedAtMs, sdkPath);
    return;
  }

  logPhase(`APK verification: locating fresh non-empty ${expectedDebugApkName}`);
  const apkPath = findFreshDebugApk(gradleStartedAtMs);
  if (!apkPath) {
    fail(`Gradle completed but no fresh non-empty ${expectedDebugApkName} was found under ${path.join(gradleProject, 'build')}.`);
  }
  logPhase(`APK verification: found ${apkPath}`);

  logPhase('16 KB verification: checking arm64-v8a ELF LOAD segment alignment');
  assertNativeLibraries16Kb(apkPath);
  logPhase('16 KB verification: PASS');

  const agpLine = readTextIfExists(path.join(gradleProject, 'build.gradle'))
    .split(/\r?\n/)
    .find((line) => line.includes('com.android.tools.build:gradle:')) || '';
  const gradleWrapperProperties = path.join(gradleProject, 'gradle', 'wrapper', 'gradle-wrapper.properties');
  const gradleDistribution = readTextIfExists(gradleWrapperProperties)
    .split(/\r?\n/)
    .find((line) => line.startsWith('distributionUrl=')) || '';

  console.log(`Observed AGP: ${agpLine.trim()}`);
  console.log(`Observed Gradle: ${gradleDistribution}`);
  console.log(`16 KB native-library compatibility check passed for arm64-v8a libraries in ${apkPath}`);
  console.log(`Debug APK: ${apkPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    fail(error?.stack || String(error));
  });
} else {
  module.exports = {
    findFatalCocosDiagnosticsInText,
    formatCocosEvidence,
    isAcceptableCocosExit,
    isAcceptableCocosGenerationEvidence,
    testAcceptableCocosPostSuccessExit,
    testCocosGenerationSucceeded,
  };
}
