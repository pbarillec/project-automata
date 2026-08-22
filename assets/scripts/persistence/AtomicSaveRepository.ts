import type { GameState } from '../state/GameState.ts';
import { cloneGameState } from '../state/StateClone.ts';
import { createFreshGameState } from '../state/StateFactory.ts';
import type {
    SaveDeserializeResult,
    SaveDiagnostic,
    SaveEnvelope,
    SaveEnvelopeMetadata,
} from './SaveEnvelope.ts';
import {
    deserializeGameStateFromSaveJson,
    serializeGameStateToSaveJson,
} from './SaveEnvelope.ts';
import {
    SAVE_BACKUP_NAME,
    SAVE_MAIN_NAME,
    SAVE_TEMP_NAME,
    type LogicalSaveName,
    type SaveStorage,
} from './SaveStorage.ts';

export type StoredSaveSource = 'main' | 'backup';

export type StoredSaveReadStatus =
    | 'valid'
    | 'missing'
    | 'invalid'
    | 'read_error';

export interface StoredValidSaveRead {
    readonly status: 'valid';
    readonly source: StoredSaveSource;
    readonly name: LogicalSaveName;
    readonly text: string;
    readonly envelope: SaveEnvelope;
    readonly state: GameState;
}

export interface StoredMissingSaveRead {
    readonly status: 'missing';
    readonly source: StoredSaveSource;
    readonly name: LogicalSaveName;
}

export interface StoredInvalidSaveRead {
    readonly status: 'invalid';
    readonly source: StoredSaveSource;
    readonly name: LogicalSaveName;
    readonly diagnostics: readonly SaveDiagnostic[];
}

export interface StoredReadErrorSaveRead {
    readonly status: 'read_error';
    readonly source: StoredSaveSource;
    readonly name: LogicalSaveName;
    readonly error: string;
}

export type StoredSaveReadResult =
    | StoredValidSaveRead
    | StoredMissingSaveRead
    | StoredInvalidSaveRead
    | StoredReadErrorSaveRead;

export type SaveFailureReason =
    | 'serialization_failed'
    | 'replacement_validation_failed'
    | 'temp_write_failed'
    | 'temp_verification_failed'
    | 'main_read_failed'
    | 'backup_rotation_failed'
    | 'main_promotion_failed';

export interface SaveGameSuccessResult {
    readonly ok: true;
    readonly status: 'saved';
    readonly wroteBackup: boolean;
}

export interface SaveGameFailureResult {
    readonly ok: false;
    readonly status: 'failed';
    readonly reason: SaveFailureReason;
    readonly message: string;
    readonly diagnostics?: readonly SaveDiagnostic[];
}

export type SaveGameResult = SaveGameSuccessResult | SaveGameFailureResult;

export type RecoveryRewriteStatus =
    | 'succeeded'
    | 'failed'
    | 'skipped_main_read_error';

export interface RecoveryRewriteResult {
    readonly status: RecoveryRewriteStatus;
    readonly reason?: SaveFailureReason;
    readonly message?: string;
}

export interface LoadGameMainResult {
    readonly ok: true;
    readonly status: 'loaded_main';
    readonly fresh: false;
    readonly source: 'main';
    readonly envelope: SaveEnvelope;
    readonly state: GameState;
    readonly main: StoredSaveReadResult;
}

export interface LoadGameRecoveredBackupResult {
    readonly ok: true;
    readonly status: 'recovered_backup';
    readonly fresh: false;
    readonly source: 'backup';
    readonly envelope: SaveEnvelope;
    readonly state: GameState;
    readonly main: StoredSaveReadResult;
    readonly backup: StoredValidSaveRead;
    readonly recovery: RecoveryRewriteResult;
}

export interface LoadGameFreshResult {
    readonly ok: true;
    readonly status: 'fresh_started';
    readonly fresh: true;
    readonly source: 'fresh';
    readonly state: GameState;
    readonly main: StoredSaveReadResult;
    readonly backup: StoredSaveReadResult;
}

export interface LoadGameFailureResult {
    readonly ok: false;
    readonly status: 'failed';
    readonly reason: 'main_read_failed' | 'backup_read_failed';
    readonly message: string;
    readonly main: StoredSaveReadResult;
    readonly backup?: StoredSaveReadResult;
}

export type LoadGameResult =
    | LoadGameMainResult
    | LoadGameRecoveredBackupResult
    | LoadGameFreshResult
    | LoadGameFailureResult;

export interface AtomicSaveRepositoryOptions {
    readonly createFreshState?: () => GameState;
}

export class AtomicSaveRepository {
    private readonly storage: SaveStorage;
    private readonly createFreshState: () => GameState;

    constructor(storage: SaveStorage, options: AtomicSaveRepositoryOptions = {}) {
        this.storage = storage;
        this.createFreshState = options.createFreshState ?? createFreshGameState;
    }

    async save(state: GameState, metadata: SaveEnvelopeMetadata): Promise<SaveGameResult> {
        let text: string;
        try {
            text = serializeGameStateToSaveJson(state, metadata);
        }
        catch (error) {
            return saveFailure('serialization_failed', messageFromUnknown(error), diagnosticsFromUnknown(error));
        }

        const replacementValidation = deserializeGameStateFromSaveJson(text);
        if (replacementValidation.envelope === undefined || replacementValidation.state === undefined) {
            return saveFailure(
                'replacement_validation_failed',
                'Replacement save payload failed validation.',
                replacementValidation.diagnostics,
            );
        }

        const tempResult = await this.writeAndVerifyTemp(text);
        if (!tempResult.ok) {
            return tempResult;
        }

        const currentMain = await this.readStoredSave(SAVE_MAIN_NAME, 'main');
        if (currentMain.status === 'read_error') {
            return saveFailure('main_read_failed', currentMain.error);
        }

        let wroteBackup = false;
        if (currentMain.status === 'valid') {
            try {
                await this.storage.copyText(SAVE_MAIN_NAME, SAVE_BACKUP_NAME);
                wroteBackup = true;
            }
            catch (error) {
                return saveFailure('backup_rotation_failed', messageFromUnknown(error));
            }
        }

        try {
            await this.storage.replaceText(SAVE_TEMP_NAME, SAVE_MAIN_NAME);
        }
        catch (error) {
            return saveFailure('main_promotion_failed', messageFromUnknown(error));
        }

        return Object.freeze({
            ok: true,
            status: 'saved',
            wroteBackup,
        });
    }

    async load(): Promise<LoadGameResult> {
        const main = await this.readStoredSave(SAVE_MAIN_NAME, 'main');
        if (main.status === 'valid') {
            return Object.freeze({
                ok: true,
                status: 'loaded_main',
                fresh: false,
                source: 'main',
                envelope: main.envelope,
                state: cloneGameState(main.state),
                main,
            });
        }

        const backup = await this.readStoredSave(SAVE_BACKUP_NAME, 'backup');
        if (backup.status === 'valid') {
            return Object.freeze({
                ok: true,
                status: 'recovered_backup',
                fresh: false,
                source: 'backup',
                envelope: backup.envelope,
                state: cloneGameState(backup.state),
                main,
                backup,
                recovery: await this.recoverBackupToMain(main, backup.text),
            });
        }

        if (main.status === 'read_error') {
            return Object.freeze({
                ok: false,
                status: 'failed',
                reason: 'main_read_failed',
                message: main.error,
                main,
                backup,
            });
        }

        if (backup.status === 'read_error') {
            return Object.freeze({
                ok: false,
                status: 'failed',
                reason: 'backup_read_failed',
                message: backup.error,
                main,
                backup,
            });
        }

        return Object.freeze({
            ok: true,
            status: 'fresh_started',
            fresh: true,
            source: 'fresh',
            state: cloneGameState(this.createFreshState()),
            main,
            backup,
        });
    }

    async inspectMain(): Promise<StoredSaveReadResult> {
        return this.readStoredSave(SAVE_MAIN_NAME, 'main');
    }

    async inspectBackup(): Promise<StoredSaveReadResult> {
        return this.readStoredSave(SAVE_BACKUP_NAME, 'backup');
    }

    private async recoverBackupToMain(
        main: StoredSaveReadResult,
        backupText: string,
    ): Promise<RecoveryRewriteResult> {
        if (main.status === 'read_error') {
            return Object.freeze({
                status: 'skipped_main_read_error',
                reason: 'main_read_failed',
                message: main.error,
            });
        }

        const tempResult = await this.writeAndVerifyTemp(backupText);
        if (!tempResult.ok) {
            return Object.freeze({
                status: 'failed',
                reason: tempResult.reason,
                message: tempResult.message,
            });
        }

        try {
            await this.storage.replaceText(SAVE_TEMP_NAME, SAVE_MAIN_NAME);
        }
        catch (error) {
            return Object.freeze({
                status: 'failed',
                reason: 'main_promotion_failed',
                message: messageFromUnknown(error),
            });
        }

        return Object.freeze({
            status: 'succeeded',
        });
    }

    private async writeAndVerifyTemp(text: string): Promise<{ readonly ok: true } | SaveGameFailureResult> {
        try {
            await this.storage.writeText(SAVE_TEMP_NAME, text);
        }
        catch (error) {
            return saveFailure('temp_write_failed', messageFromUnknown(error));
        }

        let verifiedText: string | undefined;
        try {
            verifiedText = await this.storage.readText(SAVE_TEMP_NAME);
        }
        catch (error) {
            return saveFailure('temp_verification_failed', messageFromUnknown(error));
        }

        if (verifiedText === undefined) {
            return saveFailure('temp_verification_failed', 'Temporary save was not readable after write.');
        }

        const verified = deserializeGameStateFromSaveJson(verifiedText);
        if (verified.envelope === undefined || verified.state === undefined) {
            return saveFailure('temp_verification_failed', 'Temporary save failed validation after write.', verified.diagnostics);
        }

        return Object.freeze({ ok: true });
    }

    private async readStoredSave(name: LogicalSaveName, source: StoredSaveSource): Promise<StoredSaveReadResult> {
        let text: string | undefined;
        try {
            text = await this.storage.readText(name);
        }
        catch (error) {
            return Object.freeze({
                status: 'read_error',
                source,
                name,
                error: messageFromUnknown(error),
            });
        }

        if (text === undefined) {
            return Object.freeze({
                status: 'missing',
                source,
                name,
            });
        }

        const result: SaveDeserializeResult = deserializeGameStateFromSaveJson(text);
        if (result.envelope === undefined || result.state === undefined) {
            return Object.freeze({
                status: 'invalid',
                source,
                name,
                diagnostics: result.diagnostics,
            });
        }

        return Object.freeze({
            status: 'valid',
            source,
            name,
            text,
            envelope: result.envelope,
            state: cloneGameState(result.state),
        });
    }
}

function saveFailure(
    reason: SaveFailureReason,
    message: string,
    diagnostics?: readonly SaveDiagnostic[],
): SaveGameFailureResult {
    return Object.freeze({
        ok: false,
        status: 'failed',
        reason,
        message,
        diagnostics,
    });
}

function diagnosticsFromUnknown(error: unknown): readonly SaveDiagnostic[] | undefined {
    if (typeof error === 'object' && error !== null && 'diagnostics' in error && Array.isArray(error.diagnostics)) {
        return error.diagnostics as readonly SaveDiagnostic[];
    }

    return undefined;
}

function messageFromUnknown(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
