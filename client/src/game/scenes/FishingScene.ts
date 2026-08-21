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
const SCALLYWAG_ISLANDS = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663905510199/pNSAFEGYjVYiOnJg.png";

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
  private touchMove = { x: 0, y: 0 };
  private remotePlayers = new Map<string, RemoteAvatar>();

  constructor(bridge: Phaser.Events.EventEmitter) { super({ key: "FishingScene" }); this.bridge = bridge; }

  preload() {
    if (!this.textures.exists("scallywag-islands")) this.load.image("scallywag-islands", SCALLYWAG_ISLANDS);
  }

  create() {
    this.controls = this.input.keyboard?.addKeys({ up: Phaser.Input.Keyboard.KeyCodes.W, down: Phaser.Input.Keyboard.KeyCodes.S, left: Phaser.Input.Keyboard.KeyCodes.A, right: Phaser.Input.Keyboard.KeyCodes.D, arrowUp: Phaser.Input.Keyboard.KeyCodes.UP, arrowDown: Phaser.Input.Keyboard.KeyCodes.DOWN, arrowLeft: Phaser.Input.Keyboard.KeyCodes.LEFT, arrowRight: Phaser.Input.Keyboard.KeyCodes.RIGHT, interact: Phaser.Input.Keyboard.KeyCodes.F, cast: Phaser.Input.Keyboard.KeyCodes.SPACE }) as Controls;
    this.bridge.on("game-command", this.handleCommand, this);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setRoundPixels(true);
    this.fitCameraToWorld();
    this.scale.on("resize", this.fitCameraToWorld, this);
    this.drawZone(); this.createPlayer(); this.createHud(); this.enterZone(this.zoneId, false);
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
    if (Phaser.Input.Keyboard.JustDown(this.controls.cast)) this.startFishing();
    if (this.phase === "reeling") this.updateReeling(delta);
    this.remotePlayers.forEach(remote => this.updateRemotePlayer(remote, delta));
    this.emit({ type: "position", x: this.player.x, y: this.player.y, direction: this.facing, moving });
  }

  private handleCommand(command: GameCommand) {
    if (command.type === "cast") this.startFishing();
    if (command.type === "interact") this.interact();
    if (command.type === "move") this.touchMove = normalizeMovement(command.x, command.y);
    if (command.type === "travel") this.enterZone(command.zoneId, true);
    if (command.type === "set-display-name") { this.name = command.name.slice(0, 18) || "Guest Angler"; this.playerLabel.setText(this.name); }
    if (command.type === "remote-player") this.upsertRemotePlayer(command.player);
    if (command.type === "remove-remote-player") this.removeRemotePlayer(command.playerId);
  }

  private drawZone() {
    this.remotePlayers.clear(); this.children.removeAll();
    const zone = getZone(this.zoneId);
    const usesScallywagMap = zone.id !== "moonlit-inlet" && this.textures.exists("scallywag-islands");
    if (usesScallywagMap) {
      this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, "scallywag-islands").setDisplaySize(WORLD_WIDTH, WORLD_HEIGHT).setOrigin(0.5);
    } else {
      this.add.rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, zone.palette.ground).setOrigin(0.5);
      for (let x = 12; x < WORLD_WIDTH; x += 24) for (let y = 16; y < WORLD_HEIGHT; y += 24) {
        const color = (x / 24 + y / 24) % 3 === 0 ? 0xaec381 : (x / 24 + y / 24) % 2 === 0 ? 0x74935d : 0x8fa86c;
        this.add.rectangle(x, y, 4, 3, color, 0.58).setOrigin(0.5);
      }
      zone.water.forEach(water => this.drawWater(water, zone.palette.water, zone.palette.glow));
      this.drawBoardwalk(96, 488, 764, zone.palette.path);
      this.drawBoardwalk(334, 320, 240, zone.palette.path);
    }
    this.drawProps(zone.interactions, zone.palette.accent, zone.palette.glow, !usesScallywagMap);
  }

  private drawBoardwalk(x: number, y: number, width: number, color: number) {
    this.add.rectangle(x + width / 2, y, width, 28, 0x76513c).setStrokeStyle(2, INK, 0.7);
    for (let plank = x + 4; plank < x + width; plank += 26) this.add.rectangle(plank + 10, y, 22, 22, color).setStrokeStyle(1, 0x634633, 0.6);
  }

  private drawWater(water: WorldRect, waterColor: number, shore: number) {
    this.add.rectangle(water.x + water.width / 2, water.y + water.height / 2, water.width + 12, water.height + 12, 0x426553).setOrigin(0.5);
    this.add.rectangle(water.x + water.width / 2, water.y + water.height / 2, water.width, water.height, waterColor).setOrigin(0.5).setStrokeStyle(2, shore, 0.92);
    for (let x = water.x + 20; x < water.x + water.width - 10; x += 42) for (let y = water.y + 18; y < water.y + water.height - 8; y += 34) {
      const wave = this.add.rectangle(x, y, 14, 3, shore, 0.48).setOrigin(0.5);
      this.tweens.add({ targets: wave, x: x + 8, alpha: 0.16, duration: 1500, yoyo: true, repeat: -1, delay: (x + y) % 700 });
    }
  }

  private drawProps(interactions: WorldInteraction[], accent: number, shore: number, addTrees: boolean) {
    if (addTrees) for (let x = 64; x < WORLD_WIDTH; x += 142) this.drawTree(x, 428 - ((x / 36) % 3) * 25, accent);
    interactions.forEach(interaction => {
      if (interaction.kind === "shop") this.drawCabin(interaction.x, interaction.y, accent);
      else if (interaction.kind === "storage") this.drawChest(interaction.x, interaction.y, accent);
      else this.drawSignpost(interaction.x, interaction.y, shore);
      const label = this.add.text(interaction.x, interaction.y + 47, interaction.label, { fontFamily: "monospace", fontSize: "10px", color: CREAM, stroke: "#314338", strokeThickness: 3, align: "center" }).setOrigin(0.5);
      label.setShadow(1, 1, "#314338", 1);
    });
  }

  private drawTree(x: number, y: number, leafColor: number) {
    this.add.rectangle(x, y + 14, 10, 30, 0x66432d).setStrokeStyle(2, INK, 0.7);
    this.add.rectangle(x, y - 14, 34, 28, leafColor).setStrokeStyle(2, INK, 0.75);
    this.add.rectangle(x - 16, y - 4, 18, 22, 0x5f8050).setStrokeStyle(2, INK, 0.65);
    this.add.rectangle(x + 16, y - 2, 18, 24, 0x6f925a).setStrokeStyle(2, INK, 0.65);
    this.add.rectangle(x - 4, y - 25, 22, 13, 0xa8c77b).setStrokeStyle(2, INK, 0.65);
  }

  private drawCabin(x: number, y: number, accent: number) {
    this.add.rectangle(x, y, 80, 48, 0x9b6041).setStrokeStyle(3, INK, 0.9);
    this.add.triangle(x, y - 46, -48, 24, 0, -28, 48, 24, 0x6e4050).setStrokeStyle(3, INK, 0.9);
    this.add.rectangle(x + 17, y + 11, 16, 24, 0x594032).setStrokeStyle(2, INK, 0.9);
    this.add.rectangle(x - 18, y - 3, 18, 14, accent).setStrokeStyle(2, INK, 0.8);
  }

  private drawChest(x: number, y: number, accent: number) {
    this.add.rectangle(x, y, 44, 30, 0x9a603c).setStrokeStyle(3, INK, 0.9);
    this.add.rectangle(x, y - 12, 44, 10, 0xc6884e).setStrokeStyle(2, INK, 0.75);
    this.add.rectangle(x, y + 2, 7, 8, accent).setStrokeStyle(1, INK, 0.8);
  }

  private drawSignpost(x: number, y: number, color: number) {
    this.add.rectangle(x, y + 8, 8, 38, 0x714b32).setStrokeStyle(2, INK, 0.8);
    this.add.rectangle(x, y - 10, 34, 16, color).setStrokeStyle(2, INK, 0.8);
  }

  private createPlayer() {
    const zone = getZone(this.zoneId); this.player = this.add.container(zone.spawn.x, zone.spawn.y);
    const shadow = this.add.ellipse(0, 14, 34, 12, 0x35463a, 0.48);
    const boots = this.add.rectangle(0, 9, 18, 18, 0x5a463c).setStrokeStyle(2, INK, 1);
    const coat = this.add.rectangle(0, -2, 24, 24, 0xd8784f).setStrokeStyle(2, INK, 1);
    const face = this.add.rectangle(0, -18, 18, 15, 0xf0bd82).setStrokeStyle(2, INK, 1);
    const hat = this.add.rectangle(0, -28, 26, 8, 0x476b5b).setStrokeStyle(2, INK, 1);
    this.rod = this.add.rectangle(22, -10, 4, 36, 0xd3a45d).setOrigin(0.5).setAngle(36);
    this.player.add([shadow, boots, coat, face, hat, this.rod]);
    this.playerLabel = this.add.text(zone.spawn.x, zone.spawn.y - 37, this.name, { fontFamily: "monospace", fontSize: "12px", color: CREAM, stroke: "#314338", strokeThickness: 4 }).setOrigin(0.5);
    this.updateRodPose();
  }

  private createHud() {
    this.zoneText = this.add.text(16, 15, "", { fontFamily: "monospace", fontSize: "13px", color: CREAM, stroke: "#314338", strokeThickness: 4 }).setScrollFactor(0);
    this.hintText = this.add.text(16, 510, "Walk to the water's edge, then cast a line.", { fontFamily: "monospace", fontSize: "11px", color: "#e8e2bd", stroke: "#314338", strokeThickness: 4 }).setScrollFactor(0);
    this.createReelUi();
  }

  private createReelUi() {
    this.reelUi = this.add.container(710, 54).setScrollFactor(0).setVisible(false);
    const frame = this.add.rectangle(0, 0, 210, 132, 0x34483f, 0.96).setStrokeStyle(3, 0xe8d49a, 1);
    const track = this.add.rectangle(0, 16, 170, 16, 0x607364).setStrokeStyle(2, 0xe8d49a, 1);
    this.reelCursor = this.add.rectangle(0, 16, 38, 23, 0xd59650, 0.9).setStrokeStyle(2, INK, 1);
    this.fishMarker = this.add.rectangle(0, 16, 12, 28, 0xc45f54).setStrokeStyle(2, CREAM === "#fff5d8" ? 0xfff5d8 : 0xffffff, 0.86);
    this.reelProgressText = this.add.text(0, -43, "KEEP THE FISH CLOSE", { fontFamily: "monospace", fontSize: "13px", color: CREAM }).setOrigin(0.5);
    const hint = this.add.text(0, 46, "USE ↑ ↓ OR THE PAD", { fontFamily: "monospace", fontSize: "10px", color: "#e8d49a" }).setOrigin(0.5);
    this.reelUi.add([frame, track, this.reelCursor, this.fishMarker, this.reelProgressText, hint]);
  }

  private interact() {
    if (this.phase !== "idle") return;
    const interaction = this.getNearbyInteraction();
    if (!interaction) { this.emit({ type: "notice", title: "Nothing nearby", body: "Walk up to a sign, chest, or the tackle hut.", tone: "info" }); return; }
    if (interaction.kind === "portal" && interaction.target) { this.emit({ type: "interaction", panel: "travel", zoneId: interaction.target }); return; }
    this.emit({ type: "interaction", panel: interaction.kind === "shop" ? "shop" : "storage" });
  }

  private startFishing() {
    if (this.phase !== "idle") return;
    if (!this.isNearWater(getZone(this.zoneId).water)) { this.emit({ type: "notice", title: "Find the water", body: "Stand by the shoreline before you cast.", tone: "warn" }); return; }
    this.phase = "casting"; this.rod.setAngle(this.facing === "left" ? -72 : 72);
    this.emit({ type: "spend", stamina: 7, durability: 1 }); this.emit({ type: "fishing", phase: "casting", hint: "Casting a little line…" }); this.hintText.setText("Casting a little line…");
    this.addDelay(500, () => { this.phase = "waiting"; this.emit({ type: "fishing", phase: "waiting", hint: "Listen for a tug on the line…" }); this.hintText.setText("Waiting for a nibble…"); this.addDelay(1500 + Math.floor(Math.random() * 1800), () => this.beginReel()); });
  }

  private beginReel() {
    if (this.phase !== "waiting") return;
    this.phase = "reeling"; this.catchProgress = 38; this.fishPosition = 46 + Math.random() * 16; this.cursorPosition = 50; this.fishVelocity = Math.random() > 0.5 ? 44 : -44;
    this.reelUi.setVisible(true); this.emit({ type: "fishing", phase: "reeling", hint: "Keep the fish inside your wooden reel window." }); this.emit({ type: "notice", title: "A bite!", body: "Follow the fish with the up and down controls.", tone: "good" }); this.hintText.setText("Reel gently — keep close to the fish!");
  }

  private updateReeling(delta: number) {
    const seconds = delta / 1000;
    const keyboard = (this.controls.up.isDown || this.controls.arrowUp.isDown ? -1 : 0) + (this.controls.down.isDown || this.controls.arrowDown.isDown ? 1 : 0);
    this.cursorPosition = Phaser.Math.Clamp(this.cursorPosition + (keyboard + this.touchMove.y) * 66 * seconds, 4, 96);
    this.fishPosition += this.fishVelocity * seconds; if (this.fishPosition > 96 || this.fishPosition < 4) this.fishVelocity *= -1;
    this.fishVelocity = Phaser.Math.Clamp(this.fishVelocity + Math.sin(this.time.now / 180) * 8 * seconds, -76, 76);
    const aligned = Math.abs(this.cursorPosition - this.fishPosition) < 14;
    this.catchProgress = Phaser.Math.Clamp(this.catchProgress + (aligned ? 28 : -18) * seconds, 0, 100);
    const trackX = (value: number) => -85 + value * 1.7; this.reelCursor.x = trackX(this.cursorPosition); this.fishMarker.x = trackX(this.fishPosition); this.reelProgressText.setText(`CATCH ${Math.round(this.catchProgress)}%`);
    if (this.catchProgress >= 100) this.finishFishing(true); if (this.catchProgress <= 0) this.finishFishing(false);
  }

  private finishFishing(success: boolean) {
    if (this.phase !== "reeling") return;
    this.phase = "idle"; this.reelUi.setVisible(false); this.updateRodPose(); this.hintText.setText("Walk to the water's edge, then cast a line.");
    if (!success) { this.emit({ type: "fishing", phase: "idle", hint: "The fish slipped away. Try again when you are ready." }); this.emit({ type: "notice", title: "The fish escaped", body: "No rush — cast again when the water feels right.", tone: "warn" }); return; }
    const fish = this.pickFish(); this.emit({ type: "catch", fish }); this.emit({ type: "fishing", phase: "idle", hint: `You caught a ${fish.name}!` }); this.emit({ type: "notice", title: `${fish.rarity} catch`, body: `A ${fish.name} will sell for ${fish.value} coins.`, tone: "good" });
  }

  private pickFish(): CatchResult { const pool = getZone(this.zoneId).fishPool; const roll = Math.random() * 100; const candidates = pool.filter(fish => fish.rarity === "legendary" ? roll < 3 : fish.rarity === "rare" ? roll < 18 : fish.rarity === "uncommon" ? roll < 54 : true); return candidates[Math.floor(Math.random() * candidates.length)] ?? pool[0]; }

  private enterZone(zoneId: ZoneId, announce: boolean) {
    const zone = getZone(zoneId); if (zone.requiredLevel > 1 && zoneId === "moonlit-inlet") { this.emit({ type: "notice", title: "A little later", body: "Moonlit Inlet opens at level 3. Keep practicing at Glasswater Lake.", tone: "warn" }); return; }
    this.zoneId = zoneId; this.phase = "idle"; this.touchMove = { x: 0, y: 0 }; this.activeTimers.forEach(timer => timer.remove(false)); this.activeTimers = [];
    if (this.children.length) { this.drawZone(); this.createPlayer(); this.createHud(); }
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

  /** Fill the canvas with the world (cover) so there is no empty letterbox. */
  private fitCameraToWorld() {
    const w = this.scale.width;
    const h = this.scale.height;
    if (!w || !h) return;
    const zoom = Math.max(w / WORLD_WIDTH, h / WORLD_HEIGHT);
    this.cameras.main.setZoom(zoom);
    this.cameras.main.centerOn(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
  }
  private emit(event: GameBridgeEvent) { this.bridge.emit("game-event", event); }
}
