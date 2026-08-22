import { clonePlainData } from '../state/StateClone.ts';
import type { SaveDiagnostic } from './SaveEnvelope.ts';

export interface SaveMigrationStep {
    readonly sourceVersion: number;
    readonly targetVersion: number;
    readonly id: string;
    readonly migrate: (envelope: Record<string, unknown>) => unknown;
}

export interface SaveMigrationRegistry {
    readonly currentSaveVersion: number;
    readonly migrationsBySourceVersion: ReadonlyMap<number, SaveMigrationStep>;
}

export interface SaveMigrationApplication {
    readonly id: string;
    readonly sourceVersion: number;
    readonly targetVersion: number;
}

export interface SaveMigrationResult {
    readonly value: unknown;
    readonly diagnostics: readonly SaveDiagnostic[];
    readonly migrated: boolean;
    readonly sourceSaveVersion: number | undefined;
    readonly targetSaveVersion: number | undefined;
    readonly appliedMigrations: readonly SaveMigrationApplication[];
}

export function createSaveMigrationRegistry(
    currentSaveVersion: number,
    migrations: readonly SaveMigrationStep[],
): SaveMigrationRegistry {
    assertIntegerVersion(currentSaveVersion, 'currentSaveVersion');

    const migrationsBySourceVersion = new Map<number, SaveMigrationStep>();
    for (const migration of migrations) {
        assertIntegerVersion(migration.sourceVersion, `${migration.id}.sourceVersion`);
        assertIntegerVersion(migration.targetVersion, `${migration.id}.targetVersion`);
        if (migration.targetVersion !== migration.sourceVersion + 1) {
            throw new Error(`Save migration "${migration.id}" must target the immediately following saveVersion.`);
        }
        if (migration.sourceVersion >= currentSaveVersion || migration.targetVersion > currentSaveVersion) {
            throw new Error(`Save migration "${migration.id}" must stay below or reach current saveVersion ${currentSaveVersion}.`);
        }
        if (migrationsBySourceVersion.has(migration.sourceVersion)) {
            throw new Error(`Duplicate save migration source version ${migration.sourceVersion}.`);
        }

        migrationsBySourceVersion.set(migration.sourceVersion, Object.freeze({ ...migration }));
    }

    return Object.freeze({
        currentSaveVersion,
        migrationsBySourceVersion,
    });
}

export function migrateParsedSaveEnvelopeToCurrent(
    value: unknown,
    registry: SaveMigrationRegistry,
): SaveMigrationResult {
    if (!isPlainObject(value)) {
        return migrationResult(value, [], false, undefined, undefined, []);
    }

    const sourceSaveVersion = readSaveVersion(value);
    if (sourceSaveVersion === undefined) {
        return migrationResult(value, [], false, undefined, undefined, []);
    }

    if (sourceSaveVersion === registry.currentSaveVersion) {
        return migrationResult(value, [], false, sourceSaveVersion, sourceSaveVersion, []);
    }

    if (sourceSaveVersion > registry.currentSaveVersion) {
        return migrationResult(value, [
            diagnostic(
                'semantic',
                'SAVE_UNSUPPORTED_VERSION',
                '$.saveVersion',
                `saveVersion ${sourceSaveVersion} is newer than supported current saveVersion ${registry.currentSaveVersion}.`,
            ),
        ], false, sourceSaveVersion, undefined, []);
    }

    let working = clonePlainData(value);
    let workingVersion = sourceSaveVersion;
    const appliedMigrations: SaveMigrationApplication[] = [];

    while (workingVersion < registry.currentSaveVersion) {
        const migration = registry.migrationsBySourceVersion.get(workingVersion);
        if (migration === undefined) {
            return migrationResult(working, [
                diagnostic(
                    'migration',
                    'SAVE_UNSUPPORTED_LEGACY_VERSION',
                    '$.saveVersion',
                    `No complete migration path from saveVersion ${workingVersion} to ${registry.currentSaveVersion}.`,
                ),
            ], appliedMigrations.length > 0, sourceSaveVersion, workingVersion, appliedMigrations);
        }

        let nextValue: unknown;
        try {
            nextValue = migration.migrate(clonePlainData(working));
        }
        catch (error) {
            return migrationResult(working, [
                diagnostic(
                    'migration',
                    'SAVE_MIGRATION_FAILED',
                    '$',
                    `Save migration "${migration.id}" failed: ${messageFromUnknown(error)}`,
                ),
            ], true, sourceSaveVersion, workingVersion, appliedMigrations);
        }
        if (!isPlainObject(nextValue)) {
            return migrationResult(nextValue, [
                diagnostic(
                    'migration',
                    'SAVE_MIGRATION_INVALID_RESULT',
                    '$',
                    `Save migration "${migration.id}" must return an envelope object.`,
                ),
            ], true, sourceSaveVersion, undefined, appliedMigrations);
        }

        const targetSaveVersion = readSaveVersion(nextValue);
        if (targetSaveVersion !== migration.targetVersion) {
            return migrationResult(nextValue, [
                diagnostic(
                    'migration',
                    'SAVE_MIGRATION_INVALID_TARGET_VERSION',
                    '$.saveVersion',
                    `Save migration "${migration.id}" must set saveVersion ${migration.targetVersion}.`,
                ),
            ], true, sourceSaveVersion, targetSaveVersion, appliedMigrations);
        }

        appliedMigrations.push(Object.freeze({
            id: migration.id,
            sourceVersion: migration.sourceVersion,
            targetVersion: migration.targetVersion,
        }));
        working = clonePlainData(nextValue);
        workingVersion = targetSaveVersion;
    }

    return migrationResult(working, [], true, sourceSaveVersion, workingVersion, appliedMigrations);
}

function migrationResult(
    value: unknown,
    diagnostics: readonly SaveDiagnostic[],
    migrated: boolean,
    sourceSaveVersion: number | undefined,
    targetSaveVersion: number | undefined,
    appliedMigrations: readonly SaveMigrationApplication[],
): SaveMigrationResult {
    return Object.freeze({
        value,
        diagnostics: sortDiagnostics(diagnostics),
        migrated,
        sourceSaveVersion,
        targetSaveVersion,
        appliedMigrations: Object.freeze(appliedMigrations.slice()),
    });
}

function readSaveVersion(value: Record<string, unknown>): number | undefined {
    return Number.isInteger(value.saveVersion) ? value.saveVersion as number : undefined;
}

function assertIntegerVersion(value: number, path: string): void {
    if (!Number.isInteger(value)) {
        throw new Error(`${path} must be an integer saveVersion.`);
    }
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

function diagnostic(stage: SaveDiagnostic['stage'], code: string, path: string, message: string): SaveDiagnostic {
    return { stage, code, path, message };
}

function messageFromUnknown(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
