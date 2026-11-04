import { _decorator, Component, Node } from 'cc';
import { FirstAutomationPresentationController } from './FirstAutomationPresentationController';

const { ccclass, property } = _decorator;

/** Presentation-only attachment registry. It never reads or mutates game state. */
@ccclass('PresentationController')
export class PresentationController extends Component {
    @property(FirstAutomationPresentationController)
    public firstAutomationPresentation: FirstAutomationPresentationController | null = null;

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

        target?.sync(state);
    }

    public consumeDomainEvents(
        state: Parameters<FirstAutomationPresentationController['consumeDomainEvents']>[0],
        events: Parameters<FirstAutomationPresentationController['consumeDomainEvents']>[1],
    ): void {
        this.firstAutomationPresentation?.consumeDomainEvents(state, events);
    }

    private findAnchor(anchors: Node[], producerId: string): Node | null {
        const expectedName = `${producerId}_FocusAnchor`;
        return anchors.find((anchor) => anchor.name === expectedName) ?? null;
    }
}
