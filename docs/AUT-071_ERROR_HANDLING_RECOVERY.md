# AUT-071 Error Handling and Recovery Pass

Scope: verify the failure behaviour table of `TECHNICAL_DESIGN.md` section 28 (plus the save, time, ads, IAP and consent rules) with a named test per cell, fix the gaps found, and prove that no failure corrupts progression or deadlocks a flow. No save-schema change, no economy / design / art change.

New test files (pure, no `cc`): `tests/error_recovery_save.test.ts`, `tests/error_recovery_time.test.ts`, `tests/error_recovery_flows.test.ts`. Existing tests are reused where they already covered a cell. Run one with `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/<file>.test.ts`.

## Defects found and fixed

| # | Defect (before) | Fix (minimal) |
|---|---|---|
| D1 | Main AND backup unreadable: `load` returned a fresh game, and the first fresh save replaced the corrupt main, destroying the only evidence (design table: "new game with explicit log/recovery path"). | `AtomicSaveRepository.load` now copies the unreadable text to the new diagnostic-only logical file `save_corrupt.json` (`SAVE_CORRUPT_NAME`, best effort, never throws, never read back, outside recovery precedence) before the fresh start and also when a corrupt main is recovered from the backup. The result carries `quarantine: { status: none / preserved / failed }`. The bootstrap logs a non-fatal `console.warn`. |
| D2 | A save written by a NEWER build (`saveVersion` above the supported one) counted as plain corruption: with a valid older backup the backup was recovered and OVERWROTE the newer main; with no backup a fresh game replaced it (downgrade and data loss). | `load` now returns `{ ok: false, reason: 'unsupported_future_version' }` when main or backup is a well-formed envelope of a newer version. Nothing is written (zero writes), nothing is recovered, no fresh game: the session stays inert exactly like the existing `load_failed` path, and the bootstrap logs the reason. |
| D3 | An unreadable wall clock (NaN / out-of-range `Date.now()`) at launch made `LifecycleSessionCoordinator.startup` throw, so the bootstrap ended in `bootstrap_error` and the game stayed inert. | The startup clock read is guarded: an unreadable clock yields an `invalid_time` preview (no reward, no pending report) and the session starts normally. |
| D4 | An unreadable wall clock at save time (and any unexpected repository throw) made `PersistenceCoordinator.requestSave` REJECT after the command or reward had already been applied in memory (callers such as an offline collect saw an exception, not a result). | The coordinator turns both into a typed failed save (`clock_unavailable` / `unexpected_error`, nothing written); the dirty tracker stays dirty so the next cadence retries once the clock or storage recovers. |
| D5 | `ExtendedOverclockController` and `FounderShopController` chained `flow.start()/buy().then(...)` without a rejection handler (the flows do not reject today, but a throwing render callback would leave the chip / modal stale). | Rejection handlers added that re-render (belt and braces; the other controllers already had them). |

Verified without a defect (tests only): atomic save order, backup never overwritten by a corrupt main, truncated temp, crash before promotion, stale temp, migration failure fallback, read errors never read as "missing", ads and billing providers' result / operation backstops (injected timers), consent start timeout, duplicate callbacks, acknowledge strictly after a durable save, restore failure keeps local ownership, every `instantiate(prefab)` is null-guarded and logged.

## Test matrix

Legend: `E` = new `tests/error_recovery_*.test.ts` (title prefix `AUT-071`), otherwise `<file> :: <test title or its distinctive part>`.

### Save

| Cell | Tests |
|---|---|
| Corrupt main + valid backup recovers, never overwrites the valid backup | `error_recovery_save :: SAVE corrupt main + valid backup: recovers the backup, never rewrites it, keeps the corrupt main for diagnosis`; `atomic_save_repository :: corrupted main plus valid backup loads backup and restores main without overwriting backup`; `... :: backup preservation prefers valid backup over corrupted newer main during save`; `... :: backup recovery failure still returns the validated backup state` |
| Corrupt main AND corrupt backup: safe fresh game, no crash, corrupt file preserved | `error_recovery_save :: SAVE corrupt main AND corrupt backup: a safe fresh game...`; `:: SAVE missing main + corrupt backup keeps the corrupt backup...`; `:: SAVE a failed diagnostic copy never blocks...`; `:: SAVE corrupt main AND corrupt backup through the session bootstrap...`; `:: SAVE the quarantine file is outside recovery precedence`; `atomic_save_repository :: fresh-game fallback is explicit when neither main nor backup is valid or present` |
| Truncated / partial write (atomic rename / crash simulation) | `error_recovery_save :: SAVE truncated main (partial write)...`; `:: SAVE crash simulation: a partial temp...`; `:: SAVE crash simulation: dying after the temp is verified but before promotion...`; `atomic_save_repository :: invalid temp verification failure never promotes temp to main`, `:: temp write failure leaves main and backup untouched`, `:: destructive main promotion failure preserves previous valid main through backup`, `:: stale temp never takes precedence over valid backup`; `file_save_storage :: AtomicSaveRepository over FileSaveStorage saves atomically with backup rotation and recovers from backup` |
| Unknown future save version: no downgrade, no overwrite | `error_recovery_save :: SAVE unknown future save version: load refuses, writes nothing...`; `:: ... in the backup only (main unreadable)...`; `:: SAVE a version below the current one is NOT a future version`; `:: SAVE future version through the session bootstrap: load_failed, zero writes`; `save_migrations :: future and unsupported legacy versions are rejected deterministically` |
| Failed write (storage full / IO error): play continues in memory and retries | `error_recovery_save :: SAVE failed write (storage full / IO error) keeps the in-memory session playing and the next save retries...`; `:: SAVE failed critical suspend save is reported...`; `lifecycle_session_coordinator :: post-collect persistence failure is explicit and does not roll back applied reward`; `offline_double :: persistence failure after apply: reward and claim stay in memory`; `extended_overclock_session :: persistence failure: activated_persistence_failed keeps the boost and the claim in memory...` |
| Migration failure | `error_recovery_save :: SAVE migration failure: a throwing step makes the main unreadable, the backup is used, the legacy bytes are preserved`; `:: SAVE migration failure of main AND backup...`; `save_migrations :: failed legacy main migration still allows fallback to a migratable backup`, `:: AUT-GP-001 v1 -> v2 migration never launders a corrupted v1 integrity hash`; `rewarded_claim_history :: corrupted history in main (valid hash) is rejected and backup recovery is used; v2 main migrates` |
| Storage read error is never "missing" / "corrupt" | `error_recovery_save :: SAVE storage read error is never treated as a missing or corrupt save`; `atomic_save_repository :: read errors fail deterministically instead of silently starting fresh`; `game_session_bootstrap :: a storage read error reports load_failed and performs zero writes`; `game_session_bootstrap :: corrupt main with a valid backup recovers from the backup` |

### Time

| Cell | Tests |
|---|---|
| Clock moved backwards: no negative / duplicate reward, no progression loss | `error_recovery_time :: TIME clock moved backwards at launch...`; `:: TIME clock moved backwards between suspend and resume...`; `offline_progress :: zero, negative clock skew and malformed UTC inputs resolve deterministically`; `time_service :: UTC absence primitives use SaveEnvelope timestamp validation and clamp backwards elapsed time`; `:: TIME monotonic time never goes backwards` |
| Huge forward jump is capped | `error_recovery_time :: TIME huge forward jump is capped...` (+100 years and year 9999); `:: TIME a huge forward jump during an ACTIVE session changes nothing`; `offline_progress :: offline cap is applied exactly at and above eight hours`; `time_service :: runtime active-session advancement uses monotonic elapsed time and ignores UTC clock jumps` |
| Invalid / NaN timestamps | `error_recovery_time :: TIME invalid / NaN / malformed UTC inputs...`; `:: TIME a save whose savedAtUtc is invalid / non-canonical is unreadable...`; `:: TIME an unreadable wall clock at launch...` (D3); `:: TIME an unreadable clock turns a save into a typed failed result...` (D4); `:: TIME the binding survives a throwing clock at suspend / resume...`; `save_envelope :: invalid metadata types and non-canonical UTC timestamps are rejected`; `offline_progress :: failed offline collection leaves state and timestamp semantics unchanged`; `offline_report :: collect_failed keeps the pending preview and a retry succeeds` |
| Timezone change | `error_recovery_time :: TIME timezone change...` (child processes with `TZ=UTC / Asia/Kolkata / Pacific/Kiritimati / America/Los_Angeles`; offset-bearing stamps are rejected, never shifted); `time_service :: save metadata consumes injected UTC time through the clock boundary` |

### Ads (rewarded x2 offline report, Extended Overclock chip)

| Cell | Tests |
|---|---|
| Ad unavailable / no network | `error_recovery_flows :: ADS ad unavailable / no network (immediate terminal native answer)...`; `:: ADS Extended Overclock chip: unavailable ad hides the offer...`; `offline_double_flow :: flow: ad unavailable -> blockedBy ad...`; `extended_overclock_flow :: flow: NoOp ads never offer...`; `offline_double :: non-granting proofs change nothing; free collect then equals control` |
| Show fail | `error_recovery_flows :: ADS show fail (native call throws)...`; `:: ADS closed early / unverified reward: no grant without verified proof...`; `android_admob_provider :: android ads: closed, failed and unavailable events never verify a reward`, `:: malformed JSON, unknown status and native exceptions resolve failed and never throw`, `:: rewardVerified needs BOTH status rewarded AND native rewardVerified true`; `offline_double_flow :: flow: errors from the ad provider or the session map to error and clear the in-flight flag` |
| SDK init failure | `error_recovery_flows :: ADS SDK init failure: ads stay closed...`; `android_admob_provider :: android ads: initialize, status, availability and preload map one native call each and expose reasons`; `consent_bootstrap :: ads gating: nothing reaches the provider until canRequestAds...` |
| Duplicate callbacks | `error_recovery_flows :: ADS duplicate callbacks ... grant exactly once`; `:: ADS Extended Overclock duplicate callbacks...`; `android_admob_provider :: first result wins; a duplicate event is a no-op...`; `offline_double_flow :: flow: duplicate ad callback never grants twice`; `extended_overclock_flow :: flow: a duplicate ad callback never grants twice`; `offline_double :: a replayed request id (ledger) is a no-op duplicate`, `:: simultaneous invocations grant exactly one bonus` |
| Callback after timeout | `error_recovery_flows :: ADS callback after timeout: the watchdog ends the attempt...` (injected timer; late verified callback ignored; a new attempt still grants); `android_admob_provider :: android ads: the JS backstop resolves timeout, ends the overlay and ignores a late event` |
| App killed during the ad | `error_recovery_flows :: ADS app killed during the ad...` and `:: ADS Extended Overclock duplicate callbacks and an app killed during the ad...`; `offline_double :: crash before the save leaves the preview pending and no claim`; `offline_report :: D1: killing the app before Collect and relaunching recomputes an equivalent report...` |
| No deadlock of the offline card / Extended chip; state returns to ready | `error_recovery_flows :: ADS a free COLLECT while the ad hangs is never blocked...`; `:: ADS a failed save after the verified x2...`; `:: ADS Extended Overclock chip: ... the chip returns to ready`; `offline_double_flow :: flow: a free COLLECT during the ad makes the late verified result a harmless stale no-op`, `:: flow: second start while an ad is in flight is a no-op` |

### IAP (Founder's Factory Pack)

| Cell | Tests |
|---|---|
| Cancelled / pending / failed | `founder_shop_ui :: AUT-059 flow CANCEL / FAIL / UNAVAILABLE / TIMEOUT...`, `:: flow PENDING...`, `:: flow: a thrown purchase call is a calm failure`; `android_billing_provider :: cancel, fail, unavailable and an unknown status resolve without a transaction`, `:: pending then purchased...`; `android billing + flow: cancel and fail grant nothing and acknowledge nothing` |
| Service disconnected / no network | `android_billing_provider :: init retry after a service disconnect (failed -> initialize again -> ready)`, `:: initialize that never hears back fails closed on the backstop`, `:: immediate terminal native answers (service unavailable)...`, `:: product query timeout and unavailable store fail closed (no price)`; `founder_shop_ui :: AUT-059 flow: NoOp / unavailable / failed store -> the entry is hidden...` |
| Restore fail / no network keeps local ownership | `purchase_restore :: local true / no network: a failed, unavailable or silent store query keeps ownership...`, `:: policy: local true + store unavailable / unknown / not_owned / error keeps ownership (never a revoke)`, `:: foreground re-query picks up a purchase completed outside the app ... a failed query afterwards keeps it` |
| Duplicate callbacks | `android_billing_provider :: a duplicate callback resolves the call once and is dropped`, `:: a reused request id is a no-op duplicate...`; `founder_shop_ui :: AUT-059 flow IDEMPOTENCE...`, `:: flow: concurrent redelivery while the apply is in progress is ignored`; `purchase_restore :: duplicate transaction: a replayed owned / completed delivery is ignored` |
| App killed between payment and grant; redelivery grants once, acknowledge only after the durable save | `error_recovery_flows :: IAP app killed between payment and grant, then a failed save: redelivery grants once, acknowledges only after the durable save`; `purchase_restore :: unacknowledged store purchase on a fresh save (live redelivery)...`, `:: a failed acknowledge keeps the grant (idempotent)...`; `android_billing_provider :: android billing + flow: success grants once, acknowledges only AFTER the durable apply`, `:: timeout fails closed, ends the overlay and a late completion is still delivered (never lost)`, `:: pending then completed outside the flow grants once...` |
| Save failure after purchase | `error_recovery_flows :: IAP app killed ... then a failed save` (second launch); `founder_shop_ui :: AUT-059 flow: apply with a failed save is reported as not_saved, not acknowledged, and never granted twice on a retry`; `android_billing_provider :: android billing + flow: apply that could not be saved => NO acknowledge`, `:: coordinator: a replayed Founder grant after a failed save retries the save before reporting success` |

### Consent

| Cell | Tests |
|---|---|
| Init failure / timeout leaves the game playable and ads closed | `consent_bootstrap :: consent: a native call that throws, malformed JSON and unknown statuses end as error, ads closed, no rejection`; `:: consent: no answer within the start timeout -> error / consent_timeout, ads closed, start resolves (never blocks)`; `:: consent: unavailable never allows ads...`; `:: consent: required and declined keeps ads closed (fail-closed) and gameplay free`; `:: consent: a form that never reports its end releases the overlay through the backstop`; `:: bootstrap wiring: consent is chosen before ads and gates them, starts only AFTER session ready, never awaited on the startup path` |

### Missing visual asset

Audit result: the shipped runtime has NO runtime asset loader (`resources.load` / `assetManager` / `AudioSource` / `TTFFont` do not exist); audio is the silent service, fonts are system fonts, and every 3D module is a prefab reference serialized on `FactoryWorldBootstrap` and instantiated by a controller. Every `instantiate(prefab)` in `presentation/` is behind a null guard that logs a `console.warn` and skips (the module is simply absent, the economy and the session continue).

| Cell | Tests |
|---|---|
| Missing / failed prefab, texture, audio, font does not crash or block | `error_recovery_flows :: MISSING ASSET every prefab instantiate() in presentation is behind a null guard with a logged non-fatal diagnostic (skip, never throw)`; `:: MISSING ASSET audio and fonts cannot fail the session...` (fails if a runtime loader is ever added without a failure path) |

### Deadlock / robustness (flow liveness)

| Cell | Tests |
|---|---|
| Watchdog timers fire in injected-clock tests and release the flow / overlay | `error_recovery_flows :: ADS callback after timeout...`, `:: ADS Extended Overclock chip...`; `android_admob_provider :: the JS backstop...`, `:: overlay is cleaned up on every path`; `android_billing_provider :: initialize that never hears back fails closed on the backstop`, `:: timeout fails closed...`; `consent_bootstrap :: a form that never reports its end releases the overlay through the backstop` |
| Every async flow handler also handles rejection (no stuck in-flight flag) | `error_recovery_flows :: LIVENESS every async flow handler in a modal / chip / card controller also handles rejection` (source pin, D5) |
| Every modal has a way out independent of the flow | `error_recovery_flows :: LIVENESS every modal has a way out...` (CLOSE and backdrop tap for Founder / AI Upgrades / Settings, cancel for Reboot, silent auto-collect settles on rejection); `error_recovery_flows :: LIVENESS the platform watchdogs are in the provider layer`; `error_recovery_time :: TIME the binding survives a throwing clock at suspend / resume` (a failed resume still un-pauses the session) |

## Device smoke (optional): skipped

The proposed `aut071-corrupt-main` reveal scenario was NOT built. It needs a new seed, a new objective-check module, a new expectation threaded through `cli.ts` AND `reveal_capture.ts` (several signatures), and updates to the pinned scenario lists in many device tests; that is more scaffolding than a cheap smoke. No device run was made. A manual DEBUG-APK recovery check is described in the implementation report (unverified).

## Remaining risks / follow-ups

- A save from a newer build leaves the world inert (the existing `load_failed` behaviour, now also used for D2). There is no player-facing "update required" message: that needs a product / UX decision (route: Game Designer / Technical Lead).
- `save_corrupt.json` keeps only the latest unreadable copy and is not part of `SAVE_FILE_NAMES`, so device seeds do not clear it (harmless, diagnostic only).
- Clock rewind after a legitimately saved timestamp can re-measure up to the 8 hour cap again: accepted by `TECHNICAL_DESIGN.md` 21.5 ("no player punishment for timezone / clock anomalies"); not changed.
- With an unreadable wall clock no save can be stamped (no invented time): progress made in that window is not persisted until the clock is readable (practically unreachable on Android).
- A Founder purchase reported `pending` keeps the BUY disabled until ownership is observed or the app restarts (no timeout on the pending flag); nothing is granted and the modal can always be closed.
- A prefab that is present but corrupt could still throw inside `instantiate`; that is a Cocos-layer failure not unit-testable here.
- The native Android layer (`AutomataPlatformBridge.java` and the Billing / AdMob / UMP controllers) was not changed or re-tested here.

## Device evidence (2026-11-15)

Gate APK `aut071`; `npm run check` 1549 tests green. Manual corrupt-main procedure executed on the device (serial 1100a155): after seeding a valid save, copying it to `save_backup.json` and truncating `save_main.json` to `{`, relaunch logged `[AUT-071] Save recovery: recovered_backup (unreadable copy preserved: preserved)`, `save_corrupt.json` held `{`, and `save_main.json` was restored with valid JSON. Regression captures PASS: aut051, aut049, aut052, aut059-available, aut055-success. The future-version device procedure and an `aut071-corrupt-main` scenario were not run/built (covered by unit tests).
Open product item (not decided): a save from a newer build leaves the session inert with no player-facing "update required" message.
