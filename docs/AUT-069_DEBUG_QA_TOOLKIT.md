# AUT-069 Debug / QA Toolkit

Goal: QA reaches every major MVP state in seconds, on a DEBUG APK, without hours of play, and without any of it existing in a release build.
No gameplay, economy, monetization or design value changed; no save-schema change (`CURRENT_SAVE_VERSION` stays 3); no player-visible UI.

## Pieces

1. **Extended `debug_command.json`** (`presentation/DebugCommandFile.ts`, pure parser) read once by the DEBUG build after the session is ready, run by `presentation/DebugCommandExecutor.ts` (pure, fake-port tested).
2. **One DEBUG-only runtime entry** (`runtime/DebugStatePatch.ts`, `GameRuntime.applyDebugStatePatch`, `LifecycleSessionCoordinator.applyDebugStatePatch` / `createDebugPendingOffline`, `FactoryWorldStateBinding.applyDebugStatePatch` / `createDebugPendingOffline`).
3. **Host CLI** `npm run device:qa -- <list | preset | cmd ... | seq ... | ads ...>` (`tools/device/qa_toolkit.ts`, pure builders + adb push through the existing `SessionDeviceDriver`).
4. **Device scenarios** `aut069-qa-patches`, `aut069-qa-offline` with objective checks (`tools/device/qa_toolkit_checks.ts`).

## Debug commands (`debug_command.json`)

Single form `{ "command": {...}, "delayMs": 6000 }` (unchanged) or sequence form `{ "commands": [ { "command": {...}, "delayMs": 1000 }, ... ] }`
(at most 8 commands, run in order, each `delayMs` after the previous one finished, `delayMs` <= 30 s each, total <= 60 s). A sequence is all-or-nothing: one invalid item and nothing runs.
Every new shape is strict (exact keys, finite / integer / bounded numbers). Anything else is ignored (`debug_command` phase `ignored`).

| Command (`type`) | Fields / bounds | Goes through | Effect |
| --- | --- | --- | --- |
| `purchaseBreakthrough` | `breakthroughId` (`[a-z0-9_]{1,64}`) | normal `GameCommand` via `binding.submit` | unchanged (AUT-048) |
| `rebootCivilization` | `confirmed: true` | normal `GameCommand` / Reboot transaction | unchanged (AUT-049) |
| `grantIndustrialOutput` | `amount` 1 .. 1e15 | DEBUG state patch | adds to the balance only; earned statistics (pacing) untouched |
| `setProducerLevel` | `producerId` (must exist in config), `level` integer 0 .. 1000 | DEBUG state patch | level >= 1 = unlocked + built; 0 = unlocked, not built. Automation still comes from Breakthroughs (use `purchaseBreakthrough`) |
| `setEra` | `eraId` (must exist in config) | DEBUG state patch, reuses `applyEraTransition` | forward only (`era_not_forward` otherwise) |
| `setRobotsBuilt` | `amount` integer 0 .. 1e9 | DEBUG state patch | sets Robots Built; run peak and lifetime counter are raised, never lowered |
| `grantAiCores` | `amount` integer 1 .. 1000 | DEBUG state patch | wallet and lifetime-earned both increase (invariant kept) |
| `createPendingOffline` | `seconds` integer 1 .. 1 209 600 | coordinator pending-offline mechanism | simulates an absence: the pending preview is built as if the save were `seconds` old, the saved `savedAtUtc` becomes the rewound absence cursor (same mechanism as a real absence, so a kill / relaunch shows the same report), then the Offline Factory Report card shows. Rejected (`debug_rejected`) while a report is already pending or when the state yields no collectible preview |
| `previewReboot` | none | the player's own Reboot chip handler | opens the Reboot modal (nothing committed; Cancel / Reboot remain player taps). Reports `not_eligible_or_suppressed` when the chip is not available |
| `mockFounderOwned` | `owned` boolean | real Founder paths (`applyFounderPackPurchase` / `reconcileFounderEntitlement`, source `mock`) | `true`: exactly-once grant (entitlement, cosmetic, 2 Surges) + chip refresh. `false`: a "not owned" store report, which by production policy never revokes. To get a not-owned state use the `founder-available` preset (fresh seed) |

State patches commit in memory, then take one critical save (reason `manual`), so a relaunch reproduces the patched state exactly. After a patch the views are re-synced like the initial load (no events replayed: no toast, fanfare or era card). For full visual fidelity of a big jump (e.g. a new era hall) prefer a preset or relaunch after the command.

**Mock ads (success / failure)** is deliberately a host convenience over the existing `debug_ads.json` script (read at session start, so it applies on the next launch): `npm run device:qa -- ads <offline-double|extended-overclock|both> <success|failure|rewarded|closed|failed|unavailable|timeout>...` (1..4 outcomes).

## CLI

`npm run device:qa -- list` prints every preset and command. `[--serial <id>]` selects a device. Requires the FactoryWorld DEBUG APK (`run-as`).

- `<preset>`: force-stop, remove stale saves and debug files, write the preset save (+ its scripts), relaunch.
- `cmd <command> [args]`, `seq "<cmd args>" ...`: keep the current save, write `debug_command.json`, relaunch (the command runs once, ~3 s after the session is ready). Commands: `grant-io <n>`, `set-producer <id> <level>`, `set-era <id>`, `set-robots <n>`, `grant-ai-cores <n>`, `pending-offline <seconds>`, `reboot-preview`, `founder <owned|not-owned>`, `breakthrough <id>`, `reboot`.
- `ads <placement> <outcomes...>`: keep the save, write `debug_ads.json`, relaunch.

Out-of-range, negative, NaN or unknown input is refused on the host with the same strict parser the app uses, so a payload the app would ignore is never pushed.

## Presets (what each reaches)

| Preset | Family | Reaches |
| --- | --- | --- |
| `fresh-start` | start | Brand-new game (saves removed) |
| `first-worker-bot` | start | Output = Worker Bot cost, bot not owned: tap Next Goal for the first Worker Bot reveal |
| `era-2` | eras | Era II (Automated Factory), Robot Line Lv10 |
| `era-3` | eras | Era III (Robotics Complex), Advanced Robotics Complex Lv10 |
| `era-3-worst-case` | eras | AUT-067 worst case: Era III, all producers Lv100, 1,000,000 robots, Free Overclock active (no perf sampler) |
| `reboot-ready` | reboot | Civilization #1 Reboot-eligible (+5 AI Cores), chip visible |
| `reboot-preview` | reboot | Same state; the Reboot modal opens by itself 4 s after launch |
| `post-reboot` | reboot | Civilization #2, AI Cores owned, fresh run |
| `ai-upgrades-affordable` | reboot | Civilization #2, 4 AI Cores, one upgrade partly ranked: AI Upgrades chip with an affordable row |
| `offline-short` | offline | 20 min absence: report card, x2 NOT offered (below the 30 min minimum) |
| `offline-long` | offline | 3 h absence: report card with the educational line |
| `offline-cap` | offline | 10 h absence: the 8 h limit applied and shown |
| `offline-double-eligible` | offline | 3 h absence + mock ad `rewarded`: COLLECT x2 shows and pays 2x |
| `extended-overclock-eligible` | rewarded | Free Overclock unlocked, no recent claims, mock ad `rewarded`: Extended Overclock chip |
| `founder-available` | founder | Not owned, mock store (test price), scripted `completed` purchase |
| `founder-owned` | founder | Owned through a real grant (cosmetic, 2 Surges) |
| `purchase-pending` | founder | Not owned, mock store scripted `pending` |
| `consent-required` | consent | 3 h card + mock consent `required_obtained` (x2 offered only once ads are allowed) |
| `consent-declined` | consent | Same with `required_declined`: ads fail-closed |
| `qa-patches` | toolkit | Reboot-eligible state + a 6-command debug sequence (the device scenario seed) |
| `qa-offline` | toolkit | Automated-producer state, no report on launch + a `createPendingOffline` command |

Presets reuse the existing seed builders (AUT-039/045/049/050/051/056/059/065/067/RBT-001); nothing new in the state shape.

## How QA reaches each MVP state

| MVP state | Fastest route |
| --- | --- |
| Fresh start / first Worker Bot | `fresh-start`, `first-worker-bot` |
| Era II / III / worst case | `era-2`, `era-3`, `era-3-worst-case`; or in session `cmd set-era <id>` then relaunch |
| First Reboot ready / Reboot modal | `reboot-ready`, `reboot-preview`; or `cmd reboot-preview` |
| Post-Reboot / AI upgrades affordable | `post-reboot`, `ai-upgrades-affordable`; or `cmd grant-ai-cores 5` |
| Pending offline report (short / long / cap) | `offline-short`, `offline-long`, `offline-cap`; or mid-session `cmd pending-offline <seconds>` |
| Offline double eligible | `offline-double-eligible` |
| Extended overclock eligible | `extended-overclock-eligible` |
| Founder available / owned / purchase pending | `founder-available`, `founder-owned`, `purchase-pending`; or `cmd founder owned` |
| Consent required | `consent-required`, `consent-declined` |
| Ad success / failure on the next launch | `ads offline-double success` / `failure` |
| Any quantity (Industrial Output, producer level, Robots Built, AI Cores) | `cmd grant-io`, `set-producer`, `set-robots`, `grant-ai-cores` |

## Safety model

- **Gate.** Every debug entry takes a `DebugGate` (`createDebugGate(DEBUG === true, isDeviceDiagnosticsEnabled())`). The ONLY place a gate is built is the guarded `FactoryWorldBootstrap.runDebugCommandFile`, whose first statement is `if (DEBUG !== true || !isDeviceDiagnosticsEnabled()) return;`. A disabled / missing / forged-shape gate makes `GameRuntime.applyDebugStatePatch`, `LifecycleSessionCoordinator.applyDebugStatePatch` / `createDebugPendingOffline` and the executor reject with `debug_disabled`: nothing changes, nothing is saved. Release builds never construct an enabled gate and never read `debug_command.json`.
- **Not a command.** The patch types are not in the `GameCommand` union; `GameRuntime.execute` rejects them; the UI cannot submit them; no scene, HUD or controller references them.
- **Source marking.** Every debug step emits `debug_command` diagnostics (`scheduled`, `submitted`, `applied`) carrying `source: 'debug'`; patch results carry `source: 'debug'`.
- **Analytics (decision: not tracked).** Debug-sourced work is not reported to analytics: `binding.submit(command, { source: 'debug' })` / the Founder calls pass the source to `observeDomainEvents`, and the bootstrap skips `analytics.observeDomainEvents` for `source === 'debug'`. State patches and `createPendingOffline` emit no domain event at all. (Scripted mock ads / purchases keep using the existing mock providers and their existing analytics tags; they are pre-existing DEBUG-only scripts.)
- **Files.** `debug_command.json`, `debug_ads.json`, `debug_purchase.json`, `debug_consent.json` are read only inside guarded bootstrap methods (DEBUG and diagnostics), read once, then deleted. `population_benchmark.json` (AUT-041) is read by `RobotPopulationController` behind `DEBUG !== true` only (pre-existing; DEBUG alone already excludes release); it is not part of this toolkit's runtime paths and was not changed.
- **Source scan tests** (`tests/qa_toolkit.test.ts`) pin all of the above: allow-listed definition files, every bootstrap reference inside the guarded method, one gate construction, guard-first for the four file readers, no `cc` / file access in the pure modules, no player-facing reference, no scene reference, no command-union leak, no `debug` in persistence / state.

## Tests

`tests/qa_toolkit.test.ts` (20 tests): payload parse / validation (unknown, negative, NaN, out-of-range, non-integer, extra keys, sequences), runtime patch behaviour and release / diagnostics-off rejection, coordinator save / relaunch and pending-offline rewind (survives a relaunch, gated, bounded), binding source tagging and analytics exclusion, Founder real-path grant exactly once, executor order / once / source debug / gate refusal, every preset builds a loadable save and reaches its state, CLI parsing and adb push plan, source-scan safety, objective checks and scenario wiring. Updated pins: `era_transition.test.ts` and `reboot_presentation.test.ts` (the bootstrap now calls `parseDebugCommandSequenceFile(text)` and `binding.submit(command, { source: 'debug' })`).

## Device scenarios (not run in this task)

- `npm run device:reveal-capture -- --scenario aut069-qa-patches`: the Reboot-eligible state + the 6-command sequence; checks: file accepted, each command applied exactly once in order, all ok, all `source: 'debug'`, Founder granted once with 2 Surges, Reboot modal opened, no Reboot committed, 0 errors.
- `npm run device:reveal-capture -- --scenario aut069-qa-offline`: a 3 h simulated absence; checks: applied once, ok, source debug, the Offline Factory Report card shown, 0 errors.

Wired through `cli.ts` (`expectQaToolkit`), `reveal_capture.ts` (`RevealCaptureOptions`, `evaluateRevealTimeline`) and `DEFAULT_REVEAL_EVENT_TYPES` (`debug_command`).

## Limits / unverified

- No device run: the scenarios, `previewReboot` opening the modal on hardware, the `adb` push flow and the offline card appearing after `createPendingOffline` are covered by unit tests and wiring pins only.
- A 5 s-old save leaves a sub-minute preview that the UI collects silently at startup (AUT-051b); `createPendingOffline` is rejected while a preview is still pending, hence the 4 s first delay of the scenarios.
- `mockFounderOwned: false` cannot un-own (production reconcile policy); reset with the `founder-available` preset.
- State patches re-sync the HUD / panels / world like a load, but big visual jumps (a new era hall) are only guaranteed after a relaunch (the patch is saved first).

## Device evidence (2026-11-15)

Gate APK `aut069`; `npm run check` 1446 tests green. Captures PASS (0 errors): `aut069-qa-patches`, `aut069-qa-offline` (state patches and pending-offline each applied once with source debug); regressions `aut049`, `aut055-success`. Non-player-visible tooling: no visual QA required. Open follow-up (one line): `RobotPopulationController` reads `population_benchmark.json` behind `DEBUG !== true` only (AUT-041, pre-existing); could also require diagnostics.
