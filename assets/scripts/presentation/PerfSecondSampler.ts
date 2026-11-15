/**
 * AUT-067 DEBUG-only per-second frame-time sampler (engine-free). Skips a warm-up, then reports one sample per
 * elapsed second: frame count, avg / p50 / p95 / p99 / max frame time, jank counts and a 1 ms histogram so the
 * tooling can merge seconds into exact-to-1 ms overall percentiles. Measurement only: no gameplay or visual effect.
 */

/** A frame longer than this (about two 60 Hz frames) is a jank frame; longer than the big-jank limit a big jank frame. */
export const PERF_JANK_FRAME_MS = 33.34;
export const PERF_BIG_JANK_FRAME_MS = 50;
/** Histogram: bins 0..PERF_HIST_BINS-1 are 1 ms wide (bin i = [i, i+1) ms), the last bin collects everything >= PERF_HIST_BINS - 1 ms. */
export const PERF_HIST_BINS = 60;

export interface PerfSecondSample {
    readonly index: number;
    readonly frames: number;
    readonly seconds: number;
    readonly fps: number;
    readonly avgMs: number;
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly p99Ms: number;
    readonly maxMs: number;
    readonly jank: number;
    readonly bigJank: number;
    readonly hist: readonly number[];
}

export interface PerfSecondOptions {
    readonly warmupSeconds: number;
    readonly windowSeconds: number;
    readonly maxSamples: number;
}

export const DEFAULT_PERF_SECOND_OPTIONS: PerfSecondOptions = Object.freeze({ warmupSeconds: 6, windowSeconds: 1, maxSamples: 120 });

/** Nearest-rank style percentile on an ascending-sorted array (same convention as FramePerfSampler: floor(n * q)). */
export function percentileOfSorted(sorted: readonly number[], q: number): number {
    if (sorted.length === 0) return NaN;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))];
}

export class PerfSecondSampler {
    private readonly options: PerfSecondOptions;
    private warmup = 0;
    private frames: number[] = [];
    private windowTime = 0;
    private emitted = 0;

    public constructor(options: PerfSecondOptions = DEFAULT_PERF_SECOND_OPTIONS) {
        this.options = options;
    }

    public get done(): boolean { return this.emitted >= this.options.maxSamples; }

    /** Adds one frame; returns a finished sample when its window length is reached, otherwise null. */
    public add(deltaSeconds: number): PerfSecondSample | null {
        if (this.done || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return null;
        if (this.warmup < this.options.warmupSeconds) {
            this.warmup += deltaSeconds;
            return null;
        }
        this.frames.push(deltaSeconds * 1000);
        this.windowTime += deltaSeconds;
        if (this.windowTime < this.options.windowSeconds) return null;
        const sorted = [...this.frames].sort((a, b) => a - b);
        const hist = new Array<number>(PERF_HIST_BINS).fill(0);
        let sum = 0;
        let jank = 0;
        let bigJank = 0;
        for (const ms of sorted) {
            sum += ms;
            hist[Math.min(PERF_HIST_BINS - 1, Math.floor(ms))] += 1;
            if (ms > PERF_JANK_FRAME_MS) jank += 1;
            if (ms > PERF_BIG_JANK_FRAME_MS) bigJank += 1;
        }
        const sample: PerfSecondSample = {
            index: this.emitted,
            frames: sorted.length,
            seconds: Math.round(this.windowTime * 1000) / 1000,
            fps: sorted.length / this.windowTime,
            avgMs: sum / sorted.length,
            p50Ms: percentileOfSorted(sorted, 0.5),
            p95Ms: percentileOfSorted(sorted, 0.95),
            p99Ms: percentileOfSorted(sorted, 0.99),
            maxMs: sorted[sorted.length - 1],
            jank,
            bigJank,
            hist,
        };
        this.emitted += 1;
        this.frames = [];
        this.windowTime = 0;
        return sample;
    }
}
