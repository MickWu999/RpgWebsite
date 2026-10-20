"use client";

import { useEffect, useRef } from "react";
import { TERRAIN, terrainSheet, terrainUnder } from "@/game/assets";
import type { CoverData } from "@/game/cover";

/**
 * 用素材組合封面（不使用 AI 生圖）：背景是場景圖塊，前景是放大的主視覺角色，再加上漸層與暈影。
 * 同一個元件用在遊戲內封面與遊戲庫卡片。
 */

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

function drawFrame(ctx: CanvasRenderingContext2D, img: HTMLImageElement, frame: number, size: number, x: number, y: number, w: number, h: number) {
  const cols = Math.max(1, Math.round(img.width / size));
  ctx.drawImage(img, (frame % cols) * size, Math.floor(frame / cols) * size, size, size, x, y, w, h);
}

export default function CoverArt({ cover, className }: { cover: CoverData; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    const draw = async () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.max(1, Math.round(rect.width * dpr));
      const H = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;

      // 背景：場景圖塊以 cover 方式填滿
      const rows = cover.terrain ?? [];
      const cols = rows.length ? Math.max(...rows.map((r) => [...r].length)) : 16;
      const tile = Math.max(W / cols, H / Math.max(rows.length, 12));
      const offsetX = (W - cols * tile) / 2;
      const offsetY = (H - Math.max(rows.length, 12) * tile) / 2;
      ctx.fillStyle = cover.colors?.floor ?? "#2d4a3a";
      ctx.fillRect(0, 0, W, H);
      if (rows.length) {
        try {
          const srcs = new Set(rows.join("").split("").flatMap((ch) => (TERRAIN[ch] ? [terrainSheet(TERRAIN[ch]), terrainSheet(terrainUnder(TERRAIN[ch]))] : [])));
          const sheets = new Map<string, HTMLImageElement>();
          for (const src of srcs) sheets.set(src, await loadImage(src));
          if (cancelled) return;
          rows.forEach((row, y) =>
            [...row].forEach((ch, x) => {
              const def = TERRAIN[ch];
              if (!def) return;
              const px = offsetX + x * tile;
              const py = offsetY + y * tile;
              if (def.overlay) {
                const under = terrainUnder(def);
                drawFrame(ctx, sheets.get(terrainSheet(under))!, under.frame, 16, px, py, tile + 1, tile + 1);
              }
              drawFrame(ctx, sheets.get(terrainSheet(def))!, def.frame, 16, px, py, tile + 1, tile + 1);
            }),
          );
        } catch {
          // 圖塊載入失敗時保留底色
        }
      }

      // 色調：上方保留天空感，下方加深讓標題與角色突出
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "rgba(10, 14, 40, 0.35)");
      grad.addColorStop(0.55, "rgba(10, 14, 40, 0.15)");
      grad.addColorStop(1, "rgba(5, 6, 18, 0.85)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      const vignette = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.25, W / 2, H * 0.45, Math.max(W, H) * 0.75);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.6)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, W, H);

      // 前景：主視覺角色（中間最大，左右稍小、稍後）
      const chars = cover.characters;
      // 角色底部留 14% 給「按任意鍵開始」等文字
      const big = H * 0.32;
      const order = chars.length === 3 ? [1, 0, 2] : chars.map((_, i) => i);
      for (const i of order) {
        const c = chars[i];
        try {
          const img = await loadImage(c.src);
          if (cancelled) return;
          const isMain = i === 0;
          const size = isMain ? big : big * 0.78;
          const slot = chars.length === 1 ? 0 : chars.length === 2 ? (i === 0 ? -0.5 : 0.5) : i === 0 ? 0 : i === 1 ? -1 : 1;
          const x = W / 2 + slot * size * 0.95 - size / 2;
          const y = H - size - H * 0.14 + (isMain ? 0 : size * 0.06);
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.ellipse(x + size / 2, y + size * 0.97, size * 0.32, size * 0.06, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          drawFrame(ctx, img, c.frame, c.frameSize, x, y, size, size);
        } catch {
          // 單一角色載入失敗時略過
        }
      }
    };

    void draw();
    const observer = new ResizeObserver(() => void draw());
    observer.observe(canvas);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [cover]);

  return <canvas ref={canvasRef} className={`cover-art${className ? ` ${className}` : ""}`} aria-label={`${cover.title} 封面`} />;
}
