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
      width: parent.clientWidth || 960,
      height: parent.clientHeight || 540,
      backgroundColor: "#5a7a40",
      pixelArt: true,
      antialias: false,
      render: { antialias: false, roundPixels: true },
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [scene],
    });
  }

  send(command: GameCommand) {
    this.bridge.emit("game-command", command);
  }

  focus() {
    const canvas = this.game?.canvas;
    if (!canvas) return;
    canvas.tabIndex = 0;
    canvas.focus({ preventScroll: true });
  }

  destroy() {
    this.bridge.off("game-event", this.onEvent);
    this.game?.destroy(true);
    this.game = null;
  }
}
