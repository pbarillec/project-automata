/**
 * AUT-048 follow-up: DEBUG / capture-only command file (pure, engine-free). The Cocos side (FactoryWorldBootstrap) reads
 * `debug_command.json` from the app files dir ONCE after the session is ready, only when `DEBUG === true` AND device diagnostics are
 * enabled, deletes it, and submits the parsed command through the SAME command path the HUD / panel use (`binding.submit`). It adds no
 * gameplay path, no state write and no player-facing control; release builds never read the file.
 *
 *   { "command": { "type": "purchaseBreakthrough", "breakthroughId": "advanced_robotics" }, "delayMs": 6000 }
 *
 * Only an allow-listed command shape is accepted, anything else is ignored (never executed).
 */
export const DEBUG_COMMAND_FILE = 'debug_command.json';
export const DEBUG_COMMAND_MAX_DELAY_MS = 30000;

export interface DebugCommandRequest {
    readonly command: { readonly type: 'purchaseBreakthrough'; readonly breakthroughId: string };
    readonly delayMs: number;
}

export function parseDebugCommandFile(text: string | undefined): DebugCommandRequest | null {
    if (text === undefined) return null;
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return null; }
    if (typeof raw !== 'object' || raw === null) return null;
    const { command, delayMs } = raw as { command?: unknown; delayMs?: unknown };
    if (typeof command !== 'object' || command === null) return null;
    const { type, breakthroughId } = command as { type?: unknown; breakthroughId?: unknown };
    if (type !== 'purchaseBreakthrough' || typeof breakthroughId !== 'string' || !/^[a-z0-9_]{1,64}$/.test(breakthroughId)) return null;
    const delay = typeof delayMs === 'number' && Number.isFinite(delayMs) ? Math.min(DEBUG_COMMAND_MAX_DELAY_MS, Math.max(0, delayMs)) : 0;
    return { command: { type, breakthroughId }, delayMs: delay };
}
