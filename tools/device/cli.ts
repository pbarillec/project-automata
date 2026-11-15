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
import { AUT050_SEED_VARIANTS, isAut050SeedVariant, seedAut050 } from './seed_aut050.ts';
import { AUT051_SEED_VARIANTS, isAut051SeedVariant, seedAut051 } from './seed_aut051.ts';
import { AUT055_SEED_VARIANTS, isAut055Outcome, isAut055SeedVariant, seedAut055 } from './seed_aut055.ts';
import { AUT056_SEED_VARIANTS, isAut056Outcome, isAut056SeedVariant, seedAut056 } from './seed_aut056.ts';
import { AUT057_SEED_VARIANTS, isAut057SeedVariant, seedAut057 } from './seed_aut057.ts';
import { AUT060_SEED_VARIANTS, isAut060SeedVariant, seedAut060 } from './seed_aut060.ts';
import { AUT061_SEED_VARIANTS, isAut061SeedVariant, seedAut061 } from './seed_aut061.ts';
import { AUT062_SEED_VARIANTS, isAut062SeedVariant, seedAut062 } from './seed_aut062.ts';
import { AUT059_SEED_VARIANTS, isAut059Outcome, isAut059SeedVariant, seedAut059 } from './seed_aut059.ts';
import { DEBUG_PURCHASE_OUTCOMES } from '../../assets/scripts/presentation/DebugPurchaseScriptFile.ts';
import { DEBUG_ADS_OUTCOMES } from '../../assets/scripts/presentation/DebugAdsScriptFile.ts';
import { seedAut052 } from './seed_aut052.ts';
import { seedRbt001 } from './seed_rbt001.ts';
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
    if (command === 'seed-aut050') {
        // AUT-050 review: seed a post-Reboot save (Civilization #2, AI Cores, permanent ranks) so the AI Upgrades chip shows on launch (mixed default).
        const variant = flags.variant === undefined || flags.variant === true ? 'mixed' : flags.variant;
        if (!isAut050SeedVariant(variant)) { console.log(`unknown --variant; expected one of ${AUT050_SEED_VARIANTS.join(', ')}`); return 1; }
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const filesDir = await seedAut050(driver, 'com.projectautomata.androidbaseline', 'com.cocos.game.AppActivity', variant);
        console.log(`seeded ${filesDir}save_main.json (${variant}) and launched`);
        return 0;
    }
    if (command === 'seed-aut052') {
        // AUT-052 review: seed a post-Reboot save (both chips visible) and clear the settings file so the run starts from the defaults.
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const filesDir = await seedAut052(driver, 'com.projectautomata.androidbaseline', 'com.cocos.game.AppActivity');
        console.log(`seeded ${filesDir}save_main.json (post-Reboot, no settings.json) and launched`);
        return 0;
    }
    if (command === 'seed-rbt001') {
        // AUT-RBT-001 review: seed a Reboot-eligible Civilization #1 save (reward 5, progress ~45%, NO debug command) so the Reboot chip shows on launch.
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const filesDir = await seedRbt001(driver, 'com.projectautomata.androidbaseline', 'com.cocos.game.AppActivity');
        console.log(`seeded ${filesDir}save_main.json (Reboot-eligible, no debug_command.json) and launched`);
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
    if (command === 'seed-aut055') {
        // AUT-055 review: seed an offline absence + the DEBUG mock-ad script (debug_ads.json) so the Offline Double x2 action shows (variant ready) or is hidden (short_ineligible / quota).
        const variant = flags.variant === undefined || flags.variant === true ? 'ready' : flags.variant;
        if (!isAut055SeedVariant(variant)) { console.log(`unknown --variant; expected one of ${AUT055_SEED_VARIANTS.join(', ')}`); return 1; }
        const outcome = flags.outcome === undefined || flags.outcome === true ? 'rewarded' : flags.outcome;
        if (!isAut055Outcome(outcome)) { console.log(`unknown --outcome; expected one of ${DEBUG_ADS_OUTCOMES.join(', ')}`); return 1; }
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const filesDir = await seedAut055(driver, 'com.projectautomata.androidbaseline', 'com.cocos.game.AppActivity', variant, outcome);
        console.log(`seeded ${filesDir}save_main.json (${variant}) + debug_ads.json (${outcome}) and launched`);
        return 0;
    }
    if (command === 'seed-aut056') {
        // AUT-056 review: seed a save + the DEBUG mock-ad script (debug_ads.json) so the Extended Overclock chip shows (eligible / free_active) or is hidden (quota / interval); resume seeds Extended + a suspended Free Overclock.
        const variant = flags.variant === undefined || flags.variant === true ? 'eligible' : flags.variant;
        if (!isAut056SeedVariant(variant)) { console.log(`unknown --variant; expected one of ${AUT056_SEED_VARIANTS.join(', ')}`); return 1; }
        const outcome = flags.outcome === undefined || flags.outcome === true ? 'rewarded' : flags.outcome;
        if (!isAut056Outcome(outcome)) { console.log(`unknown --outcome; expected one of ${DEBUG_ADS_OUTCOMES.join(', ')}`); return 1; }
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const filesDir = await seedAut056(driver, 'com.projectautomata.androidbaseline', 'com.cocos.game.AppActivity', variant, outcome);
        console.log(`seeded ${filesDir}save_main.json (${variant}) + debug_ads.json (${outcome}) and launched`);
        return 0;
    }
    if (command === 'seed-aut057') {
        // AUT-057 review: seed a save + the per-launch debug_ads.json {"provider":"admob_test"} so the DEBUG build serves REAL Google test ads (offline_double: x2 on the offline card; extended: Extended Overclock chip).
        const variant = flags.variant === undefined || flags.variant === true ? 'offline_double' : flags.variant;
        if (!isAut057SeedVariant(variant)) { console.log(`unknown --variant; expected one of ${AUT057_SEED_VARIANTS.join(', ')}`); return 1; }
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const filesDir = await seedAut057(driver, 'com.projectautomata.androidbaseline', 'com.cocos.game.AppActivity', variant);
        console.log(`seeded ${filesDir}save_main.json (${variant}) + debug_ads.json (provider admob_test) and launched`);
        return 0;
    }
    if (command === 'seed-aut059') {
        // AUT-059 review: seed a save + the DEBUG mock-store script (debug_purchase.json: product metadata with a TEST price string + scripted outcomes) so the Founder chip shows (available / owned), or is hidden (locked; no_store = no script = NoOp store like a release build).
        const variant = flags.variant === undefined || flags.variant === true ? 'available' : flags.variant;
        if (!isAut059SeedVariant(variant)) { console.log(`unknown --variant; expected one of ${AUT059_SEED_VARIANTS.join(', ')}`); return 1; }
        const outcomes: Array<(typeof DEBUG_PURCHASE_OUTCOMES)[number]> = [];
        if (flags.outcome !== undefined && flags.outcome !== true) {
            if (!isAut059Outcome(flags.outcome)) { console.log(`unknown --outcome; expected one of ${DEBUG_PURCHASE_OUTCOMES.join(', ')}`); return 1; }
            outcomes.push(flags.outcome);
        }
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const filesDir = await seedAut059(driver, 'com.projectautomata.androidbaseline', 'com.cocos.game.AppActivity', variant, { outcomes, duplicateCallback: flags.duplicate === true, metadataMissing: flags['missing-metadata'] === true });
        console.log(`seeded ${filesDir}save_main.json (${variant}) + ${variant === 'no_store' ? 'NO debug_purchase.json (NoOp store)' : `debug_purchase.json (${outcomes.join(',') || 'no scripted outcome'})`} and launched`);
        return 0;
    }
    if (command === 'seed-aut060') {
        // AUT-060: seed a save + the DEBUG script that selects the REAL Google Play Billing provider (needs Google Play + a license tester + the Play Console product).
        const variant = flags.variant === undefined || flags.variant === true ? 'available' : flags.variant;
        if (!isAut060SeedVariant(variant)) { console.log(`unknown --variant; expected one of ${AUT060_SEED_VARIANTS.join(', ')}`); return 1; }
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const filesDir = await seedAut060(driver, 'com.projectautomata.androidbaseline', 'com.cocos.game.AppActivity', variant);
        console.log(`seeded ${filesDir}save_main.json (${variant}) + debug_purchase.json (provider play_billing) and launched`);
        return 0;
    }
    if (command === 'seed-aut061') {
        // AUT-061: seed a save + the DEBUG MOCK store script with a scripted store-query (restore) mode: reinstall (fresh save, store owned) or local_owned_store_error.
        const variant = flags.variant === undefined || flags.variant === true ? 'reinstall' : flags.variant;
        if (!isAut061SeedVariant(variant)) { console.log(`unknown --variant; expected one of ${AUT061_SEED_VARIANTS.join(', ')}`); return 1; }
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const filesDir = await seedAut061(driver, 'com.projectautomata.androidbaseline', 'com.cocos.game.AppActivity', variant);
        console.log(`seeded ${filesDir}save_main.json (${variant}) + debug_purchase.json (mock store, restore ${variant === 'reinstall' ? 'owned' : 'error'}) and launched`);
        return 0;
    }
    if (command === 'seed-aut062') {
        // AUT-062: seed a save for the Founder Robot / UNIT 0001 captures: not_owned | owned_before_first_robot (tap Next Goal) | owned_many_robots | mid_session (mock store completes the purchase).
        const variant = flags.variant === undefined || flags.variant === true ? 'owned_many_robots' : flags.variant;
        if (!isAut062SeedVariant(variant)) { console.log(`unknown --variant; expected one of ${AUT062_SEED_VARIANTS.join(', ')}`); return 1; }
        const driver = new AdbDeviceDriver();
        const selection = selectDevice(await driver.devices(), typeof flags.serial === 'string' ? flags.serial : undefined);
        if (!selection.ok) { console.log(JSON.stringify(selection, null, 2)); return 2; }
        if (typeof flags.serial === 'string') driver.useSerial(flags.serial);
        const filesDir = await seedAut062(driver, 'com.projectautomata.androidbaseline', 'com.cocos.game.AppActivity', variant);
        console.log(`seeded ${filesDir}save_main.json (${variant})${variant === 'mid_session' ? ' + debug_purchase.json (mock store, one completed purchase)' : ''} and launched`);
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
            expectOfflineDouble: scenario.expectOfflineDouble,
            expectExtendedOverclock: scenario.expectExtendedOverclock,
            expectAdmob: scenario.expectAdmob,
            expectFounderShop: scenario.expectFounderShop,
            expectBilling: scenario.expectBilling,
            expectRestore: scenario.expectRestore,
            expectFounderRobot: scenario.expectFounderRobot,
            expectAnalytics: scenario.expectAnalytics,
            expectPermanentUpgrades: scenario.expectPermanentUpgrades,
            expectSettings: scenario.expectSettings,
            expectRebootUi: scenario.expectRebootUi,
        });
        const environmentBlocked = result.checks.some((check) => !check.ok && check.detail.startsWith('ENVIRONMENT_BLOCKED'));
        console.log(`reveal capture ${result.ok ? 'PASS' : environmentBlocked ? 'ENVIRONMENT_BLOCKED' : 'FAIL'}: ${result.outDir}`);
        for (const check of result.checks) console.log(`  ${check.ok ? 'PASS' : 'FAIL'} ${check.id}: ${check.detail}`);
        return result.ok ? 0 : environmentBlocked ? 3 : 1;
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
    console.log('usage: node tools/device/cli.ts devices | c3|int001|r036|ui001|r031|gp001|aut039 --apk <path> [--serial <id>] [--run-id <id>] [--skip-install] | seed-aut040 [--serial <id>] | seed-aut042 [--variant unbuilt|lv1|lv10] [--serial <id>] | seed-aut043 [--variant unbuilt|lv1|lv10] [--serial <id>] | seed-aut044 [--variant unbuilt|lv1|lv10] [--serial <id>] | seed-aut045 [--variant workshop|era2|era3] [--serial <id>] | seed-aut046 [--variant breakthrough] [--serial <id>] | seed-aut047 [--variant active|ready] [--serial <id>] | seed-aut048 [--variant era2|era3] [--serial <id>] | seed-aut049 [--variant reboot|post] [--serial <id>] | seed-aut050 [--variant mixed|maxed] [--serial <id>] | seed-aut051 [--variant first|compact|cap|reload|short] [--serial <id>] | seed-aut052 [--serial <id>] | seed-aut055 [--variant ready|short_ineligible|quota] [--outcome rewarded|closed|failed] [--serial <id>] | seed-aut056 [--variant eligible|free_active|quota|interval|resume] [--outcome rewarded|closed|failed] [--serial <id>] | seed-aut057 [--variant offline_double|extended] [--serial <id>] | seed-aut060 [--variant available|owned] [--serial <id>] | seed-aut061 [--variant reinstall|local_owned_store_error] [--serial <id>] | seed-aut062 [--variant not_owned|owned_before_first_robot|owned_many_robots|mid_session] [--serial <id>] | seed-aut059 [--variant available|owned|locked|no_store] [--outcome completed|pending|cancelled|failed] [--duplicate] [--missing-metadata] [--serial <id>] | seed-rbt001 [--serial <id>] | seed-ui003 [--serial <id>] | reveal-capture [--scenario aut043|aut044|aut046|aut047|ui003|aut048|aut048-era3|aut048-era3-live|aut049|aut049-post|aut050|aut051|aut051-reload|aut051-short|aut052|rbt001|aut055-success|aut055-closed|aut055-failed|aut055-ineligible|aut056-success|aut056-free-active|aut056-resume|aut056-closed|aut056-failed|aut056-quota|aut056-interval|aut057-offline-double|aut057-extended|aut057-no-fill] [AUT-061 scenarios (MOCK store restore): aut061-restore-reinstall|aut061-restore-store-error] [AUT-060 scenarios (REAL Play Billing, ENVIRONMENT_BLOCKED without a Play test account/product): aut060-license-tester-purchase|aut060-cancel|aut060-restore-owned] [AUT-059 scenarios: aut059-available|aut059-purchase-success|aut059-pending|aut059-cancel|aut059-fail|aut059-owned|aut059-hidden|aut059-locked] [--label <l>] [--trigger next-goal|overclock|robot-line-build|none] | gate-build [--label <l>] | restore-build-config');
    return command === 'help' ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }, (error) => { console.error(error); process.exitCode = 3; });
