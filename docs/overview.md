# Overview

Welcome to **Grasswhistle** — a map-making tool designed to help you build entire regions for RPG Maker XP, quickly and with a lot of creative control.

The idea is simple: you sketch out a region procedurally (roads, settlements, forests, cliffs), assign visual styles to different zones, then package everything directly into your game. No manual tile-placing, no copy-pasting map files.

Grasswhistle is not a replacement for the craft of making your maps feel alive — think of it as the skeleton. It lays out the overall shape, wires everything into RPG Maker XP, and gives you a canvas. Making those maps fun and lovely is still your job, and the fun part.

## Procedural generation

Rather than designing your region tile by tile, Grasswhistle generates the layout for you based on a handful of settings — how many settlements, what size, what cliff style. The result is different every time you hit generate, and you can keep rolling until something clicks. Once you find a layout you like, you lock it in and move on to making it look the way you want.

If you're curious about the concept, [procedural generation](https://en.wikipedia.org/wiki/Procedural_generation) is a broad topic used in games from Minecraft to Spelunky — Grasswhistle applies it specifically to region layouts for RPG Maker.


## The two tools

Grasswhistle is split into two screens that you use in order:

| Tool | What you do here |
|---|---|
| **Layout Generator** | Design your region — size, settlements, routes, biomes. Generate as many times as you like until it feels right. |
| **Map Generator** | Load the exported region, assign tile graphics to each biome, then package it into your RMXP game folder. |

They're kept separate on purpose. You can tweak your layout and re-export without losing your tile assignments, and you can swap in new art without touching the layout at all.

## What a region looks like

A region is a grid of **panels**. Each panel becomes its own map in RPG Maker XP. Panels are automatically grouped and named — settlements, routes, bonus areas — and nested under a Region folder in the RMXP map tree:

```
My Region
├── Settlement 1
│   ├── Settlement 1 A
│   └── Settlement 1 B
├── Route 1
│   └── Route 1 A
├── Bonus Area 1
│   └── Bonus Area 1 A
└── Halo
    └── Halo A
```

Each zone in your region can have its own **biome** — a visual style that controls what the ground, grass, roads, cliffs, and trees look like. You can have a lush green area next to a volcanic one, and each will use its own tile set automatically. See the **Biomes** section for the full list. Grasswhistle currently support 6 pre-named biomes. You can use them all, or just the one.

When you open your game in RPG Maker XP, all of these maps are already there, fully tiled and ready to connect.

### Panel types

Grasswhistle generates three types of panels:

1. **Settlement** — Cleared, flat zones ready for your cities and towns. The surrounding area is bordered by a thin ring of forest or water to give each settlement a natural edge.
2. **Route** — Your classic Pokémon-style routes, with pre-placed grass patches, tree lines, hills, and roads already laid out for you.
3. **Bonus Area** — Panels that don't fit neatly as a route or settlement would normally sit unused as a buffer. Rather than waste them, Grasswhistle can turn them into hidden points of interest — secret areas, detours, or mini-dungeons. They're fully enclosed by forest or water, so you get to decide where the entrance goes.

