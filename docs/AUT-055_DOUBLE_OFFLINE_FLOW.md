# AUT-055 Double Offline Reward Mock Flow

Connects the Offline Factory Report (AUT-051) to a rewarded-ad flow and an exactly-once, atomic x2 collection (MONETIZATION section 4,
multiplier 2.0). Only a MOCK ad exists (DEBUG builds); no data/economy change and NO save-schema change (the AUT-MIG-001 claim history is
reused as is; `assertValidGameState` accepts the claim state).

## What was built

- `offline/OfflineService.ts`: `collectOfflineProgress(repo, state, input, options?: { rewardMultiplier? })`, default 1 (all existing behaviour
  unchanged). `applyOfflineReward(draft, preview, multiplier)` multiplies the applied IO reward AFTER the withheld assisted-batch subtraction and
  adds it to `run.industrialOutput`, `run.statistics.industrialOutputEarned` and `lifetime.industrialOutputEarned`. Robots and assisted timers are
  not multiplied. A multiplier that is not finite or is < 1 returns `invalid_config` with no mutation. `criticalSaveRequest` gains
  `rewardMultiplier` and `grantedIndustrialOutput` only when the multiplier is > 1 (so the multiplier-1 shape is byte-identical).
- `monetization/RewardedEligibility.ts`: `OFFLINE_DOUBLE_MULTIPLIER = 2.0`, `OFFLINE_DOUBLE_CLAIM_KEY = 'rewarded.offline_double'` (stored claim
  key and ad placement id; the short id `offline_double` stays only inside `evaluateOfflineDoubleEligibility`).
- `lifecycle/LifecycleSessionCoordinator.ts`: `getOfflineDoubleOffer()` and `collectPendingOfflineWithRewardedBonus(proof)` with a locally declared
  structural `OfflineDoubleAdProof` (no services/platform import). Order: no pending preview -> `no_pending_preview`; proof check (status
  `rewarded`, `rewardVerified === true`, not `duplicate`, placement = claim key, non-empty request id) else `bonus_not_granted` with no state change and
  no collect; eligibility re-evaluated against the pending preview and the current snapshot (race guard); the request id is consumed in the
  idempotency ledger (optional constructor option `rewardClaimLedger`, default internal set) only after those checks and just before applying; collect
  with multiplier 2; the claim is recorded on the same draft (`recordRewardedClaim`, `assertValidGameState` re-run; if recording fails the flow falls
  back to the free collect with no claim: fail closed); runtime replaced, pending preview and cursor cleared, ONE critical `offline_collect` save.
  A persistence failure behaves as for the free collect (`collected_persistence_failed`, applied in memory, claim counted, `bonusGranted: true`).
- `presentation/OfflineDoubleFlow.ts` (pure): `refreshOffer()` (offer + ad availability combined only by `canOfferRewarded`; player reason wins),
  `getState()`, `start()` (builds `offline_double:${now}:${attemptSeq}`, `ads.showRewarded`, hands the result to the session as a proof, maps to
  `granted | not_granted | stale | error`, in-flight guard).
- `presentation/FactoryWorldStateBinding.ts`: `getOfflineDoubleOffer()` and `collectOfflineReportWithBonus(proof)` (same guard / refresh / report
  pattern as `collectOfflineReport`; the HUD refreshes only when the bonus was applied).
- UI: `OfflineReportLayout` (`x2` flag, `double` rect, card +88 = 12 gap + 76, worst case 350 -> 438, `OFFLINE_REPORT_MAX_HEIGHT_RATIO` 0.30 -> 0.35),
  `OfflineReportViewModel.resolveOfflineDoubleOutcome`, `OfflineReportText` (`formatOfflineDoubleTexts`, `formatOfflineDoubleNotGranted`),
  `OfflineReportController` (`OfflineDoubleAction` Button below COLLECT: cyan outline made of two `fillRect`s, cyan label `COLLECT ×2 — {value}`
  font 30, `Rewarded Ad` tag font 22; scale visibility; dimmed alpha 110 and inert while the ad is in flight, the free COLLECT stays usable).
  Keys `offline.double.button|tag|not_granted` in `localization/en.json`; `EmbeddedTextCatalogue` regenerated (142 entries).
- Provider injection: `presentation/BuildPlatformServices.ts` `createBuildAdsService(debug, script?)`: DEBUG -> `MockAdsService` (ready, placement
  available, default immediate verified `rewarded`, outcomes from the DEBUG script); otherwise `NoOpAdsService` (x2 hidden). The bootstrap calls it
  with `DEBUG === true`.
- DEBUG diagnostics and device tooling: `presentation/DebugAdsScriptFile.ts` (`debug_ads.json`, read once and deleted, only when `DEBUG === true`
  and device diagnostics are enabled), DEBUG event `offline_double` (phases `script`, `claims`, `offer`, `ad_started`, `ad_result`, `granted`,
  `not_granted`), `ui_layout` rect `OfflineReportDouble`, `tools/device/seed_aut055.ts` (`npm run device:seed-aut055 [-- --variant
  ready|short_ineligible|quota] [--outcome rewarded|closed|failed]`), `tools/device/offline_double_checks.ts` and the reveal scenarios
  `aut055-success`, `aut055-closed`, `aut055-failed`, `aut055-ineligible`. All seeds that removed `debug_command.json` now also remove a stale
  `debug_ads.json`.

## Decisions recorded

- D1 Robots are not doubled (IO only). One line in `applyOfflineReward` if wanted later.
- D2 The multiplier applies after the withheld-settlement subtraction; the doubled IO counts toward the earned statistics.
- D3 The claim is recorded at grant, not at ad start (a closed or failed ad consumes no quota).
- D4 A non-verified proof never collects; the player's own tap on free COLLECT is the fallback.
- D5 `pendingAdRequests` is not used. Crash recovery of a verified-but-ungranted reward is an AUT-057 concern; after a kill the preview is still
  pending, so the free reward is intact and no claim exists.
- D6 The free COLLECT stays active during an x2 ad. A late verified result after the player collected hits `no_pending_preview` and is a no-op
  (`stale`).
- D7 Release builds use `NoOpAdsService` (x2 hidden); the mock exists only in DEBUG builds; the Android provider stays unwired until AUT-057.
- D8 Overlay-vs-absence handling (EVENT_HIDE / EVENT_SHOW while a real ad is showing) is deferred to AUT-056 / AUT-057. The mock reports no
  full-screen overlay, a pending preview already survives suspend / resume, and a test asserts the mock flow never calls suspend or resume.
- D9 The card height ratio is raised to 0.35, the smallest round value that holds on every tested screen (438 / 1280 = 0.342). The x2 action is
  shown only when the player is eligible AND the ad is available (no dead or disabled button).
- D10 No analytics events beyond the DEBUG device events.
- D11 The note slot is shared by the retry line, the calm "No bonus this time." line and the educational line (retry wins, then not-granted).

## Notes for reviewers

- The request id is `offline_double:${nowMs}:${attemptSeq}` (the flow does not see the preview; ids are unique per attempt, which is all the ledger
  needs).
- The em dash in `COLLECT ×2 — {value}` must be checked on a device font; fall back to `-` in `en.json` if it does not render.
- Whether the card with the x2 action reads well (composition, contrast, outline, label fit) and how the ad round trip feels are NOT verified by the
  automated checks (device capture + visual review pending).
