import { getDefaultTextCatalogue, type TextCatalogue } from '../localization/index.ts';
import type { BooleanSettingKey, UserSettings, UserSettingsPatch } from '../settings/UserSettings.ts';

/**
 * AUT-052 pure Settings view model: user settings + catalogue in, strings and the toggle patch out. It holds no state and issues no
 * `GameCommand`; a toggle row carries the settings patch the controller hands to `SettingsStore.update`.
 */
export type SettingsRowId = 'music' | 'sfx' | 'vibration' | 'language' | 'privacy';
/** AUT-065: the one non-toggle action a row can carry (opens the platform privacy options form); null for the settings rows. */
export type SettingsRowAction = 'privacy_options';

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
    readonly setting: BooleanSettingKey | 'language' | 'privacy';
    readonly action: SettingsRowAction | null;
}

export interface SettingsViewModelOptions {
    /** AUT-065: the consent provider says the privacy options entry must be reachable (UMP `privacyOptionsRequirementStatus === REQUIRED`). Default false: no row. */
    readonly privacyOptionsRequired?: boolean;
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

export function createSettingsViewModel(settings: UserSettings, catalogue: TextCatalogue = getDefaultTextCatalogue(), options: SettingsViewModelOptions = {}): SettingsViewModel {
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
            action: null,
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
        action: null,
    }));
    if (options.privacyOptionsRequired === true) {
        rows.push(Object.freeze({
            id: 'privacy' as const,
            label: catalogue.resolveText('settings.privacy'),
            valueText: catalogue.resolveText('settings.privacy.open'),
            on: null,
            tappable: true,
            patch: null,
            setting: 'privacy' as const,
            action: 'privacy_options' as const,
        }));
    }
    return Object.freeze({
        texts: Object.freeze({
            title: catalogue.resolveText('settings.title'),
            chip: catalogue.resolveText('settings.chip'),
            close: catalogue.resolveText('settings.close'),
        }),
        rows: Object.freeze(rows),
    });
}
