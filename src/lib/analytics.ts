/**
 * 前台遊玩紀錄（匿名）：玩家在遊戲裡的每個操作都記錄下來，彙整成 AI 案例庫，讓之後做出的遊戲越來越好。
 * - 玩家是瀏覽器裡隨機產生的代號；裝置只記粗略分類（手機／平板／電腦、系統、瀏覽器、語言），地區由伺服器判斷國家代碼
 * - 不保存 IP、不記錄任何能直接認出個人的資料；玩家可以在遊戲的「設定」關閉
 * - 事件先放在記憶體佇列，每 15 秒或離開頁面時用 sendBeacon 一次送出；沒有網路、送出失敗都直接略過，遊玩完全不受影響
 * - 自動化測試的瀏覽器（navigator.webdriver）不記錄，避免測試流量混進數據
 * - 「誰在玩」不靠 IP：分享時用邀請連結（網址加 ?from=阿華，第一次開啟時記下），玩家也可以自己留暱稱
 */

export type PlayEventType =
  | "load" // 下載遊戲資料（value＝KB）
  | "start" // 開始遊戲（ref＝new／continue）
  | "chapter" // 進入章節
  | "chapter_done" // 完成章節（value＝分鐘）
  | "ending" // 抵達結局（ref＝結局 ID）
  | "leave" // 離開或切到背景（ref＝地圖，value＝本次分鐘）
  | "achievement" // 解鎖成就（ref＝成就 ID）
  | "interact" // 觸發事件：對話、調查、開門（ref＝地圖/事件）
  | "choice" // 選了選項（ref＝位置代碼，value＝第幾個選項，detail＝選項文字）
  | "transfer" // 換地圖（ref＝地圖）
  | "item" // 得到或交出物品（ref＝物品，value＝數量）
  | "quest" // 任務進度（ref＝任務，detail＝start／step／complete／fail）
  | "menu" // 開啟選單頁（ref＝頁面）
  | "save" // 存檔（ref＝欄位）
  | "load_save" // 讀檔（ref＝欄位）
  | "setting" // 改設定（ref＝項目，detail＝新的值）
  | "error"; // 頁面錯誤（detail＝訊息）

type PlayEvent = { gameId: string; type: PlayEventType; chapterId?: string | null; ref?: string | null; value?: number | null; detail?: string | null; at: string };

const ENDPOINT = "/api/events";
const MAX_QUEUE = 300;
const BATCH = 100;
const queue: PlayEvent[] = [];
const session = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
let timer: number | null = null;
let deviceSent = false;

const NAME = /^[\p{L}\p{N}_\- ]{1,20}$/u;
const read = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v) window.localStorage.setItem(k, v);
    else window.localStorage.removeItem(k);
  } catch {
    // 記不住也不影響遊玩
  }
};

/** 邀請連結：網址的 ?from=阿華，只記第一次（之後換連結也不會覆蓋） */
export function captureInvite() {
  if (typeof window === "undefined" || read("rpg:from")) return;
  const from = new URLSearchParams(window.location.search).get("from")?.trim();
  if (from && NAME.test(from)) write("rpg:from", from);
}
export const getNickname = () => (typeof window === "undefined" ? null : read("rpg:nickname"));
/** 玩家自己留的暱稱（選填，最多 20 字）；空白代表清除 */
export function setNickname(name: string) {
  const v = name.trim();
  if (v && !NAME.test(v)) return false;
  write("rpg:nickname", v || null);
  return true;
}
if (typeof window !== "undefined") captureInvite();

export const isAutomated = () => typeof navigator !== "undefined" && navigator.webdriver === true;

/** 玩家在設定裡關閉「匿名遊玩紀錄」時不記錄 */
export function analyticsEnabled() {
  try {
    return (JSON.parse(window.localStorage.getItem("rpg:settings") ?? "{}") as { analytics?: boolean }).analytics !== false;
  } catch {
    return true;
  }
}

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

/** 粗略的裝置分類（不記錄完整的 User-Agent） */
function deviceInfo() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "其他";
  const browser = /SamsungBrowser/.test(ua) ? "Samsung" : /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "其他";
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const device = !coarse ? "desktop" : Math.min(screen.width, screen.height) >= 700 ? "tablet" : "mobile";
  let touchMode: string | null = null;
  try {
    touchMode = coarse ? ((JSON.parse(window.localStorage.getItem("rpg:settings") ?? "{}") as { touch?: string }).touch ?? "pad") : null;
  } catch {
    touchMode = null;
  }
  return { device, os, browser, lang: navigator.language.slice(0, 10), screen: `${screen.width}x${screen.height}`, touchMode };
}

export function flushPlayEvents() {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0) return;
  const events = queue.splice(0, queue.length);
  if (!navigator.onLine) return; // 沒有網路：這批紀錄直接放棄
  for (let i = 0; i < events.length; i += BATCH) {
    try {
      const payload: Record<string, unknown> = { visitor: visitor(), session, invite: read("rpg:from"), nickname: getNickname(), events: events.slice(i, i + BATCH) };
      if (!deviceSent) {
        payload.device = deviceInfo();
        deviceSent = true;
      }
      const body = new Blob([JSON.stringify(payload)], { type: "application/json" });
      if (!navigator.sendBeacon?.(ENDPOINT, body)) void fetch(ENDPOINT, { method: "POST", body, keepalive: true }).catch(() => {});
    } catch {
      // 紀錄送不出去不影響遊玩
    }
  }
}

export function trackPlay(gameId: string, type: PlayEventType, data: { chapterId?: string | null; ref?: string | null; value?: number | null; detail?: string | null } = {}) {
  if (typeof window === "undefined" || isAutomated() || !analyticsEnabled()) return;
  queue.push({ gameId, type, ...data, detail: data.detail?.slice(0, 200) ?? null, at: new Date().toISOString() });
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  if (timer === null) timer = window.setTimeout(flushPlayEvents, 15000);
}

/** 頁面錯誤也記下來（同一則訊息只記一次），方便找出玩家遇到的問題 */
export function trackErrors(gameId: string) {
  const seen = new Set<string>();
  const onError = (e: ErrorEvent | PromiseRejectionEvent) => {
    const message = "message" in e ? e.message : String((e as PromiseRejectionEvent).reason);
    if (!message || seen.has(message) || seen.size > 20) return;
    seen.add(message);
    trackPlay(gameId, "error", { detail: message });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onError);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onError);
  };
}
