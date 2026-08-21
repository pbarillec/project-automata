import { native, sys } from 'cc';

const AUTOMATA_PLATFORM_BRIDGE_CLASS = 'com/cocos/game/AutomataPlatformBridge';

type NativeReflection = {
    callStaticMethod: (className: string, methodName: string, methodSignature: string, ...args: string[]) => unknown;
};

function getReflection(): NativeReflection | null {
    const nativeModule = native as unknown as { reflection?: NativeReflection } | null | undefined;
    return nativeModule?.reflection ?? null;
}

export function isAndroidNativeBridgeAvailable(): boolean {
    return sys.isNative && sys.os === sys.OS.ANDROID && getReflection() !== null;
}

export function callAutomataStaticString(methodName: string, signature = '()Ljava/lang/String;', ...args: string[]): string {
    const reflection = getReflection();

    if (!isAndroidNativeBridgeAvailable() || reflection === null) {
        return '{"ok":false,"status":"unavailable","reason":"android_native_bridge_unavailable"}';
    }

    const result = reflection.callStaticMethod(
        AUTOMATA_PLATFORM_BRIDGE_CLASS,
        methodName,
        signature,
        ...args,
    );

    return typeof result === 'string'
        ? result
        : '{"ok":false,"status":"failed","reason":"android_native_bridge_invalid_response"}';
}
