/**
 * AUT-041 DEBUG-only frame-time sampler (engine-free). Collects per-frame delta times, skips a warm-up, then
 * reports fixed-length windows (frames, average, p95, max, fps). Used by the robot population benchmark only.
 */

export interface FramePerfWindow {
    readonly index: number;
    readonly frames: number;
    readonly seconds: number;
    readonly avgMs: number;
    readonly p95Ms: number;
    readonly maxMs: number;
    readonly fps: number;
}

export interface FramePerfOptions {
    readonly warmupSeconds: number;
    readonly windowSeconds: number;
    readonly maxWindows: number;
}

export const DEFAULT_FRAME_PERF_OPTIONS: FramePerfOptions = Object.freeze({ warmupSeconds: 6, windowSeconds: 5, maxWindows: 3 });

export class FramePerfSampler {
    private readonly options: FramePerfOptions;
    private warmup = 0;
    private frames: number[] = [];
    private windowTime = 0;
    private emitted = 0;

    public constructor(options: FramePerfOptions = DEFAULT_FRAME_PERF_OPTIONS) {
        this.options = options;
    }

    public get done(): boolean { return this.emitted >= this.options.maxWindows; }

    /** Adds one frame; returns a finished window when its length is reached, otherwise null. */
    public add(deltaSeconds: number): FramePerfWindow | null {
        if (this.done || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return null;
        if (this.warmup < this.options.warmupSeconds) {
            this.warmup += deltaSeconds;
            return null;
        }
        this.frames.push(deltaSeconds * 1000);
        this.windowTime += deltaSeconds;
        if (this.windowTime < this.options.windowSeconds) return null;
        const sorted = [...this.frames].sort((a, b) => a - b);
        const sum = sorted.reduce((total, value) => total + value, 0);
        const window: FramePerfWindow = {
            index: this.emitted,
            frames: sorted.length,
            seconds: this.windowTime,
            avgMs: sum / sorted.length,
            p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
            maxMs: sorted[sorted.length - 1],
            fps: sorted.length / this.windowTime,
        };
        this.emitted += 1;
        this.frames = [];
        this.windowTime = 0;
        return window;
    }
}
