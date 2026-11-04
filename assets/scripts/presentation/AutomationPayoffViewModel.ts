import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import { resolveFabricatorVisualState } from './VisualStateResolver.ts';
import type { VisualStateDescriptor } from './VisualStateResolver.ts';

export interface AutomationPayoffSnapshot {
    readonly fabricator: VisualStateDescriptor;
    readonly automationActive: boolean;
    readonly activityIndicatorVisible: boolean;
    readonly machineActivity: 'manual' | 'autonomous';
    readonly focusBeatRequested: boolean;
    readonly focusBeatId: number | null;
}

function eventKey(event: DomainEvent): string { return JSON.stringify(event); }

function isFirstAutomationEvidence(event: DomainEvent): boolean {
    if (event.type === 'automationStateChanged') {
        return event.producerId === 'fabricator' && event.isAutomated
            && (event.unlockedByBreakthroughId === 'auto_feeder' || event.unlockedByBreakthroughId === null);
    }
    return event.type === 'breakthroughPurchased' && event.breakthroughId === 'auto_feeder';
}

/** Pure presentation projection for the first Auto Feeder payoff. */
export class AutomationPayoffViewModel {
    private readonly handledEvents = new Set<string>();
    private focusBeatIdValue: number | null = null;
    private focusBeatRequestedValue = false;

    public syncFromState(state: GameState): AutomationPayoffSnapshot {
        return this.snapshot(resolveFabricatorVisualState(state));
    }

    public consumeEvents(state: GameState, events: readonly DomainEvent[]): AutomationPayoffSnapshot {
        const descriptor = resolveFabricatorVisualState(state);
        for (const event of events) {
            const key = eventKey(event);
            if (!this.handledEvents.has(key) && isFirstAutomationEvidence(event) && descriptor.automationActive) {
                this.handledEvents.add(key);
                if (!this.focusBeatRequestedValue && this.focusBeatIdValue === null) {
                    this.focusBeatIdValue = 1;
                    this.focusBeatRequestedValue = true;
                }
            }
        }
        return this.snapshot(descriptor);
    }

    public acknowledgeFocusBeat(): void { this.focusBeatRequestedValue = false; }
    public interruptFocusBeat(): void { this.focusBeatRequestedValue = false; }
    public get handledEventCount(): number { return this.handledEvents.size; }

    private snapshot(fabricator: VisualStateDescriptor): AutomationPayoffSnapshot {
        return {
            fabricator,
            automationActive: fabricator.automationActive,
            activityIndicatorVisible: fabricator.automationActive,
            machineActivity: fabricator.automationActive ? 'autonomous' : 'manual',
            focusBeatRequested: this.focusBeatRequestedValue,
            focusBeatId: this.focusBeatIdValue,
        };
    }
}

export function resolveAutomationPayoff(state: GameState): AutomationPayoffSnapshot {
    return new AutomationPayoffViewModel().syncFromState(state);
}
