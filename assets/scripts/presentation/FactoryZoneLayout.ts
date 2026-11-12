import { FACTORY_WORLD_SELECTION_PRODUCER_IDS } from './FactoryWorldStateBinding.ts';

/** Zone footprint on the ground plane: centre (x, z), `width` along X and `depth` along Z (world units). */
export interface FactoryZoneRect {
    readonly x: number;
    readonly z: number;
    readonly width: number;
    readonly depth: number;
}

/**
 * AUT-R-031-02 engine-free FactoryWorld zone layout (moved unchanged from FactoryWorldBootstrap, which
 * builds the zones from it). The camera pan bounds are resolved from the same footprints.
 */
export type FactoryZoneId = 'Fabricator' | 'AssemblyStation' | 'RobotLine' | 'AutomatedCell' | 'AdvancedRoboticsComplex';

export const ZONE_LAYOUT: Readonly<Record<FactoryZoneId, FactoryZoneRect>> = Object.freeze({
    Fabricator: { x: -6, z: -3, width: 5, depth: 4 },
    AssemblyStation: { x: -2, z: -1.8, width: 4, depth: 3.5 },
    RobotLine: { x: 3.5, z: -1.2, width: 6, depth: 3.5 },
    AutomatedCell: { x: 2.3, z: 1.9, width: 2.0, depth: 1.7 },
    AdvancedRoboticsComplex: { x: 2, z: 6, width: 6, depth: 5.5 },
});

export type FactoryZoneLayout = Readonly<Partial<Record<FactoryZoneId, FactoryZoneRect>>>;

/** Zone ids in layout order (deterministic iteration). */
export function factoryZoneIds(layout: FactoryZoneLayout): FactoryZoneId[] {
    return (Object.keys(layout) as FactoryZoneId[]).filter((id) => layout[id] !== undefined);
}

/** Zone id → authoritative producer config id (the FactoryWorld selection mapping, not a copy). */
export function producerIdForZone(zoneId: FactoryZoneId): string {
    const producerId = FACTORY_WORLD_SELECTION_PRODUCER_IDS[zoneId];
    if (producerId === undefined) {
        throw new RangeError(`No producer mapped to FactoryWorld zone ${zoneId}`);
    }
    return producerId;
}
