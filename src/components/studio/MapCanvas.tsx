"use client";

import { useEffect, useRef, useState } from "react";
import { TERRAIN, TERRAIN_BASE_FRAME } from "@/game/assets";
import type { GameProject, SceneDefinition } from "@/game/schema";

/**
 * Studio 地圖畫布（RPG Maker 式）：
 * - 地圖模式：按住拖曳繪製地形（放開時才送出一筆 scene.paint 操作，方便復原）
 * - 事件模式：點格子選取、雙擊空格新增事件
 * 畫面上同時顯示 NPC、調查點、撿取物、出口、地點與玩家起點。
 */

const SHEET_COLUMNS = 12;
const images = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string) {
  let p = images.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
    images.set(src, p);
  }
  return p;
}

export type MapMode = "map" | "event";

export default function MapCanvas({
  project,
  scene,
  mode,
  zoom,
  selected,
  preview,
  onPaint,
  onPaintEnd,
  onSelect,
  onCreate,
}: {
  project: GameProject;
  scene: SceneDefinition;
  mode: MapMode;
  zoom: number;
  selected: { x: number; y: number } | null;
  /** 拖曳中尚未送出的繪製（key = "x,y"） */
  preview: Map<string, string>;
  onPaint: (x: number, y: number) => void;
  onPaintEnd: () => void;
  onSelect: (x: number, y: number) => void;
  onCreate: (x: number, y: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painting = useRef(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const ts = zoom;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const draw = async () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = scene.width * ts;
      canvas.height = scene.height * ts;
      ctx.imageSmoothingEnabled = false;
      const tileset = project.assetManifest.assets.find((a) => a.id === scene.tilesetId);
      const sheet = tileset ? await loadImage(tileset.src).catch(() => null) : null;
      if (cancelled) return;
      const frame = (img: HTMLImageElement, f: number, size: number, x: number, y: number, w = ts, h = ts) =>
        ctx.drawImage(img, (f % SHEET_COLUMNS) * size, Math.floor(f / SHEET_COLUMNS) * size, size, size, x, y, w, h);

      // 地形
      for (let y = 0; y < scene.height; y++) {
        const row = [...(scene.terrain?.[y] ?? "")];
        for (let x = 0; x < scene.width; x++) {
          const ch = preview.get(`${x},${y}`) ?? row[x];
          const def = ch ? TERRAIN[ch] : undefined;
          if (sheet && def) {
            if (def.overlay) frame(sheet, TERRAIN_BASE_FRAME, 16, x * ts, y * ts);
            frame(sheet, def.frame, 16, x * ts, y * ts);
          } else {
            ctx.fillStyle = scene.walkable[y]?.[x] ? "#7fa36a" : "#3a4630";
            ctx.fillRect(x * ts, y * ts, ts, ts);
          }
        }
      }

      // 格線（地圖模式較明顯）
      ctx.strokeStyle = mode === "map" ? "rgba(0,0,0,0.18)" : "rgba(0,0,0,0.08)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= scene.width; x++) {
        ctx.beginPath();
        ctx.moveTo(x * ts + 0.5, 0);
        ctx.lineTo(x * ts + 0.5, scene.height * ts);
        ctx.stroke();
      }
      for (let y = 0; y <= scene.height; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * ts + 0.5);
        ctx.lineTo(scene.width * ts, y * ts + 0.5);
        ctx.stroke();
      }

      const dim = mode === "map" ? 0.55 : 1;
      ctx.globalAlpha = dim;
      for (const loc of scene.locations ?? []) {
        ctx.fillStyle = "rgba(242,184,75,0.22)";
        ctx.fillRect(loc.x * ts, loc.y * ts, (loc.width ?? 1) * ts, (loc.height ?? 1) * ts);
        ctx.strokeStyle = "#f2b84b";
        ctx.strokeRect(loc.x * ts + 1, loc.y * ts + 1, (loc.width ?? 1) * ts - 2, (loc.height ?? 1) * ts - 2);
      }
      for (const exit of scene.exits) {
        ctx.fillStyle = "rgba(111,195,164,0.45)";
        ctx.fillRect(exit.x * ts, exit.y * ts, ts, ts);
        ctx.fillStyle = "#fff";
        ctx.font = `${Math.round(ts * 0.5)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("⇄", exit.x * ts + ts / 2, exit.y * ts + ts / 2);
      }
      const sprite = async (assetId: string | undefined, x: number, y: number) => {
        const a = project.assetManifest.assets.find((x) => x.id === assetId);
        if (!a || a.frame === undefined) return false;
        const img = await loadImage(a.src).catch(() => null);
        if (!img || cancelled) return false;
        frame(img, a.frame, a.frameSize ?? 16, x * ts, y * ts);
        return true;
      };
      for (const pk of scene.pickups ?? []) {
        const item = project.items.find((i) => i.id === pk.itemId);
        if (!(await sprite(item?.iconAssetId, pk.x, pk.y))) {
          ctx.fillStyle = "#f2e05b";
          ctx.fillRect(pk.x * ts + ts / 4, pk.y * ts + ts / 4, ts / 2, ts / 2);
        }
      }
      for (const o of scene.interactables ?? []) {
        ctx.strokeStyle = "#ff7ad9";
        ctx.lineWidth = 2;
        ctx.strokeRect(o.x * ts + 2, o.y * ts + 2, ts - 4, ts - 4);
        ctx.fillStyle = "#ff7ad9";
        ctx.font = `bold ${Math.round(ts * 0.45)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("！", o.x * ts + ts / 2, o.y * ts + ts / 2);
      }
      for (const npc of project.npcs.filter((n) => n.sceneId === scene.id)) {
        if (!(await sprite(npc.spriteAssetId, npc.position.x, npc.position.y))) {
          ctx.fillStyle = "#d98c5f";
          ctx.beginPath();
          ctx.arc(npc.position.x * ts + ts / 2, npc.position.y * ts + ts / 2, ts * 0.35, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      const start = project.player.startPosition;
      if (start.sceneId === scene.id) {
        await sprite(project.player.spriteAssetId, start.x, start.y);
        ctx.fillStyle = "#4b8bf2";
        ctx.fillRect(start.x * ts, start.y * ts, ts * 0.4, ts * 0.4);
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${Math.round(ts * 0.3)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("S", start.x * ts + ts * 0.2, start.y * ts + ts * 0.2);
      }
      ctx.globalAlpha = 1;

      const box = (c: { x: number; y: number } | null, color: string) => {
        if (!c) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(c.x * ts + 1, c.y * ts + 1, ts - 2, ts - 2);
      };
      box(hover, "rgba(255,255,255,0.8)");
      box(mode === "event" ? selected : null, "#f2b84b");
    };
    void draw();
    return () => {
      cancelled = true;
    };
  }, [project, scene, mode, ts, selected, preview, hover]);

  const cellOf = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * scene.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * scene.height);
    return x >= 0 && y >= 0 && x < scene.width && y < scene.height ? { x, y } : null;
  };

  return (
    <canvas
      ref={canvasRef}
      className={`studio-canvas mode-${mode}`}
      data-testid="map-canvas"
      style={{ width: scene.width * ts, height: scene.height * ts }}
      onPointerDown={(e) => {
        const c = cellOf(e);
        if (!c) return;
        if (mode === "map") {
          painting.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          onPaint(c.x, c.y);
        } else onSelect(c.x, c.y);
      }}
      onPointerMove={(e) => {
        const c = cellOf(e);
        setHover(c);
        if (painting.current && c) onPaint(c.x, c.y);
      }}
      onPointerUp={() => {
        if (painting.current) {
          painting.current = false;
          onPaintEnd();
        }
      }}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={(e) => {
        const c = cellOf(e);
        if (c && mode === "event") onCreate(c.x, c.y);
      }}
    />
  );
}

/** 圖塊調色盤：直接從圖塊表裁出每種地形的樣子 */
export function TilePalette({ tilesetSrc, value, onChange }: { tilesetSrc: string; value: string; onChange: (ch: string) => void }) {
  return (
    <div className="tile-palette" data-testid="tile-palette">
      {Object.entries(TERRAIN).map(([ch, def]) => (
        <button
          key={ch}
          className={`tile-swatch${ch === value ? " active" : ""}`}
          title={`${def.name}（${ch}）${def.walkable ? "" : "・不可通行"}`}
          data-tile={ch}
          onClick={() => onChange(ch)}
        >
          <span
            className="tile-img"
            style={{
              backgroundImage: def.overlay ? `url(${tilesetSrc}), url(${tilesetSrc})` : `url(${tilesetSrc})`,
              backgroundPosition: def.overlay
                ? `-${(def.frame % SHEET_COLUMNS) * 32}px -${Math.floor(def.frame / SHEET_COLUMNS) * 32}px, -${(TERRAIN_BASE_FRAME % SHEET_COLUMNS) * 32}px -${Math.floor(TERRAIN_BASE_FRAME / SHEET_COLUMNS) * 32}px`
                : `-${(def.frame % SHEET_COLUMNS) * 32}px -${Math.floor(def.frame / SHEET_COLUMNS) * 32}px`,
              backgroundSize: def.overlay ? `${SHEET_COLUMNS * 32}px auto, ${SHEET_COLUMNS * 32}px auto` : `${SHEET_COLUMNS * 32}px auto`,
            }}
          />
          {!def.walkable && <span className="tile-block">✕</span>}
        </button>
      ))}
    </div>
  );
}
