/**
 * AUT-INFRA-001 device driver boundary used by scenarios. The real implementation wraps
 * AdbClient + a live logcat process; tests provide a simulated device.
 */
import { AdbClient, createProcessExecutor, resolveAdbPath, type AdbCommandLogEntry, type AdbDevice } from './adb.ts';
import { EventStream, LogcatProcess } from './events.ts';

export interface DeviceDriver {
    devices(): Promise<AdbDevice[]>;
    useSerial(serial: string): void;
    getProp(name: string): Promise<string>;
    install(apkPath: string): Promise<void>;
    forceStop(pkg: string): Promise<void>;
    launch(pkg: string, activity: string): Promise<void>;
    pidOf(pkg: string): Promise<number | null>;
    tap(x: number, y: number): Promise<void>;
    swipe(x1: number, y1: number, x2: number, y2: number, durationMs: number): Promise<void>;
    screencap(): Promise<Buffer>;
    logcatClear(): Promise<void>;
    startLogcat(rawPath: string): EventStream;
    stopLogcat(): Promise<void>;
    meminfo(pkg: string): Promise<string>;
    gfxinfo(pkg: string): Promise<string>;
    commandLog(): AdbCommandLogEntry[];
}

/** AUT-INT-001: app lifecycle and private-storage operations used by the session persistence scenario. */
export interface SessionDeviceDriver extends DeviceDriver {
    pressHome(): Promise<void>;
    clearAppData(pkg: string): Promise<void>;
    appDataDirectory(pkg: string): Promise<string>;
    listAppFiles(pkg: string, directory: string): Promise<string[]>;
    writeAppFile(pkg: string, devicePath: string, text: string): Promise<void>;
    removeAppFiles(pkg: string, devicePaths: string[]): Promise<void>;
}

export class AdbDeviceDriver implements SessionDeviceDriver {
    private readonly adbPath: string;
    private readonly client: AdbClient;
    private logcat: LogcatProcess | null = null;

    public constructor(adbPath: string = resolveAdbPath()) {
        this.adbPath = adbPath;
        this.client = new AdbClient(createProcessExecutor(adbPath));
    }

    public devices() { return this.client.devices(); }
    public useSerial(serial: string) { this.client.serial = serial; }
    public getProp(name: string) { return this.client.getProp(name); }
    public async install(apkPath: string) { await this.client.install(apkPath); }
    public forceStop(pkg: string) { return this.client.forceStop(pkg); }
    public async launch(pkg: string, activity: string) { await this.client.launch(pkg, activity); }
    public pidOf(pkg: string) { return this.client.pidOf(pkg); }
    public tap(x: number, y: number) { return this.client.tap(x, y); }
    public swipe(x1: number, y1: number, x2: number, y2: number, durationMs: number) { return this.client.swipe(x1, y1, x2, y2, durationMs); }
    public screencap() { return this.client.screencap(); }
    public logcatClear() { return this.client.logcatClear(); }
    public meminfo(pkg: string) { return this.client.meminfo(pkg); }
    public gfxinfo(pkg: string) { return this.client.gfxinfo(pkg); }
    public commandLog() { return this.client.commandLog; }
    public pressHome() { return this.client.pressHome(); }
    public clearAppData(pkg: string) { return this.client.clearAppData(pkg); }
    public appDataDirectory(pkg: string) { return this.client.appDataDirectory(pkg); }
    public listAppFiles(pkg: string, directory: string) { return this.client.listAppFiles(pkg, directory); }
    public writeAppFile(pkg: string, devicePath: string, text: string) { return this.client.writeAppFile(pkg, devicePath, text); }
    public removeAppFiles(pkg: string, devicePaths: string[]) { return this.client.removeAppFiles(pkg, devicePaths); }

    public startLogcat(rawPath: string): EventStream {
        this.logcat = new LogcatProcess();
        this.logcat.start(this.adbPath, this.client.logcatStreamArgs(), rawPath);
        return this.logcat.stream;
    }

    public async stopLogcat(): Promise<void> {
        await this.logcat?.stop();
        this.logcat = null;
    }
}
