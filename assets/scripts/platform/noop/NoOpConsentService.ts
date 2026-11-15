import {
    INITIAL_CONSENT_STATE,
    type ConsentListener,
    type ConsentService,
    type ConsentState,
    type PrivacyOptionsResult,
} from '../../services/ConsentService.ts';

/**
 * AUT-065 no-op consent provider (release without the native bridge, editor, iOS before its own provider): consent is `unavailable`, ads can NOT be
 * requested (fail-closed; the ads provider is a NoOp there anyway), there is no privacy options entry and gameplay is untouched.
 */
export class NoOpConsentService implements ConsentService {
    private readonly state: ConsentState = Object.freeze({ ...INITIAL_CONSENT_STATE, status: 'unavailable' as const, reason: 'platform_provider_unavailable' });

    public async start(): Promise<ConsentState> {
        return this.state;
    }

    public getState(): ConsentState {
        return this.state;
    }

    public canRequestAds(): boolean {
        return false;
    }

    public isPrivacyOptionsRequired(): boolean {
        return false;
    }

    public subscribe(_listener: ConsentListener): () => void {
        return () => undefined;
    }

    public async showPrivacyOptions(): Promise<PrivacyOptionsResult> {
        return { status: 'unavailable', reason: 'platform_provider_unavailable' };
    }
}
