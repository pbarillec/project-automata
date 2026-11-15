import { WORKER_BOT_SCALE } from './AssemblySliceLayout.ts';

/**
 * AUT-062 engine-free Founder Robot / UNIT 0001 variant model (ART_DIRECTION 16, ASSET_MANIFEST CUSTOM_FOUNDER_ROBOT_01).
 * No new imported asset and no `Robot.glb` edit: the Founder variant is a graphite shell tint (a cloned material instance on the
 * Founder node only, never the shared robot material) plus runtime child box primitives (gold crest / antenna, gold shoulder and
 * chest bands, a UNIT 0001 plate). Everything is opaque (alpha 255), unlit, no glow. Presentation only: it reads
 * `meta.cosmeticOwnership['cosmetic.founder_robot']` (through the controllers) and never writes state.
 *
 * Which robots: owned -> rank 0 (the AUT-039 Worker Bot) and, once the population is big enough, at most ONE pooled robot at a
 * stable slot; never every robot, never more than 2, deterministic.
 */

export interface FounderRgba { readonly r: number; readonly g: number; readonly b: number; readonly a: 255 }

export const FOUNDER_PALETTE = Object.freeze({
    GRAPHITE_SHELL: Object.freeze({ r: 38, g: 40, b: 46, a: 255 } as const),
    GRAPHITE_DARK: Object.freeze({ r: 22, g: 24, b: 28, a: 255 } as const),
    // Tuning round 1 (visual QA: hazard yellow): the briefed 232/176/48 and 255/214/110 were darkened ~12% and warmed toward amber. Unlit boxes use mainColor as-is (no linear conversion); the shell tint on the standard effect is linear-flagged, which only makes graphite read slightly darker.
    GOLD_ACCENT: Object.freeze({ r: 204, g: 146, b: 40, a: 255 } as const),
    GOLD_HILITE: Object.freeze({ r: 240, g: 190, b: 92, a: 255 } as const),
});
export type FounderColorKey = keyof typeof FOUNDER_PALETTE;

function channel(value: number): number {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an sRGB colour. */
export function relativeLuminance(color: { readonly r: number; readonly g: number; readonly b: number }): number {
    return (0.2126 * channel(color.r)) + (0.7152 * channel(color.g)) + (0.0722 * channel(color.b));
}

/** WCAG contrast ratio (1..21). */
export function contrastRatio(a: { readonly r: number; readonly g: number; readonly b: number }, b: { readonly r: number; readonly g: number; readonly b: number }): number {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The ownership key is `FOUNDER_ROBOT_COSMETIC_ID` ('cosmetic.founder_robot'); the controllers read it through isFounderRobotCosmeticOwned. */

export const FOUNDER_MAX_ROBOTS = 2;
/**
 * Pooled slot that carries the Founder variant, chosen for the largest loop-phase distance from rank 0 (phase 0): slot phases are (slot + 1) x 0.618 mod 1,
 * so slot 3 (rank 4) sits at 0.47 (opposite, same Assembly <-> Storage loop) while the old slot 2 sat at 0.15 and overlapped rank 0. Stable across sessions.
 */
export const FOUNDER_POOL_SLOT = 3;
/** With only 4 visible (3 pooled slots, 0..2) slot 3 does not exist: slot 0 (phase 0.62, 0.38 from rank 0) is the farthest available. */
export const FOUNDER_POOL_SLOT_SMALL = 0;
/** Visible robots (rank 0 + pool) from which slot 3 exists. */
export const FOUNDER_POOL_FAR_MIN_VISIBLE = 5;
/** Visible robots (rank 0 + pool) needed before a pooled robot is also a Founder (so Founder robots stay a minority). */
export const FOUNDER_POOL_MIN_VISIBLE = 4;

export interface FounderRobotSlots {
    /** Rank 0 (the first AUT-039 Worker Bot node) carries the variant, even while hidden (so the first reveal already uses it). */
    readonly workerBot: boolean;
    /** Pool slots (0-based; overall rank = slot + 1). */
    readonly poolSlots: readonly number[];
}

/** Pure rule: which robots are Founder robots. Not owned -> none; owned -> rank 0 plus at most one pooled slot when `visibleCount >= 4`. */
export function resolveFounderRobotSlots(owned: boolean, visibleCount: number): FounderRobotSlots {
    if (owned !== true) return Object.freeze({ workerBot: false, poolSlots: Object.freeze([]) as readonly number[] });
    const visible = Number.isFinite(visibleCount) ? Math.max(0, Math.floor(visibleCount)) : 0;
    const poolSlots = visible >= FOUNDER_POOL_FAR_MIN_VISIBLE ? [FOUNDER_POOL_SLOT] : visible >= FOUNDER_POOL_MIN_VISIBLE ? [FOUNDER_POOL_SLOT_SMALL] : [];
    return Object.freeze({ workerBot: true, poolSlots: Object.freeze(poolSlots) as readonly number[] });
}

/** Overall robot ranks (0 = Worker Bot, slot + 1 = pooled) that are Founder robots. */
export function founderRanks(slots: FounderRobotSlots): readonly number[] {
    return Object.freeze([...(slots.workerBot ? [0] : []), ...slots.poolSlots.map((slot) => slot + 1)]);
}

/** Robot.glb bind-pose height at unit scale (AssemblySliceLayout): 4.513 x WORKER_BOT_SCALE = 1.08 world. */
export const FOUNDER_ROBOT_UNIT_HEIGHT = 4.513;
/** World height of the head top / whole robot at the Worker Bot scale. */
export const FOUNDER_BODY_HEIGHT = FOUNDER_ROBOT_UNIT_HEIGHT * WORKER_BOT_SCALE;

/** The briefed starting crest dimensions were enlarged ONCE by this factor (AUT-062 brief); see docs/AUT-062_FOUNDER_ROBOT.md. */
export const FOUNDER_CREST_ENLARGE = 1.5;
/** Fallback (graphite child shell boxes) enlarges the gold accents so they still carry the read. */
export const FOUNDER_FALLBACK_ACCENT_ENLARGE = 1.25;

export type FounderPartGroup = 'crest' | 'band' | 'plate' | 'pip' | 'shell';

export interface FounderPart {
    readonly id: string;
    readonly group: FounderPartGroup;
    readonly color: FounderColorKey;
    /** World units at the final Worker Bot scale (the container node applies 1 / WORKER_BOT_SCALE). x right, y up, z forward. */
    readonly size: { readonly x: number; readonly y: number; readonly z: number };
    readonly center: { readonly x: number; readonly y: number; readonly z: number };
}

const E = FOUNDER_CREST_ENLARGE;
const HEAD_TOP = FOUNDER_BODY_HEIGHT;
const FIN_SINK = 0.02;
const FIN_HEIGHT = 0.16 * E;
const FIN_TOP = HEAD_TOP - FIN_SINK + FIN_HEIGHT;
const ANTENNA_HEIGHT = 0.36;
const ANTENNA_BASE = FIN_TOP - FIN_SINK;
const ANTENNA_TOP = ANTENNA_BASE + ANTENNA_HEIGHT;
const TIP = 0.05 * E;

const PLATE_Y = 0.56;
const PLATE_FRONT_Z = 0.176;
const PIP_XS: readonly number[] = Object.freeze([-0.045, -0.015, 0.015, 0.045]);

function plateParts(side: 'front' | 'back'): FounderPart[] {
    const sign = side === 'front' ? 1 : -1;
    return [
        { id: `unit_plate_${side}`, group: 'plate', color: 'GOLD_ACCENT', size: { x: 0.12, y: 0.06, z: 0.012 }, center: { x: 0, y: PLATE_Y, z: sign * PLATE_FRONT_Z } },
        ...PIP_XS.map((x, index): FounderPart => ({ id: `unit_pip_${side}_${index + 1}`, group: 'pip', color: 'GRAPHITE_DARK', size: { x: 0.016, y: 0.026, z: 0.006 }, center: { x, y: PLATE_Y, z: sign * (PLATE_FRONT_Z + 0.009) } })),
    ];
}

/**
 * UNIT 0001 marking: opaque gold plate with four graphite pips (the "gold plate with 4 pips" fallback: glyph text is anti-aliased /
 * alpha-blended and not guaranteed opaque on Android, and legibility is not a pass criterion). Front and back so it shows from either side.
 */
export const FOUNDER_UNIT_MARK = Object.freeze({ kind: 'plate_with_pips' as const, pips: PIP_XS.length, text: 'UNIT 0001' });

/** Accent parts (the shell tint is a material instance, not a part). */
export const FOUNDER_ACCENT_PARTS: readonly FounderPart[] = Object.freeze([
    // Crest: gold fin on the head top with a thin gold antenna stacked on it and a bright tip (added height >= 1/3 of the body).
    // Tuning round 1: a wider gold head cap (0.22) so the crest is a robust blob from any yaw.
    { id: 'crest_cap', group: 'crest', color: 'GOLD_ACCENT', size: { x: 0.22, y: 0.05, z: 0.22 }, center: { x: 0, y: HEAD_TOP + 0.015, z: 0 } },
    { id: 'crest_fin', group: 'crest', color: 'GOLD_ACCENT', size: { x: 0.10, y: FIN_HEIGHT, z: 0.15 }, center: { x: 0, y: HEAD_TOP - FIN_SINK + (FIN_HEIGHT / 2), z: 0 } },
    { id: 'crest_antenna', group: 'crest', color: 'GOLD_ACCENT', size: { x: 0.015 * E, y: ANTENNA_HEIGHT, z: 0.015 * E }, center: { x: 0, y: ANTENNA_BASE + (ANTENNA_HEIGHT / 2), z: 0 } },
    { id: 'crest_tip', group: 'crest', color: 'GOLD_HILITE', size: { x: TIP, y: TIP, z: TIP }, center: { x: 0, y: ANTENNA_TOP, z: 0 } },
    // Two shoulder pads and one chest band (gold area that survives a distant, tilted camera).
    { id: 'band_shoulder_left', group: 'band', color: 'GOLD_ACCENT', size: { x: 0.11, y: 0.09, z: 0.20 }, center: { x: -0.18, y: 0.64, z: 0 } },
    { id: 'band_shoulder_right', group: 'band', color: 'GOLD_ACCENT', size: { x: 0.11, y: 0.09, z: 0.20 }, center: { x: 0.18, y: 0.64, z: 0 } },
    { id: 'band_chest', group: 'band', color: 'GOLD_ACCENT', size: { x: 0.40, y: 0.06, z: 0.34 }, center: { x: 0, y: 0.46, z: 0 } },
    ...plateParts('front'),
    ...plateParts('back'),
] as FounderPart[]);

/** Used only when the glb materials cannot be tinted per node: graphite shell boxes over the head and torso. */
export const FOUNDER_FALLBACK_SHELL_PARTS: readonly FounderPart[] = Object.freeze([
    { id: 'shell_head', group: 'shell', color: 'GRAPHITE_SHELL', size: { x: 0.62, y: 0.30, z: 0.58 }, center: { x: 0, y: HEAD_TOP - 0.15, z: 0 } },
    { id: 'shell_torso', group: 'shell', color: 'GRAPHITE_SHELL', size: { x: 0.37, y: 0.36, z: 0.32 }, center: { x: 0, y: 0.52, z: 0 } },
] as FounderPart[]);

export const FOUNDER_MAX_PARTS = FOUNDER_ACCENT_PARTS.length + FOUNDER_FALLBACK_SHELL_PARTS.length;

/** Crest extent above the head top (fin + antenna + tip). */
export const FOUNDER_CREST_ADDED_HEIGHT = (ANTENNA_TOP + (TIP / 2)) - HEAD_TOP;

/** Material names (glb: Main / Grey / Black) -> shell colour. Black parts (joints, feet) stay the darker graphite. */
export function founderShellColorForMaterialName(name: string): FounderColorKey {
    return /black/i.test(name) ? 'GRAPHITE_DARK' : 'GRAPHITE_SHELL';
}

/** The accent part, optionally enlarged around its own centre (fallback mode); gold groups only. */
export function founderPartSize(part: FounderPart, fallbackShell: boolean): { x: number; y: number; z: number } {
    const k = fallbackShell && (part.group === 'band' || part.group === 'plate') ? FOUNDER_FALLBACK_ACCENT_ENLARGE : 1;
    return { x: part.size.x * k, y: part.size.y * k, z: part.size.z * k };
}

export const FOUNDER_DIAGNOSTIC_VERSION = 1;
