import type { GameState } from '../state/GameState.ts';
import { cloneGameState } from '../state/StateClone.ts';
import type { TimeService, UtcTimestampIsoString } from '../time/index.ts';
import {
    createSaveEnvelopeMetadataFromClock,
} from '../time/index.ts';
import type {
    AtomicSaveRepository,
    LoadGameResult,
    SaveGameResult,
} from './AtomicSaveRepository.ts';
import {
    DEFAULT_DIRTY_SAVE_POLICY,
    DirtySaveTracker,
    type DirtySaveDecision,
    type DirtySavePolicy,
} from './DirtySaveScheduler.ts';
import {
    CURRENT_SAVE_VERSION,
    type SaveEnvelopeMetadata,
} from './SaveEnvelope.ts';

export type PersistenceSaveIntent = 'ordinary' | 'critical';
export type PersistenceSaveReason =
    | 'dirty_tick'
    | 'runtime_command'
    | 'suspend'
    | 'offline_collect'
    | 'reboot'
    | 'permanent_upgrade_purchase'
    | 'manual';

export interface PersistenceCoordinatorOptions {
    readonly repository: AtomicSaveRepository;
    readonly timeService: TimeService;
    readonly gameVersion: string;
    readonly contentVersion: string;
    readonly dirtySavePolicy?: DirtySavePolicy;
}

export interface PersistenceSaveRequest {
    readonly intent: PersistenceSaveIntent;
    readonly reason: PersistenceSaveReason;
    readonly savedAtUtcIso?: UtcTimestampIsoString;
    readonly markDirty?: boolean;
}

export interface PersistenceSaveSkippedResult {
    readonly ok: true;
    readonly status: 'skipped';
    readonly intent: PersistenceSaveIntent;
    readonly reason: PersistenceSaveReason;
    readonly decision: DirtySaveDecision;
}

export interface PersistenceSaveCompletedResult {
    readonly ok: true;
    readonly status: 'saved';
    readonly intent: PersistenceSaveIntent;
    readonly reason: PersistenceSaveReason;
    readonly decision: DirtySaveDecision;
    readonly save: SaveGameResult & { readonly ok: true };
}

export interface PersistenceSaveFailedResult {
    readonly ok: false;
    readonly status: 'failed';
    readonly intent: PersistenceSaveIntent;
    readonly reason: PersistenceSaveReason;
    readonly decision: DirtySaveDecision;
    readonly save: SaveGameResult & { readonly ok: false };
}

export type PersistenceSaveResult =
    | PersistenceSaveSkippedResult
    | PersistenceSaveCompletedResult
    | PersistenceSaveFailedResult;

interface QueuedSaveRequest {
    readonly state: GameState;
    readonly request: PersistenceSaveRequest;
}

export class PersistenceCoordinator {
    private readonly repository: AtomicSaveRepository;
    private readonly timeService: TimeService;
    private readonly gameVersion: string;
    private readonly contentVersion: string;
    private readonly dirtySavePolicy: DirtySavePolicy;
    private readonly dirtyTracker: DirtySaveTracker;
    private saveQueue: Promise<void> = Promise.resolve();

    constructor(options: PersistenceCoordinatorOptions) {
        this.repository = options.repository;
        this.timeService = options.timeService;
        this.gameVersion = options.gameVersion;
        this.contentVersion = options.contentVersion;
        this.dirtySavePolicy = options.dirtySavePolicy ?? DEFAULT_DIRTY_SAVE_POLICY;
        this.dirtyTracker = new DirtySaveTracker(this.timeService.nowMonotonicSeconds());
    }

    async load(): Promise<LoadGameResult> {
        return this.repository.load();
    }

    markDirty(): void {
        this.dirtyTracker.markDirty(this.timeService.nowMonotonicSeconds());
    }

    async requestSave(state: GameState, request: PersistenceSaveRequest): Promise<PersistenceSaveResult> {
        const queued: QueuedSaveRequest = Object.freeze({
            state: cloneGameState(state),
            request: Object.freeze({ ...request }),
        });

        const result = this.saveQueue.then(() => this.executeSaveRequest(queued));
        this.saveQueue = result.then(
            () => undefined,
            () => undefined,
        );

        return result;
    }

    private async executeSaveRequest(queued: QueuedSaveRequest): Promise<PersistenceSaveResult> {
        const currentMonotonicSeconds = this.timeService.nowMonotonicSeconds();
        if (queued.request.markDirty === true) {
            this.dirtyTracker.markDirty(currentMonotonicSeconds);
        }

        const isCritical = queued.request.intent === 'critical';
        const decision = this.dirtyTracker.shouldSave(
            currentMonotonicSeconds,
            this.dirtySavePolicy,
            { critical: isCritical },
        );

        if (!decision.shouldSave) {
            return Object.freeze({
                ok: true as const,
                status: 'skipped' as const,
                intent: queued.request.intent,
                reason: queued.request.reason,
                decision,
            });
        }

        const save = await this.repository.save(queued.state, this.createMetadata(queued.request.savedAtUtcIso));
        if (save.ok) {
            this.dirtyTracker.recordSaveSucceeded(this.timeService.nowMonotonicSeconds());
            return Object.freeze({
                ok: true as const,
                status: 'saved' as const,
                intent: queued.request.intent,
                reason: queued.request.reason,
                decision,
                save,
            });
        }

        this.dirtyTracker.recordSaveFailed();
        return Object.freeze({
            ok: false as const,
            status: 'failed' as const,
            intent: queued.request.intent,
            reason: queued.request.reason,
            decision,
            save,
        });
    }

    private createMetadata(savedAtUtcIso: UtcTimestampIsoString | undefined): SaveEnvelopeMetadata {
        if (savedAtUtcIso === undefined) {
            return createSaveEnvelopeMetadataFromClock(this.timeService, {
                gameVersion: this.gameVersion,
                contentVersion: this.contentVersion,
            });
        }

        return Object.freeze({
            saveVersion: CURRENT_SAVE_VERSION,
            gameVersion: this.gameVersion,
            contentVersion: this.contentVersion,
            savedAtUtc: savedAtUtcIso,
        });
    }
}
