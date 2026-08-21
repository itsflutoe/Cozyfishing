import type { CatchResult, ZoneId } from "../types";

export type WorldRect = { x: number; y: number; width: number; height: number };
export type WorldInteraction = {
  id: string;
  label: string;
  kind: "shop" | "storage" | "portal";
  x: number;
  y: number;
  target?: ZoneId;
};

export type ZoneDefinition = {
  id: ZoneId;
  name: string;
  subtitle: string;
  objective: string;
  requiredLevel: number;
  spawn: { x: number; y: number };
  water: WorldRect[];
  interactions: WorldInteraction[];
  fishPool: CatchResult[];
  palette: { ground: number; path: number; water: number; glow: number; accent: number };
};

/**
 * Developer-owned map geometry. In production, zone content and fishPool are supplied
 * from Supabase; these values make the local, credential-free preview playable.
 */
export const ZONES: Record<ZoneId, ZoneDefinition> = {
  "harbor-hub": {
    id: "harbor-hub",
    name: "Harbor Hub",
    subtitle: "A sleepy dockside morning",
    objective: "Pick up supplies at the little tackle hut, then stroll to Glasswater Lake.",
    requiredLevel: 1,
    spawn: { x: 246, y: 356 },
    water: [{ x: 0, y: 54, width: 960, height: 135 }, { x: 688, y: 189, width: 272, height: 351 }],
    interactions: [
      { id: "tackle-shop", label: "Tackle Hut", kind: "shop", x: 438, y: 232 },
      { id: "harbor-chest", label: "Tide Chest", kind: "storage", x: 334, y: 450 },
      { id: "lake-pier", label: "Lake Path", kind: "portal", x: 773, y: 290, target: "glasswater-lake" },
    ],
    fishPool: [
      { id: "carp", name: "Carp", rarity: "common", value: 14, xp: 8 },
      { id: "bluegill", name: "Bluegill", rarity: "uncommon", value: 25, xp: 14 },
    ],
    palette: { ground: 0x7e9a67, path: 0xb5845c, water: 0x4d91a8, glow: 0xd9e7c0, accent: 0xb9684d },
  },
  "glasswater-lake": {
    id: "glasswater-lake",
    name: "Glasswater Lake",
    subtitle: "Level 1 fishing spot",
    objective: "Fish the reeds, sell your catch at the harbor, and unlock Moonlit Inlet at level 3.",
    requiredLevel: 1,
    spawn: { x: 138, y: 403 },
    water: [
      { x: 288, y: 86, width: 434, height: 342 },
      { x: 614, y: 356, width: 346, height: 184 },
    ],
    interactions: [
      { id: "return-harbor", label: "Harbor Trail", kind: "portal", x: 112, y: 324, target: "harbor-hub" },
      { id: "moonlit-trail", label: "Moonlit Inlet · Lv 3", kind: "portal", x: 852, y: 472, target: "moonlit-inlet" },
    ],
    fishPool: [
      { id: "carp", name: "Carp", rarity: "common", value: 14, xp: 8 },
      { id: "bluegill", name: "Bluegill", rarity: "uncommon", value: 25, xp: 14 },
      { id: "catfish", name: "Catfish", rarity: "rare", value: 55, xp: 30 },
      { id: "golden-carp", name: "Golden Carp", rarity: "legendary", value: 180, xp: 90 },
    ],
    palette: { ground: 0x90a968, path: 0xbc8d60, water: 0x5b9fb5, glow: 0xdcebc5, accent: 0xc67350 },
  },
  "moonlit-inlet": {
    id: "moonlit-inlet",
    name: "Moonlit Inlet",
    subtitle: "Level 3 fishing spot",
    objective: "A deeper pool with stronger catches. Return through Glasswater when ready.",
    requiredLevel: 3,
    spawn: { x: 156, y: 445 },
    water: [{ x: 218, y: 62, width: 640, height: 412 }],
    interactions: [{ id: "return-lake", label: "GLASSWATER TRAIL", kind: "portal", x: 116, y: 330, target: "glasswater-lake" }],
    fishPool: [
      { id: "catfish", name: "Catfish", rarity: "rare", value: 55, xp: 30 },
      { id: "golden-carp", name: "Golden Carp", rarity: "legendary", value: 180, xp: 90 },
      { id: "neon-koi", name: "Neon Koi", rarity: "rare", value: 82, xp: 46 },
      { id: "moon-eel", name: "Moon Eel", rarity: "legendary", value: 220, xp: 115 },
    ],
    palette: { ground: 0x495b66, path: 0x8f766b, water: 0x355f7a, glow: 0xd2d9d1, accent: 0xb87b67 },
  },
};

export function getZone(zoneId: ZoneId) {
  return ZONES[zoneId];
}
