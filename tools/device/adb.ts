/**
 * AUT-INFRA-001 ADB driver (Node 24, engine-free).
 *
 * Every call goes through an injectable executor with a timeout so the tooling is testable
 * without a phone and can never hang a Factory run.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface AdbExecOptions { timeoutMs: number; binary?: boolean }
export interface AdbExecResult { code: number | null; stdout: Buffer; stderr: string; timedOut: boolean; durationMs: number }
export type AdbExecutor = (args: string[], options: AdbExecOptions) => Promise<AdbExecResult>;

export const DEFAULT_TIMEOUT_MS = 15_000;
export const INSTALL_TIMEOUT_MS = 180_000;

export class AdbError extends Error {
    public readonly kind: 'timeout' | 'command' | 'missing_binary';
    public readonly args: string[];
    public readonly detail: string;
    public constructor(kind: 'timeout' | 'command' | 'missing_binary', args: string[], detail: string) {
        super(`adb ${args.join(' ')} failed (${kind}): ${detail}`);
        this.kind = kind;
        this.args = args;
        this.detail = detail;
    }
}

/** Resolves adb: ADB_PATH, then the Android SDK under LOCALAPPDATA/ANDROID_HOME, then PATH. */
export function resolveAdbPath(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): string {
    const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
    const candidates = [
        env.ADB_PATH,
        env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', exe) : undefined,
        env.ANDROID_HOME ? path.join(env.ANDROID_HOME, 'platform-tools', exe) : undefined,
        env.ANDROID_SDK_ROOT ? path.join(env.ANDROID_SDK_ROOT, 'platform-tools', exe) : undefined,
    ].filter((p): p is string => typeof p === 'string' && p.length > 0);
    for (const candidate of candidates) if (exists(candidate)) return candidate;
    return exe; // fall back to PATH; a missing binary surfaces as AdbError('missing_binary').
}

export function createProcessExecutor(adbPath: string): AdbExecutor {
    return (args, options) => new Promise((resolve) => {
        const started = Date.now();
        const stdout: Buffer[] = [];
        let stderr = '';
        let timedOut = false;
        let settled = false;
        const child = spawn(adbPath, args, { windowsHide: true });
        const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs);
        child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
        const finish = (code: number | null, extraErr = '') => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ code, stdout: Buffer.concat(stdout), stderr: stderr + extraErr, timedOut, durationMs: Date.now() - started });
        };
        child.on('error', (error: NodeJS.ErrnoException) => finish(error.code === 'ENOENT' ? 127 : -1, String(error.message)));
        child.on('close', (code) => finish(code));
    });
}

export type DeviceState = 'device' | 'unauthorized' | 'offline' | 'no permissions' | string;
export interface AdbDevice { serial: string; state: DeviceState; model?: string; product?: string; device?: string; transportId?: string }

export function parseAdbDevices(output: string): AdbDevice[] {
    const devices: AdbDevice[] = [];
    for (const rawLine of output.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('List of devices') || line.startsWith('*')) continue;
        const match = /^(\S+)\s+(no permissions|\S+)(.*)$/.exec(line);
        if (!match) continue;
        const device: AdbDevice = { serial: match[1], state: match[2] };
        for (const token of match[3].trim().split(/\s+/)) {
            const [key, value] = token.split(':');
            if (!value) continue;
            if (key === 'model') device.model = value;
            else if (key === 'product') device.product = value;
            else if (key === 'device') device.device = value;
            else if (key === 'transport_id') device.transportId = value;
        }
        devices.push(device);
    }
    return devices;
}

export const CONNECT_DEVICE_ACTION = 'connect and authorize the Android device';

export type DeviceSelection =
    | { ok: true; device: AdbDevice }
    | { ok: false; reason: 'no_device' | 'unauthorized' | 'offline' | 'serial_not_found' | 'multiple_devices'; detail: string; requiredHumanAction: string };

/** Explicit selection: a requested serial must be ready; without one, exactly one ready device is required. */
export function selectDevice(devices: AdbDevice[], serial?: string): DeviceSelection {
    if (serial) {
        const match = devices.find((d) => d.serial === serial);
        if (!match) return { ok: false, reason: 'serial_not_found', detail: `device ${serial} not attached (${devices.length} attached)`, requiredHumanAction: CONNECT_DEVICE_ACTION };
        if (match.state !== 'device') return { ok: false, reason: match.state === 'unauthorized' ? 'unauthorized' : 'offline', detail: `device ${serial} is ${match.state}`, requiredHumanAction: CONNECT_DEVICE_ACTION };
        return { ok: true, device: match };
    }
    const ready = devices.filter((d) => d.state === 'device');
    if (ready.length === 1) return { ok: true, device: ready[0] };
    if (ready.length > 1) return { ok: false, reason: 'multiple_devices', detail: `${ready.length} devices ready (${ready.map((d) => d.serial).join(', ')}); pass --serial`, requiredHumanAction: 'select the target device with --serial' };
    if (devices.some((d) => d.state === 'unauthorized')) return { ok: false, reason: 'unauthorized', detail: 'device attached but USB debugging is not authorized', requiredHumanAction: CONNECT_DEVICE_ACTION };
    if (devices.length > 0) return { ok: false, reason: 'offline', detail: `device(s) not ready: ${devices.map((d) => `${d.serial}=${d.state}`).join(', ')}`, requiredHumanAction: CONNECT_DEVICE_ACTION };
    return { ok: false, reason: 'no_device', detail: 'no Android device attached', requiredHumanAction: CONNECT_DEVICE_ACTION };
}

/** Reads width/height from a PNG header (screencap output) so taps use the current orientation. */
export function pngSize(png: Buffer): { width: number; height: number } | null {
    if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47) return null;
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export interface AdbCommandLogEntry { args: string[]; code: number | null; timedOut: boolean; durationMs: number }

export class AdbClient {
    private readonly exec: AdbExecutor;
    public serial: string | null;
    public readonly commandLog: AdbCommandLogEntry[] = [];

    public constructor(exec: AdbExecutor, serial: string | null = null) {
        this.exec = exec;
        this.serial = serial;
    }

    private withSerial(args: string[]): string[] {
        return this.serial ? ['-s', this.serial, ...args] : args;
    }

    /** Runs adb and throws AdbError on timeout, missing binary or non-zero exit. */
    public async run(args: string[], options: Partial<AdbExecOptions> = {}): Promise<AdbExecResult> {
        const fullArgs = this.withSerial(args);
        const result = await this.exec(fullArgs, { timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, binary: options.binary });
        this.commandLog.push({ args: fullArgs, code: result.code, timedOut: result.timedOut, durationMs: result.durationMs });
        if (result.timedOut) throw new AdbError('timeout', fullArgs, `no result after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms`);
        if (result.code === 127) throw new AdbError('missing_binary', fullArgs, result.stderr.trim() || 'adb not found');
        if (result.code !== 0) throw new AdbError('command', fullArgs, (result.stderr || result.stdout.toString('utf8')).trim().slice(0, 500));
        return result;
    }

    public async shell(command: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
        return (await this.run(['shell', ...command], { timeoutMs })).stdout.toString('utf8');
    }

    public async devices(): Promise<AdbDevice[]> {
        const result = await this.exec(['devices', '-l'], { timeoutMs: DEFAULT_TIMEOUT_MS });
        this.commandLog.push({ args: ['devices', '-l'], code: result.code, timedOut: result.timedOut, durationMs: result.durationMs });
        if (result.timedOut) throw new AdbError('timeout', ['devices', '-l'], 'adb devices timed out');
        if (result.code === 127) throw new AdbError('missing_binary', ['devices', '-l'], result.stderr.trim() || 'adb not found');
        if (result.code !== 0) throw new AdbError('command', ['devices', '-l'], result.stderr.trim());
        return parseAdbDevices(result.stdout.toString('utf8'));
    }

    public async getProp(name: string): Promise<string> { return (await this.shell(['getprop', name])).trim(); }

    public async install(apkPath: string): Promise<string> {
        const out = (await this.run(['install', '-r', apkPath], { timeoutMs: INSTALL_TIMEOUT_MS })).stdout.toString('utf8');
        if (!/Success/.test(out)) throw new AdbError('command', ['install', '-r', apkPath], out.trim().slice(0, 500));
        return out;
    }

    public async forceStop(pkg: string): Promise<void> { await this.shell(['am', 'force-stop', pkg]); }

    public async launch(pkg: string, activity: string): Promise<string> {
        return this.shell(['am', 'start', '-W', '-n', `${pkg}/${activity}`], 60_000);
    }

    public async pidOf(pkg: string): Promise<number | null> {
        const result = await this.exec(this.withSerial(['shell', 'pidof', pkg]), { timeoutMs: DEFAULT_TIMEOUT_MS });
        const pid = Number.parseInt(result.stdout.toString('utf8').trim().split(/\s+/)[0] ?? '', 10);
        return Number.isFinite(pid) ? pid : null;
    }

    public async tap(x: number, y: number): Promise<void> {
        await this.shell(['input', 'tap', String(Math.round(x)), String(Math.round(y))]);
    }

    public async swipe(x1: number, y1: number, x2: number, y2: number, durationMs: number): Promise<void> {
        await this.shell(['input', 'swipe', ...[x1, y1, x2, y2, durationMs].map((v) => String(Math.round(v)))]);
    }

    public async screencap(): Promise<Buffer> {
        const png = (await this.run(['exec-out', 'screencap', '-p'], { timeoutMs: 30_000, binary: true })).stdout;
        if (!pngSize(png)) throw new AdbError('command', ['exec-out', 'screencap', '-p'], 'screencap did not return a PNG');
        return png;
    }

    public async logcatClear(): Promise<void> { await this.run(['logcat', '-c']); }

    public async meminfo(pkg: string): Promise<string> { return this.shell(['dumpsys', 'meminfo', pkg], 30_000); }

    public async gfxinfo(pkg: string): Promise<string> { return this.shell(['dumpsys', 'gfxinfo', pkg], 30_000); }

    /** Logcat arguments for the harness stream: Cocos JS output plus crash reports only. */
    public logcatStreamArgs(): string[] {
        return this.withSerial(['logcat', '-v', 'threadtime', '-s', 'Cocos:V', 'AndroidRuntime:E', 'DEBUG:F']);
    }
}
