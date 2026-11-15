// AUT-072 build identity source. The committed values are the safe defaults (tests / Node need no build step).
// `tools/ci/write_build_info.js` rewrites this file for the duration of a Cocos Android build only
// (git short SHA, commit count, dirty flag) and restores these exact bytes afterwards.
export interface BuildInfoData {
    readonly gameVersion: string;
    readonly buildNumber: number;
    readonly gitSha: string;
    readonly gitDirty: boolean;
}

export const BUILD_INFO_DATA: BuildInfoData = {
    gameVersion: '0.1.0-dev',
    buildNumber: 0,
    gitSha: 'unknown',
    gitDirty: false,
};
