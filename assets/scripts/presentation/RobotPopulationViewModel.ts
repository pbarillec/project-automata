import type { GameState } from '../state/GameState.ts';
import { isFirstRobotPresent } from './AssemblyVisualStateResolver.ts';
import { resolvePooledRobotCount, resolveVisibleRobotCount, type RobotPopulationOptions } from './RobotPopulation.ts';

export interface RobotPopulationSnapshot {
    readonly robotsBuilt: number;
    readonly visible: number;
    /** Pooled robots shown besides the first Worker Bot. */
    readonly pooled: number;
    /** The pooled count changed since the previous snapshot. */
    readonly changed: boolean;
    /** The first snapshot (save load) applies instantly; only live growth may scale in. */
    readonly animateGrowth: boolean;
}

/** AUT-041: read-only projection of Robots Built into the visible population. Never writes state or submits commands. */
export class RobotPopulationViewModel {
    private readonly options: RobotPopulationOptions;
    private previousPooled: number | null = null;

    public constructor(options: RobotPopulationOptions = {}) {
        this.options = options;
    }

    public sync(state: GameState): RobotPopulationSnapshot {
        const robotsBuilt = state.run.robotsBuilt;
        const present = isFirstRobotPresent(state);
        const visible = present ? Math.max(1, resolveVisibleRobotCount(robotsBuilt, this.options)) : 0;
        const pooled = resolvePooledRobotCount(visible, present);
        const previous = this.previousPooled;
        this.previousPooled = pooled;
        return { robotsBuilt, visible, pooled, changed: previous !== pooled, animateGrowth: previous !== null && pooled > previous };
    }
}
