import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import type { GameState } from '../state/GameState.ts';
import type { GameCommand } from '../domain/Commands.ts';
import {
    calculateMaxAffordableProducerProgressionPurchase,
    calculateProducerProgressionPurchase,
    calculateSustainedProducerProductionRateContributions,
    evaluateProducerBuildProgression,
    getProgressionProducerLevel,
} from '../progression/index.ts';
import { isProducerCostAffordable } from '../economy/ProducerCost.ts';
import { formatCompactNumber } from './NumberFormatter.ts';

export type ProducerPanelActionId = 'x1' | 'x10' | 'xMax';
export type ProducerPanelAvailability = 'available' | 'unavailable' | 'locked' | 'completed';

export interface ProducerPanelPurchaseAction {
    readonly id: ProducerPanelActionId;
    readonly labelKey: 'producer_panel.buy_1' | 'producer_panel.buy_10' | 'producer_panel.buy_max';
    readonly quantity: number;
    readonly cost: number;
    readonly costFormatted: string;
    readonly isAffordable: boolean;
    readonly isEnabled: boolean;
    readonly command: GameCommand | null;
}

export interface ProducerPanelMilestonePreview {
    readonly state: 'next' | 'complete';
    readonly nextThreshold: number | null;
    readonly levelsRemaining: number | null;
    readonly benefit: { readonly multiplier: number; readonly descriptorKey: string } | null;
}

export interface ProducerPanelViewModel {
    readonly selectedProducerId: string | null;
    readonly displayNameKey: string | null;
    readonly level: number;
    readonly status: ProducerPanelAvailability;
    readonly productionPerSecond: number;
    readonly productionPerSecondFormatted: string;
    readonly industrialOutput: number;
    readonly industrialOutputFormatted: string;
    readonly milestone: ProducerPanelMilestonePreview | null;
    readonly actions: Readonly<Record<ProducerPanelActionId, ProducerPanelPurchaseAction>> | null;
}

const EMPTY_ACTIONS: ProducerPanelViewModel['actions'] = null;

/** Pure presentation projection. It never mutates the supplied authoritative state. */
export function createProducerPanelViewModel(
    repository: GameConfigRepository,
    state: GameState,
    selectedProducerId: string | null,
): ProducerPanelViewModel {
    if (selectedProducerId === null) return emptyPanel();

    const producer = repository.getProducer(selectedProducerId);
    const level = getProgressionProducerLevel(state, selectedProducerId);
    if (!producer) return emptyPanel(selectedProducerId, level);

    const build = evaluateProducerBuildProgression(repository, state, selectedProducerId);
    const isLocked = build.status === 'locked';
    const isBuilt = build.status === 'already_built' || level > 0;
    const status: ProducerPanelAvailability = isLocked ? 'locked' : isBuilt ? 'available' : 'available';
    const production = calculateSustainedProducerProductionRateContributions(repository, state, { producerScope: 'all', temporaryBoosts: 'include' })
        .find((entry) => entry.producerId === selectedProducerId)?.productionPerSecond ?? 0;
    const milestone = resolveMilestonePreview(repository.listMilestones(), level);
    const actions = isLocked ? EMPTY_ACTIONS : createActions(repository, state, selectedProducerId, level);

    return Object.freeze({
        selectedProducerId,
        displayNameKey: producer.displayNameKey,
        level,
        status,
        productionPerSecond: production,
        productionPerSecondFormatted: formatCompactNumber(production),
        industrialOutput: state.run.industrialOutput,
        industrialOutputFormatted: formatCompactNumber(state.run.industrialOutput),
        milestone,
        actions,
    });
}

export const buildProducerPanelViewModel = createProducerPanelViewModel;

function createActions(
    repository: GameConfigRepository,
    state: GameState,
    producerId: string,
    level: number,
): ProducerPanelViewModel['actions'] {
    const producer = repository.getProducer(producerId)!;
    const one = calculateProducerProgressionPurchase(repository, state.meta, producer, level, 1);
    const ten = calculateProducerProgressionPurchase(repository, state.meta, producer, level, 10);
    const max = calculateMaxAffordableProducerProgressionPurchase(repository, state.meta, producer, level, state.run.industrialOutput);
    return Object.freeze({
        x1: action('x1', 'producer_panel.buy_1', one.quantity, one.cost, state.run.industrialOutput, producerId),
        x10: action('x10', 'producer_panel.buy_10', ten.quantity, ten.cost, state.run.industrialOutput, producerId),
        xMax: action('xMax', 'producer_panel.buy_max', max.quantity, max.cost, state.run.industrialOutput, producerId, max.quantity > 0),
    });
}

function action(
    id: ProducerPanelActionId,
    labelKey: ProducerPanelPurchaseAction['labelKey'],
    quantity: number,
    cost: number,
    balance: number,
    producerId: string,
    hasResolvedMax = true,
): ProducerPanelPurchaseAction {
    const isAffordable = isProducerCostAffordable(cost, balance) && hasResolvedMax;
    return Object.freeze({
        id, labelKey, quantity, cost, costFormatted: formatCompactNumber(cost), isAffordable,
        isEnabled: isAffordable,
        command: isAffordable
            ? id === 'xMax' ? { type: 'buyMaxProducerLevels', producerId } : { type: 'buyProducerLevels', producerId, quantity }
            : null,
    });
}

function resolveMilestonePreview(milestones: readonly { threshold: number; productionMultiplier: number }[], level: number): ProducerPanelMilestonePreview {
    const next = milestones.find((milestone) => milestone.threshold > level);
    if (!next) return { state: 'complete', nextThreshold: null, levelsRemaining: null, benefit: null };
    return {
        state: 'next',
        nextThreshold: next.threshold,
        levelsRemaining: next.threshold - level,
        benefit: { multiplier: next.productionMultiplier, descriptorKey: 'producer_panel.milestone.production_multiplier' },
    };
}

function emptyPanel(selectedProducerId: string | null = null, level = 0): ProducerPanelViewModel {
    return Object.freeze({ selectedProducerId, displayNameKey: null, level, status: 'unavailable', productionPerSecond: 0, productionPerSecondFormatted: formatCompactNumber(0), industrialOutput: 0, industrialOutputFormatted: formatCompactNumber(0), milestone: null, actions: EMPTY_ACTIONS });
}
