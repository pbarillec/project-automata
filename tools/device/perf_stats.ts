/**
 * AUT-067 pure performance statistics (no `cc`, no adb): merges the app's per-second `perf_second` samples into an overall
 * frame-time / FPS / jank summary, parses the `dumpsys gfxinfo` / `meminfo` / `top` / `cpuinfo` / `display` / `wm` text, compares
 * against the AUT-041 budget as INFORMATION (a baseline is never gated), and renders the markdown summary.
 */
import { FOUNDER_PERF_MIN_FPS, FOUNDER_PERF_P95_BUDGET_MS } from './founder_robot_checks.ts';

export const AUT041_P95_BUDGET_MS = FOUNDER_PERF_P95_BUDGET_MS;
export const AUT041_MIN_FPS = FOUNDER_PERF_MIN_FPS;
/** Histogram layout shared with `PerfSecondSampler` (bin i = [i, i+1) ms, last bin = overflow). */
export const HIST_BIN_MS = 1;

export interface PerfSecondLike {
    readonly frames: number;
    readonly seconds: number;
    readonly fps?: number;
    readonly avgMs: number;
    readonly p95Ms?: number;
    readonly maxMs: number;
    readonly jank: number;
    readonly bigJank: number;
    readonly hist: readonly number[];
    readonly drawCalls?: number | null;
    readonly tris?: number | null;
}

/** Ascending-sorted percentile with the repo convention floor(n * q) (clamped). NaN for an empty input. */
export function percentile(values: readonly number[], q: number): number {
    if (values.length === 0) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))];
}

/** Percentile of a merged 1 ms histogram: the midpoint of the bin holding the rank (resolution +-0.5 ms); the overflow bin reports `overflowMs`. */
export function percentileFromHistogram(hist: readonly number[], q: number, overflowMs: number): number {
    const total = hist.reduce((sum, count) => sum + count, 0);
    if (total === 0) return NaN;
    const rank = Math.min(total - 1, Math.max(0, Math.floor(total * q)));
    let seen = 0;
    for (let i = 0; i < hist.length; i += 1) {
        seen += hist[i];
        if (rank < seen) return i === hist.length - 1 ? overflowMs : (i + 0.5) * HIST_BIN_MS;
    }
    return overflowMs;
}

export interface Distribution { readonly avg: number; readonly min: number; readonly p50: number; readonly p5: number; readonly max: number }

function distribution(values: readonly number[]): Distribution {
    if (values.length === 0) return { avg: NaN, min: NaN, p50: NaN, p5: NaN, max: NaN };
    return { avg: values.reduce((s, v) => s + v, 0) / values.length, min: Math.min(...values), p50: percentile(values, 0.5), p5: percentile(values, 0.05), max: Math.max(...values) };
}

export interface FrameTimeSummary {
    readonly samples: number;
    readonly seconds: number;
    readonly frames: number;
    readonly fps: Distribution;
    readonly frameMs: { readonly avg: number; readonly p50: number; readonly p95: number; readonly p99: number; readonly max: number; readonly resolutionMs: number };
    readonly jankFrames: number;
    readonly bigJankFrames: number;
    readonly jankPercent: number;
    readonly secondsWithJank: number;
    readonly worstSecondP95Ms: number | null;
}

export function summarizePerfSeconds(samples: readonly PerfSecondLike[]): FrameTimeSummary {
    const frames = samples.reduce((s, x) => s + x.frames, 0);
    const seconds = samples.reduce((s, x) => s + x.seconds, 0);
    const maxMs = samples.length ? Math.max(...samples.map((x) => x.maxMs)) : NaN;
    const bins = Math.max(0, ...samples.map((x) => x.hist.length));
    const merged = new Array<number>(bins).fill(0);
    for (const sample of samples) sample.hist.forEach((count, i) => { merged[i] += count; });
    const jankFrames = samples.reduce((s, x) => s + x.jank, 0);
    const p95s = samples.map((x) => x.p95Ms).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return {
        samples: samples.length,
        seconds,
        frames,
        fps: distribution(samples.map((x) => (x.seconds > 0 ? x.frames / x.seconds : NaN)).filter(Number.isFinite)),
        frameMs: {
            avg: frames > 0 ? samples.reduce((s, x) => s + x.avgMs * x.frames, 0) / frames : NaN,
            p50: percentileFromHistogram(merged, 0.5, maxMs),
            p95: percentileFromHistogram(merged, 0.95, maxMs),
            p99: percentileFromHistogram(merged, 0.99, maxMs),
            max: maxMs,
            resolutionMs: HIST_BIN_MS,
        },
        jankFrames,
        bigJankFrames: samples.reduce((s, x) => s + x.bigJank, 0),
        jankPercent: frames > 0 ? (jankFrames / frames) * 100 : NaN,
        secondsWithJank: samples.filter((x) => x.jank > 0).length,
        worstSecondP95Ms: p95s.length ? Math.max(...p95s) : null,
    };
}

export interface GfxCountersSummary { readonly available: boolean; readonly drawCalls: { avg: number; max: number } | null; readonly tris: { avg: number; max: number } | null }

/** Draw-call / triangle indication from the engine's gfx counters; `available: false` when no sample carried a number. */
export function summarizeGfxCounters(samples: readonly PerfSecondLike[]): GfxCountersSummary {
    const stat = (pick: (s: PerfSecondLike) => number | null | undefined): { avg: number; max: number } | null => {
        const values = samples.map(pick).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
        return values.length ? { avg: values.reduce((s, v) => s + v, 0) / values.length, max: Math.max(...values) } : null;
    };
    const drawCalls = stat((s) => s.drawCalls);
    const tris = stat((s) => s.tris);
    return { available: drawCalls !== null || tris !== null, drawCalls, tris };
}

export interface BudgetComparison { readonly p95Ms: number; readonly p95Budget: number; readonly p95Within: boolean; readonly fps: number; readonly minFps: number; readonly fpsWithin: boolean; readonly informationOnly: true }

/** AUT-041 budget (p95 <= 25 ms, >= 50 fps) as INFORMATION only: it never gates the baseline. */
export function compareToAut041Budget(summary: FrameTimeSummary): BudgetComparison {
    return {
        p95Ms: summary.frameMs.p95,
        p95Budget: AUT041_P95_BUDGET_MS,
        p95Within: summary.frameMs.p95 <= AUT041_P95_BUDGET_MS,
        fps: summary.fps.avg,
        minFps: AUT041_MIN_FPS,
        fpsWithin: summary.fps.avg >= AUT041_MIN_FPS,
        informationOnly: true,
    };
}

// ---- dumpsys / adb text parsers (every parser returns null fields instead of throwing) ----

export interface GfxinfoSummary { readonly totalFrames: number | null; readonly jankyFrames: number | null; readonly jankyPercent: number | null; readonly p50Ms: number | null; readonly p90Ms: number | null; readonly p95Ms: number | null; readonly p99Ms: number | null; readonly missedVsync: number | null; readonly slowUiThread: number | null; readonly slowIssueDraw: number | null; readonly deadlineMissed: number | null }

export function parseGfxinfo(text: string): GfxinfoSummary {
    const num = (re: RegExp): number | null => { const m = re.exec(text); return m ? Number(m[1]) : null; };
    const janky = /Janky frames:\s*(\d+)\s*\(([\d.]+)%\)/.exec(text);
    return {
        totalFrames: num(/Total frames rendered:\s*(\d+)/),
        jankyFrames: janky ? Number(janky[1]) : null,
        jankyPercent: janky ? Number(janky[2]) : null,
        p50Ms: num(/50th percentile:\s*([\d.]+)ms/),
        p90Ms: num(/90th percentile:\s*([\d.]+)ms/),
        p95Ms: num(/95th percentile:\s*([\d.]+)ms/),
        p99Ms: num(/99th percentile:\s*([\d.]+)ms/),
        missedVsync: num(/Number Missed Vsync:\s*(\d+)/),
        slowUiThread: num(/Number Slow UI thread:\s*(\d+)/),
        slowIssueDraw: num(/Number Slow issue draw commands:\s*(\d+)/),
        deadlineMissed: num(/Number Frame deadline missed:\s*(\d+)/),
    };
}

export interface MeminfoSummary { readonly totalPssKb: number | null; readonly javaHeapKb: number | null; readonly nativeHeapKb: number | null; readonly graphicsKb: number | null; readonly codeKb: number | null; readonly stackKb: number | null; readonly privateOtherKb: number | null; readonly systemKb: number | null }

export function parseMeminfoSummary(text: string): MeminfoSummary {
    const kb = (label: string): number | null => { const m = new RegExp(`^\\s*${label}:\\s+(\\d+)`, 'mi').exec(text); return m ? Number(m[1]) : null; };
    const legacyTotal = /^\s*TOTAL\s+(\d+)/m.exec(text);
    return {
        totalPssKb: kb('TOTAL PSS') ?? (legacyTotal ? Number(legacyTotal[1]) : null),
        javaHeapKb: kb('Java Heap'),
        nativeHeapKb: kb('Native Heap'),
        graphicsKb: kb('Graphics'),
        codeKb: kb('Code'),
        stackKb: kb('Stack'),
        privateOtherKb: kb('Private Other'),
        systemKb: kb('System'),
    };
}

export interface TopSummary { readonly deviceCpuBusyPercent: number | null; readonly deviceCpuCapacityPercent: number | null; readonly processCpuPercent: number | null }

/** toybox `top -b -n 1`: header `800%cpu  45%user ... 700%idle` and one row per process (`S[%CPU]` column). */
export function parseTop(text: string, packageName: string): TopSummary {
    const header = /(\d+)%cpu\s+(\d+)%user\s+(\d+)%nice\s+(\d+)%sys\s+(\d+)%idle/.exec(text);
    const capacity = header ? Number(header[1]) : null;
    const idle = header ? Number(header[5]) : null;
    let processCpu: number | null = null;
    const lines = text.split(/\r?\n/);
    const headerLine = lines.find((l) => /\bPID\b/.test(l) && /%CPU/.test(l));
    if (headerLine) {
        const columns = headerLine.trim().split(/\s+/).flatMap((c) => (c === 'S[%CPU]' ? ['S', '%CPU'] : [c]));
        const cpuIndex = columns.indexOf('%CPU');
        const row = lines.find((l) => l.includes(packageName) && !/\bPID\b/.test(l));
        const tokens = row?.trim().split(/\s+/) ?? [];
        const value = cpuIndex >= 0 ? Number(tokens[cpuIndex]) : NaN;
        processCpu = Number.isFinite(value) ? value : null;
    }
    return { deviceCpuCapacityPercent: capacity, deviceCpuBusyPercent: capacity !== null && idle !== null ? capacity - idle : null, processCpuPercent: processCpu };
}

export interface CpuinfoSummary { readonly totalPercent: number | null; readonly userPercent: number | null; readonly kernelPercent: number | null }

/** `dumpsys cpuinfo` line: `  45% 1234/com.pkg: 30% user + 15% kernel`. */
export function parseCpuinfo(text: string, packageName: string): CpuinfoSummary {
    const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`([\\d.]+)%\\s+\\d+/${escaped}:\\s+([\\d.]+)%\\s+user\\s+\\+\\s+([\\d.]+)%\\s+kernel`).exec(text);
    return { totalPercent: m ? Number(m[1]) : null, userPercent: m ? Number(m[2]) : null, kernelPercent: m ? Number(m[3]) : null };
}

export function parseWmSize(text: string): string | null {
    const override = /Override size:\s*(\d+x\d+)/.exec(text);
    const physical = /Physical size:\s*(\d+x\d+)/.exec(text);
    return (override ?? physical)?.[1] ?? null;
}

export function parseWmDensity(text: string): number | null {
    const m = /(?:Override|Physical) density:\s*(\d+)/.exec(text);
    return m ? Number(m[1]) : null;
}

/** Active display refresh rate from `dumpsys display` (`mActiveSfDisplayMode=...fps=120.0` or `renderFrameRate`), else the first `fps=`. */
export function parseRefreshRateHz(text: string): number | null {
    const active = /mActiveSfDisplayMode=[^\n]*?fps=([\d.]+)/.exec(text) ?? /renderFrameRate[= ]+([\d.]+)/.exec(text) ?? /fps=([\d.]+)/.exec(text);
    return active ? Number(active[1]) : null;
}

/** GPU renderer line from `dumpsys SurfaceFlinger` (`GLES: Qualcomm, Adreno (TM) 650, OpenGL ES 3.2 ...`), else null. */
export function parseGlesRenderer(text: string): string | null {
    const m = /GLES:\s*([^\r\n]+)/.exec(text);
    return m ? m[1].trim() : null;
}

/** Adreno `gpubusy` ("busy total" cycles) as a percentage; null when the file is missing / not parseable. */
export function parseGpuBusyPercent(text: string): number | null {
    const m = /(\d+)\s+(\d+)/.exec(text.trim());
    if (!m) return null;
    const total = Number(m[2]);
    return total > 0 ? Math.round((Number(m[1]) / total) * 1000) / 10 : null;
}

// ---- baseline document + markdown ----

export interface BaselineDocument {
    readonly schema: 'aut067-baseline/1';
    readonly capturedAtUtc: string;
    readonly scenario: string;
    readonly build: Record<string, unknown>;
    readonly device: Record<string, unknown>;
    readonly state: Record<string, unknown>;
    readonly frameTime: FrameTimeSummary;
    readonly gfxCounters: GfxCountersSummary;
    readonly sceneCounts: ReadonlyArray<Record<string, unknown>>;
    readonly gfxinfo: GfxinfoSummary | null;
    readonly meminfoBefore: MeminfoSummary | null;
    readonly meminfoAfter: MeminfoSummary | null;
    readonly cpu: { readonly top: TopSummary | null; readonly cpuinfo: CpuinfoSummary | null };
    readonly gpu: { readonly renderer: string | null; readonly busyPercent: number | null; readonly status: string };
    readonly budgetAut041: BudgetComparison;
    readonly notes: readonly string[];
    readonly artifacts: Readonly<Record<string, string>>;
}

const fmt = (value: number | null | undefined, digits = 2): string => (typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : 'unavailable');
const mb = (kb: number | null | undefined): string => (typeof kb === 'number' ? (kb / 1024).toFixed(0) : 'unavailable');

export function renderBaselineMarkdown(doc: BaselineDocument): string {
    const ft = doc.frameTime;
    const memRow = (label: string, m: MeminfoSummary | null) => `| ${label} | ${mb(m?.totalPssKb)} | ${mb(m?.javaHeapKb)} | ${mb(m?.nativeHeapKb)} | ${mb(m?.graphicsKb)} | ${mb(m?.codeKb)} | ${mb(m?.stackKb)} |`;
    const rows: string[] = [
        `# AUT-067 performance baseline (${doc.scenario})`,
        '',
        `Captured ${doc.capturedAtUtc}. Machine-readable twin: baseline.json. Baseline only: nothing here is a pass/fail gate.`,
        '',
        '## Build and device',
        '',
        '```json',
        JSON.stringify({ build: doc.build, device: doc.device, state: doc.state }, null, 2),
        '```',
        '',
        '## Frame time (in-app DEBUG sampler, 1 sample per second after warm-up)',
        '',
        '| samples (s) | frames | fps avg | fps p5 | fps min | avg ms | p50 ms | p95 ms | p99 ms | max ms | jank frames (>33.3 ms) | big jank (>50 ms) | seconds with jank |',
        '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
        `| ${ft.samples} | ${ft.frames} | ${fmt(ft.fps.avg, 1)} | ${fmt(ft.fps.p5, 1)} | ${fmt(ft.fps.min, 1)} | ${fmt(ft.frameMs.avg)} | ${fmt(ft.frameMs.p50, 1)} | ${fmt(ft.frameMs.p95, 1)} | ${fmt(ft.frameMs.p99, 1)} | ${fmt(ft.frameMs.max)} | ${ft.jankFrames} (${fmt(ft.jankPercent, 1)}%) | ${ft.bigJankFrames} | ${ft.secondsWithJank} |`,
        '',
        `Percentiles come from a merged 1 ms histogram (resolution +-${ft.frameMs.resolutionMs / 2} ms); avg and max are exact.`,
        '',
        '## Versus the AUT-041 budget (information only)',
        '',
        `p95 ${fmt(doc.budgetAut041.p95Ms, 1)} ms vs <= ${doc.budgetAut041.p95Budget} ms: ${doc.budgetAut041.p95Within ? 'within' : 'OVER'}; fps ${fmt(doc.budgetAut041.fps, 1)} vs >= ${doc.budgetAut041.minFps}: ${doc.budgetAut041.fpsWithin ? 'within' : 'BELOW'}.`,
        '',
        '## Android frame stats (`dumpsys gfxinfo`, reset before the window)',
        '',
        doc.gfxinfo ? ['```json', JSON.stringify(doc.gfxinfo, null, 2), '```'].join('\n') : 'unavailable',
        '',
        '## Memory (`dumpsys meminfo`, MB)',
        '',
        '| | total PSS | Java heap | native heap | graphics | code | stack |',
        '|---|---:|---:|---:|---:|---:|---:|',
        memRow('before', doc.meminfoBefore),
        memRow('after', doc.meminfoAfter),
        '',
        '## CPU / GPU indication',
        '',
        `- top: process ${fmt(doc.cpu.top?.processCpuPercent, 1)}% of one core, device busy ${fmt(doc.cpu.top?.deviceCpuBusyPercent, 0)}% of ${fmt(doc.cpu.top?.deviceCpuCapacityPercent, 0)}% capacity`,
        `- dumpsys cpuinfo: total ${fmt(doc.cpu.cpuinfo?.totalPercent, 1)}% (user ${fmt(doc.cpu.cpuinfo?.userPercent, 1)}% + kernel ${fmt(doc.cpu.cpuinfo?.kernelPercent, 1)}%)`,
        `- GPU: ${doc.gpu.status}; renderer ${doc.gpu.renderer ?? 'unavailable'}; busy ${fmt(doc.gpu.busyPercent, 1)}%`,
        '',
        '## Draw calls / triangles / renderers',
        '',
        doc.gfxCounters.available
            ? `- engine gfx counters: draw calls avg ${fmt(doc.gfxCounters.drawCalls?.avg, 0)} (max ${fmt(doc.gfxCounters.drawCalls?.max, 0)}), triangles avg ${fmt(doc.gfxCounters.tris?.avg, 0)} (max ${fmt(doc.gfxCounters.tris?.max, 0)})`
            : '- engine gfx counters (draw calls / triangles): unavailable on this build (renderer and node counts below are reported instead)',
        '',
        '```json',
        JSON.stringify(doc.sceneCounts, null, 2),
        '```',
        '',
        '## Notes',
        '',
        ...(doc.notes.length ? doc.notes.map((n) => `- ${n}`) : ['- none']),
        '',
    ];
    return rows.join('\n');
}
