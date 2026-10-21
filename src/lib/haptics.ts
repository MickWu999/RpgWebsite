import type { GameEvent } from "@/game/engine";
import { loadSettings } from "./settings";

/**
 * 震動回饋（Vibration API）：Android 的瀏覽器支援；iPhone／iPad 的 Safari 不支援，呼叫了也不會有反應。
 * 玩家可以在遊戲設定裡關閉。
 */
export function canVibrate() {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export function vibrate(pattern: number | number[]) {
  if (!canVibrate()) return;
  try {
    if (loadSettings().vibration === false) return;
    navigator.vibrate(pattern);
  } catch {
    // 不支援或被瀏覽器擋下時不影響遊戲
  }
}

let lastBlocked = 0;

/** 依事件挑一個最重要的震動：結局＞章節＞任務完成＞獲得物品＞時間經過＞撞牆 */
export function vibrateForEvents(events: GameEvent[]) {
  const has = (t: GameEvent["type"]) => events.some((e) => e.type === t);
  if (has("ending")) vibrate([80, 60, 80]);
  else if (has("chapter")) vibrate(60);
  else if (events.some((e) => e.type === "quest" && e.action === "complete")) vibrate([30, 40, 30]);
  else if (events.some((e) => e.type === "item" && e.delta > 0)) vibrate(25);
  else if (has("time")) vibrate(15);
  else if (has("blocked") && Date.now() - lastBlocked > 500) {
    // 按住方向鍵撞牆會一直觸發：最多半秒震一次
    lastBlocked = Date.now();
    vibrate(20);
  }
}
