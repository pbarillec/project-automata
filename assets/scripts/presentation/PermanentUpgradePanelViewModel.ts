import type { GameConfigRepository, PermanentUpgradeBranch, PermanentUpgradeConfig, PermanentUpgradeEffect } from '../config/ConfigLoader.ts';
import type { GameCommand } from '../domain/Commands.ts';
import { getDefaultTextCatalogue, type TextCatalogue } from '../localization/index.ts';
import { evaluatePermanentUpgradeRankState, type PermanentUpgradeRankState } from '../progression/index.ts';
import type { GameState } from '../state/GameState.ts';
import { shouldShowRelaySocket } from './RebootPresentation.ts';

/**
 * AUT-050 pure view model of the AI Upgrades panel (engine-free). It READS the authoritative rank state
 * (`evaluatePermanentUpgradeRankState`: status, ranks, next cost, missing prerequisites) and the AI Core balance and composes
 * display strings through the keyed catalogue. It never recomputes a rank, a cost or a prerequisite and never derives a cumulative
 * effect: effect lines only format the raw per-rank numbers read from the config (no multiplying, no compounding).
 * Purchases are the existing `purchasePermanentUpgrade` command, carried on the row only while it is affordable.
 */

export type PermanentUpgradeRowState = 'affordable' | 'insufficient' | 'maxed' | 'locked';

export const PERMANENT_UPGRADE_BRANCH_ORDER: readonly PermanentUpgradeBranch[] = Object.freeze(['production', 'automation', 'expansion']);

export interface PermanentUpgradeMissingPrerequisiteView {
    readonly upgradeId: string;
    readonly name: string;
    readonly requiredRank: number;
    readonly currentRank: number;
    /** "Needs Optimized Fabrication rank 2". */
    readonly text: string;
}

export interface PermanentUpgradeRowViewModel {
    readonly id: string;
    readonly branch: PermanentUpgradeBranch;
    readonly nameKey: string;
    readonly name: string;
    readonly currentRank: number;
    readonly maxRank: number;
    /** Authoritative cost of the next rank (null once maxed). */
    readonly nextRankCost: number | null;
    readonly state: PermanentUpgradeRowState;
    readonly rankText: string;
    /** One or two lines separated by "\n" (never cumulative totals). */
    readonly effectText: string;
    /** Caption of the buy slot: "<cost> AI", "MAX" or "LOCKED". */
    readonly buyText: string;
    /** "Needs <Name> rank N" (first missing prerequisite) for a locked row, else null. */
    readonly lockedText: string | null;
    readonly missingPrerequisites: readonly PermanentUpgradeMissingPrerequisiteView[];
    /** The existing purchase command; non-null only while the row is `affordable` (insufficient / maxed / locked rows are inert). */
    readonly command: GameCommand | null;
}

export interface PermanentUpgradeBranchViewModel {
    readonly id: PermanentUpgradeBranch;
    readonly label: string;
    /** Something in this branch is affordable right now (the tab shows a small cyan dot). */
    readonly canBuy: boolean;
    readonly rowIds: readonly string[];
}

export interface PermanentUpgradePanelTexts {
    readonly title: string;
    readonly close: string;
    readonly chip: string;
    /** "x 6" next to the AI mark in the panel header. */
    readonly balance: string;
    readonly purchaseFailed: string;
}

export interface PermanentUpgradePanelViewModel {
    readonly aiCores: number;
    readonly civilization: number;
    /** Entry chip visibility: the same rule as the persistent relay socket (`shouldShowRelaySocket`). */
    readonly chipVisible: boolean;
    readonly texts: PermanentUpgradePanelTexts;
    readonly rows: readonly PermanentUpgradeRowViewModel[];
    readonly branches: readonly PermanentUpgradeBranchViewModel[];
}

export function formatAiCoreChipText(aiCores: number, catalogue: TextCatalogue = getDefaultTextCatalogue()): string {
    return catalogue.resolveText('upgrades.chip', { count: wholeCount(aiCores) });
}

export function createPermanentUpgradePanelViewModel(
    repository: GameConfigRepository,
    state: GameState,
    catalogue: TextCatalogue = getDefaultTextCatalogue(),
): PermanentUpgradePanelViewModel {
    const aiCores = state.meta.aiCores;
    const rows = repository.listPermanentUpgrades().map((upgrade) => createRow(repository, state, upgrade, catalogue));
    const branches = PERMANENT_UPGRADE_BRANCH_ORDER.map((branch) => {
        const own = rows.filter((row) => row.branch === branch);
        return Object.freeze({
            id: branch,
            label: catalogue.resolveText(`upgrades.branch.${branch}`),
            canBuy: own.some((row) => row.state === 'affordable'),
            rowIds: Object.freeze(own.map((row) => row.id)),
        });
    });
    return Object.freeze({
        aiCores,
        civilization: state.meta.civilizationNumber,
        chipVisible: shouldShowRelaySocket(aiCores, state.meta.civilizationNumber),
        texts: Object.freeze({
            title: catalogue.resolveText('upgrades.title'),
            close: catalogue.resolveText('upgrades.close'),
            chip: formatAiCoreChipText(aiCores, catalogue),
            balance: catalogue.resolveText('upgrades.balance', { count: wholeCount(aiCores) }),
            purchaseFailed: catalogue.resolveText('upgrades.purchase_failed'),
        }),
        rows: Object.freeze(rows),
        branches: Object.freeze(branches),
    });
}

function createRow(repository: GameConfigRepository, state: GameState, upgrade: PermanentUpgradeConfig, catalogue: TextCatalogue): PermanentUpgradeRowViewModel {
    const rank = evaluatePermanentUpgradeRankState(repository, state.meta, upgrade.id);
    const missing = rank.missingPrerequisites.map((item) => {
        const name = nameOf(repository.getPermanentUpgrade(item.upgradeId)?.displayNameKey ?? null, catalogue);
        return Object.freeze({
            upgradeId: item.upgradeId,
            name,
            requiredRank: item.requiredRank,
            currentRank: item.currentRank,
            text: catalogue.resolveText('upgrades.needs', { name, rank: item.requiredRank }),
        });
    });
    const rowState = resolveRowState(rank, state.meta.aiCores);
    const maxRank = rank.maxRank ?? upgrade.maxRank;
    const buyText = rowState === 'maxed'
        ? catalogue.resolveText('upgrades.max')
        : rowState === 'locked'
            ? catalogue.resolveText('upgrades.locked')
            : catalogue.resolveText('upgrades.buy', { cost: rank.nextRankCost ?? 0 });
    return Object.freeze({
        id: upgrade.id,
        branch: upgrade.branch,
        nameKey: upgrade.displayNameKey,
        name: nameOf(upgrade.displayNameKey, catalogue),
        currentRank: rank.currentRank,
        maxRank,
        nextRankCost: rank.nextRankCost,
        state: rowState,
        rankText: catalogue.resolveText('upgrades.rank', { current: rank.currentRank, max: maxRank }),
        effectText: formatEffectText(repository, upgrade, rank, catalogue),
        buyText,
        lockedText: rowState === 'locked' && missing.length > 0 ? missing[0].text : null,
        missingPrerequisites: Object.freeze(missing),
        command: rowState === 'affordable' ? Object.freeze({ type: 'purchasePermanentUpgrade', upgradeId: upgrade.id } as const) : null,
    });
}

/** The row state comes only from the authoritative rank state plus the balance comparison against the authoritative next cost. */
function resolveRowState(rank: PermanentUpgradeRankState, aiCores: number): PermanentUpgradeRowState {
    if (rank.status === 'max_rank') return 'maxed';
    if (rank.status !== 'available') return 'locked';
    return rank.nextRankCost !== null && aiCores >= rank.nextRankCost ? 'affordable' : 'insufficient';
}

function wholeCount(value: number): number {
    return Number.isFinite(value) ? Math.floor(value) : 0;
}

function nameOf(nameKey: string | null, catalogue: TextCatalogue): string {
    return nameKey === null ? '' : catalogue.resolveText(nameKey);
}

/** Percent text of a raw config fraction: formatting only (rounded to one decimal, trailing ".0" dropped). */
function formatPercent(fraction: number): string {
    return String(Math.round(fraction * 1000) / 10);
}

/** A raw per-rank multiplier as shown to the player ("1.5", "0.5"): two decimals at most. */
function formatMultiplier(multiplier: number): string {
    return String(Math.round(multiplier * 100) / 100);
}

function formatEffectLines(
    repository: GameConfigRepository,
    effect: PermanentUpgradeEffect,
    rank: PermanentUpgradeRankState,
    catalogue: TextCatalogue,
): string[] {
    switch (effect.type) {
        case 'globalProductionMultiplierPerRank':
            return [catalogue.resolveText('upgrades.effect.global_production', { percent: formatPercent(effect.multiplier - 1) })];
        case 'milestonePowerBonusPerRank':
            return [catalogue.resolveText('upgrades.effect.milestone_power', { percent: formatPercent(effect.bonus) })];
        case 'automatedProducerMultiplierPerRank':
            return [catalogue.resolveText('upgrades.effect.automated_multiplier', { multiplier: formatMultiplier(effect.multiplier) })];
        case 'breakthroughRequirementOverrideByRank': {
            const name = nameOf(repository.getBreakthrough(effect.breakthroughId)?.displayNameKey ?? null, catalogue);
            const lines = [catalogue.resolveText('upgrades.effect.breakthrough_sooner', { name })];
            // The cost multiplier of the rank the player gets next (the last rank once maxed), read as configured.
            const shownRank = rank.nextRank ?? rank.currentRank;
            const rankEntry = effect.ranks.find((item) => item.rank === shownRank);
            if (rankEntry) lines.push(catalogue.resolveText('upgrades.effect.breakthrough_cost', { name, multiplier: formatMultiplier(rankEntry.costMultiplier) }));
            return lines;
        }
        case 'producerStartsAutomatedOnceConstructed':
            return [catalogue.resolveText('upgrades.effect.starts_automated', { name: nameOf(repository.getProducer(effect.producerId)?.displayNameKey ?? null, catalogue) })];
        case 'newProducerConstructionCostMultiplierPerRank':
            return [catalogue.resolveText('upgrades.effect.construction_cost', { percent: formatPercent(1 - effect.multiplier) })];
        case 'majorRequirementReductionPerRank':
            return [catalogue.resolveText('upgrades.effect.major_requirement', { percent: formatPercent(effect.reduction) })];
        default:
            return [];
    }
}

function formatEffectText(repository: GameConfigRepository, upgrade: PermanentUpgradeConfig, rank: PermanentUpgradeRankState, catalogue: TextCatalogue): string {
    return upgrade.effects.flatMap((effect) => formatEffectLines(repository, effect, rank, catalogue)).join('\n');
}
