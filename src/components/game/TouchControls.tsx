"use client";

import { useEffect, useRef } from "react";
import type { Direction } from "@/game/engine";

export type InputKey = Direction | "ok" | "cancel" | `digit${number}`;

/**
 * 手機操作：
 * - 左側：nipplejs 浮動搖桿（手指放在左側區域任何位置都會出現，推動方向即移動）。
 *   只在自由移動時啟用，對話、選單時隱藏，避免擋住點擊選項。
 *   在搖桿區「點一下沒有拖曳」會轉交給地圖當作點擊移動，所以整個畫面都能點擊移動。
 * - 右側：A（確認／對話）、B（取消／選單）
 * - 地圖上直接點擊：點擊移動（由 GameCanvas 處理）
 */
export default function TouchControls({
  joystick,
  labels,
  onPress,
  onRelease,
  onTapAt,
}: {
  joystick: boolean;
  /** 依情境顯示按鈕功能（例如「對話」「選單」「繼續」「返回」） */
  labels: { a: string; b: string };
  onTapAt: (clientX: number, clientY: number) => void;
  onPress: (key: InputKey) => void;
  onRelease: (key: InputKey) => void;
}) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onPress, onRelease, onTapAt });

  useEffect(() => {
    handlers.current = { onPress, onRelease, onTapAt };
  }, [onPress, onRelease, onTapAt]);

  useEffect(() => {
    let destroyed = false;
    let joystick: { destroy: () => void } | null = null;
    let current: Direction | null = null;
    let tapStart: { x: number; y: number } | null = null;
    let dragged = false;
    const release = () => {
      if (current) handlers.current.onRelease(current);
      current = null;
    };
    import("nipplejs").then(({ default: nipplejs }) => {
      if (destroyed || !zoneRef.current) return;
      const collection = nipplejs.create({ zone: zoneRef.current, mode: "dynamic", size: 110, color: "white", fadeTime: 120 });
      collection.on("start", (evt) => {
        tapStart = { ...evt.data.position };
        dragged = false;
      });
      collection.on("dir", (evt) => {
        dragged = true;
        const dir = evt.data.direction?.angle;
        if (!dir || dir === current) return;
        release();
        current = dir;
        handlers.current.onPress(dir);
      });
      collection.on("end", () => {
        release();
        if (!dragged && tapStart) handlers.current.onTapAt(tapStart.x - window.scrollX, tapStart.y - window.scrollY);
        tapStart = null;
      });
      joystick = collection;
    });
    return () => {
      destroyed = true;
      release();
      joystick?.destroy();
    };
  }, []);

  const bind = (key: InputKey) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // pointer 已失效（例如多指觸控時）也不影響按鍵輸入
      }
      e.currentTarget.classList.add("pressed");
      onPress(key);
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.classList.remove("pressed");
      onRelease(key);
    },
    onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.classList.remove("pressed");
      onRelease(key);
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  return (
    <div className="rm-touch" data-testid="touch-controls">
      <div ref={zoneRef} className={`rm-joystick-zone${joystick ? "" : " off"}`} data-testid="joystick-zone">
        <span className="rm-joystick-hint">移動</span>
      </div>
      <div className="rm-ab">
        <button className={`rm-btn b${labels.b ? "" : " idle"}`} aria-label={labels.b || "取消"} {...bind("cancel")}>
          B<span className="rm-btn-label">{labels.b}</span>
        </button>
        <button className="rm-btn a" aria-label={labels.a} {...bind("ok")}>
          A<span className="rm-btn-label">{labels.a}</span>
        </button>
      </div>
    </div>
  );
}
