import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { bootstrapGameSession } from '../assets/scripts/lifecycle/index.ts';
import { loadGameConfigFromSources } from '../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { getFounderSurgeChargesRemaining, isFounderPackOwned } from '../assets/scripts/monetization/FounderOffer.ts';
import { CURRENT_SAVE_VERSION, InMemorySaveStorage, SAVE_MAIN_NAME } from '../assets/scripts/persistence/index.ts';
import { DEBUG_ADS_FILE, parseDebugAdsScriptFile } from '../assets/scripts/presentation/DebugAdsScriptFile.ts';
import { DEBUG_COMMAND_FILE, DEBUG_COMMAND_MAX_SEQUENCE, DEBUG_COMMAND_TYPES, parseDebugCommandFile, parseDebugCommandSequenceFile } from '../assets/scripts/presentation/DebugCommandFile.ts';
import { runDebugCommands, type DebugCommandPort } from '../assets/scripts/presentation/DebugCommandExecutor.ts';
import { parseDebugConsentScriptFile, DEBUG_CONSENT_FILE } from '../assets/scripts/presentation/DebugConsentScriptFile.ts';
import { DEBUG_PURCHASE_FILE, parseDebugPurchaseScriptFile } from '../assets/scripts/presentation/DebugPurchaseScriptFile.ts';
import { DEVICE_EVENT_TYPES } from '../assets/scripts/presentation/DeviceDiagnostics.ts';
import { FactoryWorldStateBinding } from '../assets/scripts/presentation/FactoryWorldStateBinding.ts';
import { createPermanentUpgradePanelViewModel } from '../assets/scripts/presentation/PermanentUpgradePanelViewModel.ts';
import { createRebootPanelViewModel } from '../assets/scripts/presentation/RebootPanelViewModel.ts';
import { GameRuntime } from '../assets/scripts/runtime/GameRuntime.ts';
import { DEBUG_LIMITS, createDebugGate, executeDebugStatePatch, parseDebugStatePatch } from '../assets/scripts/runtime/DebugStatePatch.ts';
import { createFreshGameState } from '../assets/scripts/state/index.ts';
import { ManualTimeService } from '../assets/scripts/time/index.ts';
import { REVEAL_SCENARIOS, DEFAULT_REVEAL_EVENT_TYPES, evaluateRevealTimeline } from '../tools/device/reveal_capture.ts';
import {
    QA_ADS_PLACEMENTS, QA_COMMAND_NAMES, QA_MANAGED_FILES, QA_PATCHES_SEQUENCE, QA_PRESETS, QaUsageError, applyQaPlan, buildQaAdsFile, buildQaCommandFile, buildQaScenarioPlan,
    parseQaCommandWords, parseQaInvocation, renderQaList, resolveQaAdsOutcome, resolveQaPreset, serializeQaSave,
} from '../tools/device/qa_toolkit.ts';
import { QA_TOOLKIT_EXPECTED_TYPES, evaluateQaToolkit } from '../tools/device/qa_toolkit_checks.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');
const NOW_MS = Date.parse('2026-11-15T12:00:00.000Z');
const repository = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
const ON = createDebugGate(true, true);

function walk(dir: string): string[] {
    return fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : entry.name.endsWith('.ts') ? [`${dir}/${entry.name}`] : []);
}

function methodBody(source: string, signature: string): string {
    const start = source.indexOf(signature);
    assert.ok(start >= 0, `missing ${signature}`);
    const next = source.indexOf('\n    private ', start + signature.length);
    return source.slice(start, next < 0 ? undefined : next);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Payload parse / validation

test('debug command file: every new command parses strictly; unknown, negative, NaN, out-of-range, non-integer and extra-key shapes are rejected', () => {
    const good: unknown[] = [
        { type: 'grantIndustrialOutput', amount: 5000 },
        { type: 'grantIndustrialOutput', amount: 0.5 + 0.5 },
        { type: 'setProducerLevel', producerId: 'fabricator', level: 25 },
        { type: 'setProducerLevel', producerId: 'fabricator', level: 0 },
        { type: 'setEra', eraId: 'automated_factory' },
        { type: 'setRobotsBuilt', amount: 0 },
        { type: 'setRobotsBuilt', amount: DEBUG_LIMITS.maxRobotsBuilt },
        { type: 'grantAiCores', amount: 5 },
        { type: 'createPendingOffline', seconds: 10800 },
        { type: 'previewReboot' },
        { type: 'mockFounderOwned', owned: true },
        { type: 'mockFounderOwned', owned: false },
        { type: 'purchaseBreakthrough', breakthroughId: 'advanced_robotics' },
        { type: 'rebootCivilization', confirmed: true },
    ];
    for (const command of good) assert.ok(parseDebugCommandFile(JSON.stringify({ command, delayMs: 10 })), JSON.stringify(command));
    assert.deepEqual([...new Set(good.map((c) => (c as { type: string }).type))].sort(), [...DEBUG_COMMAND_TYPES].sort(), 'the tests cover the whole allow-list');
    const bad: unknown[] = [
        { type: 'grantIndustrialOutput', amount: -1 }, { type: 'grantIndustrialOutput', amount: 0 }, { type: 'grantIndustrialOutput', amount: Number.NaN }, { type: 'grantIndustrialOutput', amount: '5' },
        { type: 'grantIndustrialOutput', amount: DEBUG_LIMITS.maxIndustrialOutputGrant * 10 }, { type: 'grantIndustrialOutput', amount: null }, { type: 'grantIndustrialOutput' }, { type: 'grantIndustrialOutput', amount: 5, extra: 1 },
        { type: 'setProducerLevel', producerId: 'fabricator', level: -1 }, { type: 'setProducerLevel', producerId: 'fabricator', level: 1.5 }, { type: 'setProducerLevel', producerId: 'fabricator', level: DEBUG_LIMITS.maxProducerLevel + 1 },
        { type: 'setProducerLevel', producerId: '../x', level: 1 }, { type: 'setProducerLevel', level: 1 }, { type: 'setProducerLevel', producerId: 'fabricator' },
        { type: 'setEra', eraId: '' }, { type: 'setEra', eraId: 'A B' }, { type: 'setEra' }, { type: 'setEra', eraId: 7 },
        { type: 'setRobotsBuilt', amount: -1 }, { type: 'setRobotsBuilt', amount: 1.5 }, { type: 'setRobotsBuilt', amount: DEBUG_LIMITS.maxRobotsBuilt + 1 },
        { type: 'grantAiCores', amount: 0 }, { type: 'grantAiCores', amount: -2 }, { type: 'grantAiCores', amount: 2.5 }, { type: 'grantAiCores', amount: DEBUG_LIMITS.maxAiCoresGrant + 1 },
        { type: 'createPendingOffline', seconds: 0 }, { type: 'createPendingOffline', seconds: -5 }, { type: 'createPendingOffline', seconds: 1.5 }, { type: 'createPendingOffline', seconds: DEBUG_LIMITS.maxOfflineSeconds + 1 }, { type: 'createPendingOffline', seconds: Number.POSITIVE_INFINITY },
        { type: 'previewReboot', extra: true }, { type: 'mockFounderOwned' }, { type: 'mockFounderOwned', owned: 'true' }, { type: 'mockFounderOwned', owned: true, extra: 1 },
        { type: 'manualProduce' }, { type: 'buyProducerLevels', producerId: 'fabricator', quantity: 1 }, { type: 'statePatch' }, { type: 'grantFounderPack', requestId: 'x', source: 'mock', grantedAtUtcMs: 1 },
        'grantAiCores', null, [],
    ];
    for (const command of bad) {
        assert.equal(parseDebugCommandFile(JSON.stringify({ command })), null, JSON.stringify(command));
        assert.equal(parseDebugCommandSequenceFile(JSON.stringify({ command })), null, JSON.stringify(command));
    }
    assert.equal(parseDebugStatePatch({ type: 'previewReboot' }), null, 'only the state-patch types are patches');
});

test('debug command sequence file: single form kept, sequences are all-or-nothing and bounded', () => {
    const single = parseDebugCommandSequenceFile(JSON.stringify({ command: { type: 'grantAiCores', amount: 2 }, delayMs: 7 }));
    assert.deepEqual(single, [{ command: { type: 'grantAiCores', amount: 2 }, delayMs: 7 }]);
    const one = { command: { type: 'previewReboot' }, delayMs: 1 };
    const many = parseDebugCommandSequenceFile(JSON.stringify({ commands: [one, one, one] }));
    assert.equal(many?.length, 3);
    assert.equal(parseDebugCommandSequenceFile(JSON.stringify({ commands: [one, { command: { type: 'grantAiCores', amount: -1 } }] })), null, 'one bad item rejects the whole file');
    assert.equal(parseDebugCommandSequenceFile(JSON.stringify({ commands: [] })), null);
    assert.equal(parseDebugCommandSequenceFile(JSON.stringify({ commands: Array.from({ length: DEBUG_COMMAND_MAX_SEQUENCE + 1 }, () => one) })), null);
    assert.equal(parseDebugCommandSequenceFile(JSON.stringify({ commands: Array.from({ length: DEBUG_COMMAND_MAX_SEQUENCE }, () => ({ command: one.command, delayMs: 30000 })) })), null, 'total delay is bounded');
    assert.equal(parseDebugCommandSequenceFile('nope'), null);
    assert.equal(parseDebugCommandSequenceFile(undefined), null);
    assert.equal(parseDebugCommandSequenceFile('[]'), null);
    assert.equal(parseDebugCommandSequenceFile(JSON.stringify({ commands: 'x' })), null);
    // The legacy single-command parser still accepts only a single command.
    assert.equal(parseDebugCommandFile(JSON.stringify({ commands: [one] })), null);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Runtime debug entry

test('runtime debug state patch: applies each patch, records source debug, never mutates the input, keeps the state valid', () => {
    const base = createFreshGameState();
    base.run.producers.fabricator = { level: 3, isUnlocked: true, isBuilt: true };
    const before = JSON.stringify(base);
    const run = (patch: unknown) => executeDebugStatePatch(repository, base, patch, ON);

    const io = run({ type: 'grantIndustrialOutput', amount: 5000 });
    assert.ok(io.ok && io.source === 'debug' && io.state.run.industrialOutput === 5000);
    assert.equal(io.ok && io.state.run.statistics.industrialOutputEarned, 0, 'earned statistics (pacing) are untouched');
    const level = run({ type: 'setProducerLevel', producerId: 'assembly_station', level: 12 });
    assert.ok(level.ok && JSON.stringify(level.state.run.producers.assembly_station) === JSON.stringify({ level: 12, isUnlocked: true, isBuilt: true }));
    const zero = run({ type: 'setProducerLevel', producerId: 'fabricator', level: 0 });
    assert.ok(zero.ok && zero.state.run.producers.fabricator.isBuilt === false && zero.state.run.producers.fabricator.isUnlocked === true);
    const era = run({ type: 'setEra', eraId: 'robotics_complex' });
    assert.ok(era.ok && era.state.run.currentEraId === 'robotics_complex');
    const robots = run({ type: 'setRobotsBuilt', amount: 250 });
    assert.ok(robots.ok && robots.state.run.robotsBuilt === 250 && robots.state.run.statistics.robotsBuiltPeak === 250 && robots.state.lifetime.robotsBuilt === 250);
    const cores = run({ type: 'grantAiCores', amount: 4 });
    assert.ok(cores.ok && cores.state.meta.aiCores === 4 && cores.state.meta.lifetimeAiCoresEarned === 4);
    assert.equal(JSON.stringify(base), before, 'the input state is never mutated');

    const unknownProducer = run({ type: 'setProducerLevel', producerId: 'nope', level: 1 });
    assert.ok(!unknownProducer.ok && unknownProducer.reason === 'unknown_producer' && unknownProducer.source === 'debug');
    const unknownEra = run({ type: 'setEra', eraId: 'nope' });
    assert.ok(!unknownEra.ok && unknownEra.reason === 'unknown_era');
    const backwards = executeDebugStatePatch(repository, era.ok ? era.state : base, { type: 'setEra', eraId: 'manual_workshop' }, ON);
    assert.ok(!backwards.ok && backwards.reason === 'era_not_forward', 'the normal era rule: forward only');
    const lowerRobots = executeDebugStatePatch(repository, robots.ok ? robots.state : base, { type: 'setRobotsBuilt', amount: 5 }, ON);
    assert.ok(lowerRobots.ok && lowerRobots.state.run.statistics.robotsBuiltPeak === 250 && lowerRobots.state.lifetime.robotsBuilt === 250, 'peak / lifetime never lowered');
    for (const malformed of [null, 'x', {}, { type: 'grantAiCores' }, { type: 'grantAiCores', amount: -1 }, { type: 'setEra', eraId: 'automated_factory', extra: 1 }, { type: 'grantIndustrialOutput', amount: Number.NaN }]) {
        const rejected = run(malformed);
        assert.ok(!rejected.ok && rejected.reason === 'malformed_patch', JSON.stringify(malformed));
    }
});

test('release / diagnostics-off paths reject the debug patch: no state change, no source-of-truth edit', () => {
    const patch = { type: 'grantIndustrialOutput', amount: 5000 };
    assert.equal(createDebugGate(true, true).enabled, true);
    for (const gate of [createDebugGate(false, true), createDebugGate(true, false), createDebugGate(false, false), undefined, null, {}, { enabled: 'true' }, { enabled: 1 }] as const) {
        const runtime = new GameRuntime(repository, createFreshGameState());
        const result = runtime.applyDebugStatePatch(patch, gate as never);
        assert.ok(!result.ok && result.reason === 'debug_disabled' && result.source === 'debug', JSON.stringify(gate));
        assert.equal(runtime.getStateSnapshot().run.industrialOutput, 0);
    }
    const runtime = new GameRuntime(repository, createFreshGameState());
    assert.ok(runtime.applyDebugStatePatch(patch, ON).ok);
    assert.equal(runtime.getStateSnapshot().run.industrialOutput, 5000);
    // GameRuntime.execute never accepts the debug types (they are not GameCommands).
    for (const type of ['grantIndustrialOutput', 'setProducerLevel', 'setEra', 'setRobotsBuilt', 'grantAiCores', 'createPendingOffline', 'previewReboot', 'mockFounderOwned']) {
        const rejected = new GameRuntime(repository, createFreshGameState()).execute({ type, amount: 5, producerId: 'fabricator', level: 3, eraId: 'robotics_complex', seconds: 60, owned: true });
        assert.equal(rejected.ok, false, type);
    }
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Coordinator debug entries (patch + pending offline)

async function boot(saveText: string | undefined, nowMs = NOW_MS) {
    const storage = new InMemorySaveStorage(saveText === undefined ? {} : { [SAVE_MAIN_NAME]: saveText });
    const time = new ManualTimeService({ utcIso: new Date(nowMs).toISOString(), monotonicSeconds: 0 });
    const boot = await bootstrapGameSession({ storage, timeService: time });
    assert.equal(boot.startup.ok, true);
    if (!boot.startup.ok) throw new Error('startup failed');
    return { storage, time, session: boot.startup.session, config: boot.configRepository, startup: boot.startup };
}

test('coordinator: a gated debug patch commits then saves critically; a relaunch reproduces it; a disabled gate saves nothing', async () => {
    const { storage, session } = await presetSession('reboot-ready');
    const writes = () => storage.operationLog().filter((r) => r.operation === 'write' || r.operation === 'replace').length;
    const writesBefore = writes();
    const denied = await session.applyDebugStatePatch({ type: 'grantAiCores', amount: 9 }, createDebugGate(true, false));
    assert.equal(denied.status, 'debug_rejected');
    assert.equal(session.getStateSnapshot().meta.aiCores, 0);
    assert.equal(writes(), writesBefore, 'a rejected debug entry writes nothing');

    const applied = await session.applyDebugStatePatch({ type: 'grantAiCores', amount: 9 }, ON);
    assert.equal(applied.status, 'debug_applied_saved');
    assert.equal(applied.source, 'debug');
    assert.equal(session.getStateSnapshot().meta.aiCores, 9);
    const text = await storage.readText(SAVE_MAIN_NAME);
    assert.ok(text);
    const relaunch = await boot(text, NOW_MS + 5000);
    assert.equal(relaunch.session.getStateSnapshot().meta.aiCores, 9);
    assert.equal(relaunch.session.getStateSnapshot().meta.lifetimeAiCoresEarned, 9);
    // A malformed patch through an enabled gate is rejected too.
    assert.equal((await session.applyDebugStatePatch({ type: 'grantAiCores', amount: -3 }, ON)).status, 'debug_rejected');
});

test('coordinator: createDebugPendingOffline rewinds the absence cursor like a real absence, survives a relaunch, and is gated / bounded', async () => {
    const preset = QA_PRESETS['qa-offline'].build(NOW_MS);
    assert.equal(preset.save.kind, 'seed');
    const { storage, session } = await boot((preset.save as { text: string }).text);
    // A 5 s absence leaves a sub-minute preview that the UI collects silently at startup (AUT-051b); do the same before simulating the absence.
    assert.equal((await session.collectPendingOffline()).status === 'no_pending_preview', false);
    assert.equal(session.getPendingOfflinePreview(), null);
    assert.equal((await session.createDebugPendingOffline(3 * 3600, createDebugGate(false, true))).status, 'debug_rejected');
    assert.equal(session.getPendingOfflinePreview(), null);
    for (const bad of [0, -1, 1.5, Number.NaN, '60', null, DEBUG_LIMITS.maxOfflineSeconds + 1]) {
        const rejected = await session.createDebugPendingOffline(bad, ON);
        assert.equal(rejected.status, 'debug_rejected', String(bad));
    }
    const created = await session.createDebugPendingOffline(3 * 3600, ON);
    assert.equal(created.status, 'debug_pending_offline_created');
    assert.equal(created.source, 'debug');
    const pending = session.getPendingOfflinePreview();
    assert.ok(pending && pending.status === 'preview_ready');
    assert.equal((await session.createDebugPendingOffline(3600, ON)).status, 'debug_rejected', 'one pending report at a time');
    // A kill / relaunch shows the same report (the saved cursor is the rewound absence start).
    const text = await storage.readText(SAVE_MAIN_NAME);
    assert.ok(text);
    const relaunch = await boot(text, NOW_MS + 2000);
    const again = relaunch.session.getPendingOfflinePreview();
    assert.ok(again && again.status === 'preview_ready');
    // The collect pays through the normal path.
    const collected = await session.collectPendingOffline();
    assert.ok(collected.status === 'collected_saved' || collected.status === 'no_reward_saved');
    assert.equal(session.getPendingOfflinePreview(), null);
    // A state with nothing automated yields no collectible report.
    const fresh = await boot(undefined);
    assert.equal((await fresh.session.createDebugPendingOffline(3 * 3600, ON)).status, 'debug_rejected');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Binding: source tagging, analytics exclusion, resync

test('binding: debug-sourced submits are tagged (not for analytics), normal submits are not; a patch re-syncs the views without events', async () => {
    const { session, config } = await boot(serializeQaSave(createFreshGameState(), NOW_MS, 5));
    const seen: Array<{ types: string[]; source: string | undefined }> = [];
    const hudModels: unknown[] = [];
    const binding = new FactoryWorldStateBinding({
        session, configRepository: config, automation: null, hud: { refresh: (model) => { hudModels.push(model); } }, panel: null,
        observeDomainEvents: (events, source) => { seen.push({ types: events.map((e) => e.type), source }); },
    });
    await binding.submit({ type: 'manualProduce' });
    await binding.submit({ type: 'manualProduce' }, { source: 'debug' });
    assert.deepEqual(seen.map((s) => s.source), [undefined, 'debug']);
    const hudBefore = hudModels.length;
    const result = await binding.applyDebugStatePatch({ type: 'grantIndustrialOutput', amount: 1234 }, ON);
    assert.equal(result?.status, 'debug_applied_saved');
    assert.equal(seen.length, 2, 'a patch emits no domain event: analytics and presentation observers never see it');
    assert.ok(hudModels.length > hudBefore, 'the views were re-synced');
    assert.equal((await binding.applyDebugStatePatch({ type: 'grantIndustrialOutput', amount: 1 }, createDebugGate(false, true)))?.status, 'debug_rejected');
    // A port without debug support (a release-like minimal port) returns null and changes nothing.
    const minimal = new FactoryWorldStateBinding({ session: { getStateSnapshot: () => session.getStateSnapshot(), execute: (c: never, o: never) => session.execute(c, o), advanceActiveSessionFromClock: () => session.advanceActiveSessionFromClock(), suspend: () => session.suspend(), resume: () => session.resume() }, configRepository: config, automation: null, hud: null, panel: null });
    assert.equal(await minimal.applyDebugStatePatch({ type: 'grantAiCores', amount: 1 }, ON), null);
    assert.equal(await minimal.createDebugPendingOffline(600, ON), null);
});

test('founder: the debug Founder grant uses the real path exactly once (2 Surges), tagged debug; not-owned never revokes', async () => {
    const { session, config } = await boot(serializeQaSave(createFreshGameState(), NOW_MS, 5));
    const sources: Array<string | undefined> = [];
    const binding = new FactoryWorldStateBinding({ session, configRepository: config, automation: null, hud: null, panel: null, observeDomainEvents: (_events, source) => { sources.push(source); } });
    const first = await binding.applyFounderPackPurchase({ requestId: 'debug_founder_1', source: 'mock' }, { source: 'debug' });
    assert.equal(first?.status, 'applied_saved');
    assert.ok(isFounderPackOwned(session.getStateSnapshot()));
    assert.equal(getFounderSurgeChargesRemaining(session.getStateSnapshot()), 2);
    const replay = await binding.applyFounderPackPurchase({ requestId: 'debug_founder_2', source: 'mock' }, { source: 'debug' });
    assert.equal(replay?.status, 'already_applied');
    assert.equal(getFounderSurgeChargesRemaining(session.getStateSnapshot()), 2, 'no second grant');
    await binding.reconcileFounderEntitlement({ owned: false, source: 'mock' }, { source: 'debug' });
    assert.ok(isFounderPackOwned(session.getStateSnapshot()), 'a not-owned report never revokes');
    assert.deepEqual(sources, ['debug'], 'only the applied grant fanned out events, tagged debug');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Executor (fake port)

function fakePort(overrides: Partial<DebugCommandPort> = {}): { port: DebugCommandPort; calls: string[]; emitted: Array<{ phase: string; payload: Record<string, unknown> }> } {
    const calls: string[] = [];
    const emitted: Array<{ phase: string; payload: Record<string, unknown> }> = [];
    const port: DebugCommandPort = {
        gate: ON,
        wait: async (ms) => { calls.push(`wait:${ms}`); },
        submit: async (command) => { calls.push(`submit:${command.type}`); return { ok: true }; },
        applyStatePatch: async (patch) => { calls.push(`patch:${patch.type}`); return { ok: true }; },
        createPendingOffline: async (seconds) => { calls.push(`offline:${seconds}`); return { ok: true }; },
        previewReboot: async () => { calls.push('previewReboot'); return { ok: true }; },
        setFounderOwned: async (owned) => { calls.push(`founder:${owned}`); return { ok: true }; },
        emit: (phase, payload) => { emitted.push({ phase, payload }); },
        ...overrides,
    };
    return { port, calls, emitted };
}

test('executor: runs each command once in order with the right entry, every event carries source debug', async () => {
    const requests = QA_PATCHES_SEQUENCE;
    const { port, calls, emitted } = fakePort();
    const records = await runDebugCommands(port, requests);
    assert.equal(records.length, requests.length);
    assert.deepEqual(calls.filter((c) => !c.startsWith('wait:')), ['patch:grantIndustrialOutput', 'patch:setProducerLevel', 'patch:setRobotsBuilt', 'patch:grantAiCores', 'founder:true', 'previewReboot']);
    assert.deepEqual(calls.filter((c) => c.startsWith('wait:')).length, requests.length);
    const applied = emitted.filter((e) => e.phase === 'applied');
    assert.equal(applied.length, requests.length);
    assert.ok(emitted.every((e) => e.payload.source === 'debug'));
    assert.deepEqual(applied.map((e) => e.payload.index), [0, 1, 2, 3, 4, 5]);
    // GameCommand-backed commands go through submit.
    const second = fakePort();
    await runDebugCommands(second.port, [{ command: { type: 'purchaseBreakthrough', breakthroughId: 'advanced_robotics' }, delayMs: 0 }, { command: { type: 'rebootCivilization', confirmed: true }, delayMs: 0 }, { command: { type: 'createPendingOffline', seconds: 90 }, delayMs: 0 }]);
    assert.deepEqual(second.calls.filter((c) => !c.startsWith('wait:')), ['submit:purchaseBreakthrough', 'submit:rebootCivilization', 'offline:90']);
});

test('executor: refuses to run without an enabled gate; a throwing entry is reported and the sequence continues', async () => {
    for (const gate of [createDebugGate(false, true), createDebugGate(true, false)]) {
        const { port, calls, emitted } = fakePort({ gate });
        const records = await runDebugCommands(port, QA_PATCHES_SEQUENCE);
        assert.equal(records.length, 0);
        assert.deepEqual(calls, [], 'nothing was waited for or executed');
        assert.deepEqual(emitted.map((e) => e.phase), ['rejected']);
        assert.equal(emitted[0].payload.reason, 'debug_disabled');
    }
    const { port, emitted } = fakePort({ applyStatePatch: async () => { throw new Error('boom'); } });
    const records = await runDebugCommands(port, [{ command: { type: 'grantAiCores', amount: 1 }, delayMs: 0 }, { command: { type: 'previewReboot' }, delayMs: 0 }]);
    assert.deepEqual(records.map((r) => [r.type, r.ok]), [['grantAiCores', false], ['previewReboot', true]]);
    assert.equal(emitted.filter((e) => e.phase === 'applied').length, 2);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Presets: every preset is a valid save and reaches its state

test('every preset builds a loadable save (valid current-version envelope) and valid debug scripts', async () => {
    assert.equal(CURRENT_SAVE_VERSION, 3, 'AUT-069 changes no save schema');
    for (const preset of Object.values(QA_PRESETS)) {
        const plan = preset.build(NOW_MS);
        assert.ok(preset.reaches.length > 20 && preset.family.length > 0, preset.id);
        if (plan.save.kind === 'seed') {
            const { startup } = await boot(plan.save.text);
            assert.equal(startup.status, 'loaded_main', preset.id);
        } else {
            assert.equal(preset.id, 'fresh-start');
            assert.equal(plan.save.kind, 'fresh');
        }
        for (const [name, text] of Object.entries(plan.files)) {
            assert.ok(QA_MANAGED_FILES.includes(name), `${preset.id}: ${name} is a managed debug file`);
            if (name === DEBUG_COMMAND_FILE) assert.ok(parseDebugCommandSequenceFile(text), preset.id);
            if (name === DEBUG_ADS_FILE) assert.ok(parseDebugAdsScriptFile(text), preset.id);
            if (name === DEBUG_PURCHASE_FILE) assert.ok(parseDebugPurchaseScriptFile(text), preset.id);
            if (name === DEBUG_CONSENT_FILE) assert.ok(parseDebugConsentScriptFile(text), preset.id);
        }
    }
    for (const id of ['fresh-start', 'first-worker-bot', 'era-2', 'era-3', 'era-3-worst-case', 'reboot-ready', 'post-reboot', 'ai-upgrades-affordable', 'offline-short', 'offline-long', 'offline-double-eligible', 'extended-overclock-eligible', 'founder-available', 'founder-owned', 'purchase-pending', 'consent-required']) {
        assert.ok(resolveQaPreset(id), `the required preset ${id} exists`);
    }
    assert.equal(resolveQaPreset('nope'), null);
    assert.equal(resolveQaPreset('__proto__'), null);
});

async function presetSession(id: string) {
    const plan = QA_PRESETS[id].build(NOW_MS);
    assert.equal(plan.save.kind, 'seed');
    return boot((plan.save as { text: string }).text);
}

test('presets reach their MVP states', async () => {
    const first = await presetSession('first-worker-bot');
    const firstState = first.session.getStateSnapshot();
    assert.ok(!firstState.run.purchasedBreakthroughIds.includes('worker_bot') && firstState.run.industrialOutput > 0);

    assert.equal((await presetSession('era-2')).session.getStateSnapshot().run.currentEraId, 'automated_factory');
    assert.equal((await presetSession('era-3')).session.getStateSnapshot().run.currentEraId, 'robotics_complex');
    const worst = (await presetSession('era-3-worst-case')).session.getStateSnapshot();
    assert.equal(worst.run.currentEraId, 'robotics_complex');
    assert.ok(Object.values(worst.run.producers).filter((p) => p.level === 100).length >= 5 && worst.run.robotsBuilt >= 1_000_000);

    const reboot = await presetSession('reboot-ready');
    const view = createRebootPanelViewModel(reboot.config, reboot.session.getStateSnapshot());
    assert.equal(view.visible, true);
    assert.ok(view.aiCoresToGain > 0);
    assert.equal(reboot.session.getPendingOfflinePreview(), null, 'no report blocks the Reboot');
    assert.deepEqual(JSON.parse(QA_PRESETS['reboot-preview'].build(NOW_MS).files[DEBUG_COMMAND_FILE]).command, { type: 'previewReboot' });

    const post = (await presetSession('post-reboot')).session.getStateSnapshot();
    assert.equal(post.meta.civilizationNumber, 2);
    assert.ok(post.meta.aiCores > 0 && post.lifetime.rebootsCompleted === 1);

    const ai = await presetSession('ai-upgrades-affordable');
    const panel = createPermanentUpgradePanelViewModel(ai.config, ai.session.getStateSnapshot());
    assert.ok(panel.rows.some((row) => row.state === 'affordable'), 'an AI upgrade is affordable');

    const short = await presetSession('offline-short');
    assert.ok(short.session.getPendingOfflinePreview(), 'a 20 min absence shows a report');
    assert.equal(short.session.getOfflineDoubleOffer()?.eligibility.eligible, false, 'x2 is below the 30 min minimum');
    const long = await presetSession('offline-long');
    assert.ok(long.session.getPendingOfflinePreview());
    assert.equal(long.session.getOfflineDoubleOffer()?.eligibility.eligible, true);
    const cap = await presetSession('offline-cap');
    const capPreview = cap.session.getPendingOfflinePreview();
    assert.ok(capPreview && capPreview.status === 'preview_ready');
    const dbl = await presetSession('offline-double-eligible');
    assert.equal(dbl.session.getOfflineDoubleOffer()?.eligibility.eligible, true);
    assert.deepEqual(parseDebugAdsScriptFile(QA_PRESETS['offline-double-eligible'].build(NOW_MS).files[DEBUG_ADS_FILE])?.offlineDouble, ['rewarded']);

    const ext = await presetSession('extended-overclock-eligible');
    await ext.session.collectPendingOffline(); // the 1 s absence leaves a sub-minute preview the UI collects silently at startup
    assert.equal(ext.session.getExtendedOverclockOffer().eligibility.eligible, true);
    assert.equal(ext.session.getExtendedOverclockOffer().activeBlocked, false);

    const available = (await presetSession('founder-available')).session.getStateSnapshot();
    assert.equal(isFounderPackOwned(available), false);
    assert.deepEqual(parseDebugPurchaseScriptFile(QA_PRESETS['founder-available'].build(NOW_MS).files[DEBUG_PURCHASE_FILE])?.outcomes, ['completed']);
    const owned = (await presetSession('founder-owned')).session.getStateSnapshot();
    assert.ok(isFounderPackOwned(owned));
    assert.equal(getFounderSurgeChargesRemaining(owned), 2);
    const pending = await presetSession('purchase-pending');
    assert.equal(isFounderPackOwned(pending.session.getStateSnapshot()), false);
    assert.deepEqual(parseDebugPurchaseScriptFile(QA_PRESETS['purchase-pending'].build(NOW_MS).files[DEBUG_PURCHASE_FILE])?.outcomes, ['pending']);

    assert.equal(parseDebugConsentScriptFile(QA_PRESETS['consent-required'].build(NOW_MS).files[DEBUG_CONSENT_FILE])?.state, 'required_obtained');
    assert.equal(parseDebugConsentScriptFile(QA_PRESETS['consent-declined'].build(NOW_MS).files[DEBUG_CONSENT_FILE])?.state, 'required_declined');
    // The toolkit scenario states: the patches state is Reboot-eligible, the offline state has an automated producer and no report on launch.
    const patchesPlan = buildQaScenarioPlan('patches', NOW_MS);
    assert.equal(JSON.parse(patchesPlan.files[DEBUG_COMMAND_FILE]).commands.length, QA_TOOLKIT_EXPECTED_TYPES.patches.length);
    assert.deepEqual(JSON.parse(patchesPlan.files[DEBUG_COMMAND_FILE]).commands.map((c: { command: { type: string } }) => c.command.type), [...QA_TOOLKIT_EXPECTED_TYPES.patches]);
    assert.deepEqual(parseDebugCommandSequenceFile(buildQaScenarioPlan('offline', NOW_MS).files[DEBUG_COMMAND_FILE])?.map((r) => r.command.type), [...QA_TOOLKIT_EXPECTED_TYPES.offline]);
});

test('the patches sequence works end to end on the qa-patches state (real session, gated patches + founder grant), staying Reboot-eligible', async () => {
    const { session, config } = await presetSession('qa-patches');
    const binding = new FactoryWorldStateBinding({ session, configRepository: config, automation: null, hud: null, panel: null });
    const outputBefore = session.getStateSnapshot().run.industrialOutput;
    for (const request of QA_PATCHES_SEQUENCE) {
        const command = request.command;
        if (command.type === 'grantIndustrialOutput' || command.type === 'setProducerLevel' || command.type === 'setRobotsBuilt' || command.type === 'grantAiCores') assert.equal((await binding.applyDebugStatePatch(command, ON))?.status, 'debug_applied_saved', command.type);
        if (command.type === 'mockFounderOwned') assert.equal((await binding.applyFounderPackPurchase({ requestId: 'd', source: 'mock' }, { source: 'debug' }))?.status, 'applied_saved');
    }
    const state = session.getStateSnapshot();
    assert.ok(state.run.industrialOutput >= outputBefore + 5000);
    assert.equal(state.run.producers.fabricator.level, 55);
    assert.equal(state.run.robotsBuilt, 120);
    assert.equal(state.meta.aiCores, 3);
    assert.ok(isFounderPackOwned(state));
    assert.equal(createRebootPanelViewModel(config, state).visible, true, 'the Reboot preview stays available after the patches');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Host CLI

test('CLI parsing: list, presets, commands, sequences and ads; bad input is a usage error', () => {
    assert.equal(parseQaInvocation([]).kind, 'list');
    assert.equal(parseQaInvocation(['list']).kind, 'list');
    const list = renderQaList();
    for (const id of Object.keys(QA_PRESETS)) assert.match(list, new RegExp(`\\b${id}\\b`));
    for (const name of QA_COMMAND_NAMES.filter((n) => n !== 'founder' && n !== 'reboot' && n !== 'breakthrough')) assert.match(list, new RegExp(name));

    const cmd = parseQaInvocation(['cmd', 'grant-io', '5000']);
    assert.equal(cmd.kind, 'plan');
    if (cmd.kind !== 'plan') return;
    const cmdPlan = cmd.plan(NOW_MS);
    assert.equal(cmdPlan.save.kind, 'keep');
    assert.deepEqual(JSON.parse(cmdPlan.files[DEBUG_COMMAND_FILE]), { command: { type: 'grantIndustrialOutput', amount: 5000 }, delayMs: 0 });

    const seq = parseQaInvocation(['seq', 'grant-io 5000', 'set-era automated_factory', 'founder owned']);
    assert.ok(seq.kind === 'plan' && parseDebugCommandSequenceFile(seq.plan(NOW_MS).files[DEBUG_COMMAND_FILE])?.length === 3);

    const ads = parseQaInvocation(['ads', 'offline-double', 'failure', 'success']);
    assert.ok(ads.kind === 'plan');
    if (ads.kind === 'plan') assert.deepEqual(parseDebugAdsScriptFile(ads.plan(NOW_MS).files[DEBUG_ADS_FILE])?.offlineDouble, ['failed', 'rewarded']);
    assert.deepEqual(parseDebugAdsScriptFile(buildQaAdsFile('both', ['closed']))?.extendedOverclock, ['closed']);
    assert.deepEqual(QA_ADS_PLACEMENTS, ['offline-double', 'extended-overclock', 'both']);
    assert.equal(resolveQaAdsOutcome('success'), 'rewarded');
    assert.equal(resolveQaAdsOutcome('failure'), 'failed');
    assert.equal(resolveQaAdsOutcome('timeout'), 'timeout');

    for (const bad of [['bogus'], ['cmd'], ['cmd', 'grant-io'], ['cmd', 'grant-io', '-5'], ['cmd', 'grant-io', 'NaN'], ['cmd', 'grant-io', 'abc'], ['cmd', 'grant-io', '1e99'], ['cmd', 'set-producer', 'fabricator', '9999'],
        ['cmd', 'set-era', 'Bad Era'], ['cmd', 'pending-offline', '0'], ['cmd', 'founder', 'maybe'], ['cmd', 'reboot-preview', 'x'], ['seq'], ['seq', 'grant-io -1'], ['ads', 'nope', 'success'], ['ads', 'both'], ['ads', 'both', 'weird'],
        ['era-2', 'extra']]) {
        assert.throws(() => parseQaInvocation(bad), QaUsageError, bad.join(' '));
    }
    assert.throws(() => buildQaCommandFile([{ command: { type: 'grantAiCores', amount: -1 } as never, delayMs: 0 }]), QaUsageError);
    assert.throws(() => buildQaAdsFile('both', []), QaUsageError);
    assert.deepEqual(parseQaCommandWords(['founder', 'not-owned']).command, { type: 'mockFounderOwned', owned: false });
    assert.deepEqual(parseQaCommandWords(['breakthrough', 'advanced_robotics']).command, { type: 'purchaseBreakthrough', breakthroughId: 'advanced_robotics' });
    assert.deepEqual(parseQaCommandWords(['reboot']).command, { type: 'rebootCivilization', confirmed: true });
});

test('applyQaPlan: a preset clears stale files first and writes save then scripts then launches; a command keeps the save', async () => {
    const calls: string[] = [];
    const driver = {
        forceStop: async (pkg: string) => { calls.push(`forceStop:${pkg}`); },
        appDataDirectory: async () => '/data/data/pkg',
        removeAppFiles: async (_pkg: string, files: string[]) => { calls.push(`remove:${files.map((f) => f.split('/').pop()).join(',')}`); },
        writeAppFile: async (_pkg: string, file: string, text: string) => { calls.push(`write:${file.split('/').pop()}:${text.length > 0}`); },
        launch: async (_pkg: string, activity: string) => { calls.push(`launch:${activity}`); },
    };
    await applyQaPlan(driver as never, QA_PRESETS['founder-available'].build(NOW_MS));
    assert.equal(calls[0], 'forceStop:com.projectautomata.androidbaseline');
    assert.match(calls[1], /^remove:save_main\.json,save_backup\.json,save_temp\.json,debug_command\.json,debug_ads\.json,debug_purchase\.json,debug_consent\.json,population_benchmark\.json$/);
    assert.deepEqual(calls.slice(2), ['write:save_main.json:true', 'write:debug_purchase.json:true', 'launch:com.cocos.game.AppActivity']);

    calls.length = 0;
    await applyQaPlan(driver as never, QA_PRESETS['fresh-start'].build(NOW_MS));
    assert.ok(!calls.some((c) => c.startsWith('write:')), 'fresh start writes nothing: the saves are only removed');

    calls.length = 0;
    const cmd = parseQaInvocation(['cmd', 'grant-ai-cores', '3']);
    assert.ok(cmd.kind === 'plan');
    if (cmd.kind === 'plan') await applyQaPlan(driver as never, cmd.plan(NOW_MS));
    assert.equal(calls[1], 'remove:debug_command.json', 'the save is NOT removed');
    assert.deepEqual(calls.slice(2), ['write:debug_command.json:true', 'launch:com.cocos.game.AppActivity']);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Safety: source scans

const DEBUG_ENTRY_NAMES = ['applyDebugStatePatch', 'createDebugPendingOffline', 'executeDebugStatePatch', 'runDebugCommands'];
const GUARD = "if (DEBUG !== true || !isDeviceDiagnosticsEnabled()) return";

test('safety: debug entries are defined only in the allow-listed modules and called only from the guarded bootstrap method', () => {
    const allowedDefinitions = new Set([
        'assets/scripts/runtime/DebugStatePatch.ts', 'assets/scripts/runtime/GameRuntime.ts', 'assets/scripts/runtime/index.ts',
        'assets/scripts/lifecycle/LifecycleSessionCoordinator.ts', 'assets/scripts/presentation/FactoryWorldStateBinding.ts',
        'assets/scripts/presentation/DebugCommandExecutor.ts', 'assets/scripts/presentation/FactoryWorldBootstrap.ts',
    ]);
    assert.doesNotMatch(read('assets/scripts/presentation/FactoryWorldBootstrap.ts'), /import[^;]*['"]\.\.\/runtime/, 'the bootstrap never imports the runtime layer (the gate factory is re-exported by the executor)');
    const referencing = walk('assets/scripts').filter((file) => DEBUG_ENTRY_NAMES.some((name) => read(file).includes(name)));
    for (const file of referencing) assert.ok(allowedDefinitions.has(file), `${file} must not reference a debug entry`);

    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    const body = methodBody(bootstrap, 'private runDebugCommandFile(binding: FactoryWorldStateBinding): void {');
    assert.match(body, new RegExp(`^[^\\n]*\\n\\s*${GUARD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')};`), 'the guard is the first statement');
    // Every debug entry the bootstrap calls lives inside that one guarded method.
    const bootstrapCode = bootstrap.split(String.fromCharCode(10)).filter((line) => !line.startsWith('import ')).join(String.fromCharCode(10));
    for (const name of DEBUG_ENTRY_NAMES) {
        const total = (bootstrapCode.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length;
        const inside = (body.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length;
        assert.equal(total, inside, `${name}: every bootstrap reference is inside runDebugCommandFile`);
    }
    assert.equal((bootstrap.match(/createDebugGate\(/g) ?? []).length, 1, 'the one gate is built in the guarded method from DEBUG and diagnostics');
    assert.match(body, /createDebugGate\(DEBUG === true, isDeviceDiagnosticsEnabled\(\)\)/);
    assert.equal((bootstrap.match(/\.applyDebugStatePatch\(|\.createDebugPendingOffline\(/g) ?? []).length, 2);
    // Debug-sourced events never reach analytics.
    assert.match(bootstrap, /if \(source !== 'debug'\) this\.analytics\?\.observeDomainEvents\(events\);/);
    // The pending-offline / state-patch methods of the coordinator and runtime all demand a gate and check it.
    const coordinator = read('assets/scripts/lifecycle/LifecycleSessionCoordinator.ts');
    assert.match(coordinator, /async applyDebugStatePatch\(patch: unknown, gate: DebugGate\)/);
    assert.match(coordinator, /async createDebugPendingOffline\(seconds: unknown, gate: DebugGate\)/);
    assert.match(coordinator, /if \(!isDebugGateEnabled\(gate\)\) return rejected\('debug_disabled'/);
    assert.match(read('assets/scripts/runtime/DebugStatePatch.ts'), /if \(!isDebugGateEnabled\(gate\)\) return reject\('debug_disabled'/);
    assert.match(read('assets/scripts/runtime/GameRuntime.ts'), /applyDebugStatePatch\(patch: unknown, gate: DebugGate\): DebugPatchResult/);
});

test('safety: every debug file is read only behind DEBUG (+ diagnostics for the four scripts), and only by the known readers', () => {
    const readers = walk('assets/scripts').filter((file) => /readText\(\s*(DEBUG_[A-Z]+_FILE|POPULATION_BENCHMARK_FILE)/.test(read(file)));
    assert.deepEqual(readers.sort(), ['assets/scripts/presentation/FactoryWorldBootstrap.ts', 'assets/scripts/presentation/RobotPopulationController.ts']);
    const bootstrap = read('assets/scripts/presentation/FactoryWorldBootstrap.ts');
    for (const [signature, fileConstant] of [
        ['private readDebugAdsScript(): DebugAdsScript | undefined {', 'DEBUG_ADS_FILE'],
        ['private readDebugPurchaseScript(): DebugPurchaseScript | undefined {', 'DEBUG_PURCHASE_FILE'],
        ['private readDebugConsentScript(): DebugConsentScript | undefined {', 'DEBUG_CONSENT_FILE'],
        ['private runDebugCommandFile(binding: FactoryWorldStateBinding): void {', 'DEBUG_COMMAND_FILE'],
    ] as const) {
        const body = methodBody(bootstrap, signature);
        const firstStatement = body.slice(body.indexOf('{') + 1).trimStart().split('\n')[0];
        assert.match(firstStatement, /^if \(DEBUG !== true \|\| !isDeviceDiagnosticsEnabled\(\)\) return/, signature);
        assert.ok(body.indexOf('readText(') > body.indexOf(GUARD), signature);
        assert.ok(body.includes(`readText(${fileConstant})`), signature);
        assert.ok(body.indexOf(`readText(${fileConstant})`) < body.indexOf(`remove(${fileConstant})`), 'read once, then deleted');
    }
    for (const file of ['assets/scripts/presentation/DebugCommandFile.ts', 'assets/scripts/presentation/DebugCommandExecutor.ts', 'assets/scripts/runtime/DebugStatePatch.ts']) {
        assert.doesNotMatch(read(file), /from\s+['"]cc['"]|readText\(|writeText\(|CocosFileSystemPort/, `${file}: pure, no engine, no file access`);
        assert.ok(fs.existsSync(path.join(repoRoot, `${file}.meta`)), `${file}.meta`);
        const meta = JSON.parse(read(`${file}.meta`));
        assert.match(meta.uuid, /^[0-9a-f-]{36}$/);
    }
    // The benchmark override is gated by DEBUG only (AUT-041, unchanged): documented in docs/AUT-069_DEBUG_QA_TOOLKIT.md.
    assert.match(read('assets/scripts/presentation/RobotPopulationController.ts'), /if \(DEBUG !== true\) return;\n\s*try \{\n\s*const text = new CocosFileSystemPort\(\)\.readText\(POPULATION_BENCHMARK_FILE\)/);
});

test('safety: no player-visible UI, no new GameCommand, no scene change, no save-schema change, debug types stay out of the command union', () => {
    for (const file of ['UiLayout.ts', 'CoreHudController.ts', 'CoreLoopActions.ts', 'HudViewModel.ts', 'ProducerPanelController.ts', 'RebootController.ts', 'OfflineReportController.ts', 'SettingsController.ts', 'FounderShopController.ts']) {
        const full = `assets/scripts/presentation/${file}`;
        if (!fs.existsSync(path.join(repoRoot, full))) continue;
        assert.doesNotMatch(read(full), /DebugCommand|DebugStatePatch|debug_command|createDebugGate|applyDebugStatePatch|createDebugPendingOffline/, `${file}: no player-facing debug path`);
    }
    assert.doesNotMatch(read('assets/scenes/factory/FactoryWorld.scene'), /debug_command|DebugCommand|DebugStatePatch/);
    const commands = read('assets/scripts/domain/Commands.ts');
    for (const type of ['grantIndustrialOutput', 'setProducerLevel', 'setEra', 'setRobotsBuilt', 'grantAiCores', 'createPendingOffline', 'previewReboot', 'mockFounderOwned', 'statePatch']) assert.ok(!commands.includes(type), `${type} is not a GameCommand`);
    // The persistence layer and the state shape do not know the debug toolkit (no schema change).
    for (const file of walk('assets/scripts/persistence').concat(walk('assets/scripts/state'))) assert.doesNotMatch(read(file), /DEBUG_SOURCE|DebugStatePatch|debug/i, file);
    assert.ok(DEVICE_EVENT_TYPES.includes('debug_command'));
    assert.ok(DEFAULT_REVEAL_EVENT_TYPES.includes('debug_command'), 'the capture records the debug_command timeline');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Device scenarios + objective checks

function ev(tMs: number, evt: string, fields: Record<string, unknown> = {}) {
    return { tMs, event: { v: 1, seq: tMs, evt, ...fields } };
}

function goodPatchesTimeline() {
    const types = [...QA_TOOLKIT_EXPECTED_TYPES.patches];
    return [
        ...types.map((type, index) => ev(100 + index * 10, 'debug_command', { phase: 'scheduled', source: 'debug', index, command: { type }, delayMs: 0 })),
        ...types.map((type, index) => ev(1000 + index * 800, 'debug_command', { phase: 'applied', source: 'debug', index, type, ok: true, reason: null })),
        ev(5000, 'founder_shop', { phase: 'state', reason: 'debug', owned: true, cosmetic: true, grantRecorded: true, surgeCharges: 2 }),
        ev(6000, 'reboot_ui', { phase: 'opened' }),
    ];
}

test('qa toolkit checks: the patches timeline passes; duplicates, missing source, failures, errors, a committed Reboot and a wrong Founder grant fail', () => {
    const failing = (timeline: ReturnType<typeof goodPatchesTimeline>, expect: 'patches' | 'offline' = 'patches') => evaluateQaToolkit(timeline, expect).filter((c) => !c.ok).map((c) => c.id);
    assert.deepEqual(failing(goodPatchesTimeline()), []);
    const applied = (timeline: ReturnType<typeof goodPatchesTimeline>) => timeline.filter((e) => e.event.phase === 'applied');
    assert.ok(failing([...goodPatchesTimeline(), applied(goodPatchesTimeline())[0]]).includes('qa_each_applied_exactly_once_in_order'), 'a command applied twice');
    assert.ok(failing(goodPatchesTimeline().filter((e) => !(e.event.phase === 'applied' && e.event.index === 2))).includes('qa_each_applied_exactly_once_in_order'), 'a command never applied');
    assert.ok(failing(goodPatchesTimeline().map((e) => e.event.phase === 'applied' ? { ...e, event: { ...e.event, source: 'player' } } : e)).includes('qa_source_debug'));
    assert.ok(failing(goodPatchesTimeline().map((e) => e.event.phase === 'applied' && e.event.index === 1 ? { ...e, event: { ...e.event, ok: false, reason: 'unknown_producer' } } : e)).includes('qa_all_ok'));
    assert.ok(failing([...goodPatchesTimeline(), ev(7000, 'error', { message: 'x' })]).includes('qa_no_errors'));
    assert.ok(failing([...goodPatchesTimeline(), ev(7000, 'debug_command', { phase: 'ignored', source: 'debug' })]).includes('qa_command_file_accepted'));
    assert.ok(failing([...goodPatchesTimeline(), ev(7000, 'command_result', { command: { type: 'rebootCivilization' }, ok: true })]).includes('qa_reboot_not_committed'));
    assert.ok(failing(goodPatchesTimeline().filter((e) => e.event.evt !== 'reboot_ui')).includes('qa_reboot_preview_opened'));
    assert.ok(failing(goodPatchesTimeline().map((e) => e.event.evt === 'founder_shop' ? { ...e, event: { ...e.event, surgeCharges: 4 } } : e)).includes('qa_founder_granted_once_with_two_surges'));
    assert.ok(failing([]).length > 0, 'an empty timeline fails');

    const offline = [
        ev(100, 'debug_command', { phase: 'scheduled', source: 'debug', index: 0, command: { type: 'createPendingOffline' } }),
        ev(1000, 'debug_command', { phase: 'applied', source: 'debug', index: 0, type: 'createPendingOffline', ok: true, reason: null }),
        ev(1100, 'offline_report', { phase: 'shown', status: 'preview_ready', reward: 10 }),
    ];
    assert.deepEqual(failing(offline as never, 'offline'), []);
    assert.ok(failing(offline.filter((e) => e.event.evt !== 'offline_report') as never, 'offline').includes('qa_offline_report_shown'));
});

test('scenarios are wired: table -> cli -> capture options -> evaluateRevealTimeline; the evaluator includes the toolkit checks', () => {
    for (const [id, expectation] of [['aut069-qa-patches', 'patches'], ['aut069-qa-offline', 'offline']] as const) {
        const scenario = REVEAL_SCENARIOS[id];
        assert.ok(scenario, id);
        assert.equal(scenario.expectQaToolkit, expectation);
        assert.equal(scenario.trigger, 'none');
        assert.equal(typeof scenario.seed, 'function');
    }
    const cli = read('tools/device/cli.ts');
    const capture = read('tools/device/reveal_capture.ts');
    assert.match(cli, /expectQaToolkit: scenario\.expectQaToolkit,/);
    assert.match(capture, /readonly expectQaToolkit\?: QaToolkitExpectation;/);
    assert.match(capture, /expectQaToolkit: options\.expectQaToolkit, expectSettings: options\.expectSettings, expectRebootUi: options\.expectRebootUi \}\);/);
    assert.match(capture, /if \(options\.expectQaToolkit !== undefined\) checks\.push\(\.\.\.evaluateQaToolkit\(events, options\.expectQaToolkit\)\);/);
    assert.match(cli, /command === 'qa'/);
    const pkg = JSON.parse(read('package.json'));
    assert.match(pkg.scripts['device:qa'], /tools\/device\/cli\.ts qa$/);
    const timeline = [...goodPatchesTimeline(), ev(50, 'scene_ready')];
    const checks = evaluateRevealTimeline(timeline as never, { expectConstruction: null, expectFocus: false, triggered: false, frameCount: 9, expectQaToolkit: 'patches' });
    assert.ok(checks.some((c) => c.id === 'qa_each_applied_exactly_once_in_order'));
    assert.deepEqual(checks.filter((c) => !c.ok).map((c) => c.id), []);
});
