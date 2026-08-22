export type PacingOutcome = 'PASS' | 'WARNING' | 'FAILURE';

export interface NumericWindow {
    readonly min: number;
    readonly max: number;
}

export interface PacingTargetWindows {
    readonly pass: NumericWindow;
    readonly warning: NumericWindow;
}

export interface PacingTargetMetric {
    readonly metricId: string;
    readonly checkpointId?: string;
}

export interface PacingTargetScope {
    readonly scenarioIds?: readonly string[];
    readonly strategyIds?: readonly string[];
}

export interface PacingTargetDefinition {
    readonly id: string;
    readonly description: string;
    readonly source: string;
    readonly metric: PacingTargetMetric;
    readonly scope: PacingTargetScope;
    readonly windows: PacingTargetWindows;
    readonly violationPolicy: Exclude<PacingOutcome, 'PASS'>;
}

export interface DeadZoneConfig {
    readonly enabled: boolean;
    readonly minDurationSeconds: number;
    readonly intentionalDecisionCadenceMultiplier: number;
    readonly policy: Exclude<PacingOutcome, 'PASS'>;
}

export interface PacingScenarioConfig {
    readonly scenarioId: string;
    readonly strategyId: string;
    readonly strategyConfig: Readonly<Record<string, unknown>>;
    readonly baselinePath: string;
}

export interface PacingTargetConfig {
    readonly schemaVersion: 1;
    readonly targetSetId: string;
    readonly contentVersion: string;
    readonly numericTolerance: number;
    readonly warningsBlockExit: boolean;
    readonly baselineDiffPolicy: PacingOutcome;
    readonly deadZone: DeadZoneConfig;
    readonly scenarios: readonly PacingScenarioConfig[];
    readonly targets: readonly PacingTargetDefinition[];
}

export interface PacingTargetDiagnostic {
    readonly code: string;
    readonly configPath: string;
    readonly message: string;
}

export class PacingTargetValidationError extends Error {
    readonly diagnostics: readonly PacingTargetDiagnostic[];

    constructor(diagnostics: readonly PacingTargetDiagnostic[]) {
        super(`Pacing target validation failed with ${diagnostics.length} diagnostic(s).`);
        this.name = 'PacingTargetValidationError';
        this.diagnostics = diagnostics;
    }
}

const PACING_SCHEMA_VERSION = 1;
const OUTCOMES: readonly PacingOutcome[] = ['PASS', 'WARNING', 'FAILURE'];
const VIOLATION_OUTCOMES: readonly Exclude<PacingOutcome, 'PASS'>[] = ['WARNING', 'FAILURE'];
const CHECKPOINT_METRICS = new Set([
    'checkpoint.time_seconds',
    'checkpoint.industrial_output',
    'checkpoint.production_per_second',
    'checkpoint.automated_production_per_second',
    'checkpoint.robots_built',
    'checkpoint.robots_built_per_second',
    'checkpoint.prestige_power',
    'checkpoint.projected_ai_core_reward',
]);
const FINAL_METRICS = new Set([
    'final.simulated_active_seconds',
    'final.industrial_output',
    'final.production_per_second',
    'final.automated_production_per_second',
    'final.robots_built',
    'final.robots_built_per_second',
    'final.prestige_power',
    'final.projected_ai_core_reward',
    'final.p0_prestige_power',
]);

export function parsePacingTargetConfig(value: unknown): PacingTargetConfig {
    const diagnostics: PacingTargetDiagnostic[] = [];
    const root = readObject(value, '$', diagnostics);
    if (root === undefined) {
        throw new PacingTargetValidationError(sortDiagnostics(diagnostics));
    }

    const schemaVersion = readNumber(root, 'schemaVersion', '$', diagnostics);
    const targetSetId = readNonEmptyString(root, 'targetSetId', '$', diagnostics);
    const contentVersion = readNonEmptyString(root, 'contentVersion', '$', diagnostics);
    const numericTolerance = readFiniteNumber(root, 'numericTolerance', '$', diagnostics);
    const warningsBlockExit = readBoolean(root, 'warningsBlockExit', '$', diagnostics);
    const baselineDiffPolicy = readOutcome(root, 'baselineDiffPolicy', '$', diagnostics);
    const deadZone = parseDeadZone(root.deadZone, '$.deadZone', diagnostics);
    const scenarios = parseScenarios(root.scenarios, '$.scenarios', diagnostics);
    const targets = parseTargets(root.targets, '$.targets', diagnostics);

    if (schemaVersion !== undefined && schemaVersion !== PACING_SCHEMA_VERSION) {
        diagnostics.push(makeDiagnostic('PACING_SCHEMA_VERSION', '$.schemaVersion', `Expected schemaVersion ${PACING_SCHEMA_VERSION}.`));
    }
    if (numericTolerance !== undefined && numericTolerance < 0) {
        diagnostics.push(makeDiagnostic('PACING_INVALID_NUMBER', '$.numericTolerance', 'numericTolerance must be greater than or equal to 0.'));
    }

    validateUniqueIds(scenarios.map((scenario) => scenario.scenarioId), '$.scenarios', 'scenarioId', diagnostics);
    validateUniqueIds(targets.map((target) => target.id), '$.targets', 'id', diagnostics);
    validateTargetScopes(scenarios, targets, diagnostics);

    if (diagnostics.length > 0 ||
        schemaVersion !== PACING_SCHEMA_VERSION ||
        targetSetId === undefined ||
        contentVersion === undefined ||
        numericTolerance === undefined ||
        warningsBlockExit === undefined ||
        baselineDiffPolicy === undefined ||
        deadZone === undefined ||
        scenarios === undefined ||
        targets === undefined) {
        throw new PacingTargetValidationError(sortDiagnostics(diagnostics));
    }

    return deepFreeze({
        schemaVersion: PACING_SCHEMA_VERSION,
        targetSetId,
        contentVersion,
        numericTolerance,
        warningsBlockExit,
        baselineDiffPolicy,
        deadZone,
        scenarios,
        targets,
    });
}

export function formatPacingTargetDiagnostic(diagnostic: PacingTargetDiagnostic): string {
    return `${diagnostic.code} ${diagnostic.configPath}: ${diagnostic.message}`;
}

export function isCheckpointMetric(metricId: string): boolean {
    return CHECKPOINT_METRICS.has(metricId);
}

export function isFinalMetric(metricId: string): boolean {
    return FINAL_METRICS.has(metricId);
}

function parseDeadZone(value: unknown, path: string, diagnostics: PacingTargetDiagnostic[]): DeadZoneConfig | undefined {
    const item = readObject(value, path, diagnostics);
    if (item === undefined) {
        return undefined;
    }

    const enabled = readBoolean(item, 'enabled', path, diagnostics);
    const minDurationSeconds = readFiniteNumber(item, 'minDurationSeconds', path, diagnostics);
    const intentionalDecisionCadenceMultiplier = readFiniteNumber(item, 'intentionalDecisionCadenceMultiplier', path, diagnostics);
    const policy = readViolationOutcome(item, 'policy', path, diagnostics);

    if (minDurationSeconds !== undefined && minDurationSeconds <= 0) {
        diagnostics.push(makeDiagnostic('PACING_INVALID_NUMBER', `${path}.minDurationSeconds`, 'minDurationSeconds must be greater than 0.'));
    }
    if (intentionalDecisionCadenceMultiplier !== undefined && intentionalDecisionCadenceMultiplier < 1) {
        diagnostics.push(makeDiagnostic('PACING_INVALID_NUMBER', `${path}.intentionalDecisionCadenceMultiplier`, 'intentionalDecisionCadenceMultiplier must be at least 1.'));
    }

    if (enabled === undefined || minDurationSeconds === undefined || intentionalDecisionCadenceMultiplier === undefined || policy === undefined) {
        return undefined;
    }

    return {
        enabled,
        minDurationSeconds,
        intentionalDecisionCadenceMultiplier,
        policy,
    };
}

function parseScenarios(value: unknown, path: string, diagnostics: PacingTargetDiagnostic[]): PacingScenarioConfig[] | undefined {
    if (!Array.isArray(value)) {
        diagnostics.push(makeDiagnostic('PACING_EXPECTED_ARRAY', path, 'scenarios must be an array.'));
        return undefined;
    }

    const scenarios: PacingScenarioConfig[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const itemPath = `${path}[${index}]`;
        const item = readObject(value[index], itemPath, diagnostics);
        if (item === undefined) {
            continue;
        }

        const scenarioId = readNonEmptyString(item, 'scenarioId', itemPath, diagnostics);
        const strategyId = readNonEmptyString(item, 'strategyId', itemPath, diagnostics);
        const strategyConfig = readObject(item.strategyConfig, `${itemPath}.strategyConfig`, diagnostics);
        const baselinePath = readNonEmptyString(item, 'baselinePath', itemPath, diagnostics);

        if (scenarioId !== undefined && strategyId !== undefined && strategyConfig !== undefined && baselinePath !== undefined) {
            scenarios.push({
                scenarioId,
                strategyId,
                strategyConfig,
                baselinePath,
            });
        }
    }

    return scenarios;
}

function parseTargets(value: unknown, path: string, diagnostics: PacingTargetDiagnostic[]): PacingTargetDefinition[] | undefined {
    if (!Array.isArray(value)) {
        diagnostics.push(makeDiagnostic('PACING_EXPECTED_ARRAY', path, 'targets must be an array.'));
        return undefined;
    }

    const targets: PacingTargetDefinition[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const itemPath = `${path}[${index}]`;
        const item = readObject(value[index], itemPath, diagnostics);
        if (item === undefined) {
            continue;
        }

        const id = readNonEmptyString(item, 'id', itemPath, diagnostics);
        const description = readNonEmptyString(item, 'description', itemPath, diagnostics);
        const source = readNonEmptyString(item, 'source', itemPath, diagnostics);
        const metric = parseMetric(item.metric, `${itemPath}.metric`, diagnostics);
        const scope = parseScope(item.scope, `${itemPath}.scope`, diagnostics);
        const windows = parseWindows(item.windows, `${itemPath}.windows`, diagnostics);
        const violationPolicy = readViolationOutcome(item, 'violationPolicy', itemPath, diagnostics);

        if (id !== undefined &&
            description !== undefined &&
            source !== undefined &&
            metric !== undefined &&
            scope !== undefined &&
            windows !== undefined &&
            violationPolicy !== undefined) {
            targets.push({
                id,
                description,
                source,
                metric,
                scope,
                windows,
                violationPolicy,
            });
        }
    }

    return targets;
}

function parseMetric(value: unknown, path: string, diagnostics: PacingTargetDiagnostic[]): PacingTargetMetric | undefined {
    const item = readObject(value, path, diagnostics);
    if (item === undefined) {
        return undefined;
    }

    const metricId = readNonEmptyString(item, 'metricId', path, diagnostics);
    const checkpointId = readOptionalNonEmptyString(item, 'checkpointId', path, diagnostics);

    if (metricId !== undefined) {
        if (!isCheckpointMetric(metricId) && !isFinalMetric(metricId)) {
            diagnostics.push(makeDiagnostic('PACING_UNKNOWN_METRIC', `${path}.metricId`, `Unsupported metricId "${metricId}".`));
        }
        if (isCheckpointMetric(metricId) && checkpointId === undefined) {
            diagnostics.push(makeDiagnostic('PACING_REQUIRED_FIELD', `${path}.checkpointId`, 'checkpointId is required for checkpoint metrics.'));
        }
        if (isFinalMetric(metricId) && checkpointId !== undefined) {
            diagnostics.push(makeDiagnostic('PACING_INVALID_SCOPE', `${path}.checkpointId`, 'checkpointId is only valid for checkpoint metrics.'));
        }
    }

    if (metricId === undefined) {
        return undefined;
    }

    return checkpointId === undefined ? { metricId } : { metricId, checkpointId };
}

function parseScope(value: unknown, path: string, diagnostics: PacingTargetDiagnostic[]): PacingTargetScope | undefined {
    const item = readObject(value, path, diagnostics);
    if (item === undefined) {
        return undefined;
    }

    const scenarioIds = readOptionalStringArray(item, 'scenarioIds', path, diagnostics);
    const strategyIds = readOptionalStringArray(item, 'strategyIds', path, diagnostics);
    if (scenarioIds === undefined || strategyIds === undefined) {
        return undefined;
    }
    if (scenarioIds.length === 0 && strategyIds.length === 0) {
        diagnostics.push(makeDiagnostic('PACING_EMPTY_SCOPE', path, 'At least one scenarioId or strategyId is required.'));
    }

    return {
        ...(scenarioIds.length > 0 ? { scenarioIds } : {}),
        ...(strategyIds.length > 0 ? { strategyIds } : {}),
    };
}

function parseWindows(value: unknown, path: string, diagnostics: PacingTargetDiagnostic[]): PacingTargetWindows | undefined {
    const item = readObject(value, path, diagnostics);
    if (item === undefined) {
        return undefined;
    }

    const pass = parseWindow(item.pass, `${path}.pass`, diagnostics);
    const warning = parseWindow(item.warning, `${path}.warning`, diagnostics);
    if (pass !== undefined && warning !== undefined) {
        if (pass.min < warning.min || pass.max > warning.max) {
            diagnostics.push(makeDiagnostic('PACING_INVALID_WINDOW', path, 'warning window must contain the pass window.'));
        }
    }

    if (pass === undefined || warning === undefined) {
        return undefined;
    }

    return { pass, warning };
}

function parseWindow(value: unknown, path: string, diagnostics: PacingTargetDiagnostic[]): NumericWindow | undefined {
    const item = readObject(value, path, diagnostics);
    if (item === undefined) {
        return undefined;
    }

    const min = readFiniteNumber(item, 'min', path, diagnostics);
    const max = readFiniteNumber(item, 'max', path, diagnostics);
    if (min !== undefined && min < 0) {
        diagnostics.push(makeDiagnostic('PACING_INVALID_NUMBER', `${path}.min`, 'min must be greater than or equal to 0.'));
    }
    if (max !== undefined && max < 0) {
        diagnostics.push(makeDiagnostic('PACING_INVALID_NUMBER', `${path}.max`, 'max must be greater than or equal to 0.'));
    }
    if (min !== undefined && max !== undefined && min > max) {
        diagnostics.push(makeDiagnostic('PACING_INVALID_WINDOW', path, 'window min must be less than or equal to max.'));
    }

    if (min === undefined || max === undefined) {
        return undefined;
    }

    return { min, max };
}

function validateTargetScopes(
    scenarios: PacingScenarioConfig[] | undefined,
    targets: PacingTargetDefinition[] | undefined,
    diagnostics: PacingTargetDiagnostic[],
): void {
    if (scenarios === undefined || targets === undefined) {
        return;
    }

    const scenarioIds = new Set(scenarios.map((scenario) => scenario.scenarioId));
    const strategyIds = new Set(scenarios.map((scenario) => scenario.strategyId));
    targets.forEach((target, targetIndex) => {
        target.scope.scenarioIds?.forEach((scenarioId, scenarioIndex) => {
            if (!scenarioIds.has(scenarioId)) {
                diagnostics.push(makeDiagnostic(
                    'PACING_UNKNOWN_SCENARIO',
                    `$.targets[${targetIndex}].scope.scenarioIds[${scenarioIndex}]`,
                    `Unknown scenarioId "${scenarioId}".`,
                ));
            }
        });
        target.scope.strategyIds?.forEach((strategyId, strategyIndex) => {
            if (!strategyIds.has(strategyId)) {
                diagnostics.push(makeDiagnostic(
                    'PACING_UNKNOWN_STRATEGY',
                    `$.targets[${targetIndex}].scope.strategyIds[${strategyIndex}]`,
                    `Unknown strategyId "${strategyId}".`,
                ));
            }
        });
    });
}

function validateUniqueIds(values: readonly string[], path: string, fieldName: string, diagnostics: PacingTargetDiagnostic[]): void {
    const seen = new Set<string>();
    values.forEach((value, index) => {
        if (seen.has(value)) {
            diagnostics.push(makeDiagnostic('PACING_DUPLICATE_ID', `${path}[${index}].${fieldName}`, `Duplicate ${fieldName} "${value}".`));
        }
        seen.add(value);
    });
}

function readObject(value: unknown, path: string, diagnostics: PacingTargetDiagnostic[]): Record<string, unknown> | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        diagnostics.push(makeDiagnostic('PACING_EXPECTED_OBJECT', path, 'Expected an object.'));
        return undefined;
    }
    return value as Record<string, unknown>;
}

function readNonEmptyString(value: Record<string, unknown>, fieldName: string, path: string, diagnostics: PacingTargetDiagnostic[]): string | undefined {
    if (!(fieldName in value)) {
        diagnostics.push(makeDiagnostic('PACING_REQUIRED_FIELD', `${path}.${fieldName}`, `${fieldName} is required.`));
        return undefined;
    }
    return readOptionalNonEmptyString(value, fieldName, path, diagnostics);
}

function readOptionalNonEmptyString(value: Record<string, unknown>, fieldName: string, path: string, diagnostics: PacingTargetDiagnostic[]): string | undefined {
    const fieldValue = value[fieldName];
    if (fieldValue === undefined) {
        return undefined;
    }
    if (typeof fieldValue !== 'string' || fieldValue.trim().length === 0) {
        diagnostics.push(makeDiagnostic('PACING_INVALID_TYPE', `${path}.${fieldName}`, `${fieldName} must be a non-empty string.`));
        return undefined;
    }
    return fieldValue;
}

function readFiniteNumber(value: Record<string, unknown>, fieldName: string, path: string, diagnostics: PacingTargetDiagnostic[]): number | undefined {
    if (!(fieldName in value)) {
        diagnostics.push(makeDiagnostic('PACING_REQUIRED_FIELD', `${path}.${fieldName}`, `${fieldName} is required.`));
        return undefined;
    }
    const fieldValue = value[fieldName];
    if (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue)) {
        diagnostics.push(makeDiagnostic('PACING_INVALID_TYPE', `${path}.${fieldName}`, `${fieldName} must be a finite number.`));
        return undefined;
    }
    return fieldValue;
}

function readNumber(value: Record<string, unknown>, fieldName: string, path: string, diagnostics: PacingTargetDiagnostic[]): number | undefined {
    return readFiniteNumber(value, fieldName, path, diagnostics);
}

function readBoolean(value: Record<string, unknown>, fieldName: string, path: string, diagnostics: PacingTargetDiagnostic[]): boolean | undefined {
    if (!(fieldName in value)) {
        diagnostics.push(makeDiagnostic('PACING_REQUIRED_FIELD', `${path}.${fieldName}`, `${fieldName} is required.`));
        return undefined;
    }
    const fieldValue = value[fieldName];
    if (typeof fieldValue !== 'boolean') {
        diagnostics.push(makeDiagnostic('PACING_INVALID_TYPE', `${path}.${fieldName}`, `${fieldName} must be a boolean.`));
        return undefined;
    }
    return fieldValue;
}

function readOutcome(value: Record<string, unknown>, fieldName: string, path: string, diagnostics: PacingTargetDiagnostic[]): PacingOutcome | undefined {
    const outcome = readNonEmptyString(value, fieldName, path, diagnostics);
    if (outcome === undefined) {
        return undefined;
    }
    if (!OUTCOMES.includes(outcome as PacingOutcome)) {
        diagnostics.push(makeDiagnostic('PACING_INVALID_OUTCOME', `${path}.${fieldName}`, `${fieldName} must be PASS, WARNING or FAILURE.`));
        return undefined;
    }
    return outcome as PacingOutcome;
}

function readViolationOutcome(value: Record<string, unknown>, fieldName: string, path: string, diagnostics: PacingTargetDiagnostic[]): Exclude<PacingOutcome, 'PASS'> | undefined {
    const outcome = readNonEmptyString(value, fieldName, path, diagnostics);
    if (outcome === undefined) {
        return undefined;
    }
    if (!VIOLATION_OUTCOMES.includes(outcome as Exclude<PacingOutcome, 'PASS'>)) {
        diagnostics.push(makeDiagnostic('PACING_INVALID_OUTCOME', `${path}.${fieldName}`, `${fieldName} must be WARNING or FAILURE.`));
        return undefined;
    }
    return outcome as Exclude<PacingOutcome, 'PASS'>;
}

function readOptionalStringArray(value: Record<string, unknown>, fieldName: string, path: string, diagnostics: PacingTargetDiagnostic[]): string[] | undefined {
    const fieldValue = value[fieldName];
    if (fieldValue === undefined) {
        return [];
    }
    if (!Array.isArray(fieldValue)) {
        diagnostics.push(makeDiagnostic('PACING_EXPECTED_ARRAY', `${path}.${fieldName}`, `${fieldName} must be an array.`));
        return undefined;
    }

    const result: string[] = [];
    for (let index = 0; index < fieldValue.length; index += 1) {
        const item = fieldValue[index];
        if (typeof item !== 'string' || item.trim().length === 0) {
            diagnostics.push(makeDiagnostic('PACING_INVALID_TYPE', `${path}.${fieldName}[${index}]`, `${fieldName} entries must be non-empty strings.`));
            continue;
        }
        result.push(item);
    }
    return result;
}

function makeDiagnostic(code: string, configPath: string, message: string): PacingTargetDiagnostic {
    return { code, configPath, message };
}

function sortDiagnostics(diagnostics: readonly PacingTargetDiagnostic[]): PacingTargetDiagnostic[] {
    return diagnostics.slice().sort((left, right) => {
        const pathCompare = left.configPath.localeCompare(right.configPath);
        return pathCompare !== 0 ? pathCompare : left.code.localeCompare(right.code);
    });
}

function deepFreeze<T>(value: T): T {
    if (Array.isArray(value)) {
        for (const item of value) {
            deepFreeze(item);
        }
        return Object.freeze(value.slice()) as T;
    }
    if (typeof value === 'object' && value !== null) {
        for (const item of Object.values(value)) {
            deepFreeze(item);
        }
        return Object.freeze(value);
    }
    return value;
}
