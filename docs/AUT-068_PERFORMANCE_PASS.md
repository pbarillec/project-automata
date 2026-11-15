# AUT-068 Profile-Guided Performance Pass

**Status: implemented, device results PENDING (orchestrator).** Only bottlenecks measured by the AUT-067 baseline were addressed; no gameplay, economy, save or visual change.

## Bottlenecks (from the AUT-067 baseline, OnePlus NE2215 / Adreno 730)
Era III worst case, 14 robots: avg 49.1 fps, p95 25.5 ms, 805 draw calls, 103k tris, 2,333 nodes, 609 MeshRenderers, 50 SkinnedMeshRenderers, 0 particles, 1 light, 0 shadow casters,
153 unique materials; CPU ~146% of one core, GPU busy ~27% => CPU / draw-call bound.

1. Material count (153 unique for ~660 renderers). Root cause found in code: `FactoryWorldBootstrap.createBox` created a NEW `Mesh` and a NEW unlit `Material` for every runtime box
   (era hall / teaser / zone shells, slabs, lamps, guides, plate bars, reboot socket parts, sparks ...). The imported glb prefabs are not the cause (one shared material per glb;
   Robot.glb has 3; instances share them); the Founder shell tint clones materials only for the Founder robot; AUT-066 identity and Founder accents already cache per colour.
2. Draw calls (805): identical boxes were separate draw calls because each had its own mesh and material, so no batching / instancing was possible.
3. Not supported by the data: shadows / lights (0 casters, 1 light), particles (0), hidden-robot animation (benchmark has all pooled robots visible).

## Changes
- `assets/scripts/presentation/BoxPrimitiveCache.ts` (pure, tested): `boxMaterialKey(colour)`, `boxMeshKey(size)`, `KeyedCache<T>` (creations and avoided creations counted).
- `FactoryWorldBootstrap.createBox`: one `Mesh` per size and one unlit material per colour, shared by every box whose colour is never mutated; shared materials define `USE_INSTANCING`
  (builtin-unlit includes `legacy/local-batch`), so boxes of the same size and colour are GPU-instanced into one draw call.
- Boxes whose colour is mutated at runtime opt out (`uniqueMaterial = true`, own non-instanced material, still a shared mesh): era palette boxes (`role`) and `teaser_seam`
  (EraEnvironmentVisualController), the three shell boxes recoloured by the era palette (`SiteBoundary`, `MainLogisticsSpine`, `FutureAccessBarrier`) and the construction / milestone
  sparks (MilestonePresentationController.recolorSpark). `tests/perf_material_reuse.test.ts` pins this and the exhaustive list of files that write `mainColor`, so a new writer cannot silently
  recolour a shared material.
- Hide-by-scale (AUT-038), node.active rules, colours and geometry are unchanged: pixel output is intended identical.

## Expected counter deltas (to verify on device)
- `perf_scene.uniqueMaterials`: 153 -> roughly the number of distinct colours (about 60-90) plus the unique opt-outs; the exact value is read from the run.
- Draw calls: lower by the number of repeated same-size same-colour boxes that become instanced (bars of plates, lamps, slabs, guides); expected tens, not hundreds.
  `MeshRenderer` / node counts unchanged by design.
- Frame time: small gain only if the draw-call count drops materially; no change for GPU time.

## Deliberately NOT done
- Static batching (`BatchingUtility.batchStaticModel`) of Kenney glb parts: parts are hidden / revealed by parent scale and animated (arms, belts, tiers); merging would break per-part scale hiding and tier reveals. Not measured as the lever.
- Instancing of Kenney glb materials (standard effect imported materials) or skinned robots: skinned meshes cannot be instanced; glb materials are imported assets and are not edited.
- Hidden-robot animation pause / off-camera skip: the benchmark has no hidden pooled robot, so no measured benefit; skipping updates risks pose / clip pops.
- Shadows / lights / particles: nothing to optimise (0 casters, 1 light, 0 particles).
- LOD / occlusion rewrite, MultiMesh: speculative, forbidden by the task.
- AUT-066 identity meshes: already one cached material per colour; the merged meshes are unique per producer so cannot be instanced.

## Risks
- `USE_INSTANCING` on builtin-unlit is unverified on the device (no Cocos compile / run here). If a rendering regression appears, set `USE_INSTANCING: false` in `createBox` (material and mesh sharing remain).
- Shared box material colours rely on the pinned mutation list above.

## Post-pass results
_To be filled by the orchestrator from `npm run device:reveal-capture -- --scenario aut067-baseline` and `aut067-baseline-founder` (same seed), plus the aut066-factory / aut049 / aut062 / aut043 visual captures._
