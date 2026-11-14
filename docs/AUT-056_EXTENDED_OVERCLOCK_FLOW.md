# AUT-056 Extended Overclock Mock Flow

Adds the rewarded Extended Overclock (x2 production for 10 active minutes, MONETIZATION rewarded placement `rewarded.extended_overclock`) behind a
MOCK ad (DEBUG builds only). No data/economy change and NO save-schema change: the boost uses the existing `BoostState` fields (`source`,
`requestId`, `isSuspended`, `suspendedByBoostId`) and the AUT-MIG-001 claim history key `rewarded.extended_overclock` is reused as is.

## What was built

- `progression/TemporaryBoosts.ts`: `EXTENDED_OVERCLOCK_BOOST_ID = 'extended_overclock'`, multiplier 2, duration 600 s, source `rewarded`;
  `activateExtendedOverclock(state, requestId)` (statuses `locked`, `already_active`; suspends an active Free Overclock, activates with cooldown 0,
  emits Suspended then Activated). `activateFreeOverclock` returns `suspended` while Extended is active. Inside the `advanceTemporaryBoosts`
  segment loop a boost suspended by a boost that expired in that segment is resumed (only the suspender that expired in that segment, which keeps
  the AUT-016 fixture test with an orphan suspender id green).
- `domain/Commands.ts`: `ActivateExtendedOverclockCommand { requestId, claimedAtUtcMs }`.
- `runtime/GameRuntime.ts`: `executeActivateExtendedOverclock`; eligibility re-evaluated from the state's claim history (`rewarded_not_eligible`
  rejection with details); on success the boost AND the claim (`recordRewardedClaim`) are written in the same draft, then committed
  (`assertValidGameState`). Malformed `requestId` / `claimedAtUtcMs` -> `malformed_command`.
- `lifecycle/LifecycleSessionCoordinator.ts`: generalised structural `RewardedAdProof` (`OfflineDoubleAdProof` alias kept),
  `getExtendedOverclockOffer()`, `activateExtendedOverclockWithRewardedProof(proof)`. Order: pending offline preview -> proof check -> race guard
  (locked / already active / ineligible) -> idempotency ledger -> runtime command -> ONE critical save (`extended_overclock_activation`). The
  generic `execute()` rejects the command type (it can only be granted through a verified proof). No `platform/` or `services/` import.
- `presentation/ExtendedOverclockFlow.ts` (pure): `refreshOffer()` (player reason first, then activation gate, then ad), `start()` (request id
  `extended_overclock:${now}:${attemptSeq}`, in-flight guard, result mapping `granted | not_granted | stale | error`), 5 s ad-availability cache,
  latest-wins refresh. `ExtendedOverclockViewModel`, `ExtendedOverclockLayout`, thin `ExtendedOverclockController` (chip, Graphics fillRects only).
- HUD: `HudViewModel.extendedOverclock`, `resolveOverclockDisplayState`; the pill and the two Overclock rows show "Extended Overclock: x2" with an
  m:ss timer while active. `BoostPresentation`: an activation over an active Free still gets the impulse; a Free resume is silent.
- DEBUG ad script: `debug_ads.json` gains an optional `extendedOverclock` array (old offlineDouble-only files still parse); `device:seed-aut056`
  and seven `aut056-*` reveal-capture scenarios with a pure checks module (`tools/device/extended_overclock_checks.ts`).
- Text: 5 new `localization/en.json` keys; `EmbeddedTextCatalogue.ts` regenerated (147 entries).

## Decisions (D1-D10)

- D1: offered only when Free Overclock is unlocked.
- D2: boost id `extended_overclock`, source `rewarded`, `requestId` = the ad request id, cooldown 0.
- D3: the 10 minutes are ACTIVE-session seconds. A closed app freezes the timer; offline progress is not boosted.
- D4: Free is suspended and frozen while Extended runs, and auto-resumes when Extended expires. Free cannot start while Extended is active. Its
  cooldown keeps ticking.
- D5: the claim is recorded at grant, atomically with the boost, with one critical save.
- D6: the offer is blocked while an offline report preview is pending.
- D7: a real-ad overlay vs absence handling and a crash between reward and save stay deferred to AUT-057.
- D8: only DEBUG builds offer it (mock). Release builds use NoOp ads, so the chip never shows. Analytics are DEBUG events only.
- D9: no contextual prompting; the chip is passive.
- D10: visual polish goes to an AUT-VIS follow-up.

## Notes and deviations

- Chip width is 340 design units instead of the ~280 first estimate: "Extended Overclock 10 min" must stay >= 21 units after SHRINK. The
  `chip_shown` DEBUG event reports the label/tag effective font sizes so the device check verifies it.
- Auto-resume only follows the suspender that expired in that segment (see above).
- The `free_active` seed leaves only 30 s of Free. The capture's tap latency could let Free expire before the tap, so that check was loosened to
  remaining in (0, 30].
- A sub-minute offline preview stays pending in the session until the presentation auto-collects it; this briefly blocks the chip (D6).
- Pinned existing tests were updated deliberately: AUT-055 debug script parser result shape, catalogue count 142 -> 147, the Overclock HUD
  controller regexes, presentation text parameters, CLI scenario-id lists, scenario key lists, the bootstrap `sessionWiring` shape.

## Not verified

Device behaviour, label fit on a real device, visual composition (Scene Presentation / visual QA), the feel of the Extended activation impulse, and
the real ad SDK path (AUT-057).

## Device evidence and visual QA (2026-11-14)

DEBUG APK from 9db492f (gate label aut056; capture-check fix 8e35fd2). Scenarios (all PASS, 0 errors): `aut056-success` (real tap on the chip; rewarded verified; command accepted; boost x2, 600 s, source rewarded; HUD "Extended Overclock: ×2" counting down; claim persisted; boost still active after relaunch; chip hidden), `aut056-free-active` (Free suspended, effective x2 not x4), `aut056-resume` (Extended expiry -> Free resumes with preserved remaining -> Free expiry -> cooldown), `aut056-closed` / `aut056-failed` (no boost, no claim, calm note, chip stays), `aut056-quota` / `aut056-interval` (no chip); regressions `aut055-success`, `aut055-closed`, `ui003` PASS. The first success/free-active runs failed one check only (relaunch remaining 0.9 s HIGHER than the last pre-kill HUD value: the persisted boost is up to one save interval old); the check now allows 2 s of save lag; game behaviour was correct.

Vision QA (stills): PASS. Chip directly under SET (left aligned, 96 px, text unclipped, amber outline), no overlaps; pill "Extended Overclock: ×2" with m:ss and the x glyph; Free action not offered while active; closed/failed note calm; no chip when quota/interval blocked; no blank rectangles. Non-blocking POLISH (AUT-VIS): pill text contrast (pre-existing style), chip slightly prominent for an optional offer, ~14 px gap to SET, note easy to miss. Pending human: feel of the Extended activation impulse. Not verified: real ad SDK/overlay/crash windows (AUT-057).
