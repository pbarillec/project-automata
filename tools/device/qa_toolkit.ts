/**
 * AUT-069 host-side QA toolkit (DEBUG APK only, run-as). `npm run device:qa -- <list | preset | command ...>`.
 *
 *   list                              the presets and what each reaches
 *   <preset>                          force-stop -> remove stale saves / debug files -> write the preset save (+ its debug scripts) -> relaunch
 *   cmd <command> [args]              keep the current save; write ONE debug_command.json command and relaunch (it runs once after the session is ready)
 *   seq "<command args>" ...          the same, several commands in order (each runs after the previous finished)
 *   ads <placement> <outcome...>      keep the save; write debug_ads.json (mock rewarded-ad outcomes) and relaunch
 *
 * Everything here is a PURE builder (unit-tested, no adb) plus a thin adb push through the existing `SessionDeviceDriver`. The payloads are the
 * files the DEBUG build already understands (`debug_command.json`, `debug_ads.json`, `debug_purchase.json`, `debug_consent.json` + a seeded save);
 * the app reads them only when `DEBUG === true` AND device diagnostics are enabled, so a release build ignores and never reads any of them.
 * Seeds reuse the existing per-task seed builders (no new state shape, no save-schema change). See docs/AUT-069_DEBUG_QA_TOOLKIT.md.
 */
import { GAME_SESSION_DEV_GAME_VERSION } from '../../assets/scripts/lifecycle/GameSessionBootstrap.ts';
import { loadGameConfigFromSources } from '../../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { CURRENT_SAVE_VERSION, createSaveTimestampUtcIsoFromUnixMilliseconds, serializeGameStateToSaveJson } from '../../assets/scripts/persistence/index.ts';
import { DEBUG_ADS_FILE, DEBUG_ADS_MAX_STEPS, DEBUG_ADS_OUTCOMES, parseDebugAdsScriptFile, type DebugAdsOutcome } from '../../assets/scripts/presentation/DebugAdsScriptFile.ts';
import { DEBUG_COMMAND_FILE, DEBUG_COMMAND_MAX_DELAY_MS, parseDebugCommand, parseDebugCommandSequenceFile, type DebugCommand, type DebugCommandRequest } from '../../assets/scripts/presentation/DebugCommandFile.ts';
import { DEBUG_CONSENT_FILE } from '../../assets/scripts/presentation/DebugConsentScriptFile.ts';
import { DEBUG_PURCHASE_FILE } from '../../assets/scripts/presentation/DebugPurchaseScriptFile.ts';
import { POPULATION_BENCHMARK_FILE } from '../../assets/scripts/presentation/RobotPopulation.ts';
import type { GameState } from '../../assets/scripts/state/index.ts';
import type { SessionDeviceDriver } from './driver.ts';
import { buildAut039SeededState } from './scenarios/aut039_first_robot.ts';
import { SAVE_FILE_NAMES } from './scenarios/int001_session_persistence.ts';
import { buildAut045SeededState } from './seed_aut045.ts';
import { buildAut049SeededState } from './seed_aut049.ts';
import { buildAut050SeededState } from './seed_aut050.ts';
import { buildAut051SeededState } from './seed_aut051.ts';
import { buildAut056SeededState } from './seed_aut056.ts';
import { buildAut059PurchaseScriptFile, buildAut059SeededState } from './seed_aut059.ts';
import { buildAut065ConsentScriptFile } from './seed_aut065.ts';
import { buildAut067SeededState } from './seed_aut067.ts';
import { buildRbt001SeededState } from './seed_rbt001.ts';

export const QA_PACKAGE_NAME = 'com.projectautomata.androidbaseline';
export const QA_ACTIVITY = 'com.cocos.game.AppActivity';

/** Every debug file the toolkit may leave in the app files dir (cleared before a preset so nothing stale leaks into the run). */
export const QA_MANAGED_FILES: readonly string[] = Object.freeze([DEBUG_COMMAND_FILE, DEBUG_ADS_FILE, DEBUG_PURCHASE_FILE, DEBUG_CONSENT_FILE, POPULATION_BENCHMARK_FILE]);

export type QaSavePlan =
    | { readonly kind: 'fresh' }
    | { readonly kind: 'keep' }
    | { readonly kind: 'seed'; readonly text: string };

export interface QaPlan {
    readonly label: string;
    readonly save: QaSavePlan;
    /** File name -> text, written to the app files dir after the save. */
    readonly files: Readonly<Record<string, string>>;
}

export interface QaPreset {
    readonly id: string;
    /** The MVP state family (for the docs table). */
    readonly family: string;
    /** What the preset reaches / what QA does next. */
    readonly reaches: string;
    readonly build: (nowMs: number) => QaPlan;
}

export class QaUsageError extends Error {}

// ---------------------------------------------------------------------------------------------------------------------------------
// Pure payload builders

/** Serializes a state as a valid current-version save whose `savedAtUtc` is `ageSeconds` before `nowMs` (the offline absence). */
export function serializeQaSave(state: GameState, nowMs: number, ageSeconds: number): string {
    return serializeGameStateToSaveJson(state, {
        saveVersion: CURRENT_SAVE_VERSION,
        gameVersion: GAME_SESSION_DEV_GAME_VERSION,
        contentVersion: loadGameConfigFromSources(getEmbeddedEconomyConfigSources()).contentVersion,
        savedAtUtc: createSaveTimestampUtcIsoFromUnixMilliseconds(Math.floor(nowMs / 1000) * 1000 - ageSeconds * 1000),
    });
}

/** The `debug_command.json` text for ordered requests; validated through the app's own parser (throws when the app would ignore it). */
export function buildQaCommandFile(requests: readonly DebugCommandRequest[]): string {
    const text = requests.length === 1
        ? JSON.stringify({ command: requests[0].command, delayMs: requests[0].delayMs })
        : JSON.stringify({ commands: requests.map((request) => ({ command: request.command, delayMs: request.delayMs })) });
    if (parseDebugCommandSequenceFile(text) === null) throw new QaUsageError('The command payload would be ignored by the app (unknown, out of range or too many commands).');
    return text;
}

export const QA_ADS_PLACEMENTS = ['offline-double', 'extended-overclock', 'both'] as const;
export type QaAdsPlacement = typeof QA_ADS_PLACEMENTS[number];

/** Friendly outcome words: success = rewarded, failure = failed. Raw DEBUG outcomes pass through. */
export function resolveQaAdsOutcome(word: string): DebugAdsOutcome {
    if (word === 'success') return 'rewarded';
    if (word === 'failure') return 'failed';
    if ((DEBUG_ADS_OUTCOMES as readonly string[]).includes(word)) return word as DebugAdsOutcome;
    throw new QaUsageError(`unknown ad outcome "${word}"; expected success, failure or one of ${DEBUG_ADS_OUTCOMES.join(', ')}`);
}

/** The `debug_ads.json` text scripting the next rewarded-ad outcomes of the mock provider; validated through the app's parser. */
export function buildQaAdsFile(placement: QaAdsPlacement, outcomes: readonly DebugAdsOutcome[], duplicateCallback = false): string {
    if (outcomes.length < 1 || outcomes.length > DEBUG_ADS_MAX_STEPS) throw new QaUsageError(`give 1 to ${DEBUG_ADS_MAX_STEPS} outcomes`);
    const script: Record<string, unknown> = {};
    if (placement === 'offline-double' || placement === 'both') script.offlineDouble = [...outcomes];
    if (placement === 'extended-overclock' || placement === 'both') script.extendedOverclock = [...outcomes];
    if (duplicateCallback) script.duplicateCallback = true;
    const text = JSON.stringify(script);
    if (parseDebugAdsScriptFile(text) === null) throw new QaUsageError('The ads payload would be ignored by the app.');
    return text;
}

/** Parses `<command> [args]` words (CLI form) into one request; strict through the app's own `parseDebugCommand`. */
export function parseQaCommandWords(words: readonly string[], delayMs = 0): DebugCommandRequest {
    const [name, ...args] = words;
    const need = (count: number, usage: string): void => { if (args.length !== count) throw new QaUsageError(`usage: ${usage}`); };
    let raw: unknown;
    switch (name) {
        case 'grant-io': need(1, 'grant-io <amount>'); raw = { type: 'grantIndustrialOutput', amount: Number(args[0]) }; break;
        case 'set-producer': need(2, 'set-producer <producerId> <level>'); raw = { type: 'setProducerLevel', producerId: args[0], level: Number(args[1]) }; break;
        case 'set-era': need(1, 'set-era <eraId>'); raw = { type: 'setEra', eraId: args[0] }; break;
        case 'set-robots': need(1, 'set-robots <amount>'); raw = { type: 'setRobotsBuilt', amount: Number(args[0]) }; break;
        case 'grant-ai-cores': need(1, 'grant-ai-cores <amount>'); raw = { type: 'grantAiCores', amount: Number(args[0]) }; break;
        case 'pending-offline': need(1, 'pending-offline <seconds>'); raw = { type: 'createPendingOffline', seconds: Number(args[0]) }; break;
        case 'reboot-preview': need(0, 'reboot-preview'); raw = { type: 'previewReboot' }; break;
        case 'founder':
            need(1, 'founder <owned|not-owned>');
            if (args[0] !== 'owned' && args[0] !== 'not-owned') throw new QaUsageError('usage: founder <owned|not-owned>');
            raw = { type: 'mockFounderOwned', owned: args[0] === 'owned' };
            break;
        case 'breakthrough': need(1, 'breakthrough <breakthroughId>'); raw = { type: 'purchaseBreakthrough', breakthroughId: args[0] }; break;
        case 'reboot': need(0, 'reboot'); raw = { type: 'rebootCivilization', confirmed: true }; break;
        default: throw new QaUsageError(`unknown command "${name ?? ''}"; expected ${QA_COMMAND_NAMES.join(' | ')}`);
    }
    const command: DebugCommand | null = parseDebugCommand(raw);
    if (command === null) throw new QaUsageError(`"${words.join(' ')}" is out of range or malformed (the app would ignore it)`);
    if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > DEBUG_COMMAND_MAX_DELAY_MS) throw new QaUsageError('delay out of range');
    return { command, delayMs };
}

export const QA_COMMAND_NAMES: readonly string[] = Object.freeze(['grant-io', 'set-producer', 'set-era', 'set-robots', 'grant-ai-cores', 'pending-offline', 'reboot-preview', 'founder', 'breakthrough', 'reboot']);

// ---------------------------------------------------------------------------------------------------------------------------------
// Presets (reuse the existing seed builders; no new state shape)

const MIN = 60;
const HOUR = 3600;
/** Seconds since the seed save was written when no offline report must show (under the 60 s card minimum). */
const FRESH_AGE_SECONDS = 5;

function seeded(label: string, state: GameState, nowMs: number, ageSeconds: number, files: Record<string, string> = {}): QaPlan {
    return { label, save: { kind: 'seed', text: serializeQaSave(state, nowMs, ageSeconds) }, files };
}

/** Sequence run after the session is ready on the `qa-patches` state (also the device scenario `aut069-qa-patches`). */
export const QA_PATCHES_SEQUENCE: readonly DebugCommandRequest[] = Object.freeze([
    { command: { type: 'grantIndustrialOutput', amount: 5000 }, delayMs: 4000 },
    { command: { type: 'setProducerLevel', producerId: 'fabricator', level: 55 }, delayMs: 800 },
    { command: { type: 'setRobotsBuilt', amount: 120 }, delayMs: 800 },
    { command: { type: 'grantAiCores', amount: 3 }, delayMs: 800 },
    { command: { type: 'mockFounderOwned', owned: true }, delayMs: 800 },
    { command: { type: 'previewReboot' }, delayMs: 1500 },
] as const);

/** The pending-offline sequence (also the device scenario `aut069-qa-offline`): a 3 h simulated absence on a state with an automated producer. */
export const QA_OFFLINE_SEQUENCE: readonly DebugCommandRequest[] = Object.freeze([
    { command: { type: 'createPendingOffline', seconds: 3 * HOUR }, delayMs: 4000 },
] as const);

/** The save of the two scenarios: `patches` = the Reboot-eligible Civilization #1 state; `offline` = the automated Fabricator + manual Assembly (no report on launch). */
export function buildQaScenarioState(kind: 'patches' | 'offline'): GameState {
    return kind === 'patches' ? buildRbt001SeededState() : buildAut051SeededState('first');
}

export function buildQaScenarioPlan(kind: 'patches' | 'offline', nowMs: number): QaPlan {
    const sequence = kind === 'patches' ? QA_PATCHES_SEQUENCE : QA_OFFLINE_SEQUENCE;
    return seeded(`qa-${kind}`, buildQaScenarioState(kind), nowMs, FRESH_AGE_SECONDS, { [DEBUG_COMMAND_FILE]: buildQaCommandFile(sequence) });
}

const PRESET_LIST: readonly QaPreset[] = [
    {
        id: 'fresh-start', family: 'start', reaches: 'A brand-new game (no save): the first Manual Produce / Next Goal flow.',
        build: () => ({ label: 'fresh-start', save: { kind: 'fresh' }, files: {} }),
    },
    {
        id: 'first-worker-bot', family: 'start', reaches: 'Output = the Worker Bot cost, Worker Bot NOT owned: tap Next Goal for the first Worker Bot reveal.',
        build: (nowMs) => seeded('first-worker-bot', buildAut039SeededState(), nowMs, FRESH_AGE_SECONDS),
    },
    {
        id: 'era-2', family: 'eras', reaches: 'Era II (Automated Factory) with the Robot Line at Lv10.',
        build: (nowMs) => seeded('era-2', buildAut045SeededState('era2'), nowMs, FRESH_AGE_SECONDS),
    },
    {
        id: 'era-3', family: 'eras', reaches: 'Era III (Robotics Complex) with the Advanced Robotics Complex at Lv10.',
        build: (nowMs) => seeded('era-3', buildAut045SeededState('era3'), nowMs, FRESH_AGE_SECONDS),
    },
    {
        id: 'era-3-worst-case', family: 'eras', reaches: 'The AUT-067 worst case: Era III, every producer Lv100, 1,000,000 robots built, Free Overclock active (no perf sampler).',
        build: (nowMs) => seeded('era-3-worst-case', buildAut067SeededState('standard', nowMs), nowMs, 1),
    },
    {
        id: 'reboot-ready', family: 'reboot', reaches: 'Civilization #1 Reboot-eligible (reward +5 AI Cores): the Reboot chip shows; tap it for the modal.',
        build: (nowMs) => seeded('reboot-ready', buildRbt001SeededState(), nowMs, FRESH_AGE_SECONDS),
    },
    {
        id: 'reboot-preview', family: 'reboot', reaches: 'The same state, and the Reboot modal opens by itself 4 s after launch (previewReboot; nothing is committed until you tap REBOOT).',
        build: (nowMs) => seeded('reboot-preview', buildRbt001SeededState(), nowMs, FRESH_AGE_SECONDS, {
            [DEBUG_COMMAND_FILE]: buildQaCommandFile([{ command: { type: 'previewReboot' }, delayMs: 4000 }]),
        }),
    },
    {
        id: 'post-reboot', family: 'reboot', reaches: 'Civilization #2 right after a Reboot: AI Cores owned, fresh run, persistent AI Core socket.',
        build: (nowMs) => seeded('post-reboot', buildAut049SeededState('post'), nowMs, FRESH_AGE_SECONDS),
    },
    {
        id: 'ai-upgrades-affordable', family: 'reboot', reaches: 'Civilization #2 with 4 AI Cores and one upgrade partly ranked: the AI Upgrades chip shows with an affordable row.',
        build: (nowMs) => seeded('ai-upgrades-affordable', buildAut050SeededState('mixed'), nowMs, FRESH_AGE_SECONDS),
    },
    {
        id: 'offline-short', family: 'offline', reaches: 'A 20 min absence: the Offline Factory Report card shows, the rewarded x2 is NOT offered (below the 30 min minimum).',
        build: (nowMs) => seeded('offline-short', buildAut051SeededState('first'), nowMs, 20 * MIN),
    },
    {
        id: 'offline-long', family: 'offline', reaches: 'A 3 h absence: the Offline Factory Report card with the educational line (a producer left manual).',
        build: (nowMs) => seeded('offline-long', buildAut051SeededState('first'), nowMs, 3 * HOUR),
    },
    {
        id: 'offline-cap', family: 'offline', reaches: 'A 10 h absence: the offline limit (8 h) is applied and shown.',
        build: (nowMs) => seeded('offline-cap', buildAut051SeededState('first'), nowMs, 10 * HOUR),
    },
    {
        id: 'offline-double-eligible', family: 'offline', reaches: 'A 3 h absence + a mock ad script (rewarded): the COLLECT x2 action shows and pays exactly 2x.',
        build: (nowMs) => seeded('offline-double-eligible', buildAut051SeededState('first'), nowMs, 3 * HOUR, { [DEBUG_ADS_FILE]: buildQaAdsFile('offline-double', ['rewarded']) }),
    },
    {
        id: 'extended-overclock-eligible', family: 'rewarded', reaches: 'Free Overclock unlocked, no recent claims, mock ad script (rewarded): the Extended Overclock chip shows.',
        build: (nowMs) => seeded('extended-overclock-eligible', buildAut056SeededState('eligible', nowMs), nowMs, 1, { [DEBUG_ADS_FILE]: buildQaAdsFile('extended-overclock', ['rewarded']) }),
    },
    {
        id: 'founder-available', family: 'founder', reaches: 'Founder pack NOT owned, mock store with a test price, scripted completed purchase: tap the chip, BUY, owned once with 2 Surges.',
        build: (nowMs) => seeded('founder-available', buildAut059SeededState('available', nowMs), nowMs, 1, { [DEBUG_PURCHASE_FILE]: buildAut059PurchaseScriptFile({ outcomes: ['completed'] }) }),
    },
    {
        id: 'founder-owned', family: 'founder', reaches: 'Founder pack owned (a real grant: entitlement, cosmetic, 2 Surge charges): chip reads Owned, Founder robot variant.',
        build: (nowMs) => seeded('founder-owned', buildAut059SeededState('owned', nowMs), nowMs, 1, { [DEBUG_PURCHASE_FILE]: buildAut059PurchaseScriptFile({ outcomes: [] }) }),
    },
    {
        id: 'purchase-pending', family: 'founder', reaches: 'Founder not owned, mock store scripted PENDING: tap the chip, BUY, the shop shows the pending state and grants nothing.',
        build: (nowMs) => seeded('purchase-pending', buildAut059SeededState('available', nowMs), nowMs, 1, { [DEBUG_PURCHASE_FILE]: buildAut059PurchaseScriptFile({ outcomes: ['pending'] }) }),
    },
    {
        id: 'consent-required', family: 'consent', reaches: 'A 3 h absence card + mock consent state "required_obtained": the consent flow runs and ads become allowed (x2 offered only then).',
        build: (nowMs) => seeded('consent-required', buildAut051SeededState('first'), nowMs, 3 * HOUR, { [DEBUG_CONSENT_FILE]: buildAut065ConsentScriptFile('required_obtained'), [DEBUG_ADS_FILE]: buildQaAdsFile('offline-double', ['rewarded']) }),
    },
    {
        id: 'consent-declined', family: 'consent', reaches: 'The same with consent "required_declined": ads stay fail-closed (no x2), gameplay unaffected.',
        build: (nowMs) => seeded('consent-declined', buildAut051SeededState('first'), nowMs, 3 * HOUR, { [DEBUG_CONSENT_FILE]: buildAut065ConsentScriptFile('required_declined'), [DEBUG_ADS_FILE]: buildQaAdsFile('offline-double', ['rewarded']) }),
    },
    {
        id: 'qa-patches', family: 'toolkit', reaches: 'The Reboot-eligible state + a 6-command debug sequence (grant IO, producer level, Robots Built, AI Cores, Founder owned, Reboot preview).',
        build: (nowMs) => buildQaScenarioPlan('patches', nowMs),
    },
    {
        id: 'qa-offline', family: 'toolkit', reaches: 'An automated-producer state with no report on launch + a debug command that simulates a 3 h absence mid-session.',
        build: (nowMs) => buildQaScenarioPlan('offline', nowMs),
    },
];

export const QA_PRESETS: Readonly<Record<string, QaPreset>> = Object.freeze(Object.fromEntries(PRESET_LIST.map((preset) => [preset.id, preset])));

export function resolveQaPreset(id: string | undefined): QaPreset | null {
    return id !== undefined && Object.prototype.hasOwnProperty.call(QA_PRESETS, id) ? QA_PRESETS[id] : null;
}

/** The `list` output: presets grouped by family with what each reaches, then the commands. */
export function renderQaList(): string {
    const lines: string[] = ['Presets (npm run device:qa -- <preset>):'];
    for (const preset of PRESET_LIST) lines.push(`  ${preset.id.padEnd(30)} [${preset.family}] ${preset.reaches}`);
    lines.push('', 'Commands (keep the current save, run once after the session is ready; DEBUG APK only):',
        '  cmd grant-io <amount>               add Industrial Output (1 .. 1e15)',
        '  cmd set-producer <id> <level>       producer level 0 .. 1000 (>= 1 = unlocked + built)',
        '  cmd set-era <eraId>                 forward-only (manual_workshop | automated_factory | robotics_complex)',
        '  cmd set-robots <amount>             Robots Built 0 .. 1e9',
        '  cmd grant-ai-cores <amount>         AI Cores 1 .. 1000',
        '  cmd pending-offline <seconds>       simulate an absence (1 .. 1209600): shows the Offline Factory Report card',
        '  cmd reboot-preview                  open the Reboot modal (nothing committed)',
        '  cmd founder <owned|not-owned>       owned = real grant path (source mock); not-owned = a not-owned report (never revokes; use the founder-available preset to reset)',
        '  cmd breakthrough <id> | cmd reboot  the normal commands, tagged debug',
        '  seq "<cmd args>" "<cmd args>" ...   up to 8 commands in order, e.g. seq "grant-io 5000" "set-era automated_factory"',
        `  ads <${QA_ADS_PLACEMENTS.join('|')}> <success|failure|${DEBUG_ADS_OUTCOMES.join('|')}>...   mock rewarded-ad outcomes for the next launch`);
    return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// CLI parsing + adb push

export type QaInvocation =
    | { readonly kind: 'list' }
    | { readonly kind: 'plan'; readonly plan: (nowMs: number) => QaPlan; readonly description: string };

/** Parses `device:qa` arguments (without the flags `--serial` handled by the caller). Throws `QaUsageError` for any bad input. */
export function parseQaInvocation(words: readonly string[]): QaInvocation {
    const [head, ...rest] = words;
    if (head === undefined || head === 'list' || head === 'help') return { kind: 'list' };
    if (head === 'cmd') {
        const request = parseQaCommandWords(rest);
        return { kind: 'plan', description: `command ${rest.join(' ')}`, plan: () => ({ label: `cmd-${request.command.type}`, save: { kind: 'keep' }, files: { [DEBUG_COMMAND_FILE]: buildQaCommandFile([request]) } }) };
    }
    if (head === 'seq') {
        if (rest.length < 1) throw new QaUsageError('usage: seq "<command args>" ...');
        const requests = rest.map((item) => parseQaCommandWords(item.trim().split(/\s+/)));
        // The first command waits for the world to settle; later ones follow 800 ms apart (each runs after the previous finished).
        const timed = requests.map((request, index) => ({ ...request, delayMs: index === 0 ? 3000 : 800 }));
        return { kind: 'plan', description: `sequence of ${timed.length}`, plan: () => ({ label: 'seq', save: { kind: 'keep' }, files: { [DEBUG_COMMAND_FILE]: buildQaCommandFile(timed) } }) };
    }
    if (head === 'ads') {
        const [placement, ...outcomeWords] = rest;
        if (!(QA_ADS_PLACEMENTS as readonly string[]).includes(placement ?? '')) throw new QaUsageError(`usage: ads <${QA_ADS_PLACEMENTS.join('|')}> <outcome...>`);
        const outcomes = outcomeWords.map(resolveQaAdsOutcome);
        const file = buildQaAdsFile(placement as QaAdsPlacement, outcomes);
        return { kind: 'plan', description: `ads ${placement} ${outcomeWords.join(' ')}`, plan: () => ({ label: 'ads', save: { kind: 'keep' }, files: { [DEBUG_ADS_FILE]: file } }) };
    }
    const preset = resolveQaPreset(head);
    if (preset === null) throw new QaUsageError(`unknown preset or command "${head}"; run: npm run device:qa -- list`);
    if (rest.length > 0) throw new QaUsageError(`a preset takes no arguments (got "${rest.join(' ')}")`);
    return { kind: 'plan', description: `preset ${preset.id}`, plan: (nowMs) => preset.build(nowMs) };
}

/** Pushes a plan through the existing driver: force-stop, clear stale files, write the save + files, relaunch. Returns the files dir. */
export async function applyQaPlan(driver: SessionDeviceDriver, plan: QaPlan, packageName: string = QA_PACKAGE_NAME, activity: string = QA_ACTIVITY): Promise<string> {
    await driver.forceStop(packageName);
    const filesDir = `${await driver.appDataDirectory(packageName)}/files/`;
    const stale = plan.save.kind === 'keep' ? [DEBUG_COMMAND_FILE, ...Object.keys(plan.files)] : [...SAVE_FILE_NAMES, ...QA_MANAGED_FILES];
    await driver.removeAppFiles(packageName, [...new Set(stale)].map((name) => `${filesDir}${name}`));
    if (plan.save.kind === 'seed') await driver.writeAppFile(packageName, `${filesDir}save_main.json`, plan.save.text);
    for (const [name, text] of Object.entries(plan.files)) await driver.writeAppFile(packageName, `${filesDir}${name}`, text);
    await driver.launch(packageName, activity);
    return filesDir;
}
