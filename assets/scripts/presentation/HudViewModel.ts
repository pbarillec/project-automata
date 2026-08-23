import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import type { GameState } from '../state/GameState.ts';
import { calculateCurrentProductionPerSecond } from '../runtime/index.ts';
import {
    FREE_OVERCLOCK_BOOST_ID,
    isFreeOverclockUnlocked,
    resolveNextGoal,
    type NextGoal,
} from '../progression/index.ts';
import { formatCompactNumber } from './NumberFormatter.ts';

export type FreeOverclockViewState = 'locked' | 'ready' | 'active' | 'cooldown' | 'suspended';

export interface HudViewModel {
    readonly industrialOutput: { readonly value: number; readonly formatted: string; readonly labelKey: 'hud.industrial_output' };
    readonly productionPerSecond: { readonly value: number; readonly formatted: string; readonly labelKey: 'hud.production_per_second' };
    readonly nextGoal: HudNextGoalViewModel;
    readonly freeOverclock: FreeOverclockViewModel;
}

export interface HudNextGoalViewModel {
    readonly id: string;
    readonly category: NextGoal['category'];
    readonly semanticKey: string;
    readonly objective: Readonly<Record<string, string | number>>;
    readonly progress: { readonly currentValue: number; readonly requiredValue: number; readonly currentFormatted: string; readonly requiredFormatted: string; readonly ratio: number } | null;
    readonly affordability: { readonly state: NextGoal['affordability']['state']; readonly cost: number | null; readonly costFormatted: string | null; readonly balance: number; readonly balanceFormatted: string };
    readonly blocking: NextGoal['blocking'];
    readonly focusTarget: NextGoal['focusTarget'];
}

export interface FreeOverclockViewModel {
    readonly state: FreeOverclockViewState;
    readonly canActivate: boolean;
    readonly multiplier: number;
    readonly remainingSeconds: number;
    readonly cooldownSeconds: number;
    readonly remainingFormatted: string;
    readonly labelKey: 'hud.free_overclock';
}

export function createHudViewModel(repository: GameConfigRepository, state: GameState): HudViewModel {
    const goal = resolveNextGoal(repository, state);
    const productionPerSecond = calculateCurrentProductionPerSecond(repository, state);
    const active = state.boosts.activeBoosts[FREE_OVERCLOCK_BOOST_ID];
    const cooldown = state.boosts.cooldowns[FREE_OVERCLOCK_BOOST_ID];
    const unlocked = isFreeOverclockUnlocked(state);
    const overclockState: FreeOverclockViewState = !unlocked
        ? 'locked'
        : active?.isSuspended
            ? 'suspended'
            : active
                ? 'active'
                : cooldown && cooldown.remainingSeconds > 0
                    ? 'cooldown'
                    : 'ready';

    return {
        industrialOutput: { value: state.run.industrialOutput, formatted: formatCompactNumber(state.run.industrialOutput), labelKey: 'hud.industrial_output' },
        productionPerSecond: { value: productionPerSecond, formatted: formatCompactNumber(productionPerSecond), labelKey: 'hud.production_per_second' },
        nextGoal: mapNextGoal(goal),
        freeOverclock: {
            state: overclockState,
            canActivate: overclockState === 'ready',
            multiplier: active?.effect.multiplier ?? 2,
            remainingSeconds: active?.remainingSeconds ?? cooldown?.remainingSeconds ?? 0,
            cooldownSeconds: active?.cooldownSeconds ?? 240,
            remainingFormatted: formatSeconds(active?.remainingSeconds ?? cooldown?.remainingSeconds ?? 0),
            labelKey: 'hud.free_overclock',
        },
    };
}

export const buildHudViewModel = createHudViewModel;

function mapNextGoal(goal: NextGoal): HudNextGoalViewModel {
    const progress = goal.progress === null ? null : {
        currentValue: goal.progress.currentValue,
        requiredValue: goal.progress.requiredValue,
        currentFormatted: formatCompactNumber(goal.progress.currentValue),
        requiredFormatted: formatCompactNumber(goal.progress.requiredValue),
        ratio: goal.progress.ratio,
    };
    const cost = goal.affordability.cost;
    const objective: Record<string, string | number> = { category: goal.category };
    if ('producerId' in goal) objective.producerId = goal.producerId;
    if ('breakthroughId' in goal) objective.breakthroughId = goal.breakthroughId;
    if ('eraId' in goal) objective.eraId = goal.eraId;
    if ('eligibilityStatus' in goal) objective.eligibilityStatus = goal.eligibilityStatus;
    return {
        id: goal.id,
        category: goal.category,
        semanticKey: goal.semanticKey,
        objective,
        progress,
        affordability: { state: goal.affordability.state, cost, costFormatted: cost === null ? null : formatCompactNumber(cost), balance: goal.affordability.balance, balanceFormatted: formatCompactNumber(goal.affordability.balance) },
        blocking: goal.blocking,
        focusTarget: goal.focusTarget,
    };
}

function formatSeconds(seconds: number): string {
    return `${Math.ceil(seconds)}s`;
}
