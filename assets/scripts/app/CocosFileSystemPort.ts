import { native, sys } from 'cc';
import type { FileSystemPort } from '../persistence/FileSaveStorage.ts';

const LOCAL_STORAGE_PREFIX = 'automata.';

/**
 * AUT-INT-001 platform file adapter for `FileSaveStorage`.
 * Native builds: files directly under `native.fileUtils.getWritablePath()` (app-private storage).
 * Non-native (editor preview / web): `sys.localStorage` keys prefixed with `automata.`.
 */
export class CocosFileSystemPort implements FileSystemPort {
    private readonly useNativeFiles: boolean;
    private readonly root: string;

    constructor() {
        this.useNativeFiles = sys.isNative && native?.fileUtils !== undefined;
        this.root = this.useNativeFiles ? ensureTrailingSlash(native.fileUtils.getWritablePath()) : `localStorage:${LOCAL_STORAGE_PREFIX}`;
    }

    /** Directory (or storage prefix) the save files live in; reported by DEBUG diagnostics. */
    public get rootPath(): string {
        return this.root;
    }

    public exists(path: string): boolean {
        if (this.useNativeFiles) return native.fileUtils.isFileExist(this.resolve(path));
        return sys.localStorage.getItem(this.key(path)) !== null;
    }

    public readText(path: string): string | undefined {
        if (this.useNativeFiles) {
            const fullPath = this.resolve(path);
            return native.fileUtils.isFileExist(fullPath) ? native.fileUtils.getStringFromFile(fullPath) : undefined;
        }
        return sys.localStorage.getItem(this.key(path)) ?? undefined;
    }

    public writeText(path: string, text: string): void {
        if (this.useNativeFiles) {
            if (!native.fileUtils.writeStringToFile(text, this.resolve(path))) throw new Error(`writeStringToFile failed for ${path}`);
            return;
        }
        sys.localStorage.setItem(this.key(path), text);
    }

    public move(fromPath: string, toPath: string): void {
        if (this.useNativeFiles) {
            const from = this.resolve(fromPath);
            const to = this.resolve(toPath);
            if (native.fileUtils.renameFile(from, to)) return;
            // Fallback when rename cannot replace the destination: copy then delete the source.
            const text = native.fileUtils.getStringFromFile(from);
            if (!native.fileUtils.writeStringToFile(text, to)) throw new Error(`move failed for ${fromPath} -> ${toPath}`);
            native.fileUtils.removeFile(from);
            return;
        }
        const text = sys.localStorage.getItem(this.key(fromPath));
        if (text === null) throw new Error(`move source missing: ${fromPath}`);
        sys.localStorage.setItem(this.key(toPath), text);
        sys.localStorage.removeItem(this.key(fromPath));
    }

    public remove(path: string): void {
        if (this.useNativeFiles) {
            const fullPath = this.resolve(path);
            if (native.fileUtils.isFileExist(fullPath) && !native.fileUtils.removeFile(fullPath)) throw new Error(`removeFile failed for ${path}`);
            return;
        }
        sys.localStorage.removeItem(this.key(path));
    }

    private resolve(path: string): string {
        return `${this.root}${path}`;
    }

    private key(path: string): string {
        return `${LOCAL_STORAGE_PREFIX}${path}`;
    }
}

function ensureTrailingSlash(directory: string): string {
    return directory.endsWith('/') ? directory : `${directory}/`;
}
