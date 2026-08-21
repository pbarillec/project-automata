import type {
    EntitlementId,
    PlatformOperationResult,
    PlatformServiceState,
} from './PlatformServiceTypes';

export interface EntitlementStatus {
    entitlementId: EntitlementId;
    owned: boolean;
    source: 'none' | 'local_cache' | 'store' | 'mock';
    reason?: string;
}

export interface EntitlementService {
    initialize(): Promise<PlatformServiceState>;
    getStatus(): PlatformServiceState;
    getEntitlementStatus(entitlementId: EntitlementId): Promise<EntitlementStatus>;
    setMockEntitlement?(entitlementId: EntitlementId, owned: boolean): void;
    reconcileEntitlements(): Promise<PlatformOperationResult>;
}

