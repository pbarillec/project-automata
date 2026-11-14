import {
    DEFAULT_USER_SETTINGS,
    mergeUserSettings,
    parseUserSettings,
    serializeUserSettings,
    type UserSettings,
    type UserSettingsParseSource,
    type UserSettingsPatch,
} from './UserSettings.ts';

/**
 * Synchronous slice of `FileSystemPort` (`persistence/FileSaveStorage.ts`) the store needs. `CocosFileSystemPort` satisfies it (its
 * methods are synchronous), which lets the settings load BEFORE the first UI paint. Paths are logical names under the app-private root.
 */
export interface SettingsFileSystemPort {
    readText(path: string): string | undefined;
    writeText(path: string, text: string): void;
    move(fromPath: string, toPath: string): void;
    remove(path: string): void;
}

export const SETTINGS_FILE = 'settings.json';
export const SETTINGS_TEMP_FILE = 'settings_temp.json';

export type SettingsEvent =
    | { readonly kind: 'loaded'; readonly source: UserSettingsParseSource }
    | { readonly kind: 'saved' }
    | { readonly kind: 'save_failed'; readonly message: string }
    | { readonly kind: 'load_failed'; readonly message: string };

export type SettingsSink = (event: SettingsEvent) => void;
export type SettingsListener = (settings: UserSettings, previous: UserSettings) => void;

/**
 * Loads / saves the user settings through a file port (temp file then move, like the save repository). Every failure is contained: a
 * failed read gives the defaults, a failed write keeps the in-memory change (the toggle still works this session) and is reported
 * through the sink. Nothing here touches the game save or the runtime.
 */
export class SettingsStore {
    private readonly port: SettingsFileSystemPort;
    private readonly sink: SettingsSink | null;
    private current: UserSettings = DEFAULT_USER_SETTINGS;
    private source: UserSettingsParseSource = 'default';
    private readonly listeners = new Set<SettingsListener>();

    constructor(port: SettingsFileSystemPort, sink: SettingsSink | null = null) {
        this.port = port;
        this.sink = sink;
    }

    /** Reads `settings.json` (synchronously). Never throws. */
    public load(): UserSettings {
        let text: string | undefined;
        try {
            text = this.port.readText(SETTINGS_FILE);
        } catch (error) {
            this.report({ kind: 'load_failed', message: describe(error) });
            text = undefined;
        }
        const result = parseUserSettings(text);
        this.current = result.settings;
        this.source = result.source;
        this.report({ kind: 'loaded', source: result.source });
        return this.current;
    }

    public get(): UserSettings {
        return this.current;
    }

    /** Where the current values came from at load time (`file` | `default` | `corrupt`). */
    public getSource(): UserSettingsParseSource {
        return this.source;
    }

    /** Applies the patch, notifies listeners (only when something changed) and persists. Returns whether the write succeeded. */
    public update(patch: UserSettingsPatch): boolean {
        const previous = this.current;
        const next = mergeUserSettings(previous, patch);
        const changed = next.musicEnabled !== previous.musicEnabled || next.sfxEnabled !== previous.sfxEnabled
            || next.vibrationEnabled !== previous.vibrationEnabled || next.language !== previous.language;
        this.current = next;
        if (changed) {
            for (const listener of Array.from(this.listeners)) {
                try { listener(next, previous); } catch { /* a faulty listener never breaks settings */ }
            }
        }
        return this.save();
    }

    public subscribe(listener: SettingsListener): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private save(): boolean {
        try {
            this.port.writeText(SETTINGS_TEMP_FILE, serializeUserSettings(this.current));
            this.port.move(SETTINGS_TEMP_FILE, SETTINGS_FILE);
            this.report({ kind: 'saved' });
            return true;
        } catch (error) {
            this.report({ kind: 'save_failed', message: describe(error) });
            try { this.port.remove(SETTINGS_TEMP_FILE); } catch { /* best effort */ }
            return false;
        }
    }

    private report(event: SettingsEvent): void {
        if (!this.sink) return;
        try { this.sink(event); } catch { /* a faulty sink never breaks settings */ }
    }
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
