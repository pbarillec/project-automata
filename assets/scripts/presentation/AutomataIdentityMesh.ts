import { Color, Layers, Material, Mesh, MeshRenderer, Node, utils, Vec3 } from 'cc';
import { IDENTITY_PALETTE, groupBoxesByColor, mergeBoxGeometry, type IdentityBox, type IdentityColorKey } from './AutomataIdentity.ts';

/**
 * AUT-066 thin `cc` helper: turns identity boxes into ONE merged unlit mesh per colour (a MeshRenderer each) sharing 4 cached opaque
 * materials (builtin-unlit, USE_COLOR; same recipe as the Founder accents). Never a spriteFrame-less Sprite, never a tint of a shared
 * glb material. Visibility is by the parent's scale (never node.active).
 */

const materialCache = new Map<IdentityColorKey, Material>();

function identityMaterial(key: IdentityColorKey): Material {
    let material = materialCache.get(key);
    if (!material) {
        const c = IDENTITY_PALETTE[key];
        material = new Material();
        material.initialize({ effectName: 'builtin-unlit', defines: { USE_COLOR: true } });
        material.setProperty('mainColor', new Color(c.r, c.g, c.b, 255));
        materialCache.set(key, material);
    }
    return material;
}

function createMergedMesh(boxes: readonly IdentityBox[]): Mesh {
    const merged = mergeBoxGeometry(boxes);
    const geometry = {
        positions: merged.positions,
        normals: merged.normals,
        uvs: merged.uvs,
        indices: merged.indices,
        minPos: new Vec3(merged.min.x, merged.min.y, merged.min.z),
        maxPos: new Vec3(merged.max.x, merged.max.y, merged.max.z),
        boundingRadius: merged.boundingRadius,
    };
    const factory = utils as unknown as { MeshUtils?: { createMesh(geometry: unknown): unknown }; createMesh?: (geometry: unknown) => unknown };
    const created = factory.MeshUtils?.createMesh(geometry) ?? factory.createMesh?.(geometry);
    if (!created) throw new Error('Cocos mesh creation utility is unavailable for the Automata identity meshes.');
    return created as Mesh;
}

/** Adds one merged renderer node per colour group under `parent` and returns the nodes (draw calls = nodes.length). */
export function buildIdentityRenderers(parent: Node, namePrefix: string, boxes: readonly IdentityBox[]): Node[] {
    const nodes: Node[] = [];
    for (const group of groupBoxesByColor(boxes)) {
        const node = new Node(`${namePrefix}_${group.color}`);
        node.layer = Layers.Enum.DEFAULT;
        node.parent = parent;
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = createMergedMesh(group.boxes);
        renderer.setMaterial(identityMaterial(group.color), 0);
        nodes.push(node);
    }
    return nodes;
}
