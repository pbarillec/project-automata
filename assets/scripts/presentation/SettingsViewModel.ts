import { getDefaultTextCatalogue, type TextCatalogue } from '../localization/index.ts';
import type { BooleanSettingKey, UserSettings, UserSettingsPatch } from '../settings/UserSettings.ts';

/**
 * AUT-052 pure Settings view model: user settings + catalogue in, strings and the toggle patch out. It holds no state and issues no
 * `GameCommand`; a toggle row carries the settings patch the controller hands to `SettingsStore.update`.
 */
export type SettingsRowId = 'music' | 'sfx' | 'vibration' | 'language';

export interface SettingsRowViewModel {
    readonly id: SettingsRowId;
    readonly label: string;
    /** Pill text: ON / OFF for a toggle, the language name for the informational Language row. */
    readonly valueText: string;
    /** null for the informational Language row. */
    readonly on: boolean | null;
    readonly tappable: boolean;
    /** Settings patch applied by a tap (the opposite value of the toggle); null when the row is not tappable. */
    readonly patch: UserSettingsPatch | null;
    readonly setting: BooleanSettingKey | 'language';
}

export interface SettingsViewModel {
    readonly texts: { readonly title: string; readonly chip: string; readonly close: string };
    readonly rows: readonly SettingsRowViewModel[];
}

const TOGGLE_ROWS: ReadonlyArray<{ readonly id: Exclude<SettingsRowId, 'language'>; readonly setting: BooleanSettingKey }> = Object.freeze([
    { id: 'music', setting: 'musicEnabled' },
    { id: 'sfx', setting: 'sfxEnabled' },
    { id: 'vibration', setting: 'vibrationEnabled' },
]);

export function createSettingsViewModel(settings: UserSettings, catalogue: TextCatalogue = getDefaultTextCatalogue()): SettingsViewModel {
    const rows: SettingsRowViewModel[] = TOGGLE_ROWS.map(({ id, setting }) => {
        const on = settings[setting];
        return Object.freeze({
            id,
            label: catalogue.resolveText(`settings.${id}`),
            valueText: catalogue.resolveText(on ? 'settings.on' : 'settings.off'),
            on,
            tappable: true,
            patch: Object.freeze({ [setting]: !on }) as UserSettingsPatch,
            setting,
        });
    });
    const languageKey = `settings.language.${settings.language}`;
    rows.push(Object.freeze({
        id: 'language' as const,
        label: catalogue.resolveText('settings.language'),
        valueText: catalogue.has(languageKey) ? catalogue.resolveText(languageKey) : settings.language,
        on: null,
        tappable: false,
        patch: null,
        setting: 'language' as const,
    }));
    return Object.freeze({
        texts: Object.freeze({
            title: catalogue.resolveText('settings.title'),
            chip: catalogue.resolveText('settings.chip'),
            close: catalogue.resolveText('settings.close'),
        }),
        rows: Object.freeze(rows),
    });
}
