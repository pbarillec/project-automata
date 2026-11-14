import type { AudioCue, AudioService, AudioSettingsFlags } from '../../services/AudioService';

/**
 * AUT-052 production default until audio assets exist: accepts every call and does nothing (never throws). It still remembers the
 * flags so a later real service can be swapped in without changing callers.
 */
export class SilentAudioService implements AudioService {
    private musicEnabled = true;
    private sfxEnabled = true;

    public playSfx(_cue: AudioCue): void {
        // Intentionally silent: no audio asset ships with AUT-052.
    }

    public setMusicEnabled(enabled: boolean): void {
        this.musicEnabled = enabled === true;
    }

    public setSfxEnabled(enabled: boolean): void {
        this.sfxEnabled = enabled === true;
    }

    public applySettings(settings: AudioSettingsFlags): void {
        this.setMusicEnabled(settings.musicEnabled);
        this.setSfxEnabled(settings.sfxEnabled);
    }

    public startMusic(): void {
        // Intentionally silent.
    }

    public stopMusic(): void {
        // Intentionally silent.
    }

    public isMusicEnabled(): boolean {
        return this.musicEnabled;
    }

    public isSfxEnabled(): boolean {
        return this.sfxEnabled;
    }
}
