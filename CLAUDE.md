# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project and sources of truth

Project Automata is a commercial idle/automation mobile game on **Cocos Creator 3.8.8** (TypeScript; Android primary, iOS architecture-ready). The engine is locked: Godot was evaluated and abandoned, so ignore Godot-era references (old `feat/aut-00x`/`feature/AUT-00x` branches, Godot sections of `docs/TECHNICAL_DESIGN.md`).

The repository docs are the durable memory; read the relevant ones on disk before acting rather than assuming their content:

- `docs/CODEX_PLAN.md` — ordered task sequence (`AUT-0xx`), per-task scope/acceptance/manual gates, and the guardrails every task follows (§2). Source-of-truth order is in §1.
- Domain owners: `GAME_DESIGN.md`, `ECONOMY.md`, `MONETIZATION.md`, `ART_DIRECTION.md`, `ASSET_MANIFEST.md` (check before adding any asset), `TECHNICAL_DESIGN.md` (architecture).
- `docs/AUT-xxx_*.md` — one short record per completed task describing what was actually built.

Do not change game design, economy values, monetization, art direction or product scope without an explicit decision from the owner/developer — report conflicts instead.

## Workflow

- One branch per task: `feat/aut-0xx-<slug>` off `main`; one commit per task, `feat(<area>): complete AUT-0xx <title>`, plus its `docs/AUT-0xx_*.md`. Merges to `main` and pushes are done by the human — never merge, push, force-push, reset --hard or clean without explicit instruction.
- Tasks are also driven by the separate Factory repo `C:\dev\mobile-game-factory` (task JSON, workflow state, Codex runs, Technical Lead review). Don't modify it unless asked.
- Technical tasks validate runtime/wiring/behavior. Pure visual composition (framing, placement, readability) goes in separate `AUT-VIS-xxx` follow-ups and must not keep a functionally accepted task open.
- Automated checks (tests, simulator) cannot satisfy subjective gates: game feel, fun, felt pacing, camera/reveal feel, monetization and major architecture decisions, store release. Report those as pending, never as validated. Routine visual checks follow the review policy below.
- Review policy (owner decision 2026-11-12, supersedes the older "always human" wording in this file and in the agent contracts):
  1. Visual/device evidence (native device screenshots, `temp/` run evidence, documented art/gameplay intent) is reviewed FIRST by a vision-capable Scene Presentation / Visual QA agent (`scene-presentation`, reading the actual PNGs against the task brief, the Art Director intent and `docs/ART_DIRECTION.md`). It returns PASS / CHANGES_REQUESTED / HUMAN_REVIEW_REQUIRED with per-criterion evidence.
  2. Routine checks are agent-decidable and never go to the owner: composition, readability, clipping, presence, layout, on-screen/off-screen, silhouette contrast, state visibility (unbuilt/Lv1/Lv10), regressions visible in screenshots.
  3. Escalate to the owner only when the decision is genuinely subjective (game feel, fun, felt pacing, reveal/camera feel, "does this feel good"), ambiguous (evidence missing or contradictory, screenshots cannot answer the criterion), or product-directional (design, economy, monetization, art direction, scope, store release). Say which of the three applies and ask ONE question.
  4. An agent PASS is evidence-based and must cite the screenshots/files it examined; it never claims what the screenshots cannot show (motion, timing, real-time feel). Motion/feel criteria stay HUMAN_REVIEW_REQUIRED unless the owner delegates them.

## Commands

npm scripts wrap PowerShell scripts in `tools/ci/`. Node **24.x** is required: tests and tools execute `.ts` directly via Node's built-in type stripping (no transpile step, no linter).

- `npm run check` — the task gate: config validation, Android Ads config check, all tests, pacing regression.
- `npm test` — all `tests/**/*.test.ts` via `node --test`.
- Single test: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/game_runtime.test.ts`
- `npm run validate:config`, `npm run simulate:reference`, `npm run simulate:pacing`.
- `npm run android:build` — Cocos CLI build + Gradle debug APK (Cocos Creator 3.8.8 at the default path or `COCOS_CREATOR_EXE`; uses `temp/ci/android-sdk` when present, else `%LOCALAPPDATA%\Android\Sdk`). APK: `build/android/proj/build/ProjectAutomata/outputs/apk/debug/ProjectAutomata-debug.apk`; package `com.projectautomata.androidbaseline`; `adb` is in `%LOCALAPPDATA%\Android\Sdk\platform-tools`.
- **Build start scene:** `tools/ci/cocos_android_debug_build.json` (tracked) still launches `CameraSpike.scene`. Device runs of FactoryWorld temporarily switch `startScene`/`scenes` to `FactoryWorld.scene` (uuid `b0330000-0000-4000-8000-000000000010`); restore the file afterwards and keep any backups/APKs/logs under the gitignored `temp/`, not in the repo.

## Architecture

- **Engine-free core** (`assets/scripts/{config,domain,state,economy,progression,runtime,persistence,time,offline,lifecycle,simulation,services}`): never imports `cc`, uses explicit `.ts` import extensions so Node can run it, and is what the tests exercise (`tools/ci/test.ps1` rejects tests importing `cc`).
- **`GameRuntime`** (`runtime/`) is the single authority: UI submits `GameCommand`s (`domain/Commands.ts`), the runtime updates `GameState` through `economy/` (formulas) and `progression/` (eras, automation, breakthroughs, boosts, permanent upgrades, Reboot/AI Cores) and emits `DomainEvent`s (`domain/Events.ts`). The headless simulator uses the same modules — never duplicate a formula.
- **Data-driven balancing**: `data/economy/*.json` → `config/ConfigLoader.ts` → typed `GameConfigRepository`. Pacing targets/baselines in `data/simulation/`.
- **Platform boundary**: `services/` interfaces (`AdsService`, `PurchaseService`, `EntitlementService`) → `platform/{mock,noop,android}` providers → Java bridge `native/engine/android/app/src/com/cocos/game/AutomataPlatformBridge.java` → official Google SDKs. Gameplay code never calls native SDKs. `native/engine/` is tracked; the rest of `native/` is generated.
- **Presentation** (`presentation/`, `camera/`, `app/`, plus `platform/android/`) is the only `cc` code and is non-authoritative: it observes state/events and submits commands. Pattern: a pure, unit-tested `*ViewModel`/resolver (`VisualStateResolver`, `HudViewModel`, `ProducerPanelViewModel`, `AutomationPayoffViewModel`, `CameraMath`) plus a thin `*Controller` component. `FactoryWorldBootstrap` builds the `FactoryWorld.scene` hierarchy at runtime and wires controllers; imported 3D modules are prefab references serialized on it (`factoryPrefabs`), from `assets/art/`.
- Scene tests read `.scene` JSON and controller sources as text, so scene/wiring edits can break them. Every new `.ts` needs its Cocos `.ts.meta` committed alongside. `profiles/v2/*` changes are editor preferences — don't commit them incidentally.
