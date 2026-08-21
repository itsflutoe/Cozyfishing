import { usePlayerProfile } from "@/hooks/usePlayerProfile";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Fish, Map, Settings2, Sparkles, CalendarClock, Save, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type FishRow = { id: string; active: boolean; catch_weight: number; item_definitions: { name: string; sell_price: number } | null };
type ZoneRow = { id: string; name: string; active: boolean; required_level: number };
type GameSetting = { key: string; value: Record<string, unknown>; description: string };
type EventRow = { id: string; name: string; status: "scheduled" | "active" | "ended" | "cancelled"; starts_at: string; ends_at: string; zones: string[]; modifiers: Record<string, unknown> };

export default function AdminPage() {
  const auth = useSupabaseAuth();
  const { profile, loading, isAdmin } = usePlayerProfile(auth.user?.id);
  const [fish, setFish] = useState<FishRow[]>([]);
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [settings, setSettings] = useState<GameSetting[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [status, setStatus] = useState("Loading game operations…");
  const [newEventName, setNewEventName] = useState("Weekend Rare Tide");

  const load = useCallback(async () => {
    if (!supabase || !isAdmin) return;
    const [fishResult, zoneResult, settingResult, eventResult] = await Promise.all([
      supabase.from("fish_species").select("id,active,catch_weight,item_definitions(name,sell_price)").order("id"),
      supabase.from("zones").select("id,name,active,required_level").order("required_level"),
      supabase.from("game_settings").select("key,value,description").order("key"),
      supabase.from("seasonal_events").select("id,name,status,starts_at,ends_at,zones,modifiers").order("starts_at", { ascending: false }).limit(8),
    ]);
    setFish((fishResult.data ?? []) as unknown as FishRow[]);
    setZones((zoneResult.data ?? []) as ZoneRow[]);
    setSettings((settingResult.data ?? []) as GameSetting[]);
    setEvents((eventResult.data ?? []) as EventRow[]);
    setStatus("Configuration loaded from Supabase.");
  }, [isAdmin]);

  useEffect(() => { void load(); }, [load]);

  async function toggleFish(row: FishRow) {
    if (!supabase) return;
    const { error } = await supabase.rpc("admin_set_fish_active", { p_fish_id: row.id, p_active: !row.active, p_weight: row.catch_weight, p_sell_price: row.item_definitions?.sell_price ?? 0 });
    setStatus(error ? error.message : `${row.item_definitions?.name ?? row.id} updated.`);
    if (!error) void load();
  }

  async function toggleZone(row: ZoneRow) {
    if (!supabase) return;
    const { error } = await supabase.rpc("admin_set_zone_active", { p_zone_id: row.id, p_active: !row.active, p_required_level: row.required_level });
    setStatus(error ? error.message : `${row.name} updated.`);
    if (!error) void load();
  }

  async function saveSetting(setting: GameSetting) {
    if (!supabase) return;
    const { error } = await supabase.rpc("admin_set_game_setting", { p_key: setting.key, p_value: setting.value, p_description: setting.description });
    setStatus(error ? error.message : `${setting.key} saved.`);
  }

  async function createEvent() {
    if (!supabase) return;
    const start = new Date(Date.now() + 5 * 60 * 1000);
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const { error } = await supabase.rpc("admin_upsert_event", { p_id: null, p_name: newEventName, p_starts_at: start.toISOString(), p_ends_at: end.toISOString(), p_zones: zones.filter(zone => zone.active).map(zone => zone.id), p_modifiers: { rare_fish_bonus: 0.08 }, p_status: "scheduled" });
    setStatus(error ? error.message : "Seasonal event scheduled for the next daily world update.");
    if (!error) void load();
  }

  if (auth.loading || loading) return <main className="auth-shell">LOADING ADMIN OPERATIONS…</main>;
  if (!auth.session) return <main className="auth-shell"><section className="auth-card"><h1>Admin sign-in required</h1><p>Return to the game and sign in with a profile granted the admin role.</p><a href="/">RETURN TO GAME</a></section></main>;
  if (!isAdmin) return <main className="auth-shell"><section className="auth-card"><ShieldCheck color="#f449d6" /><h1>Admin access only</h1><p>Your profile is currently <strong>{profile?.role ?? "unknown"}</strong>. Promote the intended account in the Supabase SQL Editor, then refresh this page.</p><code>update public.profiles set role = 'admin' where id = '{auth.user?.id ?? "YOUR-USER-UUID"}';</code><a href="/">RETURN TO GAME</a></section></main>;

  return <main className="admin-shell"><header className="admin-topbar"><a href="/"><ArrowLeft size={16} /> GAME</a><div><Sparkles size={17} /> NEON TIDES <small>LIVE OPERATIONS</small></div><span><ShieldCheck size={15} /> {profile?.username}</span></header><section className="admin-hero"><div><p className="eyebrow">CONTROL DECK</p><h1>Fishing world configuration</h1><p>Changes are validated server-side, written to the audit log, and applied to the game’s data-driven systems.</p></div><div className="admin-status"><span className="live-dot" />{status}</div></section><section className="admin-grid"><article className="admin-panel wide"><header><Fish size={18} /><div><h2>Fish catalog</h2><p>Enable species and manage live catch weights and sell values.</p></div></header><div className="admin-table"><div className="admin-table-head"><span>SPECIES</span><span>WEIGHT</span><span>VALUE</span><span>LIVE</span></div>{fish.map(row => <div className="admin-table-row" key={row.id}><span><b>{row.item_definitions?.name ?? row.id}</b><small>{row.id}</small></span><span>{row.catch_weight}</span><span>{row.item_definitions?.sell_price ?? 0} C</span><Switch checked={row.active} onCheckedChange={() => void toggleFish(row)} /></div>)}</div></article><article className="admin-panel"><header><Map size={18} /><div><h2>Zones</h2><p>Toggle map availability.</p></div></header>{zones.map(row => <div className="admin-zone" key={row.id}><div><b>{row.name}</b><small>Level {row.required_level} required</small></div><Switch checked={row.active} onCheckedChange={() => void toggleZone(row)} /></div>)}</article><article className="admin-panel"><header><Settings2 size={18} /><div><h2>Fishing settings</h2><p>Described game-wide values.</p></div></header>{settings.map(setting => <div className="admin-setting" key={setting.key}><b>{setting.key.replace(/_/g, " ")}</b><p>{setting.description}</p><textarea value={JSON.stringify(setting.value, null, 2)} onChange={event => setSettings(current => current.map(value => value.key === setting.key ? { ...value, value: safeJson(event.target.value, value.value) } : value))} /><Button size="sm" onClick={() => void saveSetting(setting)}><Save size={13} /> SAVE</Button></div>)}</article><article className="admin-panel"><header><CalendarClock size={18} /><div><h2>Seasonal events</h2><p>Daily cron reconciles due events.</p></div></header><div className="event-create"><Input value={newEventName} onChange={event => setNewEventName(event.target.value)} /><Button onClick={() => void createEvent()}>SCHEDULE 24H EVENT</Button></div>{events.length ? events.map(event => <div className="admin-event" key={event.id}><div><b>{event.name}</b><small>{event.status} · {new Date(event.starts_at).toLocaleString()}</small></div><span>{event.zones.join(", ") || "All zones"}</span></div>) : <p className="empty-state">No seasonal events scheduled.</p>}</article></section></main>;
}

function safeJson(value: string, fallback: Record<string, unknown>) { try { return JSON.parse(value) as Record<string, unknown>; } catch { return fallback; } }
