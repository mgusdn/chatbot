# Third-party 3D asset licenses

The assets in this directory were selected from official Kenney, Quaternius,
ambientCG, and CGTrader downloads between 2026-07-20 and 2026-07-22. Only the
files listed in `asset-manifest.json` are included.

The Kenney, Quaternius, and ambientCG assets listed below are released under
the Creative Commons CC0 1.0 Universal license. The CGTrader Cute Bunny has a
separate royalty-free license documented in its own section.

- License: https://creativecommons.org/publicdomain/zero/1.0/
- Kenney license FAQ: https://kenney.nl/support

## Kenney Furniture Kit

- Official pack page: https://kenney.nl/assets/furniture-kit
- Included here: 24 GLB models
- Local directory: `kenney-furniture-kit/`
- Changes: none; original filenames are preserved

## Kenney Nature Kit

- Official pack page: https://kenney.nl/assets/nature-kit
- Included here: 6 GLB models
- Local directory: `kenney-nature-kit/`
- Changes: none; original filenames are preserved

## Kenney Food Kit

- Official pack page: https://kenney.nl/assets/food-kit
- Included here: 5 GLB models and their shared `Textures/colormap.png`
- Local directory: `kenney-food-kit/`
- Changes: none; original filenames and the texture-relative path are preserved

The Food Kit GLBs reference `Textures/colormap.png` by relative URI. Keep that
file beside the models when moving or repackaging them.

## Kenney Mini Characters

- Official pack page: https://kenney.nl/assets/mini-characters
- Included here: `character-male-f.glb`, `character-female-e.glb`, and
  `character-female-b.glb`
- Local directory: `characters/kenney-mini-characters/`
- Preview images: the matching original 64 px PNGs under
  `../images/characters/`
- Shared texture: `Textures/colormap.png` (referenced by each included GLB)
- Changes: none; original filenames are preserved

## Kenney Cube Pets

- Official pack page: https://kenney.nl/assets/cube-pets
- Included playable residents: bunny, cat, fox, deer, koala, penguin, and
  monkey GLBs
- Retained legacy model: `animal-panda.glb` (not used by the counselor NPC)
- Local directory: `characters/kenney-cube-pets/`
- Preview images: the seven playable residents' matching original 64 px PNGs
  under `../images/characters/`
- Shared texture: `Textures/colormap.png` (referenced by each included GLB)
- Changes: none; original filenames are preserved

## Quaternius Ultimate Animated Character Pack

- Official pack page:
  https://quaternius.com/packs/ultimatedanimatedcharacter.html
- Included here: `Casual_Female.gltf` and `Pug.gltf`
- Local directory: `characters/quaternius-ultimate-animated-character/`
- Format note: both files are the official self-contained glTF files with
  embedded binary data
- Changes: none; original filenames and animation names are preserved
- License: CC0 1.0 (as stated on the official pack page)

## Quaternius Modular Sushi Restaurant Kit

- Official pack page:
  https://quaternius.com/packs/sushirestaurantkit.html
- Model page: https://poly.pizza/m/q1uJ28Hs8T
- Retained legacy/unused model: `Panda.glb`
- Local directory: `characters/quaternius-modular-sushi/`
- Technical note: the GLB contains the original rig, texture, and 30 animation
  clips, including `Idle`, `Walk`, `Run`, `Wave`, and `Yes`
- Current use: none; the counselor has been restored to the project-internal
  procedural Pbao implementation in `components/game/PbaoModel.tsx`
- Changes: none to the retained binary asset
- License: CC0 1.0 (as stated on the official pack and model pages)

## Project-internal Procedural Pbao

- Current counselor NPC: `components/game/PbaoModel.tsx`
- Creator: Prometheus Studio
- Source: recovered from the original project build source map and preserved at
  `docs/recovery/PbaoModel.screenshot-v1.tsx.bak`
- Format: code-native React Three Fiber sphere geometry; no third-party model
  file or texture
- License: Project-internal

## Minimoku Cute Bunny

- Listing: https://www.cgtrader.com/free-3d-models/animal/mammal/cute-bunny-772af610-f9f8-47c2-a8b8-7adcca89dc48
- Creator: Minimoku
- Included playable model: `characters/cgtrader-cute-bunny/cute-bunny.glb`
- License: CGTrader Royalty Free License (no AI)
- Terms: https://www.cgtrader.com/pages/terms-and-conditions
- Technical note: the self-contained GLB contains two static bunny variants
  and two embedded 2048 px JPEG textures; it has no rig or animation clips
- Runtime changes: one named bunny variant is shown per resident, centered at
  runtime, and its scarf material is tinted from the resident palette

## ambientCG interior surfaces

The following CC0 materials were downloaded from ambientCG and resized to
512 px JPEG maps for this web project. Only color, OpenGL normal, and roughness
maps are included under `../textures/interior/`; displacement and source
files are intentionally omitted.

- Wood Floor 051: https://ambientcg.com/view?id=WoodFloor051
- Plaster 001: https://ambientcg.com/view?id=Plaster001
- ambientCG license: https://docs.ambientcg.com/license/
- Local changes: resized to 512 px and recompressed as JPEG quality 72
