import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createFreshGameState, createFreshRunState, type GameState } from '../assets/scripts/state/index.ts';
import type { DomainEvent } from '../assets/scripts/domain/Events.ts';
import { loadGameConfigFromSources } from '../assets/scripts/config/ConfigLoader.ts';
import { getEmbeddedEconomyConfigSources } from '../assets/scripts/config/EmbeddedEconomyConfig.ts';
import { deserializeGameStateFromSaveJson } from '../assets/scripts/persistence/index.ts';
import { purchaseBreakthrough } from '../assets/scripts/progression/index.ts';
import { ZONE_LAYOUT, factoryZoneIds } from '../assets/scripts/presentation/FactoryZoneLayout.ts';
import * as L from '../assets/scripts/presentation/EraEnvironmentLayout.ts';
import * as R from '../assets/scripts/presentation/EraEnvironmentStateResolver.ts';
import { EraEnvironmentViewModel, ERA_ENVIRONMENT_STATE_PHASES } from '../assets/scripts/presentation/EraEnvironmentViewModel.ts';
import { DEVICE_EVENT_TYPES } from '../assets/scripts/presentation/DeviceDiagnostics.ts';
import { AUT045_SEED_VARIANTS, buildAut045SeededSave, buildAut045SeededState, isAut045SeedVariant } from '../tools/device/seed_aut045.ts';
import { buildAut044SeededState } from '../tools/device/seed_aut044.ts';
import { DEFAULT_REVEAL_EVENT_TYPES, REVEAL_SCENARIOS } from '../tools/device/reveal_capture.ts';

/*
 * AUT-045 era environment: pure state -> environment resolver / transition view model, layout facts and screen limits at the
 * default portrait view, wiring (bootstrap, registry, scene), presentation-only guarantees and seed round-trips. No new asset.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), 'utf8');
const presentation = (file: string): string => read(`assets/scripts/presentation/${file}`);
/** Source without comments (doc comments may legitimately name what the code must not touch). */
const code = (file: string): string => presentation(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const repository = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());

const stateInEra = (eraId: string | null): GameState => { const state = createFreshGameState(); state.run.currentEraId = eraId; return state; };
const anEvent = { type: 'eraChanged', oldEraId: 'manual_workshop', newEraId: 'automated_factory' } as DomainEvent;

// ---------------------------------------------------------------------------------------------------------------
// Resolver: era -> environment

test('AUT-045 resolver: era -> palette / light / clear colour / groups table (Workshop, Era II, Era III) and the Workshop fallback', () => {
    const c = (r: number, g: number, b: number) => ({ r, g, b });
    const workshop = R.resolveEraEnvironment(stateInEra('manual_workshop'));
    assert.equal(workshop.eraId, 'manual_workshop');
    assert.deepEqual([workshop.hallVisible, workshop.verticalVisible, workshop.teaserVisible], [false, false, false]);
    assert.deepEqual(workshop.palette.siteBoundary, c(76, 82, 87));
    assert.deepEqual(workshop.palette.mainLogisticsSpine, c(92, 101, 104));
    assert.deepEqual(workshop.palette.futureAccessBarrier, c(52, 59, 62));
    assert.deepEqual(workshop.palette.clear, c(36, 40, 44));
    assert.deepEqual(workshop.palette.keyLightColor, c(255, 244, 226));
    assert.equal(workshop.palette.keyLightIlluminance, 45000);

    const era2 = R.resolveEraEnvironment(stateInEra('automated_factory'));
    assert.deepEqual([era2.hallVisible, era2.verticalVisible, era2.teaserVisible], [true, false, false]);
    assert.deepEqual(era2.palette.siteBoundary, c(82, 91, 98));
    assert.deepEqual(era2.palette.mainLogisticsSpine, c(104, 114, 119));
    assert.deepEqual(era2.palette.futureAccessBarrier, c(58, 68, 74));
    assert.deepEqual(era2.palette.clear, c(30, 36, 42));
    assert.deepEqual(era2.palette.keyLightColor, c(255, 252, 245));
    assert.equal(era2.palette.keyLightIlluminance, 47000);
    assert.deepEqual([era2.palette.hallFloor, era2.palette.hallWall, era2.palette.hallCap, era2.palette.hallLightBar, era2.palette.hallRoute], [c(96, 106, 112), c(66, 76, 82), c(120, 130, 134), c(255, 244, 214), c(200, 150, 60)]);

    const era3 = R.resolveEraEnvironment(stateInEra('robotics_complex'));
    assert.deepEqual([era3.hallVisible, era3.verticalVisible, era3.teaserVisible], [true, true, true]);
    assert.deepEqual(era3.palette.siteBoundary, c(62, 69, 77));
    assert.deepEqual(era3.palette.mainLogisticsSpine, c(84, 96, 104));
    assert.deepEqual(era3.palette.futureAccessBarrier, c(46, 56, 64));
    assert.deepEqual(era3.palette.clear, c(22, 28, 36));
    assert.deepEqual(era3.palette.keyLightColor, c(238, 246, 255));
    assert.equal(era3.palette.keyLightIlluminance, 43000);
    assert.deepEqual([era3.palette.hallFloor, era3.palette.hallWall, era3.palette.hallCap, era3.palette.hallLightBar, era3.palette.hallRoute], [c(70, 78, 86), c(54, 62, 70), c(196, 201, 203), c(214, 236, 240), c(74, 85, 88)]);
    assert.deepEqual([workshop.order, era2.order, era3.order], [0, 1, 2]);

    // Unknown / null era: the Workshop (the safe pre-AUT-045 look).
    for (const unknown of [null, '', 'era_iv', 'ai_megafactory']) {
        const fallback = R.resolveEraEnvironment(stateInEra(unknown));
        assert.equal(fallback.eraId, 'manual_workshop');
        assert.equal(fallback.teaserVisible, false, `${String(unknown)}: the AI Megafactory teaser is never shown outside robotics_complex`);
    }
    // The teaser is visible ONLY when the era is robotics_complex.
    for (const eraId of L.ERA_ENV_ERA_IDS) assert.equal(R.resolveEraEnvironmentForEra(eraId).teaserVisible, eraId === 'robotics_complex');
    // Keyed ONLY on currentEraId: producers, breakthroughs and Output never change the descriptor.
    const busy = stateInEra('manual_workshop');
    busy.run.producers.advanced_robotics_complex = { level: 10, isUnlocked: true, isBuilt: true };
    busy.run.purchasedBreakthroughIds = ['advanced_robotics'];
    busy.run.industrialOutput = 1e12;
    assert.deepEqual(R.resolveEraEnvironment(busy), workshop);
});

test('AUT-045 which state sets the era: Robot Line build (Era II), the Advanced Robotics breakthrough (Era III), a Reboot returns to the Workshop', () => {
    const runtime = read('assets/scripts/runtime/GameRuntime.ts');
    assert.match(runtime, /producerId === ROBOT_LINE_PRODUCER_ID\) \{\s*const transition = applyEraTransition\(repository, draft, AUTOMATED_FACTORY_ERA_ID\)/, 'Era II is entered by constructing the Robot Line');
    const natural = buildAut044SeededState('unbuilt');
    natural.run.currentEraId = 'automated_factory';
    const bought = purchaseBreakthrough(repository, natural, 'advanced_robotics');
    assert.equal(bought.status, 'success');
    if (bought.status === 'success') {
        assert.equal(bought.state.run.currentEraId, 'robotics_complex', 'Era III is entered by the Advanced Robotics breakthrough');
        assert.equal(R.resolveEraEnvironment(bought.state).teaserVisible, true);
    }
    assert.equal(createFreshRunState().currentEraId, 'manual_workshop', 'a Reboot builds a fresh run');
    assert.match(read('assets/scripts/progression/Reboot.ts'), /draft\.run = createFreshRunState\(\)/, 'Reboot replaces the run state');
    assert.deepEqual(R.resolveEraEnvironment({ ...natural, run: createFreshRunState() } as GameState), R.resolveEraEnvironmentForEra('manual_workshop'));
    // The three era ids are the configured eras.
    assert.deepEqual([...L.ERA_ENV_ERA_IDS], repository.listEras().map((era) => era.id));
});

test('AUT-045 group visibility map: hall Era II+, vertical group and teaser Era III only', () => {
    assert.deepEqual(L.ERA_ENV_GROUP_VISIBILITY.manual_workshop, { hall: false, vertical: false, teaser: false });
    assert.deepEqual(L.ERA_ENV_GROUP_VISIBILITY.automated_factory, { hall: true, vertical: false, teaser: false });
    assert.deepEqual(L.ERA_ENV_GROUP_VISIBILITY.robotics_complex, { hall: true, vertical: true, teaser: true });
    for (const eraId of L.ERA_ENV_ERA_IDS) {
        const frame = R.frameOfDescriptor(R.resolveEraEnvironmentForEra(eraId));
        for (const group of L.ERA_ENV_GROUP_IDS) assert.equal(frame.rise[group], L.ERA_ENV_GROUP_VISIBILITY[eraId][group] ? 1 : 0, `${eraId}.${group}`);
    }
});

test('AUT-045 resolver is deterministic and leaves the state untouched', () => {
    const state = stateInEra('robotics_complex');
    state.run.industrialOutput = 123;
    const before = JSON.stringify(state);
    assert.deepEqual(R.resolveEraEnvironment(state), R.resolveEraEnvironment(state));
    new EraEnvironmentViewModel().consumeEvents(state, [anEvent]);
    assert.equal(JSON.stringify(state), before);
});

// ---------------------------------------------------------------------------------------------------------------
// Transitions: snap vs live fade

test('AUT-045 timing: the cross-fade is 1.2 s (cap 1.5 s), groups rise over 1.0 s, the frame settles exactly on the target', () => {
    assert.equal(L.ERA_ENV_FADE_SECONDS, 1.2);
    assert.ok(R.ERA_ENV_FADE_DURATION <= 1.5 && R.ERA_ENV_FADE_DURATION === 1.2);
    assert.equal(L.ERA_ENV_RISE_SECONDS, 1.0);
    assert.ok(R.ERA_ENV_TRANSITION_DURATION <= 1.5, 'the whole transition never exceeds the 1.5 s cap');
    const from = R.frameOfDescriptor(R.resolveEraEnvironmentForEra('manual_workshop'));
    const target = R.resolveEraEnvironmentForEra('automated_factory');
    const start = R.blendEraEnvironmentFrame(from, target, 0);
    assert.deepEqual(start.palette, from.palette, 'starts on the source palette');
    assert.deepEqual(start.rise, from.rise, 'starts with the hall hidden');
    const half = R.blendEraEnvironmentFrame(from, target, 0.6);
    assert.ok(half.palette.keyLightIlluminance > 45000 && half.palette.keyLightIlluminance < 47000, 'illuminance is between the two eras mid-fade');
    assert.ok(half.palette.clear.r < 36 && half.palette.clear.r > 30, 'clear colour is between the two eras mid-fade');
    assert.ok(half.rise.hall > 0 && half.rise.hall < 1, 'the hall is rising');
    assert.equal(half.rise.vertical, 0);
    assert.deepEqual(R.blendEraEnvironmentFrame(from, target, 1.0).rise, { hall: 1, vertical: 0, teaser: 0 }, 'risen after 1.0 s');
    assert.notDeepEqual(R.blendEraEnvironmentFrame(from, target, 1.0).palette, target.palette, 'the palette is still fading at 1.0 s');
    assert.deepEqual(R.blendEraEnvironmentFrame(from, target, 1.2), R.frameOfDescriptor(target), 'settled at 1.2 s');
    assert.deepEqual(R.blendEraEnvironmentFrame(from, target, 5), R.frameOfDescriptor(target));
    // Monotonic towards the target.
    let last = from.palette.keyLightIlluminance;
    for (let t = 0; t <= 1.2; t += 0.1) {
        const value = R.blendEraEnvironmentFrame(from, target, t).palette.keyLightIlluminance;
        assert.ok(value >= last - 1e-9, `illuminance non-decreasing at ${t.toFixed(1)}`);
        last = value;
    }
});

test('AUT-045 view model: load / first sync snaps; a live era change fades once; a Reboot snaps back; no replay on load; no double start', () => {
    // Save load at Era III: snapped, settled, never animated.
    const loaded = new EraEnvironmentViewModel();
    const snap = loaded.syncFromState(stateInEra('robotics_complex'));
    assert.equal(snap.transitionStarted, false);
    assert.equal(snap.transitionElapsed, null);
    assert.deepEqual(snap.frame, R.frameOfDescriptor(R.resolveEraEnvironmentForEra('robotics_complex')));
    assert.equal(loaded.isTransitioning(), false);
    assert.deepEqual(loaded.advance(0.5), snap.frame, 'idle advance changes nothing');
    // The first consume before any sync is also a snap (no animation on a late first look).
    const first = new EraEnvironmentViewModel().consumeEvents(stateInEra('automated_factory'), []);
    assert.equal(first.transitionStarted, false);

    // Live Era II.
    const vm = new EraEnvironmentViewModel();
    vm.syncFromState(stateInEra('manual_workshop'));
    const live = vm.consumeEvents(stateInEra('automated_factory'), [anEvent]);
    assert.equal(live.transitionStarted, true);
    assert.equal(vm.isTransitioning(), true);
    assert.deepEqual(live.frame.rise, { hall: 0, vertical: 0, teaser: 0 }, 'the hall starts hidden');
    // Dedupe: the same era again (snapshot before / after its eraChanged event) never restarts or rewinds the fade.
    vm.advance(0.5);
    const mid = vm.getFrame();
    const again = vm.consumeEvents(stateInEra('automated_factory'), [anEvent, anEvent]);
    assert.equal(again.transitionStarted, false);
    assert.deepEqual(vm.getFrame(), mid);
    assert.equal(vm.isTransitioning(), true);
    vm.advance(0.4);
    assert.equal(vm.isTransitioning(), true, '0.9 s: still fading');
    vm.advance(0.4);
    assert.equal(vm.isTransitioning(), false, '1.3 s: settled');
    assert.deepEqual(vm.getFrame(), R.frameOfDescriptor(R.resolveEraEnvironmentForEra('automated_factory')));

    // Live Era II -> Era III: the vertical group and the teaser rise, the hall recolours.
    const up = vm.consumeEvents(stateInEra('robotics_complex'), [{ type: 'eraChanged', oldEraId: 'automated_factory', newEraId: 'robotics_complex' } as DomainEvent]);
    assert.equal(up.transitionStarted, true);
    assert.deepEqual(up.frame.rise, { hall: 1, vertical: 0, teaser: 0 });
    vm.advance(1.0);
    assert.deepEqual(vm.getFrame()?.rise, { hall: 1, vertical: 1, teaser: 1 });
    vm.advance(0.3);
    assert.equal(vm.isTransitioning(), false);

    // Reboot (era back to the Workshop): snap, no animation, everything hidden and the Workshop palette.
    const reboot = vm.consumeEvents(stateInEra('manual_workshop'), []);
    assert.equal(reboot.transitionStarted, false);
    assert.equal(reboot.snapped, true);
    assert.equal(vm.isTransitioning(), false);
    assert.deepEqual(vm.getFrame(), R.frameOfDescriptor(R.resolveEraEnvironmentForEra('manual_workshop')));
    // And a Workshop -> Era II -> Era III skip (Workshop straight to Era III) is one live transition.
    const skip = vm.consumeEvents(stateInEra('robotics_complex'), []);
    assert.equal(skip.transitionStarted, true);
    // A mid-fade second change blends from what is on screen, not from a jump.
    const midVm = new EraEnvironmentViewModel();
    midVm.syncFromState(stateInEra('manual_workshop'));
    midVm.consumeEvents(stateInEra('automated_factory'), []);
    midVm.advance(0.6);
    const before = midVm.getFrame();
    const chained = midVm.consumeEvents(stateInEra('robotics_complex'), []);
    assert.deepEqual(chained.frame, R.blendEraEnvironmentFrame(before!, R.resolveEraEnvironmentForEra('robotics_complex'), 0));
    assert.deepEqual([...ERA_ENVIRONMENT_STATE_PHASES], ['synced', 'transition_started', 'transition_finished', 'snapped']);
});

test('AUT-045 teaser animation samples: slow 3 s seam pulse 60-100%, core spins about 10 deg/s', () => {
    for (let t = 0; t < 6; t += 0.05) {
        const pulse = R.sampleTeaserSeamPulse(t);
        assert.ok(pulse >= 0.6 - 1e-9 && pulse <= 1 + 1e-9, `pulse ${pulse} at ${t}`);
    }
    assert.ok(Math.abs(R.sampleTeaserSeamPulse(0) - 1) < 1e-9);
    assert.ok(Math.abs(R.sampleTeaserSeamPulse(1.5) - 0.6) < 1e-9);
    assert.ok(Math.abs(R.sampleTeaserSeamPulse(3) - 1) < 1e-9, 'period 3 s');
    assert.equal(R.sampleTeaserCoreYaw(1, 10), 10);
    assert.equal(R.sampleTeaserCoreYaw(36, 10), 0);
    assert.equal(L.TEASER_CORE_SPIN_DEG_PER_SECOND, 10);
});

// ---------------------------------------------------------------------------------------------------------------
// Presentation-only guarantees

const lum = (c: L.Rgb): number => (0.2126 * c.r) + (0.7152 * c.g) + (0.0722 * c.b);

test('AUT-045 environment cyan is never brighter than 59,112,121 (producer lamps 82,206,224 stay the brightest); light within +-5% of 45000', () => {
    const cap = { r: 59, g: 112, b: 121 };
    assert.deepEqual(L.ERA_ENV_CYAN, cap);
    const environmentColors: L.Rgb[] = [];
    for (const box of L.ERA_ENV_BOXES) if (box.color) environmentColors.push(box.color);
    for (const color of environmentColors) {
        const isCyan = color.b > color.r + 30 && color.g > color.r + 30;
        if (isCyan) assert.ok(color.r <= cap.r && color.g <= cap.g && color.b <= cap.b, `cyan ${JSON.stringify(color)} within the cap`);
    }
    for (let t = 0; t < 3; t += 0.1) {
        const pulse = R.sampleTeaserSeamPulse(t);
        assert.ok(L.ERA_ENV_CYAN.r * pulse <= cap.r && L.ERA_ENV_CYAN.g * pulse <= cap.g && L.ERA_ENV_CYAN.b * pulse <= cap.b);
    }
    assert.ok(lum(L.ERA_ENV_CYAN) < lum({ r: 82, g: 206, b: 224 }), 'producer lamp cyan is brighter');
    for (const id of L.ERA_ENV_ERA_IDS) {
        const lux = L.ERA_ENV_PALETTES[id].keyLightIlluminance;
        assert.ok(lux >= 45000 * 0.95 && lux <= 45000 * 1.05, `${id}: ${lux} within +-5% of 45000`);
    }
    // Teaser gate reads lighter than the Era III clear colour; the sealed gate is 38,46,56.
    assert.ok(lum(L.TEASER_GATE_COLOR) > lum(L.ERA_ENV_PALETTES.robotics_complex.clear));
    assert.ok(lum(L.TEASER_APRON_COLOR) > lum(L.ERA_ENV_PALETTES.robotics_complex.clear));
});

test('AUT-045 producer slabs, zone foundations, lamps, the Fabricator foundation and guide strips are never recoloured; no new lights / shadows', () => {
    const controller = code('EraEnvironmentVisualController.ts');
    const bootstrap = presentation('FactoryWorldBootstrap.ts');
    assert.deepEqual([...L.ERA_ENV_SHELL_NODE_NAMES], ['SiteBoundary', 'MainLogisticsSpine', 'FutureAccessBarrier']);
    assert.doesNotMatch(controller, /136|foundation|Foundation|slab|lamp_o|guide_|Fabricator|Zone_|OpeningWorkshop|ARC_|ROBOT_LINE|AUTOMATED_CELL/, 'the controller never addresses producer / foundation / lamp / guide nodes');
    const owned = new Set(L.ERA_ENV_NODE_IDS);
    assert.equal(owned.size, L.ERA_ENV_NODE_IDS.length, 'unique node ids');
    for (const id of owned) assert.doesNotMatch(id, /^(foundation_slab|arc_|beam_|robot_line|cell_|Zone_|SiteBoundary|MainLogisticsSpine|FutureAccessBarrier)/, `${id} does not shadow an existing node`);
    // No palette colour equals a producer slab colour.
    for (const palette of Object.values(L.ERA_ENV_PALETTES)) {
        for (const [key, value] of Object.entries(palette)) {
            if (typeof value === 'number') continue;
            assert.ok(!(value.r === 136 && value.g === 140 && value.b === 137), `${key} is not the producer slab colour`);
        }
    }
    // The producer slab / lamp literals are still where they were (untouched by this task).
    assert.equal((bootstrap.match(/new Color\(136, 140, 137, 255\)/g) ?? []).length >= 5, true);
    assert.match(bootstrap, /\[ARC_LAMP_ON_NODE_PREFIX, new Color\(82, 206, 224, 255\)\]/);
    // Lighting: still exactly one directional light, same rotation, no shadows, no new light components.
    assert.equal((bootstrap.match(/addComponent\(DirectionalLight\)/g) ?? []).length, 1);
    assert.match(bootstrap, /lightNode\.setRotationFromEuler\(-55, -35, 0\);/);
    assert.match(bootstrap, /light\.illuminance = 45000;/);
    for (const source of [controller, code('EraEnvironmentViewModel.ts'), code('EraEnvironmentStateResolver.ts'), code('EraEnvironmentLayout.ts')]) {
        assert.doesNotMatch(source, /new DirectionalLight|SphereLight|SpotLight|PointLight|addComponent\(\w*Light\)|shadow/i, 'no new lights or shadows');
    }
});

const PURE_MODULES = ['EraEnvironmentLayout', 'EraEnvironmentStateResolver', 'EraEnvironmentViewModel'];

test('AUT-045 pure modules are engine-free and command-free; the controller never touches the runtime, state, save, camera framing or HUD', () => {
    for (const file of PURE_MODULES) {
        const source = code(`${file}.ts`);
        assert.doesNotMatch(source, /from 'cc/, `${file} imports cc`);
        assert.doesNotMatch(source, /import[^;]*Commands|\.submit\(|execute\(/, `${file} issues commands`);
        assert.doesNotMatch(source, /constructor\s*\(\s*(public|private|readonly|protected)/, `${file}: no constructor parameter properties`);
        if (/^import /m.test(source)) assert.doesNotMatch(source, /from '\.{1,2}\/[^']*(?<!\.ts)';/m, `${file} uses explicit .ts imports`);
    }
    const controller = code('EraEnvironmentVisualController.ts');
    assert.doesNotMatch(controller, /GameRuntime|persistence|economy\/|\.submit\(|HudViewModel|PresentationText|MobileCameraController|focusOn|snapToWorldTarget|setFocusBounds/, 'presentation only: no runtime, save, HUD text or camera framing / API');
    for (const file of ['EraEnvironmentVisualController.ts', 'FactoryWorldBootstrap.ts']) {
        assert.doesNotMatch(presentation(file), /\.active = false/, `${file}: visibility by scale, not node.active`);
    }
    assert.match(controller, /node\.setScale\(0, 0, 0\)/);
    assert.match(controller, /node\.setScale\(1, rise, 1\)/, 'groups rise by scale-Y');
    assert.match(controller, /getSharedMaterial\(0\)/);
    assert.match(controller, /clearColor = toColor\(palette\.clear\)/, 'the clear colour is set explicitly per era');
    assert.match(controller, /keyLight\.illuminance = palette\.keyLightIlluminance/);
    assert.doesNotMatch(controller, /keyLight\.(rotation|node|setRotation)|lightNode/, 'the key light rotation is not touched');
    assert.doesNotMatch(controller, /Selectable|ProducerSelection|zone/i, 'never selectable');
});

// ---------------------------------------------------------------------------------------------------------------
// Layout facts and no new assets

test('AUT-045 layout: hall in the free north-west block, tops, teaser budget, clear of zones and the Complex; no overlap between groups', () => {
    const floor = L.boxBounds(L.ERA_ENV_HALL_BOXES[0]);
    assert.deepEqual([floor.min.x, floor.max.x, Math.round(floor.min.z * 100) / 100, Math.round(floor.max.z * 100) / 100], [-10, -4, 0.1, 7.1]);
    assert.deepEqual(L.HALL_FLOOR_SIZE, { x: 6.0, y: 0.08, z: 7.0 });
    // Hall footprint and the teaser footprint stay clear of every zone rect (zones, routes and pan bounds are untouched).
    for (const zoneId of factoryZoneIds(ZONE_LAYOUT)) {
        const zone = ZONE_LAYOUT[zoneId];
        for (const box of L.ERA_ENV_BOXES) {
            const b = L.boxBounds(box);
            const overlapX = b.min.x < zone.x + (zone.width / 2) && b.max.x > zone.x - (zone.width / 2);
            const overlapZ = b.min.z < zone.z + (zone.depth / 2) && b.max.z > zone.z - (zone.depth / 2);
            assert.ok(!(overlapX && overlapZ), `${box.id} overlaps zone ${zoneId}`);
        }
        for (const instance of L.ERA_ENV_PREFAB_INSTANCES) {
            const b = L.prefabBounds(instance);
            const overlapX = b.min.x < zone.x + (zone.width / 2) && b.max.x > zone.x - (zone.width / 2);
            const overlapZ = b.min.z < zone.z + (zone.depth / 2) && b.max.z > zone.z - (zone.depth / 2);
            assert.ok(!(overlapX && overlapZ), `${instance.id} overlaps zone ${zoneId}`);
        }
    }
    // Tops.
    for (const post of L.ERA_ENV_HALL_POSTS) assert.ok(Math.abs(L.prefabBounds(post).max.y - 1.5) < 1e-9, `${post.id} top 1.5`);
    for (const pylon of L.ERA_ENV_PYLONS) assert.ok(L.prefabBounds(pylon).max.y <= 3.0 + 1e-9 && L.prefabBounds(pylon).max.y < 3.1, `${pylon.id} top <= 3.0 (below the Complex top 3.1)`);
    const catwalk = L.ERA_ENV_VERTICAL_BOXES.find((box) => box.id === 'catwalk')!;
    assert.deepEqual(catwalk.size, { x: 4.2, y: 0.1, z: 0.5 });
    assert.equal(catwalk.center.y, 2.2);
    assert.equal(L.ERA_ENV_VERTICAL_BOXES.filter((box) => box.id.startsWith('catwalk_lamp_')).length, 4);
    for (const flank of L.ERA_ENV_TEASER_FLANKS) assert.ok(Math.abs(L.prefabBounds(flank).max.y - 2.4) < 1e-9, `${flank.id} top 2.4`);
    // Hall: 3 light bars, 2 routing strips, 2 caps, 4 posts, walls as specified.
    assert.equal(L.ERA_ENV_HALL_BOXES.filter((box) => box.role === 'hallLightBar').length, 3);
    assert.equal(L.ERA_ENV_HALL_BOXES.filter((box) => box.role === 'hallRoute').length, 2);
    assert.equal(L.ERA_ENV_HALL_BOXES.filter((box) => box.role === 'hallCap').length, 2);
    assert.equal(L.ERA_ENV_HALL_POSTS.length, 4);
    // Teaser: static, <= 7 nodes, two distinct primitive colours for the structure plus the shared environment cyan, no label.
    assert.ok(L.teaserNodeCount() <= L.ERA_ENV_TEASER_NODE_LIMIT, `${L.teaserNodeCount()} teaser nodes`);
    assert.equal(L.teaserNodeCount(), 6);
    assert.ok(L.TEASER_CENTER_X <= -7, 'teaser shifted to x <= -7 (screen overlap, see the projection test)');
    const gate = L.ERA_ENV_TEASER_BOXES.find((box) => box.id === 'teaser_gate')!;
    assert.deepEqual(gate.size, { x: 4.0, y: 2.6, z: 0.4 });
    assert.deepEqual(L.ERA_ENV_TEASER_BOXES.find((box) => box.id === 'teaser_apron')!.size, { x: 5.0, y: 0.1, z: 1.8 });
    assert.deepEqual(L.TEASER_CORE_CENTER.y, 2.9);
    assert.equal(L.TEASER_CORE_SIZE, 0.4);
    assert.doesNotMatch(code('EraEnvironmentVisualController.ts'), /Label|addComponent\(Label|UITransform/, 'the teaser carries no label text');
    assert.equal(new Set(L.ERA_ENV_NODE_IDS).size, L.ERA_ENV_NODE_IDS.length, 'ids never collide');
});

test('AUT-045 no new asset files: the environment reuses the AUT-032 structure-high prefab and primitives only', () => {
    const artRoot = path.join(repoRoot, 'assets/art');
    assert.equal(readdirSync(path.join(artRoot, 'aut032/factory')).filter((name) => name.endsWith('.glb')).length, 12, 'no new glb');
    assert.equal(readdirSync(artRoot).filter((name) => /modular|aut045|era/i.test(name)).length, 0, 'no new art folder');
    const scene = JSON.parse(read('assets/scenes/factory/FactoryWorld.scene'));
    const holders = scene.filter((entry: any) => Array.isArray(entry?.environmentPrefabs));
    assert.equal(holders.length, 1, 'exactly one serialized environmentPrefabs list');
    assert.equal(holders[0].__type__, scene.find((entry: any) => Array.isArray(entry?.factoryPrefabs)).__type__, 'held by FactoryWorldBootstrap');
    assert.deepEqual(holders[0].environmentPrefabs, [{ __uuid__: L.ERA_ENV_ASSET_REFERENCES.structure_high }]);
    assert.equal(holders[0].environmentPrefabs.length, L.ERA_ENV_PREFAB_SLOTS.length);
    assert.equal(holders[0].advancedRoboticsComplexPrefabs[4].__uuid__, L.ERA_ENV_ASSET_REFERENCES.structure_high, 'the same structure-high reference the AUT-044 frames use');
    for (const list of ['factoryPrefabs', 'assemblyPrefabs', 'robotLinePrefabs', 'automatedCellPrefabs', 'advancedRoboticsComplexPrefabs']) assert.ok(Array.isArray(holders[0][list]), `${list} untouched`);
    assert.equal(holders[0].automatedCellPrefabs.length, 7);
    assert.equal(holders[0].advancedRoboticsComplexPrefabs.length, 7);
    assert.match(read('docs/AUT-032_3D_ASSET_ROBOT_SPIKE.md'), /structure-high\.glb/);
});

// ---------------------------------------------------------------------------------------------------------------
// Screen limits at the default portrait view (same projection maths as the Cell / Complex tests; the camera is untouched)

interface Rect { minX: number; maxX: number; minY: number; maxY: number }

function projector(distance: number, focus: { x: number; y: number; z: number }): (x: number, y: number, z: number) => { x: number; y: number } {
    const bootstrap = presentation('FactoryWorldBootstrap.ts');
    const num = (pattern: RegExp): number => { const match = bootstrap.match(pattern); assert.ok(match, `${pattern}`); return Number(match[1]); };
    const yaw = num(/defaultYawDeg = (-?[\d.]+)/) * Math.PI / 180;
    const pitch = num(/defaultPitchDeg = (-?[\d.]+)/) * Math.PI / 180;
    const fov = num(/camera\.fov = ([\d.]+)/) * Math.PI / 180;
    const h = distance * Math.cos(pitch);
    const eye = [focus.x + (Math.sin(yaw) * h), focus.y + (distance * Math.sin(pitch)), focus.z + (Math.cos(yaw) * h)];
    const norm = (v: number[]): number[] => { const l = Math.hypot(...v); return v.map((x) => x / l); };
    const cross = (a: number[], b: number[]): number[] => [(a[1] * b[2]) - (a[2] * b[1]), (a[2] * b[0]) - (a[0] * b[2]), (a[0] * b[1]) - (a[1] * b[0])];
    const dot = (a: number[], b: number[]): number => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
    const forward = norm([focus.x - eye[0], focus.y - eye[1], focus.z - eye[2]]);
    const right = norm(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);
    const tanH = Math.tan(fov / 2);
    const tanV = tanH * (2412 / 1080);
    return (x, y, z) => {
        const d = [x - eye[0], y - eye[1], z - eye[2]];
        const depth = dot(d, forward);
        return { x: dot(d, right) / depth / tanH, y: dot(d, up) / depth / tanV };
    };
}

function defaultProject(): (x: number, y: number, z: number) => { x: number; y: number } {
    const bootstrap = presentation('FactoryWorldBootstrap.ts');
    const num = (pattern: RegExp): number => Number(bootstrap.match(pattern)![1]);
    return projector(num(/defaultDistance = ([\d.]+)/), { x: num(/defaultFocusX = (-?[\d.]+)/), y: 0, z: num(/defaultFocusZ = (-?[\d.]+)/) });
}

function screenRect(project: ReturnType<typeof defaultProject>, bounds: L.EraEnvironmentBounds): Rect {
    const rect = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const p = project(x, y, z);
        rect.minX = Math.min(rect.minX, p.x); rect.maxX = Math.max(rect.maxX, p.x);
        rect.minY = Math.min(rect.minY, p.y); rect.maxY = Math.max(rect.maxY, p.y);
    }
    return rect;
}

const intersects = (a: Rect, b: Rect): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
const wb = (x0: number, x1: number, y1: number, z0: number, z1: number): L.EraEnvironmentBounds => ({ min: { x: x0, y: 0, z: z0 }, max: { x: x1, y: y1, z: z1 } });

/** The Lv10 Advanced Robotics Complex upper structures (AUT-044 measured table): head tower + spire (top 3.10), frame runs (top 2.035), arms (1.60), core (1.46). */
const COMPLEX_UPPER: Record<string, L.EraEnvironmentBounds> = {
    tower: wb(-1.175, -0.225, 3.10, 4.525, 5.475),
    frame_west: wb(-2.4875, -2.1125, 2.035, 3.6, 6.35),
    frame_back: wb(-2.4875, 0.2625, 2.035, 6.35, 6.725),
    arms: wb(-0.076, 0.476, 1.6, 3.9, 5.5),
    core: wb(-1.3, -0.1, 1.46, 4.25, 5.75),
};

test('AUT-045 default portrait view: every new module is on screen (|sx| <= 0.95, sy in [-0.45, 0.50]); tall ones keep sx >= -0.93', () => {
    const project = defaultProject();
    const modules = new Map<string, L.EraEnvironmentBounds>();
    for (const box of L.ERA_ENV_BOXES) modules.set(box.id, box.id === 'teaser_core' ? L.teaserCoreBounds() : L.boxBounds(box));
    for (const instance of L.ERA_ENV_PREFAB_INSTANCES) modules.set(instance.id, L.prefabBounds(instance));
    assert.equal(modules.size, L.ERA_ENV_NODE_IDS.length);
    let tallest = 0;
    for (const [id, bounds] of modules) {
        const rect = screenRect(project, bounds);
        assert.ok(rect.minX >= -0.95 && rect.maxX <= 0.95, `${id}: sx ${rect.minX.toFixed(3)}..${rect.maxX.toFixed(3)} within +-0.95`);
        assert.ok(rect.minY >= -0.45 && rect.maxY <= 0.50, `${id}: sy ${rect.minY.toFixed(3)}..${rect.maxY.toFixed(3)} within [-0.45, 0.50] (nothing reaches the HUD / panel band)`);
        if (bounds.max.y > 0.5) { assert.ok(rect.minX >= -0.93, `${id}: tall element at sx ${rect.minX.toFixed(3)} >= -0.93`); tallest = Math.max(tallest, rect.maxY); }
    }
    assert.ok(tallest > 0.3 && tallest <= 0.5, `the tallest new element tops out at sy ${tallest.toFixed(3)}`);
});

test('AUT-045 default view: no new tall module with sx < -0.5 overlaps the Complex upper structures (teaser shifted to x -7.5, height <= 2.4)', () => {
    const project = defaultProject();
    const complex = Object.entries(COMPLEX_UPPER).map(([id, bounds]) => [id, screenRect(project, bounds)] as const);
    const checked: string[] = [];
    const modules: Array<[string, L.EraEnvironmentBounds]> = [
        ...L.ERA_ENV_BOXES.map((box) => [box.id, box.id === 'teaser_core' ? L.teaserCoreBounds() : L.boxBounds(box)] as [string, L.EraEnvironmentBounds]),
        ...L.ERA_ENV_PREFAB_INSTANCES.map((instance) => [instance.id, L.prefabBounds(instance)] as [string, L.EraEnvironmentBounds]),
    ];
    for (const [id, bounds] of modules) {
        const rect = screenRect(project, bounds);
        if (rect.minX >= -0.5 || bounds.max.y <= 0.5) continue; // only tall mass counts (the flat apron is ground, not a silhouette)
        checked.push(id);
        for (const [complexId, complexRect] of complex) assert.ok(!intersects(rect, complexRect), `${id} (sx ${rect.minX.toFixed(3)}) overlaps the Complex ${complexId}`);
    }
    assert.ok(checked.includes('teaser_gate') && checked.includes('teaser_flank_east'), 'the left-most teaser modules are really measured');
    // The pre-shift layout (teaser centred at x -6) would have overlapped: the shift is required, not decorative.
    const flankEastAtMinus6 = screenRect(project, { min: { x: -6 + 2.4 - 0.24, y: 0, z: 10.4 - 0.88 }, max: { x: -6 + 2.4 + 0.24, y: 2.4, z: 10.4 + 0.88 } });
    assert.ok(complex.some(([, rect]) => intersects(flankEastAtMinus6, rect)), 'at x -6 the east flank overlaps the Complex tower / frames at the default view');
    // New modules are never taller than the Complex (3.1) and the teaser stays <= 2.4 (core motif excepted).
    for (const [id, bounds] of modules) assert.ok(bounds.max.y <= 3.25 + 1e-9, `${id} top ${bounds.max.y}`);
    for (const id of ['teaser_apron', 'teaser_gate', 'teaser_flank_west', 'teaser_flank_east']) assert.ok(modules.find(([name]) => name === id)![1].max.y <= 2.6 + 1e-9);
});

// ---------------------------------------------------------------------------------------------------------------
// Wiring

test('AUT-045 bootstrap, registry, scene and wiring: runtime-built hierarchy, structure-high array, sync + events through PresentationController, no replay on load', () => {
    const bootstrap = presentation('FactoryWorldBootstrap.ts');
    assert.match(bootstrap, /@property\(\[Prefab\]\)\s+public environmentPrefabs: Prefab\[\] = \[\];/);
    assert.match(bootstrap, /this\.createEraEnvironment\(site\);/);
    assert.ok(bootstrap.indexOf('this.createLighting(site)') < bootstrap.indexOf('this.createEraEnvironment(site)'), 'the light exists before the environment looks it up');
    assert.ok(bootstrap.indexOf('this.createEraEnvironment(site)') < bootstrap.indexOf('this.createPresentationRegistry(site)'));
    assert.match(bootstrap, /addComponent\(EraEnvironmentVisualController\)/);
    assert.match(bootstrap, /visual\.environmentPrefabs = this\.environmentPrefabs;/);
    assert.match(bootstrap, /visual\.worldCamera = /);
    assert.match(bootstrap, /visual\.keyLight = /);
    assert.match(bootstrap, /controller\.eraEnvironmentVisual = /);
    assert.match(bootstrap, /groupNode\.setScale\(0, 0, 0\)/, 'groups are built hidden by scale');
    assert.match(bootstrap, /ERA_ENV_BOXES/);
    const registry = presentation('PresentationController.ts');
    assert.match(registry, /this\.eraEnvironmentVisual\?\.sync\(/);
    assert.match(registry, /this\.eraEnvironmentVisual\?\.consumeDomainEvents\(state, events\)/);
    const controller = code('EraEnvironmentVisualController.ts');
    assert.match(controller, /public sync\(state: GameState\)[^{]*\{\s*const snapshot = this\.viewModel\.syncFromState\(state\);/, 'a session sync snaps through the view model');
    assert.match(controller, /public consumeDomainEvents\(state: GameState, events: readonly DomainEvent\[\]\)/);
    assert.match(controller, /ERA_ENV_PREFAB_SLOTS\.indexOf\('structure_high'\)/);
    assert.match(controller, /if \(snapshot\.transitionStarted\)/);
    // The fade runs on presentation time only; it never delays the construction or takes camera focus.
    assert.match(controller, /public update\(deltaSeconds: number\)/);
    assert.doesNotMatch(controller, /ConstructionPresentation|ConstructionTarget|registerTarget|beginConstruction/, 'independent of the construction reveal');
    // Diagnostics.
    assert.ok((DEVICE_EVENT_TYPES as readonly string[]).includes('era_environment_state'));
    assert.match(presentation('DeviceDiagnostics.ts'), /AUT-045: era environment:/);
    for (const phase of ERA_ENVIRONMENT_STATE_PHASES) assert.match(`${controller}${presentation('EraEnvironmentViewModel.ts')}`, new RegExp(`'${phase}'`), `${phase} is declared and used`);
    assert.ok(DEFAULT_REVEAL_EVENT_TYPES.includes('era_environment_state'), 'recorded in the reveal timeline');
    // No live-change scenario was added: Era II is entered by building the Robot Line (producer panel) and Era III by an era goal with no HUD action.
    assert.deepEqual(Object.keys(REVEAL_SCENARIOS), ['aut043', 'aut044', 'aut046', 'aut047', 'ui003', 'aut048', 'aut048-era3-live', 'aut049', 'aut049-post', 'aut050', 'aut052', 'aut051', 'aut051-short', 'aut051-reload', 'rbt001', 'aut055-success', 'aut055-closed', 'aut055-failed', 'aut055-ineligible', 'aut056-success', 'aut056-free-active', 'aut056-resume', 'aut056-closed', 'aut056-failed', 'aut056-quota', 'aut056-interval', 'aut057-offline-double', 'aut057-extended', 'aut059-available', 'aut059-purchase-success', 'aut059-pending', 'aut059-cancel', 'aut059-fail', 'aut059-owned', 'aut059-hidden', 'aut059-locked', 'aut060-license-tester-purchase', 'aut060-cancel', 'aut060-restore-owned', 'aut061-restore-reinstall', 'aut061-restore-store-error', 'aut057-no-fill', 'aut048-era3']);
    // Metas: unique a0450000 uuids.
    const uuids = new Set<string>();
    for (const file of [...PURE_MODULES, 'EraEnvironmentVisualController']) {
        const meta = JSON.parse(presentation(`${file}.ts.meta`));
        assert.equal(meta.importer, 'typescript', `${file}.ts.meta`);
        assert.match(meta.uuid, /^a0450000-0000-4000-8000-\d{12}$/);
        uuids.add(meta.uuid);
    }
    assert.equal(uuids.size, 4, 'unique meta uuids');
    // The pan bounds, zones and camera framing are untouched.
    assert.match(bootstrap, /controller\.defaultDistance = 14;/);
    assert.match(bootstrap, /controller\.defaultFocusX = -2\.5;/);
    assert.match(bootstrap, /camera\.fov = 55;/);
    assert.deepEqual(ZONE_LAYOUT.AdvancedRoboticsComplex, { x: -1.0, z: 5.125, width: 3.5, depth: 3.75 });
});

// ---------------------------------------------------------------------------------------------------------------
// Seed

test('AUT-045 seed: workshop / era2 / era3 round-trip through the save and resolve to the intended environment; command registered', () => {
    assert.deepEqual([...AUT045_SEED_VARIANTS], ['workshop', 'era2', 'era3']);
    assert.equal(isAut045SeedVariant('era3'), true);
    assert.equal(isAut045SeedVariant('era4'), false);
    const expected = { workshop: 'manual_workshop', era2: 'automated_factory', era3: 'robotics_complex' } as const;
    for (const variant of AUT045_SEED_VARIANTS) {
        const result = deserializeGameStateFromSaveJson(buildAut045SeededSave(variant, Date.now()));
        assert.deepEqual(result.diagnostics, []);
        assert.equal(result.state.run.currentEraId, expected[variant]);
        assert.equal(R.resolveEraEnvironment(result.state).eraId, expected[variant]);
        assert.equal(buildAut045SeededState(variant).run.currentEraId, expected[variant]);
        // A load snaps: the view model reports no transition for a seeded save.
        const vm = new EraEnvironmentViewModel();
        assert.equal(vm.syncFromState(result.state).transitionStarted, false);
        assert.equal(vm.isTransitioning(), false);
    }
    assert.equal(buildAut045SeededState('era3').run.producers.advanced_robotics_complex?.isBuilt, true, 'era3 = the Complex is built');
    assert.equal(buildAut045SeededState('era2').run.producers.robot_line?.isBuilt, true, 'era2 = the Robot Line is built');
    const pkg = JSON.parse(read('package.json'));
    assert.match(pkg.scripts['device:seed-aut045'], /tools\/device\/cli\.ts seed-aut045$/);
    assert.match(pkg.scripts['device:seed-aut044'], /seed-aut044$/, 'the AUT-044 seed command is untouched');
    const cli = read('tools/device/cli.ts');
    assert.match(cli, /command === 'seed-aut045'/);
    assert.match(cli, /seed-aut045 \[--variant workshop\|era2\|era3\]/);
});
