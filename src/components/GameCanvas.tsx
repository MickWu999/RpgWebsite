"use client";

import { useEffect, useRef, type RefObject } from "react";
import type * as PhaserNS from "phaser";
import { TERRAIN, TERRAIN_BASE_FRAME } from "@/game/assets";
import { findNearbyNpc, getScene, npcsInScene, visiblePickups, type PlayerState } from "@/game/engine";
import type { AssetDefinition, GameProject } from "@/game/schema";

/**
 * Phaser 3 渲染層：只依 PlayerState 繪製畫面，不處理遊戲邏輯與鍵盤輸入（輸入由 PlayView 統一處理）。
 */

export const VIEW_WIDTH = 640;
export const VIEW_HEIGHT = 480;
const MOVE_TWEEN_MS = 110;

type SceneApi = { sync: (state: PlayerState) => void; resize: (height: number) => void };
type PhaserModule = typeof PhaserNS;

function createWorldScene(
  Phaser: PhaserModule,
  project: GameProject,
  onReady: (api: SceneApi) => void,
  onTileTap: (x: number, y: number) => void,
  registerClientTap: (fn: (clientX: number, clientY: number) => void) => void,
) {
  const assets = new Map(project.assetManifest.assets.map((a) => [a.id, a]));

  return class WorldScene extends Phaser.Scene {
    private layer!: PhaserNS.GameObjects.Container;
    private player!: PhaserNS.GameObjects.Image | PhaserNS.GameObjects.Arc;
    private npcLabels = new Map<string, PhaserNS.GameObjects.Text>();
    private marker: PhaserNS.GameObjects.Text | null = null;
    private pickupSprites = new Map<string, PhaserNS.GameObjects.GameObject & { setVisible: (v: boolean) => unknown }>();
    private currentSceneId: string | null = null;
    private last: { x: number; y: number } | null = null;

    constructor() {
      super("world");
    }

    preload() {
      const sheets = new Map<string, number>();
      for (const asset of project.assetManifest.assets) {
        if (asset.kind === "audio") continue;
        sheets.set(asset.src, asset.frameSize ?? 16);
      }
      for (const [src, size] of sheets) this.load.spritesheet(src, src, { frameWidth: size, frameHeight: size });
    }

    create() {
      this.layer = this.add.container(0, 0);
      // 供自動化驗證換算點擊座標用
      (window as unknown as { __RPG_CAMERA__?: () => { x: number; y: number } }).__RPG_CAMERA__ = () => ({
        x: this.cameras.main.scrollX,
        y: this.cameras.main.scrollY,
      });
      // 點擊移動：把點擊位置換算成格子座標（外層 CSS 縮放由 Phaser 依畫布實際大小換算）
      this.input.on("pointerup", (pointer: PhaserNS.Input.Pointer) => this.tapWorld(pointer.worldX, pointer.worldY));
      // 被其他圖層（例如手機搖桿區）攔下的點擊，用螢幕座標轉交進來
      registerClientTap((clientX, clientY) => {
        const rect = this.game.canvas.getBoundingClientRect();
        const local = { x: ((clientX - rect.left) * this.scale.width) / rect.width, y: ((clientY - rect.top) * this.scale.height) / rect.height };
        const world = this.cameras.main.getWorldPoint(local.x, local.y);
        this.tapWorld(world.x, world.y);
      });
      onReady({
        sync: (state) => this.sync(state),
        // 手機橫向時畫面高度會依螢幕比例改變，鏡頭範圍要跟著更新
        resize: (height) => {
          this.scale.resize(VIEW_WIDTH, height);
          if (!this.currentSceneId) return;
          const scene = getScene(project, this.currentSceneId);
          const ts = scene.tileSize;
          this.cameras.main.setBounds(0, 0, Math.max(scene.width * ts, VIEW_WIDTH), Math.max(scene.height * ts, height));
        },
      });
    }

    private tapWorld(worldX: number, worldY: number) {
      if (!this.currentSceneId) return;
      const ts = getScene(project, this.currentSceneId).tileSize;
      const x = Math.floor(worldX / ts);
      const y = Math.floor(worldY / ts);
      const flash = this.add.rectangle(x * ts + ts / 2, y * ts + ts / 2, ts, ts, 0xffffff, 0.35);
      this.tweens.add({ targets: flash, alpha: 0, duration: 400, onComplete: () => flash.destroy() });
      onTileTap(x, y);
    }

    private sprite(asset: AssetDefinition | undefined, x: number, y: number, size: number) {
      if (asset && this.textures.exists(asset.src)) {
        return this.add.image(x, y, asset.src, asset.frame ?? 0).setDisplaySize(size, size);
      }
      return null;
    }

    private build(state: PlayerState) {
      const scene = getScene(project, state.sceneId);
      const ts = scene.tileSize;
      this.layer.removeAll(true);
      this.npcLabels.clear();
      this.pickupSprites.clear();
      const tileset = scene.tilesetId ? assets.get(scene.tilesetId) : undefined;
      const useTiles = Boolean(scene.terrain && tileset && this.textures.exists(tileset.src));

      for (let y = 0; y < scene.height; y++) {
        for (let x = 0; x < scene.width; x++) {
          const cx = x * ts + ts / 2;
          const cy = y * ts + ts / 2;
          const def = scene.terrain ? TERRAIN[[...scene.terrain[y]][x]] : undefined;
          if (useTiles && def && tileset) {
            if (def.overlay) this.layer.add(this.add.image(cx, cy, tileset.src, TERRAIN_BASE_FRAME).setDisplaySize(ts, ts));
            this.layer.add(this.add.image(cx, cy, tileset.src, def.frame).setDisplaySize(ts, ts));
          } else {
            const walk = scene.walkable[y]?.[x];
            const color = Phaser.Display.Color.HexStringToColor((walk ? scene.colors?.floor : scene.colors?.wall) ?? (walk ? "#7fa36a" : "#3a4630")).color;
            this.layer.add(this.add.rectangle(cx, cy, ts, ts, color).setStrokeStyle(1, 0x000000, 0.08));
          }
        }
      }

      for (const loc of scene.locations ?? []) {
        const w = (loc.width ?? 1) * ts;
        const h = (loc.height ?? 1) * ts;
        const rect = this.add.rectangle(loc.x * ts + w / 2, loc.y * ts + h / 2, w, h, 0xf2b84b, 0.12).setStrokeStyle(2, 0xf2b84b, 0.5);
        this.layer.add(rect);
      }

      for (const exit of scene.exits) {
        const cx = exit.x * ts + ts / 2;
        const cy = exit.y * ts + ts / 2;
        this.layer.add(this.add.rectangle(cx, cy, ts, ts, 0x6fc3a4, 0.25).setStrokeStyle(2, 0x6fc3a4, 0.8));
        if (exit.label) {
          // 出口通常在地圖邊緣，名牌要夾在地圖範圍內才不會被切掉
          const label = this.label(cx, cy - ts * 0.75, exit.label, "#c9f1e1");
          const half = label.width / 2;
          label.setX(Phaser.Math.Clamp(cx, half, scene.width * ts - half));
          this.layer.add(label);
        }
      }

      for (const pickup of scene.pickups ?? []) {
        const item = project.items.find((i) => i.id === pickup.itemId);
        const cx = pickup.x * ts + ts / 2;
        const cy = pickup.y * ts + ts / 2;
        const obj = this.sprite(item?.iconAssetId ? assets.get(item.iconAssetId) : undefined, cx, cy, ts * 0.8) ?? this.add.star(cx, cy, 5, ts * 0.15, ts * 0.35, 0xf2e05b);
        this.tweens.add({ targets: obj, y: cy - 4, yoyo: true, repeat: -1, duration: 600, ease: "Sine.easeInOut" });
        this.layer.add(obj);
        this.pickupSprites.set(pickup.id, obj);
      }

      for (const npc of npcsInScene(project, scene.id)) {
        const cx = npc.position.x * ts + ts / 2;
        const cy = npc.position.y * ts + ts / 2;
        const obj = this.sprite(npc.spriteAssetId ? assets.get(npc.spriteAssetId) : undefined, cx, cy, ts) ?? this.add.circle(cx, cy, ts * 0.38, 0xd98c5f).setStrokeStyle(2, 0x000000);
        this.layer.add(obj);
        const label = this.label(cx, cy - ts * 0.72, npc.name, "#ffffff");
        this.layer.add(label);
        this.npcLabels.set(npc.id, label);
      }

      const px = state.x * ts + ts / 2;
      const py = state.y * ts + ts / 2;
      this.player =
        this.sprite(project.player.spriteAssetId ? assets.get(project.player.spriteAssetId) : undefined, px, py, ts) ??
        this.add.circle(px, py, ts * 0.38, 0x4b8bf2).setStrokeStyle(2, 0xffffff);
      this.layer.add(this.player);
      // 可以對話的 NPC 頭上顯示跳動的「！」
      this.marker = this.label(0, 0, "！", "#f2b84b").setVisible(false);
      this.layer.add(this.marker);
      this.tweens.add({ targets: this.marker, scale: 1.25, yoyo: true, repeat: -1, duration: 350 });

      const cam = this.cameras.main;
      cam.setBounds(0, 0, Math.max(scene.width * ts, this.scale.width), Math.max(scene.height * ts, this.scale.height));
      cam.startFollow(this.player, true, 0.2, 0.2);
      cam.centerOn(px, py);
      this.currentSceneId = scene.id;
      this.last = { x: state.x, y: state.y };
    }

    private label(x: number, y: number, text: string, color: string) {
      return this.add
        .text(x, y, text, {
          fontFamily: '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif',
          fontSize: "13px",
          color,
          backgroundColor: "#00000099",
          padding: { x: 4, y: 1 },
        })
        .setOrigin(0.5, 1)
        .setResolution(2);
    }

    sync(state: PlayerState) {
      if (!this.layer) return;
      if (state.sceneId !== this.currentSceneId) this.build(state);
      const scene = getScene(project, state.sceneId);
      const ts = scene.tileSize;
      const tx = state.x * ts + ts / 2;
      const ty = state.y * ts + ts / 2;
      if (this.last && (this.last.x !== state.x || this.last.y !== state.y)) {
        const adjacent = Math.abs(this.last.x - state.x) + Math.abs(this.last.y - state.y) === 1;
        this.tweens.killTweensOf(this.player);
        if (adjacent) this.tweens.add({ targets: this.player, x: tx, y: ty, duration: MOVE_TWEEN_MS });
        else this.player.setPosition(tx, ty);
      }
      this.last = { x: state.x, y: state.y };
      if ("setFlipX" in this.player) {
        if (state.facing === "left") this.player.setFlipX(true);
        if (state.facing === "right") this.player.setFlipX(false);
      }

      const visible = new Set(visiblePickups(project, state).map((p) => p.id));
      for (const [id, obj] of this.pickupSprites) obj.setVisible(visible.has(id));

      const nearby = state.dialogue || state.endingId ? null : findNearbyNpc(project, state);
      for (const [id, label] of this.npcLabels) label.setColor(nearby?.id === id ? "#f2b84b" : "#ffffff");
      if (this.marker) {
        this.marker.setVisible(Boolean(nearby));
        if (nearby) this.marker.setPosition(nearby.position.x * ts + ts / 2, nearby.position.y * ts - ts * 0.7);
      }
    }
  };
}

export default function GameCanvas({
  project,
  state,
  viewHeight = VIEW_HEIGHT,
  onTileTap,
  clientTapRef,
}: {
  project: GameProject;
  state: PlayerState;
  viewHeight?: number;
  onTileTap?: (x: number, y: number) => void;
  /** 由畫面提供：把螢幕座標的點擊轉成地圖點擊 */
  clientTapRef?: RefObject<((clientX: number, clientY: number) => void) | null>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<SceneApi | null>(null);
  const stateRef = useRef(state);
  const tapRef = useRef(onTileTap);
  const heightRef = useRef(viewHeight);

  useEffect(() => {
    heightRef.current = viewHeight;
    apiRef.current?.resize(viewHeight);
  }, [viewHeight]);

  useEffect(() => {
    tapRef.current = onTileTap;
  }, [onTileTap]);

  useEffect(() => {
    stateRef.current = state;
    apiRef.current?.sync(state);
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    let game: PhaserNS.Game | null = null;
    import("phaser").then((mod) => {
      const Phaser = ((mod as unknown as { default?: PhaserModule }).default ?? mod) as PhaserModule;
      if (cancelled || !hostRef.current) return;
      const Scene = createWorldScene(
        Phaser,
        project,
        (api) => {
          apiRef.current = api;
          api.resize(heightRef.current);
          api.sync(stateRef.current);
        },
        (x, y) => tapRef.current?.(x, y),
        (fn) => {
          if (clientTapRef) clientTapRef.current = fn;
        },
      );
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        width: VIEW_WIDTH,
        height: VIEW_HEIGHT,
        pixelArt: true,
        backgroundColor: "#0b0c12",
        banner: false,
        input: { keyboard: false },
        // 外層 .rm-screen 已用 CSS 等比縮放，Phaser 維持固定的邏輯解析度
        scale: { mode: Phaser.Scale.NONE },
        scene: Scene,
      });
    });
    return () => {
      cancelled = true;
      apiRef.current = null;
      game?.destroy(true);
    };
  }, [project, clientTapRef]);

  return <div ref={hostRef} className="game-canvas-host" data-testid="game-canvas" />;
}
