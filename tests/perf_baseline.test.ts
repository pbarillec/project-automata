import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DEVICE_EVENT_TYPES, type ParsedDeviceEvent } from '../assets/scripts/presentation/DeviceDiagnostics.ts';
import { PERF_HIST_BINS, PerfSecondSampler } from '../assets/scripts/presentation/PerfSecondSampler.ts';
import { assertDeserializeGameStateFromSaveJson } from '../assets/scripts/persistence/index.ts';
import { isFounderRobotCosmeticOwned } from '../assets/scripts/monetization/FounderOffer.ts';
import { resolveVisibleRobotCount } from '../assets/scripts/presentation/RobotPopulation.ts';
import { buildBaselineDocument, evaluatePerfBaseline, windowSamples, type PerfCapture } from '../tools/device/perf_baseline.ts';
import {
    compareToAut041Budget,
    parseCpuinfo,
    parseGfxinfo,
    parseGlesRenderer,
    parseGpuBusyPercent,
    parseMeminfoSummary,
    parseRefreshRateHz,
    parseTop,
    parseWmSize,
    percentile,
    percentileFromHistogram,
    renderBaselineMarkdown,
    summarizeGfxCounters,
    summarizePerfSeconds,
    type PerfSecondLike,
} from '../tools/device/perf_stats.ts';
import { DEFAULT_REVEAL_EVENT_TYPES, REVEAL_SCENARIOS, evaluateRevealTimeline } from '../tools/device/reveal_capture.ts';
import { AUT067_PRODUCER_IDS, AUT067_PRODUCER_LEVEL, AUT067_VISIBLE_ROBOTS, buildAut067BenchmarkOverride, buildAut067SeededSave, buildAut067SeededState } from '../tools/device/seed_aut067.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const NOW_MS = Date.parse('2026-11-15T12:00:00Z');

function second(index: number, frames: number, ms: number, extra: Partial<PerfSecondLike> = {}): PerfSecondLike & { index: number } {
    const hist = new Array<number>(PERF_HIST_BINS).fill(0);
    hist[Math.floor(ms)] = frames;
    return { index, frames, seconds: 1, fps: frames, avgMs: ms, p95Ms: ms, maxMs: ms, jank: ms > 33.34 ? frames : 0, bigJank: ms > 50 ? frames : 0, hist, ...extra };
}

test('percentile follows the repo floor(n * q) convention and handles empty input', () => {
    assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5), 6);
    assert.equal(percentile([5, 1, 3], 0.95), 5);
    assert.ok(Number.isNaN(percentile([], 0.5)));
});

test('percentileFromHistogram reads 1 ms bin midpoints and the overflow bin reports the exact max', () => {
    const hist = new Array<number>(PERF_HIST_BINS).fill(0);
    hist[16] = 90;
    hist[20] = 9;
    hist[PERF_HIST_BINS - 1] = 1;
    assert.equal(percentileFromHistogram(hist, 0.5, 80), 16.5);
    assert.equal(percentileFromHistogram(hist, 0.95, 80), 20.5);
    assert.equal(percentileFromHistogram(hist, 0.999, 80), 80);
    assert.ok(Number.isNaN(percentileFromHistogram([0, 0], 0.5, 1)));
});

test('PerfSecondSampler skips the warm-up, emits one sample per second with jank counts and a histogram', () => {
    const sampler = new PerfSecondSampler({ warmupSeconds: 0.95, windowSeconds: 1, maxSamples: 2 });
    for (let i = 0; i < 10; i += 1) assert.equal(sampler.add(0.1), null, 'warm-up frames are skipped');
    let sample = null;
    for (let i = 0; i < 59 && !sample; i += 1) sample = sampler.add(1 / 60);
    assert.equal(sample, null, 'a second is not complete before 1 s elapsed');
    sample = sampler.add(0.2);
    assert.ok(sample);
    assert.equal(sample.index, 0);
    assert.equal(sample.frames, 60);
    assert.equal(sample.jank, 1);
    assert.equal(sample.bigJank, 1);
    assert.equal(sample.hist.length, PERF_HIST_BINS);
    assert.equal(sample.hist.reduce((s, n) => s + n, 0), 60);
    assert.ok(sample.maxMs >= 199 && sample.maxMs <= 201);
    assert.equal(sample.hist[PERF_HIST_BINS - 1], 1, 'the 200 ms frame lands in the overflow bin');
    // Bounded: stops after maxSamples and ignores bad deltas.
    assert.equal(sampler.add(Number.NaN), null);
    assert.equal(sampler.add(-1), null);
    let second2 = null;
    while (!second2) second2 = sampler.add(0.25);
    assert.equal(second2.index, 1);
    assert.equal(sampler.done, true);
    assert.equal(sampler.add(5), null);
});

test('summarizePerfSeconds merges seconds into fps / frame-time / jank figures', () => {
    const samples = [second(0, 60, 16.6), second(1, 60, 16.6), second(2, 30, 33.9), second(3, 20, 55)];
    const summary = summarizePerfSeconds(samples);
    assert.equal(summary.samples, 4);
    assert.equal(summary.frames, 170);
    assert.equal(summary.seconds, 4);
    assert.equal(summary.fps.min, 20);
    assert.equal(summary.fps.max, 60);
    assert.ok(Math.abs(summary.fps.avg - 42.5) < 1e-9);
    assert.equal(summary.jankFrames, 50);
    assert.equal(summary.bigJankFrames, 20);
    assert.equal(summary.secondsWithJank, 2);
    assert.equal(summary.frameMs.max, 55);
    assert.ok(summary.frameMs.p50 >= 16 && summary.frameMs.p50 <= 17);
    assert.ok(summary.frameMs.p99 >= 33 && summary.frameMs.p99 <= 56);
    const empty = summarizePerfSeconds([]);
    assert.equal(empty.samples, 0);
    assert.ok(Number.isNaN(empty.frameMs.avg));
});

test('summarizeGfxCounters reports unavailable when no sample carries a number', () => {
    assert.equal(summarizeGfxCounters([second(0, 60, 16, { drawCalls: null, tris: null })]).available, false);
    const some = summarizeGfxCounters([second(0, 60, 16, { drawCalls: 100, tris: 5000 }), second(1, 60, 16, { drawCalls: 140, tris: 7000 })]);
    assert.equal(some.available, true);
    assert.deepEqual(some.drawCalls, { avg: 120, max: 140 });
    assert.deepEqual(some.tris, { avg: 6000, max: 7000 });
});

test('the AUT-041 budget comparison is information only', () => {
    const good = compareToAut041Budget(summarizePerfSeconds([second(0, 60, 16.6)]));
    assert.equal(good.informationOnly, true);
    assert.equal(good.p95Within, true);
    assert.equal(good.fpsWithin, true);
    const bad = compareToAut041Budget(summarizePerfSeconds([second(0, 25, 40)]));
    assert.equal(bad.p95Within, false);
    assert.equal(bad.fpsWithin, false);
});

const GFXINFO = `Stats since: 123ns
Total frames rendered: 2700
Janky frames: 135 (5.00%)
50th percentile: 16ms
90th percentile: 19ms
95th percentile: 24ms
99th percentile: 38ms
Number Missed Vsync: 12
Number Slow UI thread: 3
Number Slow issue draw commands: 40
Number Frame deadline missed: 70`;

const MEMINFO = `** MEMINFO in pid 1234 [com.projectautomata.androidbaseline] **
 App Summary
                       Pss(KB)                        Rss(KB)
                        ------                         ------
           Java Heap:    41800                          90000
         Native Heap:   180000                         200000
                Code:    30000                          80000
               Stack:     1000                           1000
            Graphics:   120000                         120000
       Private Other:    20000
              System:     9000
               TOTAL PSS:   402800            TOTAL RSS:   520000      TOTAL SWAP PSS:     0`;

const TOP = `Tasks: 700 total,   2 running
Mem:  7800000k total
800%cpu  95%user   1%nice  40%sys 640%idle   0%iow  24%irq   0%sirq   0%host
  PID USER         PR  NI VIRT  RES  SHR S[%CPU] %MEM     TIME+ ARGS
 1234 u0_a123      20   0 9.0G 400M 200M S  87.5   5.1   1:23.45 com.projectautomata.androidbaseline
  900 system       18  -2 2.0G 100M  50M S   5.0   1.0   2:00.00 surfaceflinger`;

test('dumpsys / top parsers extract the documented fields and return null on garbage', () => {
    const gfx = parseGfxinfo(GFXINFO);
    assert.equal(gfx.totalFrames, 2700);
    assert.equal(gfx.jankyFrames, 135);
    assert.equal(gfx.jankyPercent, 5);
    assert.equal(gfx.p95Ms, 24);
    assert.equal(gfx.p99Ms, 38);
    assert.equal(gfx.deadlineMissed, 70);
    assert.equal(parseGfxinfo('nothing').totalFrames, null);

    const mem = parseMeminfoSummary(MEMINFO);
    assert.equal(mem.totalPssKb, 402800);
    assert.equal(mem.javaHeapKb, 41800);
    assert.equal(mem.nativeHeapKb, 180000);
    assert.equal(mem.graphicsKb, 120000);
    assert.equal(parseMeminfoSummary('').totalPssKb, null);

    const top = parseTop(TOP, 'com.projectautomata.androidbaseline');
    assert.equal(top.deviceCpuCapacityPercent, 800);
    assert.equal(top.deviceCpuBusyPercent, 160);
    assert.equal(top.processCpuPercent, 87.5);
    assert.equal(parseTop('garbage', 'x').processCpuPercent, null);

    const cpu = parseCpuinfo('  45% 1234/com.projectautomata.androidbaseline: 30% user + 15% kernel', 'com.projectautomata.androidbaseline');
    assert.deepEqual(cpu, { totalPercent: 45, userPercent: 30, kernelPercent: 15 });
    assert.equal(parseCpuinfo('', 'a.b').totalPercent, null);

    assert.equal(parseWmSize('Physical size: 1080x2412\nOverride size: 720x1608'), '720x1608');
    assert.equal(parseWmSize('Physical size: 1080x2412'), '1080x2412');
    assert.equal(parseRefreshRateHz('mActiveSfDisplayMode=DisplayMode{id=2, width=1080, height=2412, fps=120.0}'), 120);
    assert.equal(parseRefreshRateHz('nothing'), null);
    assert.equal(parseGlesRenderer('GLES: Qualcomm, Adreno (TM) 650, OpenGL ES 3.2 V@0502'), 'Qualcomm, Adreno (TM) 650, OpenGL ES 3.2 V@0502');
    assert.equal(parseGpuBusyPercent('250 1000'), 25);
    assert.equal(parseGpuBusyPercent('No such file'), null);
});

function ev(tMs: number, event: Record<string, unknown>): { tMs: number; event: ParsedDeviceEvent } {
    return { tMs, event: { v: 1, seq: tMs, ...event } as ParsedDeviceEvent };
}

function sampleEvents(count: number, ms = 16.6): Array<{ tMs: number; event: ParsedDeviceEvent }> {
    return Array.from({ length: count }, (_, i) => ev(1000 + i * 1000, { evt: 'perf_second', ...second(i, 60, ms), drawCalls: 120, tris: 40000 }));
}

const CAPTURE: PerfCapture = {
    raw: { meminfo_before: MEMINFO, meminfo_after: MEMINFO, gfxinfo_after: GFXINFO, top: TOP, wm_size: 'Physical size: 1080x2412', pm_path: 'package:/data/app/x/base.apk', apk_sha256: `${'a'.repeat(64)}  /data/app/x/base.apk` },
    props: { 'ro.product.model': 'TestPhone', 'ro.soc.model': 'SM8250' },
    notes: [],
    windowStartedAtUtc: '2026-11-15T12:00:07.000Z',
    windowEndedAtUtc: '2026-11-15T12:00:52.000Z',
    firstSampleSeen: true,
};

const BASE_EVENTS = [
    ev(10, { evt: 'robot_benchmark', maxVisible: 14 }),
    ev(20, { evt: 'robot_population', phase: 'synced', visible: 14, pooled: 14 }),
    ev(30, { evt: 'robot_founder', phase: 'synced', owned: false }),
    ev(40, { evt: 'perf_scene', index: 0, nodes: 900, meshRenderers: 400 }),
];

test('windowSamples keeps only the first windowSeconds one-second samples', () => {
    const events = sampleEvents(50);
    assert.equal(windowSamples(events, 45).length, 45);
    assert.equal(windowSamples(events, 45)[44].index, 44);
});

test('evaluatePerfBaseline: sanity checks pass on a clean capture and the budget line is information only', () => {
    const checks = evaluatePerfBaseline([...BASE_EVENTS, ...sampleEvents(45, 60)], 'standard', { windowSeconds: 45, minSamples: 30 }, CAPTURE);
    for (const check of checks) assert.ok(check.ok, `${check.id}: ${check.detail}`);
    const budget = checks.find((c) => c.id === 'perf_vs_aut041_budget_info');
    assert.ok(budget);
    assert.match(budget.detail, /INFORMATION ONLY/);
    assert.match(budget.detail, /OVER/, 'a 60 ms frame time is reported as over budget but never fails the check');
});

test('evaluatePerfBaseline: too few samples, missing override, errors and a missing window fail the sanity checks', () => {
    const failing = (events: ReturnType<typeof ev>[], capture: PerfCapture | null, expect: 'standard' | 'founder' = 'standard') => evaluatePerfBaseline(events, expect, { windowSeconds: 45, minSamples: 30 }, capture).filter((c) => !c.ok).map((c) => c.id);
    assert.ok(failing([...BASE_EVENTS, ...sampleEvents(10)], CAPTURE).includes('perf_samples_collected'));
    assert.ok(failing([...BASE_EVENTS.slice(1), ...sampleEvents(45)], CAPTURE).includes('perf_benchmark_override_active'));
    assert.ok(failing([...BASE_EVENTS, ...sampleEvents(45), ev(99, { evt: 'error', message: 'x' })], CAPTURE).includes('perf_no_error_events'));
    assert.ok(failing([...BASE_EVENTS, ...sampleEvents(45)], null).includes('perf_capture_completed'));
    assert.ok(failing([...BASE_EVENTS, ...sampleEvents(45)], CAPTURE, 'founder').includes('perf_variant_matches'));
    assert.ok(failing([...BASE_EVENTS, ...sampleEvents(45)], { ...CAPTURE, raw: { ...CAPTURE.raw, meminfo_after: null } }).includes('perf_adb_snapshots'));
});

test('buildBaselineDocument assembles device / build / frame-time facts and reports unavailable data honestly', () => {
    const doc = buildBaselineDocument({
        scenario: 'aut067-baseline',
        events: [...BASE_EVENTS, ...sampleEvents(45).map((e) => ({ ...e, event: { ...e.event, drawCalls: null, tris: null } }))],
        capture: CAPTURE,
        options: { variant: 'standard', windowSeconds: 45, minSamples: 30 },
        packageName: 'com.projectautomata.androidbaseline',
        git: { gitSha: 'abc1234', gitDirty: false, branch: 'feat/aut-067-perf-baseline' },
        nowIso: '2026-11-15T12:01:00.000Z',
    });
    assert.equal(doc.schema, 'aut067-baseline/1');
    assert.equal(doc.build.apkSha256, 'a'.repeat(64));
    assert.equal(doc.build.gitSha, 'abc1234');
    assert.equal(doc.device.model, 'TestPhone');
    assert.equal(doc.device.soc, 'SM8250');
    assert.equal(doc.device.resolution, '1080x2412');
    assert.equal(doc.frameTime.samples, 45);
    assert.equal(doc.gfxCounters.available, false);
    assert.ok(doc.notes.some((n) => n.includes('not reachable')));
    assert.ok(doc.notes.some((n) => n.includes('GPU busy percentage: unavailable')));
    assert.equal(doc.gpu.status, 'unavailable');
    assert.equal(doc.meminfoAfter?.totalPssKb, 402800);
    assert.equal(doc.cpu.top?.processCpuPercent, 87.5);
    assert.equal(doc.sceneCounts.length, 1);
    const markdown = renderBaselineMarkdown(doc);
    assert.match(markdown, /AUT-067 performance baseline/);
    assert.match(markdown, /unavailable on this build/);
    assert.match(markdown, /information only/i);
    JSON.parse(JSON.stringify(doc));
});

test('seed_aut067: Era III, all producers Lv100 and automated, 14 baseline robots, Overclock active, Founder only for the founder variant', () => {
    const standard = buildAut067SeededState('standard', NOW_MS);
    assert.equal(standard.run.currentEraId, 'robotics_complex');
    for (const id of AUT067_PRODUCER_IDS) {
        assert.deepEqual(standard.run.producers[id], { level: AUT067_PRODUCER_LEVEL, isUnlocked: true, isBuilt: true }, id);
        assert.equal(standard.run.automation[id]?.isAutomated, true, id);
    }
    assert.equal(resolveVisibleRobotCount(standard.run.robotsBuilt, { maxVisible: AUT067_VISIBLE_ROBOTS }), AUT067_VISIBLE_ROBOTS);
    assert.equal(standard.boosts.activeBoosts.free_overclock?.remainingSeconds, 60);
    assert.equal(isFounderRobotCosmeticOwned(standard), false);
    assert.equal(isFounderRobotCosmeticOwned(buildAut067SeededState('founder', NOW_MS)), true);
    for (const variant of ['standard', 'founder'] as const) {
        const loaded = assertDeserializeGameStateFromSaveJson(buildAut067SeededSave(variant, NOW_MS));
        assert.equal(loaded.state.run.producers.advanced_robotics_complex.level, AUT067_PRODUCER_LEVEL, variant);
    }
    assert.deepEqual(JSON.parse(buildAut067BenchmarkOverride()), { maxVisible: 14, perf: true });
});

test('AUT-067 scenarios are registered and wired through cli.ts and reveal_capture.ts into evaluateRevealTimeline', () => {
    for (const [id, variant] of [['aut067-baseline', 'standard'], ['aut067-baseline-founder', 'founder']] as const) {
        const scenario = REVEAL_SCENARIOS[id];
        assert.ok(scenario, id);
        assert.equal(scenario.expectPerfBaseline?.variant, variant);
        assert.ok((scenario.expectPerfBaseline?.minSamples ?? 0) >= 30);
        assert.equal(scenario.trigger, 'none');
    }
    assert.match(read('tools/device/cli.ts'), /expectPerfBaseline: scenario\.expectPerfBaseline/);
    assert.match(read('tools/device/cli.ts'), /seed-aut067/);
    assert.match(read('package.json'), /"device:seed-aut067"/);
    const capture = read('tools/device/reveal_capture.ts');
    assert.match(capture, /evaluatePerfBaseline\(events, options\.expectPerfBaseline\.variant/);
    assert.match(capture, /writePerfBaseline\(perfDir, doc\)/);
    for (const evt of ['robot_benchmark', 'perf_second', 'perf_scene']) {
        assert.ok(DEFAULT_REVEAL_EVENT_TYPES.includes(evt), evt);
        assert.ok((DEVICE_EVENT_TYPES as readonly string[]).includes(evt), evt);
    }
    const checks = evaluateRevealTimeline([...BASE_EVENTS, ...sampleEvents(45)], { expectConstruction: null, expectFocus: false, triggered: true, frameCount: 5, expectPerfBaseline: { variant: 'standard', windowSeconds: 45, minSamples: 30 }, perfCapture: CAPTURE });
    assert.ok(checks.some((c) => c.id === 'perf_samples_collected' && c.ok));
});

test('the DEBUG sampler is only created from the benchmark override, never in release', () => {
    const controller = read('assets/scripts/presentation/RobotPopulationController.ts');
    assert.match(controller, /if \(DEBUG !== true\) return;/);
    assert.match(controller, /perf\?: unknown/);
    assert.match(controller, /this\.perfSeconds = new PerfSecondSampler\(\)/);
    assert.match(controller, /director\.root/);
    assert.ok(fs.existsSync(path.join(ROOT, 'assets/scripts/presentation/PerfSecondSampler.ts.meta')));
});
