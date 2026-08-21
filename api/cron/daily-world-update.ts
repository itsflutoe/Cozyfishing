import { createClient } from "@supabase/supabase-js";

type ServerlessRequest = { headers: Record<string, string | string[] | undefined> };
type ServerlessResponse = { status: (statusCode: number) => ServerlessResponse; json: (payload: unknown) => void };

/**
 * Secured Vercel Cron endpoint. The CRON_SECRET is sent by Vercel as
 * `Authorization: Bearer <secret>` and the service-role key stays server-only.
 */
export default async function handler(request: ServerlessRequest, response: ServerlessResponse) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.authorization;
  if (!secret || authorization !== `Bearer ${secret}`) {
    return response.status(401).json({ ok: false, error: "unauthorized" });
  }

  const url = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return response.status(500).json({ ok: false, error: "Supabase server configuration is missing" });
  }

  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("apply_daily_world_update");
  if (error) return response.status(500).json({ ok: false, error: error.message });
  return response.status(200).json({ ok: true, result: data });
}
