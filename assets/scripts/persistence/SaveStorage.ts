export const SAVE_TEMP_NAME = 'save_temp.json';
export const SAVE_MAIN_NAME = 'save_main.json';
export const SAVE_BACKUP_NAME = 'save_backup.json';

export type LogicalSaveName =
    | typeof SAVE_TEMP_NAME
    | typeof SAVE_MAIN_NAME
    | typeof SAVE_BACKUP_NAME;

export interface SaveStorage {
    readText(name: LogicalSaveName): Promise<string | undefined>;
    writeText(name: LogicalSaveName, text: string): Promise<void>;
    copyText(fromName: LogicalSaveName, toName: LogicalSaveName): Promise<void>;
    replaceText(fromName: LogicalSaveName, toName: LogicalSaveName): Promise<void>;
}

export class SaveStorageError extends Error {
    readonly operation: 'read' | 'write' | 'copy' | 'replace';
    readonly saveName: LogicalSaveName | undefined;
    readonly fromName: LogicalSaveName | undefined;
    readonly toName: LogicalSaveName | undefined;

    constructor(
        operation: 'read' | 'write' | 'copy' | 'replace',
        message: string,
        names: {
            readonly name?: LogicalSaveName;
            readonly fromName?: LogicalSaveName;
            readonly toName?: LogicalSaveName;
        } = {},
    ) {
        super(message);
        this.name = 'SaveStorageError';
        this.operation = operation;
        this.saveName = names.name;
        this.fromName = names.fromName;
        this.toName = names.toName;
    }
}
