import Phaser from "phaser";
import { FishingScene } from "./scenes/FishingScene";
import type { GameBridgeEvent, GameCommand } from "./types";

export class GameController {
  private game: Phaser.Game | null = null;
  private readonly bridge = new Phaser.Events.EventEmitter();

  constructor(private readonly onEvent: (event: GameBridgeEvent) => void) {
    this.bridge.on("game-event", this.onEvent);
  }

  start(parent: HTMLElement) {
    if (this.game) return;

    const scene = new FishingScene(this.bridge);
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      width: 960,
      height: 540,
      backgroundColor: "#07132f",
      pixelArt: true,
      antialias: false,
      render: { antialias: false, roundPixels: true },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 960,
        height: 540,
      },
      scene: [scene],
    });
  }

  send(command: GameCommand) {
    this.bridge.emit("game-command", command);
  }

  destroy() {
    this.bridge.off("game-event", this.onEvent);
    this.game?.destroy(true);
    this.game = null;
  }
}
