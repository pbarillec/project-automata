import type { GameConfigRepository } from '../config/ConfigLoader.ts';
import type { GameState } from '../state/GameState.ts';
import { evaluateProducerBuildProgression } from '../progression/index.ts';
import { DEFAULT_CAMERA_TUNING, intersectCameraBounds, type CameraBounds } from '../camera/CameraMath.ts';
import { factoryZoneIds, producerIdForZone, type FactoryZoneId, type FactoryZoneLayout } from './FactoryZoneLayout.ts';

/** Small world-unit margin around the unlocked zones (not a tuning value; AUT-R-031-02). */
export const CAMERA_PAN_BOUNDS_MARGIN = 1;

/** The opening zone: always part of the pan bounds. */
export const CAMERA_PAN_ALWAYS_UNLOCKED_ZONE: FactoryZoneId = 'Fabricator';

/**
 * A zone is unlocked for the camera when its producer can be built now or is already built, as the
 * authoritative progression reports it. No new progression rule lives here.
 */
export function resolveUnlockedCameraZones(
    repository: GameConfigRepository,
    state: GameState,
    layout: FactoryZoneLayout,
): FactoryZoneId[] {
    return factoryZoneIds(layout).filter((zoneId) => {
        if (zoneId === CAMERA_PAN_ALWAYS_UNLOCKED_ZONE) return true;
        const status = evaluateProducerBuildProgression(repository, state, producerIdForZone(zoneId)).status;
        return status === 'available' || status === 'already_built';
    });
}

/**
 * AUT-R-031-02 pan bounds: the union of the unlocked zone footprints, grown by `margin`, then clamped
 * inside the global focus bounds. Pure and deterministic; never mutates the state.
 */
export function resolveCameraPanBounds(
    repository: GameConfigRepository,
    state: GameState,
    layout: FactoryZoneLayout,
    margin: number = CAMERA_PAN_BOUNDS_MARGIN,
    globalBounds: CameraBounds = DEFAULT_CAMERA_TUNING.focusBounds,
): CameraBounds {
    const safeMargin = Number.isFinite(margin) && margin > 0 ? margin : 0;
    let union: CameraBounds | null = null;
    for (const zoneId of resolveUnlockedCameraZones(repository, state, layout)) {
        const zone = layout[zoneId]!;
        const rect: CameraBounds = {
            minX: zone.x - (zone.width / 2) - safeMargin,
            maxX: zone.x + (zone.width / 2) + safeMargin,
            minZ: zone.z - (zone.depth / 2) - safeMargin,
            maxZ: zone.z + (zone.depth / 2) + safeMargin,
        };
        union = union === null ? rect : {
            minX: Math.min(union.minX, rect.minX),
            maxX: Math.max(union.maxX, rect.maxX),
            minZ: Math.min(union.minZ, rect.minZ),
            maxZ: Math.max(union.maxZ, rect.maxZ),
        };
    }
    return union === null ? { ...globalBounds } : intersectCameraBounds(union, globalBounds);
}
