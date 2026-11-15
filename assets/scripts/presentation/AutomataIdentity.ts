import { aiMarkGeometry, type PermanentUpgradePoint } from './PermanentUpgradeLayout.ts';
import { floorHeightAt } from './AssemblySliceLayout.ts';
import { ZONE_LAYOUT, type FactoryZoneId, type FactoryZoneRect } from './FactoryZoneLayout.ts';
import { FACTORY_WORLD_SELECTION_PRODUCER_IDS } from './FactoryWorldStateBinding.ts';
import { CORE_HUD_LAYOUT, PRODUCER_PANEL_LAYOUT, cardActionRect, cardRowCenterY, cardRowWidth } from './UiLayout.ts';
import { MILESTONE_TOAST_LAYOUT } from './MilestoneToastLayout.ts';
import { FOUNDER_CHIP_WIDTH } from './FounderShopLayout.ts';
import type { PresentedMilestoneTier } from './MilestoneTier.ts';

/**
 * AUT-066 Automata identity assets (pure data + geometry, no `cc`). Minimal MVP set, authored procedurally in this repository
 * from opaque primitives only (no generated art, no new imported asset, no PNG atlas):
 *  - 3D: Automata decals under each producer zone and the AI Core on the Reboot relay socket (unlit boxes, merged per colour so each
 *    producer costs at most 4 renderers and the AI Core 3);
 *  - UI: eight convex-polygon icons and the shared AI mark (Graphics fills, never stroke()).
 * Palette is frozen (ART_DIRECTION): graphite / off-white / cyan (AI and permanent only) / amber (hazard, primary) / Founder gold
 * (the existing Founder robot only: never used by anything in this file). Never red.
 */

export interface IdentityRgb { readonly r: number; readonly g: number; readonly b: number }

export const IDENTITY_PALETTE = Object.freeze({
    graphite: Object.freeze({ r: 24, g: 29, b: 32 }),
    offWhite: Object.freeze({ r: 232, g: 236, b: 236 }),
    cyan: Object.freeze({ r: 88, g: 170, b: 184 }),
    amber: Object.freeze({ r: 224, g: 168, b: 72 }),
    /** Reserved for the Founder robot (AUT-062): intentionally not part of IdentityColorKey. */
    founderGold: Object.freeze({ r: 204, g: 146, b: 40 }),
});

export type IdentityColorKey = 'graphite' | 'offWhite' | 'cyan' | 'amber';
export const IDENTITY_COLOR_KEYS: readonly IdentityColorKey[] = Object.freeze(['graphite', 'offWhite', 'cyan', 'amber'] as const);

/** Source / licence record text (mirrored in docs/ASSET_MANIFEST.md): original, procedural, project-owned, no AI generation. */
export const IDENTITY_SOURCE_RECORD = 'AUT-066 identity assets (CUSTOM_AI_CORE_01, CUSTOM_AUTOMATA_DECALS_01, CUSTOM_CORE_ICONS_01): original work authored procedurally in this repository from opaque primitives (boxes, convex polygons); project-owned; no AI generation; no external asset or font; deviation from the manifest: no PNG atlas.';

/** Placeholder brand wordmark: NOT a final logo (final typography / app icon / store art are owner-level and OPEN). Wired nowhere. */
export const PLACEHOLDER_WORDMARK = Object.freeze({
    text: 'AUTOMATA',
    font: 'engine-default',
    mark: 'ai_core' as const,
    status: 'PLACEHOLDER' as const,
});

// ---------------------------------------------------------------------------------------------------------------
// Box geometry (shared by the decals and the AI Core)

export interface IdentityBox {
    /** Group label: a decal kind or an AI Core part. */
    readonly kind: string;
    /** Box extents along its own x / y / z. */
    readonly size: { readonly x: number; readonly y: number; readonly z: number };
    readonly center: { readonly x: number; readonly y: number; readonly z: number };
    /** Euler degrees applied as Ry * Rx * Rz (the engine order). */
    readonly rotXDeg: number;
    readonly rotYDeg: number;
    readonly rotZDeg: number;
    readonly color: IdentityColorKey;
}

export interface MergedGeometry {
    readonly positions: number[];
    readonly normals: number[];
    readonly uvs: number[];
    readonly indices: number[];
    readonly min: { x: number; y: number; z: number };
    readonly max: { x: number; y: number; z: number };
    readonly boundingRadius: number;
}

type V3 = [number, number, number];

function rotationMatrix(rotXDeg: number, rotYDeg: number, rotZDeg: number): number[] {
    const rad = Math.PI / 180;
    const [cx, sx, cy, sy, cz, sz] = [Math.cos(rotXDeg * rad), Math.sin(rotXDeg * rad), Math.cos(rotYDeg * rad), Math.sin(rotYDeg * rad), Math.cos(rotZDeg * rad), Math.sin(rotZDeg * rad)];
    // R = Ry * Rx * Rz (row-major 3x3).
    const rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
    const rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
    const ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
    const mul = (a: number[], b: number[]): number[] => {
        const out = new Array<number>(9).fill(0);
        for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) for (let k = 0; k < 3; k += 1) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
        return out;
    };
    return mul(ry, mul(rx, rz));
}

function apply(m: number[], v: V3): V3 {
    return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

const BOX_FACES: ReadonlyArray<{ readonly normal: V3; readonly corners: readonly [V3, V3, V3, V3] }> = [
    { normal: [1, 0, 0], corners: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
    { normal: [-1, 0, 0], corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
    { normal: [0, 1, 0], corners: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { normal: [0, -1, 0], corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
    { normal: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { normal: [0, 0, -1], corners: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
];

/** Bakes boxes (rotation + translation) into ONE indexed triangle mesh (positions / normals / uvs / indices), so a colour group is one draw call. */
export function mergeBoxGeometry(boxes: readonly IdentityBox[]): MergedGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const box of boxes) {
        const matrix = rotationMatrix(box.rotXDeg, box.rotYDeg, box.rotZDeg);
        const half: V3 = [box.size.x / 2, box.size.y / 2, box.size.z / 2];
        for (const face of BOX_FACES) {
            const base = positions.length / 3;
            const n = apply(matrix, face.normal);
            face.corners.forEach((corner, index) => {
                const p = apply(matrix, [corner[0] * half[0], corner[1] * half[1], corner[2] * half[2]]);
                const x = p[0] + box.center.x;
                const y = p[1] + box.center.y;
                const z = p[2] + box.center.z;
                positions.push(x, y, z);
                normals.push(n[0], n[1], n[2]);
                uvs.push(index === 1 || index === 2 ? 1 : 0, index >= 2 ? 1 : 0);
                min.x = Math.min(min.x, x); min.y = Math.min(min.y, y); min.z = Math.min(min.z, z);
                max.x = Math.max(max.x, x); max.y = Math.max(max.y, y); max.z = Math.max(max.z, z);
            });
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
    }
    if (boxes.length === 0) return { positions, normals, uvs, indices, min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, boundingRadius: 0 };
    let radius = 0;
    for (let i = 0; i < positions.length; i += 3) radius = Math.max(radius, Math.hypot(positions[i] - (min.x + max.x) / 2, positions[i + 1] - (min.y + max.y) / 2, positions[i + 2] - (min.z + max.z) / 2));
    return { positions, normals, uvs, indices, min, max, boundingRadius: radius };
}

export interface IdentityColorGroup {
    readonly color: IdentityColorKey;
    readonly boxes: readonly IdentityBox[];
}

/** Groups boxes by colour in palette order (one merged mesh / renderer per group). */
export function groupBoxesByColor(boxes: readonly IdentityBox[]): IdentityColorGroup[] {
    return IDENTITY_COLOR_KEYS
        .map((color) => ({ color, boxes: boxes.filter((box) => box.color === color) }))
        .filter((group) => group.boxes.length > 0);
}

function box(kind: string, color: IdentityColorKey, size: [number, number, number], center: [number, number, number], rotYDeg = 0, rotXDeg = 0, rotZDeg = 0): IdentityBox {
    return Object.freeze({ kind, color, size: Object.freeze({ x: size[0], y: size[1], z: size[2] }), center: Object.freeze({ x: center[0], y: center[1], z: center[2] }), rotXDeg, rotYDeg, rotZDeg });
}

// ---------------------------------------------------------------------------------------------------------------
// Seven-segment digits and the number plate

export type SegmentId = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';

export const SEVEN_SEG: Readonly<Record<string, readonly SegmentId[]>> = Object.freeze({
    '0': Object.freeze(['a', 'b', 'c', 'd', 'e', 'f'] as SegmentId[]),
    '1': Object.freeze(['b', 'c'] as SegmentId[]),
    '2': Object.freeze(['a', 'b', 'g', 'e', 'd'] as SegmentId[]),
    '3': Object.freeze(['a', 'b', 'g', 'c', 'd'] as SegmentId[]),
    '4': Object.freeze(['f', 'g', 'b', 'c'] as SegmentId[]),
    '5': Object.freeze(['a', 'f', 'g', 'c', 'd'] as SegmentId[]),
    '6': Object.freeze(['a', 'f', 'g', 'e', 'd', 'c'] as SegmentId[]),
    '7': Object.freeze(['a', 'b', 'c'] as SegmentId[]),
    '8': Object.freeze(['a', 'b', 'c', 'd', 'e', 'f', 'g'] as SegmentId[]),
    '9': Object.freeze(['a', 'b', 'f', 'g', 'c', 'd'] as SegmentId[]),
});

/**
 * Decal sizes (world units). The Art Director nominal values (plate 0.30 x 0.12, digits 0.07 tall, symbol face 0.34) are scaled up
 * 1.5x so the marks stay above ~24 px at the normal camera on a 1080 px wide screen (never recoloured).
 */
export const DECAL_SCALE = 1.5;
/** Plate / digits / pips are scaled separately (AUT-066 tuning: the 1.5x plates read as dashes on device). */
export const PLATE_SCALE = 2.2;
export const DECAL_THICKNESS = 0.004;
/** Offset of the decal layer above the surface (no z-fight). */
export const DECAL_SURFACE_OFFSET = 0.01;
export const NUMBER_PLATE = Object.freeze({ width: 0.3 * PLATE_SCALE, height: 0.12 * PLATE_SCALE, digitHeight: 0.07 * PLATE_SCALE, digitWidth: 0.04 * PLATE_SCALE, stroke: 0.011 * PLATE_SCALE, digitGap: 0.012 * PLATE_SCALE });

export interface GlyphBox {
    /** Centre in the glyph frame (u right, v up) and size (w along u, h along v). */
    readonly u: number;
    readonly v: number;
    readonly w: number;
    readonly h: number;
    readonly digit: number;
    readonly segment: SegmentId;
}

export function plateText(n: number): string {
    const value = Math.max(0, Math.min(99, Math.floor(Number.isFinite(n) ? n : 0)));
    return String(value).padStart(2, '0');
}

/** Off-white seven-segment boxes of the zero-padded number `n` ("01".."99"), centred on the plate origin in the glyph frame. */
export function numberPlateBoxes(n: number): GlyphBox[] {
    const { digitHeight: dh, digitWidth: dw, stroke: t, digitGap } = NUMBER_PLATE;
    const text = plateText(n);
    const totalWidth = text.length * dw + (text.length - 1) * digitGap;
    const out: GlyphBox[] = [];
    [...text].forEach((ch, digit) => {
        const cu = -totalWidth / 2 + dw / 2 + digit * (dw + digitGap);
        const place = (segment: SegmentId): GlyphBox => {
            switch (segment) {
                case 'a': return { u: cu, v: dh / 2 - t / 2, w: dw, h: t, digit, segment };
                case 'g': return { u: cu, v: 0, w: dw, h: t, digit, segment };
                case 'd': return { u: cu, v: -dh / 2 + t / 2, w: dw, h: t, digit, segment };
                case 'b': return { u: cu + dw / 2 - t / 2, v: dh / 4, w: t, h: dh / 2, digit, segment };
                case 'c': return { u: cu + dw / 2 - t / 2, v: -dh / 4, w: t, h: dh / 2, digit, segment };
                case 'e': return { u: cu - dw / 2 + t / 2, v: -dh / 4, w: t, h: dh / 2, digit, segment };
                default: return { u: cu - dw / 2 + t / 2, v: dh / 4, w: t, h: dh / 2, digit, segment };
            }
        };
        for (const segment of SEVEN_SEG[ch] ?? []) out.push(place(segment));
        if (ch === '1') {
            // AUT-066 round 3: a bare seven-segment '1' read as a thin bar next to the '0' ('O I'). Thicker stem, a foot serif and a top-left flag make it read '1'.
            const stem = t * 1.6;
            for (const box of out.filter((b) => b.digit === digit && (b.segment === 'b' || b.segment === 'c'))) { out.splice(out.indexOf(box), 1, { ...box, u: cu + dw / 2 - stem / 2, w: stem }); }
            out.push({ u: cu, v: -dh / 2 + t / 2, w: dw, h: t, digit, segment: 'd' });
            out.push({ u: cu + dw / 2 - stem - dw / 4 + t / 2, v: dh / 2 - t / 2, w: dw / 2, h: t, digit, segment: 'a' });
        }
    });
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Ring arcs (AI Core halo)

export interface RingArcBox {
    readonly x: number;
    readonly z: number;
    /** Rotation about Y so the box length runs along the tangent. */
    readonly rotYDeg: number;
    readonly index: number;
}

/** `segs` slots around a ring of radius `r` in the XZ plane, the slot `gapIndex` left EMPTY (never a closed ring). */
export function ringArcBoxes(r: number, segs: number, gapIndex: number): RingArcBox[] {
    const out: RingArcBox[] = [];
    for (let i = 0; i < segs; i += 1) {
        if (i === gapIndex) continue;
        const angle = (i * Math.PI * 2) / segs;
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        // Tangent direction (-sin, cos) in (x, z): the box x axis maps to (cos t, -sin t), so t = atan2(-tz, tx).
        const rotYDeg = (Math.atan2(-Math.cos(angle), -Math.sin(angle)) * 180) / Math.PI;
        out.push({ x, z, rotYDeg, index: i });
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// AI Core 3D (replaces the AUT-049 placeholder cube at the same socket)

/** Core scale 1 is this reference size: the authored sizes below are world units at scale 1. */
export const AI_CORE_REFERENCE_SIZE = 0.28;
/** AUT-066 tuning: 0.28 -> 0.36 (round 2) -> 0.6 (round 3, the marker measured ~18 x 12 px; the model is authored at AI_CORE_REFERENCE_SIZE, so the persistent scale is 0.6 / 0.28 = 2.14). */
export const AI_CORE_PERSISTENT_SIZE = 0.6;
export const AI_CORE_PEAK_SIZE = 0.8;
export const AI_CORE_HEX_RADIUS = 0.2;
export const AI_CORE_BAR = 0.05;
export const AI_CORE_LAYERS = 2;
export const AI_CORE_DIAMOND_EDGE = 0.12;
export const AI_CORE_DIAMOND_Y = 0.08;
export const AI_CORE_CAP_EDGE = 0.1;
export const AI_CORE_ARC = Object.freeze({ radius: 0.3, slots: 25, gapIndex: 12, segmentCount: 3, boxesPerSegment: 8, length: 0.08, width: 0.04, height: 0.04, y: 0.08 });
/** Half height of the hex shell (the origin of the core node is the shell centre). */
export const AI_CORE_SHELL_HALF_HEIGHT = (AI_CORE_BAR * AI_CORE_LAYERS) / 2;

export type AiCorePartGroup = 'shell' | 'diamond' | 'cap' | 'arc';

function aiCoreBoxes(): IdentityBox[] {
    const boxes: IdentityBox[] = [];
    // Hex shell: 6 graphite bars along the edges of the AI mark hexagon (single source: aiMarkGeometry), stacked 2 high.
    const hex = aiMarkGeometry(0, 0, AI_CORE_HEX_RADIUS * 2).hexOuter;
    for (let layer = 0; layer < AI_CORE_LAYERS; layer += 1) {
        const y = -AI_CORE_SHELL_HALF_HEIGHT + AI_CORE_BAR * (layer + 0.5);
        for (let i = 0; i < hex.length; i += 1) {
            const a = hex[i];
            const b = hex[(i + 1) % hex.length];
            const length = Math.hypot(b.x - a.x, b.y - a.y);
            const rotYDeg = (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI;
            // Tuning: the lower layer stays graphite, the upper layer is an off-white rim so the hexagon reads on the dark pedestal / floor.
            boxes.push(box('shell', layer === AI_CORE_LAYERS - 1 ? 'offWhite' : 'graphite', [length + AI_CORE_BAR * 0.5, AI_CORE_BAR, AI_CORE_BAR], [(a.x + b.x) / 2, y, (a.y + b.y) / 2], rotYDeg));
        }
    }
    // Floating off-white diamond (a cube standing on a vertex: Rz 45, Rx -35.264) with a cyan cap on its top vertex.
    const diamondCentre = AI_CORE_DIAMOND_Y;
    boxes.push(box('diamond', 'offWhite', [AI_CORE_DIAMOND_EDGE, AI_CORE_DIAMOND_EDGE, AI_CORE_DIAMOND_EDGE], [0, diamondCentre, 0], 45, -35.264, 45));
    boxes.push(box('cap', 'cyan', [AI_CORE_CAP_EDGE, AI_CORE_CAP_EDGE, AI_CORE_CAP_EDGE], [0, diamondCentre + (AI_CORE_DIAMOND_EDGE * Math.sqrt(3)) / 2 + AI_CORE_CAP_EDGE * 0.15, 0], 45));
    // Cyan halo: 3 arc segments of 8 boxes with one gap (never a closed ring).
    for (const slot of ringArcBoxes(AI_CORE_ARC.radius, AI_CORE_ARC.slots, AI_CORE_ARC.gapIndex)) {
        boxes.push(box('arc', 'cyan', [AI_CORE_ARC.length, AI_CORE_ARC.height, AI_CORE_ARC.width], [slot.x, AI_CORE_ARC.y, slot.z], slot.rotYDeg));
    }
    return boxes;
}

export const AI_CORE_PARTS: readonly IdentityBox[] = Object.freeze(aiCoreBoxes());

/** Arc segment (0..2) of an arc box, counted from the slot after the gap (8 boxes each). */
export function aiCoreArcSegmentOf(arcOrdinal: number): number {
    return Math.min(AI_CORE_ARC.segmentCount - 1, Math.floor(arcOrdinal / AI_CORE_ARC.boxesPerSegment));
}

/** Node scale of the Core for a presentation `size` (persistent 0.28 -> 1, reveal peak 0.8 -> 2.857; the shell scales together). */
export function aiCoreScaleFor(size: number): number {
    return Number.isFinite(size) && size > 0 ? size / AI_CORE_REFERENCE_SIZE : 0;
}

export interface AiCoreSummary {
    readonly boxes: number;
    readonly renderers: number;
    readonly shellBars: number;
    readonly arcBoxes: number;
    readonly arcSegments: number;
}

export function aiCoreSummary(): AiCoreSummary {
    const count = (kind: string): number => AI_CORE_PARTS.filter((part) => part.kind === kind).length;
    return { boxes: AI_CORE_PARTS.length, renderers: groupBoxesByColor(AI_CORE_PARTS).length, shellBars: count('shell'), arcBoxes: count('arc'), arcSegments: AI_CORE_ARC.segmentCount };
}

// ---------------------------------------------------------------------------------------------------------------
// Automata decals (3D, per producer zone)

export type DecalKind = 'symbol' | 'numberPlate' | 'hazardStripe' | 'zoneTag';
export type DecalFace = 'top' | 'front';

export interface DecalPart {
    readonly kind: DecalKind;
    readonly size: { readonly x: number; readonly y: number; readonly z: number };
    /** Producer-root local position (the producer root is the Zone_X node at the footprint centre, y = 0). */
    readonly localPos: { readonly x: number; readonly y: number; readonly z: number };
    readonly face: DecalFace;
    readonly color: IdentityColorKey;
    readonly rotYDeg: number;
}

/** At most this many merged renderers (colour groups) per producer and for the whole factory (the draw-call budget). */
export const DECAL_MAX_PARTS_PER_PRODUCER = 5;
export const DECAL_MAX_PARTS_TOTAL = 30;
export const DECAL_KINDS: readonly DecalKind[] = Object.freeze(['symbol', 'numberPlate', 'hazardStripe', 'zoneTag'] as const);
/** The tier of producer state the applier builds (level 0 = a future bay: stripe + zone tag only). */
export const DECAL_BUILT_LEVEL = 1;

const HALF_SQRT2 = Math.SQRT1_2;

/** Producer ids in factory order (the number printed on the plate is index + 1). */
export const IDENTITY_PRODUCER_IDS: readonly string[] = Object.freeze((Object.keys(ZONE_LAYOUT) as FactoryZoneId[]).map((zone) => FACTORY_WORLD_SELECTION_PRODUCER_IDS[zone]));

export function identityZoneOf(producerId: string): FactoryZoneId | null {
    for (const zone of Object.keys(ZONE_LAYOUT) as FactoryZoneId[]) if (FACTORY_WORLD_SELECTION_PRODUCER_IDS[zone] === producerId) return zone;
    return null;
}

export function producerNumberOf(producerId: string): number {
    return IDENTITY_PRODUCER_IDS.indexOf(producerId) + 1;
}

/**
 * Glyph frame -> producer-local. The default camera sits at yaw 135 (the +X / -Z corner), so screen-right is (-1, -1)/sqrt2 and
 * screen-up on the ground is (-1, +1)/sqrt2: a decal drawn in the glyph frame (u right, v up) reads upright on screen.
 */
function glyphPoint(anchor: { x: number; z: number }, u: number, v: number): { x: number; z: number } {
    return { x: anchor.x - HALF_SQRT2 * (u + v), z: anchor.z + HALF_SQRT2 * (v - u) };
}

/** Rotation about Y that maps the box x axis onto the screen-right direction rotated by `glyphAngleDeg` in the glyph frame. */
function glyphRotY(glyphAngleDeg: number): number {
    const phi = (glyphAngleDeg * Math.PI) / 180;
    const dx = -HALF_SQRT2 * (Math.cos(phi) + Math.sin(phi));
    const dz = HALF_SQRT2 * (Math.sin(phi) - Math.cos(phi));
    return (Math.atan2(-dz, dx) * 180) / Math.PI;
}

/** The anchor offsets of the decal cluster, relative to the camera-near footprint corner (w/2, -d/2) of the zone. */
/**
 * AUT-066 tuning: where the plate + zone tag go. Machines cover the foundation corners (device captures: the Advanced Robotics Complex hid its own plate
 * and pips), so the plate and the tag sit OUTSIDE the footprint (>= 0.15 away) on the ground strip: in front of the -Z edge ('front') or beside the +X edge
 * ('east', the Automated Cell: its front strip is the Robot Line lane). The symbol and the stripe stay on the foundation, except the complex stripe, which
 * is shortened to 3 boxes and moved onto the ground in front of the lip (a barrel stood at the end of the 5-box stripe). Footprints measured from the layout
 * modules + the AUT-066 device captures; not read from prefab bounds at runtime.
 */
export interface DecalPlacement {
    readonly side: 'front' | 'east';
    readonly stripeOnGround: boolean;
    readonly stripeBoxes: number;
}

export const DECAL_PLACEMENT: Readonly<Record<FactoryZoneId, DecalPlacement>> = Object.freeze({
    Fabricator: Object.freeze({ side: 'front' as const, stripeOnGround: false, stripeBoxes: 5 }),
    AssemblyStation: Object.freeze({ side: 'front' as const, stripeOnGround: false, stripeBoxes: 5 }),
    RobotLine: Object.freeze({ side: 'front' as const, stripeOnGround: false, stripeBoxes: 5 }),
    AutomatedCell: Object.freeze({ side: 'east' as const, stripeOnGround: false, stripeBoxes: 5 }),
    AdvancedRoboticsComplex: Object.freeze({ side: 'front' as const, stripeOnGround: true, stripeBoxes: 3 }),
});

/** Minimum distance between the plate / tag and the zone footprint. */
export const DECAL_OUTSIDE_MARGIN = 0.15;

function clusterAnchors(zoneId: FactoryZoneId, zone: FactoryZoneRect): { symbol: { x: number; z: number }; plate: { x: number; z: number }; tag: { x: number; z: number }; stripe: { x: number; z: number } } {
    const placement = DECAL_PLACEMENT[zoneId];
    const cornerX = zone.width / 2;
    const cornerZ = -zone.depth / 2;
    const symbol = { x: cornerX - 0.5, z: cornerZ + 0.5 };
    const plate = placement.side === 'front' ? { x: cornerX - 0.95, z: cornerZ - 0.55 } : { x: cornerX + 0.6, z: cornerZ + 0.6 };
    const tag = glyphPoint(plate, 0, -0.34);
    return { symbol, plate, tag, stripe: { x: cornerX - 0.7, z: placement.stripeOnGround ? cornerZ - 0.12 : cornerZ + 0.12 } };
}

export const DECAL_SYMBOL = Object.freeze({ hexSize: 0.17 * DECAL_SCALE * 2, bar: 0.036 * DECAL_SCALE, tile: 0.34, core: 0.14 });
export const DECAL_STRIPE = Object.freeze({ boxes: 5, boxLength: 0.2, boxDepth: 0.12 });
export const DECAL_TAG = Object.freeze({ width: 0.8, height: 0.18, pip: 0.1, pipGap: 0.15 });

/** Decal boxes of one producer (<= 5 colour groups). `level` 0 = a future bay (stripe + zone tag), >= 1 = built (all four kinds). */
export function decalPartsFor(producerId: string, level: number): DecalPart[] {
    const zoneId = identityZoneOf(producerId);
    if (zoneId === null) return [];
    const zone = ZONE_LAYOUT[zoneId];
    const number = producerNumberOf(producerId);
    const built = Number.isFinite(level) && level >= DECAL_BUILT_LEVEL;
    const anchors = clusterAnchors(zoneId, zone);
    const placement = DECAL_PLACEMENT[zoneId];
    const parts: DecalPart[] = [];
    const surface = (a: { x: number; z: number }): number => floorHeightAt(zone.x + a.x, zone.z + a.z) + DECAL_SURFACE_OFFSET;
    const push = (kind: DecalKind, color: IdentityColorKey, width: number, depth: number, centre: { x: number; z: number }, baseY: number, layer: number, rotYDeg: number): void => {
        parts.push(Object.freeze({
            kind, color, face: 'top' as const,
            size: Object.freeze({ x: width, y: DECAL_THICKNESS, z: depth }),
            localPos: Object.freeze({ x: centre.x, y: baseY + DECAL_THICKNESS * (layer + 0.5), z: centre.z }),
            rotYDeg,
        }));
    };
    const onGlyph = (kind: DecalKind, color: IdentityColorKey, anchor: { x: number; z: number }, baseY: number, layer: number, u: number, v: number, w: number, h: number, glyphAngleDeg = 0): void => {
        push(kind, color, w, h, glyphPoint(anchor, u, v), baseY, layer, glyphRotY(glyphAngleDeg));
    };

    if (built) {
        // symbol: graphite tile, 6 cyan bars around the AI-mark hexagon, off-white diamond core.
        const baseY = surface(anchors.symbol);
        onGlyph('symbol', 'graphite', anchors.symbol, baseY, 0, 0, 0, DECAL_SYMBOL.tile, DECAL_SYMBOL.tile, 45);
        const hex = aiMarkGeometry(0, 0, DECAL_SYMBOL.hexSize).hexOuter;
        for (let i = 0; i < hex.length; i += 1) {
            const a: PermanentUpgradePoint = hex[i];
            const b: PermanentUpgradePoint = hex[(i + 1) % hex.length];
            const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
            onGlyph('symbol', 'cyan', anchors.symbol, baseY, 1, (a.x + b.x) / 2, (a.y + b.y) / 2, Math.hypot(b.x - a.x, b.y - a.y) + DECAL_SYMBOL.bar * 0.5, DECAL_SYMBOL.bar, angle);
        }
        onGlyph('symbol', 'offWhite', anchors.symbol, baseY, 1, 0, 0, DECAL_SYMBOL.core, DECAL_SYMBOL.core, 45);

        // numberPlate: graphite plate with the off-white seven-segment number.
        const plateY = surface(anchors.plate);
        onGlyph('numberPlate', 'graphite', anchors.plate, plateY, 0, 0, 0, NUMBER_PLATE.width, NUMBER_PLATE.height);
        for (const seg of numberPlateBoxes(number)) onGlyph('numberPlate', 'offWhite', anchors.plate, plateY, 1, seg.u, seg.v, seg.w, seg.h);
    }

    // hazardStripe: 5 alternating amber / graphite boxes along the front edge of the foundation.
    for (let i = 0; i < placement.stripeBoxes; i += 1) {
        const offset = (i - (placement.stripeBoxes - 1) / 2) * DECAL_STRIPE.boxLength;
        // Each stripe box takes the surface height under ITSELF (the Robot Line stripe straddles a slab edge).
        const centre = { x: anchors.stripe.x - offset, z: anchors.stripe.z };
        push('hazardStripe', i % 2 === 0 ? 'amber' : 'graphite', DECAL_STRIPE.boxLength, DECAL_STRIPE.boxDepth, centre, surface(centre), 0, 0);
    }

    // zoneTag: graphite plate + 1..5 amber pips (the producer number).
    const tagY = surface(anchors.tag);
    onGlyph('zoneTag', 'graphite', anchors.tag, tagY, 0, 0, 0, DECAL_TAG.width, DECAL_TAG.height);
    const pips = Math.max(1, Math.min(5, number));
    for (let i = 0; i < pips; i += 1) onGlyph('zoneTag', 'amber', anchors.tag, tagY, 1, (i - (pips - 1) / 2) * DECAL_TAG.pipGap, 0, DECAL_TAG.pip, DECAL_TAG.pip);
    return parts;
}

/** A decal part as a generic identity box (producer-local, rotation about Y only). */
export function decalPartAsBox(part: DecalPart): IdentityBox {
    return box(part.kind, part.color, [part.size.x, part.size.y, part.size.z], [part.localPos.x, part.localPos.y, part.localPos.z], part.rotYDeg);
}

/** Renderer groups (one merged mesh each) of a producer's decal parts. */
export function decalRendererGroups(parts: readonly DecalPart[]): IdentityColorGroup[] {
    return groupBoxesByColor(parts.map(decalPartAsBox));
}

/** Axis-aligned XZ bounds of a decal part after its Y rotation (producer-local). */
export function decalPartBoundsXZ(part: DecalPart): { minX: number; maxX: number; minZ: number; maxZ: number } {
    const rad = (part.rotYDeg * Math.PI) / 180;
    const c = Math.abs(Math.cos(rad));
    const s = Math.abs(Math.sin(rad));
    const hx = (part.size.x * c + part.size.z * s) / 2;
    const hz = (part.size.x * s + part.size.z * c) / 2;
    return { minX: part.localPos.x - hx, maxX: part.localPos.x + hx, minZ: part.localPos.z - hz, maxZ: part.localPos.z + hz };
}

export interface DecalSummary {
    readonly producerId: string;
    readonly parts: number;
    readonly boxes: number;
    readonly kinds: readonly DecalKind[];
}

export function decalSummaryFor(producerId: string, level = DECAL_BUILT_LEVEL): DecalSummary {
    const parts = decalPartsFor(producerId, level);
    return { producerId, parts: decalRendererGroups(parts).length, boxes: parts.length, kinds: DECAL_KINDS.filter((kind) => parts.some((part) => part.kind === kind)) };
}

// ---------------------------------------------------------------------------------------------------------------
// UI icons (convex polygons in the 0..1 unit square, y up)

export type IconName = 'industrial_output' | 'ai_core' | 'robot' | 'automation' | 'overclock' | 'reboot' | 'milestone' | 'breakthrough';
export const ICON_NAMES: readonly IconName[] = Object.freeze(['industrial_output', 'ai_core', 'robot', 'automation', 'overclock', 'reboot', 'milestone', 'breakthrough'] as const);

/** `ink` is painted in the primary colour, `accent` in the secondary one, in list order (later polygons paint over earlier ones). */
export type IconRole = 'ink' | 'accent';
export interface IconPolygon {
    readonly role: IconRole;
    readonly points: readonly PermanentUpgradePoint[];
}

const pt = (x: number, y: number): PermanentUpgradePoint => Object.freeze({ x, y });
const poly = (role: IconRole, ...coords: Array<[number, number]>): IconPolygon => Object.freeze({ role, points: Object.freeze(coords.map(([x, y]) => pt(x, y))) });
const rectPoly = (role: IconRole, x0: number, y0: number, x1: number, y1: number): IconPolygon => poly(role, [x0, y0], [x1, y0], [x1, y1], [x0, y1]);

function aiCoreIcon(): IconPolygon[] {
    const mark = aiMarkGeometry(0.5, 0.5, 1);
    const out: IconPolygon[] = [];
    for (let i = 0; i < mark.hexOuter.length; i += 1) {
        const j = (i + 1) % mark.hexOuter.length;
        out.push(poly('accent', [mark.hexOuter[i].x, mark.hexOuter[i].y], [mark.hexOuter[j].x, mark.hexOuter[j].y], [mark.hexInner[j].x, mark.hexInner[j].y], [mark.hexInner[i].x, mark.hexInner[i].y]));
    }
    out.push(poly('ink', ...mark.diamond.map((p): [number, number] => [p.x, p.y])));
    return out;
}

function rebootIcon(): IconPolygon[] {
    // Broken ring: 12 sectors of a ring (outer 0.46, inner 0.28), sectors 2 and 3 (the upper right) missing, plus an arrow head at the gap.
    const out: IconPolygon[] = [];
    const sector = (k: number): [number, number][] => {
        const a0 = (k * Math.PI) / 6;
        const a1 = ((k + 1) * Math.PI) / 6;
        return [[0.5 + Math.cos(a0) * 0.46, 0.5 + Math.sin(a0) * 0.46], [0.5 + Math.cos(a1) * 0.46, 0.5 + Math.sin(a1) * 0.46], [0.5 + Math.cos(a1) * 0.28, 0.5 + Math.sin(a1) * 0.28], [0.5 + Math.cos(a0) * 0.28, 0.5 + Math.sin(a0) * 0.28]];
    };
    for (let k = 0; k < 12; k += 1) if (k !== 1 && k !== 2) out.push(poly('ink', ...sector(k)));
    out.push(poly('accent', [0.66, 0.98], [0.98, 0.9], [0.72, 0.66]));
    return out;
}

export const ICON_SHAPES: Readonly<Record<IconName, readonly IconPolygon[]>> = Object.freeze({
    industrial_output: Object.freeze([rectPoly('ink', 0.08, 0.08, 0.3, 0.4), rectPoly('ink', 0.39, 0.08, 0.61, 0.64), rectPoly('accent', 0.7, 0.08, 0.92, 0.92)]),
    ai_core: Object.freeze(aiCoreIcon()),
    robot: Object.freeze([
        rectPoly('ink', 0.47, 0.8, 0.53, 0.96),
        rectPoly('ink', 0.22, 0.38, 0.78, 0.8),
        rectPoly('accent', 0.33, 0.52, 0.45, 0.64),
        rectPoly('accent', 0.55, 0.52, 0.67, 0.64),
        rectPoly('ink', 0.12, 0.06, 0.88, 0.3),
    ]),
    automation: Object.freeze([
        poly('ink', [0.06, 0.78], [0.3, 0.78], [0.52, 0.5], [0.4, 0.5]),
        poly('ink', [0.4, 0.5], [0.52, 0.5], [0.3, 0.22], [0.06, 0.22]),
        poly('accent', [0.46, 0.78], [0.7, 0.78], [0.94, 0.5], [0.82, 0.5]),
        poly('accent', [0.82, 0.5], [0.94, 0.5], [0.7, 0.22], [0.46, 0.22]),
    ]),
    overclock: Object.freeze([
        poly('ink', [0.45, 0.96], [0.78, 0.96], [0.55, 0.52], [0.22, 0.52]),
        poly('accent', [0.22, 0.52], [0.72, 0.52], [0.36, 0.04]),
    ]),
    reboot: Object.freeze(rebootIcon()),
    milestone: Object.freeze([rectPoly('ink', 0.16, 0.06, 0.26, 0.94), poly('accent', [0.26, 0.94], [0.88, 0.76], [0.26, 0.56])]),
    breakthrough: Object.freeze([
        poly('ink', [0.5, 0.96], [0.62, 0.5], [0.5, 0.04], [0.38, 0.5]),
        poly('accent', [0.04, 0.5], [0.5, 0.62], [0.96, 0.5], [0.5, 0.38]),
    ]),
});

/** Convexity of a polygon (all cross products of consecutive edges share one sign). */
export function isConvexPolygon(points: readonly PermanentUpgradePoint[]): boolean {
    if (points.length < 3) return false;
    let sign = 0;
    for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const c = points[(i + 2) % points.length];
        const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if (Math.abs(cross) < 1e-9) continue;
        const current = cross > 0 ? 1 : -1;
        if (sign === 0) sign = current; else if (sign !== current) return false;
    }
    return sign !== 0;
}

/** Icon polygons mapped into the rect centred on (cx, cy) with edge `size` (design units, y up). */
export function iconPolygonsAt(name: IconName, cx: number, cy: number, size: number): Array<{ role: IconRole; points: PermanentUpgradePoint[] }> {
    return ICON_SHAPES[name].map((polygon) => ({ role: polygon.role, points: polygon.points.map((p) => ({ x: cx + (p.x - 0.5) * size, y: cy + (p.y - 0.5) * size })) }));
}

/** The icon of a producer panel header (null = none). */
export function producerIconFor(producerId: string | null): IconName | null {
    switch (producerId) {
        case 'fabricator': return 'industrial_output';
        case 'assembly_station': return 'robot';
        case 'robot_line': return 'automation';
        case 'automated_cell': return 'automation';
        case 'advanced_robotics_complex': return 'robot';
        default: return null;
    }
}

/** The icon of a milestone toast kind (null = none). */
export function milestoneIconFor(kind: string): IconName | null {
    switch (kind) {
        case 'producer_milestone': return 'milestone';
        case 'producer_constructed': return 'milestone';
        case 'automation': return 'automation';
        case 'breakthrough': return 'breakthrough';
        case 'robots_built': return 'robot';
        case 'reboot_title': return 'reboot';
        default: return null;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Icon slots: placed inside EXISTING rows / chips only (text rects, hit rects and tap targets are unchanged)

export interface IconSlot {
    readonly slot: string;
    /** Centre relative to the parent node and edge size (design units). */
    readonly x: number;
    readonly y: number;
    readonly size: number;
}

/** HUD Industrial Output row: the icon sits at the left edge of the row (the value text is centred). */
export function hudIndustrialIconSlot(): IconSlot {
    return Object.freeze({ slot: 'hud_industrial_output', x: -cardRowWidth(CORE_HUD_LAYOUT) / 2 + 24, y: cardRowCenterY(CORE_HUD_LAYOUT, 0), size: 26 });
}

/** HUD Overclock button (the two Overclock rows): the bolt sits at the left edge of the pill. */
export function hudOverclockIconSlot(): IconSlot {
    return Object.freeze({ slot: 'hud_overclock', x: -cardRowWidth(CORE_HUD_LAYOUT) / 2 + 34, y: cardActionRect(CORE_HUD_LAYOUT, 'OverclockAction').y, size: 36 });
}

/** Producer panel header (the ProducerName row): left edge of the row. */
export function producerHeaderIconSlot(): IconSlot {
    return Object.freeze({ slot: 'producer_header', x: -cardRowWidth(PRODUCER_PANEL_LAYOUT) / 2 + 24, y: cardRowCenterY(PRODUCER_PANEL_LAYOUT, 0), size: 30 });
}

/** Milestone toast pill (local to the band, y down from 0): left of the centred title. */
export function milestoneIconSlot(tier: PresentedMilestoneTier): IconSlot {
    const layout = MILESTONE_TOAST_LAYOUT[tier];
    return Object.freeze({ slot: 'milestone_toast', x: -layout.width / 2 + 30, y: layout.titleCenterY, size: Math.min(32, layout.titleLineHeight - 4) });
}

/** Founder chip (local to the chip centre): the Robot icon (off-white / amber only; gold stays on the Founder robot) at the left edge. */
export function founderChipIconSlot(): IconSlot {
    return Object.freeze({ slot: 'founder_chip', x: -FOUNDER_CHIP_WIDTH / 2 + 24, y: 0, size: 36 });
}
