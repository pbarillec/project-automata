export {
    AtomicSaveRepository,
} from './AtomicSaveRepository.ts';

export {
    CURRENT_SAVE_VERSION,
    SAVE_INTEGRITY_ALGORITHM,
    SAVE_TIMESTAMP_UTC_ISO_PATTERN,
    SaveEnvelopeValidationError,
    assertDeserializeGameStateFromSaveJson,
    calculatePayloadHash,
    createIntegrityMetadata,
    createSaveEnvelope,
    deserializeGameStateFromSaveJson,
    serializeGameStateToSaveJson,
    stringifyCanonicalJson,
    validateSaveEnvelope,
} from './SaveEnvelope.ts';

export {
    DEFAULT_DIRTY_SAVE_POLICY,
    DirtySaveTracker,
    shouldSaveDirtyState,
} from './DirtySaveScheduler.ts';

export {
    InMemorySaveStorage,
} from './InMemorySaveStorage.ts';

export {
    SAVE_BACKUP_NAME,
    SAVE_MAIN_NAME,
    SAVE_TEMP_NAME,
    SaveStorageError,
} from './SaveStorage.ts';

export type {
    AtomicSaveRepositoryOptions,
    LoadGameFailureResult,
    LoadGameFreshResult,
    LoadGameMainResult,
    LoadGameRecoveredBackupResult,
    LoadGameResult,
    RecoveryRewriteResult,
    RecoveryRewriteStatus,
    SaveFailureReason,
    SaveGameFailureResult,
    SaveGameResult,
    SaveGameSuccessResult,
    StoredInvalidSaveRead,
    StoredMissingSaveRead,
    StoredReadErrorSaveRead,
    StoredSaveReadResult,
    StoredSaveReadStatus,
    StoredSaveSource,
    StoredValidSaveRead,
} from './AtomicSaveRepository.ts';

export type {
    DirtySaveDecision,
    DirtySaveDecisionInput,
    DirtySaveDecisionReason,
    DirtySavePolicy,
    DirtySaveTrackerSnapshot,
} from './DirtySaveScheduler.ts';

export type {
    InMemorySaveStorageFailureMode,
    InMemorySaveStorageFailureRule,
    InMemorySaveStorageOperationRecord,
    SaveStorageOperation,
} from './InMemorySaveStorage.ts';

export type {
    LogicalSaveName,
    SaveStorage,
} from './SaveStorage.ts';

export type {
    SaveDeserializeResult,
    SaveDiagnostic,
    SaveEnvelope,
    SaveEnvelopeMetadata,
    SaveIntegrityMetadata,
    SavePayload,
    SaveValidationStage,
} from './SaveEnvelope.ts';
