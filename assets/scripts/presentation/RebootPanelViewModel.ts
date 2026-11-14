import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import type { GameCommand } from '../domain/Commands.ts';
import type { LifecycleCommandResult } from '../lifecycle/LifecycleSessionCoordinator.ts';
import { getDefaultTextCatalogue, type TextCatalogue } from '../localization/index.ts';
import { createPrestigePreview, createRebootPreview, type RebootPreview } from '../progression/index.ts';
import type { GameState } from '../state/GameState.ts';

/**
 * AUT-RBT-001 pure view model of the Reboot entry chip and the confirmation modal (engine-free). It READS the authoritative
 * `createRebootPreview` (eligibility, Civilization numbers, AI Cores to gain, progress to the next Core) and formats strings through the keyed
 * catalogue. It never touches the reward formula or the prestige config: the percent is `Math.round(progressToNextCore * 100)` (formatting only),
 * and availability is exactly "the projected reward is positive" (`eligibility === 'eligible'`).
 *
 * Refresh cost: the binding refreshes sinks about once per frame, and `createRebootPreview` clones and validates the whole state. A cheap first
 * stage (`createPrestigePreview(...).currentAiCoreReward > 0`, no clone) runs every call; the full preview runs only when that stage says
 * eligible and its result is memoized on (run.prestigePowerPeak, meta.aiCores, meta.civilizationNumber), the only inputs the view model reads.
 *
 * The command is the existing `{ type: 'rebootCivilization', confirmed: true }`; it is carried only while the Reboot is eligible.
 */

export interface RebootPanelTexts {
    readonly chip: string;
    readonly title: string;
    /** "+5 AI CORES" / "+1 AI CORE". */
    readonly reward: string;
    /** "Civilization #1 to #2". */
    readonly civilization: string;
    /** "Next AI Core 37%". */
    readonly progress: string;
    readonly resetsHeader: string;
    readonly keepsHeader: string;
    readonly confirm: string;
    readonly cancel: string;
    /** The short note shown in the civilization line slot after a failed Reboot. */
    readonly failed: string;
}

export interface RebootPanelViewModel {
    /** Entry chip visibility and modal availability: the Reboot is eligible (the projected AI Core reward is positive). */
    readonly visible: boolean;
    readonly aiCoresToGain: number;
    readonly currentAiCores: number;
    readonly resultingAiCores: number;
    readonly currentCivilization: number;
    readonly resultingCivilization: number;
    /** Progress toward the next AI Core, 0..1 (as the authoritative preview reports it). */
    readonly progressRatio: number;
    /** Whole percent for display: rounded, clamped to 0..100. */
    readonly progressPercent: number;
    readonly texts: RebootPanelTexts;
    /** What the Reboot resets (five short lines). */
    readonly resets: readonly string[];
    /** What the Reboot keeps (five short lines). */
    readonly persists: readonly string[];
    /** The existing confirmed Reboot command; null while the Reboot is not eligible. */
    readonly command: GameCommand | null;
}

/** Catalogue keys of the RESETS column, in display order (GAME_DESIGN section 12 / ECONOMY section 14). */
export const REBOOT_RESET_KEYS: readonly string[] = Object.freeze([
    'reboot.reset.output',
    'reboot.reset.producers',
    'reboot.reset.breakthroughs',
    'reboot.reset.era',
    'reboot.reset.boosts',
]);

/** Catalogue keys of the KEEPS column, in display order. */
export const REBOOT_KEEP_KEYS: readonly string[] = Object.freeze([
    'reboot.keep.cores',
    'reboot.keep.upgrades',
    'reboot.keep.civilization',
    'reboot.keep.records',
    'reboot.keep.account',
]);

interface RebootMemo {
    readonly repository: GameConfigRepository;
    readonly catalogue: TextCatalogue;
    readonly peak: number;
    readonly aiCores: number;
    readonly civilization: number;
    readonly model: RebootPanelViewModel;
}

let memo: RebootMemo | null = null;
/** The not-eligible model is memoized too (it is what almost every frame returns): keyed on the two state inputs it shows. */
let hiddenMemo: { readonly repository: GameConfigRepository; readonly catalogue: TextCatalogue; readonly aiCores: number; readonly civilization: number; readonly model: RebootPanelViewModel } | null = null;

function wholeCount(value: number): number {
    return Number.isFinite(value) ? Math.floor(value) : 0;
}

function hiddenModel(state: GameState, catalogue: TextCatalogue): RebootPanelViewModel {
    return Object.freeze({
        visible: false,
        aiCoresToGain: 0,
        currentAiCores: state.meta.aiCores,
        resultingAiCores: state.meta.aiCores,
        currentCivilization: state.meta.civilizationNumber,
        resultingCivilization: state.meta.civilizationNumber,
        progressRatio: 0,
        progressPercent: 0,
        texts: composeTexts(catalogue, 0, state.meta.civilizationNumber, state.meta.civilizationNumber, 0),
        resets: Object.freeze(REBOOT_RESET_KEYS.map((key) => catalogue.resolveText(key))),
        persists: Object.freeze(REBOOT_KEEP_KEYS.map((key) => catalogue.resolveText(key))),
        command: null,
    });
}

function composeTexts(catalogue: TextCatalogue, aiCoresToGain: number, from: number, to: number, percent: number): RebootPanelTexts {
    const count = wholeCount(aiCoresToGain);
    return Object.freeze({
        chip: catalogue.resolveText('reboot.chip', { count }),
        title: catalogue.resolveText('reboot.title'),
        reward: count === 1 ? catalogue.resolveText('reboot.reward_single') : catalogue.resolveText('reboot.reward', { count }),
        civilization: catalogue.resolveText('reboot.civilization', { from, to }),
        progress: catalogue.resolveText('reboot.progress', { percent }),
        resetsHeader: catalogue.resolveText('reboot.resets_header'),
        keepsHeader: catalogue.resolveText('reboot.keeps_header'),
        confirm: catalogue.resolveText('reboot.confirm'),
        cancel: catalogue.resolveText('reboot.cancel'),
        failed: catalogue.resolveText('reboot.failed'),
    });
}

function eligibleModel(preview: RebootPreview, catalogue: TextCatalogue): RebootPanelViewModel {
    const progressRatio = preview.prestigePreview.progressToNextCore;
    const progressPercent = Math.min(100, Math.max(0, Math.round(progressRatio * 100)));
    return Object.freeze({
        visible: true,
        aiCoresToGain: preview.aiCoresToGain,
        currentAiCores: preview.currentAiCores,
        resultingAiCores: preview.resultingAiCores,
        currentCivilization: preview.currentCivilization,
        resultingCivilization: preview.resultingCivilization,
        progressRatio,
        progressPercent,
        texts: composeTexts(catalogue, preview.aiCoresToGain, preview.currentCivilization, preview.resultingCivilization, progressPercent),
        resets: Object.freeze(REBOOT_RESET_KEYS.map((key) => catalogue.resolveText(key))),
        persists: Object.freeze(REBOOT_KEEP_KEYS.map((key) => catalogue.resolveText(key))),
        command: Object.freeze({ type: 'rebootCivilization', confirmed: true } as const),
    });
}

export function createRebootPanelViewModel(
    repository: GameConfigRepository,
    state: GameState,
    catalogue: TextCatalogue = getDefaultTextCatalogue(),
): RebootPanelViewModel {
    // Cheap stage: no clone, no validation. The Reboot is eligible exactly when the projected reward is positive.
    if (createPrestigePreview(repository, state).currentAiCoreReward <= 0) {
        const aiCoresNow = state.meta.aiCores;
        const civilizationNow = state.meta.civilizationNumber;
        const hidden = hiddenMemo;
        if (hidden !== null && hidden.repository === repository && hidden.catalogue === catalogue && hidden.aiCores === aiCoresNow && hidden.civilization === civilizationNow) return hidden.model;
        const model = hiddenModel(state, catalogue);
        hiddenMemo = { repository, catalogue, aiCores: aiCoresNow, civilization: civilizationNow, model };
        return model;
    }
    const peak = state.run.prestigePowerPeak;
    const aiCores = state.meta.aiCores;
    const civilization = state.meta.civilizationNumber;
    const cached = memo;
    if (cached !== null && cached.repository === repository && cached.catalogue === catalogue
        && cached.peak === peak && cached.aiCores === aiCores && cached.civilization === civilization) return cached.model;
    const preview = createRebootPreview(repository, state);
    const model = preview.eligibility === 'eligible' ? eligibleModel(preview, catalogue) : hiddenModel(state, catalogue);
    memo = { repository, catalogue, peak, aiCores, civilization, model };
    return model;
}

// ---- result mapping (pure; the controller only applies it) ----

export type RebootResultStatus = 'rebooted' | 'rebooted_persistence_failed' | 'blocked_pending_offline' | 'rejected' | 'error';

export interface RebootResultOutcome {
    readonly status: RebootResultStatus;
    /** The rejection reason of the runtime when it refused the command; null otherwise. */
    readonly reason: string | null;
    /** `save.ok` of the result; null when no save was attempted (rejection / null result). */
    readonly saveOk: boolean | null;
    readonly eventTypes: readonly string[];
    /** The modal closes now (the Reboot happened, or the pending offline report took over the screen). */
    readonly closeModal: boolean;
    /** The modal stays open with the short failure note and the buttons enabled again. */
    readonly showFailureNote: boolean;
}

/**
 * Maps what `binding.submit` returned for the confirmed Reboot.
 * - an accepted command: `rebooted` (the durable `rebootCompleted` event starts the AUT-049 sequence from the event stream) or, when the save
 *   failed (`save.ok === false`), `rebooted_persistence_failed` (state changed, no `rebootCompleted`, never claims durability);
 * - null with `blockedByPendingOffline` (the binding's callback ran): `blocked_pending_offline`, close so the offline card is not stacked;
 * - null without it: an exception inside submit: `error`, stay open with the note;
 * - a refused command (`execution.ok === false`, no save): `rejected`, stay open with the same note.
 */
export function resolveRebootResult(result: LifecycleCommandResult | null, blockedByPendingOffline: boolean): RebootResultOutcome {
    if (result === null) {
        return blockedByPendingOffline
            ? Object.freeze({ status: 'blocked_pending_offline', reason: null, saveOk: null, eventTypes: Object.freeze([]), closeModal: true, showFailureNote: false })
            : Object.freeze({ status: 'error', reason: null, saveOk: null, eventTypes: Object.freeze([]), closeModal: false, showFailureNote: true });
    }
    const execution = result.execution;
    const saveOk = result.save ? result.save.ok : null;
    if (!execution.ok) {
        return Object.freeze({ status: 'rejected', reason: execution.reason, saveOk, eventTypes: Object.freeze([]), closeModal: false, showFailureNote: true });
    }
    const eventTypes = Object.freeze(execution.events.map((event) => event.type));
    if (saveOk === false) {
        return Object.freeze({ status: 'rebooted_persistence_failed', reason: null, saveOk, eventTypes, closeModal: true, showFailureNote: false });
    }
    return Object.freeze({ status: 'rebooted', reason: null, saveOk, eventTypes, closeModal: true, showFailureNote: false });
}
