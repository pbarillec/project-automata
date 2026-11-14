import type { HapticStrength, HapticsService } from '../../services/HapticsService';

/** AUT-052 default haptics: does nothing (the Android bridge is a later task). */
export class NoOpHapticsService implements HapticsService {
    private enabled = true;

    public vibrate(_strength: HapticStrength): void {
        // Intentionally a no-op.
    }

    public setEnabled(enabled: boolean): void {
        this.enabled = enabled === true;
    }

    public isEnabled(): boolean {
        return this.enabled;
    }
}
