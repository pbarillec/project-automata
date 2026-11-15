import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import { resolveNextGoal } from '../progression/NextGoal.ts';
import { ANALYTICS_IDENTIFIER_PATTERN, ANALYTICS_MAX_STRING_LENGTH } from '../services/AnalyticsEvents.ts';
import type { AnalyticsStateContext } from '../services/AnalyticsEventMapper.ts';
import type { GameState } from '../state/GameState.ts';

/**
 * AUT-064 read-only analytics context from an authoritative state snapshot (pure, engine-free, no `cc`): era, civilization, the current next-goal id
 * and the monotonic lifetime output. Never mutates the state and never throws (a failing goal resolution just yields `nextGoalId: null`).
 */
export function createAnalyticsStateContext(repository: GameConfigRepository, state: GameState): AnalyticsStateContext {
    let nextGoalId: string | null = null;
    try {
        const goal = resolveNextGoal(repository, state);
        // An id that would not pass the catalogue (charset / length cap) is dropped rather than sent: the optional parameter just stays absent.
        const candidate = goal.category === 'none' ? null : goal.id;
        nextGoalId = candidate !== null && candidate.length <= ANALYTICS_MAX_STRING_LENGTH && ANALYTICS_IDENTIFIER_PATTERN.test(candidate) ? candidate : null;
    }
    catch {
        nextGoalId = null;
    }
    return {
        eraId: state.run.currentEraId,
        civilization: state.meta.civilizationNumber,
        nextGoalId,
        lifetimeEarned: Number.isFinite(state.lifetime.industrialOutputEarned) ? state.lifetime.industrialOutputEarned : null,
    };
}
