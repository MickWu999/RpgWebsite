"use client";

import { useEffect, useRef, useState } from "react";
import { TERRAIN, TERRAIN_BASE_FRAME } from "@/game/assets";
import type { GameProject, MapDefinition } from "@/game/schema";

/**
 * Studio 地圖畫布（RPG Maker 式）：
 * - 地圖模式：按住拖曳繪製地形（放開時才送出一筆 map.paint 操作，方便復原）
 * - 事件模式：點格子選取、雙擊開啟事件編輯（空格就新增事件）、拖曳事件可以移動位置
 * 事件以第 1 頁的圖像顯示（與 RPG Maker 相同），透明事件畫成方框，場所移動畫成 ⇄，玩家起點畫成 S。
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
  onMoveEvent,
}: {
  project: GameProject;
  scene: MapDefinition;
  mode: MapMode;
  zoom: number;
  selected: { x: number; y: number } | null;
  /** 拖曳中尚未送出的繪製（key = "x,y"） */
  preview: Map<string, string>;
  onPaint: (x: number, y: number) => void;
  onPaintEnd: () => void;
  onSelect: (x: number, y: number) => void;
  onCreate: (x: number, y: number) => void;
  onMoveEvent: (eventId: string, x: number, y: number) => void;
}) {
  const dragEvent = useRef<string | null>(null);
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
        const row = [...(scene.terrain[y] ?? "")];
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
      const sprite = async (assetId: string | undefined, x: number, y: number) => {
        const a = project.assetManifest.assets.find((x) => x.id === assetId);
        if (!a || a.frame === undefined) return false;
        const img = await loadImage(a.src).catch(() => null);
        if (!img || cancelled) return false;
        frame(img, a.frame, a.frameSize ?? 16, x * ts, y * ts);
        return true;
      };
      const glyph = (text: string, x: number, y: number, color: string) => {
        ctx.fillStyle = color;
        ctx.font = `bold ${Math.round(ts * 0.45)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, x * ts + ts / 2, y * ts + ts / 2);
      };
      for (const ev of scene.events) {
        const page = ev.pages[0];
        const isTransfer = page.trigger === "touch" && page.commands.some((c) => c.code === "transfer");
        if (isTransfer && !page.graphic) {
          ctx.fillStyle = "rgba(111,195,164,0.45)";
          ctx.fillRect(ev.x * ts, ev.y * ts, ts, ts);
          glyph("⇄", ev.x, ev.y, "#fff");
        } else if (!(page.graphic && (await sprite(page.graphic.assetId, ev.x, ev.y)))) {
          glyph(page.trigger === "autorun" ? "▶" : page.trigger === "touch" ? "◇" : "！", ev.x, ev.y, "#ff7ad9");
        }
        if (mode === "event") {
          // RPG Maker 式事件框
          ctx.strokeStyle = "rgba(255,255,255,0.85)";
          ctx.lineWidth = 1;
          ctx.strokeRect(ev.x * ts + 2.5, ev.y * ts + 2.5, ts - 5, ts - 5);
          if (ev.pages.length > 1) {
            ctx.fillStyle = "#000a";
            ctx.fillRect(ev.x * ts + ts - 12, ev.y * ts + 2, 10, 10);
            ctx.fillStyle = "#fff";
            ctx.font = "9px sans-serif";
            ctx.fillText(String(ev.pages.length), ev.x * ts + ts - 7, ev.y * ts + 7);
          }
        }
      }
      const start = project.system.start;
      if (start.mapId === scene.id) {
        await sprite(project.actors.find((a) => a.id === project.system.playerActorId)?.spriteAssetId, start.x, start.y);
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
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // 部分瀏覽器不支援時仍可繪製
          }
          onPaint(c.x, c.y);
        } else {
          onSelect(c.x, c.y);
          dragEvent.current = scene.events.find((ev) => ev.x === c.x && ev.y === c.y)?.id ?? null;
        }
      }}
      onPointerMove={(e) => {
        const c = cellOf(e);
        setHover(c);
        if (painting.current && c) onPaint(c.x, c.y);
      }}
      onPointerUp={(e) => {
        if (painting.current) {
          painting.current = false;
          onPaintEnd();
        }
        const id = dragEvent.current;
        dragEvent.current = null;
        const c = cellOf(e);
        const ev = scene.events.find((x) => x.id === id);
        if (ev && c && (c.x !== ev.x || c.y !== ev.y) && !scene.events.some((x) => x.x === c.x && x.y === c.y)) {
          onMoveEvent(ev.id, c.x, c.y);
          onSelect(c.x, c.y);
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
