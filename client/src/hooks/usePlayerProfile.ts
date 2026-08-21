import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";

export type PlayerProfile = { id: string; username: string; role: "player" | "admin"; coins: number; level: number };

export function usePlayerProfile(userId: string | undefined) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(Boolean(userId));

  useEffect(() => {
    if (!userId || !supabase) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase.from("profiles").select("id,username,role,coins,level").eq("id", userId).maybeSingle().then(({ data }) => {
      setProfile(data as PlayerProfile | null);
      setLoading(false);
    });
  }, [userId]);

  return { profile, loading, isAdmin: profile?.role === "admin" };
}
