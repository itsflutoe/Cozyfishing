# Game Plan: Neon Tides Fishing

## Risk Tasks

### 1. Phaser canvas lifecycle and responsive rendering
- **Why isolated:** The Phaser game must mount once inside React, resize safely, and never duplicate input handlers after React development remounts.
- **Approach:** Use one `PhaserGame` component that owns an explicit `GameController` lifecycle and exposes React callbacks through a typed event bridge. Scale the canvas with Phaser FIT mode and retain a fixed pixel-art base resolution.
- **Verify:** Opening, leaving, and returning to the game route does not create duplicate canvases; desktop and narrow mobile views retain a readable HUD and responsive camera.

### 2. Animated top-down player states
- **Why isolated:** Directional movement, idle, casting, waiting, reeling, catch, and failure states can visibly desynchronize when remote players receive intermittent updates.
- **Approach:** Use a compact sprite-state model with explicit directional state and interpolation targets for remote players. Broadcast semantic state changes separately from throttled position snapshots.
- **Verify:** Local idle-to-walk-to-idle, walk-to-cast-to-wait-to-reel, and catch/fail-to-idle transitions display without sprite snapping. Remote players interpolate rather than jump between movement snapshots.

### 3. Realtime location rooms
- **Why isolated:** Presence, movement, fishing state, and chat must arrive live without leaking updates between zones or trusting client-owned inventory/currency.
- **Approach:** Use one Supabase Broadcast and Presence channel per zone. Send compact, validated public messages at 8–12 Hz while moving and event messages for state changes; retain private minigame data locally. Persist only trusted outcomes through RPC.
- **Verify:** Two signed-in browsers in the same zone show one another's username, walk direction, fishing state, and chat immediately. Moving to another zone removes the old presence and begins receiving only the destination-zone feed.

### 4. Fishing minigame and trusted reward settlement
- **Why isolated:** The minigame must feel responsive locally while a client must not be able to arbitrarily award fish, XP, or coins.
- **Approach:** Create a server-issued fishing attempt token tied to location, equipped rod, bait status, stamina, and cooldown. Run the catch-zone UI locally, then submit limited result telemetry to a Supabase RPC that validates attempt status and grants the weighted catch result transactionally.
- **Verify:** A valid cast consumes the intended resources, a successful reel adds a server-selected fish, and repeated settlement calls cannot duplicate inventory or rewards.

## Main Build

The prototype contains **Harbor Hub** as the spawn and shop map, **Glasswater Lake** as the introductory fishing zone, and **Moonlit Inlet** as a level-gated second zone. The player begins with a basic rod, bait, food, a small carried bag, and a persistent chest. The core loop is fish, catch, store or sell, buy better supplies, gain XP, unlock zones, and interact with other players.

- **Assets needed:** An original pixel-art visual reference, player character sprite, grass and path tile patterns, water and bobber tiles, dock/shop/chest props, fish icons, rod/bait/food icons, and a compact neon arcade HUD frame.
- **Verify:** Keyboard/touch movement controls are clear; nearby water supports casting; the private catch meter works; fish, currency, stamina, durability, and XP update correctly; inventory, chest, shop, and zone travel work; each map has visible geometry and a distinct fish pool; all controls maintain readable contrast against the navy and neon theme; no browser console errors occur during the playable loop; the final view matches the art-direction reference in camera angle, pixel density, and palette.
