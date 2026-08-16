# Project Automata — ASSET_MANIFEST

**Status:** Asset Research complete — ready for Orchestrator handoff  
**Date:** 2026-08-15  
**Phase owner:** Art Director / Asset Researcher  
**Related source:** `ART_DIRECTION.md`

> This manifest contains only assets with a concrete Project Automata role. Packs are separated into `APPROVED`, `CANDIDATE`, `POST-MVP`, and custom requirements.

External asset data and license status were re-verified against official sources on **2026-08-15**.

---

## 1. License Policy

The project may only ship third-party assets whose commercial-use rights are clear.

For every imported third-party pack:

- keep the source URL;
- keep the original license file when provided;
- record author and pack name;
- record local modifications;
- do not assume that “free” means commercially usable;
- do not copy assets from competing games.

### Kenney license baseline

Official Kenney support states that game assets on Kenney asset pages are public-domain licensed under **CC0**, may be used in commercial projects, and do not require attribution.

Official source:

https://kenney.nl/support

### Quaternius license baseline

The specific Quaternius packs retained below explicitly identify their license as **CC0** and state that they are free for commercial use.

---

# 2. APPROVED — MVP

## ID: KENNEY_FACTORY_01

**Pack:** Factory Kit  
**Source:** Kenney  
**Official URL:** https://kenney.nl/assets/factory-kit  
**Author:** Kenney  
**Category:** 3D  
**Files:** 140  
**Features:** variations, animation  
**License:** Creative Commons CC0  
**Commercial use:** Yes  
**Modification:** Yes under CC0  
**Attribution:** Not required  
**Cost:** Free / donation optional on Kenney  
**Status:** **APPROVED — CORE**

### Verified official page data

The official Factory Kit page lists:

- Category: 3D;
- Features: variations and animation;
- Files: 140;
- License: Creative Commons CC0;
- tags covering conveyor belt, industrial, warehouse and factory.

### Planned usage

Primary visual source for:

- Fabricator;
- Assembly Station;
- Robot Line;
- Automated Cell base construction;
- Advanced Robotics industrial base;
- conveyors;
- robotic arms;
- storage;
- industrial machinery;
- pipes;
- barriers/supports;
- factory structural pieces;
- Workshop environment;
- Automated Factory environment;
- modular producer milestones.

### Expected selected asset categories

Do **not** assume every file ships.

Select only what is actually used, primarily:

- straight conveyors;
- corner conveyors;
- required junctions;
- robotic arms;
- machine bodies;
- industrial cabinets/modules;
- storage/buffers;
- pipes/supports;
- barriers;
- structural props;
- a small set of industrial decoration.

### Planned modifications

- Project Automata material palette;
- amber mechanical variants;
- cyan automation variants;
- combinations/kitbashes of CC0 meshes;
- Automata decals and machine numbering;
- selective simplification if needed.

### Production rule

This is the **default source** whenever an industrial asset is needed.

Do not search for another marketplace pack unless this pack demonstrably fails a concrete requirement.

---

## ID: QUAT_ROBOT_01

**Pack:** Animated Robot Pack  
**Source:** Quaternius  
**Official URL:** https://quaternius.com/packs/animatedrobot.html  
**Author:** Quaternius  
**Category:** Animated 3D robot  
**Models:** 1  
**Animated:** Yes  
**Textured:** Yes  
**Formats:** FBX, OBJ, Blend  
**License:** CC0  
**Commercial use:** Yes — explicitly stated on official pack page  
**Modification:** Yes under CC0  
**Attribution:** Not required by CC0  
**Cost:** Free  
**Status:** **APPROVED — PRIMARY ROBOT**

### Planned usage

Base robot for:

- First Worker Bot;
- Assembly worker loop;
- logistics robot loops;
- Robot Line finished output;
- Era II robot population;
- Robotics Complex population;
- Founder Robot variant.

### Planned modifications

- Automata material palette;
- sensor/indicator treatment;
- optional small head/sensor refinement if needed;
- Founder graphite/gold material variant;
- Founder crest/antenna as separate custom mesh;
- `UNIT 0001` decal.

### Required prototype gate

Before final art lock, validate on a real phone:

1. silhouette readability at normal camera distance;
2. visual compatibility with Kenney Factory Kit after material treatment;
3. animation quality in-engine;
4. Founder variant readability.

If the base robot fails these tests, reopen robot sourcing only. Do not replace the rest of the approved stack.

---

## ID: KENNEY_MODSPACE_01

**Pack:** Modular Space Kit  
**Source:** Kenney  
**Official URL:** https://kenney.nl/assets/modular-space-kit  
**Author:** Kenney  
**Category:** 3D • Modular  
**Files:** 40  
**Features:** animation, variations  
**License:** Creative Commons CC0  
**Commercial use:** Yes  
**Modification:** Yes under CC0  
**Attribution:** Not required  
**Cost:** Free / donation optional  
**Status:** **APPROVED — LIMITED ADVANCED USE**

### Planned usage

Only for high-technology visual escalation:

- Advanced Robotics Complex modules;
- high-level Automated Cell modules if required;
- advanced panels/structures;
- technological enclosures;
- AI Megafactory teaser.

### Era usage rule

Approximate art-direction constraint:

- Manual Workshop: **0%**;
- Automated Factory: **0–5%**;
- Robotics Complex: **10–20% maximum**;
- AI Megafactory teaser: may use a larger proportion.

The pack must not make the MVP factory read as a space station before the game reaches that fantasy.

### Planned modifications

- Automata material palette;
- removal/recolor of overtly “space-only” visual cues;
- combination with Kenney Factory Kit;
- selective use only.

---

## ID: KENNEY_UI_SCIFI_01

**Pack:** UI Pack - Sci-Fi  
**Source:** Kenney  
**Official URL:** https://kenney.nl/assets/ui-pack-sci-fi  
**Author:** Kenney  
**Category:** 2D • UI Pack  
**Files:** 130  
**License:** Creative Commons CC0  
**Commercial use:** Yes  
**Modification:** Yes under CC0  
**Attribution:** Not required  
**Cost:** Free / donation optional  
**Status:** **APPROVED — UI COMPONENT LIBRARY**

### Verified official page data

Official page lists:

- tags including buttons, panels, sliders, space, sci-fi, interface;
- Category: 2D • UI Pack;
- Files: 130;
- License: Creative Commons CC0.

### Planned usage

Use as raw component source for:

- buttons;
- panels;
- sliders/progress components;
- frames;
- modal foundations;
- separators.

### Art-direction restriction

Do **not** use the pack's complete visual identity unchanged.

Project Automata UI remains:

**Industrial Control Interface**

with:

- graphite semi-transparent surfaces;
- off-white typography;
- amber industrial accents;
- cyan automation/AI accents;
- reduced decoration;
- strong numeric readability.

### Import rule

Only import components actually used by Project Automata.

---

## ID: KENNEY_PARTICLE_01

**Pack:** Particle Pack  
**Source:** Kenney  
**Official URL:** https://kenney.nl/assets/particle-pack  
**Author:** Kenney  
**Category:** 2D • VFX  
**Tile size:** 512 × 512  
**Files:** 80  
**License:** Creative Commons CC0  
**Commercial use:** Yes  
**Modification:** Yes under CC0  
**Attribution:** Not required  
**Cost:** Free / donation optional  
**Status:** **APPROVED — VFX SOURCE LIBRARY**

### Planned usage

Potential source for a small selected subset:

- construction sparks;
- Overclock sparks;
- light smoke;
- milestone burst;
- Reboot particles;
- AI activation particles.

### Import rule

Expected actual usage is approximately **5–10 VFX textures**, not the complete pack.

Keep effects short and localized.

---

# 3. CANDIDATE — DO NOT IMPORT INITIALLY

## ID: QUAT_SCIFI_01

**Pack:** Sci-Fi Essentials Kit  
**Source:** Quaternius  
**Official URL:** https://quaternius.com/packs/scifiessentialskit.html  
**Author:** Quaternius  
**Category:** 3D sci-fi props/characters  
**Models:** 65 listed on official page  
**Animated:** Yes  
**Textured:** Yes  
**Formats:** FBX, OBJ, Blend, glTF  
**License:** CC0  
**Commercial use:** Yes — explicitly stated  
**Cost:** Free core content; additional source/expanded versions may be offered separately while remaining CC0 per official description  
**Status:** **CANDIDATE — GAP FILLER ONLY**

### Potential usage

Only if a concrete gap remains after approved assets:

- advanced screen;
- terminal;
- holographic prop;
- small advanced technology prop;
- exceptional secondary robot/enemy-derived prop if stylistically compatible.

### Restriction

Target MVP usage:

**0 assets preferred, 5 models maximum without a new Art Direction review.**

Reason: its visual language is more detailed/dark sci-fi and can create “asset-store soup” alongside Kenney.

---

## ID: KENNEY_CITYINDUSTRIAL_01

**Pack:** City Kit (Industrial)  
**Source:** Kenney  
**Official URL:** https://kenney.nl/assets/city-kit-industrial  
**Author:** Kenney  
**Category:** 3D industrial environment  
**License:** Creative Commons CC0  
**Commercial use:** Yes  
**Modification:** Yes  
**Attribution:** Not required  
**Cost:** Free / donation optional  
**Status:** **CANDIDATE — ENVIRONMENT RESERVE**

### Potential usage

Only if playtesting shows the site needs additional distant context:

- warehouse/background structure;
- industrial skyline;
- exterior factory shell;
- distant buildings.

### Restriction

Do not import during initial prototype unless the current factory background is visibly insufficient.

---

# 4. POST-MVP

## ID: KENNEY_SPACESTATION_01

**Pack:** Space Station Kit  
**Source:** Kenney  
**Official URL:** https://kenney.nl/assets/space-station-kit  
**Author:** Kenney  
**License:** Creative Commons CC0  
**Commercial use:** Yes  
**Status:** **POST-MVP**

### Potential future usage

- Orbital Industry;
- orbital production architecture;
- station environment expansion.

### MVP rule

Do not import. Modular Space Kit is enough for the AI-era teaser.

---

## ID: QUAT_MECH_01

**Pack:** Animated Mech Pack  
**Source:** Quaternius  
**Official URL:** https://quaternius.com/packs/animatedmech.html  
**Author:** Quaternius  
**Models:** 4  
**Animated:** Yes  
**Textured:** Yes  
**Formats:** FBX, OBJ, Blend, glTF  
**License:** CC0  
**Commercial use:** Yes  
**Cost:** Free  
**Status:** **POST-MVP**

### Potential future usage

- heavy construction unit;
- orbital worker;
- special industrial robot;
- high-tier cosmetic/special unit.

### MVP reason for exclusion

The models are visually heavier/more detailed than the approved standard robot and are unnecessary for the core robot-production fantasy.

---

# 5. REJECTED FOR MVP

## REJECTED: second modular sci-fi architecture family

Do not add another modular sci-fi environment pack while `KENNEY_MODSPACE_01` covers the actual requirement.

Reason:

- duplicated function;
- visual inconsistency risk;
- larger project library;
- more sourcing/license maintenance;
- no concrete MVP benefit.

## REJECTED: additional factory marketplace packs without a concrete gap

Do not continue accumulating factory packs from marketplaces simply for variety.

Current approved stack already covers the required production language through modular composition.

A new pack requires a documented missing capability.

## REJECTED: competitor assets

Never copy/rip/trace assets from competing games.

---

# 6. CUSTOM ASSETS

## ID: CUSTOM_AI_CORE_01

**Name:** AI Core  
**Priority:** **MUST CREATE**  
**Type:** original 3D model + derived 2D icon  
**Estimated complexity:** Low / Medium  
**Status:** Required for MVP identity

### Purpose

Permanent meta-resource visual used across:

- HUD;
- Reboot;
- permanent upgrade screen;
- 3D prestige sequence;
- marketing/store messaging if needed.

### Design requirements

- strong silhouette at small sizes;
- hexagonal external shell;
- floating central core/diamond;
- broken circuit or energy-ring motif;
- graphite mechanical structure;
- cyan/white energy;
- clearly distinct from Industrial Output.

### Recommended workflow

1. model simple 3D version;
2. establish material/emissive look;
3. derive the 2D resource icon from the same geometry/design;
4. simplify icon where necessary for 32–64 px readability.

### AI generation

AI may be used for concept exploration, but the production asset should be built cleanly and consistently in 3D/vector form.

---

## ID: CUSTOM_AUTOMATA_DECALS_01

**Name:** Automata Branding & Decals  
**Priority:** **MUST CREATE**  
**Type:** transparent textures / decal atlas  
**Estimated complexity:** Very Low  
**Status:** Required for MVP identity

### Required elements

- Project Automata factory symbol/logo decal;
- machine/facility numbering;
- industrial stripe/warning patterns;
- technical labels;
- `UNIT 0001`;
- optional producer-zone identifiers.

### Purpose

Cheaply convert reused CC0 industrial assets into a visually coherent Automata facility.

### Preferred format

- source vector where practical;
- packed transparent PNG atlas for runtime if technically appropriate.

---

## ID: CUSTOM_CORE_ICONS_01

**Name:** Core UI Icon Set  
**Priority:** **MUST CREATE**  
**Type:** vector-first UI iconography  
**Estimated complexity:** Low  
**Target count:** approximately 10–15 icons  
**Status:** Required for MVP UI coherence

### Priority icons

- Industrial Output;
- AI Core;
- Production;
- Producer/Factory;
- Robot;
- Automation;
- Milestone;
- Overclock;
- Breakthrough;
- Reboot;
- Production branch;
- Automation branch;
- Expansion branch.

### Style rules

- strong filled silhouettes;
- minimal internal linework;
- shared stroke/shape language;
- readable at small mobile sizes;
- color is secondary to shape.

### AI generation

Not recommended as final production method. A small coherent vector set is faster to control manually than cleaning inconsistent generated icons.

---

## ID: CUSTOM_FOUNDER_ROBOT_01

**Name:** Founder Robot / Unit 0001  
**Priority:** **SHOULD CREATE**  
**Base:** `QUAT_ROBOT_01`  
**Type:** material variant + tiny mesh accessory + decal  
**Estimated complexity:** Very Low  
**Status:** Conditional on mobile readability test

### Required changes

- graphite/black shell;
- warm metallic gold accent;
- distinct crest/antenna;
- `UNIT 0001` marking.

### Requirements

- must be readable at normal camera distance;
- no unique complex animation needed;
- no gameplay effect;
- keep at least one Founder unit visible when practical after population scaling.

### Rejection condition

If the difference cannot be perceived on mobile even after silhouette refinement, recommend replacing the cosmetic with a more visible factory cosmetic rather than shipping an invisible Founder Robot.

---

## ID: CUSTOM_ADV_ROBOTICS_CORE_01

**Name:** Advanced Robotics Central Module  
**Priority:** **SHOULD CREATE — CONDITIONAL**  
**Type:** kitbash / modified CC0 mesh / small original module  
**Estimated complexity:** Low / Medium  
**Status:** Create only if required after in-engine assembly test

### Purpose

Give Producer #5 a unique hero silhouette if `KENNEY_FACTORY_01 + KENNEY_MODSPACE_01` do not produce enough identity.

### Preferred workflow

1. attempt composition entirely from approved packs;
2. recolor/material pass;
3. Automata decals;
4. only then create or kitbash one central hero module.

Do not commission/model an entire bespoke complex.

---

## ID: CUSTOM_LOGO_01

**Name:** Project Automata Logo  
**Priority:** **SHOULD CREATE**  
**Type:** vector/typographic mark  
**Estimated complexity:** Low  
**Status:** Needed before store-facing production lock

### Direction

- industrial/technical;
- simple;
- legible;
- no overly decorative sci-fi typography.

### License requirement

Any font used must have its commercial-use license verified and recorded before release.

---

# 7. ASSETS NOT REQUIRED

The Technical Lead should not create or request the following for MVP unless scope changes are explicitly approved:

- one unique model for every producer level;
- 20 unique milestone machines;
- literal 1,000-robot scene population;
- multiple robot families;
- three separate era maps;
- bespoke background illustration for each era;
- heavy construction animation set;
- bespoke VFX per producer;
- 100+ custom UI icons;
- complete AI Megafactory environment;
- orbital/planetary/steller/megastructure asset libraries;
- premium-currency artwork;
- Battle Pass art;
- subscription art;
- large cosmetic shop catalogue.

---

# 8. RECOMMENDED LOCAL ASSET STRUCTURE

Do not copy complete downloaded packs blindly into production.

Recommended project organization:

```text
assets/
  factory/
    machines/
    conveyors/
    logistics/
    structures/

  robots/
    standard/
    founder/

  advanced/
    robotics/
    ai/

  ui/
    icons/
    panels/

  vfx/
    construction/
    overclock/
    reboot/

  branding/
    decals/
```

Actual engine directory conventions may be adapted by Technical Design.

---

# 9. LICENSE / SOURCE ARCHIVE

Even though the approved CC0 assets do not require attribution, keep internal source records.

Recommended repository structure:

```text
docs/licenses/
  kenney-factory-kit.txt
  kenney-modular-space-kit.txt
  kenney-ui-scifi.txt
  kenney-particle-pack.txt
  quaternius-animated-robot.txt

  ASSET_SOURCES.md
```

For every imported asset, `ASSET_SOURCES.md` should ideally track:

```text
Internal ID
Original pack
Original filename
Source URL
License
Local destination
Modifications
Used in scene/system
```

This simplifies future release review, replacement and audits.

---

# 10. FORMAT / ENGINE NOTES

### Kenney

Kenney 3D assets commonly provide engine-friendly 3D formats; select the format best supported by the final engine pipeline and test it rather than importing multiple duplicate formats.

For Godot, prefer a modern glTF/GLB workflow when the specific downloaded pack provides it and preserves materials/animations correctly. If not, Technical Lead should choose the cleanest provided source format and normalize the import pipeline.

### Quaternius Animated Robot

Official free pack formats are:

- FBX;
- OBJ;
- Blend.

Because animation support differs by format, the Technical Lead should test FBX and/or a controlled Blender→glTF export path for Godot if Godot remains the selected engine.

The art manifest does not lock the engine import format before that test.

---

# 11. IMPORT PRIORITY

Recommended implementation order:

### First prototype import

1. `KENNEY_FACTORY_01`
2. `QUAT_ROBOT_01`

Validate:

- camera;
- core factory composition;
- producer silhouette feasibility;
- robot readability;
- animation pipeline;
- mobile performance.

### Second import wave

3. `KENNEY_MODSPACE_01`

Validate Robotics Complex and AI teaser language.

### UI/VFX wave

4. `KENNEY_UI_SCIFI_01`
5. `KENNEY_PARTICLE_01`

Import selected elements only.

### Custom identity wave

6. `CUSTOM_AI_CORE_01`
7. `CUSTOM_AUTOMATA_DECALS_01`
8. `CUSTOM_CORE_ICONS_01`
9. `CUSTOM_FOUNDER_ROBOT_01` if readability passes
10. `CUSTOM_ADV_ROBOTICS_CORE_01` only if needed

---

# 12. MVP EXTERNAL-ASSET STACK SUMMARY

| ID | Pack | Source | License | Role | Status |
|---|---|---|---|---|---|
| `KENNEY_FACTORY_01` | Factory Kit | Kenney | CC0 | core factory | **APPROVED** |
| `QUAT_ROBOT_01` | Animated Robot Pack | Quaternius | CC0 | primary robot | **APPROVED** |
| `KENNEY_MODSPACE_01` | Modular Space Kit | Kenney | CC0 | advanced technology | **APPROVED** |
| `KENNEY_UI_SCIFI_01` | UI Pack - Sci-Fi | Kenney | CC0 | UI components | **APPROVED** |
| `KENNEY_PARTICLE_01` | Particle Pack | Kenney | CC0 | VFX source | **APPROVED** |
| `QUAT_SCIFI_01` | Sci-Fi Essentials Kit | Quaternius | CC0 | gap filler | **CANDIDATE** |
| `KENNEY_CITYINDUSTRIAL_01` | City Kit (Industrial) | Kenney | CC0 | environment reserve | **CANDIDATE** |
| `KENNEY_SPACESTATION_01` | Space Station Kit | Kenney | CC0 | orbital architecture | **POST-MVP** |
| `QUAT_MECH_01` | Animated Mech Pack | Quaternius | CC0 | heavy/special robots | **POST-MVP** |

---

# 13. CUSTOM-ASSET SUMMARY

| ID | Asset | Priority | Complexity |
|---|---|---|---|
| `CUSTOM_AI_CORE_01` | AI Core 3D + icon | **MUST CREATE** | Low/Medium |
| `CUSTOM_AUTOMATA_DECALS_01` | branding/decals | **MUST CREATE** | Very Low |
| `CUSTOM_CORE_ICONS_01` | ~10–15 UI icons | **MUST CREATE** | Low |
| `CUSTOM_FOUNDER_ROBOT_01` | Unit 0001 variant | **SHOULD CREATE** | Very Low |
| `CUSTOM_ADV_ROBOTICS_CORE_01` | Producer #5 hero module | **CONDITIONAL** | Low/Medium |
| `CUSTOM_LOGO_01` | Project Automata logo | **SHOULD CREATE** | Low |

---

# 14. FINAL ASSET STRATEGY

The MVP should be achievable with a very small external-source footprint:

### World 3D

1. Kenney Factory Kit
2. Quaternius Animated Robot
3. Kenney Modular Space Kit — limited use

### UI/VFX

4. Kenney UI Pack - Sci-Fi
5. Kenney Particle Pack

Everything else is either conditional, deferred, or a small original identity asset.

The default response to an art gap is therefore:

1. reuse existing approved module;
2. recolor/material variant;
3. combine/kitbash approved CC0 assets;
4. add Automata decals;
5. create one small custom identity asset only if the gap remains.

This keeps Project Automata aligned with the Mobile Game Factory strategy:

> **maximum visible progression and product identity for minimum bespoke art cost.**
