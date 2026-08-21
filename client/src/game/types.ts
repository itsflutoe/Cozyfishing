export type Direction = "up" | "down" | "left" | "right";
export type FishingPhase = "idle" | "casting" | "waiting" | "bite" | "reeling";

export type ZoneId = "harbor-hub" | "glasswater-lake" | "moonlit-inlet";

export type CatchResult = {
  id: string;
  name: string;
  rarity: "common" | "uncommon" | "rare" | "legendary";
  value: number;
  xp: number;
};

export type PublicPlayerState = {
  playerId: string;
  username: string;
  x: number;
  y: number;
  direction: Direction;
  state: FishingPhase;
  updatedAt: number;
};

export type GameCommand =
  | { type: "cast" }
  | { type: "interact" }
  | { type: "travel"; zoneId: ZoneId }
  | { type: "set-display-name"; name: string }
  | { type: "remote-player"; player: PublicPlayerState }
  | { type: "remove-remote-player"; playerId: string };

export type GameBridgeEvent =
  | { type: "zone"; zoneId: ZoneId; zoneName: string; objective: string }
  | { type: "fishing"; phase: FishingPhase; hint: string }
  | { type: "notice"; title: string; body: string; tone?: "good" | "warn" | "info" }
  | { type: "interaction"; panel: "shop" | "storage" | "travel"; zoneId?: ZoneId }
  | { type: "catch"; fish: CatchResult }
  | { type: "spend"; stamina: number; durability: number }
  | { type: "position"; x: number; y: number; direction: Direction; moving: boolean }
  | { type: "near-water"; value: boolean };
