import { GameController } from "@/game/GameController";
import type { GameBridgeEvent, GameCommand } from "@/game/types";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type PhaserGameHandle = { send: (command: GameCommand) => void };

type Props = { onGameEvent: (event: GameBridgeEvent) => void };

const PhaserGame = forwardRef<PhaserGameHandle, Props>(function PhaserGame({ onGameEvent }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<GameController | null>(null);

  useImperativeHandle(ref, () => ({
    send: command => controllerRef.current?.send(command),
  }), []);

  useEffect(() => {
    if (!hostRef.current) return;
    const controller = new GameController(onGameEvent);
    controllerRef.current = controller;
    controller.start(hostRef.current);
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, [onGameEvent]);

  return <div ref={hostRef} className="phaser-host" aria-label="Interactive fishing game world" />;
});

export default PhaserGame;
