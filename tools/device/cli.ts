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
import { AUT044_SEED_VARIANTS, isAut044SeedVariant, seedAut044 } from './seed_aut044.ts';
import { AUT045_SEED_VARIANTS, isAut045SeedVariant, seedAut045 } from './seed_aut045.ts';
import { AUT046_SEED_VARIANTS, isAut046SeedVariant, seedAut046 } from './seed_aut046.ts';
import { AUT047_SEED_VARIANTS, isAut047SeedVariant, seedAut047 } from './seed_aut047.ts';
import { AUT048_SEED_VARIANTS, isAut048SeedVariant, seedAut048 } from './seed_aut048.ts';
import { AUT049_SEED_VARIANTS, isAut049SeedVariant, seedAut049 } from './seed_aut049.ts';
import { AUT051_SEED_VARIANTS, isAut051SeedVariant, seedAut051 } from './seed_aut051.ts';
import { seedUi003 } from './seed_ui003.ts';
import { runAut041Benchmark } from './benchmark_aut041.ts';
import { REVEAL_SCENARIOS, resolveRevealScenario, runRevealCapture, type RevealTrigger } from './reveal_capture.ts';

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
    if (command === 'seed-aut044') {
        // AUT-044 human gate: seed an unbuilt (default) / Lv1 / Lv10 Advanced Robotics Complex save and launch (no install, no assertions).
        const variant = flags.variant === undefined || flags.variant === true ? 'unbuilt' : flags.variant;
        if (!isAut044SeedVariant(variant)) { console.log(`unknown --variant; expected one of ${AUT044_SEED_VARIANTS.join(', ')}`); return 1; }
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const filesDir = await seedAut044(driver, 'com.projectautomata.androidbaseline', 'com.cocos.game.AppActivity', variant);
        console.log(`seeded ${filesDir}save_main.json (${variant}) and launched`);
        return 0;
    }
    if (command === 'seed-aut045') {
        // AUT-045 review: seed a workshop (default) / era2 / era3 save and launch (no install, no assertions).
        const variant = flags.variant === undefined || flags.variant === true ? 'workshop' : flags.variant;
        if (!isAut045SeedVariant(variant)) { console.log(`unknown --variant; expected one of ${AUT045_SEED_VARIANTS.join(', ')}`); return 1; }
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const filesDir = await seedAut045(driver, 'com.projectautomata.androidbaseline', 'com.cocos.game.AppActivity', variant);
        console.log(`seeded ${filesDir}save_main.json (${variant}) and launched`);
        return 0;
    }
    if (command === 'seed-aut046') {
        // AUT-046 review: seed a one-step-before-a-Major (breakthrough) save and launch (no install, no assertions).
        const variant = flags.variant === undefined || flags.variant === true ? 'breakthrough' : flags.variant;
        if (!isAut046SeedVariant(variant)) { console.log(`unknown --variant; expected one of ${AUT046_SEED_VARIANTS.join(', ')}`); return 1; }
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const filesDir = await seedAut046(driver, 'com.projectautomata.androidbaseline', 'com.cocos.game.AppActivity', variant);
        console.log(`seeded ${filesDir}save_main.json (${variant}) and launched`);
        return 0;
    }
    if (command === 'seed-aut047') {
        // AUT-047 review: seed an Overclock-active (or ready) save and launch (no install, no assertions).
        const variant = flags.variant === undefined || flags.variant === true ? 'active' : flags.variant;
        if (!isAut047SeedVariant(variant)) { console.log(`unknown --variant; expected one of ${AUT047_SEED_VARIANTS.join(', ')}`); return 1; }
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const filesDir = await seedAut047(driver, 'com.projectautomata.androidbaseline', 'com.cocos.game.AppActivity', variant);
        console.log(`seeded ${filesDir}save_main.json (${variant}) and launched`);
        return 0;
    }
    if (command === 'seed-aut048') {
        // AUT-048 review: seed a one-step-before-an-era-transition save (era2 default / era3) and launch (no install, no assertions).
        const variant = flags.variant === undefined || flags.variant === true ? 'era2' : flags.variant;
        if (!isAut048SeedVariant(variant)) { console.log(`unknown --variant; expected one of ${AUT048_SEED_VARIANTS.join(', ')}`); return 1; }
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const filesDir = await seedAut048(driver, 'com.projectautomata.androidbaseline', 'com.cocos.game.AppActivity', variant);
        console.log(`seeded ${filesDir}save_main.json (${variant}) and launched`);
        return 0;
    }
    if (command === 'seed-aut049') {
        // AUT-049 review: seed a Reboot-eligible save (reboot default, with the DEBUG-only debug_command.json) or a post-Reboot save (post) and launch.
        const variant = flags.variant === undefined || flags.variant === true ? 'reboot' : flags.variant;
        if (!isAut049SeedVariant(variant)) { console.log(`unknown --variant; expected one of ${AUT049_SEED_VARIANTS.join(', ')}`); return 1; }
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const filesDir = await seedAut049(driver, 'com.projectautomata.androidbaseline', 'com.cocos.game.AppActivity', variant);
        console.log(`seeded ${filesDir}save_main.json (${variant}) and launched`);
        return 0;
    }
    if (command === 'seed-aut051') {
        // AUT-051 review: seed a save with an old savedAtUtc (3 h / 10 h away) so the Offline Factory Report card shows on launch (first default).
        const variant = flags.variant === undefined || flags.variant === true ? 'first' : flags.variant;
        if (!isAut051SeedVariant(variant)) { console.log(`unknown --variant; expected one of ${AUT051_SEED_VARIANTS.join(', ')}`); return 1; }
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const filesDir = await seedAut051(driver, 'com.projectautomata.androidbaseline', 'com.cocos.game.AppActivity', variant);
        console.log(`seeded ${filesDir}save_main.json (${variant}) and launched`);
        return 0;
    }
    if (command === 'seed-ui003') {
        // AUT-UI-003 review: seed a Free Overclock READY save and launch (no install, no assertions).
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const filesDir = await seedUi003(driver, 'com.projectautomata.androidbaseline', 'com.cocos.game.AppActivity');
        console.log(`seeded ${filesDir}save_main.json (free overclock ready) and launched`);
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
        // AUT-INFRA-002: live reveal evidence (frame sequence + event timeline); `--scenario aut043` (default, Automated Cell) | `aut044` (Advanced Robotics Complex).
        const scenario = resolveRevealScenario(flags.scenario);
        if (!scenario) { console.log(`unknown --scenario; expected one of ${Object.keys(REVEAL_SCENARIOS).join(', ')}`); return 1; }
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const result = await runRevealCapture(driver, {
            label: typeof flags.label === 'string' ? flags.label : scenario.label,
            seed: scenario.seed,
            trigger: (typeof flags.trigger === 'string' ? flags.trigger : scenario.trigger ?? 'next-goal') as RevealTrigger,
            expectConstruction: scenario.expectConstruction,
            expectFocus: scenario.expectFocus,
            durationMs: scenario.durationMs,
            intervalMs: scenario.intervalMs,
            expectBoostPhases: scenario.expectBoostPhases,
            expectCommands: scenario.expectCommands,
            expectEraTitle: scenario.expectEraTitle,
            expectReboot: scenario.expectReboot,
            expectOfflineReport: scenario.expectOfflineReport,
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
    console.log('usage: node tools/device/cli.ts devices | c3|int001|r036|ui001|r031|gp001|aut039 --apk <path> [--serial <id>] [--run-id <id>] [--skip-install] | seed-aut040 [--serial <id>] | seed-aut042 [--variant unbuilt|lv1|lv10] [--serial <id>] | seed-aut043 [--variant unbuilt|lv1|lv10] [--serial <id>] | seed-aut044 [--variant unbuilt|lv1|lv10] [--serial <id>] | seed-aut045 [--variant workshop|era2|era3] [--serial <id>] | seed-aut046 [--variant breakthrough] [--serial <id>] | seed-aut047 [--variant active|ready] [--serial <id>] | seed-aut048 [--variant era2|era3] [--serial <id>] | seed-aut049 [--variant reboot|post] [--serial <id>] | seed-aut051 [--variant first|compact|cap|reload] [--serial <id>] | seed-ui003 [--serial <id>] | reveal-capture [--scenario aut043|aut044|aut046|aut047|ui003|aut048|aut048-era3|aut048-era3-live|aut049|aut049-post|aut051|aut051-reload] [--label <l>] [--trigger next-goal|overclock|robot-line-build|none] | gate-build [--label <l>] | restore-build-config');
    return command === 'help' ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }, (error) => { console.error(error); process.exitCode = 3; });
