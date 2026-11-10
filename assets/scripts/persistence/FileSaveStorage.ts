import {
    type LogicalSaveName,
    type SaveStorage,
    SaveStorageError,
} from './SaveStorage.ts';

/**
 * AUT-INT-001 minimal file-system boundary used by `FileSaveStorage`.
 *
 * Paths are logical file names relative to the port's own root (the platform adapter decides
 * where that root lives). Every method may be synchronous or asynchronous; failures throw.
 */
export interface FileSystemPort {
    exists(path: string): boolean | Promise<boolean>;
    /** Returns the file text, or `undefined` when the file does not exist. */
    readText(path: string): string | undefined | Promise<string | undefined>;
    writeText(path: string, text: string): void | Promise<void>;
    /** Renames/moves `fromPath` to `toPath`, replacing any existing destination. */
    move(fromPath: string, toPath: string): void | Promise<void>;
    remove(path: string): void | Promise<void>;
}

/** Device-backed `SaveStorage` with the same observable semantics as `InMemorySaveStorage`. */
export class FileSaveStorage implements SaveStorage {
    private readonly port: FileSystemPort;

    constructor(port: FileSystemPort) {
        this.port = port;
    }

    async readText(name: LogicalSaveName): Promise<string | undefined> {
        try {
            if (!(await this.port.exists(name))) {
                return undefined;
            }

            return await this.port.readText(name);
        }
        catch (error) {
            throw wrapError(error, 'read', { name });
        }
    }

    async writeText(name: LogicalSaveName, text: string): Promise<void> {
        try {
            await this.port.writeText(name, text);
        }
        catch (error) {
            throw wrapError(error, 'write', { name });
        }
    }

    async copyText(fromName: LogicalSaveName, toName: LogicalSaveName): Promise<void> {
        let text: string | undefined;
        try {
            text = (await this.port.exists(fromName)) ? await this.port.readText(fromName) : undefined;
        }
        catch (error) {
            throw wrapError(error, 'copy', { fromName, toName });
        }

        if (text === undefined) {
            throw new SaveStorageError('copy', `Missing source save "${fromName}".`, { fromName, toName });
        }

        try {
            await this.port.writeText(toName, text);
        }
        catch (error) {
            throw wrapError(error, 'copy', { fromName, toName });
        }
    }

    async replaceText(fromName: LogicalSaveName, toName: LogicalSaveName): Promise<void> {
        let sourceExists: boolean;
        try {
            sourceExists = await this.port.exists(fromName);
        }
        catch (error) {
            throw wrapError(error, 'replace', { fromName, toName });
        }

        if (!sourceExists) {
            throw new SaveStorageError('replace', `Missing replacement save "${fromName}".`, { fromName, toName });
        }

        try {
            await this.port.move(fromName, toName);
            if (await this.port.exists(fromName)) {
                await this.port.remove(fromName);
            }
        }
        catch (error) {
            throw wrapError(error, 'replace', { fromName, toName });
        }
    }
}

function wrapError(
    error: unknown,
    operation: 'read' | 'write' | 'copy' | 'replace',
    names: { readonly name?: LogicalSaveName; readonly fromName?: LogicalSaveName; readonly toName?: LogicalSaveName },
): SaveStorageError {
    if (error instanceof SaveStorageError) {
        return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    return new SaveStorageError(operation, message, names);
}
