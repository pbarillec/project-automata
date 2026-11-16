# AUT-R-RBT-002 Natural Reboot path (normal player, no DEBUG, no seeded Cores)

Audit result: the normal-player Reboot flow **already exists** and is not DEBUG-gated. AUT-RBT-001 (entry chip + two-step confirmation modal with AI Cores to gain, RESETS / KEEPS lists, explicit REBOOT / CANCEL, submitting the existing `rebootCivilization { confirmed: true }`), AUT-049 (post-commit sequence, silent load) and AUT-050 (AI chip + AI Upgrades panel, visible once `aiCores > 0 || civilization >= 2`) are built in `FactoryWorldBootstrap` for every build. Nothing in the UI, runtime, economy or save was changed here.

What was missing was proof that a **normally played** run actually reaches that flow: every earlier test and the device scenarios used a seeded save or a DEBUG command. This task adds that proof only.

## What was added

`tests/reboot_natural_path.test.ts` (2 tests, no seeds, no DEBUG patch): a fresh game (Civilization #1, 0 AI Cores) is played by the existing active headless strategy to its prestige frontier, then:
- `createRebootPanelViewModel` is visible, announces `aiCoresToGain > 0`, carries exactly `{ type: 'rebootCivilization', confirmed: true }`, Civilization 1 to 2, and non-empty RESETS / KEEPS lists;
- the AI Upgrades chip is not offered before the Reboot;
- `runtime.rebootCivilizationConfirmed()` grants exactly the announced Cores, moves to Civilization #2, restarts the run (Industrial Output 0) and hides the chip; a duplicate confirm grants nothing;
- afterwards the AI chip is visible and at least one upgrade row is `affordable` with a command, so the AI Upgrades UI is reachable naturally;
- a fresh game does not offer the Reboot.

## Not verified here

See the device section appended after the device run, if any. Subjective items (confirmation clarity, chip discoverability, feel) remain human review, as in AUT-RBT-001.
