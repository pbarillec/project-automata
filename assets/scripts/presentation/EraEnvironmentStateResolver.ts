import type { GameState } from '../state/GameState.ts';
import {
    ERA_ENV_ERA_IDS,
    ERA_ENV_FADE_CAP_SECONDS,
    ERA_ENV_FADE_SECONDS,
    ERA_ENV_GROUP_IDS,
    ERA_ENV_GROUP_VISIBILITY,
    ERA_ENV_PALETTES,
    ERA_ENV_RISE_SECONDS,
    TEASER_SEAM_PULSE_MIN,
    TEASER_SEAM_PULSE_SECONDS,
    type EraEnvironmentEraId,
    type EraEnvironmentGroupId,
    type EraEnvironmentPalette,
    type Rgb,
} from './EraEnvironmentLayout.ts';

/**
 * AUT-045 state -> era environment resolver (pure, deterministic, engine-free, read-only). The environment is keyed ONLY on
 * `state.run.currentEraId` (Era II is entered by building the Robot Line, Era III by the Advanced Robotics breakthrough;
 * a Reboot builds a fresh run whose era is `manual_workshop`). An unknown or null era falls back to the Manual Workshop.
 */
export interface EraEnvironmentDescriptor {
    readonly eraId: EraEnvironmentEraId;
    /** 0 manual_workshop, 1 automated_factory, 2 robotics_complex. */
    readonly order: number;
    readonly palette: EraEnvironmentPalette;
    readonly hallVisible: boolean;
    readonly verticalVisible: boolean;
    readonly teaserVisible: boolean;
}

/** What is on screen at one instant: the palette plus how far each group has risen (0 hidden .. 1 fully risen). */
export interface EraEnvironmentFrame {
    readonly palette: EraEnvironmentPalette;
    readonly rise: Readonly<Record<EraEnvironmentGroupId, number>>;
}

export function normaliseEraId(eraId: string | null | undefined): EraEnvironmentEraId {
    return (ERA_ENV_ERA_IDS as readonly string[]).includes(eraId ?? '') ? eraId as EraEnvironmentEraId : 'manual_workshop';
}

export function resolveEraEnvironmentForEra(eraId: string | null | undefined): EraEnvironmentDescriptor {
    const id = normaliseEraId(eraId);
    const visibility = ERA_ENV_GROUP_VISIBILITY[id];
    return {
        eraId: id,
        order: ERA_ENV_ERA_IDS.indexOf(id),
        palette: ERA_ENV_PALETTES[id],
        hallVisible: visibility.hall,
        verticalVisible: visibility.vertical,
        teaserVisible: visibility.teaser,
    };
}

export function resolveEraEnvironment(state: GameState): EraEnvironmentDescriptor {
    return resolveEraEnvironmentForEra(state.run.currentEraId);
}

export function descriptorGroupVisible(descriptor: EraEnvironmentDescriptor, group: EraEnvironmentGroupId): boolean {
    return group === 'hall' ? descriptor.hallVisible : group === 'vertical' ? descriptor.verticalVisible : descriptor.teaserVisible;
}

/** The settled frame of a descriptor (snap: no animation). */
export function frameOfDescriptor(descriptor: EraEnvironmentDescriptor): EraEnvironmentFrame {
    return {
        palette: descriptor.palette,
        rise: { hall: descriptor.hallVisible ? 1 : 0, vertical: descriptor.verticalVisible ? 1 : 0, teaser: descriptor.teaserVisible ? 1 : 0 },
    };
}

const clamp01 = (value: number): number => (value <= 0 ? 0 : value >= 1 ? 1 : value);
const smooth = (value: number): number => { const t = clamp01(value); return t * t * (3 - (2 * t)); };
const lerp = (a: number, b: number, t: number): number => a + ((b - a) * t);

export function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
    return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) };
}

/** The palette halfway between two palettes (`t` 0..1): every colour, the key light colour and its illuminance. */
export function lerpPalette(a: EraEnvironmentPalette, b: EraEnvironmentPalette, t: number): EraEnvironmentPalette {
    return {
        siteBoundary: lerpRgb(a.siteBoundary, b.siteBoundary, t),
        mainLogisticsSpine: lerpRgb(a.mainLogisticsSpine, b.mainLogisticsSpine, t),
        futureAccessBarrier: lerpRgb(a.futureAccessBarrier, b.futureAccessBarrier, t),
        clear: lerpRgb(a.clear, b.clear, t),
        keyLightColor: lerpRgb(a.keyLightColor, b.keyLightColor, t),
        keyLightIlluminance: lerp(a.keyLightIlluminance, b.keyLightIlluminance, t),
        hallFloor: lerpRgb(a.hallFloor, b.hallFloor, t),
        hallWall: lerpRgb(a.hallWall, b.hallWall, t),
        hallCap: lerpRgb(a.hallCap, b.hallCap, t),
        hallLightBar: lerpRgb(a.hallLightBar, b.hallLightBar, t),
        hallRoute: lerpRgb(a.hallRoute, b.hallRoute, t),
    };
}

/** Seconds the palette cross-fade takes (never longer than the 1.5 s cap). */
export const ERA_ENV_FADE_DURATION = Math.min(ERA_ENV_FADE_SECONDS, ERA_ENV_FADE_CAP_SECONDS);
/** Seconds until a live era change has fully settled. */
export const ERA_ENV_TRANSITION_DURATION = Math.max(ERA_ENV_FADE_DURATION, ERA_ENV_RISE_SECONDS);

/**
 * The frame `elapsed` seconds after a live change from `from` towards `target`: the palette / light / clear colour ease over
 * `ERA_ENV_FADE_DURATION`, a group that has to appear rises (scale-Y) linearly over `ERA_ENV_RISE_SECONDS`. At or after
 * `ERA_ENV_TRANSITION_DURATION` the frame is exactly the target's settled frame.
 */
export function blendEraEnvironmentFrame(from: EraEnvironmentFrame, target: EraEnvironmentDescriptor, elapsed: number): EraEnvironmentFrame {
    const settled = frameOfDescriptor(target);
    if (elapsed >= ERA_ENV_TRANSITION_DURATION) return settled;
    const fade = smooth(elapsed / ERA_ENV_FADE_DURATION);
    const rise = clamp01(elapsed / ERA_ENV_RISE_SECONDS);
    const risen = {} as Record<EraEnvironmentGroupId, number>;
    for (const group of ERA_ENV_GROUP_IDS) risen[group] = lerp(from.rise[group], settled.rise[group], rise);
    return { palette: lerpPalette(from.palette, target.palette, fade), rise: risen };
}

export function framesEqual(a: EraEnvironmentFrame, b: EraEnvironmentFrame): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/** Teaser door seam pulse: 60..100% brightness, one slow 3 s period. */
export function sampleTeaserSeamPulse(seconds: number): number {
    const phase = (seconds % TEASER_SEAM_PULSE_SECONDS) / TEASER_SEAM_PULSE_SECONDS;
    const wave = 0.5 + (0.5 * Math.cos(phase * 2 * Math.PI));
    return TEASER_SEAM_PULSE_MIN + ((1 - TEASER_SEAM_PULSE_MIN) * wave);
}

/** Teaser core spin (degrees, wraps at 360). */
export function sampleTeaserCoreYaw(seconds: number, degreesPerSecond: number): number {
    return (seconds * degreesPerSecond) % 360;
}
