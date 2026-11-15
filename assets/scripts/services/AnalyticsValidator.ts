import {
    ANALYTICS_EVENT_SCHEMAS,
    ANALYTICS_IDENTIFIER_PATTERN,
    ANALYTICS_MAX_STRING_LENGTH,
    isAnalyticsEventId,
    type AnalyticsParamSpec,
} from './AnalyticsEvents.ts';

export type AnalyticsIssueCode =
    | 'unknown_event'
    | 'missing_param'
    | 'unknown_param'
    | 'invalid_type'
    | 'invalid_value'
    | 'too_long'
    | 'out_of_range';

export interface AnalyticsValidationIssue {
    readonly code: AnalyticsIssueCode;
    readonly eventId: string;
    readonly param?: string;
    readonly detail?: string;
}

export interface AnalyticsValidationResult {
    readonly ok: boolean;
    readonly issues: readonly AnalyticsValidationIssue[];
}

/** Pure schema validation of one event (types, allowed values, length caps, ranges, unknown / missing params). Never throws. */
export function validateAnalyticsEvent(eventId: string, params: Readonly<Record<string, unknown>> | undefined): AnalyticsValidationResult {
    if (!isAnalyticsEventId(eventId)) return { ok: false, issues: [{ code: 'unknown_event', eventId }] };
    const schema = ANALYTICS_EVENT_SCHEMAS[eventId];
    const input = params ?? {};
    const issues: AnalyticsValidationIssue[] = [];
    for (const [name, spec] of Object.entries(schema.params)) {
        const value = input[name];
        if (value === undefined || value === null) {
            if (spec.required) issues.push({ code: 'missing_param', eventId, param: name });
            continue;
        }
        const issue = checkValue(eventId, name, spec, value);
        if (issue) issues.push(issue);
    }
    for (const name of Object.keys(input)) {
        if (!Object.prototype.hasOwnProperty.call(schema.params, name)) issues.push({ code: 'unknown_param', eventId, param: name });
    }
    return { ok: issues.length === 0, issues };
}

function checkValue(eventId: string, param: string, spec: AnalyticsParamSpec, value: unknown): AnalyticsValidationIssue | null {
    const fail = (code: AnalyticsIssueCode, detail?: string): AnalyticsValidationIssue => ({ code, eventId, param, ...(detail !== undefined ? { detail } : {}) });
    switch (spec.kind) {
        case 'boolean':
            return typeof value === 'boolean' ? null : fail('invalid_type', 'expected boolean');
        case 'integer':
            if (typeof value !== 'number' || !Number.isInteger(value)) return fail('invalid_type', 'expected integer');
            if ((spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max)) return fail('out_of_range');
            return null;
        case 'enum':
            if (typeof value !== 'string') return fail('invalid_type', 'expected string');
            if (value.length > ANALYTICS_MAX_STRING_LENGTH) return fail('too_long');
            return spec.values?.includes(value) ? null : fail('invalid_value');
        case 'identifier':
        case 'opaque_id':
            if (typeof value !== 'string') return fail('invalid_type', 'expected string');
            if (value.length === 0) return fail('invalid_value', 'empty');
            if (value.length > ANALYTICS_MAX_STRING_LENGTH) return fail('too_long');
            return ANALYTICS_IDENTIFIER_PATTERN.test(value) ? null : fail('invalid_value', 'charset');
        default:
            return fail('invalid_type');
    }
}
