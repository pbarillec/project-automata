import type { DomainEvent } from '../domain/Events.ts';
import type { AudioCue } from '../services/AudioService.ts';

/**
 * AUT-052 pure mapping from a domain event to an audio cue (no `cc`, no state). Presentation observes events and asks the
 * `AudioService` to play the cue; the runtime and gameplay modules never import audio. `ui_tap` is not event-driven (UI taps only).
 */
export const AUDIO_CUE_BY_EVENT_TYPE: Readonly<Partial<Record<DomainEvent['type'], AudioCue>>> = Object.freeze({
    producerLevelsPurchased: 'purchase',
    breakthroughPurchased: 'purchase',
    permanentUpgradePurchased: 'purchase',
    producerMilestoneReached: 'milestone',
    producerConstructed: 'milestone',
    firstRobotProduced: 'robot_built',
    robotsBuiltThresholdReached: 'robot_built',
    eraChanged: 'era_transition',
    temporaryBoostActivated: 'overclock',
    rebootCompleted: 'reboot',
});

export function mapEventToCue(event: DomainEvent): AudioCue | null {
    const type = event?.type;
    if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(AUDIO_CUE_BY_EVENT_TYPE, type)) return null;
    return AUDIO_CUE_BY_EVENT_TYPE[type] ?? null;
}

/** Cues for a batch of events in order, collapsing consecutive duplicates (one tick can emit several events of a kind). */
export function mapEventsToCues(events: readonly DomainEvent[]): AudioCue[] {
    const cues: AudioCue[] = [];
    for (const event of events) {
        const cue = mapEventToCue(event);
        if (cue !== null && cues[cues.length - 1] !== cue) cues.push(cue);
    }
    return cues;
}
