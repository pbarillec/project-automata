/**
 * AUT-INFRA-001 machine-readable result contract (`aut-device-result/1`).
 * The JSON Schema in `schema/device_result.schema.json` is the single definition; this module
 * builds results and validates them against it (small dependency-free JSON Schema subset).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FAILURE_ROUTING, type AssertionFailure, type AssertionRecord, type FailureClass } from './classification.ts';

export const RESULT_SCHEMA_VERSION = 'aut-device-result/1';
export const RESULT_SCHEMA_PATH = fileURLToPath(new URL('./schema/device_result.schema.json', import.meta.url));

export type RunStatus = 'PASS' | 'FAIL' | 'BLOCKED';
export type ReviewDecision = 'PASS' | 'CHANGES_REQUESTED' | 'HUMAN_REVIEW_REQUIRED' | 'BLOCKED';

export interface DeviceInfo { serial: string; model: string | null; android_release: string | null; sdk: string | null }

export interface DeviceResult {
    schema_version: string;
    task_id: string;
    scenario_id: string;
    run_id: string;
    started_at: string;
    finished_at: string;
    apk: { path: string | null; sha256: string | null };
    device: DeviceInfo | null;
    status: RunStatus;
    review_decision: ReviewDecision;
    failure_class: FailureClass | null;
    first_failed_assertion: { id: string; step: string; evidence_lines: string[] } | null;
    expected: unknown;
    actual: unknown;
    next_owner: string | null;
    retry_without_code_change: boolean;
    required_human_action: string | null;
    assertions: AssertionRecord[];
    warnings: string[];
    steps?: Record<string, unknown>[];
    evidence: {
        run_dir: string; result: string; logcat: string | null; events: string | null; screenshots: string[];
        meminfo?: string | null; gfxinfo?: string | null; summary?: string | null;
    };
}

export interface BuildResultInput {
    taskId: string;
    scenarioId: string;
    runId: string;
    startedAt: string;
    finishedAt: string;
    apk: { path: string | null; sha256: string | null };
    device: DeviceInfo | null;
    failure: AssertionFailure | null;
    /** Set for environment blocks (no device, install failure...). */
    blocked?: { requiredHumanAction: string; nextOwner?: string } | null;
    assertions: AssertionRecord[];
    warnings: string[];
    steps?: Record<string, unknown>[];
    evidence: DeviceResult['evidence'];
}

/**
 * Status/decision mapping:
 * - no failure → PASS / PASS
 * - ENVIRONMENT → BLOCKED; a missing/unauthorized device is HUMAN_REVIEW_REQUIRED (the only human action is to connect it)
 * - any functional class → FAIL / CHANGES_REQUESTED routed to the class owner
 */
export function buildResult(input: BuildResultInput): DeviceResult {
    const failure = input.failure;
    let status: RunStatus = 'PASS';
    let decision: ReviewDecision = 'PASS';
    let nextOwner: string | null = null;
    let retry = false;
    let humanAction: string | null = null;
    if (failure) {
        const routing = FAILURE_ROUTING[failure.failureClass];
        retry = routing.retryWithoutCodeChange;
        nextOwner = routing.nextOwner;
        if (failure.failureClass === 'ENVIRONMENT') {
            status = 'BLOCKED';
            humanAction = input.blocked?.requiredHumanAction ?? null;
            nextOwner = input.blocked?.nextOwner ?? (humanAction ? 'human' : 'technical-lead');
            decision = humanAction === 'connect and authorize the Android device' ? 'HUMAN_REVIEW_REQUIRED' : 'BLOCKED';
        } else {
            status = 'FAIL';
            decision = 'CHANGES_REQUESTED';
        }
    }
    return {
        schema_version: RESULT_SCHEMA_VERSION,
        task_id: input.taskId,
        scenario_id: input.scenarioId,
        run_id: input.runId,
        started_at: input.startedAt,
        finished_at: input.finishedAt,
        apk: input.apk,
        device: input.device,
        status,
        review_decision: decision,
        failure_class: failure?.failureClass ?? null,
        first_failed_assertion: failure ? { id: failure.assertion, step: failure.step, evidence_lines: failure.evidenceLines } : null,
        expected: failure?.expected ?? null,
        actual: failure?.actual ?? null,
        next_owner: nextOwner,
        retry_without_code_change: retry,
        required_human_action: humanAction,
        assertions: input.assertions,
        warnings: input.warnings,
        steps: input.steps,
        evidence: input.evidence,
    };
}

type Schema = {
    type?: string | string[]; const?: unknown; enum?: unknown[]; required?: string[];
    properties?: Record<string, Schema>; items?: Schema; minLength?: number; pattern?: string;
};

function typeOf(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
    return typeof value;
}

/** Validates the subset of JSON Schema used by the result schema. Returns error paths (empty = valid). */
export function validateAgainstSchema(value: unknown, schema: Schema, at = '$'): string[] {
    const errors: string[] = [];
    if ('const' in schema && value !== schema.const) errors.push(`${at}: expected const ${JSON.stringify(schema.const)}`);
    if (schema.enum && !schema.enum.includes(value as never)) errors.push(`${at}: ${JSON.stringify(value)} not in enum`);
    if (schema.type) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type];
        const actual = typeOf(value);
        if (!types.includes(actual) && !(actual === 'integer' && types.includes('number'))) {
            errors.push(`${at}: expected ${types.join('|')}, got ${actual}`);
            return errors;
        }
    }
    if (typeof value === 'string') {
        if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
        if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: does not match ${schema.pattern}`);
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        for (const key of schema.required ?? []) if (!(key in record)) errors.push(`${at}.${key}: required`);
        for (const [key, child] of Object.entries(schema.properties ?? {})) {
            if (key in record) errors.push(...validateAgainstSchema(record[key], child, `${at}.${key}`));
        }
    }
    if (Array.isArray(value) && schema.items) value.forEach((item, i) => errors.push(...validateAgainstSchema(item, schema.items!, `${at}[${i}]`)));
    return errors;
}

let cachedSchema: Schema | null = null;
export function loadResultSchema(): Schema {
    cachedSchema ??= JSON.parse(readFileSync(RESULT_SCHEMA_PATH, 'utf8')) as Schema;
    return cachedSchema;
}

/** Schema validation plus the cross-field rules the schema cannot express. */
export function validateDeviceResult(result: unknown): string[] {
    const errors = validateAgainstSchema(result, loadResultSchema());
    if (errors.length > 0) return errors;
    const r = result as DeviceResult;
    if (r.status === 'PASS' && (r.failure_class !== null || r.first_failed_assertion !== null)) errors.push('$: PASS must not carry a failure');
    if (r.status !== 'PASS' && (r.failure_class === null || r.first_failed_assertion === null)) errors.push('$: FAIL/BLOCKED must carry failure_class and first_failed_assertion');
    if (r.status === 'BLOCKED' && r.failure_class !== 'ENVIRONMENT') errors.push('$: BLOCKED is reserved for ENVIRONMENT');
    if (r.status === 'FAIL' && r.failure_class === 'ENVIRONMENT') errors.push('$: ENVIRONMENT must be BLOCKED, not FAIL');
    if (r.status === 'PASS' && r.review_decision !== 'PASS') errors.push('$: PASS status requires PASS decision');
    if (r.status === 'FAIL' && r.review_decision !== 'CHANGES_REQUESTED') errors.push('$: FAIL status requires CHANGES_REQUESTED');
    if (r.retry_without_code_change && r.failure_class !== 'ENVIRONMENT') errors.push('$: only ENVIRONMENT may be retried without a code change');
    return errors;
}
