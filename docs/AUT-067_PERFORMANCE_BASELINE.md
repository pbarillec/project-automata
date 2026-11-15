# AUT-067 Worst-Case Performance Scene & Baseline

**Status: tooling complete, baseline results PENDING (device run by the orchestrator).** This task builds the reproducible benchmark state and the capture
that produces a documented baseline BEFORE any optimization. It changes no gameplay, economy, visuals, assets or scene files, and optimizes nothing
(AUT-068 is separate). No pass/fail budget gating: the AUT-041 budget (p95 <= 25 ms, >= 50 fps) is reported as information only.

## What was built
- `tools/device/seed_aut067.ts`: the benchmark save + the DEBUG override file. Variants `standard` (default, Founder NOT owned) and `founder` (adds the Founder pack
  grant through `applyFounderPackPurchase`, i.e. the UNIT 0001 Founder robot + crest). Seed-only, no new state shape.
- `assets/scripts/presentation/PerfSecondSampler.ts` (pure, engine-free) + a DEBUG-only hook in `RobotPopulationController`: after the AUT-041 benchmark override file is
  read, an override with `"perf": true` also starts a per-second sampler (6 s warm-up, then 1 sample per second, max 120). New DEBUG events `perf_second` and
  `perf_scene` (declared in `DeviceDiagnostics.ts`). Release builds never read the override (`DEBUG` guard) and never emit.
  - `perf_second`: frames, fps, avg / p50 / p95 / p99 / max ms, `jank` (> 33.34 ms, about two 60 Hz frames), `bigJank` (> 50 ms), a 1 ms histogram, plus the Cocos gfx device
    frame counters `drawCalls` / `tris` / `instances` read from `director.root.device.numDrawCalls / numTris / numInstances` (null when the engine does not expose them).
  - `perf_scene` (at sample 0, 30, 59): node / active node count, `MeshRenderer`, `SkinnedMeshRenderer`, `ParticleSystem`, light, shadow-casting renderer and UI renderer counts and the
    number of unique shared materials, with the same draw call / triangle counters and `statsSource` (`director.root.device` or `unavailable`).
- `tools/device/perf_stats.ts` (pure, no `cc`, no adb; unit tested): percentiles (also from a merged 1 ms histogram, resolution +-0.5 ms), per-second FPS distribution,
  jank counts, gfx counter summary, AUT-041 budget comparison (information only), parsers for `dumpsys gfxinfo` / `meminfo` / `top` / `cpuinfo` / `display` / `wm` /
  SurfaceFlinger GLES line / Adreno `gpubusy`, and the markdown renderer.
- `tools/device/perf_baseline.ts`: the capture window (`runPerfWindow`), the objective sanity checks (`evaluatePerfBaseline`), the document builder and the writer.
- Wiring: scenarios `aut067-baseline` and `aut067-baseline-founder` in `reveal_capture.ts` (`REVEAL_SCENARIOS`), evaluated by `evaluateRevealTimeline`
  (`expectPerfBaseline`), passed through `cli.ts`; `seed-aut067` CLI command and `npm run device:seed-aut067`. `SessionDeviceDriver` gained an optional raw `shell()`.
  `perf_second`, `perf_scene` and `robot_benchmark` join the default reveal event types.
- Tests: `tests/perf_baseline.test.ts` (sampler, stats, parsers, sanity checks, document, seed, scenario wiring); `tests/reveal_capture.test.ts` pinned scenario list updated.

## Benchmark state definition
| Aspect | Value |
|---|---|
| Era | Era III `robotics_complex` (Advanced Robotics owned) |
| Producers | all five (Fabricator, Assembly Station, Robot Line, Automated Cell, Advanced Robotics Complex) built at **Lv100** (top visual milestone tier) |
| Automation | every producer automated (belts / arm / item cycles / logistics running); Auto Feeder, Worker Bot, Robotic Logistics, Factory Control System, Automated Cell Architecture, Advanced Robotics owned |
| Robots | Robots Built 1,000,000 + DEBUG override `population_benchmark.json` `{ "maxVisible": 14, "perf": true }` = **14 visible robots** (AUT-041 baseline saturation) |
| Overclock | Free Overclock ACTIVE with its full 60 s left at load (VFX + HUD pill); the steady window opens about 8-12 s after launch and lasts 45 s, so the boost covers it, then it would enter cooldown |
| HUD | the normal HUD (no panel open, no card: the save is 1 s old, under the 60 s offline-card minimum) |
| Identity (post-AUT-066) | decals on every producer (+20 renderers) and the AI Core socket (+3) are part of the scene |
| Founder | `standard`: not owned; `founder`: Founder robot (rank 0 + one pooled robot) |

## Method and exact commands
Requires a connected Android device and the FactoryWorld **DEBUG** APK installed (diagnostics + `run-as`); the default Cocos build start scene must be switched to
`FactoryWorld.scene` as for every other device run (see CLAUDE.md), and restored afterwards.

```
npm run device:devices
npm run device:seed-aut067 -- --variant standard            # optional: only seeds + launches the same state for manual inspection
npm run device:reveal-capture -- --scenario aut067-baseline          # the baseline (Founder not owned)
npm run device:reveal-capture -- --scenario aut067-baseline-founder  # optional variant with the Founder robot
```
Add `--serial <id>` when several devices are attached. The capture seeds by itself (force-stop, save + override, launch), then:
1. waits for `ui_layout`, records static facts (`getprop`, `wm size/density`, `dumpsys display`, SurfaceFlinger GLES line, APK path + `sha256sum`, package info);
2. `dumpsys meminfo` BEFORE, `dumpsys gfxinfo <pkg> reset`, first read of the GPU busy counter (resets it);
3. waits for the first `perf_second` (end of the app's 6 s warm-up) and holds the **45 s steady window** (no screenshots inside it: screencap would perturb frame time);
   mid-window: `top -b -n 1` and `dumpsys cpuinfo`;
4. `dumpsys meminfo` and `dumpsys gfxinfo` AFTER, GPU counter read;
5. removes the DEBUG benchmark override from the device (so later captures are not silently benchmark runs), writes the outputs.

Outputs: `temp/perf/<ts>/baseline.json` (schema `aut067-baseline/1`), `temp/perf/<ts>/baseline.md`, `temp/perf/<ts>/raw/*.txt` (every adb text), and the usual
`temp/reveal/aut067-baseline-<ts>/` (timeline.json, summary.md, logcat.txt, 2-3 context frames before / after the window). Build id: `build.gitSha` / `gitDirty` (repo HEAD at capture time),
`build.apkSha256` (from the device) and the package info. Device: model, SoC (`ro.soc.model` or `ro.board.platform`), Android release / SDK, resolution, density, refresh rate.

Objective checks (sanity only): capture completed, `perf_second` samples >= 30, benchmark override read (maxVisible 14), 14 visible robots, `perf_scene` reported, variant matches
(Founder owned or not), no `error` events, meminfo / gfxinfo snapshots present. `perf_vs_aut041_budget_info` is always `ok` and prints within / OVER.

Honest limits: this is a DEBUG build with diagnostics logging on, so absolute numbers are a DEBUG baseline, not a release verdict; `top` / `cpuinfo` perturb the run slightly;
`gfxinfo` may report few frames for a GL surface (reported as-is); GPU utilisation is read only from the Adreno `kgsl` counters and is otherwise stated `unavailable`; the draw call /
triangle counters depend on `director.root.device` exposing `numDrawCalls` / `numTris` (otherwise `unavailable`, renderer and node counts are reported instead).
This tooling could not be executed here (no device run, no Cocos compile): the `cc` code in `RobotPopulationController` (counters / scene traversal) is unverified until the first device run.

## Baseline results (2026-11-15, orchestrator device run)
Device: OnePlus NE2215 (SM8450, Adreno 730), Android 15, 1080x2412 @ 60 Hz. DEBUG FactoryWorld APK (diagnostics logging on, so absolute numbers are a DEBUG baseline, not a release verdict), commit 9927728. State: Era III, 5 producers Lv100 automated, 14 visible robots, Free Overclock active, decals + AI Core present. Window 45 s after 6 s warm-up.

| variant | fps avg | p50 ms | p95 ms | p99 ms | max ms | jank >33.3 ms | big jank >50 ms | draw calls | tris | PSS MB (before/after) | top CPU (1 core=100%) | GPU busy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| standard | 49.1 | 18.5 | 25.5 | 28.5 | 47.5 | 4 (0.2%) | 0 | 805 | 103,285 | 406 / 362 | 146% | 26.9% |
| founder | 47.9 | 19.5 | 25.5 | 28.5 | 35.1 | 2 (0.1%) | 0 | 839 | 103,693 | 368 / 376 | 135% | 27.8% |

Scene (standard, last sample): 2,333 nodes, 609 MeshRenderers, 50 SkinnedMeshRenderers, 0 particle systems, 1 light, 0 shadow casters, 38 UI renderers, 153 unique materials.
Against the AUT-041 budget (information only): p95 25.5 ms vs <= 25 ms slightly OVER; avg fps 47.9-49.1 vs >= 50 slightly BELOW; no big jank; the device is at 60 Hz so most frames land at 16.7-20 ms.
Observations for AUT-068: ~800+ draw calls from 609 mesh renderers with 153 unique materials is the dominant lever (material reuse / batching); no shadows or particles to optimise; Founder variant costs ~34 draw calls and ~1 fps. gfxinfo returned 0 frames (GL surface), so the in-app sampler is the frame-time source; GPU busy is low (27%), CPU process load ~135-146% of one core, so the CPU/draw-call side is the bottleneck.
Evidence: temp/perf/2026-11-15T074903 (standard), temp/perf/2026-11-15T075102 (founder), temp/reveal/aut067-baseline-*.

## Measured-bottleneck candidates for AUT-068 (priority order from CODEX_PLAN, to be confirmed or dropped by the baseline)
Fix only what the baseline supports; no speculative LOD / occlusion rewrite.
1. **Material reuse**: compare `perf_scene.uniqueMaterials` with the mesh / skinned renderer counts and the draw call counters; many near-identical materials (decals, identity, per-producer tints) break batching.
2. **Shadows / lights**: `perf_scene.lights` and `shadowCasters`; shadow-casting renderers multiply the GPU cost on a mobile GPU.
3. **Robot animation / shadows**: 14 skinned robots (+ Founder variant): `skinnedMeshRenderers`, CPU share in `top`, the delta against the AUT-041 1 / 8 / 14 / 20 robot curve (avg 17.3 -> 17.7 ms from 1 to 14 robots on the earlier device).
4. **Repeated static meshes** (MultiMesh / instancing only if justified): high `meshRenderers` with low `uniqueMaterials` and a high draw call count.
5. **Particles**: `particleSystems` count and the Overclock sparks on / off (compare the frame time before the boost expires, if the window outlives it).
6. Other profiler evidence (memory growth, GC / Java heap, jank seconds clustering around Overclock expiry).

## Human / orchestrator gates
Device run and the filled results are the orchestrator's. No visual, camera or feel judgement is part of this task.
