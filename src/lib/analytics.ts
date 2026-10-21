/**
 * 前台遊玩數據（匿名）：開始遊戲、進入／完成章節、抵達結局、離開時的位置與時間。
 * 事件先放在記憶體佇列，每 15 秒或離開頁面時用 sendBeacon 一次送出。
 * 沒有網路、送出失敗都直接略過，不會丟出錯誤，也不會等待；遊玩完全不受影響。
 * 自動化測試的瀏覽器（navigator.webdriver）不記錄，避免測試流量混進數據與 AI 案例庫。
 */

export const isAutomated = () => typeof navigator !== "undefined" && navigator.webdriver === true;

export type PlayEventType = "start" | "chapter" | "chapter_done" | "ending" | "leave";
type PlayEvent = { gameId: string; type: PlayEventType; chapterId?: string | null; ref?: string | null; value?: number | null; at: string };

const ENDPOINT = "/api/events";
const MAX_QUEUE = 50;
const queue: PlayEvent[] = [];
const session = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
let timer: number | null = null;

function visitor() {
  try {
    const key = "rpg:visitor";
    const v = window.localStorage.getItem(key) ?? crypto.randomUUID();
    window.localStorage.setItem(key, v);
    return v;
  } catch {
    return session;
  }
}

export function flushPlayEvents() {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0) return;
  const events = queue.splice(0, queue.length);
  if (!navigator.onLine) return; // 沒有網路：這批數據直接放棄
  try {
    const body = new Blob([JSON.stringify({ visitor: visitor(), session, events })], { type: "application/json" });
    if (!navigator.sendBeacon?.(ENDPOINT, body)) void fetch(ENDPOINT, { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {
    // 數據送不出去不影響遊玩
  }
}

export function trackPlay(gameId: string, type: PlayEventType, data: { chapterId?: string | null; ref?: string | null; value?: number | null } = {}) {
  if (typeof window === "undefined" || isAutomated()) return;
  queue.push({ gameId, type, ...data, at: new Date().toISOString() });
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  if (timer === null) timer = window.setTimeout(flushPlayEvents, 15000);
}
