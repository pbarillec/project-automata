/**
 * Producer selection hit test (AUT-035 math, extracted unchanged for AUT-INFRA-001).
 *
 * Each selectable target is a horizontal rectangle on the plane y = target.y, sized by the
 * target's local scale (x = width, z = depth, half-extent floor 0.5). The ray hits the closest
 * target whose rectangle contains the ray/plane intersection. Engine-free so the exact math
 * the device runs can be unit-tested and reported per zone in `selection_raycast` diagnostics.
 */
export interface RaycastVec3 { x: number; y: number; z: number }
export interface SelectionRay { o: RaycastVec3; d: RaycastVec3 }
export interface SelectionRaycastTarget<Id extends string = string> { id: Id; position: RaycastVec3; scale: RaycastVec3 }

export interface SelectionRaycastZone<Id extends string = string> {
    id: Id;
    distance: number | null;
    hitX: number | null;
    hitZ: number | null;
    dx: number | null;
    dz: number | null;
    halfWidth: number;
    halfDepth: number;
    inside: boolean;
}

export interface SelectionRaycastResult<Id extends string = string> {
    hit: Id | null;
    zones: SelectionRaycastZone<Id>[];
}

export function pickSelectionTarget<Id extends string>(ray: SelectionRay, targets: Iterable<SelectionRaycastTarget<Id>>): SelectionRaycastResult<Id> {
    let hit: Id | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    const zones: SelectionRaycastZone<Id>[] = [];
    for (const target of targets) {
        const position = target.position;
        const halfWidth = Math.max(0.5, target.scale.x / 2);
        const halfDepth = Math.max(0.5, target.scale.z / 2);
        if (Math.abs(ray.d.y) < 0.0001) {
            zones.push({ id: target.id, distance: null, hitX: null, hitZ: null, dx: null, dz: null, halfWidth, halfDepth, inside: false });
            continue;
        }
        const distance = (position.y - ray.o.y) / ray.d.y;
        const hitX = ray.o.x + ray.d.x * distance;
        const hitZ = ray.o.z + ray.d.z * distance;
        const dx = hitX - position.x;
        const dz = hitZ - position.z;
        const inside = distance >= 0 && Math.abs(dx) <= halfWidth && Math.abs(dz) <= halfDepth;
        zones.push({ id: target.id, distance, hitX, hitZ, dx, dz, halfWidth, halfDepth, inside });
        if (inside && distance < bestDistance) {
            bestDistance = distance;
            hit = target.id;
        }
    }
    return { hit, zones };
}
