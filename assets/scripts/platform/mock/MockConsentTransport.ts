import { CONSENT_PRIVACY_RESULT_EVENT, CONSENT_STATE_EVENT, type ConsentTransport } from '../../services/ConsentCoordinator.ts';

/**
 * AUT-065 scriptable consent transport for DEBUG builds and tests (pure, engine-free). It speaks the same native protocol as the real Android
 * UMP controller, so the REAL ConsentCoordinator runs on top of it; events are delivered asynchronously (microtasks), never from inside callString.
 *
 *   not_required       -> `not_required`, ads allowed
 *   required_obtained  -> form shown, then `obtained`, ads allowed, privacy options available
 *   required_declined  -> form shown, then `required` without consent, ads NOT allowed, privacy options available (the mock privacy form then accepts)
 *   error              -> `error`, ads NOT allowed
 *   timeout            -> never answers (the coordinator's start timeout applies), ads NOT allowed
 */
export const MOCK_CONSENT_STATES = ['not_required', 'required_obtained', 'required_declined', 'error', 'timeout'] as const;
export type MockConsentStateName = typeof MOCK_CONSENT_STATES[number];

export interface MockConsentScript {
    readonly state: MockConsentStateName;
    /** Overrides whether the privacy options entry is required (default: true for the two `required_*` states, false otherwise). */
    readonly privacyOptions?: boolean;
}

interface Snapshot {
    status: string;
    canRequestAds: boolean;
    privacyOptionsRequired: boolean;
    formVisible: boolean;
    settled: boolean;
    reason?: string;
}

export class MockConsentTransport implements ConsentTransport {
    public readonly calls: string[] = [];
    private readonly handlers = new Map<string, Set<(payload: string) => void>>();
    private readonly privacyOptionsRequired: boolean;
    private obtained = false;
    private readonly script: MockConsentScript;

    public constructor(script: MockConsentScript) {
        this.script = script;
        this.privacyOptionsRequired = script.privacyOptions ?? (script.state === 'required_obtained' || script.state === 'required_declined');
    }

    public callString(method: string, _signature: string, ..._args: string[]): string {
        this.calls.push(method);
        if (method === 'initializeConsent') {
            this.later(() => this.runScript());
            return JSON.stringify(this.snapshot({ status: 'unknown', settled: false }));
        }
        if (method === 'showPrivacyOptions') {
            if (!this.privacyOptionsRequired) return '{"status":"unavailable","reason":"privacy_options_not_required"}';
            this.later(() => {
                this.emit(CONSENT_STATE_EVENT, this.snapshot({ status: this.currentStatus(), canRequestAds: this.obtained, formVisible: true }));
                this.later(() => {
                    this.obtained = true; // the mock privacy form always accepts
                    this.emit(CONSENT_STATE_EVENT, this.snapshot({ status: 'obtained', canRequestAds: true }));
                    this.emit(CONSENT_PRIVACY_RESULT_EVENT, { status: 'dismissed' });
                });
            });
            return '{"status":"started"}';
        }
        return '{"status":"error","reason":"mock_unknown_method"}';
    }

    public subscribe(event: string, handler: (payload: string) => void): () => void {
        const set = this.handlers.get(event) ?? new Set();
        set.add(handler);
        this.handlers.set(event, set);
        return () => { set.delete(handler); };
    }

    private currentStatus(): string {
        if (this.obtained) return 'obtained';
        return this.script.state === 'not_required' ? 'not_required' : 'required';
    }

    private snapshot(overrides: Partial<Snapshot>): Snapshot {
        return { status: 'unknown', canRequestAds: false, privacyOptionsRequired: this.privacyOptionsRequired, formVisible: false, settled: true, ...overrides };
    }

    private runScript(): void {
        switch (this.script.state) {
            case 'not_required':
                this.emit(CONSENT_STATE_EVENT, this.snapshot({ status: 'not_required', canRequestAds: true }));
                return;
            case 'required_obtained':
                this.emit(CONSENT_STATE_EVENT, this.snapshot({ status: 'required', formVisible: true, settled: false }));
                this.later(() => {
                    this.obtained = true;
                    this.emit(CONSENT_STATE_EVENT, this.snapshot({ status: 'obtained', canRequestAds: true }));
                });
                return;
            case 'required_declined':
                this.emit(CONSENT_STATE_EVENT, this.snapshot({ status: 'required', formVisible: true, settled: false }));
                this.later(() => this.emit(CONSENT_STATE_EVENT, this.snapshot({ status: 'required', canRequestAds: false, reason: 'consent_declined' })));
                return;
            case 'error':
                this.emit(CONSENT_STATE_EVENT, this.snapshot({ status: 'error', reason: 'mock_consent_error' }));
                return;
            case 'timeout':
                return; // never answers
        }
    }

    private later(action: () => void): void {
        void Promise.resolve().then(action);
    }

    private emit(event: string, payload: Snapshot | Record<string, unknown>): void {
        const text = JSON.stringify(payload);
        for (const handler of [...(this.handlers.get(event) ?? [])]) handler(text);
    }
}
