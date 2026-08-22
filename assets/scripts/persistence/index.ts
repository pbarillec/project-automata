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

export type {
    SaveDeserializeResult,
    SaveDiagnostic,
    SaveEnvelope,
    SaveEnvelopeMetadata,
    SaveIntegrityMetadata,
    SavePayload,
    SaveValidationStage,
} from './SaveEnvelope.ts';
