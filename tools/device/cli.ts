/**
 * AUT-INFRA-001 device harness CLI.
 *
 *   node tools/device/cli.ts devices
 *   node tools/device/cli.ts c3 --apk <path> [--serial <id>] [--run-id <id>] [--skip-install]
 *   node tools/device/cli.ts int001 --apk <path> [--serial <id>] [--run-id <id>] [--skip-install]
 *   node tools/device/cli.ts gate-build [--label <label>]
 *   node tools/device/cli.ts restore-build-config
 *
 * Exit codes for `c3` and `int001`: 0 PASS, 1 FAIL (functional class), 2 BLOCKED (environment), 3 invalid result.
 */
import { AdbError, selectDevice } from './adb.ts';
import { AdbDeviceDriver } from './driver.ts';
import { defaultGateBuildDeps, restoreFromBackup, runGateBuild } from './gate_build.ts';
import { runC3Scenario } from './scenarios/c3_producer_selection.ts';
import { runInt001Scenario } from './scenarios/int001_session_persistence.ts';

function parseArgs(argv: string[]): { command: string; flags: Record<string, string | boolean> } {
    const [command = 'help', ...rest] = argv;
    const flags: Record<string, string | boolean> = {};
    for (let i = 0; i < rest.length; i += 1) {
        const token = rest[i];
        if (!token.startsWith('--')) continue;
        const key = token.slice(2);
        const value = rest[i + 1];
        if (value === undefined || value.startsWith('--')) flags[key] = true;
        else { flags[key] = value; i += 1; }
    }
    return { command, flags };
}

async function main(): Promise<number> {
    const { command, flags } = parseArgs(process.argv.slice(2));
    if (command === 'devices') {
        try {
            const devices = await new AdbDeviceDriver().devices();
            const selection = selectDevice(devices, typeof flags.serial === 'string' ? flags.serial : undefined);
            console.log(JSON.stringify({ devices, selection }, null, 2));
            return selection.ok ? 0 : 2;
        } catch (error) {
            console.log(JSON.stringify({ error: error instanceof AdbError ? { kind: error.kind, detail: error.detail } : String(error) }, null, 2));
            return 2;
        }
    }
    if (command === 'c3' || command === 'int001') {
        const scenarioOptions = {
            apkPath: typeof flags.apk === 'string' ? flags.apk : null,
            serial: typeof flags.serial === 'string' ? flags.serial : undefined,
            runId: typeof flags['run-id'] === 'string' ? flags['run-id'] : undefined,
            skipInstall: flags['skip-install'] === true,
        };
        const output = command === 'c3'
            ? await runC3Scenario(new AdbDeviceDriver(), scenarioOptions)
            : await runInt001Scenario(new AdbDeviceDriver(), scenarioOptions);
        const r = output.result;
        console.log(`${r.scenario_id} ${r.status}${r.failure_class ? ` ${r.failure_class}` : ''} → ${r.review_decision}`);
        if (r.first_failed_assertion) console.log(`first failed assertion: ${r.first_failed_assertion.id} @ ${r.first_failed_assertion.step}`);
        if (r.required_human_action) console.log(`required human action: ${r.required_human_action}`);
        console.log(`result: ${r.evidence.result}`);
        if (output.schemaErrors.length) { console.error(`result schema errors: ${output.schemaErrors.join('; ')}`); return 3; }
        return r.status === 'PASS' ? 0 : r.status === 'FAIL' ? 1 : 2;
    }
    if (command === 'gate-build') {
        const label = typeof flags.label === 'string' ? flags.label : 'gate';
        const result = runGateBuild(defaultGateBuildDeps(label));
        console.log(JSON.stringify(result, null, 2));
        return result.ok ? 0 : 1;
    }
    if (command === 'restore-build-config') {
        const restored = restoreFromBackup();
        console.log(restored ? 'restored tracked build config from temp/device/gate backup' : 'no backup found');
        return restored ? 0 : 1;
    }
    console.log('usage: node tools/device/cli.ts devices | c3|int001 --apk <path> [--serial <id>] [--run-id <id>] [--skip-install] | gate-build [--label <l>] | restore-build-config');
    return command === 'help' ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }, (error) => { console.error(error); process.exitCode = 3; });
