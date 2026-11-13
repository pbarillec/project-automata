import type { ActivateFreeOverclockCommand, ManualProduceCommand, PurchaseBreakthroughCommand } from '../domain/Commands.ts';
import type { HudNextGoalViewModel, HudViewModel } from './HudViewModel.ts';

/**
 * AUT-UI-001 engine-free mapping from HUD view-model data to the two core-loop HUD actions.
 *
 * - Manual Produce is always visible and enabled (owner decision 2026-11-10: a permanent HUD button,
 *   still available after automation); it emits `manualProduce`.
 * - The Next Goal action exists only for `breakthrough` goals. It is visible while the breakthrough is
 *   not owned (a `locked` breakthrough shows visible-disabled) and enabled only when the goal is
 *   `eligible` AND `affordable`; it emits `purchaseBreakthrough{breakthroughId}` in one tap.
 *
 * The runtime stays authoritative: these flags only gate what the HUD submits, and the runtime still
 * validates every command. No state is read or mutated here.
 */
export interface CoreLoopAction<TCommand> {
    readonly visible: boolean;
    readonly enabled: boolean;
    /** Present only when `enabled`. */
    readonly command: TCommand | null;
}

export type ManualProduceAction = CoreLoopAction<ManualProduceCommand>;

export interface NextGoalAction extends CoreLoopAction<PurchaseBreakthroughCommand> {
    /** The goal's breakthrough while visible, else null. */
    readonly breakthroughId: string | null;
}

const MANUAL_PRODUCE_ACTION: ManualProduceAction = Object.freeze({
    visible: true,
    enabled: true,
    command: Object.freeze({ type: 'manualProduce' as const }),
});

const HIDDEN_NEXT_GOAL_ACTION: NextGoalAction = Object.freeze({ visible: false, enabled: false, command: null, breakthroughId: null });

/** Eligibility statuses that keep the action visible (owned or unknown breakthroughs hide it). */
const VISIBLE_ELIGIBILITY = new Set(['eligible', 'locked']);

export type OverclockAction = CoreLoopAction<ActivateFreeOverclockCommand>;

const OVERCLOCK_READY_ACTION: OverclockAction = Object.freeze({
    visible: true,
    enabled: true,
    command: Object.freeze({ type: 'activateFreeOverclock' as const }),
});
const OVERCLOCK_DISABLED_ACTION: OverclockAction = Object.freeze({ visible: true, enabled: false, command: null });

/**
 * AUT-UI-003: the Free Overclock row is always visible (it is the HUD status as well) and enabled only when the HUD
 * view model says it can be activated (`ready`); locked / active / cooldown / suspended are visible-disabled.
 */
export function resolveOverclockAction(freeOverclock: HudViewModel['freeOverclock'] | null | undefined): OverclockAction {
    return freeOverclock?.canActivate === true ? OVERCLOCK_READY_ACTION : OVERCLOCK_DISABLED_ACTION;
}

export function resolveManualProduceAction(): ManualProduceAction {
    return MANUAL_PRODUCE_ACTION;
}

export function resolveNextGoalAction(goal: HudNextGoalViewModel | null | undefined): NextGoalAction {
    if (!goal || goal.category !== 'breakthrough') return HIDDEN_NEXT_GOAL_ACTION;
    const breakthroughId = goal.objective.breakthroughId;
    const eligibility = goal.objective.eligibilityStatus;
    if (typeof breakthroughId !== 'string' || breakthroughId.length === 0) return HIDDEN_NEXT_GOAL_ACTION;
    if (typeof eligibility !== 'string' || !VISIBLE_ELIGIBILITY.has(eligibility)) return HIDDEN_NEXT_GOAL_ACTION;
    const enabled = eligibility === 'eligible' && goal.affordability.state === 'affordable';
    return Object.freeze({
        visible: true,
        enabled,
        command: enabled ? Object.freeze({ type: 'purchaseBreakthrough' as const, breakthroughId }) : null,
        breakthroughId,
    });
}
