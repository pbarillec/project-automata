export type TouchId = number | string;

export interface TouchSample {
    id: TouchId;
    x: number;
    y: number;
    consumedByUi?: boolean;
}

export interface GestureTrackerOptions {
    dragThresholdPixels: number;
    pinchMinDistancePixels: number;
}

export type GestureOutput =
    | {
        type: 'tap';
        id: TouchId;
        x: number;
        y: number;
    }
    | {
        type: 'orbit';
        id: TouchId;
        deltaX: number;
        deltaY: number;
    }
    | {
        type: 'panZoom';
        centerDeltaX: number;
        centerDeltaY: number;
        zoomScale: number | null;
    };

interface TrackedTouch {
    id: TouchId;
    startX: number;
    startY: number;
    previousX: number;
    previousY: number;
    x: number;
    y: number;
    consumedByUi: boolean;
}

const DEFAULT_OPTIONS: GestureTrackerOptions = {
    dragThresholdPixels: 12,
    pinchMinDistancePixels: 4,
};

export class TouchGestureTracker {
    private readonly options: GestureTrackerOptions;
    private readonly touches = new Map<TouchId, TrackedTouch>();
    private singleTouchId: TouchId | null = null;
    private singleDragged = false;
    private lockedUntilAllReleased = false;

    public constructor(options: Partial<GestureTrackerOptions> = {}) {
        this.options = {
            ...DEFAULT_OPTIONS,
            ...options,
        };
    }

    public begin(sample: TouchSample): GestureOutput[] {
        if (this.touches.size === 0) {
            this.resetGestureFlags();
        }

        const touch = this.toTrackedTouch(sample);
        this.touches.set(sample.id, touch);

        if (this.isSuppressedByUi()) {
            this.lockedUntilAllReleased = true;
            return [];
        }

        const usableTouches = this.usableTouches();
        if (usableTouches.length === 1 && !this.lockedUntilAllReleased) {
            this.singleTouchId = usableTouches[0].id;
            this.singleDragged = false;
        } else if (usableTouches.length >= 2) {
            this.enterMultiTouchMode();
        }

        return [];
    }

    public move(sample: TouchSample): GestureOutput[] {
        const touch = this.touches.get(sample.id);
        if (!touch) {
            return [];
        }

        touch.previousX = touch.x;
        touch.previousY = touch.y;
        touch.x = sanitizeFinite(sample.x, touch.x);
        touch.y = sanitizeFinite(sample.y, touch.y);

        if (this.isSuppressedByUi()) {
            return [];
        }

        const usableTouches = this.usableTouches();
        if (usableTouches.length >= 2) {
            this.enterMultiTouchMode();
            return this.createPanZoomOutput(usableTouches[0], usableTouches[1]);
        }

        if (usableTouches.length !== 1 || this.lockedUntilAllReleased) {
            return [];
        }

        const singleTouch = usableTouches[0];
        if (this.singleTouchId !== singleTouch.id) {
            this.singleTouchId = singleTouch.id;
            this.singleDragged = false;
        }

        const totalDeltaX = singleTouch.x - singleTouch.startX;
        const totalDeltaY = singleTouch.y - singleTouch.startY;
        if (!this.singleDragged && distance(totalDeltaX, totalDeltaY) >= this.options.dragThresholdPixels) {
            this.singleDragged = true;
        }

        if (!this.singleDragged) {
            return [];
        }

        return [{
            type: 'orbit',
            id: singleTouch.id,
            deltaX: singleTouch.x - singleTouch.previousX,
            deltaY: singleTouch.y - singleTouch.previousY,
        }];
    }

    public end(sample: TouchSample): GestureOutput[] {
        const touch = this.touches.get(sample.id);
        if (!touch) {
            return [];
        }

        touch.previousX = touch.x;
        touch.previousY = touch.y;
        touch.x = sanitizeFinite(sample.x, touch.x);
        touch.y = sanitizeFinite(sample.y, touch.y);

        const outputs: GestureOutput[] = [];
        const wasSuppressed = this.isSuppressedByUi();
        const wasSingleTouch = this.usableTouches().length === 1 && this.singleTouchId === touch.id;
        const moved = distance(touch.x - touch.startX, touch.y - touch.startY);

        if (
            !wasSuppressed
            && wasSingleTouch
            && !this.lockedUntilAllReleased
            && !this.singleDragged
            && moved < this.options.dragThresholdPixels
        ) {
            outputs.push({
                type: 'tap',
                id: touch.id,
                x: touch.x,
                y: touch.y,
            });
        }

        this.touches.delete(sample.id);
        if (this.touches.size === 0) {
            this.resetGestureFlags();
        }

        return outputs;
    }

    public cancel(_sample?: TouchSample): GestureOutput[] {
        this.touches.clear();
        this.resetGestureFlags();
        return [];
    }

    public activeTouchCount(): number {
        return this.touches.size;
    }

    public isLockedUntilAllReleased(): boolean {
        return this.lockedUntilAllReleased;
    }

    private enterMultiTouchMode(): void {
        this.singleTouchId = null;
        this.singleDragged = true;
        this.lockedUntilAllReleased = true;
    }

    private resetGestureFlags(): void {
        this.singleTouchId = null;
        this.singleDragged = false;
        this.lockedUntilAllReleased = false;
    }

    private isSuppressedByUi(): boolean {
        for (const touch of this.touches.values()) {
            if (touch.consumedByUi) {
                return true;
            }
        }

        return false;
    }

    private usableTouches(): TrackedTouch[] {
        return Array.from(this.touches.values())
            .filter((touch) => !touch.consumedByUi)
            .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    }

    private createPanZoomOutput(a: TrackedTouch, b: TrackedTouch): GestureOutput[] {
        const previousCenter = {
            x: (a.previousX + b.previousX) / 2,
            y: (a.previousY + b.previousY) / 2,
        };
        const center = {
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
        };
        const previousDistance = distance(a.previousX - b.previousX, a.previousY - b.previousY);
        const currentDistance = distance(a.x - b.x, a.y - b.y);
        const canZoom = Number.isFinite(previousDistance)
            && Number.isFinite(currentDistance)
            && previousDistance >= this.options.pinchMinDistancePixels
            && currentDistance >= this.options.pinchMinDistancePixels;

        return [{
            type: 'panZoom',
            centerDeltaX: center.x - previousCenter.x,
            centerDeltaY: center.y - previousCenter.y,
            zoomScale: canZoom ? currentDistance / previousDistance : null,
        }];
    }

    private toTrackedTouch(sample: TouchSample): TrackedTouch {
        const x = sanitizeFinite(sample.x, 0);
        const y = sanitizeFinite(sample.y, 0);

        return {
            id: sample.id,
            startX: x,
            startY: y,
            previousX: x,
            previousY: y,
            x,
            y,
            consumedByUi: sample.consumedByUi === true,
        };
    }
}

function sanitizeFinite(value: number, fallback: number): number {
    return Number.isFinite(value) ? value : fallback;
}

function distance(x: number, y: number): number {
    return Math.sqrt((x * x) + (y * y));
}
