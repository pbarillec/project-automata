import { _decorator, Component, Node } from 'cc';
import { FirstAutomationPresentationController } from './FirstAutomationPresentationController';
import { FirstRobotPresentationController } from './FirstRobotPresentationController';
import { ConstructionPresentationController } from './ConstructionPresentationController';
import { RobotPopulationController } from './RobotPopulationController';
import { RobotLineVisualController } from './RobotLineVisualController';
import { AutomatedCellVisualController } from './AutomatedCellVisualController';
import { AdvancedRoboticsComplexVisualController } from './AdvancedRoboticsComplexVisualController';
import { EraEnvironmentVisualController } from './EraEnvironmentVisualController';
import { MilestonePresentationController } from './MilestonePresentationController';
import { BoostPresentationController } from './BoostPresentationController';

const { ccclass, property } = _decorator;

/** Presentation-only attachment registry. It never reads or mutates game state. */
@ccclass('PresentationController')
export class PresentationController extends Component {
    @property(FirstAutomationPresentationController)
    public firstAutomationPresentation: FirstAutomationPresentationController | null = null;

    /** AUT-039: first Worker Bot reveal / work loop (Assembly Station composition). */
    @property(FirstRobotPresentationController)
    public firstRobotPresentation: FirstRobotPresentationController | null = null;

    /** AUT-041: capped visible robot population (pooled robots besides the first Worker Bot). */
    @property(RobotPopulationController)
    public robotPopulation: RobotPopulationController | null = null;

    /** AUT-042: Robot Line composition (fake production, construction target, Era II reveal hook). */
    @property(RobotLineVisualController)
    public robotLineVisual: RobotLineVisualController | null = null;

    /** AUT-043: Automated Cell composition (fake production, construction target, reveal focus beat). */
    @property(AutomatedCellVisualController)
    public automatedCellVisual: AutomatedCellVisualController | null = null;

    /** AUT-044: Advanced Robotics Complex composition (fake production, construction target, reveal focus beat). */
    @property(AdvancedRoboticsComplexVisualController)
    public advancedRoboticsComplexVisual: AdvancedRoboticsComplexVisualController | null = null;

    /** AUT-045: era environment (palette / light / clear colour, hall, vertical group, AI Megafactory teaser); presentation only. */
    @property(EraEnvironmentVisualController)
    public eraEnvironmentVisual: EraEnvironmentVisualController | null = null;

    /** AUT-046: milestone / breakthrough toast, pulse / spark and optional focus; fed last so every owner reveal has already started. */
    @property(MilestonePresentationController)
    public milestonePresentation: MilestonePresentationController | null = null;

    /** AUT-047: temporary boost (Overclock) look: presentation time scale, low-rate sparks, activation ring; silent on load (no impulse replay). */
    @property(BoostPresentationController)
    public boostPresentation: BoostPresentationController | null = null;

    /** AUT-040: reusable construction/reveal sequence; fed before the other controllers so frame 0 is applied first. */
    @property(ConstructionPresentationController)
    public constructionPresentation: ConstructionPresentationController | null = null;

    @property([Node])
    public focusAnchors: Node[] = [];

    @property([Node])
    public compositionAnchors: Node[] = [];

    public getFocusAnchor(producerId: string): Node | null {
        return this.findAnchor(this.focusAnchors, producerId);
    }

    public getCompositionAnchor(producerId: string): Node | null {
        return this.findAnchor(this.compositionAnchors, producerId);
    }

    public syncAutomationState(state: unknown): void {
        const target = this.firstAutomationPresentation as unknown as {
            sync: (value: unknown) => unknown;
        } | null;

        this.constructionPresentation?.sync(state as Parameters<ConstructionPresentationController['sync']>[0]);
        target?.sync(state);
        this.firstRobotPresentation?.sync(state as Parameters<FirstRobotPresentationController['sync']>[0]);
        this.robotLineVisual?.sync(state as Parameters<RobotLineVisualController['sync']>[0]);
        this.automatedCellVisual?.sync(state as Parameters<AutomatedCellVisualController['sync']>[0]);
        this.advancedRoboticsComplexVisual?.sync(state as Parameters<AdvancedRoboticsComplexVisualController['sync']>[0]);
        this.robotPopulation?.sync(state as Parameters<RobotPopulationController['sync']>[0]);
        this.eraEnvironmentVisual?.sync(state as Parameters<EraEnvironmentVisualController['sync']>[0]);
        this.milestonePresentation?.sync(state as Parameters<MilestonePresentationController['sync']>[0]);
        this.boostPresentation?.sync(state as Parameters<BoostPresentationController['sync']>[0]);
    }

    public consumeDomainEvents(
        state: Parameters<FirstAutomationPresentationController['consumeDomainEvents']>[0],
        events: Parameters<FirstAutomationPresentationController['consumeDomainEvents']>[1],
    ): void {
        this.constructionPresentation?.consumeDomainEvents(state, events);
        this.firstAutomationPresentation?.consumeDomainEvents(state, events);
        this.firstRobotPresentation?.consumeDomainEvents(state, events);
        this.robotLineVisual?.consumeDomainEvents(state, events);
        this.automatedCellVisual?.consumeDomainEvents(state, events);
        this.advancedRoboticsComplexVisual?.consumeDomainEvents(state, events);
        this.robotPopulation?.consumeDomainEvents(state, events);
        this.eraEnvironmentVisual?.consumeDomainEvents(state, events);
        this.milestonePresentation?.consumeDomainEvents(state, events);
        this.boostPresentation?.consumeDomainEvents(state, events);
    }

    private findAnchor(anchors: Node[], producerId: string): Node | null {
        const expectedName = `${producerId}_FocusAnchor`;
        return anchors.find((anchor) => anchor.name === expectedName) ?? null;
    }
}
