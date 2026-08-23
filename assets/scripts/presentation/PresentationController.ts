import { _decorator, Component, Node } from 'cc';

const { ccclass, property } = _decorator;

/** Presentation-only attachment registry. It never reads or mutates game state. */
@ccclass('PresentationController')
export class PresentationController extends Component {
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

    private findAnchor(anchors: Node[], producerId: string): Node | null {
        const expectedName = `${producerId}_FocusAnchor`;
        return anchors.find((anchor) => anchor.name === expectedName) ?? null;
    }
}
