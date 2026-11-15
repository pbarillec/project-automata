import { CURRENT_SAVE_VERSION } from '../persistence/SaveEnvelope.ts';
import { BUILD_INFO_DATA, type BuildInfoData } from './BuildInfoData.ts';
import type { LogBuildType } from './Log.ts';

/** AUT-072: the engine the project is locked to (Cocos Creator, not Godot). */
export const BUILD_INFO_ENGINE = 'cocos-creator 3.8.8';

export interface BuildInfo {
    readonly gameVersion: string;
    /** versionCode-style monotonic number (git commit count at build time; 0 for an unstamped dev build). */
    readonly buildNumber: number;
    readonly saveVersion: number;
    /** The loaded config content version (`GameConfigRepository.contentVersion`). */
    readonly contentVersion: string;
    readonly engine: string;
    /** Git short SHA, or 'unknown' for an unstamped build. */
    readonly gitSha: string;
    readonly gitDirty: boolean;
    readonly buildType: LogBuildType;
    readonly platform: string;
}

export interface BuildInfoInput {
    readonly contentVersion: string;
    readonly buildType: LogBuildType;
    readonly platform?: string;
    /** Defaults to the committed / build-stamped `BUILD_INFO_DATA`. */
    readonly data?: BuildInfoData;
}

export function createBuildInfo(input: BuildInfoInput): BuildInfo {
    const data = input.data ?? BUILD_INFO_DATA;
    return Object.freeze({
        gameVersion: data.gameVersion,
        buildNumber: data.buildNumber,
        saveVersion: CURRENT_SAVE_VERSION,
        contentVersion: input.contentVersion,
        engine: BUILD_INFO_ENGINE,
        gitSha: data.gitSha,
        gitDirty: data.gitDirty,
        buildType: input.buildType,
        platform: input.platform ?? 'unknown',
    });
}

/** Short identity used by QA tooling: `<sha>[+] <TYPE>` (a `+` marks a build made from a dirty assets tree). */
export function formatBuildTag(info: Pick<BuildInfo, 'gitSha' | 'gitDirty' | 'buildType'>): string {
    return `${info.gitSha}${info.gitDirty ? '+' : ''} ${info.buildType}`;
}

/** Payload of the DEBUG `build_info` device event emitted once at startup. */
export function buildInfoEventPayload(info: BuildInfo): Record<string, unknown> {
    return {
        gameVersion: info.gameVersion,
        buildNumber: info.buildNumber,
        gitSha: info.gitSha,
        gitDirty: info.gitDirty,
        saveVersion: info.saveVersion,
        contentVersion: info.contentVersion,
        engine: info.engine,
        buildType: info.buildType,
        platform: info.platform,
    };
}
