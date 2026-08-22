# AUT-028 Lifecycle Save & Offline Orchestration

AUT-028 adds a headless session boundary around `GameRuntime`, persistence, `TimeService`, and AUT-027 offline progress. It does not bind Cocos application events, native lifecycle hooks, scenes, UI, ads, or platform services.

## Startup

`LifecycleSessionCoordinator.startup` loads through `PersistenceCoordinator`, which delegates storage ownership to `AtomicSaveRepository`.

Startup outcomes are explicit:

- `loaded_main`: valid main save loaded.
- `recovered_backup`: backup loaded through AUT-024 recovery, with the recovery rewrite result preserved.
- `fresh_game`: neither main nor backup produced a valid loaded state, so AUT-024 fresh fallback created state.
- `load_failed`: storage read failure prevented deterministic load or fallback.

Loaded main and recovered backup saves create an offline preview from the save envelope `savedAtUtc` to the current injected `TimeService` UTC. Startup returns that preview but never collects or mutates state. Fresh startup has no persisted absence boundary, so it returns no offline preview.

Migrated saves participate exactly like current saves because loading is routed through AUT-024/AUT-025. Startup does not persist migration output by itself.

## Persistence Ownership

`PersistenceCoordinator` is a narrow orchestration wrapper over:

- `AtomicSaveRepository` for temp/main/backup storage operations.
- `DirtySaveTracker` for ordinary dirty-save cadence.
- `TimeService` for save metadata timestamps.

The lifecycle layer never reads or writes save files directly.

Ordinary saves use the AUT-024 debounce/periodic policy and monotonic session time. Critical saves bypass the dirty policy. Save requests are serialized through a single promise queue so overlapping requests cannot run concurrent atomic writes. A later ordinary request re-checks the dirty policy after earlier queued saves complete; a critical request always runs when it reaches the queue.

## Suspend And Resume

`suspend` captures the current injected UTC through `LifecycleTimeTracker`, records it as the open absence boundary, and requests a critical save using that exact UTC as `savedAtUtc`.

Suspend does not calculate, preview, collect, or grant offline rewards. It also does not advance temporary boost durations from wall-clock time.

`resume` uses the open suspend boundary and current injected UTC to create an AUT-027 offline preview. The preview is stored as pending only when it is collectible (`preview_ready`). `no_reward` or invalid previews are returned to callers for visibility but are not retained as pending collection actions.

Repeated `resume` without a new suspend does not create a new absence window. If a collectible preview already exists, the existing preview is returned.

## Offline Collection

Offline collection is an explicit action through `collectPendingOffline`.

The coordinator passes the pending AUT-027 preview and current runtime state into `collectOfflineProgress`. If AUT-027 reports invalid input or collection failure, the coordinator leaves the authoritative runtime state unchanged.

When AUT-027 returns a successful collected state, the coordinator replaces its internal `GameRuntime` once with that authoritative collected state, clears the pending preview, records the closed absence UTC, and requests a critical save using the collection cursor UTC.

A second collection attempt for the same in-memory absence returns `no_pending_preview` and grants nothing.

## Durability Boundary

Offline reward application and post-collect persistence are deliberately separate outcomes.

If AUT-027 successfully applies the reward but the critical save fails, `collectPendingOffline` returns `collected_persistence_failed`. The in-memory authoritative state remains collected; the coordinator does not roll back the reward because the current persistence architecture does not provide a transaction rollback primitive across runtime state and storage.

Callers must treat this as a partially completed result:

- state changed in memory;
- durability is not guaranteed;
- the user-facing flow must not claim fully durable success.

This preserves the AUT-024 atomic storage guarantee while making the state-versus-durability boundary explicit.

## Deferred Integration

AUT-028 intentionally leaves these to later tasks:

- Cocos `Application.EVENT_HIDE` / `EVENT_SHOW` binding;
- Android or iOS native lifecycle hooks;
- offline report popup or view model;
- rewarded offline multiplier and ads;
- Reboot orchestration.
