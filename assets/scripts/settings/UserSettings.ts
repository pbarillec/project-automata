/**
 * AUT-052 user settings (engine-free). Device preferences, NOT game progress: they live in their own `settings.json` file next to the
 * save and are never part of `GameState` or the save schema. (`GameState.settings` / `SettingsState` in save v2 exists but is dormant:
 * nothing reads or writes it, and its defaults differ - vibration is off there. Do not wire it; a later schema task may retire it.)
 */

export const USER_SETTINGS_SCHEMA_VERSION = 1;

/** Languages that ship a catalogue. Must equal `listAvailableLanguages()` (pinned by a test); English only at MVP. */
export const AVAILABLE_LANGUAGES: readonly string[] = Object.freeze(['en']);
export const DEFAULT_LANGUAGE_SETTING = 'en';

export interface UserSettings {
    readonly schemaVersion: 1;
    readonly musicEnabled: boolean;
    readonly sfxEnabled: boolean;
    readonly vibrationEnabled: boolean;
    readonly language: string;
}

export type UserSettingsPatch = Partial<Omit<UserSettings, 'schemaVersion'>>;
export type BooleanSettingKey = 'musicEnabled' | 'sfxEnabled' | 'vibrationEnabled';
export const BOOLEAN_SETTING_KEYS: readonly BooleanSettingKey[] = Object.freeze(['musicEnabled', 'sfxEnabled', 'vibrationEnabled']);

/** MVP defaults: everything on, English. */
export const DEFAULT_USER_SETTINGS: UserSettings = Object.freeze({
    schemaVersion: 1,
    musicEnabled: true,
    sfxEnabled: true,
    vibrationEnabled: true,
    language: DEFAULT_LANGUAGE_SETTING,
});

export type UserSettingsParseSource = 'file' | 'default' | 'corrupt';

export interface UserSettingsParseResult {
    readonly settings: UserSettings;
    /** `file` = parsed a valid document, `default` = no text, `corrupt` = unreadable / unknown schema (defaults used). */
    readonly source: UserSettingsParseSource;
}

export function normalizeLanguage(value: unknown): string {
    return typeof value === 'string' && AVAILABLE_LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE_SETTING;
}

/** Applies a patch with the same per-field validation as parsing (a non-boolean flag keeps its current value). */
export function mergeUserSettings(base: UserSettings, patch: UserSettingsPatch): UserSettings {
    const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
    return Object.freeze({
        schemaVersion: 1,
        musicEnabled: flag(patch.musicEnabled, base.musicEnabled),
        sfxEnabled: flag(patch.sfxEnabled, base.sfxEnabled),
        vibrationEnabled: flag(patch.vibrationEnabled, base.vibrationEnabled),
        language: patch.language === undefined ? base.language : normalizeLanguage(patch.language),
    });
}

/** Never throws: corrupt JSON or an unknown schema gives the defaults; a non-boolean flag gives its default; an unknown language gives 'en'. */
export function parseUserSettings(text: string | null | undefined): UserSettingsParseResult {
    if (text === undefined || text === null) return { settings: DEFAULT_USER_SETTINGS, source: 'default' };
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return { settings: DEFAULT_USER_SETTINGS, source: 'corrupt' };
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return { settings: DEFAULT_USER_SETTINGS, source: 'corrupt' };
    const record = value as Record<string, unknown>;
    if (record.schemaVersion !== USER_SETTINGS_SCHEMA_VERSION) return { settings: DEFAULT_USER_SETTINGS, source: 'corrupt' };
    return { settings: mergeUserSettings(DEFAULT_USER_SETTINGS, record as UserSettingsPatch), source: 'file' };
}

/** Stable text: fixed key order, 2-space indent, LF, trailing newline. */
export function serializeUserSettings(settings: UserSettings): string {
    const ordered = {
        schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
        musicEnabled: settings.musicEnabled,
        sfxEnabled: settings.sfxEnabled,
        vibrationEnabled: settings.vibrationEnabled,
        language: settings.language,
    };
    return `${JSON.stringify(ordered, null, 2)}\n`;
}
