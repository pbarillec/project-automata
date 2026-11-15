import { Color, Graphics, Node, Vec3 } from 'cc';
import { IDENTITY_PALETTE, iconPolygonsAt, type IconName, type IdentityRgb } from './AutomataIdentity.ts';
import { aiMarkGeometry, type PermanentUpgradePoint } from './PermanentUpgradeLayout.ts';

/**
 * AUT-066 thin `cc` UI drawing helpers: filled polygons only (Graphics.fill; never stroke(), never a spriteFrame-less Sprite, which
 * renders nothing on Android). Geometry comes from the pure AutomataIdentity module; the AI mark from the existing `aiMarkGeometry`.
 */

function colorOf(rgb: IdentityRgb, alpha = 1): Color {
    return new Color(rgb.r, rgb.g, rgb.b, Math.round(255 * Math.max(0, Math.min(1, alpha))));
}

function fillPolygon(g: Graphics, points: readonly PermanentUpgradePoint[], color: Color): void {
    g.fillColor = color;
    points.forEach((point, index) => { if (index === 0) g.moveTo(point.x, point.y); else g.lineTo(point.x, point.y); });
    g.close();
    g.fill();
}

/**
 * The AI mark (cyan hexagon outline, off-white diamond) centred on (cx, cy) with edge `size`; drawn over graphite. The single
 * consumer shared by the HUD AI chip, the Reboot chip / modal and the AI Upgrades screen. Does NOT clear the Graphics.
 */
export function drawAiMark(g: Graphics, cx: number, cy: number, size: number): void {
    const mark = aiMarkGeometry(cx, cy, size);
    fillPolygon(g, mark.hexOuter, colorOf(IDENTITY_PALETTE.cyan));
    fillPolygon(g, mark.hexInner, colorOf(IDENTITY_PALETTE.graphite));
    fillPolygon(g, mark.diamond, colorOf(IDENTITY_PALETTE.offWhite));
}

export interface IconColors {
    readonly ink: IdentityRgb;
    readonly accent: IdentityRgb;
    readonly alpha?: number;
}

export const DEFAULT_ICON_COLORS: IconColors = Object.freeze({ ink: IDENTITY_PALETTE.offWhite, accent: IDENTITY_PALETTE.amber });

/** Draws an icon from ICON_SHAPES centred on (cx, cy) with edge `size` (design units). Does NOT clear the Graphics. */
export function drawIcon(g: Graphics, name: IconName, cx: number, cy: number, size: number, colors: IconColors = DEFAULT_ICON_COLORS): void {
    if (name === 'ai_core') {
        drawAiMark(g, cx, cy, size);
        return;
    }
    const ink = colorOf(colors.ink, colors.alpha ?? 1);
    const accent = colorOf(colors.accent, colors.alpha ?? 1);
    for (const polygon of iconPolygonsAt(name, cx, cy, size)) fillPolygon(g, polygon.points, polygon.role === 'ink' ? ink : accent);
}

// ---- DEBUG registry: which icon was drawn where (read by the `identity` device diagnostic only) ----

export interface DrawnIcon {
    readonly slot: string;
    readonly icon: IconName;
    readonly node: Node;
    readonly x: number;
    readonly y: number;
    readonly size: number;
}

const drawnIcons = new Map<string, DrawnIcon>();

export function recordIcon(entry: DrawnIcon): void {
    drawnIcons.set(entry.slot, entry);
}

export function clearIconRecord(slot: string): void {
    drawnIcons.delete(slot);
}

export function getDrawnIcons(): readonly DrawnIcon[] {
    return [...drawnIcons.values()].filter((entry) => entry.node.isValid);
}

/** World-space corners (design units, UI plane) of a drawn icon rect, for projection through the UI camera. */
export function drawnIconWorldCorners(entry: DrawnIcon): [Vec3, Vec3] {
    const half = entry.size / 2;
    const a = Vec3.transformMat4(new Vec3(), new Vec3(entry.x - half, entry.y - half, 0), entry.node.worldMatrix);
    const b = Vec3.transformMat4(new Vec3(), new Vec3(entry.x + half, entry.y + half, 0), entry.node.worldMatrix);
    return [a, b];
}
