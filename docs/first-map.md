# Making Your First Map

Here's the complete journey from a blank slate to a playable region inside your RPG Maker XP game. Four steps, and each one is straightforward.

## Step 1 — Design your region

Open the **Layout Generator** from the home screen and set up your region using the sidebar controls:

- **Seed** — A number that determines how your region is generated. Think of it like a recipe — the same seed always produces the same landmass.
- **Width & Height** — How many panels wide and tall the region is. Each panel becomes one map in your game, so a 3×3 region gives you 9 maps.
- **Settlements** — How many settlement clusters to include. Each settlement can span several panels.
- **Bonus Areas** — Hidden, forest-enclosed pockets that make great secret areas or optional dungeons. Toggle off for a more traditional Pokémon-style map with no surprises.
- **Cliff Style** — Choose **Single** for one-tile-tall cliffs, or **Double** for dramatic two-tile-tall cliff faces.

Hit **Generate Map** to see your region. Change the seed and hit it again until you're happy — nothing is saved until you export.

### How the settings interact

It helps to know what actually changes what:

- **Seed + Width + Height** together determine the landmass — the terrain shape, elevation, and natural features.
- **Settlements** reshuffles where settlements, routes, and bonus areas are placed on that landmass.
- **Bonus Areas** doesn't change the map at all — it just decides whether those extra enclosed panels are included or hidden.
- **Cliff Style** only affects how cliffs look, not where they appear.

### Painting biomes

Once you're happy with the shape, switch on **Biome Edit** in the sidebar and click any zone to assign it a biome. Each zone can have its own look — lush grassland, volcanic rock, tropical jungle, and more. Zones that share a biome will use the same tile graphics when packaged.

## Step 2 — Export the region

When the layout looks good, click **Export Region** in the sidebar. Choose a folder and give your region a name — Grasswhistle creates a project folder with everything saved inside:

```
MyRegion/
├── project.json      ← region settings and layout
├── mapping.json      ← your tile assignments
├── world.png         ← the preview image
└── panels/           ← per-panel map data
```

This folder is your project. Keep it somewhere safe.

## Step 3 — Load it in the Map Generator

Open the **Map Generator** from the home screen, click **Load Region**, and select your exported project folder.

Grasswhistle loads all your panel data and any tile assignments you've saved before. It also picks up any custom tile graphics you've placed in the project's `assets/` folder — see **Using Custom Assets** for how that works.

> *The default tiles are sampled from [Magiscarf](https://www.deviantart.com/magiscarf) and [AdelsBrother](https://www.deviantart.com/adelsbrother)'s sets on DeviantArt. All credit to the artists for their hard and amazing work.*

## Step 4 — Assign tiles and package

In the **Global Mapping** panel, you'll see a row for each biome used in your region. Each row shows the status of every tile category — Ground, Grass, Road, Water, Cliff, Trees:

- **Default** — using Grasswhistle's built-in tile graphics
- **Custom** — using your own graphics from the project's assets folder

When everything looks right, click **Package for RMXP**. A confirmation window lets you:

1. Review or edit the **Region name** — this becomes the top-level folder in your RMXP map tree
2. Pick your **game folder** (the root of your RPG Maker XP project)
3. Choose **Additive** (adds to an existing game) or **Overwrite** (replaces a previous export)
4. Choose **Master Tileset** (one shared atlas) or **Per-Biome Tilesets** (one atlas per biome combination)

Hit **Package** and Grasswhistle writes everything straight into your game's `Data/` and `Graphics/Tilesets/` folders. Open RPG Maker XP and your maps are already there, ready to go.
