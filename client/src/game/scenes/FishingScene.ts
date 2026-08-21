import Phaser from "phaser";
import { getZone, type WorldInteraction, type WorldRect } from "../data/zones";
import { normalizeMovement } from "../movement";
import type { CatchResult, Direction, FishingPhase, GameBridgeEvent, GameCommand, PublicPlayerState, ZoneId } from "../types";

type Controls = Record<string, Phaser.Input.Keyboard.Key>;
type RemoteAvatar = { player: Phaser.GameObjects.Container; label: Phaser.GameObjects.Text; rod: Phaser.GameObjects.Rectangle; state: PublicPlayerState };

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 540;
const PLAYER_SPEED = 176;
const INK = 0x293b36;
const CREAM = "#fff5d8";
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
  private playerBarSize = 48;
  private fishDartTimer = 0;
  private pendingFish: CatchResult | null = null;
  private cursorVelocity = 0;
  private keptContact = true;
  private fishTarget = 50;
  private fishAccel = 0;
  private reelTrackBg!: Phaser.GameObjects.Rectangle;
  private reelProgressBg!: Phaser.GameObjects.Rectangle;
  private reelProgressFill!: Phaser.GameObjects.Rectangle;
  private lastNearWater = false;
  private touchMove = { x: 0, y: 0 };
  private remotePlayers = new Map<string, RemoteAvatar>();

  constructor(bridge: Phaser.Events.EventEmitter) { super({ key: "FishingScene" }); this.bridge = bridge; }

  preload() {
    // Local procedural textures only (no external CDN art).
    this.ensurePixelTextures();
  }

  /** Tiny cozy pixel textures generated at runtime so the game never depends on remote images. */
  private ensurePixelTextures() {
    if (!this.textures.exists("tex-grass")) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x7e9a67, 1);
      g.fillRect(0, 0, 16, 16);
      g.fillStyle(0x8fad72, 1);
      g.fillRect(2, 3, 3, 2);
      g.fillRect(9, 8, 3, 2);
      g.fillStyle(0x6d8a58, 1);
      g.fillRect(11, 2, 2, 2);
      g.fillRect(4, 11, 2, 2);
      g.generateTexture("tex-grass", 16, 16);
      g.destroy();
    }
    if (!this.textures.exists("tex-water")) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x4d91a8, 1);
      g.fillRect(0, 0, 16, 16);
      g.fillStyle(0x6aadbf, 1);
      g.fillRect(1, 4, 6, 2);
      g.fillRect(8, 10, 6, 2);
      g.generateTexture("tex-water", 16, 16);
      g.destroy();
    }
  }

  create() {
    this.controls = this.input.keyboard?.addKeys({ up: Phaser.Input.Keyboard.KeyCodes.W, down: Phaser.Input.Keyboard.KeyCodes.S, left: Phaser.Input.Keyboard.KeyCodes.A, right: Phaser.Input.Keyboard.KeyCodes.D, arrowUp: Phaser.Input.Keyboard.KeyCodes.UP, arrowDown: Phaser.Input.Keyboard.KeyCodes.DOWN, arrowLeft: Phaser.Input.Keyboard.KeyCodes.LEFT, arrowRight: Phaser.Input.Keyboard.KeyCodes.RIGHT, interact: Phaser.Input.Keyboard.KeyCodes.F, cast: Phaser.Input.Keyboard.KeyCodes.SPACE }) as Controls;
    this.bridge.on("game-command", this.handleCommand, this);
    this.input.on("pointerdown", () => { this.onFishingTap(); });
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setRoundPixels(true);
    this.setupFollowCamera();
    this.scale.on("resize", () => { this.setupFollowCamera(); this.layoutReelUi(); }, this);
    this.drawZone(); this.createPlayer(); this.createHud(); this.setupFollowCamera(); this.enterZone(this.zoneId, false);
  }

  shutdown() { this.bridge.off("game-command", this.handleCommand, this); this.activeTimers.forEach(timer => timer.remove(false)); this.activeTimers = []; }

  update(_time: number, delta: number) {
    const zone = getZone(this.zoneId);
    let inputX = 0; let inputY = 0;
    if (this.phase === "idle") {
      if (this.controls.left.isDown || this.controls.arrowLeft.isDown) inputX -= 1;
      if (this.controls.right.isDown || this.controls.arrowRight.isDown) inputX += 1;
      if (this.controls.up.isDown || this.controls.arrowUp.isDown) inputY -= 1;
      if (this.controls.down.isDown || this.controls.arrowDown.isDown) inputY += 1;
      inputX += this.touchMove.x; inputY += this.touchMove.y;
    }
    const { x: dx, y: dy } = normalizeMovement(inputX, inputY);
    const moving = dx !== 0 || dy !== 0;
    if (moving) {
      if (Math.abs(dx) > Math.abs(dy)) this.facing = dx < 0 ? "left" : "right"; else this.facing = dy < 0 ? "up" : "down";
      this.player.x = Phaser.Math.Clamp(this.player.x + dx * PLAYER_SPEED * (delta / 1000), 24, WORLD_WIDTH - 24);
      this.player.y = Phaser.Math.Clamp(this.player.y + dy * PLAYER_SPEED * (delta / 1000), 32, WORLD_HEIGHT - 24);
      this.playerLabel.setPosition(this.player.x, this.player.y - 37); this.updateRodPose();
    }
    const nearWater = this.isNearWater(zone.water);
    if (nearWater !== this.lastNearWater) { this.lastNearWater = nearWater; this.emit({ type: "near-water", value: nearWater }); }
    if (Phaser.Input.Keyboard.JustDown(this.controls.interact)) this.interact();
    if (Phaser.Input.Keyboard.JustDown(this.controls.cast)) {
      if (this.phase === "bite") this.hookFish();
      else if (this.phase === "reeling") this.applyBarImpulse();
      else this.startFishing();
    }
    if (this.phase === "reeling") this.updateReeling(delta);
    this.remotePlayers.forEach(remote => this.updateRemotePlayer(remote, delta));
    this.emit({ type: "position", x: this.player.x, y: this.player.y, direction: this.facing, moving });
  }

  private handleCommand(command: GameCommand) {
    if (command.type === "cast") {
      if (this.phase === "bite") this.hookFish();
      else if (this.phase === "reeling") this.applyBarImpulse();
      else this.startFishing();
    }
    if (command.type === "interact") this.interact();
    if (command.type === "move") this.touchMove = normalizeMovement(command.x, command.y);
    if (command.type === "travel") this.enterZone(command.zoneId, true);
    if (command.type === "set-display-name") { this.name = command.name.slice(0, 18) || "Guest Angler"; this.playerLabel.setText(this.name); }
    if (command.type === "remote-player") this.upsertRemotePlayer(command.player);
    if (command.type === "remove-remote-player") this.removeRemotePlayer(command.playerId);
  }

  private drawZone() {
    this.remotePlayers.clear();
    this.children.removeAll();
    const zone = getZone(this.zoneId);

    // Ground fill + tiled grass
    this.add.rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, zone.palette.ground).setOrigin(0.5);
    if (this.textures.exists("tex-grass")) {
      const tile = this.add.tileSprite(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, "tex-grass").setOrigin(0.5);
      tile.setTint(zone.palette.ground);
      tile.setAlpha(0.55);
    } else {
      for (let x = 12; x < WORLD_WIDTH; x += 20) {
        for (let y = 16; y < WORLD_HEIGHT; y += 20) {
          const color = (x / 20 + y / 20) % 3 === 0 ? 0xaec381 : (x / 20 + y / 20) % 2 === 0 ? 0x74935d : 0x8fa86c;
          this.add.rectangle(x, y, 3, 3, color, 0.5).setOrigin(0.5);
        }
      }
    }

    // Soft dirt patches
    for (let i = 0; i < 8; i++) {
      const px = 80 + (i * 97) % (WORLD_WIDTH - 120);
      const py = 200 + (i * 73) % (WORLD_HEIGHT - 220);
      this.add.ellipse(px, py, 40 + (i % 3) * 12, 18, 0x8b7355, 0.22);
    }

    zone.water.forEach(water => this.drawWater(water, zone.palette.water, zone.palette.glow));

    // Paths / boardwalks per zone feel
    if (zone.id === "harbor-hub") {
      this.drawBoardwalk(96, 488, 764, zone.palette.path);
      this.drawBoardwalk(334, 320, 240, zone.palette.path);
      this.drawBoardwalk(400, 260, 80, zone.palette.path);
    } else if (zone.id === "glasswater-lake") {
      this.drawBoardwalk(100, 400, 180, zone.palette.path);
      this.drawBoardwalk(780, 460, 120, zone.palette.path);
    } else {
      this.drawBoardwalk(100, 400, 160, zone.palette.path);
    }

    // Decorative flowers
    for (let i = 0; i < 14; i++) {
      const fx = 50 + ((i * 61) % (WORLD_WIDTH - 100));
      const fy = 180 + ((i * 47) % (WORLD_HEIGHT - 220));
      if (zone.water.some(w => fx > w.x && fx < w.x + w.width && fy > w.y && fy < w.y + w.height)) continue;
      this.drawFlower(fx, fy, i % 3);
    }

    this.drawProps(zone.interactions, zone.palette.accent, zone.palette.glow, true);
  }

  private drawFlower(x: number, y: number, kind: number) {
    const colors = [0xe8a0b0, 0xf0d060, 0xd0a0e0];
    this.add.rectangle(x, y + 4, 2, 6, 0x4a7a40);
    this.add.circle(x, y, 3, colors[kind]);
    this.add.circle(x, y, 1.5, 0xfff5d0);
  }

  private drawBoardwalk(x: number, y: number, width: number, color: number) {
    this.add.rectangle(x + width / 2, y, width, 30, 0x5c4030).setStrokeStyle(2, INK, 0.75);
    for (let plank = x + 4; plank < x + width; plank += 24) {
      this.add.rectangle(plank + 10, y, 20, 24, color).setStrokeStyle(1, 0x4a3224, 0.7);
      this.add.rectangle(plank + 10, y - 8, 18, 2, 0xd4a574, 0.35);
    }
  }

  private drawWater(water: WorldRect, waterColor: number, shore: number) {
    // Shore shadow
    this.add.rectangle(water.x + water.width / 2, water.y + water.height / 2, water.width + 14, water.height + 14, 0x3a5a48, 0.9).setOrigin(0.5);
    const body = this.add.rectangle(water.x + water.width / 2, water.y + water.height / 2, water.width, water.height, waterColor).setOrigin(0.5).setStrokeStyle(3, shore, 0.85);
    if (this.textures.exists("tex-water")) {
      const tile = this.add.tileSprite(water.x + water.width / 2, water.y + water.height / 2, water.width - 4, water.height - 4, "tex-water").setOrigin(0.5);
      tile.setAlpha(0.45);
      this.tweens.add({ targets: tile, tilePositionX: 16, duration: 4000, repeat: -1 });
    }
    for (let x = water.x + 22; x < water.x + water.width - 12; x += 48) {
      for (let y = water.y + 20; y < water.y + water.height - 10; y += 36) {
        const wave = this.add.rectangle(x, y, 16, 3, shore, 0.4).setOrigin(0.5);
        this.tweens.add({
          targets: wave,
          x: x + 10,
          alpha: 0.12,
          duration: 1600 + (x + y) % 400,
          yoyo: true,
          repeat: -1,
          delay: (x + y) % 800,
        });
      }
    }
    // Small sparkles
    for (let i = 0; i < 5; i++) {
      const sx = water.x + 30 + Math.random() * (water.width - 60);
      const sy = water.y + 20 + Math.random() * (water.height - 40);
      const spark = this.add.circle(sx, sy, 1.5, 0xffffff, 0.7);
      this.tweens.add({ targets: spark, alpha: 0.1, duration: 900 + i * 200, yoyo: true, repeat: -1 });
    }
  }

  private drawProps(interactions: WorldInteraction[], accent: number, shore: number, addTrees: boolean) {
    if (addTrees) {
      for (let x = 56; x < WORLD_WIDTH; x += 128) {
        this.drawTree(x, 400 - ((x / 32) % 4) * 22, 0x5f8a48);
        if (x + 50 < WORLD_WIDTH) this.drawTree(x + 50, 430 - ((x / 28) % 3) * 18, 0x6f9a55);
      }
    }
    interactions.forEach(interaction => {
      if (interaction.kind === "shop") this.drawCabin(interaction.x, interaction.y, accent);
      else if (interaction.kind === "storage") this.drawChest(interaction.x, interaction.y, accent);
      else this.drawSignpost(interaction.x, interaction.y, shore);
      this.add
        .text(interaction.x, interaction.y + 50, interaction.label, {
          fontFamily: "monospace",
          fontSize: "10px",
          color: CREAM,
          stroke: "#314338",
          strokeThickness: 3,
          align: "center",
        })
        .setOrigin(0.5);
    });
  }

  private drawTree(x: number, y: number, leafColor: number) {
    // Trunk
    this.add.rectangle(x, y + 16, 12, 34, 0x6b4a2e).setStrokeStyle(2, INK, 0.85);
    this.add.rectangle(x - 2, y + 8, 4, 8, 0x5a3c24);
    // Layered canopy (cozy pixel clumps)
    this.add.circle(x, y - 8, 20, leafColor).setStrokeStyle(2, INK, 0.5);
    this.add.circle(x - 14, y + 2, 14, 0x4f7a3c).setStrokeStyle(2, INK, 0.45);
    this.add.circle(x + 14, y + 2, 14, 0x6a9a50).setStrokeStyle(2, INK, 0.45);
    this.add.circle(x, y - 22, 12, 0x8fbc6a).setStrokeStyle(2, INK, 0.4);
  }

  private drawCabin(x: number, y: number, accent: number) {
    // Body
    this.add.rectangle(x, y + 4, 88, 52, 0xa86b45).setStrokeStyle(3, INK, 0.95);
    // Roof
    this.add.triangle(x, y - 42, -52, 28, 0, -26, 52, 28, 0x7a4050).setStrokeStyle(3, INK, 0.95);
    this.add.rectangle(x, y - 18, 90, 6, 0x8a5060).setStrokeStyle(1, INK, 0.6);
    // Door + window
    this.add.rectangle(x + 18, y + 14, 18, 28, 0x4a3428).setStrokeStyle(2, INK, 0.9);
    this.add.circle(x + 24, y + 14, 2, 0xd4a574);
    this.add.rectangle(x - 20, y - 2, 20, 16, accent).setStrokeStyle(2, INK, 0.85);
    this.add.rectangle(x - 20, y - 2, 2, 16, INK, 0.35);
    this.add.rectangle(x - 20, y - 2, 20, 2, INK, 0.35);
    // Chimney
    this.add.rectangle(x + 28, y - 36, 12, 18, 0x6a5550).setStrokeStyle(2, INK, 0.8);
  }

  private drawChest(x: number, y: number, accent: number) {
    this.add.rectangle(x, y + 2, 48, 32, 0x9a603c).setStrokeStyle(3, INK, 0.95);
    this.add.rectangle(x, y - 12, 48, 12, 0xc6884e).setStrokeStyle(2, INK, 0.85);
    this.add.rectangle(x, y - 6, 48, 3, 0x7a4a28);
    this.add.rectangle(x, y + 4, 10, 10, accent).setStrokeStyle(2, INK, 0.9);
    this.add.rectangle(x, y + 4, 4, 4, 0xf0d060);
  }

  private drawSignpost(x: number, y: number, color: number) {
    this.add.rectangle(x, y + 10, 8, 42, 0x714b32).setStrokeStyle(2, INK, 0.85);
    this.add.rectangle(x + 8, y - 8, 36, 18, color).setStrokeStyle(2, INK, 0.9);
    this.add.rectangle(x + 8, y - 8, 36, 3, 0xffffff, 0.25);
  }

  private createPlayer() {
    const zone = getZone(this.zoneId);
    this.player = this.add.container(zone.spawn.x, zone.spawn.y);

    const shadow = this.add.ellipse(0, 16, 28, 10, 0x2a3828, 0.45);
    // Legs
    const legL = this.add.rectangle(-5, 10, 8, 14, 0x4a5c70).setStrokeStyle(1, INK, 1);
    const legR = this.add.rectangle(5, 10, 8, 14, 0x4a5c70).setStrokeStyle(1, INK, 1);
    // Body / coat
    const coat = this.add.rectangle(0, -2, 22, 22, 0xd8784f).setStrokeStyle(2, INK, 1);
    const collar = this.add.rectangle(0, -12, 18, 6, 0xc06840).setStrokeStyle(1, INK, 0.8);
    // Head
    const face = this.add.rectangle(0, -20, 16, 14, 0xf0bd82).setStrokeStyle(2, INK, 1);
    const eyeL = this.add.rectangle(-4, -21, 2, 2, INK);
    const eyeR = this.add.rectangle(4, -21, 2, 2, INK);
    // Hat
    const hatBrim = this.add.rectangle(0, -28, 24, 5, 0x3d6b55).setStrokeStyle(1, INK, 1);
    const hatTop = this.add.rectangle(0, -34, 16, 10, 0x476b5b).setStrokeStyle(2, INK, 1);
    // Rod
    this.rod = this.add.rectangle(20, -8, 3, 34, 0xd3a45d).setOrigin(0.5).setAngle(36);

    this.player.add([shadow, legL, legR, coat, collar, face, eyeL, eyeR, hatBrim, hatTop, this.rod]);
    this.playerLabel = this.add
      .text(zone.spawn.x, zone.spawn.y - 42, this.name, {
        fontFamily: "monospace",
        fontSize: "12px",
        color: CREAM,
        stroke: "#314338",
        strokeThickness: 4,
      })
      .setOrigin(0.5);
    this.updateRodPose();
  }

  private createHud() {
    this.zoneText = this.add.text(16, 15, "", { fontFamily: "monospace", fontSize: "13px", color: CREAM, stroke: "#314338", strokeThickness: 4 }).setScrollFactor(0);
    this.hintText = this.add.text(16, 510, "Walk to the water's edge, then cast a line.", { fontFamily: "monospace", fontSize: "11px", color: "#e8e2bd", stroke: "#314338", strokeThickness: 4 }).setScrollFactor(0);
    this.createReelUi();
  }

  private createReelUi() {
    // Compact Stardew-like vertical bar (screen-space, beside centered player)
    this.reelUi = this.add.container(0, 0).setScrollFactor(0).setVisible(false).setDepth(1000);

    const trackH = 160;
    const panel = this.add.rectangle(0, 0, 44, trackH + 36, 0x3d4f42, 0.92).setStrokeStyle(3, 0xe8d49a, 1);
    this.reelTrackBg = this.add.rectangle(0, 4, 18, trackH, 0x1a2e24).setStrokeStyle(2, 0xc4b27a, 1);
    this.reelCursor = this.add.rectangle(0, 4, 16, 48, 0x6aaa3a, 0.95).setStrokeStyle(2, 0x314338, 1);
    this.fishMarker = this.add.rectangle(0, 4, 14, 14, 0xe8a04a).setStrokeStyle(2, 0x314338, 1);
    this.reelProgressBg = this.add.rectangle(18, 4, 8, trackH, 0x2a3830).setStrokeStyle(2, 0xc4b27a, 1);
    this.reelProgressFill = this.add.rectangle(18, 4 + trackH / 2, 6, 4, 0xe8d49a).setOrigin(0.5, 1);

    this.reelProgressText = this.add
      .text(0, -(trackH / 2 + 18), "!", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: CREAM,
        stroke: "#314338",
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    const hint = this.add
      .text(0, trackH / 2 + 16, "TAP", {
        fontFamily: "monospace",
        fontSize: "10px",
        color: "#e8d49a",
        stroke: "#314338",
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    this.reelUi.add([
      panel,
      this.reelTrackBg,
      this.reelCursor,
      this.fishMarker,
      this.reelProgressBg,
      this.reelProgressFill,
      this.reelProgressText,
      hint,
    ]);
    this.layoutReelUi();
  }

  private layoutReelUi() {
    if (!this.reelUi) return;
    const w = this.scale.width || 400;
    const h = this.scale.height || 600;
    // Beside the camera-centered player (slightly to the right), Stardew scale
    this.reelUi.setPosition(Math.min(w * 0.58, w - 36), Math.min(h * 0.42, h - 160));
  }

  private interact() {
    if (this.phase !== "idle") return;
    const interaction = this.getNearbyInteraction();
    if (!interaction) {
      this.emit({ type: "notice", title: "Nothing nearby", body: "Walk up to a sign, chest, or the tackle hut.", tone: "info" });
      return;
    }
    if (interaction.kind === "portal" && interaction.target) {
      this.emit({ type: "interaction", panel: "travel", zoneId: interaction.target });
      return;
    }
    this.emit({ type: "interaction", panel: interaction.kind === "shop" ? "shop" : "storage" });
  }

  /** Pointer / mobile / keyboard shared entry for fishing taps. */
  private onFishingTap() {
    if (this.phase === "bite") this.hookFish();
    else if (this.phase === "reeling") this.applyBarImpulse();
  }

  /** One tap = one upward impulse on the green bar (Stardew-style). */
  private applyBarImpulse() {
    if (this.phase !== "reeling") return;
    // Tuned so 1 tap is visible; ~6–10 taps can climb the full bar against gravity
    this.cursorVelocity -= 78;
    this.cursorVelocity = Phaser.Math.Clamp(this.cursorVelocity, -160, 160);
  }

  private startFishing() {
    if (this.phase !== "idle") return;
    if (!this.isNearWater(getZone(this.zoneId).water)) {
      this.emit({ type: "notice", title: "Find the water", body: "Stand by the shoreline before you cast.", tone: "warn" });
      return;
    }
    this.phase = "casting";
    this.rod.setAngle(this.facing === "left" ? -72 : 72);
    this.emit({ type: "spend", stamina: 7, durability: 1 });
    this.emit({ type: "fishing", phase: "casting", hint: "Casting…" });
    this.hintText.setText("Casting…");
    this.addDelay(450, () => {
      if (this.phase !== "casting") return;
      this.phase = "waiting";
      this.emit({ type: "fishing", phase: "waiting", hint: "Waiting for a bite…" });
      this.hintText.setText("Waiting for a bite…");
      this.addDelay(1100 + Math.floor(Math.random() * 1800), () => this.showBite());
    });
  }

  private showBite() {
    if (this.phase !== "waiting") return;
    this.phase = "bite";
    this.pendingFish = this.pickFish();
    this.emit({ type: "fishing", phase: "bite", hint: "Bite! Tap to hook!" });
    this.emit({ type: "notice", title: "Bite!", body: "Tap / click / press Cast to set the hook!", tone: "good" });
    this.hintText.setText("TAP to hook!");
    // Auto-escape if player never hooks
    this.addDelay(2800, () => {
      if (this.phase === "bite") {
        this.phase = "idle";
        this.pendingFish = null;
        this.updateRodPose();
        this.emit({ type: "fishing", phase: "idle", hint: "The fish got away." });
        this.emit({ type: "notice", title: "Too slow", body: "You missed the hook. Cast again.", tone: "warn" });
        this.hintText.setText("Walk to the water's edge, then cast a line.");
      }
    });
  }

  private hookFish() {
    if (this.phase !== "bite") return;
    this.beginReel();
  }

  private beginReel() {
    if (this.phase !== "bite" && this.phase !== "waiting") return;
    if (!this.pendingFish) this.pendingFish = this.pickFish();
    this.phase = "reeling";

    const difficulty = this.fishDifficulty(this.pendingFish.rarity);
    this.catchProgress = 20;
    this.fishPosition = 35 + Math.random() * 30;
    this.fishTarget = this.fishPosition;
    this.cursorPosition = 70;
    this.cursorVelocity = 0;
    this.fishVelocity = 0;
    this.fishAccel = 0;
    this.playerBarSize = difficulty.barSize;
    this.fishDartTimer = 0.2 + Math.random() * 0.4;
    this.keptContact = true;

    this.reelCursor.setSize(16, this.playerBarSize);
    this.layoutReelUi();
    this.reelUi.setVisible(true);
    this.syncReelVisuals();

    this.emit({ type: "fishing", phase: "reeling", hint: "Tap to lift the green bar — keep the fish inside!" });
    this.hintText.setText("TAP to lift the bar!");
    this.reelProgressText.setText("!");
  }

  private fishDifficulty(rarity: CatchResult["rarity"]) {
    switch (rarity) {
      case "legendary":
        return { speed: 55, barSize: 34, dart: 1.6, accel: 90 };
      case "rare":
        return { speed: 42, barSize: 40, dart: 1.2, accel: 70 };
      case "uncommon":
        return { speed: 32, barSize: 46, dart: 0.95, accel: 55 };
      default:
        return { speed: 22, barSize: 52, dart: 0.7, accel: 40 };
    }
  }

  private updateReeling(delta: number) {
    const dt = Math.min(delta / 1000, 0.05);
    const trackH = 160;

    // Gravity + momentum on green bar (tap impulses applied separately)
    const gravity = 95;
    this.cursorVelocity += gravity * dt;
    // Light drag so taps feel snappy but not endless float
    this.cursorVelocity *= 1 - Math.min(1, 1.8 * dt);
    this.cursorPosition += this.cursorVelocity * dt;
    if (this.cursorPosition < 0) {
      this.cursorPosition = 0;
      this.cursorVelocity = Math.max(0, this.cursorVelocity * 0.2);
    } else if (this.cursorPosition > 100) {
      this.cursorPosition = 100;
      this.cursorVelocity = Math.min(0, this.cursorVelocity * 0.2);
    }

    // Species-like fish motion: seek random targets, accelerate, dart
    const rarity = this.pendingFish?.rarity ?? "common";
    const d = this.fishDifficulty(rarity);
    this.fishDartTimer -= dt;
    if (this.fishDartTimer <= 0) {
      this.fishTarget = Phaser.Math.Clamp(this.fishPosition + (Math.random() * 2 - 1) * (25 + d.dart * 20), 5, 95);
      this.fishDartTimer = 0.35 + Math.random() * (1.1 / d.dart);
    }
    const dir = Math.sign(this.fishTarget - this.fishPosition) || (Math.random() > 0.5 ? 1 : -1);
    this.fishAccel = dir * d.accel;
    this.fishVelocity += this.fishAccel * dt;
    this.fishVelocity = Phaser.Math.Clamp(this.fishVelocity, -d.speed, d.speed);
    this.fishVelocity *= 1 - Math.min(1, 0.6 * dt);
    this.fishPosition += this.fishVelocity * dt;
    if (this.fishPosition < 0 || this.fishPosition > 100) {
      this.fishPosition = Phaser.Math.Clamp(this.fishPosition, 0, 100);
      this.fishVelocity *= -0.6;
    }

    const halfBar = (this.playerBarSize / trackH) * 50;
    const aligned = Math.abs(this.cursorPosition - this.fishPosition) <= halfBar + 2.5;
    if (!aligned) this.keptContact = false;

    const gain = 24 + (60 - this.playerBarSize) * 0.2;
    const loss = 16 + d.dart * 5;
    this.catchProgress = Phaser.Math.Clamp(this.catchProgress + (aligned ? gain : -loss) * dt, 0, 100);

    this.syncReelVisuals();
    this.reelProgressText.setText(aligned ? "!" : "…");

    if (this.catchProgress >= 100) this.finishFishing(true);
    else if (this.catchProgress <= 0) this.finishFishing(false);
  }

  private syncReelVisuals() {
    const trackH = 160;
    const trackTop = -trackH / 2;
    const yFor = (value: number) => trackTop + (value / 100) * trackH;

    this.reelCursor.y = yFor(this.cursorPosition);
    this.fishMarker.y = yFor(this.fishPosition);

    const fillH = (this.catchProgress / 100) * (trackH - 4);
    this.reelProgressFill.setSize(6, Math.max(2, fillH));
    this.reelProgressFill.setPosition(18, trackTop + trackH);
    this.reelProgressFill.setOrigin(0.5, 1);
  }

  private finishFishing(success: boolean) {
    if (this.phase !== "reeling") return;
    this.phase = "idle";
    this.reelUi.setVisible(false);
    this.updateRodPose();
    this.hintText.setText("Walk to the water's edge, then cast a line.");
    this.touchMove = { x: 0, y: 0 };
    this.cursorVelocity = 0;

    if (!success) {
      this.pendingFish = null;
      this.emit({ type: "fishing", phase: "idle", hint: "The fish got away. Try again." });
      this.emit({ type: "notice", title: "Got away", body: "The line went slack. Cast again when you are ready.", tone: "warn" });
      return;
    }

    const base = this.pendingFish ?? this.pickFish();
    this.pendingFish = null;
    const fish = this.applyCatchQuality(base, this.keptContact);
    this.emit({ type: "catch", fish });
    this.emit({ type: "fishing", phase: "idle", hint: `You caught a ${fish.name}!` });
    const perfectNote = fish.perfect ? " Perfect catch!" : "";
    this.emit({
      type: "notice",
      title: fish.perfect ? `Perfect ${fish.rarity}` : `${fish.rarity} catch`,
      body: `A ${fish.name} (${fish.quality ?? "normal"}) — ${fish.value} coins.${perfectNote}`,
      tone: "good",
    });
  }

  /** Quality from performance; perfect = never lost contact. */
  private applyCatchQuality(base: CatchResult, perfect: boolean): CatchResult {
    let quality: NonNullable<CatchResult["quality"]> = "normal";
    if (perfect) quality = "gold";
    else if (this.catchProgress >= 0) {
      // Mid performance still can roll silver
      const roll = Math.random();
      if (roll > 0.85) quality = "silver";
    }
    if (perfect && base.rarity === "legendary") quality = "iridium";
    else if (perfect && (base.rarity === "rare" || base.rarity === "uncommon")) quality = "gold";

    const mult = quality === "iridium" ? 2 : quality === "gold" ? 1.5 : quality === "silver" ? 1.25 : 1;
    const xpBonus = perfect ? Math.ceil(base.xp * 0.5) : 0;
    return {
      ...base,
      value: Math.round(base.value * mult),
      xp: base.xp + xpBonus,
      quality,
      perfect,
    };
  }

  private pickFish(): CatchResult {
    const pool = getZone(this.zoneId).fishPool;
    const roll = Math.random() * 100;
    const candidates = pool.filter(fish =>
      fish.rarity === "legendary" ? roll < 3 : fish.rarity === "rare" ? roll < 18 : fish.rarity === "uncommon" ? roll < 54 : true,
    );
    return candidates[Math.floor(Math.random() * candidates.length)] ?? pool[0];
  }

  private enterZone(zoneId: ZoneId, announce: boolean) {
    const zone = getZone(zoneId); if (zone.requiredLevel > 1 && zoneId === "moonlit-inlet") { this.emit({ type: "notice", title: "A little later", body: "Moonlit Inlet opens at level 3. Keep practicing at Glasswater Lake.", tone: "warn" }); return; }
    this.zoneId = zoneId; this.phase = "idle"; this.touchMove = { x: 0, y: 0 }; this.activeTimers.forEach(timer => timer.remove(false)); this.activeTimers = [];
    if (this.children.length) { this.drawZone(); this.createPlayer(); this.createHud(); this.setupFollowCamera(); }
    this.zoneText.setText(`${zone.name} · ${zone.subtitle}`); this.emit({ type: "zone", zoneId, zoneName: zone.name, objective: zone.objective }); this.emit({ type: "fishing", phase: "idle", hint: "Walk to the water's edge, then cast a line." });
    if (announce) this.emit({ type: "notice", title: "New fishing spot", body: `${zone.name} is ready for a quiet afternoon of fishing.`, tone: "info" });
  }

  private getNearbyInteraction() { return getZone(this.zoneId).interactions.find(interaction => Phaser.Math.Distance.Between(this.player.x, this.player.y, interaction.x, interaction.y) < 64); }
  private isNearWater(waters: WorldRect[]) { return waters.some(water => { const x = Phaser.Math.Clamp(this.player.x, water.x, water.x + water.width); const y = Phaser.Math.Clamp(this.player.y, water.y, water.y + water.height); return Phaser.Math.Distance.Between(this.player.x, this.player.y, x, y) < 43; }); }
  private updateRodPose() { const angles: Record<Direction, number> = { down: 38, up: 142, left: -62, right: 62 }; this.rod.setAngle(angles[this.facing]); this.rod.setPosition(this.facing === "left" ? -21 : 21, this.facing === "up" ? -16 : -4); }

  private upsertRemotePlayer(state: PublicPlayerState) {
    let remote = this.remotePlayers.get(state.playerId);
    if (!remote) {
      const shadow = this.add.ellipse(0, 14, 34, 12, 0x35463a, 0.45); const boots = this.add.rectangle(0, 8, 18, 18, 0x6e5141).setStrokeStyle(2, INK, 1); const coat = this.add.rectangle(0, -2, 24, 24, 0x7b9b6a).setStrokeStyle(2, INK, 1); const face = this.add.rectangle(0, -18, 18, 15, 0xe8ba84).setStrokeStyle(2, INK, 1); const hat = this.add.rectangle(0, -28, 24, 8, 0x865c4c).setStrokeStyle(2, INK, 1); const rod = this.add.rectangle(22, -10, 4, 36, 0xd3a45d).setOrigin(0.5).setAngle(36);
      const player = this.add.container(state.x, state.y, [shadow, boots, coat, face, hat, rod]); const label = this.add.text(state.x, state.y - 37, state.username, { fontFamily: "monospace", fontSize: "12px", color: CREAM, stroke: "#314338", strokeThickness: 4 }).setOrigin(0.5); remote = { player, label, rod, state }; this.remotePlayers.set(state.playerId, remote);
    }
    remote.state = state; remote.label.setText(state.username);
  }
  private updateRemotePlayer(remote: RemoteAvatar, delta: number) { const amount = Math.min(1, delta / 120); remote.player.x = Phaser.Math.Linear(remote.player.x, remote.state.x, amount); remote.player.y = Phaser.Math.Linear(remote.player.y, remote.state.y, amount); remote.label.setPosition(remote.player.x, remote.player.y - 37); const angles: Record<Direction, number> = { down: 38, up: 142, left: -62, right: 62 }; const fishing = remote.state.state !== "idle"; remote.rod.setAngle(fishing ? (remote.state.direction === "left" ? -72 : 72) : angles[remote.state.direction]); remote.rod.setPosition(remote.state.direction === "left" ? -21 : 21, remote.state.direction === "up" ? -16 : -4); }
  private removeRemotePlayer(playerId: string) { const remote = this.remotePlayers.get(playerId); if (!remote) return; remote.player.destroy(true); remote.label.destroy(); this.remotePlayers.delete(playerId); }
  private addDelay(delay: number, callback: () => void) { this.activeTimers.push(this.time.delayedCall(delay, callback)); }

  /**
   * Stardew-style camera: player stays centered; map scrolls under them.
   * Zoom shows a readable slice of the world (not the whole map at once).
   */
  private setupFollowCamera() {
    const cam = this.cameras.main;
    const w = this.scale.width || 1;
    const h = this.scale.height || 1;
    // Target view size in world pixels — larger on desktop, closer on phone
    const targetView = Math.min(520, Math.max(360, Math.min(w, h) * 0.95));
    const zoom = Math.max(w, h) / targetView;
    // Clamp so we never zoom out past showing the whole world
    const maxZoomOut = Math.min(w / WORLD_WIDTH, h / WORLD_HEIGHT);
    cam.setZoom(Math.max(zoom, maxZoomOut * 1.05));
    cam.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    cam.setRoundPixels(true);
    if (this.player) {
      cam.startFollow(this.player, true, 0.18, 0.18);
      cam.setFollowOffset(0, 24); // bias slightly up so feet/UI don't clip the character
      cam.centerOn(this.player.x, this.player.y);
    }
  }
  private emit(event: GameBridgeEvent) { this.bridge.emit("game-event", event); }
}
