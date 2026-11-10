import {
    loadGameConfigFromSources,
    type ConfigFileSource,
    type GameConfigRepository,
} from '../config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../config/EmbeddedEconomyConfig.ts';
import {
    AtomicSaveRepository,
    PersistenceCoordinator,
    type DirtySavePolicy,
    type SaveStorage,
} from '../persistence/index.ts';
import type { TimeService } from '../time/index.ts';
import {
    LifecycleSessionCoordinator,
    type LifecycleStartupResult,
} from './LifecycleSessionCoordinator.ts';

/**
 * AUT-INT-001 development build version written into save envelopes.
 * Single source until AUT-072 replaces it with the real release version.
 */
export const GAME_SESSION_DEV_GAME_VERSION = '0.1.0-dev';

export interface GameSessionBootstrapOptions {
    readonly storage: SaveStorage;
    readonly timeService: TimeService;
    /** Defaults to the economy config embedded from `data/economy`. */
    readonly configSources?: ConfigFileSource[];
    readonly dirtySavePolicy?: DirtySavePolicy;
}

export interface GameSessionBootstrapResult {
    readonly configRepository: GameConfigRepository;
    readonly startup: LifecycleStartupResult;
}

/**
 * Engine-free session startup: config → AtomicSaveRepository(storage) → PersistenceCoordinator
 * → LifecycleSessionCoordinator.startup. The returned session is the only source of truth.
 * Throws only when the config itself is invalid.
 */
export async function bootstrapGameSession(options: GameSessionBootstrapOptions): Promise<GameSessionBootstrapResult> {
    const configRepository = loadGameConfigFromSources(options.configSources ?? getEmbeddedEconomyConfigSources());
    const persistence = new PersistenceCoordinator({
        repository: new AtomicSaveRepository(options.storage),
        timeService: options.timeService,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: configRepository.contentVersion,
        dirtySavePolicy: options.dirtySavePolicy,
    });
    const startup = await LifecycleSessionCoordinator.startup({
        configRepository,
        persistence,
        timeService: options.timeService,
    });

    return Object.freeze({ configRepository, startup });
}
