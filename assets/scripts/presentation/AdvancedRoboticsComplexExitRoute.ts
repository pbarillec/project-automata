import { floorHeightAt } from './AssemblySliceLayout.ts';
import { ARC_BELT_TOP, ARC_MODULE_TRANSFORMS } from './AdvancedRoboticsComplexLayout.ts';

/**
 * AUT-044 engine-free robot exit route of the Advanced Robotics Complex (presentation only, no population robot).
 * A finished fake-production Robot appears at the exit belt next to the core, slides along the exit belt (x -0.4),
 * steps off the slab front edge and ends on the apron pad (-0.4, 3.05) where it scale-hides. The apron lane is the
 * strip z 3.05, x -2.3..0.9: it keeps at least 0.4 from the slab front edge (z 3.55) and from the Automated Cell zone
 * (x >= 1.3), which fixes the AUT-043 lesson of robots crossing a slab edge. The optional "disjoint pooled population
 * robot class on the apron route" of the brief is NOT implemented (see docs/AUT-044_ADVANCED_ROBOTICS_COMPLEX_VISUAL.md).
 */
export const ARC_EXIT_X = ARC_MODULE_TRANSFORMS.conveyor_out.position.x;
/** The robot appears at the core face end of the exit belt and the belt ends at the slab front mouth (z 3.65). */
export const ARC_EXIT_START_Z = 4.2;
export const ARC_EXIT_BELT_END_Z = 3.65;
export const ARC_EXIT_PAD = Object.freeze({ x: ARC_EXIT_X, z: 3.05 });

/** The pooled-robot apron lane (a segment at z 3.05) the exit pad sits on. */
export const ARC_APRON_LANE = Object.freeze({ z: 3.05, minX: -2.3, maxX: 0.9 });

export interface ArcExitPoint {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

/** Position of a finished robot at progress `u` (0..1) along the exit route; feet follow the belt, then the floor. */
export function sampleArcExitPoint(u: number): ArcExitPoint {
    const t = Math.min(1, Math.max(0, u));
    const z = ARC_EXIT_START_Z + (t * (ARC_EXIT_PAD.z - ARC_EXIT_START_Z));
    const y = z >= ARC_EXIT_BELT_END_Z ? ARC_BELT_TOP : floorHeightAt(ARC_EXIT_X, z);
    return { x: ARC_EXIT_X, y, z };
}
