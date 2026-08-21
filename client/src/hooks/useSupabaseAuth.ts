import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Session, User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

export function useSupabaseAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data, error: authError }) => {
      if (authError) setError(authError.message);
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    if (!supabase) return;
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) setError(authError.message);
  }

  async function signUp(email: string, password: string, username: string) {
    if (!supabase) return;
    setError(null);
    const { error: authError } = await supabase.auth.signUp({ email, password, options: { data: { username } } });
    if (authError) setError(authError.message);
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  return { configured: isSupabaseConfigured, session, user: session?.user ?? null, loading, error, clearError: () => setError(null), signIn, signUp, signOut };
}

export function suggestedUsername(user: User | null) {
  const metadataName = typeof user?.user_metadata?.username === "string" ? user.user_metadata.username : "";
  return (metadataName || user?.email?.split("@")[0] || "Guest Angler").slice(0, 18);
}
