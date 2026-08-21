import PhaserGame, { type PhaserGameHandle } from "@/components/game/PhaserGame";
import type { CatchResult, Direction, FishingPhase, GameBridgeEvent, PublicPlayerState, ZoneId } from "@/game/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { beginFishingAttempt, loadPlayerSave, settleFishingAttempt } from "@/lib/gameApi";
import { mayUseLocalCatch } from "@/game/security";
import { resolveCatchLedger } from "@/game/catchResolver";
import { suggestedUsername, useSupabaseAuth } from "@/hooks/useSupabaseAuth";
import { useZoneRealtime } from "@/hooks/useZoneRealtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Fish, Backpack, Archive, Store, Send, Heart, Zap, Map, X, Sparkles, LogOut, Loader2 } from "lucide-react";

type FishStack = CatchResult & { uid: string };
type Panel = "inventory" | "storage" | "shop" | "profile" | null;
type Notice = { title: string; body: string; tone: "good" | "warn" | "info" } | null;

const starterItems = [
  { id: "basic-rod", name: "Basic Rod", qty: 1, category: "Rod" },
  { id: "bait", name: "Fish Bait", qty: 10, category: "Bait" },
  { id: "lunch", name: "Lunch", qty: 5, category: "Food" },
];

export default function GamePage() {
  const auth = useSupabaseAuth();
  const gameRef = useRef<PhaserGameHandle>(null);
  const [zone, setZone] = useState<{ id: ZoneId; name: string; objective: string }>({ id: "harbor-hub", name: "Harbor Hub", objective: "Visit the neon tackle shop, then follow the cyan pier to Glasswater Lake." });
  const [phase, setPhase] = useState<FishingPhase>("idle");
  const [hint, setHint] = useState("Move near water and press Space to cast.");
  const [coins, setCoins] = useState(80);
  const [xp, setXp] = useState(0);
  const [stamina, setStamina] = useState(100);
  const [durability, setDurability] = useState(100);
  const [inventory, setInventory] = useState(starterItems);
  const [fish, setFish] = useState<FishStack[]>([]);
  const [storage, setStorage] = useState<FishStack[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<Notice>({ title: "WELCOME, ANGLER", body: "Your starter rod, bait, lunch, and twelve-slot tidechest are ready.", tone: "good" });
  const [chat, setChat] = useState<{ author: string; text: string }[]>([{ author: "System", text: "Zone channel is ready. Invite a friend to test live presence." }]);
  const [chatText, setChatText] = useState("");
  const [displayName, setDisplayName] = useState("Guest Angler");
  const playerPositionRef = useRef<{ x: number; y: number; direction: Direction }>({ x: 246, y: 356, direction: "down" });
  const activeAttemptRef = useRef<string | null>(null);

  const handleRemotePlayer = useCallback((player: PublicPlayerState) => gameRef.current?.send({ type: "remote-player", player }), []);
  const handleRemoteLeave = useCallback((playerId: string) => gameRef.current?.send({ type: "remove-remote-player", playerId }), []);
  const handleRemoteChat = useCallback((message: { author: string; text: string }) => setChat(current => [...current.slice(-5), message]), []);
  const realtime = useZoneRealtime({
    enabled: Boolean(auth.session),
    playerId: auth.user?.id ?? "local-preview",
    username: displayName,
    zoneId: zone.id,
    onRemotePlayer: handleRemotePlayer,
    onRemoveRemotePlayer: handleRemoteLeave,
    onChat: handleRemoteChat,
  });

  useEffect(() => {
    if (!auth.user) return;
    const username = suggestedUsername(auth.user);
    setDisplayName(username);
    gameRef.current?.send({ type: "set-display-name", name: username });
  }, [auth.user]);

  const refreshSave = useCallback(async () => {
    if (!auth.session) return;
    try {
      const save = await loadPlayerSave();
      if (!save) return;
      setCoins(save.coins);
      setXp(save.xp);
      setStamina(save.stamina);
    } catch (error) {
      console.warn("Unable to refresh player save", error);
    }
  }, [auth.session]);

  useEffect(() => { void refreshSave(); }, [refreshSave]);

  const level = 1 + Math.floor(xp / 100);
  const fishValue = useMemo(() => fish.reduce((total, item) => total + item.value, 0), [fish]);

  const onGameEvent = useCallback((event: GameBridgeEvent) => {
    if (event.type === "zone") {
      setZone({ id: event.zoneId, name: event.zoneName, objective: event.objective });
      return;
    }
    if (event.type === "fishing") {
      setPhase(event.phase);
      setHint(event.hint);
      realtime.publishState({ ...playerPositionRef.current, state: event.phase });
      return;
    }
    if (event.type === "notice") {
      setNotice({ title: event.title, body: event.body, tone: event.tone ?? "info" });
      return;
    }
    if (event.type === "interaction") {
      if (event.panel === "shop") setPanel("shop");
      if (event.panel === "storage") setPanel("storage");
      if (event.panel === "travel" && event.zoneId) gameRef.current?.send({ type: "travel", zoneId: event.zoneId });
      return;
    }
    if (event.type === "spend") {
      setStamina(current => Math.max(0, current - event.stamina));
      setDurability(current => Math.max(0, current - event.durability));
      if (auth.session) {
        void beginFishingAttempt(zone.id).then(({ attemptId }) => {
          activeAttemptRef.current = attemptId;
        }).catch((error: unknown) => {
          activeAttemptRef.current = null;
          setNotice({ title: "CAST CANCELLED", body: error instanceof Error ? error.message : "Your secure fishing attempt could not start.", tone: "warn" });
          void refreshSave();
        });
      }
      return;
    }
    if (event.type === "catch") {
      const applyCatch = (fishResult: CatchResult) => {
        setFish(current => resolveCatchLedger({ fish: current, xp: 0 }, { authenticated: false, serverAttemptId: null, settledCatch: null, localPreviewCatch: fishResult }, result => ({ ...result, uid: `${result.id}-${Date.now()}-${current.length}` })).fish);
        setXp(current => current + fishResult.xp);
      };
      const attemptId = activeAttemptRef.current;
      if (auth.session) {
        if (!mayUseLocalCatch(true, attemptId)) {
          setNotice({ title: "CATCH NOT SAVED", body: "The server did not authorize this cast, so no fish or XP was granted.", tone: "warn" });
          void refreshSave();
          return;
        }
        activeAttemptRef.current = null;
        void settleFishingAttempt(attemptId!).then(fishResult => {
          const resolved = resolveCatchLedger({ fish: [] as FishStack[], xp: 0 }, { authenticated: true, serverAttemptId: attemptId, settledCatch: fishResult, localPreviewCatch: null }, result => ({ ...result, uid: `${result.id}-${Date.now()}` }));
          if (resolved.fish[0]) applyCatch(resolved.fish[0]);
          void refreshSave();
        }).catch((error: unknown) => setNotice({ title: "CATCH NOT SAVED", body: error instanceof Error ? error.message : "The catch could not be settled safely.", tone: "warn" }));
      } else if (mayUseLocalCatch(false, null)) {
        applyCatch(event.fish);
      }
      return;
    }
    if (event.type === "position") {
      playerPositionRef.current = { x: event.x, y: event.y, direction: event.direction };
      realtime.publishPosition({ ...event, state: phase });
    }
  }, [auth.session, phase, realtime, refreshSave, zone.id]);

  function send(command: "cast" | "interact") {
    gameRef.current?.send({ type: command });
  }

  function buy(id: "bait" | "lunch" | "tide-rod", cost: number, name: string, qty = 1) {
    if (coins < cost) {
      setNotice({ title: "NOT ENOUGH COINS", body: `You need ${cost - coins} more coins for ${name}.`, tone: "warn" });
      return;
    }
    setCoins(current => current - cost);
    setInventory(current => {
      const found = current.find(item => item.id === id);
      return found ? current.map(item => item.id === id ? { ...item, qty: item.qty + qty } : item) : [...current, { id, name, qty, category: id === "tide-rod" ? "Rod" : id === "bait" ? "Bait" : "Food" }];
    });
    setNotice({ title: "SUPPLIES PACKED", body: `${name} added to your inventory.`, tone: "good" });
  }

  function sellAll() {
    if (fish.length === 0) return;
    setCoins(current => current + fishValue);
    setNotice({ title: "CATCH SOLD", body: `You earned ${fishValue} coins at the Harbor counter.`, tone: "good" });
    setFish([]);
  }

  function storeAllFish() {
    if (fish.length === 0) return;
    if (storage.length + fish.length > 12) {
      setNotice({ title: "CHEST FULL", body: "Your tidechest holds twelve catches. Sell or retrieve an item first.", tone: "warn" });
      return;
    }
    setStorage(current => [...current, ...fish]);
    setFish([]);
    setNotice({ title: "CATCH STORED", body: "Your fish are safely stored across sessions once Supabase is connected.", tone: "good" });
  }

  function consumeLunch() {
    const lunch = inventory.find(item => item.id === "lunch");
    if (!lunch || lunch.qty < 1) return;
    setInventory(current => current.map(item => item.id === "lunch" ? { ...item, qty: item.qty - 1 } : item));
    setStamina(current => Math.min(100, current + 30));
    setNotice({ title: "LUNCH BREAK", body: "Stamina restored by 30.", tone: "good" });
  }

  function submitChat(event: React.FormEvent) {
    event.preventDefault();
    const message = chatText.trim().slice(0, 120);
    if (!message) return;
    setChat(current => [...current.slice(-5), { author: displayName, text: message }]);
    realtime.sendChat(message);
    setChatText("");
  }

  if (auth.loading) return <main className="auth-shell"><Loader2 className="animate-spin" /><span>CONNECTING TO THE TIDE…</span></main>;
  if (auth.configured && !auth.session) return <AuthScreen error={auth.error} onSignIn={auth.signIn} onSignUp={auth.signUp} />;

  return (
    <main className="game-shell">
      <section className="game-topbar">
        <div className="brand-lockup"><Sparkles size={18} /><span>NEON TIDES</span><small>FISHING CLUB</small></div>
        <div className="top-status"><Badge className="neon-badge"><Map size={13} /> {zone.name}</Badge><Badge className="neon-badge cyan">LV {level}</Badge><Badge className="neon-badge yellow">{coins} C</Badge></div>
        <div className="connection-state"><span className="live-dot" />{isSupabaseConfigured && auth.session ? `LIVE · ${realtime.onlineCount} ANGLER${realtime.onlineCount === 1 ? "" : "S"}` : "LOCAL PREVIEW"}</div>
      </section>

      <section className="game-layout">
        <aside className="hud-column left-hud">
          <HudCard label="STAMINA" value={`${stamina}/100`} progress={stamina} color="lime" icon={<Zap size={16} />} />
          <HudCard label="ROD DURABILITY" value={`${durability}/100`} progress={durability} color="cyan" icon={<Heart size={16} />} />
          <div className="objective-card">
            <p className="eyebrow">CURRENT TIDE</p><h2>{zone.name}</h2><p>{zone.objective}</p>
          </div>
          <div className="controls-card"><p className="eyebrow">CONTROLS</p><p><kbd>WASD</kbd> move</p><p><kbd>SPACE</kbd> cast</p><p><kbd>F</kbd> interact</p></div>
        </aside>

        <section className="game-stage">
          <PhaserGame ref={gameRef} onGameEvent={onGameEvent} />
          <div className="game-stage-vignette" />
          <div className="game-actionbar">
            <div><span className={`phase-dot ${phase}`} /> <strong>{phase === "idle" ? "READY TO FISH" : phase.toUpperCase()}</strong><small>{hint}</small></div>
            <div className="action-buttons"><Button onClick={() => send("cast")} className="lime-action"><Fish size={16} /> CAST</Button><Button onClick={() => send("interact")} className="cyan-action">INTERACT</Button></div>
          </div>
        </section>

        <aside className="hud-column right-hud">
          <button className="menu-tile" onClick={() => setPanel("inventory")}><Backpack size={21} /><span>INVENTORY</span><b>{fish.length + inventory.reduce((total, item) => total + item.qty, 0)}</b></button>
          <button className="menu-tile" onClick={() => setPanel("storage")}><Archive size={21} /><span>TIDECHEST</span><b>{storage.length}/12</b></button>
          <button className="menu-tile" onClick={() => setPanel("shop")}><Store size={21} /><span>SHOP</span><b>F</b></button>
          <div className="chat-card"><div className="chat-heading"><span>ZONE CHAT</span><Badge className="tiny-badge">{auth.session ? "LIVE" : "LOCAL"}</Badge></div><div className="chat-list">{chat.map((message, index) => <p key={`${message.author}-${index}`}><b>{message.author}:</b> {message.text}</p>)}</div><form onSubmit={submitChat}><Input value={chatText} onChange={event => setChatText(event.target.value)} placeholder="Say something…" maxLength={120} /><Button size="icon" type="submit"><Send size={15} /></Button></form></div>
        </aside>
      </section>

      <section className="mobile-actions"><Button onClick={() => send("cast")} className="lime-action"><Fish size={16} /> CAST</Button><Button onClick={() => send("interact")} className="cyan-action">INTERACT</Button><Button variant="outline" onClick={() => setPanel("inventory")}>BAG</Button><Button variant="outline" onClick={() => setPanel("shop")}>SHOP</Button></section>

      <Dialog open={Boolean(panel)} onOpenChange={open => !open && setPanel(null)}>
        <DialogContent className="game-dialog">
          <DialogHeader><DialogTitle>{panel === "inventory" ? "FIELD INVENTORY" : panel === "storage" ? "TIDECHEST STORAGE" : panel === "shop" ? "NEON TACKLE SHOP" : "PLAYER PROFILE"}</DialogTitle></DialogHeader>
          {panel === "inventory" && <div className="dialog-body"><section><h3>GEAR & SUPPLIES</h3>{inventory.map(item => <div className="item-row" key={item.id}><span className="pixel-icon">{item.category === "Rod" ? "⌁" : item.category === "Food" ? "✦" : "•"}</span><div><b>{item.name}</b><small>{item.category}</small></div><strong>×{item.qty}</strong>{item.id === "lunch" && <Button size="sm" variant="outline" onClick={consumeLunch}>USE</Button>}</div>)}</section><section><div className="section-heading"><h3>FRESH CATCH</h3><Button size="sm" onClick={sellAll} disabled={!fish.length}>SELL ALL · {fishValue} C</Button></div>{fish.length ? fish.map(item => <div className="item-row" key={item.uid}><span className={`rarity-dot ${item.rarity}`} /><div><b>{item.name}</b><small>{item.rarity} · {item.value} coins</small></div><strong>+{item.xp} XP</strong></div>) : <EmptyState text="No fish yet. Cast from a shoreline." />}</section></div>}
          {panel === "storage" && <div className="dialog-body"><div className="section-heading"><p>Your chest keeps up to twelve fish separate from your carried bag.</p><Button size="sm" onClick={storeAllFish} disabled={!fish.length}>STORE CATCH</Button></div><div className="storage-grid">{Array.from({ length: 12 }, (_, index) => storage[index]).map((item, index) => <div className="storage-slot" key={item?.uid ?? index}>{item ? <><span className={`rarity-dot ${item.rarity}`} /><small>{item.name}</small></> : <span>EMPTY</span>}</div>)}</div></div>}
          {panel === "shop" && <div className="dialog-body"><p className="shop-intro">Supplies use local demo transactions now; the Supabase release validates every purchase server-side.</p><div className="shop-grid"><ShopCard name="Fish Bait" description="Boosts bite conditions." price={8} action={() => buy("bait", 8, "Fish Bait", 5)} /><ShopCard name="Lunch" description="Restores 30 stamina." price={18} action={() => buy("lunch", 18, "Lunch", 1)} /><ShopCard name="Tide Rod" description="Future rod upgrade." price={120} action={() => buy("tide-rod", 120, "Tide Rod", 1)} /></div><div className="sell-strip"><span>FRESH CATCH VALUE</span><b>{fishValue} C</b><Button size="sm" onClick={sellAll} disabled={!fish.length}>SELL ALL</Button></div></div>}
        </DialogContent>
      </Dialog>

      {notice && <div className={`notice-toast ${notice.tone}`}><button onClick={() => setNotice(null)} aria-label="Dismiss notice"><X size={15} /></button><p>{notice.title}</p><span>{notice.body}</span></div>}
      <div className="name-strip"><label>CALLSIGN</label><Input value={displayName} onChange={event => { const name = event.target.value; setDisplayName(name); gameRef.current?.send({ type: "set-display-name", name }); }} maxLength={18} />{auth.session && <Button variant="ghost" size="icon" title="Sign out" onClick={auth.signOut}><LogOut size={14} /></Button>}</div>
    </main>
  );
}

function HudCard({ label, value, progress, color, icon }: { label: string; value: string; progress: number; color: "lime" | "cyan"; icon: React.ReactNode }) {
  return <div className={`hud-card ${color}`}><div className="hud-card-title">{icon}<span>{label}</span><b>{value}</b></div><div className="meter"><i style={{ width: `${progress}%` }} /></div></div>;
}

function ShopCard({ name, description, price, action }: { name: string; description: string; price: number; action: () => void }) {
  return <article className="shop-card"><span className="shop-sigil">✦</span><h3>{name}</h3><p>{description}</p><div><b>{price} C</b><Button size="sm" onClick={action}>BUY</Button></div></article>;
}

function EmptyState({ text }: { text: string }) {
  return <p className="empty-state">{text}</p>;
}

function AuthScreen({ error, onSignIn, onSignUp }: { error: string | null; onSignIn: (email: string, password: string) => Promise<void>; onSignUp: (email: string, password: string, username: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    if (mode === "sign-in") await onSignIn(email, password);
    else await onSignUp(email, password, username.trim() || "Guest Angler");
    setSubmitting(false);
  }

  return <main className="auth-shell"><section className="auth-card"><div className="auth-brand"><Sparkles /><span>NEON TIDES</span><small>ONLINE FISHING CLUB</small></div><p>Sign in to save your catch, meet anglers in live zones, and build your tidechest.</p><form onSubmit={submit}>{mode === "sign-up" && <Input value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={18} placeholder="Angler callsign" required />}<Input value={email} onChange={event => setEmail(event.target.value)} type="email" placeholder="Email address" required /><Input value={password} onChange={event => setPassword(event.target.value)} type="password" minLength={6} placeholder="Password" required />{error && <div className="auth-error">{error}</div>}<Button className="lime-action" disabled={submitting} type="submit">{submitting ? "CASTING…" : mode === "sign-in" ? "ENTER THE HARBOR" : "CREATE ANGLER"}</Button></form><button className="auth-toggle" onClick={() => setMode(current => current === "sign-in" ? "sign-up" : "sign-in")}>{mode === "sign-in" ? "NEW HERE? CREATE AN ANGLER" : "ALREADY REGISTERED? SIGN IN"}</button></section></main>;
}
