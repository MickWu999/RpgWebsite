/**
 * 推播通知（玩家端）：玩家同意後，瀏覽器向推播服務訂閱，訂閱資料存到前台 /api/push/subscribe。
 * 後台發出公告時，service worker（public/sw.js）會收到推播並顯示通知。
 * - 公鑰（NEXT_PUBLIC_VAPID_PUBLIC_KEY）在建置時帶入；私鑰只在後台 Worker 的 secret
 * - iPhone／iPad 只有「加入主畫面」後開啟的網頁才能接收推播
 */

export type PushStatus = "unsupported" | "needs-install" | "denied" | "on" | "off";
export type Notice = { id: number; kind: "chapter" | "update" | "fix" | "new_game"; title: string; body: string; url: string; created_at: string };

export const PUSH_STATUS_LABEL: Record<PushStatus, string> = { unsupported: "不支援", "needs-install": "需加入主畫面", denied: "已封鎖", on: "開", off: "關" };
export const NOTICE_ICON: Record<Notice["kind"], string> = { chapter: "📖", update: "✨", fix: "🔧", new_game: "🎮" };

const ASK_KEY = "rpg:push-ask";
const ASK_AGAIN_DAYS = 7;

function isIos() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches || (navigator as { standalone?: boolean }).standalone === true;
}
function supported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
}
async function registration() {
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!supported()) return isIos() && !isStandalone() ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ? "on" : "off";
}

function keyBytes(base64: string) {
  const raw = atob(base64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** 開啟通知：要求權限 → 訂閱 → 存到前台；回傳最新狀態 */
export async function enablePush(): Promise<PushStatus> {
  if (!supported()) return getPushStatus();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    if (permission === "denied") rememberAsk("never");
    return getPushStatus();
  }
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) }));
  let visitor: string | null = null;
  try {
    visitor = window.localStorage.getItem("rpg:visitor");
  } catch {
    // 讀不到匿名代號時照樣訂閱
  }
  const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), visitor }) });
  if (!res.ok) {
    await sub.unsubscribe();
    throw new Error("訂閱失敗，請稍後再試");
  }
  rememberAsk("never");
  return "on";
}

export async function disablePush(): Promise<PushStatus> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await fetch("/api/push/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe();
  }
  return getPushStatus();
}

/** 「之後再說」：7 天後再問；開啟或封鎖後就不再問 */
export function rememberAsk(when: "later" | "never") {
  try {
    window.localStorage.setItem(ASK_KEY, when === "never" ? "never" : new Date(Date.now() + ASK_AGAIN_DAYS * 864e5).toISOString());
  } catch {
    // 記不住時下次再問
  }
}

export function shouldAsk(status: PushStatus) {
  if (status !== "off" && status !== "needs-install") return false;
  try {
    const v = window.localStorage.getItem(ASK_KEY);
    return !v || (v !== "never" && Date.parse(v) <= Date.now());
  } catch {
    return false;
  }
}

export async function fetchLatestNotice(): Promise<Notice | null> {
  try {
    const res = await fetch("/api/notices/latest", { cache: "no-store" });
    return res.ok ? ((await res.json()) as { notice: Notice | null }).notice : null;
  } catch {
    return null;
  }
}
