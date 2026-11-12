/**
 * AUT-041 DEBUG-only robot population benchmark.
 *
 * For each size in 1 / 8 / 14 / 20 / 30: force-stop, push a seeded save (Assembly Lv10, Worker Bot owned, a huge
 * Robots Built so the cap decides) plus the DEBUG override file `population_benchmark.json`, relaunch, wait for
 * `robot_population` with the expected visible count, collect the app's `robot_perf` frame-time windows, a
 * screenshot and `dumpsys meminfo`. Evidence only: it never declares visual quality (human gate).
 * Requires the FactoryWorld DEBUG APK (diagnostics + run-as).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';
import { loadGameConfigFromSources } from '../../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { GAME_SESSION_DEV_GAME_VERSION } from '../../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import { CURRENT_SAVE_VERSION, createSaveTimestampUtcIsoFromUnixMilliseconds, serializeGameStateToSaveJson } from '../../assets/scripts/persistence/index.ts';
import { POPULATION_BENCHMARK_FILE, ROBOT_POPULATION_BENCHMARK_SIZES } from '../../assets/scripts/presentation/RobotPopulation.ts';
import { FIRST_ROBOT_PROGRESSION_FLAG_ID } from '../../assets/scripts/progression/TemporaryBoosts.ts';
import { createFreshGameState, type GameState } from '../../assets/scripts/state/index.ts';
import { REPO_ROOT } from './artifacts.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';

const economy = () => loadGameConfigFromSources(getEmbeddedEconomyConfigSources());

/** Worker Bot owned, Assembly Lv10, Robots Built far above the last anchor so the benchmark cap decides. */
export function buildBenchmarkSeededState(): GameState {
    const state = createFreshGameState();
    state.run.producers.fabricator = { level: 15, isUnlocked: true, isBuilt: true };
    state.run.purchasedBreakthroughIds = ['auto_feeder', 'worker_bot'];
    state.run.automation.fabricator = { isAutomated: true, isOfflineEligible: true, unlockedByBreakthroughId: 'auto_feeder' };
    state.run.producers.assembly_station = { level: 10, isUnlocked: true, isBuilt: true };
    state.run.progressionFlags[FIRST_ROBOT_PROGRESSION_FLAG_ID] = true;
    state.run.robotsBuilt = 1_000_000;
    state.run.statistics.robotsBuiltPeak = 1_000_000;
    state.lifetime.robotsBuilt = 1_000_000;
    return state;
}

export function buildBenchmarkSave(nowMs: number): string {
    return serializeGameStateToSaveJson(buildBenchmarkSeededState(), {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: economy().contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - 5_000),
    });
}

export interface BenchmarkSizeResult {
    readonly size: number;
    readonly ok: boolean;
    readonly reason: string | null;
    readonly population: ParsedDeviceEvent | null;
    readonly perf: readonly ParsedDeviceEvent[];
    readonly errors: number;
    readonly screenshot: string | null;
    readonly meminfo: string | null;
    readonly totalPssKb: number | null;
}

export function parseTotalPssKb(meminfo: string): number | null {
    const match = /TOTAL PSS:\s+(\d+)/i.exec(meminfo) ?? /^\s*TOTAL\s+(\d+)/m.exec(meminfo);
    return match ? Number(match[1]) : null;
}

export interface BenchmarkOptions {
    readonly packageName?: string;
    readonly activity?: string;
    readonly outDir?: string;
    readonly sizes?: readonly number[];
    readonly sceneReadyMs?: number;
    readonly perfMs?: number;
}

export async function runAut041Benchmark(driver: SessionDeviceDriver, options: BenchmarkOptions = {}): Promise<{ results: BenchmarkSizeResult[]; summaryPath: string }> {
    const packageName = options.packageName ?? 'com.projectautomata.androidbaseline';
    const activity = options.activity ?? 'com.cocos.game.AppActivity';
    const outDir = options.outDir ?? path.join(REPO_ROOT, 'temp', 'aut041', `benchmark-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`);
    mkdirSync(outDir, { recursive: true });
    const results: BenchmarkSizeResult[] = [];
    const sizes = options.sizes ?? ROBOT_POPULATION_BENCHMARK_SIZES;

    for (const size of sizes) {
        await driver.forceStop(packageName);
        const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
        await driver.removeAppFiles(packageName, SAVE_FILE_NAMES.map((name) => `${filesDir}${name}`));
        await driver.writeAppFile(packageName, `${filesDir}save_main.json`, buildBenchmarkSave(Date.now()));
        await driver.writeAppFile(packageName, `${filesDir}${POPULATION_BENCHMARK_FILE}`, JSON.stringify({ maxVisible: size }));
        await driver.logcatClear();
        const rawPath = path.join(outDir, `logcat-${size}.txt`);
        const stream = driver.startLogcat(rawPath);
        await driver.launch(packageName, activity);

        let reason: string | null = null;
        const population = await stream.waitFor((e) => e.evt === 'robot_population' && e.phase === 'synced', 0, options.sceneReadyMs ?? 60_000);
        if (!population) reason = 'no robot_population synced event';
        else if (population.event.visible !== size) reason = `visible ${String(population.event.visible)} != ${size}`;
        // Three 5 s windows after a 6 s warm-up, plus slack.
        const perfDeadline = Date.now() + (options.perfMs ?? 40_000);
        while (!reason && Date.now() < perfDeadline && stream.allEvents().filter((e) => e.evt === 'robot_perf').length < 3) {
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        const events = stream.allEvents();
        const perf = events.filter((e) => e.evt === 'robot_perf');
        if (!reason && perf.length < 3) reason = `only ${perf.length} robot_perf windows`;
        const errors = events.filter((e) => e.evt === 'error').length;
        let screenshot: string | null = null;
        let meminfo: string | null = null;
        try {
            screenshot = path.join(outDir, `robots-${size}.png`);
            writeFileSync(screenshot, await driver.screencap());
            meminfo = await driver.meminfo(packageName);
            writeFileSync(path.join(outDir, `meminfo-${size}.txt`), meminfo);
        } catch (error) {
            reason ??= `evidence capture failed: ${(error as Error).message}`;
        }
        await driver.stopLogcat();
        results.push({
            size,
            ok: reason === null && errors === 0,
            reason: reason ?? (errors > 0 ? `${errors} error events` : null),
            population: population?.event ?? null,
            perf,
            errors,
            screenshot: screenshot ? path.relative(REPO_ROOT, screenshot) : null,
            meminfo: meminfo ? path.relative(REPO_ROOT, path.join(outDir, `meminfo-${size}.txt`)) : null,
            totalPssKb: meminfo ? parseTotalPssKb(meminfo) : null,
        });
    }
    await driver.forceStop(packageName);

    const rows = results.map((r) => {
        const avg = r.perf.length ? r.perf.reduce((s, e) => s + Number(e.avgMs), 0) / r.perf.length : NaN;
        const p95 = r.perf.length ? Math.max(...r.perf.map((e) => Number(e.p95Ms))) : NaN;
        const max = r.perf.length ? Math.max(...r.perf.map((e) => Number(e.maxMs))) : NaN;
        const fps = r.perf.length ? r.perf.reduce((s, e) => s + Number(e.fps), 0) / r.perf.length : NaN;
        return `| ${r.size} | ${r.ok ? 'ok' : `FAIL: ${r.reason}`} | ${fps.toFixed(1)} | ${avg.toFixed(2)} | ${p95.toFixed(2)} | ${max.toFixed(2)} | ${r.totalPssKb === null ? 'n/a' : (r.totalPssKb / 1024).toFixed(0)} | ${r.errors} |`;
    });
    const summary = ['| robots | status | fps | avg ms | worst p95 ms | max ms | PSS MB | errors |', '|---:|---|---:|---:|---:|---:|---:|---:|', ...rows].join('\n');
    const summaryPath = path.join(outDir, 'summary.md');
    writeFileSync(summaryPath, `${summary}\n`);
    writeFileSync(path.join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
    return { results, summaryPath };
}
