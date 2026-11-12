import { _decorator, Animation, Component, instantiate, Node } from 'cc';
import { DEBUG } from 'cc/env';
import type { Prefab } from 'cc';
import { CocosFileSystemPort } from '../app/CocosFileSystemPort';
import { FramePerfSampler } from './FramePerfSampler.ts';
import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import { assemblyLocal, WORKER_BOT_SCALE } from './AssemblySliceLayout.ts';
import { emitDeviceEvent, isDeviceDiagnosticsEnabled } from './DeviceDiagnostics';
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
    private clock = 0;
    private perf: FramePerfSampler | null = null;

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
            emitDeviceEvent('robot_benchmark', { maxVisible });
        } catch (error) {
            console.warn(`[AUT-041] benchmark override ignored: ${String(error)}`);
        }
    }

    public sync(state: GameState): RobotPopulationSnapshot {
        return this.apply(this.viewModel.sync(state), 'synced', 'session');
    }

    public consumeDomainEvents(state: GameState, _events: readonly DomainEvent[]): RobotPopulationSnapshot {
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
        if (this.pool.visible === 0 && this.robots.every((robot) => !robot.visible)) return;
        this.clock += deltaSeconds;
        for (const robot of this.robots) {
            if (!robot.visible && robot.ramp <= 0) continue;
            robot.ramp = robot.visible ? Math.min(1, robot.ramp + (deltaSeconds / SCALE_IN_SECONDS)) : 0;
            const route = resolvePoolRobotRoute(robot.variation.slot, this.robotLineBuilt);
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
                    instantiated: this.pool.instantiated,
                });
            }
        }
        return snapshot;
    }

    private ensureRobots(count: number): void {
        while (this.robots.length < count) {
            if (!this.robotPrefab) {
                console.warn('[AUT-041] Missing serialized Robot prefab.');
                return;
            }
            const slot = this.robots.length;
            const node = instantiate(this.robotPrefab);
            node.name = `${POPULATION_ROBOT_NODE_PREFIX}${slot}`;
            node.parent = this.node;
            node.active = true;
            node.setScale(0, 0, 0);
            this.robots.push({ node, animations: node.getComponentsInChildren(Animation), variation: robotSlotVariation(slot), visible: false, ramp: 0, clip: null, route: resolvePoolRobotRoute(slot, this.robotLineBuilt) });
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
    }
}
