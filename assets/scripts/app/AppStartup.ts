import { _decorator, Component, Label } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('AppStartup')
export class AppStartup extends Component {
    @property(Label)
    public statusLabel: Label | null = null;

    public start(): void {
        console.log('AUTOMATA_RUNTIME_OK');

        if (this.statusLabel) {
            this.statusLabel.string = 'Runtime OK';
        }
    }
}

