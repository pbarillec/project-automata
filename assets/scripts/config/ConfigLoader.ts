export type ConfigStage = 'parse' | 'structural' | 'cross-reference' | 'semantic' | 'repository';

export type ConfigFileKind = 'eras' | 'producers' | 'breakthroughs' | 'milestones' | 'permanent_upgrades' | 'prestige';

export interface ConfigFileSource {
    filePath: string;
    text: string;
}

export interface ConfigDiagnostic {
    stage: ConfigStage;
    code: string;
    filePath: string;
    configPath: string;
    message: string;
}

export interface EraConfig {
    id: string;
    order: number;
    displayNameKey: string;
}

export interface ProducerConfig {
    id: string;
    name: string;
    displayNameKey: string;
    eraId: string;
    baseCost: number;
    costGrowth: number;
    baseProductionPerLevel: number;
    prerequisiteProducerIds: string[];
}

export interface ProducerMilestoneConfig {
    id: string;
    threshold: number;
    productionMultiplier: number;
}

export interface ProducerLevelRequirement {
    type: 'producerLevel';
    producerId: string;
    level: number;
}

export interface BreakthroughOwnedRequirement {
    type: 'breakthroughOwned';
    breakthroughId: string;
}

export interface RobotsBuiltRequirement {
    type: 'robotsBuilt';
    count: number;
}

export interface EraRequirement {
    type: 'era';
    eraId: string;
}

export interface CivilizationRequirement {
    type: 'civilization';
    civilizationNumber: number;
}

export type BreakthroughRequirement =
    | ProducerLevelRequirement
    | BreakthroughOwnedRequirement
    | RobotsBuiltRequirement
    | EraRequirement
    | CivilizationRequirement;

export interface GlobalProductionMultiplierEffect {
    type: 'globalProductionMultiplier';
    multiplier: number;
}

export interface ProducerProductionMultiplierEffect {
    type: 'producerProductionMultiplier';
    producerId: string;
    multiplier: number;
}

export interface ProducerAutomationEffect {
    type: 'setProducerAutomation';
    producerId: string;
    automated: boolean;
    offlineEligible: boolean;
}

export interface ConstructProducerEffect {
    type: 'constructProducer';
    producerId: string;
    level: number;
}

export interface EnterEraEffect {
    type: 'enterEra';
    eraId: string;
}

export interface SetProgressionFlagEffect {
    type: 'setProgressionFlag';
    flagId: string;
    value: boolean;
}

export type BreakthroughEffect =
    | GlobalProductionMultiplierEffect
    | ProducerProductionMultiplierEffect
    | ProducerAutomationEffect
    | ConstructProducerEffect
    | EnterEraEffect
    | SetProgressionFlagEffect;

export interface BreakthroughConfig {
    id: string;
    displayNameKey: string;
    cost: number;
    requirements: BreakthroughRequirement[];
    effects: BreakthroughEffect[];
}

export type PermanentUpgradeBranch = 'production' | 'automation' | 'expansion';

export interface PermanentUpgradePrerequisite {
    upgradeId: string;
    rank: number;
}

export interface PermanentUpgradeProducerLevelRequirementOverride {
    producerId: string;
    level: number;
}

export interface PermanentUpgradeRequirementOverrideRank {
    rank: number;
    producerLevelRequirements: PermanentUpgradeProducerLevelRequirementOverride[];
    availableImmediately: boolean;
    costMultiplier: number;
}

export interface PermanentGlobalProductionMultiplierPerRankEffect {
    type: 'globalProductionMultiplierPerRank';
    multiplier: number;
}

export interface PermanentMilestonePowerBonusPerRankEffect {
    type: 'milestonePowerBonusPerRank';
    bonus: number;
}

export interface PermanentAutomatedProducerMultiplierPerRankEffect {
    type: 'automatedProducerMultiplierPerRank';
    multiplier: number;
}

export interface PermanentBreakthroughRequirementOverrideByRankEffect {
    type: 'breakthroughRequirementOverrideByRank';
    breakthroughId: string;
    ranks: PermanentUpgradeRequirementOverrideRank[];
}

export interface PermanentProducerStartsAutomatedOnceConstructedEffect {
    type: 'producerStartsAutomatedOnceConstructed';
    producerId: string;
}

export interface PermanentNewProducerConstructionCostMultiplierPerRankEffect {
    type: 'newProducerConstructionCostMultiplierPerRank';
    multiplier: number;
}

export interface PermanentMajorRequirementReductionPerRankEffect {
    type: 'majorRequirementReductionPerRank';
    reduction: number;
    roundingRule: 'floor';
}

export type PermanentUpgradeEffect =
    | PermanentGlobalProductionMultiplierPerRankEffect
    | PermanentMilestonePowerBonusPerRankEffect
    | PermanentAutomatedProducerMultiplierPerRankEffect
    | PermanentBreakthroughRequirementOverrideByRankEffect
    | PermanentProducerStartsAutomatedOnceConstructedEffect
    | PermanentNewProducerConstructionCostMultiplierPerRankEffect
    | PermanentMajorRequirementReductionPerRankEffect;

export interface PermanentUpgradeConfig {
    id: string;
    branch: PermanentUpgradeBranch;
    displayNameKey: string;
    maxRank: number;
    rankCosts: number[];
    prerequisites: PermanentUpgradePrerequisite[];
    effects: PermanentUpgradeEffect[];
}

export interface PrestigeConfig {
    id: string;
    p0PrestigePower: number;
}

export interface GameConfigRepositorySnapshot {
    schemaVersion: number;
    contentVersion: string;
    eras: EraConfig[];
    producers: ProducerConfig[];
    breakthroughs: BreakthroughConfig[];
    milestones: ProducerMilestoneConfig[];
    permanentUpgrades: PermanentUpgradeConfig[];
    prestige: PrestigeConfig;
}

interface ParsedConfigFile {
    filePath: string;
    value: unknown;
}

interface ConfigEnvelope<TKind extends ConfigFileKind, TItem> {
    kind: TKind;
    schemaVersion: number;
    contentVersion: string;
    items: TItem[];
    filePath: string;
}

interface StructuredConfigSet {
    eras: ConfigEnvelope<'eras', EraConfig>[];
    producers: ConfigEnvelope<'producers', ProducerConfig>[];
    breakthroughs: ConfigEnvelope<'breakthroughs', BreakthroughConfig>[];
    milestones: ConfigEnvelope<'milestones', ProducerMilestoneConfig>[];
    permanentUpgrades: ConfigEnvelope<'permanent_upgrades', PermanentUpgradeConfig>[];
    prestige: ConfigEnvelope<'prestige', PrestigeConfig>[];
}

interface StageResult<T> {
    value: T;
    diagnostics: ConfigDiagnostic[];
}

const CONFIG_SCHEMA_VERSION = 1;
const SUPPORTED_CONFIG_KINDS: ConfigFileKind[] = ['eras', 'producers', 'breakthroughs', 'milestones', 'permanent_upgrades', 'prestige'];
const SUPPORTED_REQUIREMENT_TYPES = ['producerLevel', 'breakthroughOwned', 'robotsBuilt', 'era', 'civilization'];
const SUPPORTED_EFFECT_TYPES = [
    'globalProductionMultiplier',
    'producerProductionMultiplier',
    'setProducerAutomation',
    'constructProducer',
    'enterEra',
    'setProgressionFlag',
];
const SUPPORTED_PERMANENT_UPGRADE_BRANCHES = ['production', 'automation', 'expansion'];
const SUPPORTED_PERMANENT_UPGRADE_EFFECT_TYPES = [
    'globalProductionMultiplierPerRank',
    'milestonePowerBonusPerRank',
    'automatedProducerMultiplierPerRank',
    'breakthroughRequirementOverrideByRank',
    'producerStartsAutomatedOnceConstructed',
    'newProducerConstructionCostMultiplierPerRank',
    'majorRequirementReductionPerRank',
];
const EMPTY_FILE_PATH = '<config>';

export class ConfigValidationError extends Error {
    diagnostics: ConfigDiagnostic[];

    constructor(diagnostics: ConfigDiagnostic[]) {
        super(`Configuration validation failed with ${diagnostics.length} diagnostic(s).`);
        this.name = 'ConfigValidationError';
        this.diagnostics = diagnostics;
    }
}

export class GameConfigRepository {
    readonly schemaVersion: number;
    readonly contentVersion: string;

    private readonly eraById: Map<string, EraConfig>;
    private readonly producerById: Map<string, ProducerConfig>;
    private readonly breakthroughById: Map<string, BreakthroughConfig>;
    private readonly milestoneById: Map<string, ProducerMilestoneConfig>;
    private readonly permanentUpgradeById: Map<string, PermanentUpgradeConfig>;
    private readonly prestige: PrestigeConfig;

    constructor(snapshot: GameConfigRepositorySnapshot) {
        this.schemaVersion = snapshot.schemaVersion;
        this.contentVersion = snapshot.contentVersion;
        this.eraById = new Map(snapshot.eras.map((era) => [era.id, freezePlainObject(era)]));
        this.producerById = new Map(snapshot.producers.map((producer) => [producer.id, freezePlainObject(producer)]));
        this.breakthroughById = new Map(snapshot.breakthroughs.map((breakthrough) => [breakthrough.id, freezePlainObject(breakthrough)]));
        this.milestoneById = new Map(snapshot.milestones.map((milestone) => [milestone.id, freezePlainObject(milestone)]));
        this.permanentUpgradeById = new Map(snapshot.permanentUpgrades.map((upgrade) => [upgrade.id, freezePlainObject(upgrade)]));
        this.prestige = freezePlainObject(snapshot.prestige);
    }

    getEra(id: string): EraConfig | undefined {
        return this.eraById.get(id);
    }

    getProducer(id: string): ProducerConfig | undefined {
        return this.producerById.get(id);
    }

    getBreakthrough(id: string): BreakthroughConfig | undefined {
        return this.breakthroughById.get(id);
    }

    getMilestone(id: string): ProducerMilestoneConfig | undefined {
        return this.milestoneById.get(id);
    }

    getPermanentUpgrade(id: string): PermanentUpgradeConfig | undefined {
        return this.permanentUpgradeById.get(id);
    }

    listEras(): EraConfig[] {
        return Array.from(this.eraById.values());
    }

    listProducers(): ProducerConfig[] {
        return Array.from(this.producerById.values());
    }

    listBreakthroughs(): BreakthroughConfig[] {
        return Array.from(this.breakthroughById.values());
    }

    listMilestones(): ProducerMilestoneConfig[] {
        return Array.from(this.milestoneById.values());
    }

    listPermanentUpgrades(): PermanentUpgradeConfig[] {
        return Array.from(this.permanentUpgradeById.values());
    }

    getPrestigeConfig(): PrestigeConfig {
        return this.prestige;
    }
}

export function formatConfigDiagnostic(diagnostic: ConfigDiagnostic): string {
    return `${diagnostic.stage} ${diagnostic.code} ${diagnostic.filePath} ${diagnostic.configPath}: ${diagnostic.message}`;
}

export function parseConfigSources(sources: ConfigFileSource[]): StageResult<ParsedConfigFile[]> {
    const diagnostics: ConfigDiagnostic[] = [];
    const files: ParsedConfigFile[] = [];

    for (const source of sortSources(sources)) {
        try {
            files.push({
                filePath: source.filePath || EMPTY_FILE_PATH,
                value: JSON.parse(source.text),
            });
        }
        catch {
            diagnostics.push(makeDiagnostic(
                'parse',
                'CONFIG_PARSE_JSON',
                source.filePath || EMPTY_FILE_PATH,
                '$',
                'Malformed JSON.',
            ));
        }
    }

    return { value: files, diagnostics: sortDiagnostics(diagnostics) };
}

export function validateConfigStructure(parsedFiles: ParsedConfigFile[]): StageResult<StructuredConfigSet> {
    const diagnostics: ConfigDiagnostic[] = [];
    const structured: StructuredConfigSet = {
        eras: [],
        producers: [],
        breakthroughs: [],
        milestones: [],
        permanentUpgrades: [],
        prestige: [],
    };
    const idsByKind = new Map<ConfigFileKind, Map<string, string>>();

    for (const file of parsedFiles.sort(compareFilePath)) {
        const envelopePath = '$';
        const value = file.value;

        if (!isPlainObject(value)) {
            diagnostics.push(makeDiagnostic('structural', 'CONFIG_EXPECTED_OBJECT', file.filePath, envelopePath, 'Config file root must be an object.'));
            continue;
        }

        validateAllowedKeys('structural', file.filePath, envelopePath, value, ['kind', 'schemaVersion', 'contentVersion', 'items'], diagnostics);

        const kind = readString(value, 'kind', file.filePath, envelopePath, diagnostics);
        const schemaVersion = readNumber(value, 'schemaVersion', file.filePath, envelopePath, diagnostics);
        const contentVersion = readString(value, 'contentVersion', file.filePath, envelopePath, diagnostics);
        const itemsValue = value.items;

        if (kind !== undefined && !isConfigFileKind(kind)) {
            diagnostics.push(makeDiagnostic('structural', 'CONFIG_UNKNOWN_KIND', file.filePath, '$.kind', `Unsupported config kind "${kind}".`));
        }

        if (schemaVersion !== undefined && (!Number.isInteger(schemaVersion) || schemaVersion !== CONFIG_SCHEMA_VERSION)) {
            diagnostics.push(makeDiagnostic('structural', 'CONFIG_SCHEMA_VERSION', file.filePath, '$.schemaVersion', `Expected schemaVersion ${CONFIG_SCHEMA_VERSION}.`));
        }

        if (contentVersion !== undefined && contentVersion.trim().length === 0) {
            diagnostics.push(makeDiagnostic('structural', 'CONFIG_CONTENT_VERSION', file.filePath, '$.contentVersion', 'contentVersion must be a non-empty string.'));
        }

        if (!Array.isArray(itemsValue)) {
            diagnostics.push(makeDiagnostic('structural', 'CONFIG_REQUIRED_FIELD', file.filePath, '$.items', 'items must be an array.'));
            continue;
        }

        if (!isConfigFileKind(kind) || schemaVersion === undefined || contentVersion === undefined) {
            continue;
        }

        const envelope = {
            kind,
            schemaVersion,
            contentVersion,
            items: [],
            filePath: file.filePath,
        };

        for (let index = 0; index < itemsValue.length; index += 1) {
            const itemPath = `$.items[${index}]`;
            const item = itemsValue[index];
            const parsedItem = parseConfigItem(kind, item, file.filePath, itemPath, diagnostics);

            if (parsedItem === undefined) {
                continue;
            }

            const duplicatePath = recordId(kind, parsedItem.id, file.filePath, itemPath, idsByKind);
            if (duplicatePath !== undefined) {
                diagnostics.push(makeDiagnostic(
                    'structural',
                    'CONFIG_DUPLICATE_ID',
                    file.filePath,
                    `${itemPath}.id`,
                    `Duplicate ${kind} id "${parsedItem.id}" also declared at ${duplicatePath}.`,
                ));
                continue;
            }

            envelope.items.push(parsedItem);
        }

        pushEnvelope(structured, envelope);
    }

    return { value: structured, diagnostics: sortDiagnostics(diagnostics) };
}

export function validateConfigReferences(config: StructuredConfigSet): ConfigDiagnostic[] {
    const diagnostics: ConfigDiagnostic[] = [];
    const eraIds = collectIds(config.eras);
    const producerIds = collectIds(config.producers);
    const breakthroughIds = collectIds(config.breakthroughs);
    const permanentUpgradeIds = collectIds(config.permanentUpgrades);

    for (const envelope of config.producers) {
        envelope.items.forEach((producer, index) => {
            const itemPath = `$.items[${index}]`;
            if (!eraIds.has(producer.eraId)) {
                diagnostics.push(makeDiagnostic('cross-reference', 'CONFIG_UNKNOWN_REFERENCE', envelope.filePath, `${itemPath}.eraId`, `Unknown era id "${producer.eraId}".`));
            }

            producer.prerequisiteProducerIds.forEach((producerId, prerequisiteIndex) => {
                if (!producerIds.has(producerId)) {
                    diagnostics.push(makeDiagnostic('cross-reference', 'CONFIG_UNKNOWN_REFERENCE', envelope.filePath, `${itemPath}.prerequisiteProducerIds[${prerequisiteIndex}]`, `Unknown producer id "${producerId}".`));
                }
            });
        });
    }

    for (const envelope of config.breakthroughs) {
        envelope.items.forEach((breakthrough, index) => {
            const itemPath = `$.items[${index}]`;
            breakthrough.requirements.forEach((requirement, requirementIndex) => {
                if (requirement.type === 'producerLevel' && !producerIds.has(requirement.producerId)) {
                    diagnostics.push(makeDiagnostic('cross-reference', 'CONFIG_UNKNOWN_REFERENCE', envelope.filePath, `${itemPath}.requirements[${requirementIndex}].producerId`, `Unknown producer id "${requirement.producerId}".`));
                }

                if (requirement.type === 'breakthroughOwned' && !breakthroughIds.has(requirement.breakthroughId)) {
                    diagnostics.push(makeDiagnostic('cross-reference', 'CONFIG_UNKNOWN_REFERENCE', envelope.filePath, `${itemPath}.requirements[${requirementIndex}].breakthroughId`, `Unknown breakthrough id "${requirement.breakthroughId}".`));
                }

                if (requirement.type === 'era' && !eraIds.has(requirement.eraId)) {
                    diagnostics.push(makeDiagnostic('cross-reference', 'CONFIG_UNKNOWN_REFERENCE', envelope.filePath, `${itemPath}.requirements[${requirementIndex}].eraId`, `Unknown era id "${requirement.eraId}".`));
                }
            });

            breakthrough.effects.forEach((effect, effectIndex) => {
                if (
                    (effect.type === 'producerProductionMultiplier' ||
                        effect.type === 'setProducerAutomation' ||
                        effect.type === 'constructProducer') &&
                    !producerIds.has(effect.producerId)
                ) {
                    diagnostics.push(makeDiagnostic('cross-reference', 'CONFIG_UNKNOWN_REFERENCE', envelope.filePath, `${itemPath}.effects[${effectIndex}].producerId`, `Unknown producer id "${effect.producerId}".`));
                }

                if (effect.type === 'enterEra' && !eraIds.has(effect.eraId)) {
                    diagnostics.push(makeDiagnostic('cross-reference', 'CONFIG_UNKNOWN_REFERENCE', envelope.filePath, `${itemPath}.effects[${effectIndex}].eraId`, `Unknown era id "${effect.eraId}".`));
                }
            });
        });
    }

    for (const envelope of config.permanentUpgrades) {
        envelope.items.forEach((upgrade, index) => {
            const itemPath = `$.items[${index}]`;
            upgrade.prerequisites.forEach((prerequisite, prerequisiteIndex) => {
                if (!permanentUpgradeIds.has(prerequisite.upgradeId)) {
                    diagnostics.push(makeDiagnostic('cross-reference', 'CONFIG_UNKNOWN_REFERENCE', envelope.filePath, `${itemPath}.prerequisites[${prerequisiteIndex}].upgradeId`, `Unknown permanent upgrade id "${prerequisite.upgradeId}".`));
                }
            });

            upgrade.effects.forEach((effect, effectIndex) => {
                if (effect.type === 'breakthroughRequirementOverrideByRank') {
                    if (!breakthroughIds.has(effect.breakthroughId)) {
                        diagnostics.push(makeDiagnostic('cross-reference', 'CONFIG_UNKNOWN_REFERENCE', envelope.filePath, `${itemPath}.effects[${effectIndex}].breakthroughId`, `Unknown breakthrough id "${effect.breakthroughId}".`));
                    }

                    effect.ranks.forEach((rank, rankIndex) => {
                        rank.producerLevelRequirements.forEach((requirement, requirementIndex) => {
                            if (!producerIds.has(requirement.producerId)) {
                                diagnostics.push(makeDiagnostic('cross-reference', 'CONFIG_UNKNOWN_REFERENCE', envelope.filePath, `${itemPath}.effects[${effectIndex}].ranks[${rankIndex}].producerLevelRequirements[${requirementIndex}].producerId`, `Unknown producer id "${requirement.producerId}".`));
                            }
                        });
                    });
                }

                if (effect.type === 'producerStartsAutomatedOnceConstructed' && !producerIds.has(effect.producerId)) {
                    diagnostics.push(makeDiagnostic('cross-reference', 'CONFIG_UNKNOWN_REFERENCE', envelope.filePath, `${itemPath}.effects[${effectIndex}].producerId`, `Unknown producer id "${effect.producerId}".`));
                }
            });
        });
    }

    return sortDiagnostics(diagnostics);
}

export function validateConfigSemantics(config: StructuredConfigSet): ConfigDiagnostic[] {
    const diagnostics: ConfigDiagnostic[] = [];
    validateContentVersionConsistency(config, diagnostics);
    validateSemanticNumbers(config, diagnostics);
    validateKnownEffectTypes(config, diagnostics);
    validatePermanentUpgradePrerequisiteRanks(config, diagnostics);
    validateMilestoneOrdering(config, diagnostics);
    validateReferenceCycles(config, diagnostics);
    return sortDiagnostics(diagnostics);
}

export function buildGameConfigRepository(config: StructuredConfigSet): StageResult<GameConfigRepository | undefined> {
    const diagnostics: ConfigDiagnostic[] = [];

    if (config.eras.length === 0) {
        diagnostics.push(makeDiagnostic('repository', 'CONFIG_MISSING_KIND', EMPTY_FILE_PATH, '$.eras', 'Repository requires an eras config file.'));
    }

    if (config.producers.length === 0) {
        diagnostics.push(makeDiagnostic('repository', 'CONFIG_MISSING_KIND', EMPTY_FILE_PATH, '$.producers', 'Repository requires a producers config file.'));
    }

    if (config.breakthroughs.length === 0) {
        diagnostics.push(makeDiagnostic('repository', 'CONFIG_MISSING_KIND', EMPTY_FILE_PATH, '$.breakthroughs', 'Repository requires a breakthroughs config file.'));
    }

    if (config.milestones.length === 0) {
        diagnostics.push(makeDiagnostic('repository', 'CONFIG_MISSING_KIND', EMPTY_FILE_PATH, '$.milestones', 'Repository requires a milestones config file.'));
    }

    if (config.permanentUpgrades.length === 0) {
        diagnostics.push(makeDiagnostic('repository', 'CONFIG_MISSING_KIND', EMPTY_FILE_PATH, '$.permanentUpgrades', 'Repository requires a permanent upgrades config file.'));
    }

    if (config.prestige.length === 0) {
        diagnostics.push(makeDiagnostic('repository', 'CONFIG_MISSING_KIND', EMPTY_FILE_PATH, '$.prestige', 'Repository requires a prestige config file.'));
    }

    if (diagnostics.length > 0) {
        return { value: undefined, diagnostics: sortDiagnostics(diagnostics) };
    }

    const allEnvelopes = getAllEnvelopes(config);
    const repository = new GameConfigRepository({
        schemaVersion: CONFIG_SCHEMA_VERSION,
        contentVersion: allEnvelopes[0].contentVersion,
        eras: config.eras.flatMap((envelope) => envelope.items),
        producers: config.producers.flatMap((envelope) => envelope.items),
        breakthroughs: config.breakthroughs.flatMap((envelope) => envelope.items),
        milestones: config.milestones.flatMap((envelope) => envelope.items),
        permanentUpgrades: config.permanentUpgrades.flatMap((envelope) => envelope.items),
        prestige: config.prestige.flatMap((envelope) => envelope.items)[0],
    });

    return { value: repository, diagnostics };
}

export function validateConfigSources(sources: ConfigFileSource[]): StageResult<GameConfigRepository | undefined> {
    const parseResult = parseConfigSources(sources);
    if (parseResult.diagnostics.length > 0) {
        return { value: undefined, diagnostics: parseResult.diagnostics };
    }

    const structuralResult = validateConfigStructure(parseResult.value);
    if (structuralResult.diagnostics.length > 0) {
        return { value: undefined, diagnostics: structuralResult.diagnostics };
    }

    const referenceDiagnostics = validateConfigReferences(structuralResult.value);
    if (referenceDiagnostics.length > 0) {
        return { value: undefined, diagnostics: referenceDiagnostics };
    }

    const semanticDiagnostics = validateConfigSemantics(structuralResult.value);
    if (semanticDiagnostics.length > 0) {
        return { value: undefined, diagnostics: semanticDiagnostics };
    }

    return buildGameConfigRepository(structuralResult.value);
}

export function loadGameConfigFromSources(sources: ConfigFileSource[]): GameConfigRepository {
    const result = validateConfigSources(sources);
    if (result.diagnostics.length > 0 || result.value === undefined) {
        throw new ConfigValidationError(result.diagnostics);
    }

    return result.value;
}

function parseConfigItem(kind: ConfigFileKind, value: unknown, filePath: string, itemPath: string, diagnostics: ConfigDiagnostic[]): EraConfig | ProducerConfig | BreakthroughConfig | ProducerMilestoneConfig | PermanentUpgradeConfig | PrestigeConfig | undefined {
    if (!isPlainObject(value)) {
        diagnostics.push(makeDiagnostic('structural', 'CONFIG_EXPECTED_OBJECT', filePath, itemPath, 'Config item must be an object.'));
        return undefined;
    }

    if (kind === 'eras') {
        return parseEraConfig(value, filePath, itemPath, diagnostics);
    }

    if (kind === 'producers') {
        return parseProducerConfig(value, filePath, itemPath, diagnostics);
    }

    if (kind === 'breakthroughs') {
        return parseBreakthroughConfig(value, filePath, itemPath, diagnostics);
    }

    if (kind === 'milestones') {
        return parseProducerMilestoneConfig(value, filePath, itemPath, diagnostics);
    }

    if (kind === 'prestige') {
        return parsePrestigeConfig(value, filePath, itemPath, diagnostics);
    }

    return parsePermanentUpgradeConfig(value, filePath, itemPath, diagnostics);
}

function parseEraConfig(value: Record<string, unknown>, filePath: string, itemPath: string, diagnostics: ConfigDiagnostic[]): EraConfig | undefined {
    validateAllowedKeys('structural', filePath, itemPath, value, ['id', 'order', 'displayNameKey'], diagnostics);
    const id = readString(value, 'id', filePath, itemPath, diagnostics);
    const order = readNumber(value, 'order', filePath, itemPath, diagnostics);
    const displayNameKey = readString(value, 'displayNameKey', filePath, itemPath, diagnostics);

    if (id === undefined || order === undefined || displayNameKey === undefined) {
        return undefined;
    }

    return { id, order, displayNameKey };
}

function parseProducerConfig(value: Record<string, unknown>, filePath: string, itemPath: string, diagnostics: ConfigDiagnostic[]): ProducerConfig | undefined {
    validateAllowedKeys('structural', filePath, itemPath, value, [
        'id',
        'name',
        'displayNameKey',
        'eraId',
        'baseCost',
        'costGrowth',
        'baseProductionPerLevel',
        'prerequisiteProducerIds',
    ], diagnostics);

    const id = readString(value, 'id', filePath, itemPath, diagnostics);
    const name = readString(value, 'name', filePath, itemPath, diagnostics);
    const displayNameKey = readString(value, 'displayNameKey', filePath, itemPath, diagnostics);
    const eraId = readString(value, 'eraId', filePath, itemPath, diagnostics);
    const baseCost = readNumber(value, 'baseCost', filePath, itemPath, diagnostics);
    const costGrowth = readNumber(value, 'costGrowth', filePath, itemPath, diagnostics);
    const baseProductionPerLevel = readNumber(value, 'baseProductionPerLevel', filePath, itemPath, diagnostics);
    const prerequisiteProducerIds = readOptionalStringArray(value, 'prerequisiteProducerIds', filePath, itemPath, diagnostics);

    if (
        id === undefined ||
        name === undefined ||
        displayNameKey === undefined ||
        eraId === undefined ||
        baseCost === undefined ||
        costGrowth === undefined ||
        baseProductionPerLevel === undefined ||
        prerequisiteProducerIds === undefined
    ) {
        return undefined;
    }

    return {
        id,
        name,
        displayNameKey,
        eraId,
        baseCost,
        costGrowth,
        baseProductionPerLevel,
        prerequisiteProducerIds,
    };
}

function parseProducerMilestoneConfig(value: Record<string, unknown>, filePath: string, itemPath: string, diagnostics: ConfigDiagnostic[]): ProducerMilestoneConfig | undefined {
    validateAllowedKeys('structural', filePath, itemPath, value, ['id', 'threshold', 'productionMultiplier'], diagnostics);
    const id = readString(value, 'id', filePath, itemPath, diagnostics);
    const threshold = readNumber(value, 'threshold', filePath, itemPath, diagnostics);
    const productionMultiplier = readNumber(value, 'productionMultiplier', filePath, itemPath, diagnostics);

    if (id === undefined || threshold === undefined || productionMultiplier === undefined) {
        return undefined;
    }

    return { id, threshold, productionMultiplier };
}

function parsePrestigeConfig(value: Record<string, unknown>, filePath: string, itemPath: string, diagnostics: ConfigDiagnostic[]): PrestigeConfig | undefined {
    validateAllowedKeys('structural', filePath, itemPath, value, ['id', 'p0PrestigePower'], diagnostics);
    const id = readString(value, 'id', filePath, itemPath, diagnostics);
    const p0PrestigePower = readNumber(value, 'p0PrestigePower', filePath, itemPath, diagnostics);

    if (id === undefined || p0PrestigePower === undefined) {
        return undefined;
    }

    return { id, p0PrestigePower };
}

function parseBreakthroughConfig(value: Record<string, unknown>, filePath: string, itemPath: string, diagnostics: ConfigDiagnostic[]): BreakthroughConfig | undefined {
    validateAllowedKeys('structural', filePath, itemPath, value, ['id', 'displayNameKey', 'cost', 'requirements', 'effects'], diagnostics);
    const id = readString(value, 'id', filePath, itemPath, diagnostics);
    const displayNameKey = readString(value, 'displayNameKey', filePath, itemPath, diagnostics);
    const cost = readNumber(value, 'cost', filePath, itemPath, diagnostics);
    const requirements = parseRequirements(value.requirements, filePath, `${itemPath}.requirements`, diagnostics);
    const effects = parseEffects(value.effects, filePath, `${itemPath}.effects`, diagnostics);

    if (id === undefined || displayNameKey === undefined || cost === undefined || requirements === undefined || effects === undefined) {
        return undefined;
    }

    return {
        id,
        displayNameKey,
        cost,
        requirements,
        effects,
    };
}

function parseRequirements(value: unknown, filePath: string, configPath: string, diagnostics: ConfigDiagnostic[]): BreakthroughRequirement[] | undefined {
    if (!Array.isArray(value)) {
        diagnostics.push(makeDiagnostic('structural', 'CONFIG_REQUIRED_FIELD', filePath, configPath, 'requirements must be an array.'));
        return undefined;
    }

    const requirements: BreakthroughRequirement[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const itemPath = `${configPath}[${index}]`;
        const requirement = value[index];
        if (!isPlainObject(requirement)) {
            diagnostics.push(makeDiagnostic('structural', 'CONFIG_EXPECTED_OBJECT', filePath, itemPath, 'producer level requirement must be an object.'));
            continue;
        }

        const type = readString(requirement, 'type', filePath, itemPath, diagnostics);

        if (type === 'producerLevel') {
            validateAllowedKeys('structural', filePath, itemPath, requirement, ['type', 'producerId', 'level'], diagnostics);
            const producerId = readString(requirement, 'producerId', filePath, itemPath, diagnostics);
            const level = readNumber(requirement, 'level', filePath, itemPath, diagnostics);
            if (producerId !== undefined && level !== undefined) {
                requirements.push({ type, producerId, level });
            }
            continue;
        }

        if (type === 'breakthroughOwned') {
            validateAllowedKeys('structural', filePath, itemPath, requirement, ['type', 'breakthroughId'], diagnostics);
            const breakthroughId = readString(requirement, 'breakthroughId', filePath, itemPath, diagnostics);
            if (breakthroughId !== undefined) {
                requirements.push({ type, breakthroughId });
            }
            continue;
        }

        if (type === 'robotsBuilt') {
            validateAllowedKeys('structural', filePath, itemPath, requirement, ['type', 'count'], diagnostics);
            const count = readNumber(requirement, 'count', filePath, itemPath, diagnostics);
            if (count !== undefined) {
                requirements.push({ type, count });
            }
            continue;
        }

        if (type === 'era') {
            validateAllowedKeys('structural', filePath, itemPath, requirement, ['type', 'eraId'], diagnostics);
            const eraId = readString(requirement, 'eraId', filePath, itemPath, diagnostics);
            if (eraId !== undefined) {
                requirements.push({ type, eraId });
            }
            continue;
        }

        if (type === 'civilization') {
            validateAllowedKeys('structural', filePath, itemPath, requirement, ['type', 'civilizationNumber'], diagnostics);
            const civilizationNumber = readNumber(requirement, 'civilizationNumber', filePath, itemPath, diagnostics);
            if (civilizationNumber !== undefined) {
                requirements.push({ type, civilizationNumber });
            }
            continue;
        }

        if (type !== undefined) {
            requirements.push({ type } as BreakthroughRequirement);
        }
    }

    return requirements;
}

function parseEffects(value: unknown, filePath: string, configPath: string, diagnostics: ConfigDiagnostic[]): BreakthroughEffect[] | undefined {
    if (!Array.isArray(value)) {
        diagnostics.push(makeDiagnostic('structural', 'CONFIG_REQUIRED_FIELD', filePath, configPath, 'effects must be an array.'));
        return undefined;
    }

    const effects: BreakthroughEffect[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const itemPath = `${configPath}[${index}]`;
        const effect = value[index];
        if (!isPlainObject(effect)) {
            diagnostics.push(makeDiagnostic('structural', 'CONFIG_EXPECTED_OBJECT', filePath, itemPath, 'effect must be an object.'));
            continue;
        }

        const type = readString(effect, 'type', filePath, itemPath, diagnostics);

        if (type === 'globalProductionMultiplier') {
            validateAllowedKeys('structural', filePath, itemPath, effect, ['type', 'multiplier'], diagnostics);
            const multiplier = readNumber(effect, 'multiplier', filePath, itemPath, diagnostics);
            if (multiplier !== undefined) {
                effects.push({ type, multiplier });
            }
            continue;
        }

        if (type === 'producerProductionMultiplier') {
            validateAllowedKeys('structural', filePath, itemPath, effect, ['type', 'producerId', 'multiplier'], diagnostics);
            const producerId = readString(effect, 'producerId', filePath, itemPath, diagnostics);
            const multiplier = readNumber(effect, 'multiplier', filePath, itemPath, diagnostics);
            if (producerId !== undefined && multiplier !== undefined) {
                effects.push({ type, producerId, multiplier });
            }
            continue;
        }

        if (type === 'setProducerAutomation') {
            validateAllowedKeys('structural', filePath, itemPath, effect, ['type', 'producerId', 'automated', 'offlineEligible'], diagnostics);
            const producerId = readString(effect, 'producerId', filePath, itemPath, diagnostics);
            const automated = readBoolean(effect, 'automated', filePath, itemPath, diagnostics);
            const offlineEligible = readBoolean(effect, 'offlineEligible', filePath, itemPath, diagnostics);
            if (producerId !== undefined && automated !== undefined && offlineEligible !== undefined) {
                effects.push({ type, producerId, automated, offlineEligible });
            }
            continue;
        }

        if (type === 'constructProducer') {
            validateAllowedKeys('structural', filePath, itemPath, effect, ['type', 'producerId', 'level'], diagnostics);
            const producerId = readString(effect, 'producerId', filePath, itemPath, diagnostics);
            const level = readNumber(effect, 'level', filePath, itemPath, diagnostics);
            if (producerId !== undefined && level !== undefined) {
                effects.push({ type, producerId, level });
            }
            continue;
        }

        if (type === 'enterEra') {
            validateAllowedKeys('structural', filePath, itemPath, effect, ['type', 'eraId'], diagnostics);
            const eraId = readString(effect, 'eraId', filePath, itemPath, diagnostics);
            if (eraId !== undefined) {
                effects.push({ type, eraId });
            }
            continue;
        }

        if (type === 'setProgressionFlag') {
            validateAllowedKeys('structural', filePath, itemPath, effect, ['type', 'flagId', 'value'], diagnostics);
            const flagId = readString(effect, 'flagId', filePath, itemPath, diagnostics);
            const flagValue = readBoolean(effect, 'value', filePath, itemPath, diagnostics);
            if (flagId !== undefined && flagValue !== undefined) {
                effects.push({ type, flagId, value: flagValue });
            }
            continue;
        }

        if (type !== undefined) {
            effects.push({ type } as BreakthroughEffect);
        }
    }

    return effects;
}

function parsePermanentUpgradeConfig(value: Record<string, unknown>, filePath: string, itemPath: string, diagnostics: ConfigDiagnostic[]): PermanentUpgradeConfig | undefined {
    validateAllowedKeys('structural', filePath, itemPath, value, ['id', 'branch', 'displayNameKey', 'maxRank', 'rankCosts', 'prerequisites', 'effects'], diagnostics);
    const id = readString(value, 'id', filePath, itemPath, diagnostics);
    const branch = readString(value, 'branch', filePath, itemPath, diagnostics) as PermanentUpgradeBranch | undefined;
    const displayNameKey = readString(value, 'displayNameKey', filePath, itemPath, diagnostics);
    const maxRank = readNumber(value, 'maxRank', filePath, itemPath, diagnostics);
    const rankCosts = parseNumberArray(value.rankCosts, filePath, `${itemPath}.rankCosts`, diagnostics);
    const prerequisites = parsePermanentUpgradePrerequisites(value.prerequisites, filePath, `${itemPath}.prerequisites`, diagnostics);
    const effects = parsePermanentUpgradeEffects(value.effects, filePath, `${itemPath}.effects`, diagnostics);

    if (id === undefined || branch === undefined || displayNameKey === undefined || maxRank === undefined || rankCosts === undefined || prerequisites === undefined || effects === undefined) {
        return undefined;
    }

    return {
        id,
        branch,
        displayNameKey,
        maxRank,
        rankCosts,
        prerequisites,
        effects,
    };
}

function parsePermanentUpgradePrerequisites(value: unknown, filePath: string, configPath: string, diagnostics: ConfigDiagnostic[]): PermanentUpgradePrerequisite[] | undefined {
    if (!Array.isArray(value)) {
        diagnostics.push(makeDiagnostic('structural', 'CONFIG_REQUIRED_FIELD', filePath, configPath, 'prerequisites must be an array.'));
        return undefined;
    }

    const prerequisites: PermanentUpgradePrerequisite[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const itemPath = `${configPath}[${index}]`;
        const prerequisite = value[index];
        if (!isPlainObject(prerequisite)) {
            diagnostics.push(makeDiagnostic('structural', 'CONFIG_EXPECTED_OBJECT', filePath, itemPath, 'permanent upgrade prerequisite must be an object.'));
            continue;
        }

        validateAllowedKeys('structural', filePath, itemPath, prerequisite, ['upgradeId', 'rank'], diagnostics);
        const upgradeId = readString(prerequisite, 'upgradeId', filePath, itemPath, diagnostics);
        const rank = readNumber(prerequisite, 'rank', filePath, itemPath, diagnostics);
        if (upgradeId !== undefined && rank !== undefined) {
            prerequisites.push({ upgradeId, rank });
        }
    }

    return prerequisites;
}

function parsePermanentUpgradeEffects(value: unknown, filePath: string, configPath: string, diagnostics: ConfigDiagnostic[]): PermanentUpgradeEffect[] | undefined {
    if (!Array.isArray(value)) {
        diagnostics.push(makeDiagnostic('structural', 'CONFIG_REQUIRED_FIELD', filePath, configPath, 'effects must be an array.'));
        return undefined;
    }

    const effects: PermanentUpgradeEffect[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const itemPath = `${configPath}[${index}]`;
        const effect = value[index];
        if (!isPlainObject(effect)) {
            diagnostics.push(makeDiagnostic('structural', 'CONFIG_EXPECTED_OBJECT', filePath, itemPath, 'permanent upgrade effect must be an object.'));
            continue;
        }

        const type = readString(effect, 'type', filePath, itemPath, diagnostics);

        if (type === 'globalProductionMultiplierPerRank' || type === 'automatedProducerMultiplierPerRank' || type === 'newProducerConstructionCostMultiplierPerRank') {
            validateAllowedKeys('structural', filePath, itemPath, effect, ['type', 'multiplier'], diagnostics);
            const multiplier = readNumber(effect, 'multiplier', filePath, itemPath, diagnostics);
            if (multiplier !== undefined) {
                effects.push({ type, multiplier } as PermanentUpgradeEffect);
            }
            continue;
        }

        if (type === 'milestonePowerBonusPerRank') {
            validateAllowedKeys('structural', filePath, itemPath, effect, ['type', 'bonus'], diagnostics);
            const bonus = readNumber(effect, 'bonus', filePath, itemPath, diagnostics);
            if (bonus !== undefined) {
                effects.push({ type, bonus });
            }
            continue;
        }

        if (type === 'breakthroughRequirementOverrideByRank') {
            validateAllowedKeys('structural', filePath, itemPath, effect, ['type', 'breakthroughId', 'ranks'], diagnostics);
            const breakthroughId = readString(effect, 'breakthroughId', filePath, itemPath, diagnostics);
            const ranks = parsePermanentUpgradeRequirementOverrideRanks(effect.ranks, filePath, `${itemPath}.ranks`, diagnostics);
            if (breakthroughId !== undefined && ranks !== undefined) {
                effects.push({ type, breakthroughId, ranks });
            }
            continue;
        }

        if (type === 'producerStartsAutomatedOnceConstructed') {
            validateAllowedKeys('structural', filePath, itemPath, effect, ['type', 'producerId'], diagnostics);
            const producerId = readString(effect, 'producerId', filePath, itemPath, diagnostics);
            if (producerId !== undefined) {
                effects.push({ type, producerId });
            }
            continue;
        }

        if (type === 'majorRequirementReductionPerRank') {
            validateAllowedKeys('structural', filePath, itemPath, effect, ['type', 'reduction', 'roundingRule'], diagnostics);
            const reduction = readNumber(effect, 'reduction', filePath, itemPath, diagnostics);
            const roundingRule = readString(effect, 'roundingRule', filePath, itemPath, diagnostics) as 'floor' | undefined;
            if (reduction !== undefined && roundingRule !== undefined) {
                effects.push({ type, reduction, roundingRule });
            }
            continue;
        }

        if (type !== undefined) {
            effects.push({ type } as PermanentUpgradeEffect);
        }
    }

    return effects;
}

function parsePermanentUpgradeRequirementOverrideRanks(value: unknown, filePath: string, configPath: string, diagnostics: ConfigDiagnostic[]): PermanentUpgradeRequirementOverrideRank[] | undefined {
    if (!Array.isArray(value)) {
        diagnostics.push(makeDiagnostic('structural', 'CONFIG_REQUIRED_FIELD', filePath, configPath, 'ranks must be an array.'));
        return undefined;
    }

    const ranks: PermanentUpgradeRequirementOverrideRank[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const itemPath = `${configPath}[${index}]`;
        const rankValue = value[index];
        if (!isPlainObject(rankValue)) {
            diagnostics.push(makeDiagnostic('structural', 'CONFIG_EXPECTED_OBJECT', filePath, itemPath, 'permanent upgrade rank override must be an object.'));
            continue;
        }

        validateAllowedKeys('structural', filePath, itemPath, rankValue, ['rank', 'producerLevelRequirements', 'availableImmediately', 'costMultiplier'], diagnostics);
        const rank = readNumber(rankValue, 'rank', filePath, itemPath, diagnostics);
        const producerLevelRequirements = parsePermanentUpgradeProducerLevelRequirementOverrides(rankValue.producerLevelRequirements, filePath, `${itemPath}.producerLevelRequirements`, diagnostics);
        const availableImmediately = readBoolean(rankValue, 'availableImmediately', filePath, itemPath, diagnostics);
        const costMultiplier = readNumber(rankValue, 'costMultiplier', filePath, itemPath, diagnostics);

        if (rank !== undefined && producerLevelRequirements !== undefined && availableImmediately !== undefined && costMultiplier !== undefined) {
            ranks.push({ rank, producerLevelRequirements, availableImmediately, costMultiplier });
        }
    }

    return ranks;
}

function parsePermanentUpgradeProducerLevelRequirementOverrides(value: unknown, filePath: string, configPath: string, diagnostics: ConfigDiagnostic[]): PermanentUpgradeProducerLevelRequirementOverride[] | undefined {
    if (!Array.isArray(value)) {
        diagnostics.push(makeDiagnostic('structural', 'CONFIG_REQUIRED_FIELD', filePath, configPath, 'producerLevelRequirements must be an array.'));
        return undefined;
    }

    const requirements: PermanentUpgradeProducerLevelRequirementOverride[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const itemPath = `${configPath}[${index}]`;
        const requirement = value[index];
        if (!isPlainObject(requirement)) {
            diagnostics.push(makeDiagnostic('structural', 'CONFIG_EXPECTED_OBJECT', filePath, itemPath, 'producer level requirement override must be an object.'));
            continue;
        }

        validateAllowedKeys('structural', filePath, itemPath, requirement, ['producerId', 'level'], diagnostics);
        const producerId = readString(requirement, 'producerId', filePath, itemPath, diagnostics);
        const level = readNumber(requirement, 'level', filePath, itemPath, diagnostics);
        if (producerId !== undefined && level !== undefined) {
            requirements.push({ producerId, level });
        }
    }

    return requirements;
}

function parseNumberArray(value: unknown, filePath: string, configPath: string, diagnostics: ConfigDiagnostic[]): number[] | undefined {
    if (!Array.isArray(value)) {
        diagnostics.push(makeDiagnostic('structural', 'CONFIG_REQUIRED_FIELD', filePath, configPath, 'rankCosts must be an array.'));
        return undefined;
    }

    const numbers: number[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const item = value[index];
        if (typeof item !== 'number' || !Number.isFinite(item)) {
            diagnostics.push(makeDiagnostic('structural', 'CONFIG_INVALID_TYPE', filePath, `${configPath}[${index}]`, 'rankCosts entries must be finite numbers.'));
            continue;
        }
        numbers.push(item);
    }

    return numbers;
}

function validateContentVersionConsistency(config: StructuredConfigSet, diagnostics: ConfigDiagnostic[]): void {
    const allEnvelopes = getAllEnvelopes(config);
    const firstVersion = allEnvelopes[0]?.contentVersion;
    if (firstVersion === undefined) {
        return;
    }

    for (const envelope of allEnvelopes) {
        if (envelope.contentVersion !== firstVersion) {
            diagnostics.push(makeDiagnostic('semantic', 'CONFIG_CONTENT_VERSION_MISMATCH', envelope.filePath, '$.contentVersion', `Expected contentVersion "${firstVersion}".`));
        }
    }
}

function validateSemanticNumbers(config: StructuredConfigSet, diagnostics: ConfigDiagnostic[]): void {
    for (const envelope of config.eras) {
        envelope.items.forEach((era, index) => {
            if (!Number.isInteger(era.order) || era.order < 0) {
                diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].order`, 'Era order must be a non-negative integer.'));
            }
        });
    }

    for (const envelope of config.producers) {
        envelope.items.forEach((producer, index) => {
            if (producer.baseCost <= 0) {
                diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].baseCost`, 'baseCost must be greater than 0.'));
            }
            if (producer.costGrowth <= 1) {
                diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].costGrowth`, 'costGrowth must be greater than 1.'));
            }
            if (producer.baseProductionPerLevel <= 0) {
                diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].baseProductionPerLevel`, 'baseProductionPerLevel must be greater than 0.'));
            }
        });
    }

    for (const envelope of config.milestones) {
        envelope.items.forEach((milestone, index) => {
            if (!Number.isInteger(milestone.threshold) || milestone.threshold <= 0) {
                diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].threshold`, 'milestone threshold must be a positive integer.'));
            }
            if (milestone.productionMultiplier <= 0) {
                diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].productionMultiplier`, 'milestone productionMultiplier must be greater than 0.'));
            }
        });
    }

    for (const envelope of config.prestige) {
        if (envelope.items.length !== 1) {
            diagnostics.push(makeDiagnostic('semantic', 'CONFIG_PRESTIGE_COUNT', envelope.filePath, '$.items', 'Prestige config must contain exactly one item.'));
        }

        envelope.items.forEach((prestige, index) => {
            if (prestige.p0PrestigePower <= 0) {
                diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].p0PrestigePower`, 'p0PrestigePower must be greater than 0.'));
            }
        });
    }

    for (const envelope of config.breakthroughs) {
        envelope.items.forEach((breakthrough, index) => {
            if (breakthrough.cost <= 0) {
                diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].cost`, 'cost must be greater than 0.'));
            }

            breakthrough.requirements.forEach((requirement, requirementIndex) => {
                if (requirement.type === 'producerLevel' && (!Number.isInteger(requirement.level) || requirement.level <= 0)) {
                    diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].requirements[${requirementIndex}].level`, 'producer requirement level must be a positive integer.'));
                }

                if (requirement.type === 'robotsBuilt' && (!Number.isInteger(requirement.count) || requirement.count <= 0)) {
                    diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].requirements[${requirementIndex}].count`, 'robotsBuilt requirement count must be a positive integer.'));
                }

                if (requirement.type === 'civilization' && (!Number.isInteger(requirement.civilizationNumber) || requirement.civilizationNumber <= 0)) {
                    diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].requirements[${requirementIndex}].civilizationNumber`, 'civilization requirement must be a positive integer.'));
                }
            });

            breakthrough.effects.forEach((effect, effectIndex) => {
                if ((effect.type === 'globalProductionMultiplier' || effect.type === 'producerProductionMultiplier') && effect.multiplier <= 0) {
                    diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].effects[${effectIndex}].multiplier`, 'production multiplier must be greater than 0.'));
                }

                if (effect.type === 'constructProducer' && (!Number.isInteger(effect.level) || effect.level <= 0)) {
                    diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].effects[${effectIndex}].level`, 'constructed producer level must be a positive integer.'));
                }
            });
        });
    }

    for (const envelope of config.permanentUpgrades) {
        envelope.items.forEach((upgrade, index) => {
            if (!SUPPORTED_PERMANENT_UPGRADE_BRANCHES.includes(upgrade.branch)) {
                diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_BRANCH', envelope.filePath, `$.items[${index}].branch`, `Unsupported permanent upgrade branch "${upgrade.branch}".`));
            }

            if (!Number.isInteger(upgrade.maxRank) || upgrade.maxRank <= 0) {
                diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].maxRank`, 'maxRank must be a positive integer.'));
            }

            if (upgrade.rankCosts.length !== upgrade.maxRank) {
                diagnostics.push(makeDiagnostic('semantic', 'CONFIG_RANK_COST_LENGTH_MISMATCH', envelope.filePath, `$.items[${index}].rankCosts`, 'rankCosts length must match maxRank.'));
            }

            upgrade.rankCosts.forEach((cost, costIndex) => {
                if (!Number.isInteger(cost) || cost <= 0) {
                    diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].rankCosts[${costIndex}]`, 'rank cost must be a positive integer.'));
                }
            });

            upgrade.prerequisites.forEach((prerequisite, prerequisiteIndex) => {
                if (!Number.isInteger(prerequisite.rank) || prerequisite.rank <= 0) {
                    diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].prerequisites[${prerequisiteIndex}].rank`, 'permanent upgrade prerequisite rank must be a positive integer.'));
                }
                if (prerequisite.upgradeId === upgrade.id) {
                    diagnostics.push(makeDiagnostic('semantic', 'CONFIG_REFERENCE_CYCLE', envelope.filePath, `$.items[${index}].prerequisites[${prerequisiteIndex}].upgradeId`, `Permanent upgrade prerequisite cycle detected: ${upgrade.id} -> ${upgrade.id}.`));
                }
            });

            upgrade.effects.forEach((effect, effectIndex) => {
                if (
                    (effect.type === 'globalProductionMultiplierPerRank' ||
                        effect.type === 'automatedProducerMultiplierPerRank' ||
                        effect.type === 'newProducerConstructionCostMultiplierPerRank') &&
                    effect.multiplier <= 0
                ) {
                    diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].effects[${effectIndex}].multiplier`, 'permanent upgrade multiplier must be greater than 0.'));
                }

                if (effect.type === 'milestonePowerBonusPerRank' && (effect.bonus < 0 || effect.bonus > 1)) {
                    diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].effects[${effectIndex}].bonus`, 'milestone power bonus must be between 0 and 1.'));
                }

                if (effect.type === 'majorRequirementReductionPerRank') {
                    if (effect.reduction < 0 || effect.reduction >= 1) {
                        diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].effects[${effectIndex}].reduction`, 'major requirement reduction must be greater than or equal to 0 and less than 1.'));
                    }
                    if (effect.roundingRule !== 'floor') {
                        diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_ROUNDING_RULE', envelope.filePath, `$.items[${index}].effects[${effectIndex}].roundingRule`, `Unsupported rounding rule "${effect.roundingRule}".`));
                    }
                }

                if (effect.type === 'breakthroughRequirementOverrideByRank') {
                    const seenRanks = new Set<number>();
                    effect.ranks.forEach((rankOverride, rankIndex) => {
                        if (!Number.isInteger(rankOverride.rank) || rankOverride.rank <= 0 || rankOverride.rank > upgrade.maxRank) {
                            diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].effects[${effectIndex}].ranks[${rankIndex}].rank`, 'rank override rank must be a positive integer no greater than maxRank.'));
                        }
                        if (seenRanks.has(rankOverride.rank)) {
                            diagnostics.push(makeDiagnostic('semantic', 'CONFIG_DUPLICATE_RANK', envelope.filePath, `$.items[${index}].effects[${effectIndex}].ranks[${rankIndex}].rank`, `Duplicate rank override ${rankOverride.rank}.`));
                        }
                        seenRanks.add(rankOverride.rank);

                        if (rankOverride.costMultiplier <= 0) {
                            diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].effects[${effectIndex}].ranks[${rankIndex}].costMultiplier`, 'costMultiplier must be greater than 0.'));
                        }

                        rankOverride.producerLevelRequirements.forEach((requirement, requirementIndex) => {
                            if (!Number.isInteger(requirement.level) || requirement.level <= 0) {
                                diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].effects[${effectIndex}].ranks[${rankIndex}].producerLevelRequirements[${requirementIndex}].level`, 'producer requirement override level must be a positive integer.'));
                            }
                        });
                    });
                }
            });
        });
    }
}

function validateKnownEffectTypes(config: StructuredConfigSet, diagnostics: ConfigDiagnostic[]): void {
    for (const envelope of config.breakthroughs) {
        envelope.items.forEach((breakthrough, index) => {
            breakthrough.requirements.forEach((requirement, requirementIndex) => {
                if (!SUPPORTED_REQUIREMENT_TYPES.includes(requirement.type)) {
                    diagnostics.push(makeDiagnostic('semantic', 'CONFIG_UNKNOWN_REQUIREMENT_TYPE', envelope.filePath, `$.items[${index}].requirements[${requirementIndex}].type`, `Unsupported requirement type "${requirement.type}".`));
                }
            });

            breakthrough.effects.forEach((effect, effectIndex) => {
                if (!SUPPORTED_EFFECT_TYPES.includes(effect.type)) {
                    diagnostics.push(makeDiagnostic('semantic', 'CONFIG_UNKNOWN_EFFECT_TYPE', envelope.filePath, `$.items[${index}].effects[${effectIndex}].type`, `Unsupported effect type "${effect.type}".`));
                }
            });
        });
    }

    for (const envelope of config.permanentUpgrades) {
        envelope.items.forEach((upgrade, index) => {
            upgrade.effects.forEach((effect, effectIndex) => {
                if (!SUPPORTED_PERMANENT_UPGRADE_EFFECT_TYPES.includes(effect.type)) {
                    diagnostics.push(makeDiagnostic('semantic', 'CONFIG_UNKNOWN_EFFECT_TYPE', envelope.filePath, `$.items[${index}].effects[${effectIndex}].type`, `Unsupported permanent upgrade effect type "${effect.type}".`));
                }
            });
        });
    }
}

function validatePermanentUpgradePrerequisiteRanks(config: StructuredConfigSet, diagnostics: ConfigDiagnostic[]): void {
    const upgradeById = new Map<string, PermanentUpgradeConfig>();
    for (const envelope of config.permanentUpgrades) {
        for (const upgrade of envelope.items) {
            upgradeById.set(upgrade.id, upgrade);
        }
    }

    for (const envelope of config.permanentUpgrades) {
        envelope.items.forEach((upgrade, index) => {
            upgrade.prerequisites.forEach((prerequisite, prerequisiteIndex) => {
                const prerequisiteUpgrade = upgradeById.get(prerequisite.upgradeId);
                if (prerequisiteUpgrade !== undefined && prerequisite.rank > prerequisiteUpgrade.maxRank) {
                    diagnostics.push(makeDiagnostic(
                        'semantic',
                        'CONFIG_INVALID_PREREQUISITE_RANK',
                        envelope.filePath,
                        `$.items[${index}].prerequisites[${prerequisiteIndex}].rank`,
                        `Prerequisite rank ${prerequisite.rank} exceeds maxRank ${prerequisiteUpgrade.maxRank} for permanent upgrade "${prerequisite.upgradeId}".`,
                    ));
                }
            });
        });
    }
}

function validateMilestoneOrdering(config: StructuredConfigSet, diagnostics: ConfigDiagnostic[]): void {
    const seenThresholds = new Map<number, { filePath: string; configPath: string }>();
    let previousThreshold = Number.NEGATIVE_INFINITY;

    for (const envelope of config.milestones) {
        envelope.items.forEach((milestone, index) => {
            const thresholdPath = `$.items[${index}].threshold`;
            const duplicateThreshold = seenThresholds.get(milestone.threshold);

            if (duplicateThreshold !== undefined) {
                diagnostics.push(makeDiagnostic(
                    'semantic',
                    'CONFIG_DUPLICATE_MILESTONE_THRESHOLD',
                    envelope.filePath,
                    thresholdPath,
                    `Duplicate milestone threshold ${milestone.threshold} also declared at ${duplicateThreshold.filePath} ${duplicateThreshold.configPath}.`,
                ));
            }
            else {
                seenThresholds.set(milestone.threshold, {
                    filePath: envelope.filePath,
                    configPath: thresholdPath,
                });
            }

            if (milestone.threshold <= previousThreshold) {
                diagnostics.push(makeDiagnostic(
                    'semantic',
                    'CONFIG_INVALID_ORDER',
                    envelope.filePath,
                    thresholdPath,
                    'Milestone thresholds must be strictly ascending.',
                ));
            }

            previousThreshold = milestone.threshold;
        });
    }
}

function validateReferenceCycles(config: StructuredConfigSet, diagnostics: ConfigDiagnostic[]): void {
    const producerGraph = new Map<string, string[]>();
    const producerFileById = new Map<string, { filePath: string; index: number }>();
    for (const envelope of config.producers) {
        envelope.items.forEach((producer, index) => {
            producerGraph.set(producer.id, producer.prerequisiteProducerIds);
            producerFileById.set(producer.id, { filePath: envelope.filePath, index });
        });
    }

    for (const cycle of findCycles(producerGraph)) {
        const owner = producerFileById.get(cycle[0]);
        diagnostics.push(makeDiagnostic(
            'semantic',
            'CONFIG_REFERENCE_CYCLE',
            owner?.filePath ?? EMPTY_FILE_PATH,
            owner === undefined ? '$.producers' : `$.items[${owner.index}].prerequisiteProducerIds`,
            `Producer prerequisite cycle detected: ${cycle.join(' -> ')}.`,
        ));
    }

    const breakthroughGraph = new Map<string, string[]>();
    const breakthroughFileById = new Map<string, { filePath: string; index: number }>();
    for (const envelope of config.breakthroughs) {
        envelope.items.forEach((breakthrough, index) => {
            breakthroughGraph.set(
                breakthrough.id,
                breakthrough.requirements
                    .filter((requirement): requirement is BreakthroughOwnedRequirement => requirement.type === 'breakthroughOwned')
                    .map((requirement) => requirement.breakthroughId),
            );
            breakthroughFileById.set(breakthrough.id, { filePath: envelope.filePath, index });
        });
    }

    for (const cycle of findCycles(breakthroughGraph)) {
        const owner = breakthroughFileById.get(cycle[0]);
        diagnostics.push(makeDiagnostic(
            'semantic',
            'CONFIG_REFERENCE_CYCLE',
            owner?.filePath ?? EMPTY_FILE_PATH,
            owner === undefined ? '$.breakthroughs' : `$.items[${owner.index}].requirements`,
            `Breakthrough prerequisite cycle detected: ${cycle.join(' -> ')}.`,
        ));
    }

    const permanentUpgradeGraph = new Map<string, string[]>();
    const permanentUpgradeFileById = new Map<string, { filePath: string; index: number }>();
    for (const envelope of config.permanentUpgrades) {
        envelope.items.forEach((upgrade, index) => {
            permanentUpgradeGraph.set(upgrade.id, upgrade.prerequisites.map((prerequisite) => prerequisite.upgradeId));
            permanentUpgradeFileById.set(upgrade.id, { filePath: envelope.filePath, index });
        });
    }

    for (const cycle of findCycles(permanentUpgradeGraph)) {
        const owner = permanentUpgradeFileById.get(cycle[0]);
        diagnostics.push(makeDiagnostic(
            'semantic',
            'CONFIG_REFERENCE_CYCLE',
            owner?.filePath ?? EMPTY_FILE_PATH,
            owner === undefined ? '$.permanentUpgrades' : `$.items[${owner.index}].prerequisites`,
            `Permanent upgrade prerequisite cycle detected: ${cycle.join(' -> ')}.`,
        ));
    }
}

function findCycles(graph: Map<string, string[]>): string[][] {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const stack: string[] = [];
    const cycleKeys = new Set<string>();
    const cycles: string[][] = [];

    for (const node of Array.from(graph.keys()).sort()) {
        visit(node);
    }

    return cycles;

    function visit(node: string): void {
        if (visited.has(node)) {
            return;
        }

        if (visiting.has(node)) {
            const cycleStart = stack.indexOf(node);
            const cycle = stack.slice(cycleStart).concat(node);
            const key = cycle.slice(0, -1).sort().join('|');
            if (!cycleKeys.has(key)) {
                cycleKeys.add(key);
                cycles.push(cycle);
            }
            return;
        }

        visiting.add(node);
        stack.push(node);

        for (const nextNode of (graph.get(node) ?? []).slice().sort()) {
            visit(nextNode);
        }

        stack.pop();
        visiting.delete(node);
        visited.add(node);
    }
}

function pushEnvelope(structured: StructuredConfigSet, envelope: ConfigEnvelope<ConfigFileKind, EraConfig | ProducerConfig | BreakthroughConfig | ProducerMilestoneConfig | PermanentUpgradeConfig | PrestigeConfig>): void {
    if (envelope.kind === 'eras') {
        structured.eras.push(envelope as ConfigEnvelope<'eras', EraConfig>);
        return;
    }

    if (envelope.kind === 'producers') {
        structured.producers.push(envelope as ConfigEnvelope<'producers', ProducerConfig>);
        return;
    }

    if (envelope.kind === 'breakthroughs') {
        structured.breakthroughs.push(envelope as ConfigEnvelope<'breakthroughs', BreakthroughConfig>);
        return;
    }

    if (envelope.kind === 'milestones') {
        structured.milestones.push(envelope as ConfigEnvelope<'milestones', ProducerMilestoneConfig>);
        return;
    }

    if (envelope.kind === 'permanent_upgrades') {
        structured.permanentUpgrades.push(envelope as ConfigEnvelope<'permanent_upgrades', PermanentUpgradeConfig>);
        return;
    }

    structured.prestige.push(envelope as ConfigEnvelope<'prestige', PrestigeConfig>);
}

function getAllEnvelopes(config: StructuredConfigSet): ConfigEnvelope<ConfigFileKind, unknown>[] {
    return [
        ...config.eras,
        ...config.producers,
        ...config.breakthroughs,
        ...config.milestones,
        ...config.permanentUpgrades,
        ...config.prestige,
    ].sort(compareEnvelope);
}

function collectIds<TItem extends { id: string }>(envelopes: ConfigEnvelope<ConfigFileKind, TItem>[]): Set<string> {
    return new Set(envelopes.flatMap((envelope) => envelope.items.map((item) => item.id)));
}

function recordId(kind: ConfigFileKind, id: string, filePath: string, itemPath: string, idsByKind: Map<ConfigFileKind, Map<string, string>>): string | undefined {
    if (!idsByKind.has(kind)) {
        idsByKind.set(kind, new Map());
    }

    const pathById = idsByKind.get(kind);
    const existingPath = pathById?.get(id);
    if (existingPath !== undefined) {
        return existingPath;
    }

    pathById?.set(id, `${filePath} ${itemPath}.id`);
    return undefined;
}

function readString(value: Record<string, unknown>, fieldName: string, filePath: string, parentPath: string, diagnostics: ConfigDiagnostic[]): string | undefined {
    const fieldPath = `${parentPath}.${fieldName}`;
    if (!(fieldName in value)) {
        diagnostics.push(makeDiagnostic('structural', 'CONFIG_REQUIRED_FIELD', filePath, fieldPath, `${fieldName} is required.`));
        return undefined;
    }

    if (typeof value[fieldName] !== 'string') {
        diagnostics.push(makeDiagnostic('structural', 'CONFIG_INVALID_TYPE', filePath, fieldPath, `${fieldName} must be a string.`));
        return undefined;
    }

    return value[fieldName];
}

function readNumber(value: Record<string, unknown>, fieldName: string, filePath: string, parentPath: string, diagnostics: ConfigDiagnostic[]): number | undefined {
    const fieldPath = `${parentPath}.${fieldName}`;
    if (!(fieldName in value)) {
        diagnostics.push(makeDiagnostic('structural', 'CONFIG_REQUIRED_FIELD', filePath, fieldPath, `${fieldName} is required.`));
        return undefined;
    }

    if (typeof value[fieldName] !== 'number' || !Number.isFinite(value[fieldName])) {
        diagnostics.push(makeDiagnostic('structural', 'CONFIG_INVALID_TYPE', filePath, fieldPath, `${fieldName} must be a finite number.`));
        return undefined;
    }

    return value[fieldName];
}

function readBoolean(value: Record<string, unknown>, fieldName: string, filePath: string, parentPath: string, diagnostics: ConfigDiagnostic[]): boolean | undefined {
    const fieldPath = `${parentPath}.${fieldName}`;
    if (!(fieldName in value)) {
        diagnostics.push(makeDiagnostic('structural', 'CONFIG_REQUIRED_FIELD', filePath, fieldPath, `${fieldName} is required.`));
        return undefined;
    }

    if (typeof value[fieldName] !== 'boolean') {
        diagnostics.push(makeDiagnostic('structural', 'CONFIG_INVALID_TYPE', filePath, fieldPath, `${fieldName} must be a boolean.`));
        return undefined;
    }

    return value[fieldName];
}

function readOptionalStringArray(value: Record<string, unknown>, fieldName: string, filePath: string, parentPath: string, diagnostics: ConfigDiagnostic[]): string[] | undefined {
    const fieldPath = `${parentPath}.${fieldName}`;
    if (!(fieldName in value)) {
        return [];
    }

    const fieldValue = value[fieldName];
    if (!Array.isArray(fieldValue)) {
        diagnostics.push(makeDiagnostic('structural', 'CONFIG_EXPECTED_ARRAY', filePath, fieldPath, `${fieldName} must be an array.`));
        return undefined;
    }

    const result: string[] = [];
    for (let index = 0; index < fieldValue.length; index += 1) {
        if (typeof fieldValue[index] !== 'string') {
            diagnostics.push(makeDiagnostic('structural', 'CONFIG_INVALID_TYPE', filePath, `${fieldPath}[${index}]`, `${fieldName} entries must be strings.`));
            continue;
        }
        result.push(fieldValue[index]);
    }

    return result;
}

function validateAllowedKeys(stage: ConfigStage, filePath: string, configPath: string, value: Record<string, unknown>, allowedKeys: string[], diagnostics: ConfigDiagnostic[]): void {
    const allowed = new Set(allowedKeys);
    for (const key of Object.keys(value).sort()) {
        if (!allowed.has(key)) {
            diagnostics.push(makeDiagnostic(stage, 'CONFIG_UNKNOWN_FIELD', filePath, `${configPath}.${key}`, `Unknown field "${key}".`));
        }
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isConfigFileKind(value: unknown): value is ConfigFileKind {
    return typeof value === 'string' && SUPPORTED_CONFIG_KINDS.includes(value as ConfigFileKind);
}

function sortSources(sources: ConfigFileSource[]): ConfigFileSource[] {
    return sources.slice().sort((left, right) => normalizePath(left.filePath).localeCompare(normalizePath(right.filePath)));
}

function sortDiagnostics(diagnostics: ConfigDiagnostic[]): ConfigDiagnostic[] {
    return diagnostics.slice().sort((left, right) => {
        const fileCompare = normalizePath(left.filePath).localeCompare(normalizePath(right.filePath));
        if (fileCompare !== 0) {
            return fileCompare;
        }

        const pathCompare = left.configPath.localeCompare(right.configPath);
        if (pathCompare !== 0) {
            return pathCompare;
        }

        return left.code.localeCompare(right.code);
    });
}

function compareFilePath(left: ParsedConfigFile, right: ParsedConfigFile): number {
    return normalizePath(left.filePath).localeCompare(normalizePath(right.filePath));
}

function compareEnvelope(left: ConfigEnvelope<ConfigFileKind, unknown>, right: ConfigEnvelope<ConfigFileKind, unknown>): number {
    return normalizePath(left.filePath).localeCompare(normalizePath(right.filePath));
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
}

function makeDiagnostic(stage: ConfigStage, code: string, filePath: string, configPath: string, message: string): ConfigDiagnostic {
    return {
        stage,
        code,
        filePath: filePath || EMPTY_FILE_PATH,
        configPath,
        message,
    };
}

function freezePlainObject<T>(value: T): T {
    if (Array.isArray(value)) {
        for (const item of value) {
            freezePlainObject(item);
        }
        return Object.freeze(value.slice()) as T;
    }

    if (isPlainObject(value)) {
        for (const item of Object.values(value)) {
            freezePlainObject(item);
        }
        return Object.freeze(value);
    }

    return value;
}
