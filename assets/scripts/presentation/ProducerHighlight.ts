import { _decorator, Color, Component, Layers, Material, MeshRenderer, Node, primitives, utils } from 'cc';

const { ccclass } = _decorator;

/** Presentation-only structural selection marker. It never changes producer state. */
@ccclass('ProducerHighlight')
export class ProducerHighlight extends Component {
    private marker: Node | null = null;

    public onLoad(): void {
        this.ensureMarker();
        this.setSelected(false);
    }

    public setSelected(selected: boolean): void {
        this.ensureMarker();
        if (this.marker) this.marker.active = selected;
    }

    public isSelected(): boolean { return this.marker?.active === true; }

    private ensureMarker(): void {
        if (this.marker?.isValid) return;
        this.marker = this.node.getChildByName('ProducerSelectionMarker') ?? new Node('ProducerSelectionMarker');
        this.marker.parent = this.node;
        this.marker.setPosition(0, 0.04, 0);
        this.marker.layer = Layers.Enum.DEFAULT;
        const renderer = this.marker.getComponent(MeshRenderer) ?? this.marker.addComponent(MeshRenderer);
        const meshFactory = utils as unknown as { MeshUtils?: { createMesh(geometry: unknown): unknown }; createMesh?: (geometry: unknown) => unknown };
        const geometry = primitives.cylinder({ radius: 0.92, height: 0.035, segments: 32 });
        renderer.mesh = (meshFactory.MeshUtils?.createMesh(geometry) ?? meshFactory.createMesh?.(geometry)) as any;
        const material = new Material();
        material.initialize({ effectName: 'builtin-unlit', defines: { USE_COLOR: true } });
        material.setProperty('mainColor', new Color(236, 166, 63, 220));
        renderer.setMaterial(material, 0);
    }
}
