/**
 * AUT-052 audio boundary (interface only; no audio asset ships yet). Presentation maps domain events to a cue
 * (`presentation/AudioCueMapper.ts`) and asks the service to play it; gameplay / the runtime never know about audio.
 * `SilentAudioService` (platform/noop) is the production default until the audio asset task; `MockAudioService` (platform/mock) records cues.
 */
export type AudioCue =
    | 'purchase'
    | 'milestone'
    | 'robot_built'
    | 'era_transition'
    | 'overclock'
    | 'reboot'
    | 'ui_tap';

export const AUDIO_CUES: readonly AudioCue[] = Object.freeze([
    'purchase',
    'milestone',
    'robot_built',
    'era_transition',
    'overclock',
    'reboot',
    'ui_tap',
]);

export interface AudioSettingsFlags {
    readonly musicEnabled: boolean;
    readonly sfxEnabled: boolean;
}

export interface AudioService {
    /** Plays a one-shot cue; ignored while SFX are disabled. Never throws. */
    playSfx(cue: AudioCue): void;
    setMusicEnabled(enabled: boolean): void;
    setSfxEnabled(enabled: boolean): void;
    /** Applies both flags from the user settings. */
    applySettings(settings: AudioSettingsFlags): void;
    startMusic(): void;
    stopMusic(): void;
}
