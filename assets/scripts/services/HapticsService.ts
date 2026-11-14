/**
 * AUT-052 haptics boundary (interface only; the Android bridge is a later task). `NoOpHapticsService` (platform/noop) is the default;
 * `MockHapticsService` (platform/mock) records calls and honours the enabled flag.
 */
export type HapticStrength = 'light' | 'medium' | 'heavy';

export const HAPTIC_STRENGTHS: readonly HapticStrength[] = Object.freeze(['light', 'medium', 'heavy']);

export interface HapticsService {
    /** Triggers a vibration; ignored while disabled. Never throws. */
    vibrate(strength: HapticStrength): void;
    setEnabled(enabled: boolean): void;
}
