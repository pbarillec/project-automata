/**
 * AUT-072 standard logging facade (engine-free).
 *
 * One tiny category/level facade over an injected sink. It is the ONLY place in `assets/scripts`
 * that may call `console.*` (a source-scan test enforces it).
 *
 * Release log policy: a RELEASE build logs only `warn` / `error`; a DEBUG build logs everything.
 * Every line is sanitized (tokens, receipts, ids, prices, emails) before it reaches the sink.
 * The message text is passed through VERBATIM otherwise: pinned prefixes such as `[AUT-071]`
 * stay at the start of the line so tests, tools and device captures can keep grepping them.
 */
export const LOG_CATEGORIES = ['game', 'build', 'save', 'time', 'economy', 'ads', 'purchase', 'consent', 'analytics', 'presentation', 'perf', 'debug'] as const;
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type LogCategory = typeof LOG_CATEGORIES[number];
export type LogLevel = typeof LOG_LEVELS[number];
export type LogBuildType = 'DEBUG' | 'RELEASE';

export interface LogEntry {
    readonly level: LogLevel;
    readonly category: LogCategory;
    /** Already sanitized. */
    readonly message: string;
}
export type LogSink = (entry: LogEntry) => void;

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

/** The production log-reduction policy: DEBUG logs everything, RELEASE only warn and error. */
export function minimumLogLevel(buildType: LogBuildType): LogLevel {
    return buildType === 'DEBUG' ? 'debug' : 'warn';
}

export function isLogLevelEnabled(buildType: LogBuildType, level: LogLevel): boolean {
    return LEVEL_RANK[level] >= LEVEL_RANK[minimumLogLevel(buildType)];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REDACTED = '[redacted]';

/**
 * Removes anything that must never reach a log: bearer tokens, `token=` / `receipt=` / `playerId=` /
 * `price=` style fields, e-mail addresses, currency amounts and long opaque (token-like) runs.
 * Asset UUIDs, short identifiers and ordinary prose are untouched.
 */
export function sanitizeLogMessage(message: string): string {
    return String(message)
        .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`)
        .replace(/\b(purchase[_-]?token|access[_-]?token|id[_-]?token|token|receipt|signature|order[_-]?id|transaction[_-]?id|player[_-]?id|user[_-]?id|device[_-]?id|advertising[_-]?id|aaid|idfa|email|price|api[_-]?key|secret|password)\b(["']?\s*[:=]\s*)(["']?)[^\s,;"'}\])]+/gi, `$1$2$3${REDACTED}`)
        .replace(/[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, REDACTED)
        .replace(/[$€£]\s?\d+(?:[.,]\d+)?|\b\d+(?:[.,]\d+)?\s?(?:USD|EUR|GBP|CAD|JPY)\b/g, '[price]')
        .replace(/[A-Za-z0-9_-]{32,}/g, (run) => (UUID_PATTERN.test(run) ? run : REDACTED));
}

/** The default sink: the platform console (logcat on Android). The one sanctioned `console.*` site. */
export const consoleLogSink: LogSink = (entry) => {
    if (entry.level === 'error') console.error(entry.message);
    else if (entry.level === 'warn') console.warn(entry.message);
    else console.log(entry.message);
};

export interface Logger {
    readonly buildType: LogBuildType;
    isEnabled(level: LogLevel): boolean;
    log(level: LogLevel, category: LogCategory, message: string): void;
    debug(category: LogCategory, message: string): void;
    info(category: LogCategory, message: string): void;
    warn(category: LogCategory, message: string): void;
    error(category: LogCategory, message: string): void;
    /**
     * Writes a pre-formatted structured line (the DEBUG-only `[AUT-DEVICE]` JSON diagnostics) with no level filter and
     * no sanitization. Callers must already be DEBUG-gated (`emitDeviceEvent` is a no-op unless enabled from DEBUG).
     */
    rawLine(line: string): void;
}

export function createLogger(options: { buildType: LogBuildType; sink?: LogSink }): Logger {
    const buildType = options.buildType;
    const sink = options.sink ?? consoleLogSink;
    const log = (level: LogLevel, category: LogCategory, message: string): void => {
        if (!isLogLevelEnabled(buildType, level)) return;
        try {
            sink({ level, category, message: sanitizeLogMessage(message) });
        } catch {
            // Logging must never affect the caller.
        }
    };
    return {
        buildType,
        isEnabled: (level) => isLogLevelEnabled(buildType, level),
        log,
        debug: (category, message) => log('debug', category, message),
        info: (category, message) => log('info', category, message),
        warn: (category, message) => log('warn', category, message),
        error: (category, message) => log('error', category, message),
        rawLine: (line) => {
            try {
                sink({ level: 'debug', category: 'debug', message: line });
            } catch {
                // Logging must never affect the caller.
            }
        },
    };
}

/**
 * The process-wide logger. Until `configureLog` runs it follows the RELEASE policy (warn / error only), so an
 * unconfigured scene can never be noisier than a shipped build. FactoryWorldBootstrap configures it from `DEBUG`.
 */
let current: Logger = createLogger({ buildType: 'RELEASE' });

export function configureLog(options: { buildType: LogBuildType; sink?: LogSink }): Logger {
    current = createLogger(options);
    return current;
}

export const Log: Logger = {
    get buildType() { return current.buildType; },
    isEnabled: (level) => current.isEnabled(level),
    log: (level, category, message) => current.log(level, category, message),
    debug: (category, message) => current.debug(category, message),
    info: (category, message) => current.info(category, message),
    warn: (category, message) => current.warn(category, message),
    error: (category, message) => current.error(category, message),
    rawLine: (line) => current.rawLine(line),
};
