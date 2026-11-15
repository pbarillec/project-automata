import { Node } from 'cc';
import { AI_CORE_PARTS, DECAL_BUILT_LEVEL, decalPartAsBox, decalPartsFor, IDENTITY_PRODUCER_IDS, identityZoneOf } from './AutomataIdentity.ts';
import { buildIdentityRenderers } from './AutomataIdentityMesh';

export const DECAL_ROOT_NODE_NAME = 'AutomataDecals';
export const AI_CORE_MODEL_NODE_NAME = 'AiCoreModel';

export interface DecalApplyInfo {
    readonly producerId: string;
    readonly parts: number;
    readonly boxes: number;
}

/**
 * AUT-066 thin `cc` applier: builds one decal root under a producer's `Zone_X` node (the producer root) from the pure
 * `decalPartsFor`, merged per colour (<= 4 renderers per producer). Idempotent (an existing root is reused). The decals sit on the
 * permanent foundation, are non-pickable (no collider, never part of a selectable target) and never touch a lamp or a tap area.
 */
export function applyAutomataDecals(zone: Node, producerId: string): DecalApplyInfo {
    const existing = zone.getChildByName(DECAL_ROOT_NODE_NAME);
    if (existing) return { producerId, parts: existing.children.length, boxes: decalPartsFor(producerId, DECAL_BUILT_LEVEL).length };
    const parts = decalPartsFor(producerId, DECAL_BUILT_LEVEL);
    const root = new Node(DECAL_ROOT_NODE_NAME);
    root.parent = zone;
    const nodes = buildIdentityRenderers(root, `${producerId}_decal`, parts.map(decalPartAsBox));
    return { producerId, parts: nodes.length, boxes: parts.length };
}

/** Applies the decals to every `Zone_<zone>` child of the site (producers in factory order). */
export function applyAutomataDecalsToSite(site: Node): DecalApplyInfo[] {
    const out: DecalApplyInfo[] = [];
    for (const producerId of IDENTITY_PRODUCER_IDS) {
        const zoneId = identityZoneOf(producerId);
        const zone = zoneId === null ? null : site.getChildByName(`Zone_${zoneId}`);
        if (zone) out.push(applyAutomataDecals(zone, producerId));
    }
    return out;
}

/** Builds the AI Core model (3 merged renderers: graphite shell, off-white diamond, cyan cap + halo) under the Reboot core node. Idempotent. */
export function buildAiCoreModel(core: Node): Node[] {
    const existing = core.getChildByName(AI_CORE_MODEL_NODE_NAME);
    if (existing) return [...existing.children];
    const model = new Node(AI_CORE_MODEL_NODE_NAME);
    model.parent = core;
    return buildIdentityRenderers(model, 'AiCore', AI_CORE_PARTS);
}
