import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import { getDefaultTextCatalogue, type TextCatalogue } from '../localization/index.ts';
import { resolveNextGoalAction, type NextGoalAction } from './CoreLoopActions.ts';
import type { FreeOverclockViewState, HudNextGoalViewModel, HudViewModel } from './HudViewModel.ts';
import type { ProducerPanelActionId, ProducerPanelPurchaseAction, ProducerPanelViewModel } from './ProducerPanelViewModel.ts';

/**
 * AUT-LOC-001 pure text composition for the Core HUD and Producer Panel.
 * View models stay key-based; this module turns them into readable English through the
 * catalogue. It never reads or mutates game state.
 */

/** Narrow, read-only name lookup used only to name Next Goal objectives. */
export type DisplayNameSource = Pick<GameConfigRepository, 'getProducer' | 'getBreakthrough' | 'getEra'>;

export interface HudTexts {
    readonly industrialOutput: string;
    readonly productionPerSecond: string;
    readonly nextGoal: string;
    readonly nextGoalContext: string;
    readonly freeOverclock: string;
    readonly freeOverclockTimer: string;
    /** AUT-UI-001 HUD action Button captions. */
    readonly manualProduceAction: string;
    /** Empty while the Next Goal action is hidden. */
    readonly nextGoalAction: string;
}

export interface PanelTexts {
    readonly name: string;
    readonly level: string;
    readonly production: string;
    readonly milestone: string;
    readonly actions: Readonly<Record<ProducerPanelActionId, string>>;
}

/** Shown where no value exists yet; a symbol, not English. */
export const EMPTY_VALUE_TEXT = '—';
/** Fallback for a Next Goal category this module does not know yet. */
const NEXT_GOAL_UNKNOWN_KEY = 'next_goal.unknown';

export function formatHudTexts(viewModel: HudViewModel, names: DisplayNameSource | null, catalogue: TextCatalogue = getDefaultTextCatalogue()): HudTexts {
    return Object.freeze({
        industrialOutput: catalogue.resolveText('hud.industrial_output', { value: viewModel.industrialOutput.formatted }),
        productionPerSecond: catalogue.resolveText('hud.production_per_second', { value: viewModel.productionPerSecond.formatted }),
        nextGoal: formatNextGoalText(viewModel.nextGoal, names, catalogue),
        nextGoalContext: formatNextGoalContext(viewModel.nextGoal, catalogue),
        freeOverclock: formatFreeOverclockState(viewModel.freeOverclock.state, viewModel.freeOverclock.multiplier, catalogue),
        freeOverclockTimer: formatFreeOverclockTimer(viewModel.freeOverclock.remainingSeconds, catalogue),
        manualProduceAction: catalogue.resolveText('hud.action.manual_produce'),
        nextGoalAction: formatNextGoalAction(resolveNextGoalAction(viewModel.nextGoal), viewModel.nextGoal, catalogue),
    });
}

/**
 * AUT-UI-001 Next Goal unlock caption: the panel's action captions with the goal cost ("Unlock 1.5K",
 * "Unlock 1.5K • Unavailable" while visible but not eligible-and-affordable); empty while hidden.
 */
export function formatNextGoalAction(action: NextGoalAction, goal: HudNextGoalViewModel, catalogue: TextCatalogue = getDefaultTextCatalogue()): string {
    if (!action.visible) return '';
    return catalogue.resolveText(action.enabled ? 'producer_panel.action' : 'producer_panel.action.unavailable', {
        label: catalogue.resolveText('hud.action.next_goal_unlock'),
        cost: goal.affordability.costFormatted ?? EMPTY_VALUE_TEXT,
    });
}

/** HUD texts before the first view model arrives. */
export function defaultHudTexts(catalogue: TextCatalogue = getDefaultTextCatalogue()): HudTexts {
    return Object.freeze({
        industrialOutput: catalogue.resolveText('hud.industrial_output', { value: EMPTY_VALUE_TEXT }),
        productionPerSecond: catalogue.resolveText('hud.production_per_second', { value: EMPTY_VALUE_TEXT }),
        nextGoal: EMPTY_VALUE_TEXT,
        nextGoalContext: '',
        freeOverclock: formatFreeOverclockState('locked', 2, catalogue),
        freeOverclockTimer: formatFreeOverclockTimer(0, catalogue),
        manualProduceAction: catalogue.resolveText('hud.action.manual_produce'),
        nextGoalAction: '',
    });
}

export function formatNextGoalText(goal: HudNextGoalViewModel, names: DisplayNameSource | null, catalogue: TextCatalogue = getDefaultTextCatalogue()): string {
    const key = goal.semanticKey;
    const level = goal.progress?.requiredValue ?? 0;
    switch (goal.category) {
        case 'producer_build':
            return namedGoal(key, displayNameKeyOf(names, 'producer', goal.objective.producerId), {}, catalogue);
        case 'producer_milestone':
            return namedGoal(key, displayNameKeyOf(names, 'producer', goal.objective.producerId), { level }, catalogue);
        case 'breakthrough':
            return namedGoal(key, displayNameKeyOf(names, 'breakthrough', goal.objective.breakthroughId), {}, catalogue);
        case 'era':
            return namedGoal(key, displayNameKeyOf(names, 'era', goal.objective.eraId), {}, catalogue);
        case 'reboot_ai_core':
        case 'none':
            return catalogue.has(key) ? catalogue.resolveText(key) : catalogue.resolveText(NEXT_GOAL_UNKNOWN_KEY);
        default:
            return catalogue.resolveText(NEXT_GOAL_UNKNOWN_KEY);
    }
}

export function formatNextGoalContext(goal: HudNextGoalViewModel, catalogue: TextCatalogue = getDefaultTextCatalogue()): string {
    if (goal.progress) return catalogue.resolveText('next_goal.progress', { current: goal.progress.currentFormatted, required: goal.progress.requiredFormatted });
    if (goal.affordability.costFormatted) {
        return catalogue.resolveText('next_goal.cost', {
            cost: goal.affordability.costFormatted,
            state: catalogue.resolveText(`next_goal.affordability.${goal.affordability.state}`),
        });
    }
    return catalogue.resolveText(`next_goal.blocking.${goal.blocking.state}`);
}

export function formatFreeOverclockState(state: FreeOverclockViewState, multiplier: number, catalogue: TextCatalogue = getDefaultTextCatalogue()): string {
    return catalogue.resolveText(`hud.free_overclock.${state}`, { multiplier });
}

export function formatFreeOverclockTimer(remainingSeconds: number, catalogue: TextCatalogue = getDefaultTextCatalogue()): string {
    return catalogue.resolveText('hud.free_overclock.timer', { seconds: Math.ceil(Math.max(0, remainingSeconds)) });
}

export function formatPanelTexts(viewModel: ProducerPanelViewModel, catalogue: TextCatalogue = getDefaultTextCatalogue()): PanelTexts {
    const selected = viewModel.selectedProducerId !== null;
    return Object.freeze({
        name: viewModel.displayNameKey !== null
            ? catalogue.resolveText(viewModel.displayNameKey)
            : selected ? EMPTY_VALUE_TEXT : catalogue.resolveText('producer_panel.none_selected'),
        level: selected ? catalogue.resolveText('producer_panel.level', { level: viewModel.level }) : '',
        production: selected ? catalogue.resolveText('producer_panel.production_per_second', { value: viewModel.productionPerSecondFormatted }) : '',
        milestone: formatMilestone(viewModel.milestone, catalogue),
        actions: Object.freeze({
            x1: formatPanelAction(viewModel.actions?.x1, catalogue),
            x10: formatPanelAction(viewModel.actions?.x10, catalogue),
            xMax: formatPanelAction(viewModel.actions?.xMax, catalogue),
        }),
    });
}

/** Panel texts while a new selection waits for its first view model (no name lookup here). */
export function pendingSelectionPanelTexts(selectedProducerId: string | null, catalogue: TextCatalogue = getDefaultTextCatalogue()): PanelTexts {
    return Object.freeze({
        name: selectedProducerId === null ? catalogue.resolveText('producer_panel.none_selected') : EMPTY_VALUE_TEXT,
        level: '',
        production: '',
        milestone: '',
        actions: Object.freeze({ x1: EMPTY_VALUE_TEXT, x10: EMPTY_VALUE_TEXT, xMax: EMPTY_VALUE_TEXT }),
    });
}

/** Panel texts before the first view model arrives. */
export function defaultPanelTexts(catalogue: TextCatalogue = getDefaultTextCatalogue()): PanelTexts {
    return Object.freeze({
        name: catalogue.resolveText('producer_panel.none_selected'),
        level: '',
        production: '',
        milestone: '',
        actions: Object.freeze({
            x1: catalogue.resolveText('producer_panel.buy_1'),
            x10: catalogue.resolveText('producer_panel.buy_10'),
            xMax: catalogue.resolveText('producer_panel.buy_max'),
        }),
    });
}

export function formatPanelAction(action: ProducerPanelPurchaseAction | undefined, catalogue: TextCatalogue = getDefaultTextCatalogue()): string {
    if (!action) return EMPTY_VALUE_TEXT;
    return catalogue.resolveText(action.isEnabled ? 'producer_panel.action' : 'producer_panel.action.unavailable', {
        label: catalogue.resolveText(action.labelKey),
        cost: action.costFormatted,
    });
}

function formatMilestone(milestone: ProducerPanelViewModel['milestone'], catalogue: TextCatalogue): string {
    if (!milestone) return '';
    if (milestone.state === 'complete') return catalogue.resolveText('producer_panel.milestone.complete');
    const params = { threshold: milestone.nextThreshold ?? 0, remaining: milestone.levelsRemaining ?? 0 };
    if (!milestone.benefit) return catalogue.resolveText('producer_panel.milestone.next', params);
    return catalogue.resolveText('producer_panel.milestone.next_with_benefit', {
        ...params,
        benefit: catalogue.resolveText(milestone.benefit.descriptorKey, { multiplier: milestone.benefit.multiplier }),
    });
}

function namedGoal(semanticKey: string, nameKey: string | null, params: Record<string, string | number>, catalogue: TextCatalogue): string {
    if (nameKey !== null && catalogue.has(semanticKey)) {
        // A name missing from the catalogue is reported by resolveText, then the generic text is shown.
        const name = catalogue.resolveText(nameKey);
        if (catalogue.has(nameKey)) return catalogue.resolveText(semanticKey, { ...params, name });
    }
    const genericKey = `${semanticKey}.generic`;
    return catalogue.resolveText(catalogue.has(genericKey) ? genericKey : NEXT_GOAL_UNKNOWN_KEY, params);
}

function displayNameKeyOf(names: DisplayNameSource | null, kind: 'producer' | 'breakthrough' | 'era', id: string | number | undefined): string | null {
    if (names === null || typeof id !== 'string') return null;
    const entry = kind === 'producer' ? names.getProducer(id) : kind === 'breakthrough' ? names.getBreakthrough(id) : names.getEra(id);
    return entry?.displayNameKey ?? null;
}
