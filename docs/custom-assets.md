# Using Custom Assets

Grasswhistle ships with a full set of built-in tile graphics for every biome — so you can generate and package a region right out of the box. But if you've created your own tiles, or want to use a tileset pack you love, you can drop your files into your project folder and Grasswhistle will use them instead, automatically.

> *The default tiles are sampled from [Magiscarf](https://www.deviantart.com/magiscarf) and [AdelsBrother](https://www.deviantart.com/adelsbrother)'s sets on DeviantArt. All credit to the artists for their hard and amazing work.*

You don't have to replace everything — swap out only the biomes or categories you care about, and everything else keeps using the built-in defaults.

## How to set it up
> *Your PNG will need to follow a very specific format, though luckily, it's a common format for tilesets. Please take a look at the default assets inside the Grasswhisle `assets/` folder*

Inside your exported project folder, create an `assets/` folder containing a subfolder for each tile category you want to customise:

```
MyRegion/
└── assets/
    ├── ground/
    ├── grass/
    ├── road/
    ├── water/
    ├── cliff/
    ├── cliff_double/
    └── trees/
```

You only need to create the subfolders for the categories you're replacing. Then drop your PNG files in, named to match the biome you're targeting.


## File naming

The naming pattern is always `category_biome.png` — all lowercase. The easiest reference is to open the Grasswhistle `assets/` folder and look at the bundled files directly; your custom files need to match that naming exactly.

| Category | Folder | File name examples |
|---|---|---|
| Ground | `ground/` | `ground_lush.png`, `ground_highland.png` |
| Grass | `grass/` | `grass_lush.png`, `grass_tropical.png` |
| Road | `road/` | `road_lush.png`, `road_volcanic.png` |
| Water | `water/` | `water_lush.png`, `water_enchanted.png` |
| Cliff | `cliff/` | `cliff_lush.png`, `cliff_autumn.png` |
| Double Cliff | `cliff_double/` | `cliff_double_lush.png`, `cliff_double_highland.png` |
| Trees | `trees/` | `trees_lush.png`, `trees_enchanted.png` |

The biome suffix must be one of: `lush`, `highland`, `enchanted`, `autumn`, `tropical`, `volcanic`.

## Seeing what's loaded

Once your project is open in the **Map Generator**, the **Global Mapping** panel shows the status of every asset slot:

- **Default** — the built-in graphic is being used
- **Custom** — your file from the assets folder has been picked up

If you add or update files while the project is already open, click **Refresh** in the toolbar. Grasswhistle will re-scan the assets folder without you needing to close and reopen the project.

## A few tips

- **Missing files are fine.** You don't need a full set. Anything you don't provide just falls back to the built-in default for that slot.
- **Lush is the fallback biome.** If a biome has no asset at all — custom or default — Grasswhistle uses the Lush version instead. So the Lush tiles are the one set you really want to get right if you're going fully custom.
- **Keep originals safe.** Store your source files somewhere outside the project folder and copy them in when you're ready. That way they're safe if you ever move, rename, or share the project.
