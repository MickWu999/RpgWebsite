"use client";

import { useEffect, useRef, type RefObject } from "react";
import type * as PhaserNS from "phaser";
import { TERRAIN, terrainSheet, terrainUnder } from "@/game/assets";
import { facedTile, getMap, isBusy, visibleEvents, type PlayerState } from "@/game/engine";
import type { AssetDefinition, GameProject, MapDefinition } from "@/game/schema";

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
    private marker: PhaserNS.GameObjects.Text | null = null;
    /** 人物名牌：玩家走近（2 格內）才顯示，避免滿地名字像 MMO */
    private nameLabels: Array<{ label: PhaserNS.GameObjects.Text; x: number; y: number }> = [];
    /** 目前畫面上的地圖與事件外觀；改變時重畫 */
    private signature: string | null = null;
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
      // 地形用到的圖塊表（村莊、城市、室內）
      for (const map of project.maps) for (const ch of new Set(map.terrain.join(""))) if (TERRAIN[ch]) sheets.set(terrainSheet(TERRAIN[ch]), 16);
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
          this.fitCamera(getMap(project, this.currentSceneId));
        },
      });
    }

    private tapWorld(worldX: number, worldY: number) {
      if (!this.currentSceneId) return;
      const ts = getMap(project, this.currentSceneId).tileSize;
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

    /** 地圖與事件外觀的指紋：換地圖、事件頁切換（例如寶箱打開、NPC 出現）時重畫 */
    private signatureOf(state: PlayerState) {
      return `${state.mapId}|${visibleEvents(project, state)
        .map((v) => `${v.event.id}:${v.index}:${v.page.graphic?.assetId ?? ""}`)
        .join(",")}`;
    }

    private build(state: PlayerState) {
      const scene = getMap(project, state.mapId);
      const ts = scene.tileSize;
      this.layer.removeAll(true);
      this.nameLabels = [];

      for (let y = 0; y < scene.height; y++) {
        for (let x = 0; x < scene.width; x++) {
          const cx = x * ts + ts / 2;
          const cy = y * ts + ts / 2;
          const def = TERRAIN[[...scene.terrain[y]][x]];
          if (def && this.textures.exists(terrainSheet(def))) {
            if (def.overlay) {
              const under = terrainUnder(def);
              this.layer.add(this.add.image(cx, cy, terrainSheet(under), under.frame).setDisplaySize(ts, ts));
            }
            this.layer.add(this.add.image(cx, cy, terrainSheet(def), def.frame).setDisplaySize(ts, ts));
          } else {
            const color = scene.walkable[y]?.[x] ? 0x7fa36a : 0x3a4630;
            this.layer.add(this.add.rectangle(cx, cy, ts, ts, color).setStrokeStyle(1, 0x000000, 0.08));
          }
        }
      }

      for (const { event, page } of visibleEvents(project, state)) {
        const cx = event.x * ts + ts / 2;
        const cy = event.y * ts + ts / 2;
        // 場所移動（接觸觸發、第一個指令是場所移動）：畫成出入口標記並顯示事件名稱
        if (page.trigger === "touch" && page.commands.some((c) => c.code === "transfer") && !page.graphic) {
          this.layer.add(this.add.rectangle(cx, cy, ts, ts, 0x6fc3a4, 0.25).setStrokeStyle(2, 0x6fc3a4, 0.8));
          const label = this.label(cx, cy - ts * 0.75, event.name, "#c9f1e1");
          const half = label.width / 2;
          label.setX(Phaser.Math.Clamp(cx, half, scene.width * ts - half));
          this.layer.add(label);
          continue;
        }
        if (!page.graphic) continue;
        const asset = assets.get(page.graphic.assetId);
        const isCharacter = asset?.kind === "character";
        const obj = this.sprite(asset, cx, cy, isCharacter ? ts : ts * 0.8) ?? this.add.circle(cx, cy, ts * 0.38, 0xd98c5f).setStrokeStyle(2, 0x000000);
        if (page.priority === "below" && !isCharacter) this.tweens.add({ targets: obj, y: cy - 4, yoyo: true, repeat: -1, duration: 600, ease: "Sine.easeInOut" });
        if (page.graphic.direction === "left" && "setFlipX" in obj) obj.setFlipX(true);
        this.layer.add(obj);
        if (isCharacter) {
          const label = this.label(cx, cy - ts * 0.72, event.name, "#ffffff");
          this.nameLabels.push({ label, x: event.x, y: event.y });
          this.layer.add(label);
        }
      }

      const px = state.x * ts + ts / 2;
      const py = state.y * ts + ts / 2;
      this.player =
        this.sprite(assets.get(project.actors.find((a) => a.id === project.system.playerActorId)?.spriteAssetId ?? ""), px, py, ts) ??
        this.add.circle(px, py, ts * 0.38, 0x4b8bf2).setStrokeStyle(2, 0xffffff);
      this.layer.add(this.player);
      // 面前有可以按確定鍵的事件時，頭上顯示跳動的「！」
      this.marker = this.label(0, 0, "！", "#f2b84b").setVisible(false);
      this.layer.add(this.marker);
      this.tweens.add({ targets: this.marker, scale: 1.25, yoyo: true, repeat: -1, duration: 350 });

      const cam = this.cameras.main;
      this.fitCamera(scene);
      cam.startFollow(this.player, true, 0.2, 0.2);
      cam.centerOn(px, py);
      for (const n of this.nameLabels) n.label.setVisible(Math.abs(n.x - state.x) + Math.abs(n.y - state.y) <= 2);
      this.currentSceneId = scene.id;
      this.signature = this.signatureOf(state);
      this.last = { x: state.x, y: state.y };
    }

    /** 地圖比畫面小（例如室內小房間）時放大（最多 1.5 倍）並置中，手機上才不會小小一塊擠在角落；畫面高度改變時重新計算 */
    private fitCamera(scene: MapDefinition) {
      const cam = this.cameras.main;
      const mw = scene.width * scene.tileSize;
      const mh = scene.height * scene.tileSize;
      const zoom = Math.max(1, Math.min(1.5, this.scale.width / mw, this.scale.height / mh));
      cam.setZoom(zoom);
      const vw = this.scale.width / zoom;
      const vh = this.scale.height / zoom;
      cam.setBounds(mw < vw ? (mw - vw) / 2 : 0, mh < vh ? (mh - vh) / 2 : 0, Math.max(mw, vw), Math.max(mh, vh));
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
      const mapChanged = state.mapId !== this.currentSceneId;
      if (mapChanged || this.signatureOf(state) !== this.signature) {
        const keep = !mapChanged && this.last ? { ...this.last } : null;
        this.build(keep ? { ...state, ...keep } : state);
      }
      const scene = getMap(project, state.mapId);
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
      for (const n of this.nameLabels) n.label.setVisible(Math.abs(n.x - state.x) + Math.abs(n.y - state.y) <= 2);
      if ("setFlipX" in this.player) {
        if (state.facing === "left") this.player.setFlipX(true);
        if (state.facing === "right") this.player.setFlipX(false);
      }
      // 「！」提示：面前的同層事件或腳下的事件可以按確定鍵
      const front = facedTile(state);
      const target = isBusy(state)
        ? null
        : visibleEvents(project, state).find(
            (v) =>
              v.page.trigger === "action" &&
              v.page.commands.length > 0 &&
              ((v.page.priority === "same" && v.event.x === front.x && v.event.y === front.y) || (v.page.priority !== "same" && v.event.x === state.x && v.event.y === state.y)),
          )?.event;
      if (this.marker) {
        this.marker.setVisible(Boolean(target));
        if (target) this.marker.setPosition(target.x * ts + ts / 2, target.y * ts - ts * 0.15);
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
