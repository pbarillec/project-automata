#!/usr/bin/env node
// AUT-072: stamps the build identity into assets/scripts/logging/BuildInfoData.ts for the duration of a build.
//
// The committed file holds safe defaults ('unknown' sha) so tests / Node never need a build step and the tree never
// carries a per-commit-changing generated file. `applyBuildInfo` writes the stamped file and returns a `restore()`
// that puts the original bytes back (also registered on process exit, because build_android.js can `process.exit`).

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const buildInfoDataPath = path.join(repoRoot, 'assets', 'scripts', 'logging', 'BuildInfoData.ts');
const DEFAULT_GAME_VERSION = '0.1.0-dev';

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? String(result.stdout || '').trim() : null;
}

/** Reads the git identity. Falls back to the safe defaults when git or the repository is unavailable. */
function readGitIdentity(cwd = repoRoot) {
  const sha = git(['rev-parse', '--short=8', 'HEAD'], cwd);
  const count = git(['rev-list', '--count', 'HEAD'], cwd);
  const status = git(['status', '--porcelain', '--', 'assets'], cwd);
  return {
    gitSha: sha && /^[0-9a-f]{4,40}$/u.test(sha) ? sha : 'unknown',
    buildNumber: count && /^\d+$/u.test(count) ? Number.parseInt(count, 10) : 0,
    gitDirty: status !== null && status.length > 0,
  };
}

/** Validates and renders the BuildInfoData.ts source. Throws on values that are not plain identity data. */
function renderBuildInfoData(values) {
  const gameVersion = values.gameVersion ?? DEFAULT_GAME_VERSION;
  const gitSha = values.gitSha ?? 'unknown';
  const buildNumber = values.buildNumber ?? 0;
  const gitDirty = values.gitDirty === true;
  if (!/^[0-9A-Za-z._+-]{1,40}$/u.test(gameVersion)) throw new Error(`invalid gameVersion: ${gameVersion}`);
  if (gitSha !== 'unknown' && !/^[0-9a-f]{4,40}$/u.test(gitSha)) throw new Error(`invalid gitSha: ${gitSha}`);
  if (!Number.isInteger(buildNumber) || buildNumber < 0) throw new Error(`invalid buildNumber: ${buildNumber}`);
  return [
    '// AUT-072 build identity source. GENERATED for this build by tools/ci/write_build_info.js; restored after the build.',
    'export interface BuildInfoData {',
    '    readonly gameVersion: string;',
    '    readonly buildNumber: number;',
    '    readonly gitSha: string;',
    '    readonly gitDirty: boolean;',
    '}',
    '',
    'export const BUILD_INFO_DATA: BuildInfoData = {',
    `    gameVersion: '${gameVersion}',`,
    `    buildNumber: ${buildNumber},`,
    `    gitSha: '${gitSha}',`,
    `    gitDirty: ${gitDirty},`,
    '};',
    '',
  ].join('\n');
}

/**
 * Writes the stamped file and returns an idempotent `restore()` that rewrites the original bytes.
 * `options.targetPath` / `options.identity` exist for tests.
 */
function applyBuildInfo(options = {}) {
  const targetPath = options.targetPath ?? buildInfoDataPath;
  const identity = options.identity ?? readGitIdentity();
  const original = fs.readFileSync(targetPath);
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    fs.writeFileSync(targetPath, original);
  };
  fs.writeFileSync(targetPath, renderBuildInfoData({ gameVersion: process.env.AUTOMATA_GAME_VERSION || DEFAULT_GAME_VERSION, ...identity }));
  process.on('exit', restore);
  return restore;
}

if (require.main === module) {
  // `node tools/ci/write_build_info.js --print` shows what would be stamped without touching the tree.
  const identity = readGitIdentity();
  process.stdout.write(`${JSON.stringify({ gameVersion: process.env.AUTOMATA_GAME_VERSION || DEFAULT_GAME_VERSION, ...identity })}\n`);
} else {
  module.exports = { DEFAULT_GAME_VERSION, applyBuildInfo, buildInfoDataPath, readGitIdentity, renderBuildInfoData };
}
