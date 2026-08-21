#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const buildConfig = path.join(__dirname, 'cocos_android_debug_build.json');
const buildRoot = path.join(repoRoot, 'build', 'android');
const gradleProject = path.join(buildRoot, 'proj');
const gradleWrapper = path.join(gradleProject, 'gradlew.bat');
const gradleProperties = path.join(gradleProject, 'gradle.properties');
const gradleModule = 'ProjectAutomata';
const taskName = 'AUT-CX-004 Android Debug';
const progressIntervalMs = 30000;
const requiredCreatorVersion = '3.8.8';

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv) {
  const options = {
    cocosCreatorPath: process.env.COCOS_CREATOR_EXE || '',
    cocosTimeoutSeconds: 1200,
    gradleTimeoutSeconds: 1200,
    skipGeneration: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--skip-generation' || arg === '-SkipGeneration') {
      options.skipGeneration = true;
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

function createResolvedCocosBuildConfig(logDir, sdkPath, ndkPath, javaHome, javaPath) {
  const resolvedConfig = readJson(buildConfig);
  resolvedConfig.packages = resolvedConfig.packages || {};
  resolvedConfig.packages.android = resolvedConfig.packages.android || {};
  resolvedConfig.packages.android.sdkPath = sdkPath;
  resolvedConfig.packages.android.ndkPath = ndkPath;
  resolvedConfig.packages.android.javaHome = javaHome;
  resolvedConfig.packages.android.javaPath = javaPath;

  const resolvedConfigPath = path.join(logDir, 'cocos_android_debug_build.resolved.json');
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

function ensureWritableEngineMirror(sourceEnginePath) {
  const mirrorRoot = path.join(repoRoot, 'temp', 'ci', `cocos-engine-${requiredCreatorVersion}`);
  const markerPath = path.join(mirrorRoot, '.automata-engine-mirror.json');
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
      && fileExists(path.join(mirrorRoot, 'bin', '.cache', 'dev', 'editor', 'import-map.json'))) {
      logPhase(`Cocos engine mirror: reusing ${mirrorRoot}`);
      return mirrorRoot;
    }
  } catch {
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

function testKnownCocosPostBuildMetricError(logPaths) {
  return logPaths.some((logPath) => {
    const log = readTextIfExists(logPath);
    return log.includes('Missing class')
      && log.includes("Cannot read properties of null (reading 'constructor')");
  });
}

function testCocosGenerationSucceeded(sinceMs, cocosBuildLog) {
  if (testFreshCocosGeneratedOutput(sinceMs)) {
    return true;
  }

  return testCocosBuildLogCompleted(cocosBuildLog, sinceMs) && testCocosOutputShape();
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

async function runCocosGeneration(options, startedAtMs, sdkPath, ndkPath, javaHome, javaPath, sourceEnginePath) {
  const logDir = path.join(repoRoot, 'temp', 'ci');
  ensureDir(logDir);

  const stdoutLog = path.join(logDir, 'cocos_android_build.stdout.log');
  const stderrLog = path.join(logDir, 'cocos_android_build.stderr.log');
  const cocosBuildLog = path.join(logDir, 'cocos-cli.log');
  const resolvedBuildConfig = createResolvedCocosBuildConfig(logDir, sdkPath, ndkPath, javaHome, javaPath);

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
  const writableEnginePath = ensureWritableEngineMirror(sourceEnginePath);
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
        printLastRelevantLogLines([cocosBuildLog, stdoutLog, stderrLog]);
        await stopSpawnedProcessTree(child, phase);
        fail(`Cocos Android generation timed out after ${options.cocosTimeoutSeconds} seconds. Logs: ${cocosBuildLog} ${stdoutLog} ${stderrLog}`);
      }

      const freshGenerated = testFreshCocosGeneratedOutput(startedAtMs);
      const logCompleted = testCocosBuildLogCompleted(cocosBuildLog, startedAtMs);
      const outputShape = testCocosOutputShape();
      const generationSucceeded = freshGenerated || (logCompleted && outputShape);

      if (generationSucceeded) {
        if (successSinceMs === 0) {
          successSinceMs = Date.now();
          const evidence = freshGenerated ? 'fresh generated outputs' : 'Cocos log completion marker plus generated project shape';
          logPhase(`${phase}: generation evidence detected via ${evidence}; waiting 5s before terminating Creator if it remains alive`);
        } else if (Date.now() - successSinceMs >= 5000) {
          logPhase(`${phase}: Creator still alive after success evidence`);
          await stopSpawnedProcessTree(child, phase);
          terminatedAfterGeneration = true;
          break;
        }
      }

      if (Date.now() >= nextProgressMs) {
        const logSize = fileExists(cocosBuildLog) ? fs.statSync(cocosBuildLog).size : 0;
        logPhase(`${phase}: still waiting after ${formatElapsed(phaseStartMs)}; PID ${child.pid}; freshOutputs=${freshGenerated}; logCompleted=${logCompleted}; outputShape=${outputShape}; logBytes=${logSize}`);
        nextProgressMs += progressIntervalMs;
      }

      await sleep(2000);
    }
  } finally {
    await Promise.all([closeStream(stdoutStream), closeStream(stderrStream)]);
  }

  if (exitResult?.error) {
    fail(`Failed to start Cocos Creator: ${exitResult.error.message}`, 127);
  }

  if (!terminatedAfterGeneration) {
    logPhase(`${phase}: Creator exited after ${formatElapsed(phaseStartMs)} with code=${exitResult?.code ?? '<none>'} signal=${exitResult?.signal || '<none>'}`);
    const generationSucceeded = testCocosGenerationSucceeded(startedAtMs, cocosBuildLog);
    const exitCode = exitResult?.code ?? 1;

    if (exitCode !== 0 && !generationSucceeded) {
      printLastRelevantLogLines([cocosBuildLog, stdoutLog, stderrLog]);
      fail(`Cocos Android generation failed with exit code ${exitCode}. Logs: ${cocosBuildLog} ${stdoutLog} ${stderrLog}`);
    }

    if (exitCode !== 0 && !testKnownCocosPostBuildMetricError([cocosBuildLog, stdoutLog, stderrLog])) {
      printLastRelevantLogLines([cocosBuildLog, stdoutLog, stderrLog]);
      fail(`Cocos Android generation exited with code ${exitCode} after success evidence, but not with the known post-build metrics exception. Logs: ${cocosBuildLog} ${stdoutLog} ${stderrLog}`);
    }

    if (exitCode !== 0) {
      logPhase(`${phase}: Creator exited with code ${exitCode} after successful generation with the known post-build metrics exception; continuing to Gradle verification`);
    }
  }

  if (!testCocosGenerationSucceeded(startedAtMs, cocosBuildLog)) {
    printLastRelevantLogLines([cocosBuildLog, stdoutLog, stderrLog]);
    fail(`Cocos Android generation did not produce expected success evidence under build/android. Logs: ${cocosBuildLog} ${stdoutLog} ${stderrLog}`);
  }

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
    if (filePath.toLowerCase().endsWith('.apk')) {
      fs.rmSync(filePath, { force: true });
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

function findFreshApk(sinceMs) {
  return walkFiles(path.join(gradleProject, 'build'))
    .filter((filePath) => filePath.toLowerCase().endsWith('.apk'))
    .map((filePath) => ({ filePath, stat: fs.statSync(filePath) }))
    .filter((item) => item.stat.size > 0 && item.stat.mtimeMs >= sinceMs)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0]?.filePath || '';
}

function findEndOfCentralDirectory(zipBuffer) {
  const signature = 0x06054b50;
  const minOffset = Math.max(0, zipBuffer.length - 0xffff - 22);

  for (let offset = zipBuffer.length - 22; offset >= minOffset; offset -= 1) {
    if (zipBuffer.readUInt32LE(offset) === signature) {
      return offset;
    }
  }

  fail('Could not find APK ZIP central directory.');
}

function readZipEntries(zipBuffer) {
  const eocdOffset = findEndOfCentralDirectory(zipBuffer);
  const entryCount = zipBuffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (zipBuffer.readUInt32LE(offset) !== 0x02014b50) {
      fail('APK ZIP central directory is malformed.');
    }

    const method = zipBuffer.readUInt16LE(offset + 10);
    const compressedSize = zipBuffer.readUInt32LE(offset + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(offset + 24);
    const nameLength = zipBuffer.readUInt16LE(offset + 28);
    const extraLength = zipBuffer.readUInt16LE(offset + 30);
    const commentLength = zipBuffer.readUInt16LE(offset + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(offset + 42);
    const name = zipBuffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function extractZipEntry(zipBuffer, entry) {
  const offset = entry.localHeaderOffset;
  if (zipBuffer.readUInt32LE(offset) !== 0x04034b50) {
    fail(`APK ZIP local header is malformed for ${entry.name}.`);
  }

  const nameLength = zipBuffer.readUInt16LE(offset + 26);
  const extraLength = zipBuffer.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const compressed = zipBuffer.subarray(dataOffset, dataOffset + entry.compressedSize);

  if (entry.method === 0) {
    return Buffer.from(compressed);
  }

  if (entry.method === 8) {
    return require('node:zlib').inflateRawSync(compressed);
  }

  fail(`Unsupported APK ZIP compression method ${entry.method} for ${entry.name}.`);
}

function readUInt(buffer, offset, size, littleEndian) {
  if (size === 2) {
    return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
  }
  if (size === 4) {
    return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  }
  if (size === 8) {
    const value = littleEndian ? buffer.readBigUInt64LE(offset) : buffer.readBigUInt64BE(offset);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      fail(`ELF integer at offset ${offset} is too large to inspect safely.`);
    }
    return Number(value);
  }
  fail(`Unsupported integer size ${size}.`);
}

function getLoadSegmentAlignments(elfBuffer, entryName) {
  if (elfBuffer.length < 64
    || elfBuffer[0] !== 0x7f
    || elfBuffer[1] !== 0x45
    || elfBuffer[2] !== 0x4c
    || elfBuffer[3] !== 0x46) {
    fail(`${entryName} is not an ELF file.`);
  }

  const elfClass = elfBuffer[4];
  const elfData = elfBuffer[5];
  const littleEndian = elfData === 1;
  if (!littleEndian && elfData !== 2) {
    fail(`${entryName} has unsupported ELF data encoding ${elfData}.`);
  }

  const isElf64 = elfClass === 2;
  const isElf32 = elfClass === 1;
  if (!isElf64 && !isElf32) {
    fail(`${entryName} has unsupported ELF class ${elfClass}.`);
  }

  const phoff = isElf64
    ? readUInt(elfBuffer, 32, 8, littleEndian)
    : readUInt(elfBuffer, 28, 4, littleEndian);
  const phentsize = readUInt(elfBuffer, isElf64 ? 54 : 42, 2, littleEndian);
  const phnum = readUInt(elfBuffer, isElf64 ? 56 : 44, 2, littleEndian);
  const minPhentsize = isElf64 ? 56 : 32;

  if (phentsize < minPhentsize) {
    fail(`${entryName} has invalid ELF program-header entry size ${phentsize}.`);
  }

  const alignments = [];
  for (let index = 0; index < phnum; index += 1) {
    const headerOffset = phoff + (index * phentsize);
    if (headerOffset + minPhentsize > elfBuffer.length) {
      fail(`${entryName} has a program header outside the file.`);
    }

    const type = readUInt(elfBuffer, headerOffset, 4, littleEndian);
    if (type === 1) {
      const alignOffset = isElf64 ? headerOffset + 48 : headerOffset + 28;
      const align = readUInt(elfBuffer, alignOffset, isElf64 ? 8 : 4, littleEndian);
      alignments.push(align);
    }
  }

  return alignments;
}

function assertNativeLibraries16Kb(apkPath) {
  const zipBuffer = fs.readFileSync(apkPath);
  const entries = readZipEntries(zipBuffer)
    .filter((entry) => /^lib\/arm64-v8a\/.+\.so$/u.test(entry.name));

  if (entries.length === 0) {
    fail(`No arm64-v8a native libraries were found in ${apkPath}.`);
  }

  const extractParent = path.join(repoRoot, 'temp', 'ci');
  ensureDir(extractParent);
  const extractRoot = fs.mkdtempSync(path.join(extractParent, 'apk-so-'));
  assertInside(repoRoot, extractRoot);

  try {
    for (const entry of entries) {
      const soPath = path.join(extractRoot, ...entry.name.split('/'));
      ensureDir(path.dirname(soPath));
      const extracted = extractZipEntry(zipBuffer, entry);
      if (extracted.length !== entry.uncompressedSize) {
        fail(`Extracted ${entry.name} size ${extracted.length}; expected ${entry.uncompressedSize}.`);
      }
      fs.writeFileSync(soPath, extracted);
      const loadSegmentAlignments = getLoadSegmentAlignments(extracted, entry.name);
      if (loadSegmentAlignments.length === 0) {
        fail(`No LOAD segments were found in ${entry.name}.`);
      }

      for (const align of loadSegmentAlignments) {
        if (align < 16384) {
          fail(`${entry.name} has LOAD segment alignment 0x${align.toString(16)}; expected at least 0x4000 for 16 KB page-size compatibility.`);
        }
      }
    }
  } finally {
    fs.rmSync(extractRoot, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  logPhase(`start: repo=${repoRoot}`);
  logPhase(`start: skipGeneration=${options.skipGeneration}; cocosTimeoutSeconds=${options.cocosTimeoutSeconds}; gradleTimeoutSeconds=${options.gradleTimeoutSeconds}`);

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
    await runCocosGeneration(options, startedAtMs, sdkPath, ndkPath, javaHome, javaPath, sourceEnginePath);
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

  console.log(`Observed Android config: compileSdk=${compileSdk} targetSdk=${targetSdk} minSdk=${minSdk} abi=${abi} ndk=${ndkVersion} cmake=${cmakeVersion} sdk=${sdkPath}`);
  console.log('Java:');
  runChecked('java.exe', ['-version']);

  logPhase('Gradle build: preparing generated project');
  removeExistingApks(path.join(gradleProject, 'build'));
  removeGeneratedGradleProblemReport();
  const gradleStartedAtMs = Date.now() - 1000;
  const gradleEnv = {
    ...process.env,
    GRADLE_USER_HOME: path.join(buildRoot, 'gradle-user'),
  };
  await runTimedLoggedChild({
    phase: 'Gradle build',
    command: 'cmd.exe',
    args: ['/d', '/c', gradleWrapper, '--offline', '--no-problems-report', `:${gradleModule}:assembleDebug`, '--no-daemon', '--console=plain'],
    cwd: gradleProject,
    env: gradleEnv,
    timeoutSeconds: options.gradleTimeoutSeconds,
    stdoutLog: path.join(repoRoot, 'temp', 'ci', 'gradle_android_build.stdout.log'),
    stderrLog: path.join(repoRoot, 'temp', 'ci', 'gradle_android_build.stderr.log'),
  });

  logPhase('APK verification: locating fresh non-empty debug APK');
  const apkPath = findFreshApk(gradleStartedAtMs);
  if (!apkPath) {
    fail(`Gradle completed but no fresh non-empty debug APK was found under ${path.join(gradleProject, 'build')}.`);
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

main().catch((error) => {
  fail(error?.stack || String(error));
});
