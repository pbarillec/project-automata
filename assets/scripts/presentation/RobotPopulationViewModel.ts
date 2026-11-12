import type { GameState } from '../state/GameState.ts';
import { isFirstRobotPresent } from './AssemblyVisualStateResolver.ts';
import { resolveRobotLineVisualState } from './RobotLineVisualStateResolver.ts';
import { resolvePooledRobotCount, resolveVisibleRobotCount, type RobotPopulationOptions } from './RobotPopulation.ts';

export interface RobotPopulationSnapshot {
    readonly robotsBuilt: number;
    readonly visible: number;
    /** Pooled robots shown besides the first Worker Bot. */
    readonly pooled: number;
    /** AUT-042: the Robot Line is built, so about a third of the pooled robots take the Line -> Exit -> Storage loop. */
    readonly robotLineBuilt: boolean;
    /** The pooled count (or the Robot Line route allocation) changed since the previous snapshot. */
    readonly changed: boolean;
    /** The first snapshot (save load) applies instantly; only live growth may scale in. */
    readonly animateGrowth: boolean;
}

/** AUT-041: read-only projection of Robots Built into the visible population. Never writes state or submits commands. */
export class RobotPopulationViewModel {
    private options: RobotPopulationOptions;
    private previousPooled: number | null = null;
    private previousLineBuilt: boolean | null = null;

    public constructor(options: RobotPopulationOptions = {}) {
        this.options = options;
    }

    /** DEBUG benchmark only: changes the visible-robot cap (the next sync re-evaluates). */
    public setOptions(options: RobotPopulationOptions): void {
        this.options = options;
    }

    public sync(state: GameState): RobotPopulationSnapshot {
        const robotsBuilt = state.run.robotsBuilt;
        const present = isFirstRobotPresent(state);
        const visible = present ? Math.max(1, resolveVisibleRobotCount(robotsBuilt, this.options)) : 0;
        const pooled = resolvePooledRobotCount(visible, present);
        const robotLineBuilt = resolveRobotLineVisualState(state).constructed;
        const previous = this.previousPooled;
        const previousLine = this.previousLineBuilt;
        this.previousPooled = pooled;
        this.previousLineBuilt = robotLineBuilt;
        return { robotsBuilt, visible, pooled, robotLineBuilt, changed: previous !== pooled || previousLine !== robotLineBuilt, animateGrowth: previous !== null && pooled > previous };
    }
}
