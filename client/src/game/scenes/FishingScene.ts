import Phaser from "phaser";
import { getZone, type WorldInteraction, type WorldRect } from "../data/zones";
import type { CatchResult, Direction, FishingPhase, GameBridgeEvent, GameCommand, PublicPlayerState, ZoneId } from "../types";

type Controls = Record<string, Phaser.Input.Keyboard.Key>;

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 540;
const PLAYER_SPEED = 176;

type RemoteAvatar = {
  player: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  rod: Phaser.GameObjects.Rectangle;
  state: PublicPlayerState;
};

export class FishingScene extends Phaser.Scene {
  private readonly bridge: Phaser.Events.EventEmitter;
  private zoneId: ZoneId = "harbor-hub";
  private player!: Phaser.GameObjects.Container;
  private playerLabel!: Phaser.GameObjects.Text;
  private rod!: Phaser.GameObjects.Rectangle;
  private controls!: Controls;
  private name = "Guest Angler";
  private facing: Direction = "down";
  private phase: FishingPhase = "idle";
  private activeTimers: Phaser.Time.TimerEvent[] = [];
  private hintText!: Phaser.GameObjects.Text;
  private zoneText!: Phaser.GameObjects.Text;
  private reelUi!: Phaser.GameObjects.Container;
  private fishMarker!: Phaser.GameObjects.Rectangle;
  private reelCursor!: Phaser.GameObjects.Rectangle;
  private reelProgressText!: Phaser.GameObjects.Text;
  private catchProgress = 45;
  private fishPosition = 50;
  private cursorPosition = 50;
  private fishVelocity = 38;
  private lastNearWater = false;
  private remotePlayers = new Map<string, RemoteAvatar>();

  constructor(bridge: Phaser.Events.EventEmitter) {
    super({ key: "FishingScene" });
    this.bridge = bridge;
  }

  create() {
    this.controls = this.input.keyboard?.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      arrowUp: Phaser.Input.Keyboard.KeyCodes.UP,
      arrowDown: Phaser.Input.Keyboard.KeyCodes.DOWN,
      arrowLeft: Phaser.Input.Keyboard.KeyCodes.LEFT,
      arrowRight: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      interact: Phaser.Input.Keyboard.KeyCodes.F,
      cast: Phaser.Input.Keyboard.KeyCodes.SPACE,
    }) as Controls;

    this.bridge.on("game-command", this.handleCommand, this);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setRoundPixels(true);
    this.drawZone();
    this.createPlayer();
    this.createHud();
    this.enterZone(this.zoneId, false);
  }

  shutdown() {
    this.bridge.off("game-command", this.handleCommand, this);
    this.activeTimers.forEach(timer => timer.remove(false));
    this.activeTimers = [];
  }

  update(_time: number, delta: number) {
    const zone = getZone(this.zoneId);
    const movementAllowed = this.phase === "idle";
    let dx = 0;
    let dy = 0;

    if (movementAllowed) {
      if (this.controls.left.isDown || this.controls.arrowLeft.isDown) dx -= 1;
      if (this.controls.right.isDown || this.controls.arrowRight.isDown) dx += 1;
      if (this.controls.up.isDown || this.controls.arrowUp.isDown) dy -= 1;
      if (this.controls.down.isDown || this.controls.arrowDown.isDown) dy += 1;
    }

    const moving = dx !== 0 || dy !== 0;
    if (moving) {
      const length = Math.hypot(dx, dy);
      dx /= length;
      dy /= length;
      if (Math.abs(dx) > Math.abs(dy)) this.facing = dx < 0 ? "left" : "right";
      else this.facing = dy < 0 ? "up" : "down";
      this.player.x = Phaser.Math.Clamp(this.player.x + dx * PLAYER_SPEED * (delta / 1000), 24, WORLD_WIDTH - 24);
      this.player.y = Phaser.Math.Clamp(this.player.y + dy * PLAYER_SPEED * (delta / 1000), 32, WORLD_HEIGHT - 24);
      this.playerLabel.setPosition(this.player.x, this.player.y - 37);
      this.updateRodPose();
    }

    const nearWater = this.isNearWater(zone.water);
    if (nearWater !== this.lastNearWater) {
      this.lastNearWater = nearWater;
      this.emit({ type: "near-water", value: nearWater });
    }

    if (Phaser.Input.Keyboard.JustDown(this.controls.interact)) this.interact();
    if (Phaser.Input.Keyboard.JustDown(this.controls.cast)) this.startFishing();
    if (this.phase === "reeling") this.updateReeling(delta);
    this.remotePlayers.forEach(remote => this.updateRemotePlayer(remote, delta));

    this.emit({ type: "position", x: this.player.x, y: this.player.y, direction: this.facing, moving });
  }

  private handleCommand(command: GameCommand) {
    if (command.type === "cast") this.startFishing();
    if (command.type === "interact") this.interact();
    if (command.type === "travel") this.enterZone(command.zoneId, true);
    if (command.type === "set-display-name") {
      this.name = command.name.slice(0, 18) || "Guest Angler";
      this.playerLabel.setText(this.name);
    }
    if (command.type === "remote-player") this.upsertRemotePlayer(command.player);
    if (command.type === "remove-remote-player") this.removeRemotePlayer(command.playerId);
  }

  private drawZone() {
    this.remotePlayers.clear();
    this.children.removeAll();
    const zone = getZone(this.zoneId);
    this.add.rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, zone.palette.ground).setOrigin(0.5);

    for (let x = 18; x < WORLD_WIDTH; x += 36) {
      for (let y = 26; y < WORLD_HEIGHT; y += 36) {
        const tint = (x / 36 + y / 36) % 2 === 0 ? 0xffffff : 0xaec8ff;
        this.add.rectangle(x, y, 4, 4, tint, 0.08).setOrigin(0.5);
      }
    }

    zone.water.forEach(water => this.drawWater(water, zone.palette.water, zone.palette.glow));
    this.add.rectangle(WORLD_WIDTH / 2, 510, 760, 24, zone.palette.path, 0.82).setStrokeStyle(2, zone.palette.accent, 0.32);
    this.add.rectangle(450, 320, 230, 18, zone.palette.path, 0.82).setStrokeStyle(2, zone.palette.accent, 0.32);
    this.drawProps(zone.interactions, zone.palette.accent, zone.palette.glow);
  }

  private drawWater(water: WorldRect, waterColor: number, glow: number) {
    this.add.rectangle(water.x + water.width / 2, water.y + water.height / 2, water.width, water.height, waterColor).setOrigin(0.5).setStrokeStyle(3, glow, 0.72);
    for (let x = water.x + 28; x < water.x + water.width - 10; x += 54) {
      for (let y = water.y + 28; y < water.y + water.height - 8; y += 44) {
        const wave = this.add.rectangle(x, y, 18, 3, glow, 0.58).setOrigin(0.5);
        this.tweens.add({ targets: wave, x: x + 15, alpha: 0.15, duration: 1300, yoyo: true, repeat: -1, delay: (x + y) % 740 });
      }
    }
  }

  private drawProps(interactions: WorldInteraction[], accent: number, glow: number) {
    for (let x = 76; x < WORLD_WIDTH; x += 168) {
      const trunk = this.add.rectangle(x, 430 - ((x / 42) % 3) * 30, 12, 32, 0x552f5c);
      const crown = this.add.triangle(x, trunk.y - 32, -22, 20, 0, -28, 22, 20, accent, 0.82).setStrokeStyle(2, 0x08152f, 1);
      crown.setScale(1 + ((x / 42) % 2) * 0.12);
    }

    interactions.forEach(interaction => {
      const color = interaction.kind === "portal" ? glow : accent;
      if (interaction.kind === "shop") {
        this.add.rectangle(interaction.x, interaction.y, 84, 54, 0x211c45).setStrokeStyle(3, color, 1);
        this.add.rectangle(interaction.x, interaction.y - 34, 94, 13, color, 0.92);
      } else if (interaction.kind === "storage") {
        this.add.rectangle(interaction.x, interaction.y, 42, 30, 0x7c4b61).setStrokeStyle(3, color, 1);
        this.add.rectangle(interaction.x, interaction.y - 6, 34, 4, color, 0.75);
      } else {
        const marker = this.add.rectangle(interaction.x, interaction.y, 20, 42, color, 0.32).setStrokeStyle(2, color, 1);
        this.tweens.add({ targets: marker, alpha: 0.85, duration: 620, yoyo: true, repeat: -1 });
      }
      this.add.text(interaction.x, interaction.y + 44, interaction.label, { fontFamily: "monospace", fontSize: "10px", color: "#f3f7ff", align: "center" }).setOrigin(0.5);
    });
  }

  private createPlayer() {
    const zone = getZone(this.zoneId);
    this.player = this.add.container(zone.spawn.x, zone.spawn.y);
    const shadow = this.add.ellipse(0, 14, 34, 12, 0x07122d, 0.68);
    const legs = this.add.rectangle(0, 8, 18, 18, 0x4bc7e8).setStrokeStyle(2, 0x07122d, 1);
    const coat = this.add.rectangle(0, -2, 24, 24, 0xceff52).setStrokeStyle(2, 0x07122d, 1);
    const face = this.add.rectangle(0, -18, 18, 15, 0xffc88b).setStrokeStyle(2, 0x07122d, 1);
    const cap = this.add.rectangle(0, -28, 24, 8, 0xef4dcc).setStrokeStyle(2, 0x07122d, 1);
    this.rod = this.add.rectangle(22, -10, 4, 36, 0xffe769).setOrigin(0.5).setAngle(36);
    this.player.add([shadow, legs, coat, face, cap, this.rod]);
    this.playerLabel = this.add.text(zone.spawn.x, zone.spawn.y - 37, this.name, { fontFamily: "monospace", fontSize: "12px", color: "#ffffff", stroke: "#08152f", strokeThickness: 4 }).setOrigin(0.5);
    this.updateRodPose();
  }

  private createHud() {
    this.zoneText = this.add.text(22, 18, "", { fontFamily: "monospace", fontSize: "14px", color: "#d6ff5a", stroke: "#07132f", strokeThickness: 4 }).setScrollFactor(0);
    this.hintText = this.add.text(22, 489, "WASD / ARROWS · MOVE   SPACE · CAST   F · INTERACT", { fontFamily: "monospace", fontSize: "12px", color: "#edfbff", stroke: "#07132f", strokeThickness: 4 }).setScrollFactor(0);
    this.createReelUi();
  }

  private createReelUi() {
    this.reelUi = this.add.container(710, 54).setScrollFactor(0).setVisible(false);
    const frame = this.add.rectangle(0, 0, 210, 132, 0x07132f, 0.94).setStrokeStyle(3, 0xf449d6, 1);
    const track = this.add.rectangle(0, 16, 170, 16, 0x20365e).setStrokeStyle(2, 0x49f7ff, 1);
    this.reelCursor = this.add.rectangle(0, 16, 38, 23, 0xd9ff55, 0.85).setStrokeStyle(2, 0x07132f, 1);
    this.fishMarker = this.add.rectangle(0, 16, 12, 28, 0xf449d6).setStrokeStyle(2, 0xffffff, 0.86);
    this.reelProgressText = this.add.text(0, -43, "REEL WINDOW", { fontFamily: "monospace", fontSize: "14px", color: "#f7f9ff" }).setOrigin(0.5);
    const hint = this.add.text(0, 46, "W / S OR ↑ / ↓", { fontFamily: "monospace", fontSize: "11px", color: "#49f7ff" }).setOrigin(0.5);
    this.reelUi.add([frame, track, this.reelCursor, this.fishMarker, this.reelProgressText, hint]);
  }

  private interact() {
    if (this.phase !== "idle") return;
    const interaction = this.getNearbyInteraction();
    if (!interaction) {
      this.emit({ type: "notice", title: "NOTHING NEARBY", body: "Walk closer to a shop, chest, or bright zone marker.", tone: "info" });
      return;
    }
    if (interaction.kind === "portal" && interaction.target) {
      this.emit({ type: "interaction", panel: "travel", zoneId: interaction.target });
      return;
    }
    this.emit({ type: "interaction", panel: interaction.kind === "shop" ? "shop" : "storage" });
  }

  private startFishing() {
    if (this.phase !== "idle") return;
    if (!this.isNearWater(getZone(this.zoneId).water)) {
      this.emit({ type: "notice", title: "FIND WATER", body: "Stand next to the cyan shoreline before casting.", tone: "warn" });
      return;
    }
    this.phase = "casting";
    this.rod.setAngle(this.facing === "left" ? -72 : 72);
    this.emit({ type: "spend", stamina: 7, durability: 1 });
    this.emit({ type: "fishing", phase: "casting", hint: "Casting line…" });
    this.hintText.setText("CASTING… HOLD STEADY");
    this.addDelay(500, () => {
      this.phase = "waiting";
      this.emit({ type: "fishing", phase: "waiting", hint: "A bite can come at any moment…" });
      this.hintText.setText("WAITING FOR A BITE…");
      this.addDelay(1500 + Math.floor(Math.random() * 1800), () => this.beginReel());
    });
  }

  private beginReel() {
    if (this.phase !== "waiting") return;
    this.phase = "reeling";
    this.catchProgress = 38;
    this.fishPosition = 46 + Math.random() * 16;
    this.cursorPosition = 50;
    this.fishVelocity = Math.random() > 0.5 ? 44 : -44;
    this.reelUi.setVisible(true);
    this.emit({ type: "fishing", phase: "reeling", hint: "Keep the fish inside the lime reel window." });
    this.emit({ type: "notice", title: "BITE!", body: "Use W/S or ↑/↓ to follow the fish.", tone: "good" });
    this.hintText.setText("REEL IN · FOLLOW THE MAGENTA FISH");
  }

  private updateReeling(delta: number) {
    const seconds = delta / 1000;
    const vertical = (this.controls.up.isDown || this.controls.arrowUp.isDown ? -1 : 0) + (this.controls.down.isDown || this.controls.arrowDown.isDown ? 1 : 0);
    this.cursorPosition = Phaser.Math.Clamp(this.cursorPosition + vertical * 66 * seconds, 4, 96);
    this.fishPosition += this.fishVelocity * seconds;
    if (this.fishPosition > 96 || this.fishPosition < 4) this.fishVelocity *= -1;
    this.fishVelocity += Math.sin(this.time.now / 180) * 8 * seconds;
    this.fishVelocity = Phaser.Math.Clamp(this.fishVelocity, -76, 76);
    const aligned = Math.abs(this.cursorPosition - this.fishPosition) < 14;
    this.catchProgress = Phaser.Math.Clamp(this.catchProgress + (aligned ? 28 : -18) * seconds, 0, 100);
    const trackX = (value: number) => -85 + value * 1.7;
    this.reelCursor.x = trackX(this.cursorPosition);
    this.fishMarker.x = trackX(this.fishPosition);
    this.reelProgressText.setText(`CATCH ${Math.round(this.catchProgress)}%`);
    if (this.catchProgress >= 100) this.finishFishing(true);
    if (this.catchProgress <= 0) this.finishFishing(false);
  }

  private finishFishing(success: boolean) {
    if (this.phase !== "reeling") return;
    this.phase = "idle";
    this.reelUi.setVisible(false);
    this.updateRodPose();
    this.hintText.setText("WASD / ARROWS · MOVE   SPACE · CAST   F · INTERACT");
    if (!success) {
      this.emit({ type: "fishing", phase: "idle", hint: "The fish slipped away. Try another cast." });
      this.emit({ type: "notice", title: "LINE SLACK", body: "The fish got away. Reposition and try again.", tone: "warn" });
      return;
    }
    const fish = this.pickFish();
    this.emit({ type: "catch", fish });
    this.emit({ type: "fishing", phase: "idle", hint: `Caught a ${fish.name}!` });
    this.emit({ type: "notice", title: `${fish.rarity.toUpperCase()} CATCH`, body: `You reeled in ${fish.name}: ${fish.value} coins when sold.`, tone: "good" });
  }

  private pickFish(): CatchResult {
    const pool = getZone(this.zoneId).fishPool;
    const roll = Math.random() * 100;
    const candidates = pool.filter(fish => (fish.rarity === "legendary" ? roll < 3 : fish.rarity === "rare" ? roll < 18 : fish.rarity === "uncommon" ? roll < 54 : true));
    return candidates[Math.floor(Math.random() * candidates.length)] ?? pool[0];
  }

  private enterZone(zoneId: ZoneId, announce: boolean) {
    const zone = getZone(zoneId);
    if (zone.requiredLevel > 1 && zoneId === "moonlit-inlet") {
      this.emit({ type: "notice", title: "LOCKED CURRENT", body: "Moonlit Inlet opens at level 3. Keep fishing at Glasswater Lake.", tone: "warn" });
      return;
    }
    this.zoneId = zoneId;
    this.phase = "idle";
    this.activeTimers.forEach(timer => timer.remove(false));
    this.activeTimers = [];
    if (this.children.length) {
      this.drawZone();
      this.createPlayer();
      this.createHud();
    }
    this.zoneText.setText(`${zone.name.toUpperCase()} · ${zone.subtitle.toUpperCase()}`);
    this.emit({ type: "zone", zoneId, zoneName: zone.name, objective: zone.objective });
    this.emit({ type: "fishing", phase: "idle", hint: "Move near water and press Space to cast." });
    if (announce) this.emit({ type: "notice", title: "ZONE ENTERED", body: `${zone.name} is now your live multiplayer room.`, tone: "info" });
  }

  private getNearbyInteraction() {
    return getZone(this.zoneId).interactions.find(interaction => Phaser.Math.Distance.Between(this.player.x, this.player.y, interaction.x, interaction.y) < 64);
  }

  private isNearWater(waters: WorldRect[]) {
    return waters.some(water => {
      const closestX = Phaser.Math.Clamp(this.player.x, water.x, water.x + water.width);
      const closestY = Phaser.Math.Clamp(this.player.y, water.y, water.y + water.height);
      return Phaser.Math.Distance.Between(this.player.x, this.player.y, closestX, closestY) < 43;
    });
  }

  private updateRodPose() {
    const angles: Record<Direction, number> = { down: 38, up: 142, left: -62, right: 62 };
    this.rod.setAngle(angles[this.facing]);
    this.rod.setPosition(this.facing === "left" ? -21 : 21, this.facing === "up" ? -16 : -4);
  }

  private upsertRemotePlayer(state: PublicPlayerState) {
    let remote = this.remotePlayers.get(state.playerId);
    if (!remote) {
      const shadow = this.add.ellipse(0, 14, 34, 12, 0x07122d, 0.62);
      const legs = this.add.rectangle(0, 8, 18, 18, 0x5cd5f2).setStrokeStyle(2, 0x07122d, 1);
      const coat = this.add.rectangle(0, -2, 24, 24, 0xf449d6).setStrokeStyle(2, 0x07122d, 1);
      const face = this.add.rectangle(0, -18, 18, 15, 0xffc88b).setStrokeStyle(2, 0x07122d, 1);
      const cap = this.add.rectangle(0, -28, 24, 8, 0x49f7ff).setStrokeStyle(2, 0x07122d, 1);
      const rod = this.add.rectangle(22, -10, 4, 36, 0xffe769).setOrigin(0.5).setAngle(36);
      const player = this.add.container(state.x, state.y, [shadow, legs, coat, face, cap, rod]);
      const label = this.add.text(state.x, state.y - 37, state.username, { fontFamily: "monospace", fontSize: "12px", color: "#ffffff", stroke: "#08152f", strokeThickness: 4 }).setOrigin(0.5);
      remote = { player, label, rod, state };
      this.remotePlayers.set(state.playerId, remote);
    }
    remote.state = state;
    remote.label.setText(state.username);
  }

  private updateRemotePlayer(remote: RemoteAvatar, delta: number) {
    const amount = Math.min(1, delta / 120);
    remote.player.x = Phaser.Math.Linear(remote.player.x, remote.state.x, amount);
    remote.player.y = Phaser.Math.Linear(remote.player.y, remote.state.y, amount);
    remote.label.setPosition(remote.player.x, remote.player.y - 37);
    const angles: Record<Direction, number> = { down: 38, up: 142, left: -62, right: 62 };
    const fishing = remote.state.state === "casting" || remote.state.state === "waiting" || remote.state.state === "reeling";
    remote.rod.setAngle(fishing ? (remote.state.direction === "left" ? -72 : 72) : angles[remote.state.direction]);
    remote.rod.setPosition(remote.state.direction === "left" ? -21 : 21, remote.state.direction === "up" ? -16 : -4);
  }

  private removeRemotePlayer(playerId: string) {
    const remote = this.remotePlayers.get(playerId);
    if (!remote) return;
    remote.player.destroy(true);
    remote.label.destroy();
    this.remotePlayers.delete(playerId);
  }

  private addDelay(delay: number, callback: () => void) {
    const timer = this.time.delayedCall(delay, callback);
    this.activeTimers.push(timer);
  }

  private emit(event: GameBridgeEvent) {
    this.bridge.emit("game-event", event);
  }
}
