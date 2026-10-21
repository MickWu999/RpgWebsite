"use client";

import type { Direction } from "@/game/engine";

type PadKey = Direction | "ok" | "cancel";

/**
 * 手機的虛擬按鍵（設定「觸控操作：方向鍵＋A」時顯示）：
 * - 左下十字鍵：按住持續移動；在對話選項與選單中用上下選擇
 * - 右下 A 鍵：等於空白鍵／Enter，用來對話、調查、繼續、確定
 * - A 左邊的 B 鍵：取消（等於 Esc）。在地圖上打開選單，在選單裡回到上一層、關閉選單
 * 直接點擊畫面的操作仍然有效，兩種方式可以混用。
 * 依情境顯示（參考 RPG Maker 手機按鍵外掛的做法：對話時隱藏，不擋對話框）：
 * - full：地圖與選單，十字鍵＋A
 * - choices：出現選項時只留 ▲▼ 與 A，抬高到對話框上方的左側（選項視窗在右側）
 * - dialog：對話與章節標題卡只留 A
 * 方向鍵模式下螢幕觸控是關閉的（避免誤觸），所以每個情境都要有按鍵可以操作。
 */
export default function TouchPad({
  variant,
  lift,
  opacity,
  onPress,
  onRelease,
}: {
  variant: "full" | "choices" | "dialog";
  /** choices 時抬高的距離（對話框的高度，px） */
  lift: number;
  opacity: number;
  onPress: (key: PadKey) => void;
  onRelease: (key: PadKey) => void;
}) {
  const bind = (key: PadKey) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // 多指觸控時 pointer 可能已失效，不影響按鍵輸入
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
  const style = { "--pad-opacity": opacity } as React.CSSProperties;
  if (variant === "dialog") {
    // 對話、章節標題卡：只需要 A（繼續）
    return (
      <div className="rm-pad dialog" style={style} data-testid="touch-pad" data-variant="dialog">
        <span />
        <button className="rm-a" aria-label="A（繼續）" data-testid="pad-a" {...bind("ok")}>
          A
        </button>
      </div>
    );
  }
  if (variant === "choices") {
    return (
      <div className="rm-pad choices" style={{ ...style, bottom: lift }} data-testid="touch-pad" data-variant="choices">
        <div className="rm-updown">
          <button aria-label="上" {...bind("up")}>▲</button>
          <button aria-label="下" {...bind("down")}>▼</button>
        </div>
        <button className="rm-a" aria-label="A（確定）" data-testid="pad-a" {...bind("ok")}>
          A
        </button>
      </div>
    );
  }
  return (
    <div className="rm-pad" style={style} data-testid="touch-pad" data-variant="full">
      <div className="rm-dpad">
        <button className="up" aria-label="上" {...bind("up")}>▲</button>
        <button className="left" aria-label="左" {...bind("left")}>◀</button>
        <button className="right" aria-label="右" {...bind("right")}>▶</button>
        <button className="down" aria-label="下" {...bind("down")}>▼</button>
      </div>
      <div className="rm-ab-keys">
        <button className="rm-b" aria-label="B（取消）" data-testid="pad-b" {...bind("cancel")}>
          B
        </button>
        <button className="rm-a" aria-label="A（確定）" data-testid="pad-a" {...bind("ok")}>
          A
        </button>
      </div>
    </div>
  );
}
