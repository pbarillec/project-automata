import { _decorator, Component, Node } from 'cc';
import { FirstAutomationPresentationController } from './FirstAutomationPresentationController';
import { FirstRobotPresentationController } from './FirstRobotPresentationController';
import { ConstructionPresentationController } from './ConstructionPresentationController';
import { RobotPopulationController } from './RobotPopulationController';

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
        this.robotPopulation?.sync(state as Parameters<RobotPopulationController['sync']>[0]);
    }

    public consumeDomainEvents(
        state: Parameters<FirstAutomationPresentationController['consumeDomainEvents']>[0],
        events: Parameters<FirstAutomationPresentationController['consumeDomainEvents']>[1],
    ): void {
        this.constructionPresentation?.consumeDomainEvents(state, events);
        this.firstAutomationPresentation?.consumeDomainEvents(state, events);
        this.firstRobotPresentation?.consumeDomainEvents(state, events);
        this.robotPopulation?.consumeDomainEvents(state, events);
    }

    private findAnchor(anchors: Node[], producerId: string): Node | null {
        const expectedName = `${producerId}_FocusAnchor`;
        return anchors.find((anchor) => anchor.name === expectedName) ?? null;
    }
}
