/**
 * AUT-068 engine-free cache keys and a tiny keyed cache for the runtime-built primitive boxes (FactoryWorldBootstrap.createBox).
 * Before: every box created its own Mesh and its own unlit Material (the dominant source of the 153 unique materials measured by AUT-067).
 * After: boxes whose colour is never mutated share ONE material per colour and ONE mesh per size (so identical boxes can be GPU-instanced);
 * boxes that are recoloured at runtime (era palette, teaser seam pulse, spark accents) keep an own material (`unique`).
 */

export interface BoxRgba { readonly r: number; readonly g: number; readonly b: number; readonly a?: number }

/** Stable key of an opaque / translucent colour (channels rounded to the 0..255 integer Cocos stores). */
export function boxMaterialKey(color: BoxRgba): string {
    const c = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));
    return `${c(color.r)}|${c(color.g)}|${c(color.b)}|${c(color.a ?? 255)}`;
}

/** Stable key of a box mesh size (4 decimals, the precision of the authored layouts). */
export function boxMeshKey(size: { readonly x: number; readonly y: number; readonly z: number }): string {
    return `${size.x.toFixed(4)}|${size.y.toFixed(4)}|${size.z.toFixed(4)}`;
}

export class KeyedCache<T> {
    private readonly entries = new Map<string, T>();
    private requestCount = 0;

    public getOrCreate(key: string, create: () => T): T {
        this.requestCount += 1;
        let value = this.entries.get(key);
        if (value === undefined) {
            value = create();
            this.entries.set(key, value);
        }
        return value;
    }

    /** Distinct values created. */
    public get size(): number { return this.entries.size; }

    /** Total lookups; `requests - size` is the number of creations avoided. */
    public get requests(): number { return this.requestCount; }

    public clear(): void {
        this.entries.clear();
        this.requestCount = 0;
    }
}
