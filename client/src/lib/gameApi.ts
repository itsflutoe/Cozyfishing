import type { CatchResult, ZoneId } from "@/game/types";
import { supabase } from "@/lib/supabase";

function client() {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

export async function beginFishingAttempt(zoneId: ZoneId): Promise<{ attemptId: string; requestId: string }> {
  const requestId = crypto.randomUUID();
  const { data, error } = await client().rpc("begin_fishing_attempt", { p_zone_id: zoneId, p_request_id: requestId });
  if (error) throw error;
  return { attemptId: data as string, requestId };
}

export async function settleFishingAttempt(attemptId: string): Promise<CatchResult> {
  const { data, error } = await client().rpc("settle_fishing_attempt", {
    p_attempt_id: attemptId,
    p_request_id: crypto.randomUUID(),
    p_client_score: 100,
  });
  if (error) throw error;
  return data as CatchResult;
}

export type PlayerSave = {
  coins: number;
  xp: number;
  level: number;
  stamina: number;
  maxStamina: number;
  currentZoneId: ZoneId;
};

export async function loadPlayerSave(): Promise<PlayerSave | null> {
  const { data, error } = await client().from("profiles").select("coins,xp,level,stamina,max_stamina,current_zone_id").maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { coins: data.coins, xp: data.xp, level: data.level, stamina: data.stamina, maxStamina: data.max_stamina, currentZoneId: data.current_zone_id as ZoneId };
}
