import {
    type LogicalSaveName,
    type SaveStorage,
    SaveStorageError,
} from './SaveStorage.ts';

export type SaveStorageOperation = 'read' | 'write' | 'copy' | 'replace';
export type InMemorySaveStorageFailureMode = 'before' | 'after_delete_destination';

export interface InMemorySaveStorageFailureRule {
    readonly operation: SaveStorageOperation;
    readonly name?: LogicalSaveName;
    readonly fromName?: LogicalSaveName;
    readonly toName?: LogicalSaveName;
    readonly mode?: InMemorySaveStorageFailureMode;
    readonly message?: string;
}

export interface InMemorySaveStorageOperationRecord {
    readonly operation: SaveStorageOperation;
    readonly name?: LogicalSaveName;
    readonly fromName?: LogicalSaveName;
    readonly toName?: LogicalSaveName;
}

interface WriteTransformRule {
    readonly name: LogicalSaveName;
    readonly transform: (text: string) => string;
}

export class InMemorySaveStorage implements SaveStorage {
    private readonly files = new Map<LogicalSaveName, string>();
    private readonly failures: InMemorySaveStorageFailureRule[] = [];
    private readonly writeTransforms: WriteTransformRule[] = [];
    private readonly records: InMemorySaveStorageOperationRecord[] = [];

    constructor(initialFiles: Readonly<Partial<Record<LogicalSaveName, string>>> = {}) {
        for (const [name, text] of Object.entries(initialFiles)) {
            if (text !== undefined) {
                this.files.set(name as LogicalSaveName, text);
            }
        }
    }

    async readText(name: LogicalSaveName): Promise<string | undefined> {
        this.records.push({ operation: 'read', name });
        this.throwIfFailed({ operation: 'read', name });
        return this.files.get(name);
    }

    async writeText(name: LogicalSaveName, text: string): Promise<void> {
        this.records.push({ operation: 'write', name });
        this.throwIfFailed({ operation: 'write', name });
        this.files.set(name, this.consumeWriteTransform(name, text));
    }

    async copyText(fromName: LogicalSaveName, toName: LogicalSaveName): Promise<void> {
        this.records.push({ operation: 'copy', fromName, toName });
        this.throwIfFailed({ operation: 'copy', fromName, toName });

        const text = this.files.get(fromName);
        if (text === undefined) {
            throw new SaveStorageError('copy', `Missing source save "${fromName}".`, { fromName, toName });
        }

        this.files.set(toName, text);
    }

    async replaceText(fromName: LogicalSaveName, toName: LogicalSaveName): Promise<void> {
        this.records.push({ operation: 'replace', fromName, toName });

        const destructiveFailure = this.consumeFailure({ operation: 'replace', fromName, toName }, 'after_delete_destination');
        if (destructiveFailure !== undefined) {
            this.files.delete(toName);
            throw createFailureError(destructiveFailure, { operation: 'replace', fromName, toName });
        }

        this.throwIfFailed({ operation: 'replace', fromName, toName });

        const text = this.files.get(fromName);
        if (text === undefined) {
            throw new SaveStorageError('replace', `Missing replacement save "${fromName}".`, { fromName, toName });
        }

        this.files.set(toName, text);
        this.files.delete(fromName);
    }

    setFile(name: LogicalSaveName, text: string): void {
        this.files.set(name, text);
    }

    deleteFile(name: LogicalSaveName): void {
        this.files.delete(name);
    }

    getFile(name: LogicalSaveName): string | undefined {
        return this.files.get(name);
    }

    hasFile(name: LogicalSaveName): boolean {
        return this.files.has(name);
    }

    snapshot(): Readonly<Partial<Record<LogicalSaveName, string>>> {
        const snapshot: Partial<Record<LogicalSaveName, string>> = {};
        for (const [name, text] of this.files.entries()) {
            snapshot[name] = text;
        }
        return Object.freeze(snapshot);
    }

    operationLog(): readonly InMemorySaveStorageOperationRecord[] {
        return Object.freeze(this.records.map((record) => Object.freeze({ ...record })));
    }

    failNext(rule: InMemorySaveStorageFailureRule): void {
        this.failures.push(rule);
    }

    corruptNextWrite(name: LogicalSaveName, replacementText: string): void {
        this.writeTransforms.push({
            name,
            transform: () => replacementText,
        });
    }

    transformNextWrite(name: LogicalSaveName, transform: (text: string) => string): void {
        this.writeTransforms.push({ name, transform });
    }

    private consumeWriteTransform(name: LogicalSaveName, text: string): string {
        const index = this.writeTransforms.findIndex((rule) => rule.name === name);
        if (index < 0) {
            return text;
        }

        const [rule] = this.writeTransforms.splice(index, 1);
        return rule.transform(text);
    }

    private throwIfFailed(record: InMemorySaveStorageOperationRecord): void {
        const rule = this.consumeFailure(record, 'before');
        if (rule !== undefined) {
            throw createFailureError(rule, record);
        }
    }

    private consumeFailure(
        record: InMemorySaveStorageOperationRecord,
        mode: InMemorySaveStorageFailureMode,
    ): InMemorySaveStorageFailureRule | undefined {
        const index = this.failures.findIndex((rule) => failureMatches(rule, record, mode));
        if (index < 0) {
            return undefined;
        }

        const [rule] = this.failures.splice(index, 1);
        return rule;
    }
}

function failureMatches(
    rule: InMemorySaveStorageFailureRule,
    record: InMemorySaveStorageOperationRecord,
    mode: InMemorySaveStorageFailureMode,
): boolean {
    if (rule.operation !== record.operation) {
        return false;
    }

    if ((rule.mode ?? 'before') !== mode) {
        return false;
    }

    if (rule.name !== undefined && rule.name !== record.name) {
        return false;
    }

    if (rule.fromName !== undefined && rule.fromName !== record.fromName) {
        return false;
    }

    if (rule.toName !== undefined && rule.toName !== record.toName) {
        return false;
    }

    return true;
}

function createFailureError(
    rule: InMemorySaveStorageFailureRule,
    record: InMemorySaveStorageOperationRecord,
): SaveStorageError {
    return new SaveStorageError(
        record.operation,
        rule.message ?? `Injected ${record.operation} failure.`,
        {
            name: record.name,
            fromName: record.fromName,
            toName: record.toName,
        },
    );
}
