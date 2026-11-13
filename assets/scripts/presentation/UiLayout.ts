/**
 * AUT-R-036 / AUT-R-036-02 portrait layout of the Core HUD and the Producer Panel (engine-free).
 *
 * One source for the card sizes, row heights, font sizes, edge margin and anchor edges. The
 * controllers read the card specs to build their rows; FactoryWorldBootstrap reads the anchor edges
 * and the margin for the cards' Widgets. `computeUiLayout` predicts the on-screen rectangles for a
 * screen size and safe area so the layout budget (inside the safe area, no overlap, coverage) is
 * unit-tested without `cc`. Units are design units of the 720×1280 fixed-width design resolution
 * unless a name says pixels. No styling lives here.
 *
 * AUT-R-036-02 (portrait, owner 2026-11-10): the HUD is a full-width band at the top of the safe area
 * and the panel a full-width band at the bottom, with ×1/×10/×MAX side by side in one row.
 */

export const UI_DESIGN_RESOLUTION = { width: 720, height: 1280 } as const;
/** Gap between a card and the safe-area edges around it. */
export const UI_EDGE_MARGIN = 16;
/** Smallest font size allowed for body text (design units). */
export const UI_MIN_BODY_FONT_SIZE = 20;
/** Coverage budget for HUD + panel together (ART_DIRECTION §19.2: the factory keeps 65% or more). */
export const UI_MAX_COVERAGE = 0.35;
/** Full-width band: the fixed design width minus the edge margin on both sides. */
export const UI_BAND_WIDTH = UI_DESIGN_RESOLUTION.width - UI_EDGE_MARGIN * 2;

/** The safe-area edge a full-width band is anchored to (the band is centred horizontally). */
export type UiCorner = 'top' | 'bottom';

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
    /**
     * AUT-R-036-02: captions may wrap onto this many lines (default 1: no wrap, line height = row height).
     * With more than one line the label uses `lineHeight`, and each line fits the Button at nominal size.
     */
    readonly captionLines?: number;
    readonly lineHeight?: number;
}

/**
 * AUT-R-036-02: one full-row-width primary Button at the very bottom of a card (below the action row,
 * `gap` above it), in the bottom thumb zone (GAME_DESIGN §20).
 */
export interface UiPrimaryActionSpec {
    readonly key: string;
    readonly height: number;
    readonly fontSize: number;
    readonly gap: number;
}

/**
 * AUT-UI-003: a Button laid over existing label rows (no row of its own): it spans `firstRow`..`lastRow`
 * at the full row width, so the label rows themselves become the control.
 */
export interface UiRowActionSpec {
    readonly key: string;
    readonly firstRow: number;
    readonly lastRow: number;
}

export interface UiCardSpec {
    readonly name: string;
    readonly width: number;
    readonly padding: number;
    readonly corner: UiCorner;
    readonly rows: readonly UiRowSpec[];
    readonly rowActions?: readonly UiRowActionSpec[];
    readonly actionRow?: UiActionRowSpec;
    readonly primaryAction?: UiPrimaryActionSpec;
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
    width: UI_BAND_WIDTH,
    padding: 10,
    corner: 'top',
    // AUT-R-036-02: 24-unit body rows (at least the font size) keep HUD + panel within 35% at 16:9 with
    // Manual Produce in the bottom band.
    rows: [
        { key: 'IndustrialOutputValue', height: 32, fontSize: 32 },
        { key: 'ProductionPerSecondValue', height: 24, fontSize: 20 },
        { key: 'NextGoalValue', height: 24, fontSize: 22 },
        { key: 'NextGoalContext', height: 24, fontSize: 20 },
        // AUT-UI-003: the two Overclock rows are the Free Overclock Button (OverclockAction below): 2 x 30 = 60 units,
        // 90 px at 1080 px wide (the pill is inset 3 units inside it). The Industrial Output row went 40 -> 32 (its font
        // size) to pay for it inside the 35% coverage budget.
        { key: 'FreeOverclockValue', height: 30, fontSize: 20 },
        { key: 'FreeOverclockTimer', height: 30, fontSize: 20 },
    ],
    rowActions: [{ key: 'OverclockAction', firstRow: 4, lastRow: 5 }],
    // AUT-UI-001: the Next Goal unlock, 52 units (78 px at 1080 px wide) for touch comfort. Font 21:
    // Android floors label pixels, so 21 renders as 20.67 design units at 1080 px.
    // AUT-R-036-02: Manual Produce moved to the bottom band (PRODUCER_PANEL_LAYOUT.primaryAction); the
    // Next Goal unlock keeps the full 668-unit row.
    actionRow: {
        height: 52,
        fontSize: 21,
        gap: 8,
        actions: [
            { key: 'NextGoalAction', width: 668 },
        ],
    },
};

/** AUT-UI-001 actions owned by CoreHudController (since AUT-R-036-02 Manual Produce is laid out in the panel band). */
export const HUD_ACTION_KEYS = ['ManualProduceAction', 'NextGoalAction', 'OverclockAction'] as const;
export type HudActionKey = typeof HUD_ACTION_KEYS[number];

export const PRODUCER_PANEL_LAYOUT: UiCardSpec = {
    name: 'ProducerPanel',
    width: UI_BAND_WIDTH,
    padding: 10,
    corner: 'bottom',
    rows: [
        { key: 'ProducerName', height: 32, fontSize: 26 },
        { key: 'ProducerLevel', height: 24, fontSize: 20 },
        { key: 'ProducerProduction', height: 24, fontSize: 20 },
        { key: 'ProducerMilestone', height: 24, fontSize: 20 },
    ],
    // AUT-R-036-02: ×1/×10/×MAX side by side in one row (216 + 10 + 216 + 10 + 216 = 668). The longest
    // caption ("Buy ×MAX 99.9T • Unavailable") cannot fit 216 units on one line at font 20 or more, so
    // the captions wrap onto at most two lines (2 × 24 inside 52) rather than shrink below the minimum.
    actionRow: {
        height: 52,
        fontSize: 20,
        gap: 10,
        captionLines: 2,
        lineHeight: 24,
        actions: [
            { key: 'Action_x1', width: 216 },
            { key: 'Action_x10', width: 216 },
            { key: 'Action_xMax', width: 216 },
        ],
    },
    // AUT-R-036-02 (GAME_DESIGN §20 thumb zone): Manual Produce, owned and wired by CoreHudController, is a
    // full-width Button at the bottom of the panel band (the bootstrap parents it under the panel card).
    primaryAction: { key: 'ManualProduceAction', height: 52, fontSize: 24, gap: 4 },
};

/**
 * AUT-GP-001: the Assembly batch Button shares the panel's primary row (bottom thumb zone, GAME_DESIGN §20)
 * with Manual Produce while it is visible: Manual Produce takes the left half, the batch the right half,
 * `PANEL_PRIMARY_SPLIT_GAP` apart. Hidden, Manual Produce keeps the full row. The card height (and so the
 * coverage budget) is unchanged.
 */
export const ASSEMBLY_BATCH_ACTION_KEY = 'AssemblyBatchAction';
export const PANEL_PRIMARY_SPLIT_GAP = 10;

/** Local rects (relative to the card centre) of the split primary row: `primary` left, `secondary` right. */
export function cardPrimaryActionSplitRects(card: UiCardSpec, gap: number = PANEL_PRIMARY_SPLIT_GAP): { primary: { x: number; y: number; w: number; h: number }; secondary: { x: number; y: number; w: number; h: number } } {
    const primary = card.primaryAction;
    if (!primary) throw new RangeError(`${card.name} has no primary action`);
    const full = cardActionRect(card, primary.key);
    const w = (full.w - gap) / 2;
    return {
        primary: { x: full.x - full.w / 2 + w / 2, y: full.y, w, h: full.h },
        secondary: { x: full.x + full.w / 2 - w / 2, y: full.y, w, h: full.h },
    };
}

/** Screen rects (pixels, bottom-left origin) of the split primary row for a screen and safe area. */
export function computePanelPrimarySplitRects(
    screenPx: { w: number; h: number },
    safeAreaPx: UiRect = { x: 0, y: 0, w: screenPx.w, h: screenPx.h },
    panelCard: UiCardSpec = PRODUCER_PANEL_LAYOUT,
): { primary: UiRect; secondary: UiRect } {
    if (!(screenPx.w > 0 && screenPx.h > 0)) throw new RangeError('screen size must be positive');
    const scale = screenPx.w / UI_DESIGN_RESOLUTION.width;
    const panel = anchoredRect(panelCard, safeAreaPx, scale);
    const split = cardPrimaryActionSplitRects(panelCard);
    const toScreen = (local: { x: number; y: number; w: number; h: number }): UiRect => ({
        x: panel.x + panel.w / 2 + (local.x - local.w / 2) * scale,
        y: panel.y + panel.h / 2 + (local.y - local.h / 2) * scale,
        w: local.w * scale,
        h: local.h * scale,
    });
    return { primary: toScreen(split.primary), secondary: toScreen(split.secondary) };
}

/** The card whose layout places HUD action `key` (Manual Produce: the panel band; Next Goal: the HUD). */
export function hudActionCard(key: HudActionKey): UiCardSpec {
    return PRODUCER_PANEL_LAYOUT.primaryAction?.key === key ? PRODUCER_PANEL_LAYOUT : CORE_HUD_LAYOUT;
}

/** Font size of action `key` in `card` (action row or primary action). */
export function cardActionFontSize(card: UiCardSpec, key: string): number {
    if (card.primaryAction?.key === key) return card.primaryAction.fontSize;
    const rowAction = card.rowActions?.find((action) => action.key === key);
    if (rowAction) return card.rows[rowAction.firstRow].fontSize;
    if (card.actionRow?.actions.some((action) => action.key === key)) return card.actionRow.fontSize;
    throw new RangeError(`${card.name} has no action ${key}`);
}

export const PANEL_ACTION_KEYS = ['Action_x1', 'Action_x10', 'Action_xMax'] as const;
export type PanelActionKey = typeof PANEL_ACTION_KEYS[number];

function primaryActionSpan(card: UiCardSpec): number {
    return card.primaryAction ? card.primaryAction.height + card.primaryAction.gap : 0;
}

export function cardHeight(card: UiCardSpec): number {
    return card.padding * 2 + card.rows.reduce((sum, row) => sum + row.height, 0) + (card.actionRow?.height ?? 0) + primaryActionSpan(card);
}

/**
 * AUT-UI-001: local centre and size of action `key` (relative to the card centre). The action row sits
 * directly below the last label row; AUT-R-036-02: a primary action spans the row width at the bottom.
 */
export function cardActionRect(card: UiCardSpec, key: string): { x: number; y: number; w: number; h: number } {
    const rowAction = card.rowActions?.find((action) => action.key === key);
    if (rowAction) {
        const top = cardRowCenterY(card, rowAction.firstRow) + card.rows[rowAction.firstRow].height / 2;
        const low = cardRowCenterY(card, rowAction.lastRow) - card.rows[rowAction.lastRow].height / 2;
        return { x: 0, y: (top + low) / 2, w: cardRowWidth(card), h: top - low };
    }
    const bottom = -cardHeight(card) / 2 + card.padding;
    const primary = card.primaryAction;
    if (primary?.key === key) return { x: 0, y: bottom + primary.height / 2, w: cardRowWidth(card), h: primary.height };
    const row = card.actionRow;
    const index = row ? row.actions.findIndex((action) => action.key === key) : -1;
    if (!row || index < 0) throw new RangeError(`${card.name} has no action ${key}`);
    let left = -card.width / 2 + card.padding;
    for (let i = 0; i < index; i += 1) left += row.actions[i].width + row.gap;
    const width = row.actions[index].width;
    return { x: left + width / 2, y: bottom + primaryActionSpan(card) + row.height / 2, w: width, h: row.height };
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

/**
 * Widget alignment for a band: one vertical edge (with the margin) plus the horizontal centre of the
 * safe area. Left/right are never aligned, so the card keeps its UiLayout width.
 */
export function widgetAlignment(corner: UiCorner): { top: boolean; bottom: boolean; left: boolean; right: boolean; horizontalCenter: boolean } {
    return { top: corner === 'top', bottom: corner === 'bottom', left: false, right: false, horizontalCenter: true };
}

export interface UiLayoutResult {
    /** Pixels per design unit (fixed width). */
    scale: number;
    screen: UiRect;
    safeArea: UiRect;
    hud: UiRect;
    panel: UiRect;
    /** AUT-R-036-02: the full-width screen band between the panel top and the HUD bottom (the factory view). */
    factoryBand: UiRect;
    buttons: Record<PanelActionKey, UiRect>;
    /** AUT-UI-001 HUD action Buttons (Manual Produce, Next Goal unlock; AUT-UI-003 Free Overclock). */
    hudButtons: Record<HudActionKey, UiRect>;
    /** Every row rect (label node at its layout size; labels shrink rather than resize the node). */
    rows: { hud: Record<string, UiRect>; panel: Record<string, UiRect> };
}

function anchoredRect(card: UiCardSpec, safeArea: UiRect, scale: number): UiRect {
    const w = card.width * scale;
    const h = cardHeight(card) * scale;
    const margin = UI_EDGE_MARGIN * scale;
    const align = widgetAlignment(card.corner);
    const x = safeArea.x + (safeArea.w - w) / 2;
    const y = align.bottom ? safeArea.y + margin : safeArea.y + safeArea.h - margin - h;
    return { x, y, w, h };
}

function actionRects(card: UiCardSpec, cardRect: UiRect, keys: readonly string[], scale: number): Record<string, UiRect> {
    const out: Record<string, UiRect> = {};
    for (const key of keys) {
        const local = cardActionRect(card, key);
        out[key] = {
            x: cardRect.x + cardRect.w / 2 + (local.x - local.w / 2) * scale,
            y: cardRect.y + cardRect.h / 2 + (local.y - local.h / 2) * scale,
            w: local.w * scale,
            h: local.h * scale,
        };
    }
    return out;
}

function rowRect(card: UiCardSpec, cardRect: UiRect, index: number, scale: number): UiRect {
    const centreY = cardRect.y + cardRect.h / 2 + cardRowCenterY(card, index) * scale;
    const h = card.rows[index].height * scale;
    const w = cardRowWidth(card) * scale;
    return { x: cardRect.x + card.padding * scale, y: centreY - h / 2, w, h };
}

/**
 * Predicted screen rectangles (pixels, bottom-left origin) for a screen and its safe area, as the
 * fixed-width Canvas + SafeArea + Widgets place them at runtime.
 */
export function computeUiLayout(
    screenPx: { w: number; h: number },
    safeAreaPx: UiRect = { x: 0, y: 0, w: screenPx.w, h: screenPx.h },
    hudCard: UiCardSpec = CORE_HUD_LAYOUT,
    panelCard: UiCardSpec = PRODUCER_PANEL_LAYOUT,
): UiLayoutResult {
    if (!(screenPx.w > 0 && screenPx.h > 0)) throw new RangeError('screen size must be positive');
    const scale = screenPx.w / UI_DESIGN_RESOLUTION.width;
    const hud = anchoredRect(hudCard, safeAreaPx, scale);
    const panel = anchoredRect(panelCard, safeAreaPx, scale);
    const rowsOf = (card: UiCardSpec, cardRect: UiRect): Record<string, UiRect> =>
        Object.fromEntries(card.rows.map((row, index) => [row.key, rowRect(card, cardRect, index, scale)]));
    const rows = { hud: rowsOf(hudCard, hud), panel: rowsOf(panelCard, panel) };
    const buttons = actionRects(panelCard, panel, PANEL_ACTION_KEYS, scale) as Record<PanelActionKey, UiRect>;
    const hudButtons = {} as Record<HudActionKey, UiRect>;
    for (const key of HUD_ACTION_KEYS) {
        const inPanel = panelCard.primaryAction?.key === key || (panelCard.actionRow?.actions.some((a) => a.key === key) ?? false) || (panelCard.rowActions?.some((a) => a.key === key) ?? false);
        Object.assign(hudButtons, inPanel ? actionRects(panelCard, panel, [key], scale) : actionRects(hudCard, hud, [key], scale));
    }
    const bandBottom = panel.y + panel.h;
    const factoryBand = { x: 0, y: bandBottom, w: screenPx.w, h: Math.max(0, hud.y - bandBottom) };
    return { scale, screen: { x: 0, y: 0, w: screenPx.w, h: screenPx.h }, safeArea: { ...safeAreaPx }, hud, panel, factoryBand, buttons, hudButtons, rows };
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
