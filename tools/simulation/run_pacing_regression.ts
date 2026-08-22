import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ConfigValidationError,
    formatConfigDiagnostic,
    loadGameConfigFromSources,
    type ConfigFileSource,
} from '../../assets/scripts/config/ConfigLoader.ts';
import {
    PacingTargetValidationError,
    createCanonicalBaselineFromScenario,
    formatPacingTargetDiagnostic,
    parsePacingTargetConfig,
    runPacingRegression,
    shouldPacingRegressionExitNonZero,
    type CanonicalSimulationBaseline,
    type PacingRegressionReport,
    type PacingTargetConfig,
} from '../../assets/scripts/simulation/index.ts';

interface CliOptions {
    readonly dataRoot: string;
    readonly targetsPath: string;
    readonly outPath: string;
    readonly pretty: boolean;
    readonly updateBaselines: boolean;
    readonly failOnWarning: boolean;
}

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDirectory, '..', '..');

try {
    const options = parseArgs(process.argv.slice(2));
    const repository = loadGameConfigFromSources(await collectJsonSources(options.dataRoot));
    const targetConfig = parsePacingTargetConfig(JSON.parse(await readFile(options.targetsPath, 'utf8')));
    const baselines = await readBaselines(targetConfig);
    const report = runPacingRegression(repository, targetConfig, {
        baselinesByScenarioId: baselines,
    });

    await mkdir(path.dirname(options.outPath), { recursive: true });
    await writeFile(options.outPath, `${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`, 'utf8');

    if (options.updateBaselines) {
        await writeBaselines(repository, targetConfig, options.pretty);
    }

    printHumanSummary(report, path.relative(repoRoot, options.outPath).replace(/\\/g, '/'));

    if (report.status === 'FAILURE' || (options.failOnWarning && report.status === 'WARNING') || shouldPacingRegressionExitNonZero(report)) {
        process.exitCode = 1;
    }
}
catch (error) {
    if (error instanceof ConfigValidationError) {
        for (const diagnostic of error.diagnostics) {
            console.error(formatConfigDiagnostic(diagnostic));
        }
        process.exitCode = 1;
    }
    else if (error instanceof PacingTargetValidationError) {
        for (const diagnostic of error.diagnostics) {
            console.error(formatPacingTargetDiagnostic(diagnostic));
        }
        process.exitCode = 1;
    }
    else {
        console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
        process.exitCode = 1;
    }
}

function parseArgs(args: string[]): CliOptions {
    let dataRoot = path.join(repoRoot, 'data');
    let targetsPath = path.join(repoRoot, 'data', 'simulation', 'pacing_targets.json.sim');
    let outPath = path.join(repoRoot, 'temp', 'pacing_regression', 'latest_report.json');
    let pretty = false;
    let updateBaselines = false;
    let failOnWarning = false;

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--data-root') {
            dataRoot = path.resolve(readNextArg(args, ++index, arg));
            continue;
        }
        if (arg === '--targets') {
            targetsPath = path.resolve(readNextArg(args, ++index, arg));
            continue;
        }
        if (arg === '--out') {
            outPath = path.resolve(readNextArg(args, ++index, arg));
            continue;
        }
        if (arg === '--pretty') {
            pretty = true;
            continue;
        }
        if (arg === '--update-baselines') {
            updateBaselines = true;
            continue;
        }
        if (arg === '--fail-on-warning') {
            failOnWarning = true;
            continue;
        }
        if (arg === '--help') {
            printHelpAndExit();
        }
        throw new Error(`Unknown argument "${arg}".`);
    }

    return {
        dataRoot,
        targetsPath,
        outPath,
        pretty,
        updateBaselines,
        failOnWarning,
    };
}

async function collectJsonSources(directoryPath: string): Promise<ConfigFileSource[]> {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const nestedSources = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(directoryPath, entry.name);

        if (entry.isDirectory()) {
            return collectJsonSources(entryPath);
        }

        if (!entry.isFile() || !entry.name.endsWith('.json')) {
            return [];
        }

        return [{
            filePath: path.relative(repoRoot, entryPath).replace(/\\/g, '/'),
            text: await readFile(entryPath, 'utf8'),
        }];
    }));

    return nestedSources.flat().sort((left, right) => left.filePath.localeCompare(right.filePath));
}

async function readBaselines(config: PacingTargetConfig): Promise<Record<string, CanonicalSimulationBaseline>> {
    const baselines: Record<string, CanonicalSimulationBaseline> = {};

    for (const scenario of config.scenarios) {
        const baselinePath = path.resolve(repoRoot, scenario.baselinePath);
        try {
            baselines[scenario.scenarioId] = JSON.parse(await readFile(baselinePath, 'utf8')) as CanonicalSimulationBaseline;
        }
        catch (error) {
            if (typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                (error as { code?: string }).code === 'ENOENT') {
                continue;
            }
            throw error;
        }
    }

    return baselines;
}

async function writeBaselines(
    repository: Parameters<typeof createCanonicalBaselineFromScenario>[0],
    config: PacingTargetConfig,
    pretty: boolean,
): Promise<void> {
    for (const scenario of config.scenarios) {
        const baseline = createCanonicalBaselineFromScenario(repository, scenario);
        const baselinePath = path.resolve(repoRoot, scenario.baselinePath);
        await mkdir(path.dirname(baselinePath), { recursive: true });
        await writeFile(baselinePath, `${JSON.stringify(baseline, null, pretty ? 2 : 0)}\n`, 'utf8');
    }
}

function printHumanSummary(report: PacingRegressionReport, reportPath: string): void {
    console.log(`Pacing regression ${report.status}: ${report.targetSetId}`);
    console.log(`Report: ${reportPath}`);

    for (const scenario of report.scenarios) {
        console.log(`${scenario.status}: ${scenario.scenarioId} (${scenario.strategyId})`);
        for (const line of scenario.humanSummary) {
            console.log(`  ${line}`);
        }
    }
}

function readNextArg(args: readonly string[], index: number, flag: string): string {
    const value = args[index];
    if (value === undefined || value.startsWith('--')) {
        throw new Error(`${flag} requires a value.`);
    }
    return value;
}

function printHelpAndExit(): never {
    console.log([
        'Usage: node tools/simulation/run_pacing_regression.ts [options]',
        '',
        'Options:',
        '  --data-root <path>       Economy config root. Defaults to ./data.',
        '  --targets <path>         Pacing target JSON. Defaults to data/simulation/pacing_targets.json.sim.',
        '  --out <path>             Report JSON path. Defaults to temp/pacing_regression/latest_report.json.',
        '  --pretty                 Pretty-print written JSON.',
        '  --update-baselines       Rewrite canonical baseline artifacts explicitly.',
        '  --fail-on-warning        Return non-zero for WARNING reports.',
    ].join('\n'));
    process.exit(0);
}
