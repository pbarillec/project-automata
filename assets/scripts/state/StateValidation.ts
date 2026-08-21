import type { GameState } from './GameState.ts';

export type StateValidationStage = 'structural' | 'semantic';

export interface StateDiagnostic {
    stage: StateValidationStage;
    code: string;
    path: string;
    message: string;
}

export interface StateValidationResult {
    value: GameState | undefined;
    diagnostics: StateDiagnostic[];
}

const DERIVED_AUTHORITATIVE_FIELDS = [
    'totalProductionPerSecond',
    'nextProducerCost',
    'milestoneMultipliers',
    'canAfford',
    'nextGoal',
    'visualTier',
    'effectiveTemporaryMultiplier',
];

export class StateValidationError extends Error {
    diagnostics: StateDiagnostic[];

    constructor(diagnostics: StateDiagnostic[]) {
        super(`GameState validation failed with ${diagnostics.length} diagnostic(s).`);
        this.name = 'StateValidationError';
        this.diagnostics = diagnostics;
    }
}

export function formatStateDiagnostic(diagnostic: StateDiagnostic): string {
    return `${diagnostic.stage} ${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`;
}

export function validateGameState(value: unknown): StateValidationResult {
    const diagnostics: StateDiagnostic[] = [];

    if (!isPlainObject(value)) {
        return {
            value: undefined,
            diagnostics: [diagnostic('structural', 'STATE_EXPECTED_OBJECT', '$', 'GameState must be an object.')],
        };
    }

    requireExactKeys('$', value, ['run', 'meta', 'boosts', 'monetization', 'settings', 'lifetime'], diagnostics);

    validateRunState(value.run, '$.run', diagnostics);
    validateMetaState(value.meta, '$.meta', diagnostics);
    validateBoostState(value.boosts, '$.boosts', diagnostics);
    validateMonetizationState(value.monetization, '$.monetization', diagnostics);
    validateSettingsState(value.settings, '$.settings', diagnostics);
    validateLifetimeState(value.lifetime, '$.lifetime', diagnostics);
    validateNoDerivedFields(value, '$', diagnostics);

    const sortedDiagnostics = sortDiagnostics(diagnostics);
    return {
        value: sortedDiagnostics.length === 0 ? value as GameState : undefined,
        diagnostics: sortedDiagnostics,
    };
}

export function assertValidGameState(value: unknown): GameState {
    const result = validateGameState(value);
    if (result.value === undefined) {
        throw new StateValidationError(result.diagnostics);
    }

    return result.value;
}

function validateRunState(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (!requirePlainObject(value, path, 'RunState', diagnostics)) {
        return;
    }

    requireExactKeys(path, value, [
        'industrialOutput',
        'producers',
        'automation',
        'purchasedBreakthroughIds',
        'currentEraId',
        'robotsBuilt',
        'statistics',
        'prestigePowerPeak',
        'progressionFlags',
    ], diagnostics);

    requireNonNegativeFiniteNumber(value.industrialOutput, `${path}.industrialOutput`, diagnostics);
    validateProducerRecords(value.producers, `${path}.producers`, diagnostics);
    validateAutomationRecords(value.automation, `${path}.automation`, diagnostics);
    validateStringArray(value.purchasedBreakthroughIds, `${path}.purchasedBreakthroughIds`, diagnostics);
    validateNullableString(value.currentEraId, `${path}.currentEraId`, diagnostics);
    requireNonNegativeFiniteNumber(value.robotsBuilt, `${path}.robotsBuilt`, diagnostics);
    validateRunStatistics(value.statistics, `${path}.statistics`, diagnostics);
    requireNonNegativeFiniteNumber(value.prestigePowerPeak, `${path}.prestigePowerPeak`, diagnostics);
    validateBooleanRecord(value.progressionFlags, `${path}.progressionFlags`, diagnostics);
}

function validateProducerRecords(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (!requireRecord(value, path, diagnostics)) {
        return;
    }

    for (const key of sortedKeys(value)) {
        const producer = value[key];
        const itemPath = `${path}.${escapePathKey(key)}`;
        validateStateKey(key, itemPath, diagnostics);
        if (!requirePlainObject(producer, itemPath, 'ProducerRunState', diagnostics)) {
            continue;
        }
        requireExactKeys(itemPath, producer, ['level', 'isUnlocked', 'isBuilt'], diagnostics);
        requireNonNegativeInteger(producer.level, `${itemPath}.level`, diagnostics);
        requireBoolean(producer.isUnlocked, `${itemPath}.isUnlocked`, diagnostics);
        requireBoolean(producer.isBuilt, `${itemPath}.isBuilt`, diagnostics);
    }
}

function validateAutomationRecords(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (!requireRecord(value, path, diagnostics)) {
        return;
    }

    for (const key of sortedKeys(value)) {
        const automation = value[key];
        const itemPath = `${path}.${escapePathKey(key)}`;
        validateStateKey(key, itemPath, diagnostics);
        if (!requirePlainObject(automation, itemPath, 'AutomationRunState', diagnostics)) {
            continue;
        }
        requireExactKeys(itemPath, automation, ['isAutomated', 'unlockedByBreakthroughId'], diagnostics);
        requireBoolean(automation.isAutomated, `${itemPath}.isAutomated`, diagnostics);
        validateNullableString(automation.unlockedByBreakthroughId, `${itemPath}.unlockedByBreakthroughId`, diagnostics);
    }
}

function validateRunStatistics(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (!requirePlainObject(value, path, 'RunStatisticsState', diagnostics)) {
        return;
    }

    const keys = [
        'industrialOutputEarned',
        'industrialOutputSpent',
        'manualProductionActions',
        'producerLevelsPurchased',
        'breakthroughsPurchased',
        'robotsBuiltPeak',
    ];
    requireExactKeys(path, value, keys, diagnostics);
    for (const key of keys) {
        requireNonNegativeFiniteNumber(value[key], `${path}.${key}`, diagnostics);
    }
}

function validateMetaState(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (!requirePlainObject(value, path, 'MetaState', diagnostics)) {
        return;
    }

    requireExactKeys(path, value, [
        'civilizationNumber',
        'aiCores',
        'lifetimeAiCoresEarned',
        'permanentUpgradeRanks',
        'accountFeatureUnlocks',
        'durableEntitlements',
        'cosmeticOwnership',
    ], diagnostics);

    requirePositiveInteger(value.civilizationNumber, `${path}.civilizationNumber`, diagnostics);
    requireNonNegativeFiniteNumber(value.aiCores, `${path}.aiCores`, diagnostics);
    requireNonNegativeFiniteNumber(value.lifetimeAiCoresEarned, `${path}.lifetimeAiCoresEarned`, diagnostics);
    validateNumberRecord(value.permanentUpgradeRanks, `${path}.permanentUpgradeRanks`, diagnostics, true);
    validateBooleanRecord(value.accountFeatureUnlocks, `${path}.accountFeatureUnlocks`, diagnostics);
    validateDurableEntitlementRecord(value.durableEntitlements, `${path}.durableEntitlements`, diagnostics);
    validateBooleanRecord(value.cosmeticOwnership, `${path}.cosmeticOwnership`, diagnostics);
}

function validateDurableEntitlementRecord(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (!requireRecord(value, path, diagnostics)) {
        return;
    }

    for (const key of sortedKeys(value)) {
        const entitlement = value[key];
        const itemPath = `${path}.${escapePathKey(key)}`;
        validateStateKey(key, itemPath, diagnostics);
        if (!requirePlainObject(entitlement, itemPath, 'DurableEntitlementState', diagnostics)) {
            continue;
        }
        requireExactKeys(itemPath, entitlement, ['owned', 'source', 'lastKnownValidUtcMs'], diagnostics);
        requireBoolean(entitlement.owned, `${itemPath}.owned`, diagnostics);
        requireString(entitlement.source, `${itemPath}.source`, diagnostics);
        validateNullableNonNegativeFiniteNumber(entitlement.lastKnownValidUtcMs, `${itemPath}.lastKnownValidUtcMs`, diagnostics);
    }
}

function validateBoostState(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (!requirePlainObject(value, path, 'BoostState', diagnostics)) {
        return;
    }

    requireExactKeys(path, value, ['activeBoosts', 'cooldowns', 'consumedCharges'], diagnostics);
    validateActiveBoostRecord(value.activeBoosts, `${path}.activeBoosts`, diagnostics);
    validateCooldownRecord(value.cooldowns, `${path}.cooldowns`, diagnostics);
    validateNumberRecord(value.consumedCharges, `${path}.consumedCharges`, diagnostics, true);
}

function validateActiveBoostRecord(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (!requireRecord(value, path, diagnostics)) {
        return;
    }

    for (const key of sortedKeys(value)) {
        const boost = value[key];
        const itemPath = `${path}.${escapePathKey(key)}`;
        validateStateKey(key, itemPath, diagnostics);
        if (!requirePlainObject(boost, itemPath, 'ActiveBoostState', diagnostics)) {
            continue;
        }
        requireExactKeys(itemPath, boost, ['boostId', 'remainingSeconds', 'source', 'requestId'], diagnostics);
        requireString(boost.boostId, `${itemPath}.boostId`, diagnostics);
        requireNonNegativeFiniteNumber(boost.remainingSeconds, `${itemPath}.remainingSeconds`, diagnostics);
        requireString(boost.source, `${itemPath}.source`, diagnostics);
        validateNullableString(boost.requestId, `${itemPath}.requestId`, diagnostics);
    }
}

function validateCooldownRecord(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (!requireRecord(value, path, diagnostics)) {
        return;
    }

    for (const key of sortedKeys(value)) {
        const cooldown = value[key];
        const itemPath = `${path}.${escapePathKey(key)}`;
        validateStateKey(key, itemPath, diagnostics);
        if (!requirePlainObject(cooldown, itemPath, 'BoostCooldownState', diagnostics)) {
            continue;
        }
        requireExactKeys(itemPath, cooldown, ['remainingSeconds'], diagnostics);
        requireNonNegativeFiniteNumber(cooldown.remainingSeconds, `${itemPath}.remainingSeconds`, diagnostics);
    }
}

function validateMonetizationState(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (!requirePlainObject(value, path, 'MonetizationState', diagnostics)) {
        return;
    }

    requireExactKeys(path, value, ['rewardedClaims', 'pendingAdRequests', 'pendingPurchaseRequests', 'productMetadataCache'], diagnostics);
    validateRewardedClaimRecord(value.rewardedClaims, `${path}.rewardedClaims`, diagnostics);
    validatePendingRequestRecord(value.pendingAdRequests, `${path}.pendingAdRequests`, diagnostics);
    validatePendingRequestRecord(value.pendingPurchaseRequests, `${path}.pendingPurchaseRequests`, diagnostics);
    validateProductMetadataRecord(value.productMetadataCache, `${path}.productMetadataCache`, diagnostics);
}

function validateRewardedClaimRecord(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (!requireRecord(value, path, diagnostics)) {
        return;
    }

    for (const key of sortedKeys(value)) {
        const claim = value[key];
        const itemPath = `${path}.${escapePathKey(key)}`;
        validateStateKey(key, itemPath, diagnostics);
        if (!requirePlainObject(claim, itemPath, 'RewardedClaimState', diagnostics)) {
            continue;
        }
        requireExactKeys(itemPath, claim, ['placementId', 'claimCount', 'lastClaimUtcMs'], diagnostics);
        requireString(claim.placementId, `${itemPath}.placementId`, diagnostics);
        requireNonNegativeInteger(claim.claimCount, `${itemPath}.claimCount`, diagnostics);
        validateNullableNonNegativeFiniteNumber(claim.lastClaimUtcMs, `${itemPath}.lastClaimUtcMs`, diagnostics);
    }
}

function validatePendingRequestRecord(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (!requireRecord(value, path, diagnostics)) {
        return;
    }

    for (const key of sortedKeys(value)) {
        const request = value[key];
        const itemPath = `${path}.${escapePathKey(key)}`;
        validateStateKey(key, itemPath, diagnostics);
        if (!requirePlainObject(request, itemPath, 'PendingMonetizationRequestState', diagnostics)) {
            continue;
        }
        requireExactKeys(itemPath, request, ['requestId', 'createdUtcMs'], diagnostics);
        requireString(request.requestId, `${itemPath}.requestId`, diagnostics);
        requireNonNegativeFiniteNumber(request.createdUtcMs, `${itemPath}.createdUtcMs`, diagnostics);
    }
}

function validateProductMetadataRecord(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (!requireRecord(value, path, diagnostics)) {
        return;
    }

    for (const key of sortedKeys(value)) {
        const metadata = value[key];
        const itemPath = `${path}.${escapePathKey(key)}`;
        validateStateKey(key, itemPath, diagnostics);
        if (!requirePlainObject(metadata, itemPath, 'ProductMetadataCacheState', diagnostics)) {
            continue;
        }
        requireExactKeys(itemPath, metadata, ['productId', 'localizedPrice', 'updatedUtcMs'], diagnostics);
        requireString(metadata.productId, `${itemPath}.productId`, diagnostics);
        requireString(metadata.localizedPrice, `${itemPath}.localizedPrice`, diagnostics);
        requireNonNegativeFiniteNumber(metadata.updatedUtcMs, `${itemPath}.updatedUtcMs`, diagnostics);
    }
}

function validateSettingsState(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (!requirePlainObject(value, path, 'SettingsState', diagnostics)) {
        return;
    }

    requireExactKeys(path, value, ['musicVolume', 'sfxVolume', 'vibrationEnabled', 'languageCode', 'reducedMotion'], diagnostics);
    requireUnitNumber(value.musicVolume, `${path}.musicVolume`, diagnostics);
    requireUnitNumber(value.sfxVolume, `${path}.sfxVolume`, diagnostics);
    requireBoolean(value.vibrationEnabled, `${path}.vibrationEnabled`, diagnostics);
    validateNullableString(value.languageCode, `${path}.languageCode`, diagnostics);
    requireBoolean(value.reducedMotion, `${path}.reducedMotion`, diagnostics);
}

function validateLifetimeState(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (!requirePlainObject(value, path, 'LifetimeState', diagnostics)) {
        return;
    }

    const keys = [
        'industrialOutputEarned',
        'manualProductionActions',
        'producerLevelsPurchased',
        'breakthroughsPurchased',
        'robotsBuilt',
        'rebootsCompleted',
        'highestCivilizationReached',
    ];

    requireExactKeys(path, value, keys, diagnostics);
    for (const key of keys) {
        if (key === 'highestCivilizationReached') {
            requirePositiveInteger(value[key], `${path}.${key}`, diagnostics);
        } else if (key === 'rebootsCompleted' || key.endsWith('Purchased') || key === 'manualProductionActions') {
            requireNonNegativeInteger(value[key], `${path}.${key}`, diagnostics);
        } else {
            requireNonNegativeFiniteNumber(value[key], `${path}.${key}`, diagnostics);
        }
    }
}

function validateNoDerivedFields(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (!isPlainObject(value)) {
        return;
    }

    for (const key of Object.keys(value).sort()) {
        const childPath = `${path}.${escapePathKey(key)}`;
        if (DERIVED_AUTHORITATIVE_FIELDS.includes(key)) {
            diagnostics.push(diagnostic(
                'semantic',
                'STATE_DERIVED_FIELD',
                childPath,
                `Derived field "${key}" must not be stored as authoritative GameState.`,
            ));
        }

        validateNoDerivedFields(value[key], childPath, diagnostics);
    }
}

function requireExactKeys(path: string, value: Record<string, unknown>, keys: string[], diagnostics: StateDiagnostic[]): void {
    const expected = new Set(keys);
    for (const key of keys) {
        if (!(key in value)) {
            diagnostics.push(diagnostic('structural', 'STATE_REQUIRED_FIELD', `${path}.${key}`, `${key} is required.`));
        }
    }

    for (const key of Object.keys(value).sort()) {
        if (!expected.has(key)) {
            diagnostics.push(diagnostic('structural', 'STATE_UNKNOWN_FIELD', `${path}.${escapePathKey(key)}`, `Unknown field "${key}".`));
        }
    }
}

function requirePlainObject(value: unknown, path: string, name: string, diagnostics: StateDiagnostic[]): value is Record<string, unknown> {
    if (!isPlainObject(value)) {
        diagnostics.push(diagnostic('structural', 'STATE_EXPECTED_OBJECT', path, `${name} must be an object.`));
        return false;
    }

    return true;
}

function requireRecord(value: unknown, path: string, diagnostics: StateDiagnostic[]): value is Record<string, unknown> {
    if (!isPlainObject(value)) {
        diagnostics.push(diagnostic('structural', 'STATE_EXPECTED_RECORD', path, 'Expected a plain object record.'));
        return false;
    }

    return true;
}

function validateStringArray(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (!Array.isArray(value)) {
        diagnostics.push(diagnostic('structural', 'STATE_EXPECTED_ARRAY', path, 'Expected an array.'));
        return;
    }

    const seen = new Set<string>();
    value.forEach((item, index) => {
        const itemPath = `${path}[${index}]`;
        if (typeof item !== 'string' || item.trim().length === 0) {
            diagnostics.push(diagnostic('structural', 'STATE_INVALID_ID', itemPath, 'IDs must be non-empty strings.'));
            return;
        }
        if (seen.has(item)) {
            diagnostics.push(diagnostic('semantic', 'STATE_DUPLICATE_ID', itemPath, `Duplicate ID "${item}".`));
        }
        seen.add(item);
    });
}

function validateBooleanRecord(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (!requireRecord(value, path, diagnostics)) {
        return;
    }

    for (const key of sortedKeys(value)) {
        validateStateKey(key, `${path}.${escapePathKey(key)}`, diagnostics);
        requireBoolean(value[key], `${path}.${escapePathKey(key)}`, diagnostics);
    }
}

function validateNumberRecord(value: unknown, path: string, diagnostics: StateDiagnostic[], integer: boolean): void {
    if (!requireRecord(value, path, diagnostics)) {
        return;
    }

    for (const key of sortedKeys(value)) {
        const itemPath = `${path}.${escapePathKey(key)}`;
        validateStateKey(key, itemPath, diagnostics);
        if (integer) {
            requireNonNegativeInteger(value[key], itemPath, diagnostics);
        } else {
            requireNonNegativeFiniteNumber(value[key], itemPath, diagnostics);
        }
    }
}

function validateNullableString(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (value === null) {
        return;
    }

    requireString(value, path, diagnostics);
}

function validateNullableNonNegativeFiniteNumber(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (value === null) {
        return;
    }

    requireNonNegativeFiniteNumber(value, path, diagnostics);
}

function requireString(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
        diagnostics.push(diagnostic('structural', 'STATE_INVALID_STRING', path, 'Expected a non-empty string.'));
    }
}

function requireBoolean(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (typeof value !== 'boolean') {
        diagnostics.push(diagnostic('structural', 'STATE_INVALID_BOOLEAN', path, 'Expected a boolean.'));
    }
}

function requirePositiveInteger(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        diagnostics.push(diagnostic('semantic', 'STATE_INVALID_POSITIVE_INTEGER', path, 'Expected a positive integer.'));
    }
}

function requireNonNegativeInteger(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        diagnostics.push(diagnostic('semantic', 'STATE_INVALID_NON_NEGATIVE_INTEGER', path, 'Expected a non-negative integer.'));
    }
}

function requireNonNegativeFiniteNumber(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        diagnostics.push(diagnostic('semantic', 'STATE_INVALID_NON_NEGATIVE_NUMBER', path, 'Expected a finite non-negative number.'));
    }
}

function requireUnitNumber(value: unknown, path: string, diagnostics: StateDiagnostic[]): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        diagnostics.push(diagnostic('semantic', 'STATE_INVALID_UNIT_NUMBER', path, 'Expected a finite number between 0 and 1.'));
    }
}

function validateStateKey(key: string, path: string, diagnostics: StateDiagnostic[]): void {
    if (key.trim().length === 0) {
        diagnostics.push(diagnostic('structural', 'STATE_INVALID_ID', path, 'Record keys must be non-empty strings.'));
    }
}

function sortedKeys(value: Record<string, unknown>): string[] {
    return Object.keys(value).sort();
}

function sortDiagnostics(diagnostics: StateDiagnostic[]): StateDiagnostic[] {
    return diagnostics.slice().sort((left, right) => {
        const pathCompare = left.path.localeCompare(right.path);
        if (pathCompare !== 0) {
            return pathCompare;
        }

        return left.code.localeCompare(right.code);
    });
}

function escapePathKey(key: string): string {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function diagnostic(stage: StateValidationStage, code: string, path: string, message: string): StateDiagnostic {
    return { stage, code, path, message };
}
