/**
 * AUT-048 follow-up: DEBUG / capture-only command file (pure, engine-free). The Cocos side (FactoryWorldBootstrap) reads
 * `debug_command.json` from the app files dir ONCE after the session is ready, only when `DEBUG === true` AND device diagnostics are
 * enabled, deletes it, and runs the parsed commands through the DEBUG executor (`DebugCommandExecutor`). It adds no player-facing control;
 * release builds never read the file.
 *
 *   { "command": { "type": "purchaseBreakthrough", "breakthroughId": "advanced_robotics" }, "delayMs": 6000 }
 *   { "command": { "type": "rebootCivilization", "confirmed": true }, "delayMs": 6000 }     (AUT-049, capture-only Reboot trigger)
 *
 * AUT-069 (QA toolkit) extends the allow-list; every new shape is STRICT (exact keys, finite / integer / bounded values):
 *   { "type": "grantIndustrialOutput", "amount": 5000 }            DEBUG state patch (balance only)
 *   { "type": "setProducerLevel", "producerId": "fabricator", "level": 25 }
 *   { "type": "setEra", "eraId": "automated_factory" }             forward-only, through the normal era rule
 *   { "type": "setRobotsBuilt", "amount": 100 }
 *   { "type": "grantAiCores", "amount": 5 }
 *   { "type": "createPendingOffline", "seconds": 10800 }           simulated absence -> the Offline Factory Report card
 *   { "type": "previewReboot" }                                    opens the Reboot modal, commits nothing
 *   { "type": "mockFounderOwned", "owned": true }                  real Founder grant path (source mock); false = a "not owned" store report (never revokes)
 * and a sequence form (at most DEBUG_COMMAND_MAX_SEQUENCE commands, run in order, each `delayMs` after the previous one finished):
 *   { "commands": [ { "command": { ... }, "delayMs": 1000 }, ... ] }
 *
 * Only an allow-listed command shape is accepted, anything else (including ONE bad item of a sequence) is ignored: nothing is executed.
 * `rebootCivilization` additionally requires the literal `confirmed: true`; there is no player-facing Reboot trigger or confirmation UI.
 */
import { DEBUG_LIMITS, parseDebugStatePatch, type DebugStatePatch } from '../runtime/DebugStatePatch.ts';

export const DEBUG_COMMAND_FILE = 'debug_command.json';
export const DEBUG_COMMAND_MAX_DELAY_MS = 30000;
export const DEBUG_COMMAND_MAX_SEQUENCE = 8;
export const DEBUG_COMMAND_MAX_TOTAL_DELAY_MS = 60000;

export type DebugCommand =
    | { readonly type: 'purchaseBreakthrough'; readonly breakthroughId: string }
    | { readonly type: 'rebootCivilization'; readonly confirmed: true }
    | DebugStatePatch
    | { readonly type: 'createPendingOffline'; readonly seconds: number }
    | { readonly type: 'previewReboot' }
    | { readonly type: 'mockFounderOwned'; readonly owned: boolean };

export type DebugCommandType = DebugCommand['type'];

/** Every accepted `type` (the allow-list, used by the host CLI and the tests). */
export const DEBUG_COMMAND_TYPES: readonly DebugCommandType[] = Object.freeze([
    'purchaseBreakthrough', 'rebootCivilization', 'grantIndustrialOutput', 'setProducerLevel', 'setEra', 'setRobotsBuilt', 'grantAiCores',
    'createPendingOffline', 'previewReboot', 'mockFounderOwned',
]);

export interface DebugCommandRequest {
    readonly command: DebugCommand;
    readonly delayMs: number;
}

function parseDelay(delayMs: unknown): number {
    return typeof delayMs === 'number' && Number.isFinite(delayMs) ? Math.min(DEBUG_COMMAND_MAX_DELAY_MS, Math.max(0, delayMs)) : 0;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const actual = Object.keys(value);
    return actual.length === keys.length && keys.every((key) => key in value);
}

/** Parses ONE command object (null = not allow-listed / out of range). The two legacy commands stay lenient about extra keys. */
export function parseDebugCommand(command: unknown): DebugCommand | null {
    if (typeof command !== 'object' || command === null || Array.isArray(command)) return null;
    const { type, breakthroughId, confirmed } = command as { type?: unknown; breakthroughId?: unknown; confirmed?: unknown };
    if (type === 'purchaseBreakthrough') return typeof breakthroughId === 'string' && /^[a-z0-9_]{1,64}$/.test(breakthroughId) ? { type, breakthroughId } : null;
    if (type === 'rebootCivilization') return confirmed === true ? { type, confirmed: true } : null;
    const record = command as Record<string, unknown>;
    if (type === 'createPendingOffline') {
        const { seconds } = record;
        return hasExactKeys(record, ['type', 'seconds']) && typeof seconds === 'number' && Number.isInteger(seconds)
            && seconds >= DEBUG_LIMITS.minOfflineSeconds && seconds <= DEBUG_LIMITS.maxOfflineSeconds
            ? { type, seconds } : null;
    }
    if (type === 'previewReboot') return hasExactKeys(record, ['type']) ? { type } : null;
    if (type === 'mockFounderOwned') return hasExactKeys(record, ['type', 'owned']) && typeof record.owned === 'boolean' ? { type, owned: record.owned } : null;
    return parseDebugStatePatch(command);
}

function parseRequest(raw: unknown): DebugCommandRequest | null {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const { command, delayMs } = raw as { command?: unknown; delayMs?: unknown };
    const parsed = parseDebugCommand(command);
    return parsed === null ? null : { command: parsed, delayMs: parseDelay(delayMs) };
}

export function parseDebugCommandFile(text: string | undefined): DebugCommandRequest | null {
    if (text === undefined) return null;
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return null; }
    return parseRequest(raw);
}

/**
 * AUT-069: the single form OR the `{ "commands": [...] }` sequence form -> the ordered requests (null = nothing is executed).
 * A sequence is all-or-nothing: one invalid item, more than DEBUG_COMMAND_MAX_SEQUENCE items or a total delay above
 * DEBUG_COMMAND_MAX_TOTAL_DELAY_MS rejects the whole file.
 */
export function parseDebugCommandSequenceFile(text: string | undefined): readonly DebugCommandRequest[] | null {
    if (text === undefined) return null;
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return null; }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const { commands } = raw as { commands?: unknown };
    if (commands === undefined) {
        const single = parseRequest(raw);
        return single === null ? null : Object.freeze([single]);
    }
    if (!Array.isArray(commands) || commands.length < 1 || commands.length > DEBUG_COMMAND_MAX_SEQUENCE) return null;
    const requests: DebugCommandRequest[] = [];
    let total = 0;
    for (const item of commands) {
        const request = parseRequest(item);
        if (request === null) return null;
        total += request.delayMs;
        requests.push(request);
    }
    return total <= DEBUG_COMMAND_MAX_TOTAL_DELAY_MS ? Object.freeze(requests) : null;
}
