import type { GameState } from '../state/GameState.ts';
import { cloneGameState, clonePlainData } from '../state/StateClone.ts';
import { assertValidGameState } from '../state/StateValidation.ts';
import {
    createSaveMigrationRegistry,
    migrateParsedSaveEnvelopeToCurrent,
    type SaveMigrationRegistry,
    type SaveMigrationResult,
} from './SaveMigrations.ts';

export const CURRENT_SAVE_VERSION = 1;
export const SAVE_INTEGRITY_ALGORITHM = 'fnv1a32-payload-v1';
export const SAVE_TIMESTAMP_UTC_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const DEFAULT_SAVE_MIGRATION_REGISTRY = createSaveMigrationRegistry(CURRENT_SAVE_VERSION, []);

export interface SaveEnvelopeMetadata {
    readonly saveVersion: typeof CURRENT_SAVE_VERSION;
    readonly gameVersion: string;
    readonly contentVersion: string;
    readonly savedAtUtc: string;
}

export type SavePayload = GameState;

export interface SaveIntegrityMetadata {
    readonly algorithm: typeof SAVE_INTEGRITY_ALGORITHM;
    readonly payloadHash: string;
}

export interface SaveEnvelope {
    readonly saveVersion: typeof CURRENT_SAVE_VERSION;
    readonly gameVersion: string;
    readonly contentVersion: string;
    readonly savedAtUtc: string;
    readonly integrity: SaveIntegrityMetadata;
    readonly payload: SavePayload;
}

export type SaveValidationStage = 'parse' | 'structural' | 'semantic' | 'integrity' | 'payload' | 'migration';

export interface SaveDiagnostic {
    readonly stage: SaveValidationStage;
    readonly code: string;
    readonly path: string;
    readonly message: string;
}

export interface SaveDeserializeResult {
    readonly envelope: SaveEnvelope | undefined;
    readonly state: GameState | undefined;
    readonly diagnostics: readonly SaveDiagnostic[];
    readonly migration?: SaveMigrationResult;
}

export interface SaveDeserializeOptions {
    readonly migrations?: SaveMigrationRegistry;
}

export class SaveEnvelopeValidationError extends Error {
    readonly diagnostics: readonly SaveDiagnostic[];

    constructor(diagnostics: readonly SaveDiagnostic[]) {
        super(`SaveEnvelope validation failed with ${diagnostics.length} diagnostic(s).`);
        this.name = 'SaveEnvelopeValidationError';
        this.diagnostics = diagnostics;
    }
}

export function createSaveEnvelope(state: GameState, metadata: SaveEnvelopeMetadata): SaveEnvelope {
    const diagnostics: SaveDiagnostic[] = [];
    const metadataValue = metadata as unknown;
    if (!isPlainObject(metadataValue)) {
        diagnostics.push(diagnostic('structural', 'SAVE_METADATA_EXPECTED_OBJECT', '$', 'Save envelope metadata must be an object.'));
    }
    else {
        requireExactKeys('$', metadataValue, [
            'saveVersion',
            'gameVersion',
            'contentVersion',
            'savedAtUtc',
        ], diagnostics);
        diagnostics.push(...validateMetadata(metadataValue, '$'));
    }

    if (diagnostics.length > 0) {
        throw new SaveEnvelopeValidationError(sortDiagnostics(diagnostics));
    }

    const payload = cloneGameState(assertValidGameState(state));
    return deepFreeze({
        saveVersion: metadata.saveVersion,
        gameVersion: metadata.gameVersion,
        contentVersion: metadata.contentVersion,
        savedAtUtc: metadata.savedAtUtc,
        integrity: createIntegrityMetadata(payload),
        payload,
    });
}

export function serializeGameStateToSaveJson(state: GameState, metadata: SaveEnvelopeMetadata): string {
    return stringifyCanonicalJson(createSaveEnvelope(state, metadata));
}

export function deserializeGameStateFromSaveJson(text: string, options: SaveDeserializeOptions = {}): SaveDeserializeResult {
    const parsed = parseSaveJson(text);
    if (parsed.diagnostics.length > 0) {
        return {
            envelope: undefined,
            state: undefined,
            diagnostics: parsed.diagnostics,
        };
    }

    const migration = migrateParsedSaveEnvelopeToCurrent(
        parsed.value,
        options.migrations ?? DEFAULT_SAVE_MIGRATION_REGISTRY,
    );
    if (migration.diagnostics.length > 0) {
        return {
            envelope: undefined,
            state: undefined,
            diagnostics: migration.diagnostics,
            migration,
        };
    }

    const envelopeResult = validateSaveEnvelope(migration.value);
    if (envelopeResult.diagnostics.length > 0 || envelopeResult.envelope === undefined) {
        return {
            envelope: undefined,
            state: undefined,
            diagnostics: envelopeResult.diagnostics,
            migration,
        };
    }

    const envelope = clonePlainData(envelopeResult.envelope);
    const state = cloneGameState(envelopeResult.envelope.payload);

    return {
        envelope,
        state,
        diagnostics: [],
        migration,
    };
}

export function assertDeserializeGameStateFromSaveJson(
    text: string,
    options: SaveDeserializeOptions = {},
): SaveDeserializeResult & {
    readonly envelope: SaveEnvelope;
    readonly state: GameState;
} {
    const result = deserializeGameStateFromSaveJson(text, options);
    if (result.envelope === undefined || result.state === undefined) {
        throw new SaveEnvelopeValidationError(result.diagnostics);
    }

    return result as SaveDeserializeResult & {
        readonly envelope: SaveEnvelope;
        readonly state: GameState;
    };
}

export function validateSaveEnvelope(value: unknown): SaveDeserializeResult {
    const diagnostics: SaveDiagnostic[] = [];

    if (!isPlainObject(value)) {
        return invalid([diagnostic('structural', 'SAVE_EXPECTED_OBJECT', '$', 'SaveEnvelope must be an object.')]);
    }

    requireExactKeys('$', value, [
        'saveVersion',
        'gameVersion',
        'contentVersion',
        'savedAtUtc',
        'integrity',
        'payload',
    ], diagnostics);

    diagnostics.push(...validateMetadata(value, '$'));
    if ('integrity' in value) {
        validateIntegrityShape(value.integrity, '$.integrity', diagnostics);
    }

    const payloadResult = 'payload' in value
        ? validatePayload(value.payload)
        : {
            value: undefined,
            diagnostics: [],
        };
    diagnostics.push(...payloadResult.diagnostics);

    if (payloadResult.value !== undefined && isPlainObject(value.integrity)) {
        validateIntegrityValue(value.integrity, payloadResult.value, '$.integrity', diagnostics);
    }

    const sortedDiagnostics = sortDiagnostics(diagnostics);
    if (sortedDiagnostics.length > 0 || payloadResult.value === undefined) {
        return invalid(sortedDiagnostics);
    }

    const envelope = {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: value.gameVersion as string,
        contentVersion: value.contentVersion as string,
        savedAtUtc: value.savedAtUtc as string,
        integrity: {
            algorithm: SAVE_INTEGRITY_ALGORITHM,
            payloadHash: (value.integrity as SaveIntegrityMetadata).payloadHash,
        },
        payload: cloneGameState(payloadResult.value),
    };

    return {
        envelope: deepFreeze(envelope),
        state: cloneGameState(envelope.payload),
        diagnostics: [],
    };
}

export function createIntegrityMetadata(payload: SavePayload): SaveIntegrityMetadata {
    return {
        algorithm: SAVE_INTEGRITY_ALGORITHM,
        payloadHash: calculatePayloadHash(payload),
    };
}

export function createSaveTimestampUtcIsoFromUnixMilliseconds(unixMilliseconds: number): string {
    if (!Number.isInteger(unixMilliseconds)) {
        throw new SaveEnvelopeValidationError([
            diagnostic(
                'semantic',
                'SAVE_INVALID_TIMESTAMP',
                '$.savedAtUtc',
                'savedAtUtc milliseconds must be a finite integer Unix timestamp.',
            ),
        ]);
    }

    const date = new Date(unixMilliseconds);
    if (!Number.isFinite(date.getTime())) {
        throw new SaveEnvelopeValidationError([
            diagnostic(
                'semantic',
                'SAVE_INVALID_TIMESTAMP',
                '$.savedAtUtc',
                'savedAtUtc milliseconds must represent a valid UTC instant.',
            ),
        ]);
    }

    const value = date.toISOString();
    assertSaveTimestampUtcIsoString(value);
    return value;
}

export function parseSaveTimestampUtcIsoToUnixMilliseconds(value: unknown): number | undefined {
    if (!isSaveTimestampUtcIsoString(value)) {
        return undefined;
    }

    return new Date(value).getTime();
}

export function isSaveTimestampUtcIsoString(value: unknown): value is string {
    if (typeof value !== 'string' || !SAVE_TIMESTAMP_UTC_ISO_PATTERN.test(value)) {
        return false;
    }

    const parsedDate = new Date(value);
    return Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString() === value;
}

export function assertSaveTimestampUtcIsoString(value: unknown): string {
    const diagnostics: SaveDiagnostic[] = [];
    validateSavedAtUtc(value, '$.savedAtUtc', diagnostics);
    if (diagnostics.length > 0) {
        throw new SaveEnvelopeValidationError(sortDiagnostics(diagnostics));
    }

    return value as string;
}

export function calculatePayloadHash(payload: SavePayload): string {
    return fnv1a32Hex(stringifyCanonicalJson(payload));
}

export function stringifyCanonicalJson(value: unknown): string {
    return JSON.stringify(toCanonicalJsonValue(value));
}

function parseSaveJson(text: string): { readonly value: unknown; readonly diagnostics: readonly SaveDiagnostic[] } {
    if (typeof text !== 'string') {
        return {
            value: undefined,
            diagnostics: [diagnostic('parse', 'SAVE_JSON_TEXT_REQUIRED', '$', 'Save JSON input must be a string.')],
        };
    }

    try {
        return {
            value: JSON.parse(text),
            diagnostics: [],
        };
    }
    catch {
        return {
            value: undefined,
            diagnostics: [diagnostic('parse', 'SAVE_INVALID_JSON', '$', 'Malformed JSON.')],
        };
    }
}

function validateMetadata(value: Record<string, unknown>, path: string): SaveDiagnostic[] {
    const diagnostics: SaveDiagnostic[] = [];

    if ('saveVersion' in value && value.saveVersion !== CURRENT_SAVE_VERSION) {
        diagnostics.push(diagnostic(
            'semantic',
            'SAVE_UNSUPPORTED_VERSION',
            `${path}.saveVersion`,
            `Only saveVersion ${CURRENT_SAVE_VERSION} is supported.`,
        ));
    }

    if ('gameVersion' in value) {
        requireNonEmptyString(value.gameVersion, `${path}.gameVersion`, diagnostics);
    }

    if ('contentVersion' in value) {
        requireNonEmptyString(value.contentVersion, `${path}.contentVersion`, diagnostics);
    }

    if ('savedAtUtc' in value) {
        validateSavedAtUtc(value.savedAtUtc, `${path}.savedAtUtc`, diagnostics);
    }

    return diagnostics;
}

function validateSavedAtUtc(value: unknown, path: string, diagnostics: SaveDiagnostic[]): void {
    if (typeof value !== 'string') {
        diagnostics.push(diagnostic('structural', 'SAVE_INVALID_TIMESTAMP', path, 'savedAtUtc must be a UTC ISO-8601 string.'));
        return;
    }

    if (!SAVE_TIMESTAMP_UTC_ISO_PATTERN.test(value)) {
        diagnostics.push(diagnostic(
            'semantic',
            'SAVE_INVALID_TIMESTAMP',
            path,
            'savedAtUtc must use canonical UTC ISO-8601 format YYYY-MM-DDTHH:mm:ss.sssZ.',
        ));
        return;
    }

    if (!isSaveTimestampUtcIsoString(value)) {
        diagnostics.push(diagnostic(
            'semantic',
            'SAVE_INVALID_TIMESTAMP',
            path,
            'savedAtUtc must be a valid canonical UTC ISO-8601 instant.',
        ));
    }
}

function validateIntegrityShape(value: unknown, path: string, diagnostics: SaveDiagnostic[]): void {
    if (!isPlainObject(value)) {
        diagnostics.push(diagnostic('structural', 'SAVE_INTEGRITY_EXPECTED_OBJECT', path, 'integrity must be an object.'));
        return;
    }

    requireExactKeys(path, value, ['algorithm', 'payloadHash'], diagnostics);
    if (value.algorithm !== SAVE_INTEGRITY_ALGORITHM) {
        diagnostics.push(diagnostic(
            'semantic',
            'SAVE_UNSUPPORTED_INTEGRITY_ALGORITHM',
            `${path}.algorithm`,
            `Expected integrity algorithm "${SAVE_INTEGRITY_ALGORITHM}".`,
        ));
    }

    if (typeof value.payloadHash !== 'string' || !/^[0-9a-f]{8}$/.test(value.payloadHash)) {
        diagnostics.push(diagnostic(
            'structural',
            'SAVE_INVALID_PAYLOAD_HASH',
            `${path}.payloadHash`,
            'payloadHash must be an 8-character lowercase hexadecimal string.',
        ));
    }
}

function validatePayload(value: unknown): { readonly value: GameState | undefined; readonly diagnostics: readonly SaveDiagnostic[] } {
    try {
        return {
            value: cloneGameState(assertValidGameState(value)),
            diagnostics: [],
        };
    }
    catch (error) {
        if (error instanceof Error && 'diagnostics' in error && Array.isArray(error.diagnostics)) {
            return {
                value: undefined,
                diagnostics: error.diagnostics.map((stateDiagnostic: {
                    readonly stage: string;
                    readonly code: string;
                    readonly path: string;
                    readonly message: string;
                }) => diagnostic(
                    'payload',
                    stateDiagnostic.code,
                    stateDiagnostic.path.replace(/^\$/, '$.payload'),
                    stateDiagnostic.message,
                )),
            };
        }

        return {
            value: undefined,
            diagnostics: [diagnostic('payload', 'SAVE_INVALID_PAYLOAD', '$.payload', 'Payload failed GameState validation.')],
        };
    }
}

function validateIntegrityValue(
    integrity: Record<string, unknown>,
    payload: SavePayload,
    path: string,
    diagnostics: SaveDiagnostic[],
): void {
    if (integrity.algorithm !== SAVE_INTEGRITY_ALGORITHM || typeof integrity.payloadHash !== 'string') {
        return;
    }

    const expectedHash = calculatePayloadHash(payload);
    if (integrity.payloadHash !== expectedHash) {
        diagnostics.push(diagnostic(
            'integrity',
            'SAVE_PAYLOAD_HASH_MISMATCH',
            `${path}.payloadHash`,
            'payloadHash does not match the canonical payload JSON.',
        ));
    }
}

function requireExactKeys(
    path: string,
    value: Record<string, unknown>,
    keys: readonly string[],
    diagnostics: SaveDiagnostic[],
): void {
    const expected = new Set(keys);
    for (const key of keys) {
        if (!(key in value)) {
            diagnostics.push(diagnostic('structural', 'SAVE_REQUIRED_FIELD', `${path}.${key}`, `${key} is required.`));
        }
    }

    for (const key of Object.keys(value).sort()) {
        if (!expected.has(key)) {
            diagnostics.push(diagnostic('structural', 'SAVE_UNKNOWN_FIELD', `${path}.${escapePathKey(key)}`, `Unknown field "${key}".`));
        }
    }
}

function requireNonEmptyString(value: unknown, path: string, diagnostics: SaveDiagnostic[]): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
        diagnostics.push(diagnostic('structural', 'SAVE_INVALID_STRING', path, 'Expected a non-empty string.'));
    }
}

function invalid(diagnostics: readonly SaveDiagnostic[]): SaveDeserializeResult {
    return {
        envelope: undefined,
        state: undefined,
        diagnostics: sortDiagnostics(diagnostics),
    };
}

function sortDiagnostics(diagnostics: readonly SaveDiagnostic[]): SaveDiagnostic[] {
    return diagnostics.slice().sort((left, right) => {
        const pathCompare = left.path.localeCompare(right.path);
        if (pathCompare !== 0) {
            return pathCompare;
        }

        return left.code.localeCompare(right.code);
    });
}

function diagnostic(stage: SaveValidationStage, code: string, path: string, message: string): SaveDiagnostic {
    return {
        stage,
        code,
        path,
        message,
    };
}

function toCanonicalJsonValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => toCanonicalJsonValue(item));
    }

    if (isPlainObject(value)) {
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(value).sort()) {
            const child = toCanonicalJsonValue(value[key]);
            if (child !== undefined) {
                sorted[key] = child;
            }
        }
        return sorted;
    }

    return value;
}

function fnv1a32Hex(text: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    return hash.toString(16).padStart(8, '0');
}

function deepFreeze<T>(value: T): T {
    if (Array.isArray(value)) {
        for (const item of value) {
            deepFreeze(item);
        }
        return Object.freeze(value) as T;
    }

    if (isPlainObject(value)) {
        for (const item of Object.values(value)) {
            deepFreeze(item);
        }
        return Object.freeze(value);
    }

    return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function escapePathKey(key: string): string {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}
