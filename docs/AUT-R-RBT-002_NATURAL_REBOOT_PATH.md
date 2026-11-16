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

## Device result (2026-11-16, NE2215)

Gate DEBUG APK `ProjectAutomata-rbt002-44c7e70-factoryworld.apk` (SHA-256 7ed26639...0edfa). The existing `rbt001` scenario (real taps: chip, CANCEL, chip, REBOOT, force-stop, relaunch) PASSED 16/16 with 0 errors: chip "REBOOT +5", modal (+5 AI CORES, Civilization #1 to #2, 5 RESETS / 5 KEEPS, buttons >= 64 units), cancel submits nothing, confirm grants the announced 5 Cores and saves, one 4 s sequence, chip hidden, AI chip "AI x5", persisted after relaunch (`temp/reveal/rbt001-reboot-ui-2026-11-16T104609/`). Afterwards, a real tap on the AI chip opened the AI UPGRADES panel with Optimized Fabrication affordable ("1 AI") and the dependent rows LOCKED (`temp/rev-verify/RBT002_ai_upgrades_panel.png`).

The device state is seeded to the eligibility threshold (the harness cannot play 4 to 7 h of progression); that a played run reaches the same threshold is covered by the headless test above.

## Pending human review

Subjective: clarity and calm of the confirmation, chip discoverability, felt pacing of the first Reboot (4 to 7 h target). Documented AUT-RBT-001 gap unchanged: no concrete permanent-benefit preview in the modal (GAME_DESIGN section 12).
