import type { HapticStrength, HapticsService } from '../../services/HapticsService';

/** AUT-052 test / editor haptics: records vibrations and honours the enabled flag. */
export class MockHapticsService implements HapticsService {
    public readonly vibrations: HapticStrength[] = [];
    public enabled = true;

    public vibrate(strength: HapticStrength): void {
        if (!this.enabled) return;
        this.vibrations.push(strength);
    }

    public setEnabled(enabled: boolean): void {
        this.enabled = enabled === true;
    }
}
