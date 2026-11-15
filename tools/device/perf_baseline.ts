/**
 * AUT-067 worst-case performance baseline capture helpers (DEBUG APK only, evidence only, no budget gating).
 *
 * `runPerfWindow` is called by `reveal_capture.ts` for the `aut067-baseline*` scenarios: it records the static device / build facts,
 * takes `dumpsys meminfo` and a `gfxinfo reset` BEFORE the steady window, waits for the in-app per-second `perf_second` samples
 * (after the app's own 6 s warm-up), samples `top` / `dumpsys cpuinfo` mid-window, then takes meminfo / gfxinfo / GPU reads AFTER it.
 * `evaluatePerfBaseline` (pure) holds the objective sanity checks; `buildBaselineDocument` / `writePerfBaseline` produce
 * `temp/perf/<ts>/baseline.json` + `baseline.md`. No screenshot is taken inside the window (screencap would perturb the frame time).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';
import { REPO_ROOT } from './artifacts.ts';
import type { SessionDeviceDriver } from './driver.ts';
import type { EventStream } from './events.ts';
import {
    compareToAut041Budget,
    parseCpuinfo,
    parseGfxinfo,
    parseGlesRenderer,
    parseGpuBusyPercent,
    parseMeminfoSummary,
    parseRefreshRateHz,
    parseTop,
    parseWmDensity,
    parseWmSize,
    renderBaselineMarkdown,
    summarizeGfxCounters,
    summarizePerfSeconds,
    type BaselineDocument,
    type PerfSecondLike,
} from './perf_stats.ts';

export type PerfBaselineExpectation = 'standard' | 'founder';

export interface PerfBaselineOptions {
    readonly variant: PerfBaselineExpectation;
    /** Length of the steady window in seconds (the app samples one `perf_second` per second after its warm-up). */
    readonly windowSeconds: number;
    /** Sanity threshold: at least this many `perf_second` samples must exist. */
    readonly minSamples: number;
}

export const AUT067_DEFAULT_WINDOW_SECONDS = 45;
export const AUT067_MIN_SAMPLES = 30;
export const AUT067_BASELINE_EXPECTED_VISIBLE = 14;

interface EventLike { readonly tMs: number; readonly event: ParsedDeviceEvent }

export interface PerfCapture {
    /** Raw adb texts (null = the command failed / is unavailable on this device). */
    readonly raw: Readonly<Record<string, string | null>>;
    readonly props: Readonly<Record<string, string>>;
    readonly notes: readonly string[];
    readonly windowStartedAtUtc: string | null;
    readonly windowEndedAtUtc: string | null;
    readonly firstSampleSeen: boolean;
}

const PROPS = ['ro.product.manufacturer', 'ro.product.model', 'ro.product.device', 'ro.soc.manufacturer', 'ro.soc.model', 'ro.board.platform', 'ro.hardware', 'ro.build.version.release', 'ro.build.version.sdk', 'ro.build.fingerprint'] as const;
const GPU_BUSY_FILES = ['/sys/class/kgsl/kgsl-3d0/gpubusy', '/sys/class/kgsl/kgsl-3d0/gpu_busy_percentage'] as const;

export interface PerfWindowContext {
    readonly driver: SessionDeviceDriver;
    readonly stream: EventStream;
    readonly packageName: string;
    readonly rawDir: string;
    readonly options: PerfBaselineOptions;
    readonly sleep: (ms: number) => Promise<void>;
    /** Wall-clock source (tests inject a fake). */
    readonly now?: () => number;
}

export async function runPerfWindow(ctx: PerfWindowContext): Promise<PerfCapture> {
    const { driver, stream, packageName, options } = ctx;
    const now = ctx.now ?? Date.now;
    const raw: Record<string, string | null> = {};
    const props: Record<string, string> = {};
    const notes: string[] = [];
    mkdirSync(ctx.rawDir, { recursive: true });
    const shell = driver.shell?.bind(driver);
    if (!shell) notes.push('driver has no raw shell: only meminfo / gfxinfo / getprop-free data were collected');
    const take = async (key: string, read: () => Promise<string>): Promise<string | null> => {
        try {
            const text = await read();
            raw[key] = text;
            writeFileSync(path.join(ctx.rawDir, `${key}.txt`), text);
            return text;
        } catch (error) {
            raw[key] = null;
            notes.push(`${key}: unavailable (${(error as Error).message.slice(0, 120)})`);
            return null;
        }
    };
    const sh = (key: string, command: string[], timeoutMs?: number) => (shell ? take(key, () => shell(command, timeoutMs)) : Promise.resolve(null));

    // Static facts.
    for (const prop of PROPS) {
        if (!shell) break;
        try { const value = (await shell(['getprop', prop])).trim(); if (value) props[prop] = value; } catch { /* property read is best effort */ }
    }
    await sh('wm_size', ['wm', 'size']);
    await sh('wm_density', ['wm', 'density']);
    await sh('display', ['dumpsys', 'display'], 30_000);
    await sh('surfaceflinger_gles', ['sh', '-c', "'dumpsys SurfaceFlinger | grep -i GLES'"], 30_000);
    const pmPath = await sh('pm_path', ['pm', 'path', packageName]);
    const apkPath = /package:(\S+)/.exec(pmPath ?? '')?.[1];
    if (apkPath && /^[A-Za-z0-9_./=-]+$/.test(apkPath)) await sh('apk_sha256', ['sha256sum', apkPath]);
    await sh('package', ['sh', '-c', `'dumpsys package ${packageName} | grep -E "versionName|versionCode|lastUpdateTime"'`]);

    // Before the window: memory and a gfxinfo reset (so gfxinfo covers the window only); read the GPU counter once to reset it.
    await take('meminfo_before', () => driver.meminfo(packageName));
    await sh('gfxinfo_reset', ['dumpsys', 'gfxinfo', packageName, 'reset']);
    for (const file of GPU_BUSY_FILES) await sh(`gpu_reset_${path.basename(file)}`, ['cat', file]);

    // Wait for the app's warm-up to end (the first per-second sample), then hold the steady window.
    const first = await stream.waitFor((e) => e.evt === 'perf_second', 0, 60_000);
    const windowStart = now();
    const windowStartedAtUtc = new Date(windowStart).toISOString();
    if (!first) notes.push('no perf_second event within 60 s (DEBUG sampler not active?)');
    const windowMs = options.windowSeconds * 1000;
    let midDone = false;
    while (first && now() - windowStart < windowMs) {
        if (!midDone && now() - windowStart >= windowMs / 2) {
            midDone = true;
            await sh('top', ['top', '-b', '-n', '1', '-m', '15'], 30_000);
            await sh('cpuinfo', ['dumpsys', 'cpuinfo'], 30_000);
        }
        await ctx.sleep(500);
    }
    const windowEndedAtUtc = new Date(now()).toISOString();

    // After the window.
    await take('meminfo_after', () => driver.meminfo(packageName));
    await take('gfxinfo_after', () => driver.gfxinfo(packageName));
    for (const file of GPU_BUSY_FILES) await sh(`gpu_after_${path.basename(file)}`, ['cat', file]);
    return { raw, props, notes, windowStartedAtUtc, windowEndedAtUtc, firstSampleSeen: first !== null };
}

/** The `perf_second` samples of the steady window: the first `windowSeconds` samples (the app emits one per second). */
export function windowSamples(events: readonly EventLike[], windowSeconds: number): Array<PerfSecondLike & { index: number }> {
    const out: Array<PerfSecondLike & { index: number }> = [];
    for (const { event } of events) {
        if (event.evt !== 'perf_second') continue;
        const index = Number(event.index);
        if (!Number.isFinite(index) || index >= windowSeconds) continue;
        const hist = Array.isArray(event.hist) ? (event.hist as unknown[]).map(Number) : [];
        out.push({
            index,
            frames: Number(event.frames),
            seconds: Number(event.seconds),
            fps: Number(event.fps),
            avgMs: Number(event.avgMs),
            p95Ms: Number(event.p95Ms),
            maxMs: Number(event.maxMs),
            jank: Number(event.jank),
            bigJank: Number(event.bigJank),
            hist,
            drawCalls: typeof event.drawCalls === 'number' ? event.drawCalls : null,
            tris: typeof event.tris === 'number' ? event.tris : null,
        });
    }
    return out;
}

export interface PerfCheck { readonly id: string; readonly ok: boolean; readonly detail: string }

/** Objective SANITY checks (a baseline is never budget-gated). The AUT-041 budget line is information only (`ok` is always true). */
export function evaluatePerfBaseline(events: readonly EventLike[], expect: PerfBaselineExpectation, options: { windowSeconds: number; minSamples: number }, capture: PerfCapture | null): PerfCheck[] {
    const checks: PerfCheck[] = [];
    const samples = windowSamples(events, options.windowSeconds);
    checks.push({ id: 'perf_capture_completed', ok: capture !== null && capture.firstSampleSeen && capture.windowEndedAtUtc !== null, detail: capture ? `window ${capture.windowStartedAtUtc ?? 'not started'} -> ${capture.windowEndedAtUtc ?? 'n/a'}` : 'the perf window did not run (no ui_layout)' });
    checks.push({ id: 'perf_samples_collected', ok: samples.length >= options.minSamples, detail: `${samples.length} perf_second samples (need >= ${options.minSamples})` });
    const bench = events.find((e) => e.event.evt === 'robot_benchmark');
    checks.push({ id: 'perf_benchmark_override_active', ok: bench !== undefined && Number(bench.event.maxVisible) === AUT067_BASELINE_EXPECTED_VISIBLE, detail: bench ? `maxVisible=${String(bench.event.maxVisible)}` : 'no robot_benchmark event (the DEBUG override was not read)' });
    const population = [...events].reverse().find((e) => e.event.evt === 'robot_population');
    checks.push({ id: 'perf_visible_robots', ok: population !== undefined && Number(population.event.visible) === AUT067_BASELINE_EXPECTED_VISIBLE, detail: population ? `visible=${String(population.event.visible)} pooled=${String(population.event.pooled)}` : 'no robot_population event' });
    const scene = events.filter((e) => e.event.evt === 'perf_scene');
    checks.push({ id: 'perf_scene_counts_reported', ok: scene.length > 0, detail: scene.length ? `${scene.length} perf_scene event(s); last: ${JSON.stringify(scene[scene.length - 1].event)}` : 'no perf_scene event' });
    const founder = [...events].reverse().find((e) => e.event.evt === 'robot_founder');
    const founderOwned = founder?.event.owned === true;
    checks.push({ id: 'perf_variant_matches', ok: expect === 'founder' ? founderOwned : !founderOwned, detail: `variant ${expect}; robot_founder owned=${String(founder?.event.owned ?? null)}` });
    const errors = events.filter((e) => e.event.evt === 'error');
    checks.push({ id: 'perf_no_error_events', ok: errors.length === 0, detail: `${errors.length} error event(s)` });
    if (capture) {
        const missing = ['meminfo_before', 'meminfo_after', 'gfxinfo_after'].filter((key) => !capture.raw[key]);
        checks.push({ id: 'perf_adb_snapshots', ok: missing.length === 0, detail: missing.length ? `missing: ${missing.join(', ')}` : 'meminfo before/after and gfxinfo captured' });
    }
    if (samples.length > 0) {
        const summary = summarizePerfSeconds(samples);
        const budget = compareToAut041Budget(summary);
        checks.push({ id: 'perf_vs_aut041_budget_info', ok: true, detail: `INFORMATION ONLY: p95 ${budget.p95Ms.toFixed(1)} ms (budget ${budget.p95Budget}) ${budget.p95Within ? 'within' : 'OVER'}; fps ${budget.fps.toFixed(1)} (min ${budget.minFps}) ${budget.fpsWithin ? 'within' : 'BELOW'}` });
    }
    return checks;
}

export interface GitBuildInfo { readonly gitSha: string | null; readonly gitDirty: boolean | null; readonly branch: string | null }

export function readGitBuildInfo(cwd: string = REPO_ROOT): GitBuildInfo {
    const git = (args: string[]): string | null => { try { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); } catch { return null; } };
    const status = git(['status', '--porcelain']);
    return { gitSha: git(['rev-parse', 'HEAD']), gitDirty: status === null ? null : status.length > 0, branch: git(['rev-parse', '--abbrev-ref', 'HEAD']) };
}

/** Pure assembly of the baseline document from the collected events and adb texts. */
export function buildBaselineDocument(input: { scenario: string; events: readonly EventLike[]; capture: PerfCapture; options: PerfBaselineOptions; packageName: string; git: GitBuildInfo; nowIso: string; artifacts?: Record<string, string> }): BaselineDocument {
    const { capture, options, packageName } = input;
    const samples = windowSamples(input.events, options.windowSeconds);
    const frameTime = summarizePerfSeconds(samples);
    const scene = input.events.filter((e) => e.event.evt === 'perf_scene').map((e) => {
        const { v: _v, seq: _seq, evt: _evt, ...rest } = e.event;
        return rest as Record<string, unknown>;
    });
    const text = (key: string): string => capture.raw[key] ?? '';
    const apkSha = /^([0-9a-f]{64})/i.exec(text('apk_sha256'))?.[1] ?? null;
    const gpuBusy = GPU_BUSY_FILES.map((file) => parseGpuBusyPercent(text(`gpu_after_${path.basename(file)}`))).find((v) => v !== null) ?? null;
    const gles = parseGlesRenderer(text('surfaceflinger_gles'));
    const notes = [...capture.notes];
    const counters = summarizeGfxCounters(samples);
    if (!counters.available) notes.push('draw calls / triangles: the engine gfx counters (director.root.device.numDrawCalls / numTris) were not reachable; renderer and node counts are reported instead');
    if (gpuBusy === null) notes.push('GPU busy percentage: unavailable (no readable /sys/class/kgsl counter on this device)');
    notes.push('perf_second sampling runs inside the DEBUG APK (Cocos DEBUG build, diagnostics logging on): absolute numbers are a DEBUG baseline, not a release-build verdict');
    notes.push('top / dumpsys cpuinfo are taken once mid-window and perturb the run slightly');
    if (frameTime.frames > 0 && frameTime.samples < options.windowSeconds) notes.push(`only ${frameTime.samples} of ${options.windowSeconds} requested one-second samples arrived`);
    return {
        schema: 'aut067-baseline/1',
        capturedAtUtc: input.nowIso,
        scenario: input.scenario,
        build: {
            gitSha: input.git.gitSha,
            gitDirty: input.git.gitDirty,
            branch: input.git.branch,
            apkSha256: apkSha,
            apkDevicePath: /package:(\S+)/.exec(text('pm_path'))?.[1] ?? null,
            package: packageName,
            packageInfo: text('package').trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
            appBuildType: 'DEBUG (FactoryWorld)',
            // AUT-072: what the app itself reported at startup (null when the build predates the build_info event).
            appBuildInfo: (() => { const hit = input.events.find((e) => e.event.evt === 'build_info'); if (!hit) return null; const { v: _v, seq: _seq, evt: _evt, ...rest } = hit.event; return rest as Record<string, unknown>; })(),
        },
        device: {
            manufacturer: capture.props['ro.product.manufacturer'] ?? null,
            model: capture.props['ro.product.model'] ?? null,
            device: capture.props['ro.product.device'] ?? null,
            soc: capture.props['ro.soc.model'] ?? capture.props['ro.board.platform'] ?? null,
            socManufacturer: capture.props['ro.soc.manufacturer'] ?? null,
            hardware: capture.props['ro.hardware'] ?? null,
            androidRelease: capture.props['ro.build.version.release'] ?? null,
            sdk: capture.props['ro.build.version.sdk'] ?? null,
            fingerprint: capture.props['ro.build.fingerprint'] ?? null,
            resolution: parseWmSize(text('wm_size')),
            densityDpi: parseWmDensity(text('wm_density')),
            refreshRateHz: parseRefreshRateHz(text('display')),
        },
        state: { seed: 'seed_aut067', variant: options.variant, visibleRobotsTarget: AUT067_BASELINE_EXPECTED_VISIBLE, windowSeconds: options.windowSeconds, windowStartedAtUtc: capture.windowStartedAtUtc, windowEndedAtUtc: capture.windowEndedAtUtc },
        frameTime,
        gfxCounters: counters,
        sceneCounts: scene,
        gfxinfo: capture.raw.gfxinfo_after ? parseGfxinfo(capture.raw.gfxinfo_after) : null,
        meminfoBefore: capture.raw.meminfo_before ? parseMeminfoSummary(capture.raw.meminfo_before) : null,
        meminfoAfter: capture.raw.meminfo_after ? parseMeminfoSummary(capture.raw.meminfo_after) : null,
        cpu: { top: capture.raw.top ? parseTop(capture.raw.top, packageName) : null, cpuinfo: capture.raw.cpuinfo ? parseCpuinfo(capture.raw.cpuinfo, packageName) : null },
        gpu: { renderer: gles, busyPercent: gpuBusy, status: gpuBusy !== null ? 'kgsl busy counter read' : gles ? 'renderer name only (no utilisation counter)' : 'unavailable' },
        budgetAut041: compareToAut041Budget(frameTime),
        notes,
        artifacts: input.artifacts ?? {},
    };
}

export function perfOutputDir(stamp: string = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)): string {
    return path.join(REPO_ROOT, 'temp', 'perf', stamp);
}

export function writePerfBaseline(dir: string, doc: BaselineDocument): { jsonPath: string; markdownPath: string } {
    mkdirSync(dir, { recursive: true });
    const jsonPath = path.join(dir, 'baseline.json');
    const markdownPath = path.join(dir, 'baseline.md');
    writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`);
    writeFileSync(markdownPath, renderBaselineMarkdown(doc));
    return { jsonPath, markdownPath };
}
