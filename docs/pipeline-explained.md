# Pipeline Explained

When you click **Generate Map**, Grasswhistle doesn't place things randomly — it runs through a series of ordered steps, each one building on the last.

Here's what's actually happening at each stage, including the techniques behind it for those who want to dig deeper.

## Step 1 — Laying the grid and generating terrain

Everything starts with a grid. Grasswhistle divides the region into a uniform grid of panels — think of it like graph paper where every cell is the same size. Your Width and Height settings determine how many columns and rows there are.

At the same time, Grasswhistle generates the underlying terrain by sampling [**Simplex Noise**](https://en.wikipedia.org/wiki/Simplex_noise) across the grid. Simplex Noise produces smooth, natural-looking variation — the kind you'd see in rolling hills or coastlines — by layering waves of randomness at different scales. Each panel is assigned an elevation value from this noise field, which determines whether it sits high or low, and later informs where cliffs and water appear.

Your Seed is plugged directly into the noise function, which is why the same seed always produces the same landmass. Change the seed, and the entire noise field shifts — new hills, new low points, new terrain shape from scratch.

This grid and its elevation values are the foundation for everything that follows. Nothing is generated at a finer granularity than a panel at this stage — the tile-level detail comes later when you package.

## Step 2 — Placing settlements

Settlements are placed first because they're the anchors of the region. Everything else — routes, forests, bonus areas — gets shaped around where the settlements end up.

To spread settlements naturally without them clustering or lining up too neatly, Grasswhistle uses [**Poisson Disk Sampling**](https://en.wikipedia.org/wiki/Supersampling#Poisson_disk) — a technique that places points randomly while enforcing a minimum distance between each one. The result feels organic rather than grid-aligned or purely random.

Each settlement is seeded by your Seed value, so the same seed always produces the same positions. Each one claims a cluster of adjacent panels — a small settlement might be a single panel, a larger one might span a 2×2 or 2×3 area. The tiles inside are cleared and levelled, ready for you to build on.

## Step 3 — Carving routes

With settlements placed, Grasswhistle connects them with routes — the paths players will travel between areas.

Route paths are found using [**A\* pathfinding**](https://en.wikipedia.org/wiki/A*_search_algorithm), an algorithm that finds the most efficient path between two points while being able to account for obstacles and terrain costs. Grasswhistle uses a weighted version that nudges routes away from settlement interiors and prefers open space, so paths wind naturally rather than cutting straight through everything.

Once the path is traced, routes are widened and decorated: patches of tall grass, scattered trees, gentle elevation changes, and occasional forks or bends break up long stretches and make each route feel lived-in.

The number of settlements directly affects how many routes are generated. More settlements mean a denser, more interconnected map. Fewer means wider open spaces between stops.

## Step 4 — Filling bonus areas

After routes are carved, some panels are left unclaimed — not part of any settlement or route. These would normally be empty filler. If you've enabled **Bonus Areas**, Grasswhistle turns them into something useful instead.

Bonus area panels are enclosed on all sides by forest or water, making them naturally hidden from the main route. They're designed to feel like places a player might stumble onto — a hidden clearing, an old ruin, a cave entrance. Because the enclosure is generated automatically, each one is self-contained by default. You carve your own entrance when building the map in RPG Maker XP, which means you decide exactly how secret or accessible each one is.

Toggling Bonus Areas off doesn't change the rest of the map — the underlying layout stays the same. It just excludes those panels from the export entirely.

## Step 5 — Growing the forests

Forests fill in everything that isn't a settlement, route, or bonus area — but they don't fill uniformly. Grasswhistle uses a flood fill approach seeded from natural edges — the borders of routes, the perimeter of settlements, the walls of cliffs — and grows outward from there. The result feels like forest that grew around the civilised parts of the map rather than being stamped on top.

Settlements also get a **halo** — a ring of forest that wraps just outside the settlement boundary, giving each town a sense of being nestled in the landscape rather than dropped in an open field.

The density and shape of forest patches are influenced by the seed, so the same seed always produces the same forest coverage.

## Step 6 — Adding cliffs

Cliffs are placed along elevation boundaries — edges where the ground level drops. Grasswhistle detects these edges and places cliff tiles that follow the natural contours of the terrain.

To make cliff edges feel smooth and natural rather than jagged or blocky, the boundary detection uses a simplified form of [**marching squares**](https://en.wikipedia.org/wiki/Marching_squares) — a technique that traces the outline of a region by examining each 2×2 block of cells and choosing the right edge shape based on which cells are elevated.

Your **Cliff Style** setting determines the height:

- **Single** — one tile tall. Compact and approachable, good for moderate terrain variation.
- **Double** — two tiles tall. More dramatic and imposing — great for mountainous regions or anywhere you want a strong sense of vertical scale.

Cliff style doesn't affect where cliffs appear, only how they look. Switching between Single and Double on the same seed gives you the same terrain shape with a different visual feel.

## Step 7 — Assigning biomes

The final step applies biomes to each zone. Biomes control which tile graphics are used for that zone's ground, grass, roads, water, cliffs, and trees — this is what gives different parts of your region their distinct visual identity.

If you've painted biomes manually using **Biome Edit**, those assignments are locked in and respected here. Any zones you left unpainted default to whatever they were generated as originally.

Biome assignment doesn't affect the layout at all — it's purely a visual layer applied on top of the generated structure. This is why you can repaint biomes and re-export without regenerating the map.

---

Seven steps, a fraction of a second, endlessly repeatable. The seed ties it all together — same seed, same map, every time.
