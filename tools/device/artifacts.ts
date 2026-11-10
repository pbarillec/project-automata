/**
 * AUT-INFRA-001 artifact layout. Everything a run produces goes under
 * `temp/device/<run-id>/` (gitignored), with fixed file names:
 *
 *   result.json  summary.md  logcat.txt  events.jsonl  commands.json
 *   device.json  meminfo.txt  gfxinfo.txt  screenshots/NN-<label>.png
 */
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEVICE_TEMP_ROOT = path.join(REPO_ROOT, 'temp', 'device');

/** `<scenario>-<UTC yyyymmddThhmmssZ>-<apk sha 8>`; safe for paths and stable in format. */
export function makeRunId(scenarioId: string, date: Date, apkSha256: string | null): string {
    const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const scenario = scenarioId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `${scenario}-${stamp}-${apkSha256 ? apkSha256.slice(0, 8) : 'noapk'}`;
}

export interface RunPaths {
    runDir: string; result: string; summary: string; logcat: string; events: string; commands: string;
    device: string; meminfo: string; gfxinfo: string; screenshotsDir: string;
    screenshot(index: number, label: string): string;
}

export function runPaths(runId: string, root: string = DEVICE_TEMP_ROOT): RunPaths {
    if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error(`invalid run id: ${runId}`);
    const runDir = path.join(root, runId);
    const screenshotsDir = path.join(runDir, 'screenshots');
    return {
        runDir,
        result: path.join(runDir, 'result.json'),
        summary: path.join(runDir, 'summary.md'),
        logcat: path.join(runDir, 'logcat.txt'),
        events: path.join(runDir, 'events.jsonl'),
        commands: path.join(runDir, 'commands.json'),
        device: path.join(runDir, 'device.json'),
        meminfo: path.join(runDir, 'meminfo.txt'),
        gfxinfo: path.join(runDir, 'gfxinfo.txt'),
        screenshotsDir,
        screenshot: (index, label) => path.join(screenshotsDir, `${String(index).padStart(2, '0')}-${label.replace(/[^A-Za-z0-9_-]+/g, '_')}.png`),
    };
}

export function ensureRunDirs(paths: RunPaths): void {
    mkdirSync(paths.screenshotsDir, { recursive: true });
}

export function sha256File(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        createReadStream(filePath).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
    });
}

/** Repo-relative, forward-slash path for evidence fields. */
export function relativeEvidence(filePath: string): string {
    return path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
}
