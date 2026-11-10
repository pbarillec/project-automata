/**
 * AUT-INFRA-001 event stream: turns logcat lines into ordered `[AUT-DEVICE]` events and
 * runtime-error records. The stream is fed either by a live `adb logcat` process or by tests.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import { parseDeviceEventLine, type ParsedDeviceEvent } from '../../assets/scripts/presentation/DeviceDiagnostics.ts';

export interface StreamRecord {
    index: number;
    line: string;
    event: ParsedDeviceEvent | null;
    runtimeError: boolean;
}

const RUNTIME_ERROR_PATTERNS: RegExp[] = [
    /Uncaught Exception/,
    /\bJS: .*\b(TypeError|ReferenceError|RangeError|SyntaxError|EvalError|URIError|Error):/,
    /FATAL EXCEPTION/,
    /Fatal signal \d+/,
];

/** True for logcat lines that report a JS exception or a native crash (not ordinary engine warnings). */
export function isRuntimeErrorLine(line: string): boolean {
    if (line.includes('[AUT-DEVICE]')) {
        const event = parseDeviceEventLine(line);
        return event?.evt === 'error';
    }
    return RUNTIME_ERROR_PATTERNS.some((pattern) => pattern.test(line));
}

export class EventStream {
    public readonly records: StreamRecord[] = [];
    private partial = '';
    private readonly listeners = new Set<() => void>();

    public get cursor(): number { return this.records.length; }

    public pushChunk(chunk: string): void {
        const text = this.partial + chunk;
        const lines = text.split(/\r?\n/);
        this.partial = lines.pop() ?? '';
        for (const line of lines) this.pushLine(line);
    }

    public pushLine(line: string): void {
        if (!line) return;
        this.records.push({ index: this.records.length, line, event: parseDeviceEventLine(line), runtimeError: isRuntimeErrorLine(line) });
        for (const listener of this.listeners) listener();
    }

    public flush(): void {
        if (this.partial) { const rest = this.partial; this.partial = ''; this.pushLine(rest); }
    }

    public eventsSince(cursor: number): ParsedDeviceEvent[] {
        return this.records.slice(cursor).flatMap((r) => (r.event ? [r.event] : []));
    }

    public recordsSince(cursor: number): StreamRecord[] { return this.records.slice(cursor); }

    public allEvents(): ParsedDeviceEvent[] { return this.eventsSince(0); }

    /** Resolves with the first matching event at or after `cursor`, or null on timeout. */
    public waitFor(predicate: (event: ParsedDeviceEvent) => boolean, cursor: number, timeoutMs: number): Promise<{ event: ParsedDeviceEvent; record: StreamRecord } | null> {
        const find = () => {
            for (let i = cursor; i < this.records.length; i += 1) {
                const record = this.records[i];
                if (record.event && predicate(record.event)) return { event: record.event, record };
            }
            return null;
        };
        const immediate = find();
        if (immediate) return Promise.resolve(immediate);
        return new Promise((resolve) => {
            const listener = () => {
                const found = find();
                if (found) { cleanup(); resolve(found); }
            };
            const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
            const cleanup = () => { clearTimeout(timer); this.listeners.delete(listener); };
            this.listeners.add(listener);
        });
    }
}

/** Live `adb logcat` stream: raw lines go to `rawPath`, parsed lines into the EventStream. */
export class LogcatProcess {
    public readonly stream = new EventStream();
    private child: ChildProcess | null = null;
    private file: WriteStream | null = null;

    public start(adbPath: string, args: string[], rawPath: string): void {
        this.file = createWriteStream(rawPath, { encoding: 'utf8' });
        this.child = spawn(adbPath, args, { windowsHide: true });
        this.child.stdout?.on('data', (chunk: Buffer) => {
            const text = chunk.toString('utf8');
            this.file?.write(text);
            this.stream.pushChunk(text);
        });
        this.child.stderr?.on('data', (chunk: Buffer) => this.file?.write(chunk.toString('utf8')));
    }

    public async stop(): Promise<void> {
        this.child?.kill();
        this.child = null;
        this.stream.flush();
        const file = this.file;
        this.file = null;
        if (file) await new Promise<void>((resolve) => file.end(() => resolve()));
    }
}
