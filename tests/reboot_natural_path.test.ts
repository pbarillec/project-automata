const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// AUT-R-RBT-002: the normal-player Reboot loop, with NO seeded save, NO DEBUG patch and NO seeded AI Cores. A fresh game is played by the
// existing active headless strategy up to the prestige frontier; then the same view models the UI uses expose the Reboot, the existing
// confirmed command performs it, and the AI Upgrades chip / an affordable upgrade become reachable afterwards.
const repoRoot = path.resolve(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

async function playToFrontier() {
    const [{ loadGameConfigFromSources }, { getEmbeddedEconomyConfigSources }, simulation, reboot, upgrades, progression] = await Promise.all([
        imp('assets/scripts/config/ConfigLoader.ts'),
        imp('assets/scripts/config/EmbeddedEconomyConfig.ts'),
        imp('assets/scripts/simulation/index.ts'),
        imp('assets/scripts/presentation/RebootPanelViewModel.ts'),
        imp('assets/scripts/presentation/PermanentUpgradePanelViewModel.ts'),
        imp('assets/scripts/progression/index.ts'),
    ]);
    const repository = loadGameConfigFromSources(getEmbeddedEconomyConfigSources());
    const result = simulation.runSimulationStrategy(repository, simulation.createActiveSimulationStrategy());
    return { repository, result, reboot, upgrades, progression };
}

test('normal play reaches an eligible Reboot, the UI view models expose it, and the existing command performs it', async () => {
    const { repository, result, reboot, upgrades } = await playToFrontier();
    const runtime = result.simulator.runtime;
    const before = runtime.getStateSnapshot();

    // Never seeded: a fresh game starts with no AI Cores in Civilization #1.
    assert.equal(before.meta.civilizationNumber, 1);
    assert.equal(before.meta.aiCores, 0);

    // The entry chip: exactly the authoritative eligibility, carrying the existing confirmed command.
    const panel = reboot.createRebootPanelViewModel(repository, before);
    assert.equal(panel.visible, true, 'the Reboot chip is offered to a normal player at the prestige frontier');
    assert.ok(panel.aiCoresToGain > 0);
    assert.deepEqual({ ...panel.command }, { type: 'rebootCivilization', confirmed: true });
    assert.equal(panel.currentCivilization, 1);
    assert.equal(panel.resultingCivilization, 2);
    assert.ok(panel.resets.length > 0 && panel.persists.length > 0, 'the confirmation states what resets and what persists');

    // Before Reboot the AI Upgrades surface is not offered (no Cores, Civilization #1).
    assert.equal(upgrades.createPermanentUpgradePanelViewModel(repository, before).chipVisible, false);

    // Confirm: the existing transaction. The announced reward is exactly what is granted.
    const result1 = runtime.rebootCivilizationConfirmed();
    assert.equal(result1.ok, true);
    const after = runtime.getStateSnapshot();
    assert.equal(after.meta.aiCores, panel.aiCoresToGain);
    assert.equal(after.meta.civilizationNumber, 2);
    assert.equal(after.run.industrialOutput, 0, 'the run state starts over');
    assert.equal(reboot.createRebootPanelViewModel(repository, after).visible, false, 'the chip disappears after the Reboot');

    // A duplicate confirm (stale modal / double tap) grants nothing more.
    assert.equal(runtime.rebootCivilizationConfirmed().ok, false);
    assert.equal(runtime.getStateSnapshot().meta.aiCores, panel.aiCoresToGain);

    // Naturally reachable afterwards: the AI chip shows and at least one upgrade is affordable with the Cores just earned.
    const upgradePanel = upgrades.createPermanentUpgradePanelViewModel(repository, after);
    assert.equal(upgradePanel.chipVisible, true);
    assert.equal(upgradePanel.aiCores, panel.aiCoresToGain);
    assert.ok(upgradePanel.rows.some((row) => row.state === 'affordable' && row.command !== null), 'an AI Core upgrade can be bought right after the first Reboot');
});

test('Reboot is not offered on a fresh game or to a run that has not reached the frontier', async () => {
    const { repository, reboot } = await playToFrontier();
    const { createFreshGameState } = await imp('assets/scripts/state/index.ts');
    const fresh = createFreshGameState();
    const panel = reboot.createRebootPanelViewModel(repository, fresh);
    assert.equal(panel.visible, false);
    assert.equal(panel.command, null);
});
