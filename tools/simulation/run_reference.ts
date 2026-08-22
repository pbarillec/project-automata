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
    runCivilizationOneActiveReferenceScenario,
    type ReferenceActiveScenarioOptions,
} from '../../assets/scripts/simulation/index.ts';

interface CliOptions extends ReferenceActiveScenarioOptions {
    readonly dataRoot: string;
    readonly outPath: string | null;
    readonly pretty: boolean;
}

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDirectory, '..', '..');

try {
    const options = parseArgs(process.argv.slice(2));
    const repository = loadGameConfigFromSources(await collectJsonSources(options.dataRoot));
    const result = runCivilizationOneActiveReferenceScenario(repository, options);
    const json = JSON.stringify(result.report, null, options.pretty ? 2 : 0);

    if (options.outPath !== null) {
        await mkdir(path.dirname(options.outPath), { recursive: true });
        await writeFile(options.outPath, `${json}\n`, 'utf8');
    }
    else {
        console.log(json);
    }
}
catch (error) {
    if (error instanceof ConfigValidationError) {
        for (const diagnostic of error.diagnostics) {
            console.error(formatConfigDiagnostic(diagnostic));
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
    let outPath: string | null = null;
    let pretty = false;
    let maxSimulatedSeconds: number | undefined;
    let maxPolicyIterations: number | undefined;
    let maxWaitStepSeconds: number | undefined;
    let manualActionSeconds: number | undefined;

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--data-root') {
            dataRoot = path.resolve(readNextArg(args, ++index, arg));
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
        if (arg === '--max-simulated-seconds') {
            maxSimulatedSeconds = readNumberArg(args, ++index, arg);
            continue;
        }
        if (arg === '--max-policy-iterations') {
            maxPolicyIterations = readNumberArg(args, ++index, arg);
            continue;
        }
        if (arg === '--max-wait-step-seconds') {
            maxWaitStepSeconds = readNumberArg(args, ++index, arg);
            continue;
        }
        if (arg === '--manual-action-seconds') {
            manualActionSeconds = readNumberArg(args, ++index, arg);
            continue;
        }
        if (arg === '--help') {
            printHelpAndExit();
        }
        throw new Error(`Unknown argument "${arg}".`);
    }

    return {
        dataRoot,
        outPath,
        pretty,
        maxSimulatedSeconds,
        maxPolicyIterations,
        maxWaitStepSeconds,
        manualActionSeconds,
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

function readNextArg(args: readonly string[], index: number, flag: string): string {
    const value = args[index];
    if (value === undefined || value.startsWith('--')) {
        throw new Error(`${flag} requires a value.`);
    }
    return value;
}

function readNumberArg(args: readonly string[], index: number, flag: string): number {
    const value = Number(readNextArg(args, index, flag));
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${flag} requires a positive finite number.`);
    }
    return value;
}

function printHelpAndExit(): never {
    console.log([
        'Usage: node tools/simulation/run_reference.ts [options]',
        '',
        'Options:',
        '  --data-root <path>                 Config root. Defaults to ./data.',
        '  --out <path>                      Write report JSON. Defaults to stdout.',
        '  --pretty                          Pretty-print JSON.',
        '  --max-simulated-seconds <number>  Scenario guard.',
        '  --max-policy-iterations <number>  Policy guard.',
        '  --max-wait-step-seconds <number>  Deterministic wait partition.',
        '  --manual-action-seconds <number>  Simulated seconds per manual command.',
    ].join('\n'));
    process.exit(0);
}
