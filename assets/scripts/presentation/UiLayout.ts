/**
 * AUT-R-036 landscape layout of the Core HUD and the Producer Panel (engine-free).
 *
 * One source for the card sizes, row heights, font sizes, edge margin and anchor corners. The
 * controllers read the card specs to build their rows; FactoryWorldBootstrap reads the corners and
 * the margin for the cards' Widgets. `computeUiLayout` predicts the on-screen rectangles for a
 * screen size and safe area so the layout budget (inside the safe area, no overlap, coverage) is
 * unit-tested without `cc`. Units are design units of the 1280×720 fit-height design resolution
 * unless a name says pixels. No styling lives here.
 */

export const UI_DESIGN_RESOLUTION = { width: 1280, height: 720 } as const;
/** Gap between a card and the safe-area edge it is anchored to. */
export const UI_EDGE_MARGIN = 16;
/** Smallest font size allowed for body text (design units). */
export const UI_MIN_BODY_FONT_SIZE = 20;
/** Coverage budgets for HUD + panel together (ART_DIRECTION §19.2 keeps ~65–75% for the factory). */
export const UI_MAX_COVERAGE_16_9 = 0.30;
export const UI_MAX_COVERAGE = 0.35;

export type UiCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface UiRowSpec {
    readonly key: string;
    readonly height: number;
    readonly fontSize: number;
}

/** One Button inside an action row (its own rect; buttons sit left to right). */
export interface UiActionSpec {
    readonly key: string;
    readonly width: number;
}

/**
 * AUT-UI-001: a row of side-by-side Buttons below the label rows. The buttons plus the gaps between
 * them fill the row width exactly (tested).
 */
export interface UiActionRowSpec {
    readonly height: number;
    readonly fontSize: number;
    readonly gap: number;
    readonly actions: readonly UiActionSpec[];
}

export interface UiCardSpec {
    readonly name: string;
    readonly width: number;
    readonly padding: number;
    readonly corner: UiCorner;
    readonly rows: readonly UiRowSpec[];
    readonly actionRow?: UiActionRowSpec;
}

/** Screen rectangle, bottom-left origin (the Cocos screen/touch frame). */
export interface UiRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export const CORE_HUD_LAYOUT: UiCardSpec = {
    name: 'CoreHUD',
    width: 460,
    padding: 10,
    corner: 'top-left',
    rows: [
        { key: 'IndustrialOutputValue', height: 40, fontSize: 32 },
        { key: 'ProductionPerSecondValue', height: 28, fontSize: 20 },
        { key: 'NextGoalValue', height: 28, fontSize: 22 },
        { key: 'NextGoalContext', height: 28, fontSize: 20 },
        { key: 'FreeOverclockValue', height: 28, fontSize: 20 },
        { key: 'FreeOverclockTimer', height: 28, fontSize: 20 },
    ],
    // AUT-UI-001: Manual Produce (permanent) and the Next Goal unlock, side by side in one row so the HUD
    // stays clear of the projected producer zones on the NE2215. 52 units (78 px at 1080p) is taller
    // than the panel's 44-unit Buttons for touch comfort; the Next Goal button is wider for its cost text.
    // Font 21: on the NE2215 "Manual Produce" measured ~0.52 × fontSize per character (wider than the
    // 0.48 estimate), so 160 units hold it without SHRINK while the Next Goal caption keeps 272 (Android
    // floors label pixels: 21 renders as 20.67 design units at 1080p).
    actionRow: {
        height: 52,
        fontSize: 21,
        gap: 8,
        actions: [
            { key: 'ManualProduceAction', width: 160 },
            { key: 'NextGoalAction', width: 272 },
        ],
    },
};

export const HUD_ACTION_KEYS = ['ManualProduceAction', 'NextGoalAction'] as const;
export type HudActionKey = typeof HUD_ACTION_KEYS[number];

export const PRODUCER_PANEL_LAYOUT: UiCardSpec = {
    name: 'ProducerPanel',
    // 480 so the longest milestone line ("Next milestone Lv 100: ×5 production (50 to go)") fits at 20.
    width: 480,
    padding: 10,
    corner: 'bottom-right',
    rows: [
        { key: 'ProducerName', height: 36, fontSize: 26 },
        { key: 'ProducerLevel', height: 28, fontSize: 20 },
        { key: 'ProducerProduction', height: 28, fontSize: 20 },
        { key: 'ProducerMilestone', height: 28, fontSize: 20 },
        { key: 'Action_x1', height: 44, fontSize: 22 },
        { key: 'Action_x10', height: 44, fontSize: 22 },
        { key: 'Action_xMax', height: 44, fontSize: 22 },
    ],
};

export const PANEL_ACTION_KEYS = ['Action_x1', 'Action_x10', 'Action_xMax'] as const;
export type PanelActionKey = typeof PANEL_ACTION_KEYS[number];

export function cardHeight(card: UiCardSpec): number {
    return card.padding * 2 + card.rows.reduce((sum, row) => sum + row.height, 0) + (card.actionRow?.height ?? 0);
}

/**
 * AUT-UI-001: local centre and size of action `key` (relative to the card centre). The action row sits
 * directly below the last label row.
 */
export function cardActionRect(card: UiCardSpec, key: string): { x: number; y: number; w: number; h: number } {
    const row = card.actionRow;
    const index = row ? row.actions.findIndex((action) => action.key === key) : -1;
    if (!row || index < 0) throw new RangeError(`${card.name} has no action ${key}`);
    let left = -card.width / 2 + card.padding;
    for (let i = 0; i < index; i += 1) left += row.actions[i].width + row.gap;
    const width = row.actions[index].width;
    return { x: left + width / 2, y: -cardHeight(card) / 2 + card.padding + row.height / 2, w: width, h: row.height };
}

/** Row width inside the card's horizontal padding. */
export function cardRowWidth(card: UiCardSpec): number {
    return card.width - card.padding * 2;
}

/** Local y of row `index` relative to the card centre (rows stack top-down, centre anchor). */
export function cardRowCenterY(card: UiCardSpec, index: number): number {
    if (index < 0 || index >= card.rows.length) throw new RangeError(`${card.name} has no row ${index}`);
    let top = cardHeight(card) / 2 - card.padding;
    for (let i = 0; i < index; i += 1) top -= card.rows[i].height;
    return top - card.rows[index].height / 2;
}

/** Widget alignment for a corner: which edges are aligned, all with the same margin. */
export function widgetAlignment(corner: UiCorner): { top: boolean; bottom: boolean; left: boolean; right: boolean } {
    return {
        top: corner === 'top-left' || corner === 'top-right',
        bottom: corner === 'bottom-left' || corner === 'bottom-right',
        left: corner === 'top-left' || corner === 'bottom-left',
        right: corner === 'top-right' || corner === 'bottom-right',
    };
}

export interface UiLayoutResult {
    /** Pixels per design unit (fit height). */
    scale: number;
    screen: UiRect;
    safeArea: UiRect;
    hud: UiRect;
    panel: UiRect;
    buttons: Record<PanelActionKey, UiRect>;
    /** AUT-UI-001 HUD action Buttons (Manual Produce, Next Goal unlock). */
    hudButtons: Record<HudActionKey, UiRect>;
    /** Every row rect (label node at its layout size; labels shrink rather than resize the node). */
    rows: { hud: Record<string, UiRect>; panel: Record<string, UiRect> };
}

function anchoredRect(card: UiCardSpec, safeArea: UiRect, scale: number): UiRect {
    const w = card.width * scale;
    const h = cardHeight(card) * scale;
    const margin = UI_EDGE_MARGIN * scale;
    const align = widgetAlignment(card.corner);
    const x = align.left ? safeArea.x + margin : safeArea.x + safeArea.w - margin - w;
    const y = align.bottom ? safeArea.y + margin : safeArea.y + safeArea.h - margin - h;
    return { x, y, w, h };
}

function rowRect(card: UiCardSpec, cardRect: UiRect, index: number, scale: number): UiRect {
    const centreY = cardRect.y + cardRect.h / 2 + cardRowCenterY(card, index) * scale;
    const h = card.rows[index].height * scale;
    const w = cardRowWidth(card) * scale;
    return { x: cardRect.x + card.padding * scale, y: centreY - h / 2, w, h };
}

/**
 * Predicted screen rectangles (pixels, bottom-left origin) for a screen and its safe area, as the
 * fit-height Canvas + SafeArea + Widgets place them at runtime.
 */
export function computeUiLayout(
    screenPx: { w: number; h: number },
    safeAreaPx: UiRect = { x: 0, y: 0, w: screenPx.w, h: screenPx.h },
    hudCard: UiCardSpec = CORE_HUD_LAYOUT,
    panelCard: UiCardSpec = PRODUCER_PANEL_LAYOUT,
): UiLayoutResult {
    if (!(screenPx.w > 0 && screenPx.h > 0)) throw new RangeError('screen size must be positive');
    const scale = screenPx.h / UI_DESIGN_RESOLUTION.height;
    const hud = anchoredRect(hudCard, safeAreaPx, scale);
    const panel = anchoredRect(panelCard, safeAreaPx, scale);
    const rowsOf = (card: UiCardSpec, cardRect: UiRect): Record<string, UiRect> =>
        Object.fromEntries(card.rows.map((row, index) => [row.key, rowRect(card, cardRect, index, scale)]));
    const rows = { hud: rowsOf(hudCard, hud), panel: rowsOf(panelCard, panel) };
    const buttons = {} as Record<PanelActionKey, UiRect>;
    for (const key of PANEL_ACTION_KEYS) {
        if (!rows.panel[key]) throw new Error(`${panelCard.name} has no ${key} row`);
        buttons[key] = rows.panel[key];
    }
    const hudButtons = {} as Record<HudActionKey, UiRect>;
    for (const key of HUD_ACTION_KEYS) {
        const local = cardActionRect(hudCard, key);
        hudButtons[key] = {
            x: hud.x + hud.w / 2 + (local.x - local.w / 2) * scale,
            y: hud.y + hud.h / 2 + (local.y - local.h / 2) * scale,
            w: local.w * scale,
            h: local.h * scale,
        };
    }
    return { scale, screen: { x: 0, y: 0, w: screenPx.w, h: screenPx.h }, safeArea: { ...safeAreaPx }, hud, panel, buttons, hudButtons, rows };
}

export function rectArea(rect: UiRect): number {
    return Math.max(0, rect.w) * Math.max(0, rect.h);
}

export function rectContains(outer: UiRect, inner: UiRect, tolerance = 0): boolean {
    return inner.x >= outer.x - tolerance
        && inner.y >= outer.y - tolerance
        && inner.x + inner.w <= outer.x + outer.w + tolerance
        && inner.y + inner.h <= outer.y + outer.h + tolerance;
}

export function rectsOverlap(a: UiRect, b: UiRect): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function rectContainsPoint(rect: UiRect, x: number, y: number): boolean {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}
