import type { GameState } from './GameState.ts';

export function cloneGameState(state: GameState): GameState {
    return clonePlainData(state) as GameState;
}

export function clonePlainData<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((item) => clonePlainData(item)) as T;
    }

    if (isPlainObject(value)) {
        const clone: Record<string, unknown> = {};
        for (const key of Object.keys(value)) {
            clone[key] = clonePlainData((value as Record<string, unknown>)[key]);
        }
        return clone as T;
    }

    return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
