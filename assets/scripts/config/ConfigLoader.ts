export type ConfigStage = 'parse' | 'structural' | 'cross-reference' | 'semantic' | 'repository';

export type ConfigFileKind = 'eras' | 'producers' | 'breakthroughs';

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

export interface ProducerLevelRequirement {
    producerId: string;
    level: number;
}

export interface BreakthroughPrerequisites {
    producerLevels: ProducerLevelRequirement[];
    breakthroughIds: string[];
}

export interface ProductionMultiplierEffect {
    type: 'productionMultiplier';
    multiplier: number;
}

export interface UnlockProducerEffect {
    type: 'unlockProducer';
    producerId: string;
}

export type BreakthroughEffect = ProductionMultiplierEffect | UnlockProducerEffect;

export interface BreakthroughConfig {
    id: string;
    displayNameKey: string;
    cost: number;
    prerequisites: BreakthroughPrerequisites;
    effects: BreakthroughEffect[];
}

export interface GameConfigRepositorySnapshot {
    schemaVersion: number;
    contentVersion: string;
    eras: EraConfig[];
    producers: ProducerConfig[];
    breakthroughs: BreakthroughConfig[];
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
}

interface StageResult<T> {
    value: T;
    diagnostics: ConfigDiagnostic[];
}

const CONFIG_SCHEMA_VERSION = 1;
const SUPPORTED_CONFIG_KINDS: ConfigFileKind[] = ['eras', 'producers', 'breakthroughs'];
const SUPPORTED_EFFECT_TYPES = ['productionMultiplier', 'unlockProducer'];
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

    constructor(snapshot: GameConfigRepositorySnapshot) {
        this.schemaVersion = snapshot.schemaVersion;
        this.contentVersion = snapshot.contentVersion;
        this.eraById = new Map(snapshot.eras.map((era) => [era.id, freezePlainObject(era)]));
        this.producerById = new Map(snapshot.producers.map((producer) => [producer.id, freezePlainObject(producer)]));
        this.breakthroughById = new Map(snapshot.breakthroughs.map((breakthrough) => [breakthrough.id, freezePlainObject(breakthrough)]));
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

    listEras(): EraConfig[] {
        return Array.from(this.eraById.values());
    }

    listProducers(): ProducerConfig[] {
        return Array.from(this.producerById.values());
    }

    listBreakthroughs(): BreakthroughConfig[] {
        return Array.from(this.breakthroughById.values());
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
            breakthrough.prerequisites.producerLevels.forEach((requirement, requirementIndex) => {
                if (!producerIds.has(requirement.producerId)) {
                    diagnostics.push(makeDiagnostic('cross-reference', 'CONFIG_UNKNOWN_REFERENCE', envelope.filePath, `${itemPath}.prerequisites.producerLevels[${requirementIndex}].producerId`, `Unknown producer id "${requirement.producerId}".`));
                }
            });

            breakthrough.prerequisites.breakthroughIds.forEach((breakthroughId, prerequisiteIndex) => {
                if (!breakthroughIds.has(breakthroughId)) {
                    diagnostics.push(makeDiagnostic('cross-reference', 'CONFIG_UNKNOWN_REFERENCE', envelope.filePath, `${itemPath}.prerequisites.breakthroughIds[${prerequisiteIndex}]`, `Unknown breakthrough id "${breakthroughId}".`));
                }
            });

            breakthrough.effects.forEach((effect, effectIndex) => {
                if (effect.type === 'unlockProducer' && !producerIds.has(effect.producerId)) {
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

function parseConfigItem(kind: ConfigFileKind, value: unknown, filePath: string, itemPath: string, diagnostics: ConfigDiagnostic[]): EraConfig | ProducerConfig | BreakthroughConfig | undefined {
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

    return parseBreakthroughConfig(value, filePath, itemPath, diagnostics);
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

function parseBreakthroughConfig(value: Record<string, unknown>, filePath: string, itemPath: string, diagnostics: ConfigDiagnostic[]): BreakthroughConfig | undefined {
    validateAllowedKeys('structural', filePath, itemPath, value, ['id', 'displayNameKey', 'cost', 'prerequisites', 'effects'], diagnostics);
    const id = readString(value, 'id', filePath, itemPath, diagnostics);
    const displayNameKey = readString(value, 'displayNameKey', filePath, itemPath, diagnostics);
    const cost = readNumber(value, 'cost', filePath, itemPath, diagnostics);
    const prerequisites = parsePrerequisites(value.prerequisites, filePath, `${itemPath}.prerequisites`, diagnostics);
    const effects = parseEffects(value.effects, filePath, `${itemPath}.effects`, diagnostics);

    if (id === undefined || displayNameKey === undefined || cost === undefined || prerequisites === undefined || effects === undefined) {
        return undefined;
    }

    return {
        id,
        displayNameKey,
        cost,
        prerequisites,
        effects,
    };
}

function parsePrerequisites(value: unknown, filePath: string, configPath: string, diagnostics: ConfigDiagnostic[]): BreakthroughPrerequisites | undefined {
    if (!isPlainObject(value)) {
        diagnostics.push(makeDiagnostic('structural', 'CONFIG_REQUIRED_FIELD', filePath, configPath, 'prerequisites must be an object.'));
        return undefined;
    }

    validateAllowedKeys('structural', filePath, configPath, value, ['producerLevels', 'breakthroughIds'], diagnostics);
    const producerLevels = parseProducerLevelRequirements(value.producerLevels, filePath, `${configPath}.producerLevels`, diagnostics);
    const breakthroughIds = readOptionalStringArray(value, 'breakthroughIds', filePath, configPath, diagnostics);

    if (producerLevels === undefined || breakthroughIds === undefined) {
        return undefined;
    }

    return { producerLevels, breakthroughIds };
}

function parseProducerLevelRequirements(value: unknown, filePath: string, configPath: string, diagnostics: ConfigDiagnostic[]): ProducerLevelRequirement[] | undefined {
    if (value === undefined) {
        return [];
    }

    if (!Array.isArray(value)) {
        diagnostics.push(makeDiagnostic('structural', 'CONFIG_EXPECTED_ARRAY', filePath, configPath, 'producerLevels must be an array.'));
        return undefined;
    }

    const requirements: ProducerLevelRequirement[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const itemPath = `${configPath}[${index}]`;
        const requirement = value[index];
        if (!isPlainObject(requirement)) {
            diagnostics.push(makeDiagnostic('structural', 'CONFIG_EXPECTED_OBJECT', filePath, itemPath, 'producer level requirement must be an object.'));
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

        validateAllowedKeys('structural', filePath, itemPath, effect, ['type', 'multiplier', 'producerId'], diagnostics);
        const type = readString(effect, 'type', filePath, itemPath, diagnostics);

        if (type === 'productionMultiplier') {
            const multiplier = readNumber(effect, 'multiplier', filePath, itemPath, diagnostics);
            if (multiplier !== undefined) {
                effects.push({ type, multiplier });
            }
            continue;
        }

        if (type === 'unlockProducer') {
            const producerId = readString(effect, 'producerId', filePath, itemPath, diagnostics);
            if (producerId !== undefined) {
                effects.push({ type, producerId });
            }
            continue;
        }

        if (type !== undefined) {
            effects.push({ type } as BreakthroughEffect);
        }
    }

    return effects;
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

    for (const envelope of config.breakthroughs) {
        envelope.items.forEach((breakthrough, index) => {
            if (breakthrough.cost <= 0) {
                diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].cost`, 'cost must be greater than 0.'));
            }

            breakthrough.prerequisites.producerLevels.forEach((requirement, requirementIndex) => {
                if (!Number.isInteger(requirement.level) || requirement.level <= 0) {
                    diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].prerequisites.producerLevels[${requirementIndex}].level`, 'producer prerequisite level must be a positive integer.'));
                }
            });

            breakthrough.effects.forEach((effect, effectIndex) => {
                if (effect.type === 'productionMultiplier' && effect.multiplier <= 0) {
                    diagnostics.push(makeDiagnostic('semantic', 'CONFIG_INVALID_NUMBER', envelope.filePath, `$.items[${index}].effects[${effectIndex}].multiplier`, 'production multiplier must be greater than 0.'));
                }
            });
        });
    }
}

function validateKnownEffectTypes(config: StructuredConfigSet, diagnostics: ConfigDiagnostic[]): void {
    for (const envelope of config.breakthroughs) {
        envelope.items.forEach((breakthrough, index) => {
            breakthrough.effects.forEach((effect, effectIndex) => {
                if (!SUPPORTED_EFFECT_TYPES.includes(effect.type)) {
                    diagnostics.push(makeDiagnostic('semantic', 'CONFIG_UNKNOWN_EFFECT_TYPE', envelope.filePath, `$.items[${index}].effects[${effectIndex}].type`, `Unsupported effect type "${effect.type}".`));
                }
            });
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
            breakthroughGraph.set(breakthrough.id, breakthrough.prerequisites.breakthroughIds);
            breakthroughFileById.set(breakthrough.id, { filePath: envelope.filePath, index });
        });
    }

    for (const cycle of findCycles(breakthroughGraph)) {
        const owner = breakthroughFileById.get(cycle[0]);
        diagnostics.push(makeDiagnostic(
            'semantic',
            'CONFIG_REFERENCE_CYCLE',
            owner?.filePath ?? EMPTY_FILE_PATH,
            owner === undefined ? '$.breakthroughs' : `$.items[${owner.index}].prerequisites.breakthroughIds`,
            `Breakthrough prerequisite cycle detected: ${cycle.join(' -> ')}.`,
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

function pushEnvelope(structured: StructuredConfigSet, envelope: ConfigEnvelope<ConfigFileKind, EraConfig | ProducerConfig | BreakthroughConfig>): void {
    if (envelope.kind === 'eras') {
        structured.eras.push(envelope as ConfigEnvelope<'eras', EraConfig>);
        return;
    }

    if (envelope.kind === 'producers') {
        structured.producers.push(envelope as ConfigEnvelope<'producers', ProducerConfig>);
        return;
    }

    structured.breakthroughs.push(envelope as ConfigEnvelope<'breakthroughs', BreakthroughConfig>);
}

function getAllEnvelopes(config: StructuredConfigSet): ConfigEnvelope<ConfigFileKind, unknown>[] {
    return [
        ...config.eras,
        ...config.producers,
        ...config.breakthroughs,
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
