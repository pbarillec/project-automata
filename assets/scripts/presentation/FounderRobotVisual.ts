import { Color, Layers, Material, Mesh, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';
import { WORKER_BOT_SCALE } from './AssemblySliceLayout.ts';
import {
    FOUNDER_ACCENT_PARTS,
    FOUNDER_FALLBACK_SHELL_PARTS,
    FOUNDER_PALETTE,
    founderPartSize,
    founderShellColorForMaterialName,
    type FounderColorKey,
    type FounderPart,
} from './FounderRobotVariant.ts';

export const FOUNDER_VARIANT_NODE_NAME = 'FounderVariant';

export interface FounderVisualInfo {
    /** The variant is currently shown on this node. */
    readonly applied: boolean;
    /** Material slots tinted on this node's cloned material instances (0 -> the graphite shell-box fallback is used). */
    readonly shellTinted: number;
    readonly fallbackShell: boolean;
    readonly parts: number;
}

interface TintedSlot {
    readonly instance: Material;
    readonly original: Color;
    readonly shell: FounderColorKey;
}

interface FounderNodeState {
    readonly container: Node;
    readonly crest: Node[];
    readonly slots: TintedSlot[];
    readonly fallbackShell: boolean;
    applied: boolean;
}

const states = new WeakMap<Node, FounderNodeState>();
const meshCache = new Map<string, Mesh>();
const materialCache = new Map<FounderColorKey, Material>();

function toColor(key: FounderColorKey): Color {
    const c = FOUNDER_PALETTE[key];
    return new Color(c.r, c.g, c.b, 255);
}

/** Opaque unlit material (same recipe as CameraSpikeBootstrap.createMaterial): effect builtin-unlit, USE_COLOR, mainColor. Shared across Founder parts, never the robot material. */
function accentMaterial(key: FounderColorKey): Material {
    let material = materialCache.get(key);
    if (!material) {
        material = new Material();
        material.initialize({ effectName: 'builtin-unlit', defines: { USE_COLOR: true } });
        material.setProperty('mainColor', toColor(key));
        materialCache.set(key, material);
    }
    return material;
}

function boxMesh(size: { x: number; y: number; z: number }): Mesh {
    const key = `${size.x.toFixed(4)}|${size.y.toFixed(4)}|${size.z.toFixed(4)}`;
    let mesh = meshCache.get(key);
    if (!mesh) {
        const primitive = primitives.box({ width: size.x, height: size.y, length: size.z });
        const factory = utils as unknown as { MeshUtils?: { createMesh(geometry: unknown): unknown }; createMesh?: (geometry: unknown) => unknown };
        const created = factory.MeshUtils?.createMesh(primitive) ?? factory.createMesh?.(primitive);
        if (!created) throw new Error('Cocos mesh creation utility is unavailable for the Founder robot accents.');
        mesh = created as Mesh;
        meshCache.set(key, mesh);
    }
    return mesh;
}

function createPart(parent: Node, part: FounderPart, fallbackShell: boolean): Node {
    const node = new Node(`Founder_${part.id}`);
    node.layer = Layers.Enum.DEFAULT;
    node.parent = parent;
    node.setPosition(part.center.x, part.center.y, part.center.z);
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = boxMesh(founderPartSize(part, fallbackShell));
    renderer.setMaterial(accentMaterial(part.color), 0);
    return node;
}

/** Tints this node's own cloned material instances (never the shared glb material). Returns the tinted slots. */
function tintShell(robot: Node): TintedSlot[] {
    const slots: TintedSlot[] = [];
    for (const renderer of robot.getComponentsInChildren(MeshRenderer)) {
        const count = renderer.sharedMaterials?.length ?? 0;
        for (let index = 0; index < count; index += 1) {
            try {
                const shared = renderer.getSharedMaterial(index);
                if (!shared) continue;
                const shell = founderShellColorForMaterialName(shared.name ?? '');
                const instance = renderer.getMaterialInstance(index);
                if (!instance || instance === shared) continue;
                let original = new Color(255, 255, 255, 255);
                try { original = (instance.getProperty('mainColor', 0) as Color | null)?.clone() ?? original; } catch { /* keep white */ }
                instance.setProperty('mainColor', toColor(shell));
                slots.push({ instance, original, shell });
            } catch (error) {
                console.warn(`[AUT-062] shell tint skipped for a material slot: ${String(error)}`);
            }
        }
    }
    return slots;
}

function setTint(state: FounderNodeState, founder: boolean): void {
    for (const slot of state.slots) {
        try { slot.instance.setProperty('mainColor', founder ? toColor(slot.shell) : slot.original); } catch { /* best effort */ }
    }
}

function infoOf(state: FounderNodeState | undefined): FounderVisualInfo {
    if (!state) return { applied: false, shellTinted: 0, fallbackShell: false, parts: 0 };
    return { applied: state.applied, shellTinted: state.slots.length, fallbackShell: state.fallbackShell, parts: state.container.children.length };
}

/**
 * Shows / hides the Founder variant on one robot node (idempotent). Created once on the first `true` (a robot that never becomes a
 * Founder costs nothing), reused, never destroyed; hidden by scale 0 (AUT-038 Android rule). The container is a child of the robot, so it
 * inherits the pool scale, the scale-in ramp and the hidden-by-scale of the robot; it also follows the robot position / heading. The
 * robot's clips and pose are untouched (swapping in place needs no reset).
 */
export function applyFounderRobotVariant(robot: Node, founder: boolean): FounderVisualInfo {
    let state = states.get(robot);
    if (!state) {
        if (!founder) return infoOf(undefined);
        const slots = tintShell(robot);
        const fallbackShell = slots.length === 0;
        const container = new Node(FOUNDER_VARIANT_NODE_NAME);
        container.layer = Layers.Enum.DEFAULT;
        container.parent = robot;
        container.setScale(0, 0, 0);
        const crest: Node[] = [];
        for (const part of [...(fallbackShell ? FOUNDER_FALLBACK_SHELL_PARTS : []), ...FOUNDER_ACCENT_PARTS]) {
            const node = createPart(container, part, fallbackShell);
            if (part.group === 'crest') crest.push(node);
        }
        state = { container, crest, slots, fallbackShell, applied: false };
        states.set(robot, state);
    }
    if (state.applied === founder) return infoOf(state);
    state.applied = founder;
    // Part positions are authored in world units at the final robot scale; the container converts them to the robot's local space.
    const k = founder ? 1 / WORKER_BOT_SCALE : 0;
    state.container.setScale(k, k, k);
    setTint(state, founder);
    return infoOf(state);
}

export function getFounderRobotInfo(robot: Node): FounderVisualInfo {
    return infoOf(states.get(robot));
}

/** World-space corner points of the crest parts (fin / antenna / tip) of a shown Founder node, for the DEBUG screen-rect diagnostic. */
export function getFounderCrestWorldPoints(robot: Node): Vec3[] {
    const state = states.get(robot);
    if (!state || !state.applied) return [];
    const points: Vec3[] = [];
    for (const node of state.crest) {
        const size = node.getComponent(MeshRenderer)?.mesh?.struct?.maxPosition;
        const half = size ? new Vec3(size.x, size.y, size.z) : new Vec3(0.03, 0.1, 0.03);
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
            points.push(Vec3.transformMat4(new Vec3(), new Vec3(half.x * sx, half.y * sy, half.z * sz), node.worldMatrix));
        }
    }
    return points;
}
