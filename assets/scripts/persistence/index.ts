export {
    AtomicSaveRepository,
} from './AtomicSaveRepository.ts';

export {
    PersistenceCoordinator,
} from './PersistenceCoordinator.ts';

export {
    CURRENT_SAVE_VERSION,
    DEFAULT_SAVE_MIGRATION_REGISTRY,
    PRODUCTION_SAVE_MIGRATION_STEPS,
    SAVE_INTEGRITY_ALGORITHM,
    SAVE_MIGRATION_V1_TO_V2_ASSISTED_BATCHES,
    SAVE_TIMESTAMP_UTC_ISO_PATTERN,
    SaveEnvelopeValidationError,
    assertDeserializeGameStateFromSaveJson,
    assertSaveTimestampUtcIsoString,
    calculatePayloadHash,
    createIntegrityMetadata,
    createSaveEnvelope,
    createSaveTimestampUtcIsoFromUnixMilliseconds,
    deserializeGameStateFromSaveJson,
    isSaveTimestampUtcIsoString,
    parseSaveTimestampUtcIsoToUnixMilliseconds,
    serializeGameStateToSaveJson,
    stringifyCanonicalJson,
    validateSaveEnvelope,
} from './SaveEnvelope.ts';

export {
    createSaveMigrationRegistry,
    migrateParsedSaveEnvelopeToCurrent,
} from './SaveMigrations.ts';

export {
    DEFAULT_DIRTY_SAVE_POLICY,
    DirtySaveTracker,
    shouldSaveDirtyState,
} from './DirtySaveScheduler.ts';

export {
    InMemorySaveStorage,
} from './InMemorySaveStorage.ts';

export {
    FileSaveStorage,
} from './FileSaveStorage.ts';

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
    PersistenceCoordinatorOptions,
    PersistenceSaveCompletedResult,
    PersistenceSaveFailedResult,
    PersistenceSaveIntent,
    PersistenceSaveReason,
    PersistenceSaveRequest,
    PersistenceSaveResult,
    PersistenceSaveSkippedResult,
} from './PersistenceCoordinator.ts';

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
    FileSystemPort,
} from './FileSaveStorage.ts';

export type {
    LogicalSaveName,
    SaveStorage,
} from './SaveStorage.ts';

export type {
    SaveDeserializeResult,
    SaveDeserializeOptions,
    SaveDiagnostic,
    SaveEnvelope,
    SaveEnvelopeMetadata,
    SaveIntegrityMetadata,
    SavePayload,
    SaveValidationStage,
} from './SaveEnvelope.ts';

export type {
    SaveMigrationApplication,
    SaveMigrationRegistry,
    SaveMigrationResult,
    SaveMigrationStep,
} from './SaveMigrations.ts';
