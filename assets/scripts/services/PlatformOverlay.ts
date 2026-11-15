export type PlatformOverlayKind = 'rewarded_ad' | 'purchase_flow' | 'consent_form';

export interface PlatformOverlayEvent {
    phase: 'begin' | 'end';
    kind: PlatformOverlayKind;
    requestId: string;
}

export type PlatformOverlayListener = (event: PlatformOverlayEvent) => void;

export type PlatformBackgroundReason = 'overlay' | 'user_absence';

/**
 * Pure bookkeeping of fullscreen platform overlays (rewarded ad / purchase flow).
 * Providers call begin/end around show/purchase. A consumer (deferred to AUT-057/060)
 * can use classifyBackground() to tell an overlay-induced pause from real user absence.
 */
export class PlatformOverlayTracker {
    private readonly active = new Map<string, PlatformOverlayKind>();
    private readonly listeners = new Set<PlatformOverlayListener>();

    public begin(kind: PlatformOverlayKind, requestId: string): void {
        if (this.active.has(requestId)) {
            return;
        }

        this.active.set(requestId, kind);
        this.emit({ phase: 'begin', kind, requestId });
    }

    public end(requestId: string): void {
        const kind = this.active.get(requestId);
        if (kind === undefined) {
            return;
        }

        this.active.delete(requestId);
        this.emit({ phase: 'end', kind, requestId });
    }

    public isOverlayActive(): boolean {
        return this.active.size > 0;
    }

    public get activeCount(): number {
        return this.active.size;
    }

    public subscribe(listener: PlatformOverlayListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    public classifyBackground(): PlatformBackgroundReason {
        return this.isOverlayActive() ? 'overlay' : 'user_absence';
    }

    private emit(event: PlatformOverlayEvent): void {
        for (const listener of [...this.listeners]) {
            try {
                listener(event);
            } catch {
                // listeners never break provider flows
            }
        }
    }
}
