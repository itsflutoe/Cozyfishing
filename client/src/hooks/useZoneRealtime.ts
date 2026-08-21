import type { PublicPlayerState, ZoneId } from "@/game/types";
import { supabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";

type ChatMessage = { author: string; text: string };

type Options = {
  enabled: boolean;
  playerId: string;
  username: string;
  zoneId: ZoneId;
  onRemotePlayer: (player: PublicPlayerState) => void;
  onRemoveRemotePlayer: (playerId: string) => void;
  onChat: (message: ChatMessage) => void;
};

export function useZoneRealtime({ enabled, playerId, username, zoneId, onRemotePlayer, onRemoveRemotePlayer, onChat }: Options) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastMovementSentAt = useRef(0);
  const [onlineCount, setOnlineCount] = useState(1);

  useEffect(() => {
    const realtimeClient = supabase;
    if (!enabled || !realtimeClient) {
      setOnlineCount(1);
      return;
    }

    const channel = realtimeClient.channel(`neon-tides:zone:${zoneId}`, {
      config: { presence: { key: playerId }, broadcast: { self: false, ack: false } },
    });
    channelRef.current = channel;

    channel
      .on("broadcast", { event: "movement" }, ({ payload }) => {
        const player = payload as PublicPlayerState;
        if (player.playerId !== playerId) onRemotePlayer(player);
      })
      .on("broadcast", { event: "state" }, ({ payload }) => {
        const player = payload as PublicPlayerState;
        if (player.playerId !== playerId) onRemotePlayer(player);
      })
      .on("broadcast", { event: "chat" }, ({ payload }) => {
        const message = payload as ChatMessage & { playerId?: string };
        if (message.playerId !== playerId && message.text) onChat({ author: message.author, text: message.text.slice(0, 120) });
      })
      .on("presence", { event: "sync" }, () => {
        const states = channel.presenceState<PublicPlayerState>();
        const active = Object.values(states).flat();
        setOnlineCount(Math.max(1, active.length));
        active.forEach(player => { if (player.playerId !== playerId) onRemotePlayer(player); });
      })
      .on("presence", { event: "leave" }, ({ leftPresences }) => {
        leftPresences.forEach(player => {
          const presence = player as unknown as PublicPlayerState;
          if (presence.playerId && presence.playerId !== playerId) onRemoveRemotePlayer(presence.playerId);
        });
      })
      .subscribe(async status => {
        if (status !== "SUBSCRIBED") return;
        await channel.track({ playerId, username, x: 246, y: 356, direction: "down", state: "idle", updatedAt: Date.now() } satisfies PublicPlayerState);
      });

    return () => {
      channel.untrack();
      void realtimeClient.removeChannel(channel);
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [enabled, onChat, onRemotePlayer, onRemoveRemotePlayer, playerId, username, zoneId]);

  function publishPosition(player: Omit<PublicPlayerState, "playerId" | "username" | "state" | "updatedAt"> & { direction: PublicPlayerState["direction"]; moving: boolean; state: PublicPlayerState["state"] }) {
    const now = Date.now();
    if (!channelRef.current || now - lastMovementSentAt.current < 100) return;
    lastMovementSentAt.current = now;
    const state: PublicPlayerState = { playerId, username, x: player.x, y: player.y, direction: player.direction, state: player.state, updatedAt: now };
    channelRef.current.track(state);
    if (player.moving) channelRef.current.send({ type: "broadcast", event: "movement", payload: state });
  }

  function publishState(player: Omit<PublicPlayerState, "playerId" | "username" | "updatedAt">) {
    if (!channelRef.current) return;
    const state: PublicPlayerState = { ...player, playerId, username, updatedAt: Date.now() };
    channelRef.current.track(state);
    channelRef.current.send({ type: "broadcast", event: "state", payload: state });
  }

  function sendChat(text: string) {
    if (!channelRef.current) return;
    channelRef.current.send({ type: "broadcast", event: "chat", payload: { playerId, author: username, text: text.slice(0, 120) } });
  }

  return { onlineCount, publishPosition, publishState, sendChat };
}
