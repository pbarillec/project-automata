import type {
    EntitlementService,
    EntitlementStatus,
} from '../../services/EntitlementService';
import type {
    PlatformOperationResult,
    PlatformServiceState,
    EntitlementId,
} from '../../services/PlatformServiceTypes';
import { callAutomataStaticString } from './AndroidNativeBridge';

// AUT-057: the ads provider is pure (injected transport) and lives in AndroidAdsService.ts; re-exported here for existing importers.
export { AndroidAdsService } from './AndroidAdsService';
// AUT-060: the Google Play Billing provider is pure (injected transport) and lives in AndroidPurchaseService.ts.
export { AndroidPurchaseService } from './AndroidPurchaseService';

type NativeObject = Record<string, unknown>;

function parseNativeObject(raw: string): NativeObject {
    try {
        const parsed = JSON.parse(raw) as unknown;
        return parsed !== null && typeof parsed === 'object' ? parsed as NativeObject : {};
    } catch {
        return { ok: false, status: 'failed', reason: 'android_native_bridge_malformed_json' };
    }
}

function stringField(source: NativeObject, key: string, fallback = ''): string {
    const value = source[key];
    return typeof value === 'string' ? value : fallback;
}

function booleanField(source: NativeObject, key: string, fallback = false): boolean {
    const value = source[key];
    return typeof value === 'boolean' ? value : fallback;
}

function serviceState(kind: PlatformServiceState['kind'], source: NativeObject): PlatformServiceState {
    return {
        kind,
        status: stringField(source, 'status', 'failed') as PlatformServiceState['status'],
        reason: stringField(source, 'reason') || undefined,
        message: stringField(source, 'message') || undefined,
    };
}

function operationResult(source: NativeObject): PlatformOperationResult {
    return {
        ok: booleanField(source, 'ok'),
        status: stringField(source, 'status', 'failed') as PlatformOperationResult['status'],
        reason: stringField(source, 'reason') || undefined,
        message: stringField(source, 'message') || undefined,
    };
}

export class AndroidEntitlementService implements EntitlementService {
    public async initialize(): Promise<PlatformServiceState> {
        return serviceState('entitlement', parseNativeObject(callAutomataStaticString('initializeEntitlements')));
    }

    public getStatus(): PlatformServiceState {
        return serviceState('entitlement', parseNativeObject(callAutomataStaticString('getEntitlementServiceStatus')));
    }

    public async getEntitlementStatus(entitlementId: EntitlementId): Promise<EntitlementStatus> {
        const source = parseNativeObject(callAutomataStaticString(
            'getEntitlementStatus',
            '(Ljava/lang/String;)Ljava/lang/String;',
            entitlementId,
        ));

        return {
            entitlementId: stringField(source, 'entitlementId', entitlementId),
            owned: booleanField(source, 'owned'),
            source: stringField(source, 'source', 'none') as EntitlementStatus['source'],
            reason: stringField(source, 'reason') || undefined,
        };
    }

    public async reconcileEntitlements(): Promise<PlatformOperationResult> {
        return operationResult(parseNativeObject(callAutomataStaticString('reconcileEntitlements')));
    }
}

