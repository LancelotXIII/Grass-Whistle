# Packaging for RPG Maker XP

This is the final step — taking everything you've designed and dropping it directly into your game. When you click **Package for RMXP** in the Map Generator, Grasswhistle writes all the map files, tilesets, and data your game needs in one go. You don't copy anything manually.

## Before you package

Make sure you have:

- A generated and exported region loaded in the Map Generator
- Your tile assignments looking good in the Global Mapping panel — or leave them as-is if you're happy with the defaults
- Your RPG Maker XP game folder somewhere on your machine

You don't need to have the game open, and you don't need to do anything in RPG Maker XP beforehand.

## Preview first

Before exporting, Grasswhistle lets you render a preview of your region so you can see how it'll actually look with your chosen tiles. It's always worth running this first — it's a great way to catch any tile mismatches or get a feel for whether the biome combination is working.

If you love what you see, there's also a **Download PNG** option that renders your region at full resolution, great for sharing or reference.

## What gets written

Grasswhistle writes directly into your game folder:

| File | Location | What it does |
|---|---|---|
| `Map*.rxdata` | `Data/` | One map file per panel, plus blank folder maps for each group |
| `MapInfos.rxdata` | `Data/` | Updates the map tree so your region appears in RPG Maker XP |
| `Tilesets.rxdata` | `Data/` | Registers the tileset with passage, terrain tag, and priority data |
| `tileset.png` | `Graphics/Tilesets/` | The tile atlas used by your maps |
| `tileset_bm_*.png` | `Graphics/Tilesets/` | Per-biome atlases (Per-Biome mode only) |
| `map_metadata.txt` | `PBS/` | Pokémon Essentials map metadata starter entries |
| `map_connections.txt` | `PBS/` | Pokémon Essentials map connections starter entries |

Everything goes exactly where RPG Maker XP expects it — nothing to move or rename afterwards.

## The map tree

Your region appears in the RPG Maker XP map tree as a named folder, with all your groups and panel maps nested underneath:

```
Map 001 (your game's setup map)
└── My Region
    ├── Settlement 1
    │   ├── Settlement 1 A
    │   └── Settlement 1 B
    ├── Route 1
    │   └── Route 1 A
    └── Bonus Area 1
        └── Bonus Area 1 A
```

Panel maps are lettered A, B, C… left to right, top to bottom within each group. Open RPG Maker XP after packaging and they'll all be there, already tiled.

## Choosing an export mode

> **Back up your game folder before packaging.** There's no undo — once files are written, the previous version is gone.

### Additive *(recommended)*

Adds your region to whatever already exists in the game. Grasswhistle finds the highest existing map ID and continues from there — nothing in your game gets touched.

Safe to run multiple times. Great for adding a new region to a game in progress, or for iterating — package, check it in RMXP, adjust something, package again.

### Overwrite

Replaces a previous export in place, starting from a fixed map ID. Use this when you're rebuilding a region from scratch and want to cleanly replace the old version rather than accumulate duplicates.

## Choosing a tileset mode

### Master Tileset *(recommended for most)*

All biomes are packed into a single shared tileset atlas. Every panel uses the same tileset slot in RPG Maker XP. Simple to manage, works well for most regions.

### Per-Biome Tilesets

Produces one tileset atlas per unique biome combination across your panels. Each group of panels gets its own optimised tileset slot — smaller individual atlases and more precise passage and terrain tag data per area, at the cost of using more tileset slots in RMXP.

Worth considering for large, biome-diverse regions where you want tight control over how each area behaves.

## Pokémon Essentials users

If your game uses **Pokémon Essentials**, Grasswhistle automatically generates starter entries for `map_metadata.txt` and `map_connections.txt` in your `PBS/` folder. Map IDs and names are already filled in — you just need to add the details like music, weather, and connections when you're ready.

If you're not using Pokémon Essentials, these files are safe to ignore.
