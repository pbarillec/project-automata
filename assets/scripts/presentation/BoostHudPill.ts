import type { FreeOverclockViewState } from './HudViewModel.ts';

/**
 * AUT-047 HUD pill look for the existing FreeOverclockValue / FreeOverclockTimer rows. Pure mapping from the HUD view state to a style;
 * the texts stay the AUT-LOC-001 `hud.free_overclock.*` strings (active "Free Overclock: x2" + "<seconds>s", suspended "Paused" with the
 * frozen seconds). Active = amber fill with dark text; suspended = amber outline, dimmed; locked / ready / cooldown = no pill (existing HUD).
 */
export interface BoostHudRgba { readonly r: number; readonly g: number; readonly b: number; readonly a: number }

export interface BoostHudPillStyle {
    readonly visible: boolean;
    readonly fill: BoostHudRgba | null;
    readonly outline: BoostHudRgba | null;
    /** Text colour of both overclock rows. */
    readonly text: BoostHudRgba;
    /** Cache key: the style only needs a redraw when it changes. */
    readonly key: 'none' | 'active' | 'suspended';
}

export const BOOST_HUD_AMBER: BoostHudRgba = Object.freeze({ r: 224, g: 168, b: 72, a: 255 });
export const BOOST_HUD_DEFAULT_TEXT: BoostHudRgba = Object.freeze({ r: 238, g: 241, b: 233, a: 255 });
export const BOOST_HUD_ACTIVE_TEXT: BoostHudRgba = Object.freeze({ r: 24, g: 29, b: 32, a: 255 });
export const BOOST_HUD_SUSPENDED_TEXT: BoostHudRgba = Object.freeze({ r: 196, g: 156, b: 84, a: 255 });
export const BOOST_HUD_OUTLINE_THICKNESS = 3;

const NONE: BoostHudPillStyle = Object.freeze({ visible: false, fill: null, outline: null, text: BOOST_HUD_DEFAULT_TEXT, key: 'none' });
const ACTIVE: BoostHudPillStyle = Object.freeze({ visible: true, fill: BOOST_HUD_AMBER, outline: null, text: BOOST_HUD_ACTIVE_TEXT, key: 'active' });
const SUSPENDED: BoostHudPillStyle = Object.freeze({ visible: true, fill: null, outline: Object.freeze({ ...BOOST_HUD_AMBER, a: 150 }), text: BOOST_HUD_SUSPENDED_TEXT, key: 'suspended' });

/** AUT-UI-003: dimmed text of a disabled, inactive Overclock row (locked / cooldown). */
export const BOOST_HUD_DISABLED_TEXT: BoostHudRgba = Object.freeze({ r: 140, g: 148, b: 146, a: 255 });

/**
 * AUT-UI-003: text colour of the two Overclock rows while they are the activation Button and no pill is drawn:
 * ready = amber (tappable), locked / cooldown = dimmed (disabled). Active / suspended keep the AUT-047 pill text (null).
 */
export function resolveOverclockRowText(state: FreeOverclockViewState): BoostHudRgba | null {
    if (state === 'ready') return BOOST_HUD_AMBER;
    if (state === 'locked' || state === 'cooldown') return BOOST_HUD_DISABLED_TEXT;
    return null;
}

export function resolveBoostHudPill(state: FreeOverclockViewState): BoostHudPillStyle {
    if (state === 'active') return ACTIVE;
    if (state === 'suspended') return SUSPENDED;
    return NONE;
}
