import { Log } from '../logging/Log.ts';
import { _decorator, Animation, Camera, Component, director, instantiate, Light, MeshRenderer, Node, ParticleSystem, SkinnedMeshRenderer, screen, UIRenderer, Vec3 } from 'cc';
import { DEBUG } from 'cc/env';
import type { Prefab } from 'cc';
import { CocosFileSystemPort } from '../app/CocosFileSystemPort';
import { MobileCameraController } from '../camera/MobileCameraController';
import { isFounderRobotCosmeticOwned } from '../monetization/FounderOffer.ts';
import { FramePerfSampler } from './FramePerfSampler.ts';
import { PerfSecondSampler } from './PerfSecondSampler.ts';
import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import { assemblyLocal, WORKER_BOT_SCALE } from './AssemblySliceLayout.ts';
import { getPresentationTimeScale } from './PresentationTimeScale.ts';
import { emitDeviceEvent, isDeviceDiagnosticsEnabled } from './DeviceDiagnostics';
import { WORKER_BOT_NODE_NAME } from './FirstRobotPresentationController';
import { applyFounderRobotVariant, getFounderCrestWorldPoints, getFounderRobotInfo } from './FounderRobotVisual';
import { founderRanks, resolveFounderRobotSlots } from './FounderRobotVariant.ts';
import {
    POPULATION_BENCHMARK_FILE,
    robotSlotVariation,
    RobotPopulationPool,
    resolvePoolRobotRoute,
    sampleRobotPoolPose,
    type PoolRobotRoute,
    type RobotSlotVariation,
} from './RobotPopulation.ts';
import { RobotPopulationViewModel, type RobotPopulationSnapshot } from './RobotPopulationViewModel.ts';
import type { WorkerBotClip } from './WorkerBotRoute.ts';

const { ccclass } = _decorator;

export const POPULATION_ROBOT_NODE_PREFIX = 'PopulationRobot_';
const SCALE_IN_SECONDS = 0.6;
const CLIP_CROSS_FADE_SECONDS = 0.2;
/** AUT-062 DEBUG: seconds between `robot_founder` samples (crest screen rect) and the maximum number of samples. */
const FOUNDER_SAMPLE_SECONDS = 2;
const FOUNDER_SAMPLE_MAX = 12;

interface GfxFrameCounters { drawCalls: number | null; tris: number | null; instances: number | null; source: string }

/** AUT-067 DEBUG: Cocos gfx device per-frame counters (`director.root.device`); null / 'unavailable' when the engine does not expose them. */
function readGfxFrameCounters(): GfxFrameCounters {
    try {
        const device = (director.root as unknown as { device?: { numDrawCalls?: unknown; numTris?: unknown; numInstances?: unknown } } | null)?.device;
        const pick = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
        const counters = { drawCalls: pick(device?.numDrawCalls), tris: pick(device?.numTris), instances: pick(device?.numInstances) };
        return { ...counters, source: counters.drawCalls === null && counters.tris === null ? 'unavailable' : 'director.root.device' };
    } catch {
        return { drawCalls: null, tris: null, instances: null, source: 'unavailable' };
    }
}

/** AUT-067 DEBUG: renderer / light / particle / material counts of the live scene (one traversal, three times per capture). */
function collectSceneCounts(scene: { children: readonly Node[] } | null): Record<string, number> {
    const counts = { nodes: 0, activeNodes: 0, meshRenderers: 0, skinnedMeshRenderers: 0, particleSystems: 0, lights: 0, shadowCasters: 0, uiRenderers: 0, uniqueMaterials: 0 };
    if (!scene) return counts;
    const materials = new Set<unknown>();
    const visit = (node: Node): void => {
        counts.nodes += 1;
        if (node.activeInHierarchy) counts.activeNodes += 1;
        for (const component of node.components) {
            if (component instanceof MeshRenderer) {
                if (component instanceof SkinnedMeshRenderer) counts.skinnedMeshRenderers += 1;
                else counts.meshRenderers += 1;
                if (component.shadowCastingMode === 1) counts.shadowCasters += 1;
                for (const material of component.sharedMaterials) if (material) materials.add(material);
            }
            if (component instanceof ParticleSystem) counts.particleSystems += 1;
            if (component instanceof Light) counts.lights += 1;
            if (component instanceof UIRenderer) counts.uiRenderers += 1;
        }
        for (const child of node.children) visit(child);
    };
    for (const child of scene.children) visit(child);
    counts.uniqueMaterials = materials.size;
    return counts;
}

interface PooledRobot {
    readonly node: Node;
    readonly animations: Animation[];
    readonly variation: RobotSlotVariation;
    visible: boolean;
    /** 0..1 appearance ramp (1 = full size). */
    ramp: number;
    clip: WorkerBotClip | null;
    /** AUT-042: the loop this robot currently follows (a change re-scales it in). */
    route: PoolRobotRoute;
}

/**
 * AUT-041 capped robot population: thin `cc` controller over the pure `RobotPopulationViewModel` and
 * `RobotPopulation` model. Rank 0 is the AUT-039 Worker Bot (its own controller); this pool shows the other
 * visible robots on the same predefined loop with deterministic phase, speed, lateral offset and scale
 * variation. Instances are created lazily from the serialized Robot prefab, reused, never destroyed, and hidden
 * by scale (AUT-038 Android rule). No pathfinding or AI. It never writes GameState.
 */
@ccclass('RobotPopulationController')
export class RobotPopulationController extends Component {
    /** Supplied by FactoryWorldBootstrap (the AUT-032 `Robot.glb` prefab, shared with the Worker Bot). */
    public robotPrefab: Prefab | null = null;

    private readonly viewModel = new RobotPopulationViewModel();
    private readonly pool = new RobotPopulationPool();
    private readonly robots: PooledRobot[] = [];
    private snapshotValue: RobotPopulationSnapshot | null = null;
    private robotLineBuilt = false;
    private automatedCellBuilt = false;
    private clock = 0;
    private clipSpeed = 1;
    private perf: FramePerfSampler | null = null;
    /** AUT-067 DEBUG baseline sampler (per-second frame time + scene counts); only created when the override file has `perf: true`. */
    private perfSeconds: PerfSecondSampler | null = null;
    /** AUT-062: Founder Robot cosmetic owned (derived from `meta.cosmeticOwnership` on every sync / domain-event batch; no save change). */
    private founderOwned = false;
    private founderKey = '';
    private founderSampleClock = 0;
    private founderSamples = 0;

    /** AUT-041 benchmark (DEBUG builds only): reads the override file and starts frame-time sampling. */
    public onLoad(): void {
        if (DEBUG !== true) return;
        try {
            const text = new CocosFileSystemPort().readText(POPULATION_BENCHMARK_FILE);
            if (text === undefined) return;
            const maxVisible = (JSON.parse(text) as { maxVisible?: unknown }).maxVisible;
            if (typeof maxVisible !== 'number' || !Number.isFinite(maxVisible)) return;
            this.viewModel.setOptions({ maxVisible });
            this.perf = new FramePerfSampler();
            if ((JSON.parse(text) as { perf?: unknown }).perf === true) this.perfSeconds = new PerfSecondSampler();
            emitDeviceEvent('robot_benchmark', { maxVisible });
        } catch (error) {
            Log.warn('perf', `[AUT-041] benchmark override ignored: ${String(error)}`);
        }
    }

    public sync(state: GameState): RobotPopulationSnapshot {
        this.founderOwned = isFounderRobotCosmeticOwned(state);
        return this.apply(this.viewModel.sync(state), 'synced', 'session');
    }

    public consumeDomainEvents(state: GameState, _events: readonly DomainEvent[]): RobotPopulationSnapshot {
        this.founderOwned = isFounderRobotCosmeticOwned(state);
        return this.apply(this.viewModel.sync(state), 'changed', 'runtime');
    }

    public getSnapshot(): RobotPopulationSnapshot | null {
        return this.snapshotValue;
    }

    public getPooledNodes(): readonly Node[] {
        return this.robots.map((robot) => robot.node);
    }

    public update(deltaSeconds: number): void {
        const window = this.perf?.add(deltaSeconds) ?? null;
        if (window) emitDeviceEvent('robot_perf', { visible: (this.snapshotValue?.visible ?? 0), pooled: this.pool.visible, ...window });
        const second = this.perfSeconds?.add(deltaSeconds) ?? null;
        if (second) {
            const counters = readGfxFrameCounters();
            emitDeviceEvent('perf_second', { ...second, hist: [...second.hist], drawCalls: counters.drawCalls, tris: counters.tris, instances: counters.instances });
            if (second.index === 0 || second.index === 30 || second.index === 59) emitDeviceEvent('perf_scene', { ...collectSceneCounts(director.getScene()), index: second.index, drawCalls: counters.drawCalls, tris: counters.tris, statsSource: counters.source });
        }
        this.sampleFounder(deltaSeconds);
        if (this.pool.visible === 0 && this.robots.every((robot) => !robot.visible)) return;
        // AUT-047: presentation time scale (Overclock ~1.3x) speeds the route clock and the clip playback; ramps / scale-in stay real time.
        const speed = getPresentationTimeScale();
        this.clock += deltaSeconds * speed;
        const speedChanged = speed !== this.clipSpeed;
        this.clipSpeed = speed;
        for (const robot of this.robots) {
            if (speedChanged && robot.clip !== null) this.applyClipSpeed(robot);
            if (!robot.visible && robot.ramp <= 0) continue;
            robot.ramp = robot.visible ? Math.min(1, robot.ramp + (deltaSeconds / SCALE_IN_SECONDS)) : 0;
            const route = resolvePoolRobotRoute(robot.variation.slot, this.robotLineBuilt, this.automatedCellBuilt);
            if (route !== robot.route) {
                robot.route = route;
                if (robot.visible) robot.ramp = 0;
            }
            const pose = sampleRobotPoolPose(robot.variation, this.clock, route);
            const local = assemblyLocal({ x: pose.x, y: pose.y, z: pose.z });
            robot.node.setPosition(local.x, local.y, local.z);
            robot.node.setRotationFromEuler(0, pose.headingDeg, 0);
            this.playClip(robot, pose.clip);
            this.applyScale(robot);
        }
    }

    private apply(snapshot: RobotPopulationSnapshot, phase: 'synced' | 'changed', source: string): RobotPopulationSnapshot {
        this.snapshotValue = snapshot;
        this.robotLineBuilt = snapshot.robotLineBuilt;
        this.automatedCellBuilt = snapshot.automatedCellBuilt;
        if (snapshot.changed || phase === 'synced') {
            const plan = this.pool.resize(snapshot.pooled);
            this.ensureRobots(plan.instantiate);
            for (const slot of plan.shown) {
                const robot = this.robots[slot];
                if (!robot) continue;
                robot.visible = true;
                robot.ramp = snapshot.animateGrowth ? 0 : 1;
                this.applyScale(robot);
            }
            for (const slot of plan.hidden) {
                const robot = this.robots[slot];
                if (!robot) continue;
                robot.visible = false;
                robot.ramp = 0;
                this.applyScale(robot);
            }
            if (isDeviceDiagnosticsEnabled() && (snapshot.changed || phase === 'synced')) {
                emitDeviceEvent('robot_population', {
                    phase,
                    source,
                    robotsBuilt: snapshot.robotsBuilt,
                    visible: snapshot.visible,
                    pooled: snapshot.pooled,
                    robotLineBuilt: snapshot.robotLineBuilt,
                    automatedCellBuilt: snapshot.automatedCellBuilt,
                    instantiated: this.pool.instantiated,
                });
            }
        }
        this.applyFounder(snapshot, phase);
        return snapshot;
    }

    /**
     * AUT-062: the Founder variant follows `resolveFounderRobotSlots(owned, visible)`: rank 0 (applied by the Worker Bot controller on its own
     * node) plus at most one pooled slot once 4+ robots are visible. Swapped in place on a mid-session purchase (no fanfare, pose / clip untouched).
     */
    private applyFounder(snapshot: RobotPopulationSnapshot, phase: 'synced' | 'changed'): void {
        const slots = resolveFounderRobotSlots(this.founderOwned, snapshot.visible);
        for (const robot of this.robots) applyFounderRobotVariant(robot.node, slots.poolSlots.includes(robot.variation.slot));
        const key = `${this.founderOwned}|${snapshot.visible}|${slots.poolSlots.join(',')}`;
        if (key === this.founderKey && phase !== 'synced') return;
        this.founderKey = key;
        if (isDeviceDiagnosticsEnabled()) this.emitFounder(snapshot.visible, snapshot.pooled, phase);
    }

    private founderNodes(): { rank: number; node: Node }[] {
        const slots = resolveFounderRobotSlots(this.founderOwned, this.snapshotValue?.visible ?? 0);
        const nodes: { rank: number; node: Node }[] = [];
        const workerBot = this.node.getChildByName(WORKER_BOT_NODE_NAME);
        if (slots.workerBot && workerBot) nodes.push({ rank: 0, node: workerBot });
        for (const slot of slots.poolSlots) {
            const robot = this.robots[slot];
            if (robot) nodes.push({ rank: slot + 1, node: robot.node });
        }
        return nodes;
    }

    /** DEBUG `robot_founder`: ownership, which ranks are Founder robots, the visible count and (best effort) the crest rectangle in window pixels (bottom-left origin). */
    private emitFounder(visible: number, pooled: number, phase: string, withRect = false): void {
        const slots = resolveFounderRobotSlots(this.founderOwned, visible);
        const infos = this.founderNodes().map(({ rank, node }) => ({ rank, ...getFounderRobotInfo(node) }));
        const payload: Record<string, unknown> = {
            phase,
            owned: this.founderOwned,
            founderRanks: founderRanks(slots),
            visible,
            pooled,
            shellTinted: infos.map((info) => info.shellTinted),
            fallbackShell: infos.some((info) => info.fallbackShell),
            applied: infos.map((info) => info.applied),
        };
        if (withRect) Object.assign(payload, this.crestRects());
        emitDeviceEvent('robot_founder', payload);
    }

    private crestRects(): Record<string, unknown> {
        try {
            const camera = this.node.scene?.getComponentInChildren(MobileCameraController)?.getComponent(Camera) ?? director.getScene()?.getComponentInChildren(Camera) ?? null;
            if (!camera) return { crest: [] };
            const size = screen.windowSize;
            const crest = this.founderNodes().flatMap(({ rank, node }) => {
                const points = getFounderCrestWorldPoints(node);
                if (points.length === 0) return [];
                let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
                for (const point of points) {
                    const projected = camera.worldToScreen(point, new Vec3());
                    minX = Math.min(minX, projected.x); minY = Math.min(minY, projected.y); maxX = Math.max(maxX, projected.x); maxY = Math.max(maxY, projected.y);
                }
                return [{ rank, rect: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } }];
            });
            return { crest, screen: { w: size.width, h: size.height } };
        } catch (error) {
            return { crest: [], rectError: String(error) };
        }
    }

    private sampleFounder(deltaSeconds: number): void {
        if (!this.founderOwned || this.founderSamples >= FOUNDER_SAMPLE_MAX || !isDeviceDiagnosticsEnabled()) return;
        this.founderSampleClock += deltaSeconds;
        if (this.founderSampleClock < FOUNDER_SAMPLE_SECONDS) return;
        this.founderSampleClock = 0;
        this.founderSamples += 1;
        const snapshot = this.snapshotValue;
        this.emitFounder(snapshot?.visible ?? 0, snapshot?.pooled ?? 0, 'sample', true);
    }

    private ensureRobots(count: number): void {
        while (this.robots.length < count) {
            if (!this.robotPrefab) {
                Log.warn('presentation', '[AUT-041] Missing serialized Robot prefab.');
                return;
            }
            const slot = this.robots.length;
            const node = instantiate(this.robotPrefab);
            node.name = `${POPULATION_ROBOT_NODE_PREFIX}${slot}`;
            node.parent = this.node;
            node.active = true;
            node.setScale(0, 0, 0);
            this.robots.push({ node, animations: node.getComponentsInChildren(Animation), variation: robotSlotVariation(slot), visible: false, ramp: 0, clip: null, route: resolvePoolRobotRoute(slot, this.robotLineBuilt, this.automatedCellBuilt) });
        }
    }

    private applyScale(robot: PooledRobot): void {
        const scale = robot.visible ? WORKER_BOT_SCALE * robot.variation.scaleFactor * robot.ramp : 0;
        robot.node.setScale(scale, scale, scale);
        if (!robot.visible) robot.clip = null;
    }

    private playClip(robot: PooledRobot, clip: WorkerBotClip): void {
        if (robot.clip === clip) return;
        const first = robot.clip === null;
        robot.clip = clip;
        for (const animation of robot.animations) {
            if (!animation.clips.some((entry) => entry?.name === clip)) continue;
            if (first) animation.play(clip);
            else animation.crossFade(clip, CLIP_CROSS_FADE_SECONDS);
        }
        this.applyClipSpeed(robot);
    }

    /** AUT-047: clip playback speed follows the presentation time scale (1 outside Overclock). */
    private applyClipSpeed(robot: PooledRobot): void {
        if (robot.clip === null) return;
        for (const animation of robot.animations) {
            const state = animation.getState(robot.clip);
            if (state) state.speed = this.clipSpeed;
        }
    }
}
