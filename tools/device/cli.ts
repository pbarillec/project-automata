/**
 * AUT-INFRA-001 device harness CLI.
 *
 *   node tools/device/cli.ts devices
 *   node tools/device/cli.ts c3 --apk <path> [--serial <id>] [--run-id <id>] [--skip-install]
 *   node tools/device/cli.ts int001 --apk <path> [--serial <id>] [--run-id <id>] [--skip-install]
 *   node tools/device/cli.ts r036 --apk <path> [--serial <id>] [--run-id <id>] [--skip-install]
 *   node tools/device/cli.ts ui001 --apk <path> [--serial <id>] [--run-id <id>] [--skip-install]
 *   node tools/device/cli.ts r031 --apk <path> [--serial <id>] [--run-id <id>] [--skip-install]
 *   node tools/device/cli.ts gp001 --apk <path> [--serial <id>] [--run-id <id>] [--skip-install]
 *   node tools/device/cli.ts aut039 --apk <path> [--serial <id>] [--run-id <id>] [--skip-install]
 *   node tools/device/cli.ts gate-build [--label <label>]
 *   node tools/device/cli.ts restore-build-config
 *
 * Exit codes for `c3`, `int001`, `r036`, `ui001`, `r031`, `gp001` and `aut039`: 0 PASS, 1 FAIL (functional class), 2 BLOCKED (environment), 3 invalid result.
 */
import { AdbError, selectDevice } from './adb.ts';
import { AdbDeviceDriver } from './driver.ts';
import { defaultGateBuildDeps, restoreFromBackup, runGateBuild } from './gate_build.ts';
import { runC3Scenario } from './scenarios/c3_producer_selection.ts';
import { runInt001Scenario } from './scenarios/int001_session_persistence.ts';
import { runR036Scenario } from './scenarios/r036_ui_layout.ts';
import { runUi001Scenario } from './scenarios/ui001_core_loop.ts';
import { runR031Scenario } from './scenarios/r031_tap_first_camera.ts';
import { runGp001Scenario } from './scenarios/gp001_assembly_batch.ts';
import { runAut039Scenario } from './scenarios/aut039_first_robot.ts';
import { seedAut040 } from './seed_aut040.ts';
import { AUT042_SEED_VARIANTS, isAut042SeedVariant, seedAut042 } from './seed_aut042.ts';
import { AUT043_SEED_VARIANTS, isAut043SeedVariant, seedAut043 } from './seed_aut043.ts';
import { runAut041Benchmark } from './benchmark_aut041.ts';
import { runRevealCapture, type RevealTrigger } from './reveal_capture.ts';

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
    if (command === 'c3' || command === 'int001' || command === 'r036' || command === 'ui001' || command === 'r031' || command === 'gp001' || command === 'aut039') {
        const scenarioOptions = {
            apkPath: typeof flags.apk === 'string' ? flags.apk : null,
            serial: typeof flags.serial === 'string' ? flags.serial : undefined,
            runId: typeof flags['run-id'] === 'string' ? flags['run-id'] : undefined,
            skipInstall: flags['skip-install'] === true,
        };
        const output = command === 'c3'
            ? await runC3Scenario(new AdbDeviceDriver(), scenarioOptions)
            : command === 'int001'
                ? await runInt001Scenario(new AdbDeviceDriver(), scenarioOptions)
                : command === 'r036'
                    ? await runR036Scenario(new AdbDeviceDriver(), scenarioOptions)
                    : command === 'ui001'
                        ? await runUi001Scenario(new AdbDeviceDriver(), scenarioOptions)
                        : command === 'r031'
                            ? await runR031Scenario(new AdbDeviceDriver(), scenarioOptions)
                            : command === 'gp001'
                                ? await runGp001Scenario(new AdbDeviceDriver(), scenarioOptions)
                                : await runAut039Scenario(new AdbDeviceDriver(), scenarioOptions);
        const r = output.result;
        console.log(`${r.scenario_id} ${r.status}${r.failure_class ? ` ${r.failure_class}` : ''} → ${r.review_decision}`);
        if (r.first_failed_assertion) console.log(`first failed assertion: ${r.first_failed_assertion.id} @ ${r.first_failed_assertion.step}`);
        if (r.required_human_action) console.log(`required human action: ${r.required_human_action}`);
        console.log(`result: ${r.evidence.result}`);
        if (output.schemaErrors.length) { console.error(`result schema errors: ${output.schemaErrors.join('; ')}`); return 3; }
        return r.status === 'PASS' ? 0 : r.status === 'FAIL' ? 1 : 2;
    }
    if (command === 'seed-aut040') {
        // AUT-040 human gate: seed an unbuilt-Assembly save and launch (no install, no assertions).
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const filesDir = await seedAut040(driver, 'com.projectautomata.androidbaseline', 'com.cocos.game.AppActivity');
        console.log(`seeded ${filesDir}save_main.json and launched`);
        return 0;
    }
    if (command === 'seed-aut042') {
        // AUT-042 human gate: seed an unbuilt (default) / Lv1 / Lv10 Robot Line save and launch (no install, no assertions).
        const variant = flags.variant === undefined || flags.variant === true ? 'unbuilt' : flags.variant;
        if (!isAut042SeedVariant(variant)) { console.log(`unknown --variant; expected one of ${AUT042_SEED_VARIANTS.join(', ')}`); return 1; }
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const filesDir = await seedAut042(driver, 'com.projectautomata.androidbaseline', 'com.cocos.game.AppActivity', variant);
        console.log(`seeded ${filesDir}save_main.json (${variant}) and launched`);
        return 0;
    }
    if (command === 'seed-aut043') {
        // AUT-043 human gate: seed an unbuilt (default) / Lv1 / Lv10 Automated Cell save and launch (no install, no assertions).
        const variant = flags.variant === undefined || flags.variant === true ? 'unbuilt' : flags.variant;
        if (!isAut043SeedVariant(variant)) { console.log(`unknown --variant; expected one of ${AUT043_SEED_VARIANTS.join(', ')}`); return 1; }
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const filesDir = await seedAut043(driver, 'com.projectautomata.androidbaseline', 'com.cocos.game.AppActivity', variant);
        console.log(`seeded ${filesDir}save_main.json (${variant}) and launched`);
        return 0;
    }
    if (command === 'bench-aut041') {
        // AUT-041 DEBUG-only robot population benchmark on the connected device (APK must already be installed).
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const { results, summaryPath } = await runAut041Benchmark(driver);
        console.log(`summary: ${summaryPath}`);
        return results.every((r) => r.ok) ? 0 : 1;
    }
    if (command === 'reveal-capture') {
        // AUT-INFRA-002: live reveal evidence (frame sequence + event timeline) for the AUT-043 Automated Cell build.
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const result = await runRevealCapture(driver, {
            label: typeof flags.label === 'string' ? flags.label : 'aut043-cell',
            trigger: (typeof flags.trigger === 'string' ? flags.trigger : 'next-goal') as RevealTrigger,
            expectConstruction: 'automated_cell',
            expectFocus: true,
        });
        console.log(`reveal capture ${result.ok ? 'PASS' : 'FAIL'}: ${result.outDir}`);
        for (const check of result.checks) console.log(`  ${check.ok ? 'PASS' : 'FAIL'} ${check.id}: ${check.detail}`);
        return result.ok ? 0 : 1;
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
    console.log('usage: node tools/device/cli.ts devices | c3|int001|r036|ui001|r031|gp001|aut039 --apk <path> [--serial <id>] [--run-id <id>] [--skip-install] | seed-aut040 [--serial <id>] | seed-aut042 [--variant unbuilt|lv1|lv10] [--serial <id>] | seed-aut043 [--variant unbuilt|lv1|lv10] [--serial <id>] | gate-build [--label <l>] | restore-build-config');
    return command === 'help' ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }, (error) => { console.error(error); process.exitCode = 3; });
