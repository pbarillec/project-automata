/**
 * AUT-INFRA-001 FactoryWorld gate build.
 *
 * The tracked `tools/ci/cocos_android_debug_build.json` launches CameraSpike. A device gate
 * temporarily switches it to FactoryWorld, builds the debug APK, and ALWAYS restores the
 * original bytes (verified by SHA-256 and, when available, `git diff --exit-code`).
 * Backups and APKs live only under the gitignored `temp/`.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './artifacts.ts';

export const FACTORY_WORLD_SCENE = { url: 'db://assets/scenes/factory/FactoryWorld.scene', uuid: 'b0330000-0000-4000-8000-000000000010' };
export const BUILD_CONFIG_PATH = path.join(REPO_ROOT, 'tools', 'ci', 'cocos_android_debug_build.json');
export const BUILT_APK_PATH = path.join(REPO_ROOT, 'build', 'android', 'proj', 'build', 'ProjectAutomata', 'outputs', 'apk', 'debug', 'ProjectAutomata-debug.apk');
export const GATE_DIR = path.join(REPO_ROOT, 'temp', 'gate');
export const GATE_BACKUP_DIR = path.join(REPO_ROOT, 'temp', 'device', 'gate');

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Returns the config text with FactoryWorld as the only/start scene; everything else untouched. */
export function switchConfigToFactoryWorld(original: string): string {
    const config = JSON.parse(original) as Record<string, unknown>;
    config.startScene = FACTORY_WORLD_SCENE.uuid;
    config.scenes = [{ ...FACTORY_WORLD_SCENE }];
    return `${JSON.stringify(config, null, 2)}\n`;
}

export interface GateBuildDeps {
    configPath: string;
    backupDir: string;
    /** True when the tracked config already differs from HEAD (refuse to run). */
    isConfigDirty: () => boolean;
    /** Runs the Android build with the switched config; returns the exit code. */
    runBuild: () => number;
    /** Post-restore verification against git (exit code 0 = clean). */
    verifyClean: () => boolean;
    builtApkPath: string;
    outputApkPath: string;
}

export interface GateBuildResult { ok: boolean; restored: boolean; apkPath: string | null; apkSha256: string | null; buildExitCode: number | null; message: string }

export function runGateBuild(deps: GateBuildDeps): GateBuildResult {
    if (deps.isConfigDirty()) {
        return { ok: false, restored: true, apkPath: null, apkSha256: null, buildExitCode: null, message: `refusing to run: ${deps.configPath} has uncommitted changes` };
    }
    const originalBytes = readFileSync(deps.configPath);
    const originalSha = sha256(originalBytes);
    mkdirSync(deps.backupDir, { recursive: true });
    const backupPath = path.join(deps.backupDir, `${path.basename(deps.configPath)}.bak`);
    writeFileSync(backupPath, originalBytes);
    writeFileSync(`${backupPath}.sha256`, `${originalSha}\n`);

    let buildExitCode: number | null = null;
    let buildError: string | null = null;
    try {
        writeFileSync(deps.configPath, switchConfigToFactoryWorld(originalBytes.toString('utf8')));
        buildExitCode = deps.runBuild();
    } catch (error) {
        buildError = (error as Error).message;
    } finally {
        writeFileSync(deps.configPath, originalBytes);
    }
    const restored = sha256(readFileSync(deps.configPath)) === originalSha && deps.verifyClean();
    if (!restored) return { ok: false, restored, apkPath: null, apkSha256: null, buildExitCode, message: `CONFIG NOT RESTORED: restore manually from ${backupPath}` };
    if (buildError || buildExitCode !== 0) return { ok: false, restored, apkPath: null, apkSha256: null, buildExitCode, message: `build failed: ${buildError ?? `exit ${buildExitCode}`}` };
    if (!existsSync(deps.builtApkPath)) return { ok: false, restored, apkPath: null, apkSha256: null, buildExitCode, message: `build reported success but ${deps.builtApkPath} is missing` };
    mkdirSync(path.dirname(deps.outputApkPath), { recursive: true });
    copyFileSync(deps.builtApkPath, deps.outputApkPath);
    return { ok: true, restored, apkPath: deps.outputApkPath, apkSha256: sha256(readFileSync(deps.outputApkPath)), buildExitCode, message: 'ok' };
}

/** Restores the tracked config from the last gate backup (recovery after an interrupted build). */
export function restoreFromBackup(configPath = BUILD_CONFIG_PATH, backupDir = GATE_BACKUP_DIR): boolean {
    const backupPath = path.join(backupDir, `${path.basename(configPath)}.bak`);
    if (!existsSync(backupPath)) return false;
    const bytes = readFileSync(backupPath);
    const expected = readFileSync(`${backupPath}.sha256`, 'utf8').trim();
    if (sha256(bytes) !== expected) throw new Error('backup checksum mismatch');
    writeFileSync(configPath, bytes);
    return true;
}

function git(args: string[]): { code: number; out: string } {
    const r = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
    return { code: r.status ?? -1, out: (r.stdout ?? '').trim() };
}

export function defaultGateBuildDeps(label: string): GateBuildDeps {
    const rel = path.relative(REPO_ROOT, BUILD_CONFIG_PATH).split(path.sep).join('/');
    const head = git(['rev-parse', '--short', 'HEAD']).out || 'nohead';
    const dirtyTree = git(['status', '--porcelain', '--', 'assets']).out.length > 0 ? '-dirty' : '';
    return {
        configPath: BUILD_CONFIG_PATH,
        backupDir: GATE_BACKUP_DIR,
        isConfigDirty: () => git(['diff', '--quiet', '--', rel]).code !== 0,
        runBuild: () => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(REPO_ROOT, 'tools', 'ci', 'build_android.ps1')], { cwd: REPO_ROOT, stdio: 'inherit' }).status ?? -1,
        verifyClean: () => git(['diff', '--exit-code', '--quiet', '--', rel]).code === 0,
        builtApkPath: BUILT_APK_PATH,
        outputApkPath: path.join(GATE_DIR, `ProjectAutomata-${label}-${head}${dirtyTree}-factoryworld.apk`),
    };
}
