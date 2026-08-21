# Assets

**Art direction:** A crisp original top-down pixel-art fishing RPG screen at a shallow 3/4 angle. Use a deep navy background and dark ink-blue water, highlighted by neon lime grass, cyan water ripples and bobber glow, magenta accents, and yellow lanterns. Keep shapes bold and tile-friendly, with clear silhouettes, small square pixels, and no logos or text. UI should feel like an energetic arcade overlay but remain clean and accessible.

## Reference image

| Name | Purpose | Size | URL |
|---|---|---:|---|
| Neon fishing art direction | Palette, map density, camera, dock placement, and item silhouette reference | 16:9, full viewport | `/manus-storage/neon-fishing-art-direction_68f33e9e.png` |

## Runtime visual set

| Name | Description | Size | Planned URL / implementation |
|---|---|---:|---|
| Player angler | Four-direction player with idle, walk, cast, wait, reel, catch, and fail states | 32×40 px/frame | Generated sprite-sheet anchor, then Phaser atlas. |
| Harbor terrain | Grass, path, plank dock, water edge, and shallow-water tile patterns | 16×16 px tiles | Generated tile-sheet texture plus Phaser tile map. |
| Lake terrain | Dark lake water, reeds, rock edge, and moonlit sand tiles | 16×16 px tiles | Generated tile-sheet texture plus Phaser tile map. |
| Inlet terrain | Deep-water cliff, glow reeds, and boardwalk tiles | 16×16 px tiles | Generated tile-sheet texture plus Phaser tile map. |
| World props | Shop hut, chest, lantern, pine tree, rock, dock post, sign silhouette | 16–48 px | Generated prop-sheet texture. |
| Fish icons | Carp, Bluegill, Catfish, Golden Carp, Neon Koi, Moon Eel | 24×16 px | Generated item-sheet texture. |
| Gear icons | Basic rod, tide rod, bait, lunch, lucky charm, coin, XP star | 24×24 px | Generated HUD item-sheet texture. |
| Arcade HUD | Compact frame corners, inventory slot border, catch meter trim, dialog panel | 8–32 px pieces | Code composited from CSS/Phaser graphics with generated decorative motifs. |

## Asset handling

Source PNGs remain under `/home/ubuntu/webdev-static-assets/`. The game code references only generated storage URLs and never commits large image files to the web project tree.

