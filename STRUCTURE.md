# Project Structure: Neon Tides Fishing

## Technology boundary

The final repository targets **Vercel** as a React/Vite static frontend with serverless API routes for privileged actions and **Supabase** for Auth, Postgres, Row Level Security, Realtime Broadcast/Presence, and database RPC functions. GitHub is the source of truth. The current development host is used only to build, preview, test, and export the repository.

React owns menus, authentication, HUD overlays, dialogs, inventory, storage, shop, admin routes, and accessibility controls. Phaser owns the world canvas, tile maps, local and remote player rendering, collision, camera, fishing line/bobber effects, and mobile movement input. A small event bridge synchronizes game events with React without coupling game rules to components.

## Client modules

| Module | Responsibility |
|---|---|
| `client/src/game/GameController.ts` | Phaser lifecycle, world swaps, game-to-React event bridge, cleanup. |
| `client/src/game/scenes/FishingScene.ts` | Tile map composition, camera, interactions, local player, remote players, zone entry points. |
| `client/src/game/entities/LocalPlayer.ts` | Movement, facing, animation state, casting pose, interaction radius. |
| `client/src/game/entities/RemotePlayer.ts` | Interpolated state, username label, fishing animation and emote indicators. |
| `client/src/game/systems/FishingSystem.ts` | Cast/wait/bite/reel state machine, private minigame calculations, secure settlement API calls. |
| `client/src/game/systems/MultiplayerSystem.ts` | Zone channel subscription, presence, broadcast throttling, chat events, stale-player cleanup. |
| `client/src/game/data/zones.ts` | Developer-owned physical collision maps and entry/exit coordinates. |
| `client/src/lib/supabase.ts` | Browser Supabase client and typed environment validation. |
| `client/src/hooks/useGameStore.ts` | React state for player save, menus, notices, selected interaction, and game events. |
| `client/src/pages/GamePage.tsx` | Auth gate, Phaser canvas, HUD, dialogs, desktop/mobile controls. |
| `client/src/pages/AdminPage.tsx` | Role-gated management dashboard and configuration forms. |

## Supabase model

| Domain | Core tables / security rule |
|---|---|
| Identity | `profiles` mirrors `auth.users`; all players can read public display name only and update their own preferences. |
| Player save | `player_state`, `inventory_stacks`, `storage_stacks`, `equipped_rods`, `zone_unlocks`; RLS limits all direct reads to `auth.uid() = player_id`. |
| Data-driven content | `fish_species`, `zones`, `zone_fish_pools`, `item_definitions`, `shops`, `shop_offers`, `game_settings`, `seasonal_events`; public reads expose active records only. |
| Ledger | `game_transactions`, `catch_history`, `trade_sessions`, `trade_offers`, `admin_activity_log`; no direct client writes. |
| Admin | Every management mutation runs in an admin-only RPC after an `is_admin()` security-definer role check. |

## Trusted transaction model

All mutable rewards and currency changes are handled by database functions: `begin_fishing_attempt`, `settle_fishing_attempt`, `purchase_shop_item`, `sell_inventory_fish`, `consume_inventory_item`, `transfer_inventory_to_storage`, `confirm_trade`, and `apply_daily_world_update`. Each receives a caller-owned idempotency key and writes a ledger record in the same transaction. Frontend code never writes coin totals, XP, fish quantities, rod durability, or storage directly.

## Realtime protocol

Each zone uses `neon-tides:zone:<zoneId>`. Presence payloads contain only `playerId`, `username`, `x`, `y`, `direction`, `state`, and `updatedAt`. Broadcast payloads use three discriminated event kinds: `movement`, `state`, and `chat`. The game publishes movement only while position materially changes, capped at 10 updates per second. It publishes state immediately at cast, bite, reel, catch, fail, zone leave, and zone join. The client interpolates remote targets over 100–140 ms. Private minigame position and fish identity are never broadcast.

## Scheduled world updates

The free Vercel deployment exposes a secured `GET /api/cron/daily-world-update` endpoint defined in `vercel.json`. It runs at most once per day. The endpoint calls the idempotent `apply_daily_world_update` database function, which uses the current configurable event rows to rotate rare fish, reset per-zone population state, open/close eligible seasonal events, and record a timestamped run. Admin users configure event dates and settings through the dashboard; they do not change source code or the cron expression.
