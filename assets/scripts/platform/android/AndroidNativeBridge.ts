import { native, sys } from 'cc';
import type { AndroidAdsTransport } from './AndroidAdsService';
import type { AndroidBillingTransport } from './AndroidPurchaseService';

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

type NativeJsbBridgeWrapper = {
    addNativeEventListener?: (eventName: string, callback: (arg: string) => void) => void;
    removeNativeEventListener?: (eventName: string, callback: (arg: string) => void) => void;
};

function getJsbBridgeWrapper(): NativeJsbBridgeWrapper | null {
    const nativeModule = native as unknown as { jsbBridgeWrapper?: NativeJsbBridgeWrapper } | null | undefined;
    return nativeModule?.jsbBridgeWrapper ?? null;
}

/**
 * AUT-057: the real transport for the pure AndroidAdsService (synchronous static calls + native-to-script events).
 * Null when the Android native bridge is unavailable (editor, iOS, web), so the caller falls back to the no-op provider.
 * A missing `jsbBridgeWrapper` is tolerated: subscribe() then returns a no-op unsubscribe (pending ads end through the JS backstop).
 */
export function createAndroidAdsTransport(): AndroidAdsTransport | null {
    if (!isAndroidNativeBridgeAvailable()) {
        return null;
    }

    return {
        callString: (methodName, signature, ...args) => callAutomataStaticString(methodName, signature, ...args),
        subscribe: (eventName, handler) => {
            const wrapper = getJsbBridgeWrapper();
            if (wrapper === null || typeof wrapper.addNativeEventListener !== 'function') {
                return () => undefined;
            }

            wrapper.addNativeEventListener(eventName, handler);
            return () => {
                wrapper.removeNativeEventListener?.(eventName, handler);
            };
        },
    };
}

/**
 * AUT-060: the real transport for the pure AndroidPurchaseService (Google Play Billing). Same native bridge and event wrapper as the ads
 * transport; null outside an Android native build, so the caller falls back to the no-op purchase service (the Founder entry stays hidden).
 */
export function createAndroidBillingTransport(): AndroidBillingTransport | null {
    return createAndroidAdsTransport();
}
