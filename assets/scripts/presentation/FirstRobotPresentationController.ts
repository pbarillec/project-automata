import { Log } from '../logging/Log.ts';
import { _decorator, Animation, Component, instantiate, Node } from 'cc';
import type { Prefab } from 'cc';
import type { DomainEvent } from '../domain/Events.ts';
import type { GameState } from '../state/GameState.ts';
import { MobileCameraController } from '../camera/MobileCameraController';
import { isFounderRobotCosmeticOwned } from '../monetization/FounderOffer.ts';
import { assemblyLocal, WORKER_BOT_SCALE } from './AssemblySliceLayout.ts';
import { AssemblyVisualController } from './AssemblyVisualController';
import { emitDeviceEvent, isDeviceDiagnosticsEnabled } from './DeviceDiagnostics';
import { applyFounderRobotVariant } from './FounderRobotVisual';
import { resolveFounderRobotSlots } from './FounderRobotVariant.ts';
import { FirstRobotPresentationViewModel, type FirstRobotPresentationSnapshot } from './FirstRobotPresentationViewModel.ts';
import { getPresentationTimeScale } from './PresentationTimeScale.ts';
import { WorkerBotRoutePlayer,type WorkerBotClip, type WorkerBotPose } from './WorkerBotRoute.ts';

const { ccclass, property } = _decorator;

export const WORKER_BOT_NODE_NAME = 'FirstWorkerBot';
export const ROBOT_BAY_LAMP_OFF_NODE_NAME = 'robot_bay_lamp_off';
export const ROBOT_BAY_LAMP_ON_NODE_NAME = 'robot_bay_lamp_on';

/** Feet follow the floor height smoothly (spine / slab / ground steps). */
const FLOOR_FOLLOW_RATE = 12;
const CLIP_CROSS_FADE_SECONDS = 0.2;

/**
 * AUT-039 presentation-only first Worker Bot reveal and work loop (thin controller over the pure
 * `FirstRobotPresentationViewModel` + `WorkerBotRoutePlayer`). It drives the AssemblyVisualController,
 * one Robot.glb instance, the bay lamp and one bounded camera focus through the existing
 * `MobileCameraController.focusOnRevealTarget` (AUT-038). It never mutates GameState and creates no
 * economic worker entity.
 */
@ccclass('FirstRobotPresentationController')
export class FirstRobotPresentationController extends Component {
    @property(AssemblyVisualController)
    public assemblyVisual: AssemblyVisualController | null = null;

    @property(MobileCameraController)
    public cameraController: MobileCameraController | null = null;

    @property(Node)
    public focusAnchor: Node | null = null;

    /** Supplied by FactoryWorldBootstrap at runtime (Robot.glb prefab). */
    public robotPrefab: Prefab | null = null;

    private readonly viewModel = new FirstRobotPresentationViewModel();
    private readonly player = new WorkerBotRoutePlayer();
    private snapshotValue: FirstRobotPresentationSnapshot | null = null;
    private robotNode: Node | null = null;
    private robotAnimations: Animation[] = [];
    private clipSpeed = 1;
    private currentClip: WorkerBotClip | null = null;
    private robotY: number | null = null;
    private revealAwaitingBeat = false;
    private revealFocusRequested = false;
    /** AUT-062: Founder Robot cosmetic owned (derived from `meta.cosmeticOwnership` on every sync / domain-event batch). */
    private founderOwned = false;

    public onLoad(): void {
        this.assemblyVisual ??= this.node.getComponent(AssemblyVisualController);
    }

    public start(): void {
        this.ensureRobot();
        this.applyRobotVisible(false);
        this.applyBayLamp(false);
    }

    /** Initial / restored state (AUT-INT-001 init): rebuilds the robot in its loop, never replays the reveal. */
    public sync(state: GameState): FirstRobotPresentationSnapshot {
        this.snapshotValue = this.viewModel.syncFromState(state);
        this.founderOwned = isFounderRobotCosmeticOwned(state);
        this.applySnapshot();
        this.applyFounderVariant();
        if (isDeviceDiagnosticsEnabled()) {
            emitDeviceEvent('robot_state', { phase: 'synced', source: 'session', ...this.describe() });
        }
        return this.snapshotValue;
    }

    public consumeDomainEvents(state: GameState, events: readonly DomainEvent[]): FirstRobotPresentationSnapshot {
        const before = this.viewModel.mode;
        this.snapshotValue = this.viewModel.consumeEvents(state, events);
        this.founderOwned = isFounderRobotCosmeticOwned(state);
        this.applySnapshot();
        this.applyFounderVariant();
        if (this.snapshotValue.revealRequested) this.startReveal();
        else if (before === 'hidden' && this.snapshotValue.robotMode === 'loop' && isDeviceDiagnosticsEnabled()) {
            // Civilization 2+ (deferred acknowledgement) or a state that gained the robot without the event.
            emitDeviceEvent('robot_state', { phase: 'loop_started', source: 'runtime', reason: 'no_reveal', ...this.describe() });
        }
        return this.snapshotValue;
    }

    public getSnapshot(): FirstRobotPresentationSnapshot | null {
        return this.snapshotValue;
    }

    public update(deltaSeconds: number): void {
        if (this.player.mode === 'hidden') return;
        // AUT-047: presentation time scale (Overclock ~1.3x) applies to the work loop only, never to the reveal beat.
        const speed = this.player.mode === 'loop' ? getPresentationTimeScale() : 1;
        if (speed !== this.clipSpeed) { this.clipSpeed = speed; this.applyClipSpeed(); }
        const step = this.player.advance(deltaSeconds * speed);
        if (step.pose) this.applyPose(step.pose, deltaSeconds);
        const diagnostics = isDeviceDiagnosticsEnabled();
        if (step.revealBeatEnded && this.revealAwaitingBeat) {
            this.revealAwaitingBeat = false;
            if (diagnostics) emitDeviceEvent('robot_state', { phase: 'reveal_complete', source: 'runtime', focusRequested: this.revealFocusRequested, ...this.describe() });
        }
        if (step.loopStarted) {
            this.viewModel.completeReveal();
            if (this.snapshotValue) this.snapshotValue = { ...this.snapshotValue, robotMode: 'loop', revealRequested: false };
            if (diagnostics) emitDeviceEvent('robot_state', { phase: 'loop_started', source: 'runtime', reason: 'reveal_finished', ...this.describe() });
        }
        if (diagnostics) {
            for (const stopId of step.arrivals) {
                const pose = step.pose;
                emitDeviceEvent('robot_state', { phase: 'waypoint', stopId, lap: step.lap, mode: step.mode, clip: this.currentClip, x: pose?.x ?? null, z: pose?.z ?? null });
            }
        }
    }

    private describe(): Record<string, unknown> {
        const snapshot = this.snapshotValue;
        return {
            present: snapshot?.assembly.robotPresent === true,
            mode: this.player.mode,
            assemblyPhase: snapshot?.assembly.phase ?? null,
            modules: snapshot?.assembly.modules ?? [],
            bayLit: snapshot?.assembly.bayLit === true,
            civilization: snapshot?.civilizationNumber ?? null,
            robotNode: this.robotNode !== null,
            clips: this.robotAnimations.length,
        };
    }

    private applySnapshot(): void {
        const snapshot = this.snapshotValue;
        if (!snapshot) return;
        this.assemblyVisual?.applyDescriptor(snapshot.assembly);
        this.applyBayLamp(snapshot.assembly.bayLit);
        if (snapshot.robotMode === 'hidden') {
            this.player.hide();
            this.applyRobotVisible(false);
        } else if (snapshot.robotMode === 'loop' && this.player.mode === 'hidden') {
            this.player.startLoop();
            this.applyRobotVisible(true);
            const pose = this.player.pose();
            if (pose) this.applyPose(pose, 0, true);
        }
    }

    /** AUT-062: rank 0 (this first Worker Bot node) is the Founder robot whenever the cosmetic is owned, even before its first reveal; swapped in place, no pose / clip reset. */
    private applyFounderVariant(): void {
        this.ensureRobot();
        if (this.robotNode) applyFounderRobotVariant(this.robotNode, resolveFounderRobotSlots(this.founderOwned, 0).workerBot);
    }

    private startReveal(): void {
        this.player.startReveal();
        this.viewModel.acknowledgeReveal();
        if (this.snapshotValue) this.snapshotValue = { ...this.snapshotValue, revealRequested: false };
        this.applyRobotVisible(true);
        const pose = this.player.pose();
        if (pose) this.applyPose(pose, 0, true);
        const target = this.focusAnchor?.worldPosition ?? null;
        this.revealFocusRequested = target !== null && this.cameraController !== null;
        if (target && this.cameraController) this.cameraController.focusOnRevealTarget(target);
        this.revealAwaitingBeat = true;
        if (isDeviceDiagnosticsEnabled()) {
            emitDeviceEvent('robot_state', { phase: 'reveal_started', source: 'runtime', focusRequested: this.revealFocusRequested, focus: target ? { x: target.x, z: target.z } : null, ...this.describe() });
        }
    }

    private ensureRobot(): void {
        if (this.robotNode) return;
        const existing = this.node.getChildByName(WORKER_BOT_NODE_NAME);
        if (existing) {
            this.robotNode = existing;
        } else {
            if (!this.robotPrefab) {
                Log.warn('presentation', '[AUT-039] Missing serialized Worker Bot prefab.');
                return;
            }
            const robot = instantiate(this.robotPrefab);
            robot.name = WORKER_BOT_NODE_NAME;
            robot.parent = this.node;
            this.robotNode = robot;
        }
        this.robotNode.active = true;
        this.robotAnimations = this.robotNode.getComponentsInChildren(Animation);
    }

    private applyRobotVisible(visible: boolean): void {
        this.ensureRobot();
        const robot = this.robotNode;
        if (!robot) return;
        // Scale, not active: Android native never deactivates the imported skinned hierarchy (AUT-038 rule).
        robot.active = true;
        const scale = visible ? WORKER_BOT_SCALE : 0;
        robot.setScale(scale, scale, scale);
        if (!visible) {
            this.currentClip = null;
            this.robotY = null;
        }
    }

    private applyPose(pose: WorkerBotPose, deltaSeconds: number, snap = false): void {
        const robot = this.robotNode;
        if (!robot) return;
        const follow = snap || this.robotY === null ? 1 : Math.min(1, deltaSeconds * FLOOR_FOLLOW_RATE);
        this.robotY = this.robotY === null ? pose.y : this.robotY + ((pose.y - this.robotY) * follow);
        const local = assemblyLocal({ x: pose.x, y: this.robotY, z: pose.z });
        robot.setPosition(local.x, local.y, local.z);
        robot.setRotationFromEuler(0, pose.headingDeg, 0);
        this.playClip(pose.clip);
    }

    private playClip(clip: WorkerBotClip): void {
        if (this.currentClip === clip) return;
        const first = this.currentClip === null;
        this.currentClip = clip;
        for (const animation of this.robotAnimations) {
            if (!animation.clips.some((entry) => entry?.name === clip)) continue;
            if (first) animation.play(clip);
            else animation.crossFade(clip, CLIP_CROSS_FADE_SECONDS);
        }
        this.applyClipSpeed();
    }

    /** AUT-047: clip playback speed follows the presentation time scale (1 outside Overclock). */
    private applyClipSpeed(): void {
        const clip = this.currentClip;
        if (clip === null) return;
        for (const animation of this.robotAnimations) {
            const state = animation.getState(clip);
            if (state) state.speed = this.clipSpeed;
        }
    }

    private applyBayLamp(lit: boolean): void {
        const off = this.node.getChildByName(ROBOT_BAY_LAMP_OFF_NODE_NAME);
        const on = this.node.getChildByName(ROBOT_BAY_LAMP_ON_NODE_NAME);
        const bayVisible = this.snapshotValue?.assembly.modules.includes('robot_bay') === true;
        if (off) { off.active = true; const s = bayVisible && !lit ? 1 : 0; off.setScale(s, s, s); }
        if (on) { on.active = true; const s = bayVisible && lit ? 1 : 0; on.setScale(s, s, s); }
    }
}

