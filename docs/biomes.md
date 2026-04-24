# Biomes

A biome is the visual personality of a zone. It controls what the ground looks like, what the trees look like, what the roads and cliffs and water look like — everything. Assign different biomes to different parts of your region and they'll each have their own distinct feel when packaged into your game.

The six biomes are suggestions, not rules. Because you can swap in your own tile graphics for any biome, you're free to make them whatever you want. Tropical with bright red trees and lava flows? Enchanted as a sterile sci-fi zone? Sure, why not. The biomes are just named slots to help you stay organised — what they actually look like in your game is entirely up to you.

## The six biomes

Grasswhistle has six biomes to choose from:

| Biome | Vibe |
|---|---|
| **Lush** | The classic. Soft green grassland, earthy dirt roads, full leafy trees. Warm and welcoming — a great default for starting towns and central routes. |
| **Highland** | Rugged and exposed. Cooler tones, rocky ground, sparse trees, stone paths. Good for mountain passes and northern wilderness. |
| **Enchanted** | Mysterious and magical. Deep purples, glowing greens, dense canopy. Perfect for fairy-tale forests, ancient ruins, or anything that should feel otherworldly. |
| **Autumn** | Warm and nostalgic. Orange and red foliage, amber light, fallen leaves on the ground. Great for late-year routes or regions with a melancholy, winding feel. |
| **Tropical** | Bright and alive. Sandy paths, vivid foliage, humid warmth. Ideal for island areas, beach routes, or jungle zones. |
| **Volcanic** | Dark and dramatic. Ash-grey ground, black rock cliffs, sparse scorched trees. Best used sparingly — a late-game area, a villain's territory, or a striking contrast zone. |

## Assigning biomes

1. In the **Layout Generator**, switch on **Biome Edit** using the toggle in the topbar.
2. Zones on the map highlight as you hover over them — they're all clickable.
3. Click any zone to open the biome picker and select a biome.
4. The preview updates immediately, so you can see how the colours sit together before committing.

Zones that share the same biome will use the same tile graphics when packaged. You can reassign as many times as you like — nothing is locked in until you export.

## Mixing biomes

You're not limited to one biome per region, and mixing is where things get interesting.

A classic pattern might be a central **Lush** area for your starter town, **Highland** to the north as terrain gets tougher, a hidden **Enchanted** forest off a side route, and a **Volcanic** zone in the far corner for a late-game area. Because each zone is assigned independently, the combinations are entirely up to you.

The colour palette shown in the map preview gives you a rough read on how zones will look next to each other — use it to check that the transitions feel natural before you export.

## How biomes affect your tiles

When Grasswhistle packages your region, it looks up the tile graphic for each category — ground, grass, road, water, cliff, trees — based on the biome of that zone. If a custom asset exists for that biome, it uses it. If not, it falls back to the built-in default. If there's no asset at all for that biome, it falls back to **Lush**.

This is why **Lush is special**: it's the safety net. As long as Lush assets are present, nothing will ever be missing — all other biomes are optional on top of that foundation.

If you're building a fully custom tileset, get Lush right first. Everything else builds from there.
