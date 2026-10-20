/** 後台 Worker 共用工具：雜湊、token、JSON 回應、cookie */

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

const enc = new TextEncoder();

export function nowIso() {
  return new Date().toISOString();
}

export function base64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function randomId(prefix: string) {
  return `${prefix}_${randomToken(9)}`;
}

export async function sha256hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 密碼雜湊：PBKDF2-SHA256（迭代次數存在資料庫，之後可以提高） */
export async function hashPassword(password: string, salt: string, iterations: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 常數時間比較，避免時間側通道 */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}

export function error(status: number, message: string, extra: Record<string, unknown> = {}) {
  return json({ ok: false, error: message, ...extra }, status);
}

export function getCookie(req: Request, name: string) {
  const header = req.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  const type = req.headers.get("Content-Type") ?? "";
  // 要求 JSON：配合 SameSite=Strict cookie，可擋掉跨站表單送出的 CSRF
  if (!type.includes("application/json")) throw new HttpError(415, "請以 application/json 送出");
  const text = await req.text();
  if (text.length > 1_500_000) throw new HttpError(413, "請求內容過大");
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new HttpError(400, "請求不是有效的 JSON");
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
