import type { AudioCue, AudioService, AudioSettingsFlags } from '../../services/AudioService';

/** AUT-052 test / editor audio: records the cues it would play and honours the music / SFX flags. */
export class MockAudioService implements AudioService {
    public readonly playedCues: AudioCue[] = [];
    public musicEnabled = true;
    public sfxEnabled = true;
    public musicPlaying = false;
    public musicStartCount = 0;

    public playSfx(cue: AudioCue): void {
        if (!this.sfxEnabled) return;
        this.playedCues.push(cue);
    }

    public setMusicEnabled(enabled: boolean): void {
        this.musicEnabled = enabled === true;
        if (!this.musicEnabled) this.musicPlaying = false;
    }

    public setSfxEnabled(enabled: boolean): void {
        this.sfxEnabled = enabled === true;
    }

    public applySettings(settings: AudioSettingsFlags): void {
        this.setMusicEnabled(settings.musicEnabled);
        this.setSfxEnabled(settings.sfxEnabled);
    }

    public startMusic(): void {
        if (!this.musicEnabled) return;
        this.musicPlaying = true;
        this.musicStartCount += 1;
    }

    public stopMusic(): void {
        this.musicPlaying = false;
    }
}
