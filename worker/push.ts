import { base64url, nowIso, type Env } from "./lib";

/**
 * Web Push（不帶內容的推播）：只送出一個「有新公告」的訊號，玩家裝置上的 service worker 收到後，
 * 再到 /api/notices/latest 讀取最新公告並顯示通知。這樣不必實作內容加密（RFC 8291），只需要 VAPID 簽名（RFC 8292）。
 *
 * 通知跟著功能自動發出，不需要人另外操作：
 * - 發布時（studio.ts 的 publish）依內容判斷：第一次發布 → 新遊戲推出；章節變多 → 新章節；附了更新說明 → 更新／修正
 * - 建立公告後立刻送第一批，其餘由排程（每分鐘）接著送；每次最多 PUSH_BATCH 位，避免超過 Worker 單次執行的子請求上限
 */

export type NoticeKind = "chapter" | "update" | "fix" | "new_game";
export const NOTICE_KINDS: NoticeKind[] = ["chapter", "update", "fix", "new_game"];
const PUSH_BATCH = 40;

const b64url = (buf: ArrayBuffer | Uint8Array) => base64url(buf instanceof Uint8Array ? buf : new Uint8Array(buf));

let keyCache: CryptoKey | null = null;

export const pushReady = (env: Env) => Boolean(env.VAPID_PRIVATE_JWK && env.VAPID_PUBLIC_KEY);

async function vapidHeader(env: Env, endpoint: string) {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC_KEY) throw new Error("推播金鑰還沒設定（wrangler secret put VAPID_PRIVATE_JWK）");
  keyCache ??= await crypto.subtle.importKey("jwk", JSON.parse(env.VAPID_PRIVATE_JWK) as JsonWebKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || "mailto:noreply@example.com" })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyCache, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

/** 送出一則推播；回傳推播服務的狀態碼（404／410 代表訂閱已失效，應該刪除） */
async function sendPush(env: Env, endpoint: string): Promise<number> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: await vapidHeader(env, endpoint), TTL: String(3 * 24 * 3600), Urgency: "normal", "Content-Length": "0" },
  });
  return res.status;
}

/** 建立公告（之後由 deliverNotices 送出）；回傳公告 id */
export async function createNotice(env: Env, n: { kind: NoticeKind; title: string; body: string; url: string; author: string; gameId?: string | null; chapters?: number | null }) {
  const r = await env.DB.prepare("INSERT INTO notices (kind, title, body, url, author, game_id, chapters, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(n.kind, n.title.slice(0, 60), n.body.slice(0, 200), n.url, n.author, n.gameId ?? null, n.chapters ?? null, nowIso())
    .run();
  return Number(r.meta.last_row_id);
}

/** 送出還沒送完的公告：每次呼叫最多送 PUSH_BATCH 位，進度存在 notices.cursor（排程會一直接著送） */
export async function deliverNotices(env: Env) {
  if (!pushReady(env)) return;
  let budget = PUSH_BATCH;
  const pending = await env.DB.prepare("SELECT id, cursor FROM notices WHERE done = 0 ORDER BY id LIMIT 5").all<{ id: number; cursor: string }>();
  for (const n of pending.results) {
    if (budget <= 0) return;
    const { results } = await env.DB.prepare("SELECT id, endpoint FROM push_subscriptions WHERE id > ? ORDER BY id LIMIT ?").bind(n.cursor, budget).all<{ id: string; endpoint: string }>();
    budget -= results.length;
    const status = await Promise.all(results.map((s) => sendPush(env, s.endpoint).catch(() => 0)));
    const ok = results.filter((_, i) => status[i] >= 200 && status[i] < 300);
    // 404／410：玩家已取消訂閱或瀏覽器資料被清除，刪掉這筆訂閱
    const gone = results.filter((_, i) => status[i] === 404 || status[i] === 410);
    const now = nowIso();
    const finished = budget > 0;
    await env.DB.batch([
      env.DB.prepare("UPDATE notices SET sent = sent + ?, failed = failed + ?, cursor = ?, done = ? WHERE id = ?").bind(ok.length, results.length - ok.length, results.at(-1)?.id ?? n.cursor, finished ? 1 : 0, n.id),
      ...ok.map((s) => env.DB.prepare("UPDATE push_subscriptions SET last_ok_at = ? WHERE id = ?").bind(now, s.id)),
      ...gone.map((s) => env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(s.id)),
    ]);
  }
}
