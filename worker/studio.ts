import demoProject from "../public/games/demo-lantern/project.json";
import { coverDataOf } from "../src/game/cover";
import { projectRevision } from "../src/game/engine";
import { gameProjectSchema, type GameProject } from "../src/game/schema";
import { applyOps, blankProject, opSchema } from "../src/studio/ops";
import { DESIGN_GUIDE } from "../src/ai/designGuide";
import { z } from "zod";
import { error, getCookie, hashPassword, HttpError, json, nowIso, randomId, randomToken, readJson, safeEqual, sha256hex, type Env } from "./lib";

/**
 * AI RPG Studio 後台 API（Cloudflare Worker + D1）。
 * - 開發者以帳號密碼登入（HttpOnly cookie 工作階段）
 * - API Token（類似 Jenkins）：在設定頁產生，AI agent 以 `Authorization: Bearer <token>` 操作同一套 API
 * - 所有修改都是 Studio 操作（src/studio/ops.ts）或整份儲存，每次都留下版本紀錄
 * - 伺服器不執行驗證與自動試玩（大型遊戲會超過 Workers 免費方案 CPU 限制）；檢查在瀏覽器或 AI 的本機 CLI 執行（src/studio/check.ts），
 *   發布時附上檢查摘要，伺服器只比對內容指紋（revision）
 * API 說明：GET /api/docs（給 AI 閱讀的 Markdown）
 */

const SESSION_COOKIE = "rpgs_session";
/** 「保持登入」30 天；未勾選時 12 小時 */
const REMEMBER_DAYS = 30;
const SHORT_SESSION_HOURS = 12;
const MIN_PASSWORD = 6;
const LOCK_FAILURES = 5;
const LOCK_MINUTES = 15;
const VERSION_KEEP = 60;
const PASSWORD_ITERATIONS = 100_000;

/** label 會寫進版本紀錄、審查與文件：共用帳號時顯示「操作者（帳號）」，API Token 顯示 Token 名稱 */
type Actor = { userId: string; username: string; kind: "user" | "token"; tokenName?: string; operator?: string | null; label: string };
type ProjectRow = { id: string; owner_id: string; title: string; data: string; version: number; is_valid: number; created_at: string; updated_at: string; archived_at: string | null };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      // 後台網址的根目錄直接進 Studio（前台頁面不會出現在後台）
      if (url.pathname === "/") return Response.redirect(new URL("/studio/", url).toString(), 302);
      if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
      return await route(req, env, url);
    } catch (e) {
      if (e instanceof HttpError) return error(e.status, e.message, e.extra);
      console.error(e);
      return error(500, `伺服器錯誤：${(e as Error).message}`);
    }
  },
};

async function route(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "");
  const method = req.method;

  // ---------- 不需登入 ----------
  if (path === "/api/docs" && method === "GET") return new Response(API_DOCS, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
  if (path === "/api/ops-schema" && method === "GET") return json(z.toJSONSchema(z.array(opSchema)));
  if (path === "/api/auth/login" && method === "POST") return login(req, env);
  if (path === "/api/auth/logout" && method === "POST") return logout(req, env);

  const actor = await authenticate(req, env);
  if (!actor) return error(401, "請先登入，或在 Authorization 標頭提供有效的 API Token");

  if (path === "/api/auth/me" && method === "GET") return json({ ok: true, user: { id: actor.userId, username: actor.username }, operator: actor.operator ?? null, via: actor.kind, tokenName: actor.tokenName });
  if (path === "/api/auth/logins" && method === "GET") {
    if (actor.kind !== "user") return error(403, "登入紀錄只能在 Studio 登入後查看");
    const { results } = await env.DB.prepare("SELECT username, operator, ip, country, device, success, created_at FROM studio_logins ORDER BY id DESC LIMIT 100").all();
    return json({ ok: true, logins: results });
  }
  if (path === "/api/auth/operator" && method === "POST") {
    if (actor.kind !== "user") return error(403, "API Token 的操作者就是 Token 名稱，不能修改");
    const body = await readJson<{ name?: string }>(req);
    const name = operatorName(body.name);
    await env.DB.prepare("UPDATE sessions SET operator = ? WHERE token_hash = ?").bind(name, await sha256hex(getCookie(req, SESSION_COOKIE) ?? "")).run();
    return json({ ok: true, operator: name });
  }
  if (path === "/api/auth/password" && method === "POST") return changePassword(req, env, actor);

  // ---------- API Token（只能用登入工作階段管理，token 不能再產生 token） ----------
  if (path === "/api/tokens") {
    if (actor.kind !== "user") return error(403, "API Token 只能在 Studio 介面登入後管理");
    if (method === "GET") {
      const { results } = await env.DB.prepare("SELECT id, name, token_prefix, created_at, last_used_at, revoked_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC").bind(actor.userId).all();
      return json({ ok: true, tokens: results });
    }
    if (method === "POST") {
      const body = await readJson<{ name?: string }>(req);
      const name = String(body.name ?? "").trim().slice(0, 60) || "AI agent";
      const token = `rpgs_${randomToken(32)}`;
      const id = randomId("tok");
      await env.DB.prepare("INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id, actor.userId, name, token.slice(0, 12), await sha256hex(token), nowIso())
        .run();
      return json({ ok: true, id, name, token, notice: "這是唯一一次顯示完整 token，請立刻複製保存" }, 201);
    }
  }
  const tokenMatch = path.match(/^\/api\/tokens\/([\w-]+)$/);
  if (tokenMatch && method === "DELETE") {
    if (actor.kind !== "user") return error(403, "API Token 只能在 Studio 介面登入後管理");
    await env.DB.prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ?").bind(nowIso(), tokenMatch[1], actor.userId).run();
    return json({ ok: true });
  }

  // ---------- 專案 ----------
  if (path === "/api/projects" && method === "GET") {
    // ?archived=1 列出典藏區；預設只列使用中的專案
    const archived = url.searchParams.get("archived") === "1";
    // 卡片上的 AI 製作進度：故事、大綱審查、章節審查（每章最新一次是否通過）、整體審查、最近一次修改者
    const latest = (target: string) => `(SELECT r.passed FROM project_reviews r WHERE r.project_id = p.id AND r.target = ${target} ORDER BY r.created_at DESC LIMIT 1)`;
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.title, p.version, p.is_valid, p.updated_at, p.created_at, p.archived_at, g.version AS published_version, g.published_at,
        EXISTS (SELECT 1 FROM project_docs d WHERE d.project_id = p.id AND d.kind = 'story') AS has_story,
        EXISTS (SELECT 1 FROM project_docs d WHERE d.project_id = p.id AND d.kind = 'treatment') AS has_treatment,
        ${latest("'treatment'")} AS treatment_passed,
        ${latest("'full'")} AS full_passed,
        json_array_length(p.data, '$.chapters') AS chapters_total,
        (SELECT COUNT(*) FROM json_each(p.data, '$.chapters') c WHERE ${latest("json_extract(c.value, '$.id')")} = 1) AS chapters_passed,
        (SELECT v.actor FROM project_versions v WHERE v.project_id = p.id ORDER BY v.version DESC LIMIT 1) AS last_actor
      FROM projects p LEFT JOIN published_games g ON g.project_id = p.id WHERE p.owner_id = ? AND p.archived_at IS ${archived ? "NOT NULL" : "NULL"} ORDER BY ${archived ? "p.archived_at" : "p.updated_at"} DESC`,
    )
      .bind(actor.userId)
      .all();
    return json({ ok: true, projects: results });
  }
  if (path === "/api/projects" && method === "POST") return createProject(req, env, actor);
  // 營運數據（只限瀏覽器登入的使用者；API Token 看不到個別玩家的紀錄）
  if (path.startsWith("/api/admin/")) {
    if (actor.kind !== "user") return error(403, "營運數據只能在 Studio 登入後查看");
    if (path === "/api/admin/overview" && method === "GET") return json({ ok: true, overview: await adminOverview(env) });
    const u = new URL(req.url);
    if (path === "/api/admin/players" && method === "GET") return json({ ok: true, ...(await adminPlayers(env, Math.min(Number(u.searchParams.get("limit")) || 50, 200), Number(u.searchParams.get("offset")) || 0)) });
    if (path === "/api/admin/feedback" && method === "GET") {
      const { results } = await env.DB.prepare("SELECT game_id, chapter_id, rating, tags, comment, created_at FROM player_feedback ORDER BY created_at DESC LIMIT 300").all<{ game_id: string; chapter_id: string; rating: number; tags: string; comment: string; created_at: string }>();
      return json({ ok: true, feedback: results.map((r) => ({ ...r, tags: JSON.parse(r.tags) as string[] })) });
    }
    const pm = path.match(/^\/api\/admin\/players\/([\w-]{1,64})$/);
    if (pm && method === "GET") return json({ ok: true, ...(await adminPlayer(env, pm[1])) });
    return error(404, "找不到這個營運 API");
  }
  if (path === "/api/lessons" && method === "GET") return lessons(env, actor, new URL(req.url).searchParams.get("game"));

  const m = path.match(/^\/api\/projects\/([\w-]+)(?:\/(.+))?$/);
  if (m) {
    const [, id, sub] = m;
    const row = await getProject(env, id, actor);
    if (!sub && method === "GET") return json({ ok: true, id: row.id, version: row.version, project: JSON.parse(row.data), updatedAt: row.updated_at, archivedAt: row.archived_at });
    if (!sub && method === "PUT") {
      const body = await readJson<{ project?: unknown; baseVersion?: number; label?: string; isValid?: boolean }>(req);
      const parsed = gameProjectSchema.safeParse(body.project);
      if (!parsed.success) return error(400, "project 格式錯誤", { issues: parsed.error.issues.slice(0, 20) });
      const saved = await saveVersion(env, row, { ...parsed.data, id: row.id }, body.baseVersion, String(body.label ?? "儲存").slice(0, 200), actor, body.isValid === true);
      return json({ ok: true, version: saved.version });
    }
    // 典藏（軟刪除）：只標記典藏時間，資料、版本紀錄、已發布狀態都保留，可以還原
    if ((!sub && method === "DELETE") || (sub === "archive" && method === "POST")) {
      if (actor.kind !== "user") return error(403, "典藏專案只能在 Studio 介面操作");
      await env.DB.prepare("UPDATE projects SET archived_at = ? WHERE id = ?").bind(nowIso(), row.id).run();
      return json({ ok: true, archived: true });
    }
    if (sub === "unarchive" && method === "POST") {
      if (actor.kind !== "user") return error(403, "還原典藏只能在 Studio 介面操作");
      await env.DB.prepare("UPDATE projects SET archived_at = NULL, updated_at = ? WHERE id = ?").bind(nowIso(), row.id).run();
      return json({ ok: true, archived: false });
    }
    if (sub === "ops" && method === "POST") {
      const body = await readJson<{ ops?: unknown[]; baseVersion?: number; label?: string; includeProject?: boolean }>(req);
      if (!Array.isArray(body.ops) || body.ops.length === 0) return error(400, "ops 必須是非空陣列");
      if (body.ops.length > 200) return error(400, "一次最多 200 筆操作，請分批送出");
      const result = applyOps(JSON.parse(row.data), body.ops, { validate: false });
      const allOk = result.results.every((r) => r.ok);
      if (!allOk) return json({ ok: false, written: false, results: result.results }, 422);
      const label = String(body.label ?? result.results.map((r) => r.message).join("、")).slice(0, 200);
      const saved = await saveVersion(env, row, result.project, body.baseVersion, label, actor, false);
      return json({
        ok: true,
        written: true,
        version: saved.version,
        results: result.results,
        notice: "伺服器只檢查操作格式；請在本機執行 npm run game -- remote check 驗證與自動試玩",
        ...(body.includeProject ? { project: result.project } : {}),
      });
    }
    // 玩家回饋（玩完一章時留下的星等、標籤與留言）
    if (sub === "feedback" && method === "GET") {
      const { results } = await env.DB.prepare("SELECT chapter_id, rating, tags, comment, created_at FROM player_feedback WHERE game_id = ? ORDER BY created_at DESC LIMIT 300").bind(row.id).all<{ chapter_id: string; rating: number; tags: string; comment: string; created_at: string }>();
      return json({ ok: true, feedback: results.map((r) => ({ ...r, tags: JSON.parse(r.tags) as string[] })) });
    }
    // 修改清單：人在測試遊玩時標記的修改意見（AI 讀取、修改後標成已處理）
    if (sub === "notes" && method === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM project_notes WHERE project_id = ? ORDER BY status = 'open' DESC, created_at DESC LIMIT 300").bind(row.id).all();
      return json({ ok: true, notes: results.map((n) => ({ ...n, state: n.state ? JSON.parse(String(n.state)) : null })) });
    }
    if (sub === "notes" && method === "POST") {
      const body = await readJson<{ locator?: string; mapId?: string; x?: number; y?: number; chapterId?: string; excerpt?: string; state?: unknown; body?: string }>(req);
      const text = String(body.body ?? "").trim().slice(0, 2000);
      if (!text) return error(400, "請寫下要修改什麼");
      const id = randomId("note");
      const opt = (v: unknown, n = 200) => (typeof v === "string" && v ? v.slice(0, n) : null);
      await env.DB.prepare("INSERT INTO project_notes (id, project_id, locator, map_id, x, y, chapter_id, excerpt, state, body, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, row.id, opt(body.locator), opt(body.mapId, 64), Number.isInteger(body.x) ? body.x : null, Number.isInteger(body.y) ? body.y : null, opt(body.chapterId, 64), opt(body.excerpt, 500), body.state ? JSON.stringify(body.state).slice(0, 20_000) : null, text, actor.label, nowIso())
        .run();
      return json({ ok: true, id });
    }
    const nm = sub?.match(/^notes\/(note_[\w-]+)$/);
    if (nm && method === "PATCH") {
      const body = await readJson<{ status?: string; resolution?: string }>(req);
      if (!["open", "resolved", "wontfix"].includes(String(body.status))) return error(400, "status 只能是 open、resolved、wontfix");
      const done = body.status !== "open";
      await env.DB.prepare("UPDATE project_notes SET status = ?, resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND project_id = ?")
        .bind(body.status, String(body.resolution ?? "").slice(0, 2000) || null, done ? actor.label : null, done ? nowIso() : null, nm[1], row.id)
        .run();
      return json({ ok: true });
    }
    // 玩家行為洞察（給 AI：選擇比例、沒人發現的事件、卡關的地方、成就解鎖率…）
    if (sub === "insights" && method === "GET") return json({ ok: true, insights: await gameInsights(env, row.id) });
    // 遊玩數據（前台匿名事件的統計）
    if (sub === "analytics" && method === "GET") return json({ ok: true, analytics: await playAnalytics(env, row.id) });
    // 故事原文與劇本大綱（人寫故事交給 AI；AI 寫的大綱放上來給人看）
    if (sub === "docs" && method === "GET") {
      const { results } = await env.DB.prepare("SELECT kind, content, updated_at, updated_by FROM project_docs WHERE project_id = ?").bind(row.id).all();
      return json({ ok: true, docs: Object.fromEntries(results.map((d) => [d.kind, d])) });
    }
    const dm = sub?.match(/^docs\/(story|treatment|scope)$/);
    if (dm && method === "PUT") {
      const body = await readJson<{ content?: string }>(req);
      const content = String(body.content ?? "");
      if (content.length > 200_000) return error(413, "文件太長（上限 20 萬字）");
      await env.DB.prepare("INSERT OR REPLACE INTO project_docs (project_id, kind, content, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)").bind(row.id, dm[1], content, nowIso(), actor.label).run();
      return json({ ok: true });
    }
    // 審查紀錄（審查在 AI 的本機執行，結果上傳到這裡給人看，並作為發布的關卡）
    if (sub === "reviews" && method === "GET") {
      const { results } = await env.DB.prepare("SELECT id, kind, target, revision, passed, overall, data, actor, created_at FROM project_reviews WHERE project_id = ? ORDER BY created_at DESC LIMIT 200").bind(row.id).all();
      return json({ ok: true, reviews: results.map((r) => ({ ...r, passed: r.passed === 1, data: JSON.parse(String(r.data)) })) });
    }
    // 人工接受：審查沒過，但使用者決定可以往下做（只限瀏覽器登入的人，API Token 不能自己接受）
    if (sub === "reviews/accept" && method === "POST") {
      if (actor.kind !== "user") return error(403, "人工接受只能由使用者在 Studio 操作，API Token 不能自己接受");
      const body = await readJson<{ target?: string; note?: string }>(req);
      const target = String(body.target ?? "").slice(0, 64);
      const latest = await env.DB.prepare("SELECT kind, revision, data FROM project_reviews WHERE project_id = ? AND target = ? ORDER BY created_at DESC LIMIT 1").bind(row.id, target).first<{ kind: string; revision: string | null; data: string }>();
      if (!latest) return error(404, "這個目標還沒有審查紀錄");
      const data: Record<string, unknown> = { ...(JSON.parse(latest.data) as Record<string, unknown>), passed: true, round: 0, humanAccepted: { by: actor.label, note: String(body.note ?? "").slice(0, 1000), at: nowIso() } };
      await env.DB.prepare("INSERT INTO project_reviews (id, project_id, kind, target, revision, passed, overall, data, actor, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)")
        .bind(randomId("rev"), row.id, latest.kind, target, latest.revision, Number((data.review as { overall?: number } | undefined)?.overall ?? 0) || null, JSON.stringify(data), actor.label, nowIso())
        .run();
      return json({ ok: true });
    }
    if (sub === "reviews" && method === "POST") {
      const body = await readJson<{ kind?: string; target?: string; revision?: string; passed?: boolean; review?: { overall?: number } }>(req);
      if (!["treatment", "chapter", "full"].includes(String(body.kind)) || !body.target || typeof body.passed !== "boolean" || !body.review) return error(400, "審查結果格式錯誤");
      const text = JSON.stringify(body);
      if (text.length > 100_000) return error(413, "審查結果太大");
      await env.DB.prepare("INSERT INTO project_reviews (id, project_id, kind, target, revision, passed, overall, data, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(randomId("rev"), row.id, body.kind, String(body.target).slice(0, 64), body.revision ?? null, body.passed ? 1 : 0, Number(body.review.overall ?? 0) || null, text, actor.label, nowIso())
        .run();
      return json({ ok: true });
    }
    if (sub === "check") return error(410, "伺服器不執行檢查（會超過 CPU 限制）。請在 Studio 頁面或本機執行：npm run game -- remote check <id>");
    if (sub === "versions" && method === "GET") {
      const { results } = await env.DB.prepare("SELECT version, label, actor, created_at FROM project_versions WHERE project_id = ? ORDER BY version DESC LIMIT 100").bind(row.id).all();
      return json({ ok: true, versions: results });
    }
    const vm = sub?.match(/^versions\/(\d+)$/);
    if (vm && method === "GET") {
      const v = await env.DB.prepare("SELECT data FROM project_versions WHERE project_id = ? AND version = ?").bind(row.id, Number(vm[1])).first<{ data: string }>();
      if (!v) return error(404, "找不到這個版本");
      return json({ ok: true, version: Number(vm[1]), project: JSON.parse(v.data) });
    }
    if (sub === "restore" && method === "POST") {
      const body = await readJson<{ version?: number }>(req);
      const v = await env.DB.prepare("SELECT data FROM project_versions WHERE project_id = ? AND version = ?").bind(row.id, Number(body.version)).first<{ data: string }>();
      if (!v) return error(404, "找不到這個版本");
      const saved = await saveVersion(env, row, JSON.parse(v.data), undefined, `還原到第 ${body.version} 版`, actor, false);
      return json({ ok: true, version: saved.version });
    }
    if (sub === "duplicate" && method === "POST") {
      const body = await readJson<{ title?: string }>(req);
      const source = JSON.parse(row.data) as GameProject;
      return insertProject(env, actor, { ...source, title: String(body.title ?? `${source.title}（複製）`).slice(0, 200) }, `從「${row.title}」複製`);
    }
    if (sub === "publish" && method === "POST") return publish(req, env, row, actor);
    if (sub === "publish" && method === "DELETE") {
      await env.DB.prepare("DELETE FROM published_games WHERE project_id = ?").bind(row.id).run();
      return json({ ok: true });
    }
  }
  return error(404, `找不到 API：${method} ${path}`);
}

// ---------- 驗證身分 ----------

async function authenticate(req: Request, env: Env): Promise<Actor | null> {
  const auth = req.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    const row = await env.DB.prepare(
      "SELECT t.id, t.name, u.id AS user_id, u.username FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.revoked_at IS NULL",
    )
      .bind(await sha256hex(token))
      .first<{ id: string; name: string; user_id: string; username: string }>();
    if (!row) return null;
    await env.DB.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").bind(nowIso(), row.id).run();
    return { userId: row.user_id, username: row.username, kind: "token", tokenName: row.name, label: `API Token「${row.name}」` };
  }
  const session = getCookie(req, SESSION_COOKIE);
  if (!session) return null;
  const row = await env.DB.prepare("SELECT u.id, u.username, s.expires_at, s.operator FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?")
    .bind(await sha256hex(session))
    .first<{ id: string; username: string; expires_at: string; operator: string | null }>();
  if (!row || row.expires_at < nowIso()) return null;
  return { userId: row.id, username: row.username, kind: "user", operator: row.operator, label: row.operator ? `${row.operator}（${row.username}）` : row.username };
}

/** 操作者名稱：去掉控制字元，最多 20 字；空白視為沒有填 */
function operatorName(v: unknown) {
  const name = String(v ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 20);
  return name || null;
}

/** 防暴力破解：同一帳號或同一 IP 在 15 分鐘內失敗 5 次就暫時鎖定 */
async function checkLock(env: Env, keys: string[]) {
  const since = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
  for (const key of keys) {
    const row = await env.DB.prepare("SELECT failures, window_start FROM login_attempts WHERE key = ?").bind(key).first<{ failures: number; window_start: string }>();
    if (row && row.window_start > since && row.failures >= LOCK_FAILURES) throw new HttpError(429, `登入失敗次數過多，請 ${LOCK_MINUTES} 分鐘後再試`);
  }
}

async function recordFailure(env: Env, keys: string[]) {
  const since = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
  for (const key of keys) {
    await env.DB.prepare(
      "INSERT INTO login_attempts (key, failures, window_start) VALUES (?1, 1, ?2) ON CONFLICT(key) DO UPDATE SET failures = CASE WHEN window_start > ?3 THEN failures + 1 ELSE 1 END, window_start = CASE WHEN window_start > ?3 THEN window_start ELSE ?2 END",
    )
      .bind(key, nowIso(), since)
      .run();
  }
}

async function login(req: Request, env: Env) {
  const body = await readJson<{ username?: string; password?: string; remember?: boolean; operator?: string }>(req);
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const lockKeys = [`user:${username.toLowerCase()}`, `ip:${req.headers.get("CF-Connecting-IP") ?? "unknown"}`];
  await checkLock(env, lockKeys);
  const user = await env.DB.prepare("SELECT id, username, password_hash, password_salt, password_iterations FROM users WHERE username = ?")
    .bind(username)
    .first<{ id: string; username: string; password_hash: string; password_salt: string; password_iterations: number }>();
  // 帳號不存在時也做一次雜湊，避免從回應時間猜出帳號是否存在
  const hash = await hashPassword(password, user?.password_salt ?? "no-user", user?.password_iterations ?? PASSWORD_ITERATIONS);
  if (!user || !safeEqual(hash, user.password_hash)) {
    await recordFailure(env, lockKeys);
    await logLogin(env, req, username, body.operator, false);
    return error(401, "帳號或密碼錯誤");
  }
  await logLogin(env, req, user.username, body.operator, true);
  await env.DB.batch(lockKeys.map((k) => env.DB.prepare("DELETE FROM login_attempts WHERE key = ?").bind(k)));
  const remember = body.remember !== false;
  const maxAge = remember ? REMEMBER_DAYS * 86400 : SHORT_SESSION_HOURS * 3600;
  const token = randomToken(32);
  const expires = new Date(Date.now() + maxAge * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(nowIso()),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at, operator) VALUES (?, ?, ?, ?, ?)").bind(await sha256hex(token), user.id, expires, nowIso(), operatorName(body.operator)),
  ]);
  return json(
    { ok: true, user: { id: user.id, username: user.username } },
    200,
    { "Set-Cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}` },
  );
}

/** 後台登入紀錄（安全用途）：Studio 帳號是共用的，記錄 IP 才能發現陌生人登入；保留 90 天 */
async function logLogin(env: Env, req: Request, username: string, operator: unknown, success: boolean) {
  const ua = req.headers.get("User-Agent") ?? "";
  const device = `${/Mobile|Android|iPhone/.test(ua) ? "手機" : "電腦"}・${/iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : "其他"}・${/Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "其他"}`;
  const country = (req as Request & { cf?: { country?: string } }).cf?.country ?? req.headers.get("CF-IPCountry");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM studio_logins WHERE created_at < date('now', '-90 days')"),
    env.DB.prepare("INSERT INTO studio_logins (username, operator, ip, country, device, success, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
      username.slice(0, 64),
      operatorName(operator),
      req.headers.get("CF-Connecting-IP") ?? "local",
      country ?? null,
      device,
      success ? 1 : 0,
      nowIso(),
    ),
  ]);
}

async function logout(req: Request, env: Env) {
  const session = getCookie(req, SESSION_COOKIE);
  if (session) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256hex(session)).run();
  return json({ ok: true }, 200, { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
}

async function changePassword(req: Request, env: Env, actor: Actor) {
  if (actor.kind !== "user") return error(403, "修改密碼只能在 Studio 介面操作");
  const body = await readJson<{ current?: string; next?: string }>(req);
  const next = String(body.next ?? "");
  if (next.length < MIN_PASSWORD) return error(400, `新密碼至少 ${MIN_PASSWORD} 個字元`);
  const user = await env.DB.prepare("SELECT password_hash, password_salt, password_iterations FROM users WHERE id = ?")
    .bind(actor.userId)
    .first<{ password_hash: string; password_salt: string; password_iterations: number }>();
  if (!user || !safeEqual(await hashPassword(String(body.current ?? ""), user.password_salt, user.password_iterations), user.password_hash)) return error(401, "目前的密碼不正確");
  const salt = randomToken(16);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ? WHERE id = ?").bind(await hashPassword(next, salt, PASSWORD_ITERATIONS), salt, PASSWORD_ITERATIONS, actor.userId),
    // 改密碼後，其他裝置的登入全部失效
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(actor.userId),
  ]);
  return json({ ok: true, notice: "密碼已更新，請重新登入" });
}

// ---------- 專案 ----------

async function getProject(env: Env, id: string, actor: Actor): Promise<ProjectRow> {
  const row = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first<ProjectRow>();
  if (!row || row.owner_id !== actor.userId) throw new HttpError(404, `找不到專案「${id}」`);
  return row;
}

async function createProject(req: Request, env: Env, actor: Actor) {
  const body = await readJson<{ title?: string; template?: string; project?: unknown; story?: string; genre?: string }>(req);
  const title = String(body.title ?? "").trim().slice(0, 200) || "未命名專案";
  if (body.project !== undefined) {
    const parsed = gameProjectSchema.safeParse(body.project);
    if (!parsed.success) return error(400, "匯入的 project 格式錯誤", { issues: parsed.error.issues.slice(0, 20) });
    return insertProject(env, actor, { ...parsed.data, title: body.title ? title : parsed.data.title }, "匯入專案");
  }
  const genre = (["fantasy", "modern", "sci-fi", "mystery"].includes(String(body.genre)) ? body.genre : "fantasy") as GameProject["genre"];
  const template = body.template === "demo" ? { ...(structuredClone(demoProject) as unknown as GameProject), title } : blankProject("tmp", title, genre);
  const res = await insertProject(env, actor, template, body.template === "demo" ? "從 demo 範本建立" : body.story ? "建立專案（故事交給 AI）" : "建立空白專案");
  // 「交給 AI 一個故事」：同時存下故事原文，AI 用 npm run game -- remote story <id> 讀取
  const story = String(body.story ?? "").trim();
  if (story) {
    const { id } = (await res.clone().json()) as { id: string };
    await env.DB.prepare("INSERT OR REPLACE INTO project_docs (project_id, kind, content, updated_at, updated_by) VALUES (?, 'story', ?, ?, ?)").bind(id, story.slice(0, 200_000), nowIso(), actor.label).run();
  }
  return res;
}

async function insertProject(env: Env, actor: Actor, project: GameProject, label: string) {
  const id = `${(project.title.toLowerCase().match(/[a-z0-9]+/g) ?? ["game"]).join("-").slice(0, 20) || "game"}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
  const data = { ...project, id };
  const isValid = 0; // 驗證在瀏覽器執行，開啟總覽或儲存時更新
  const now = nowIso();
  const text = JSON.stringify(data);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO projects (id, owner_id, title, data, version, is_valid, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)").bind(id, actor.userId, data.title, text, isValid, now, now),
    env.DB.prepare("INSERT INTO project_versions (project_id, version, data, label, actor, created_at) VALUES (?, 1, ?, ?, ?, ?)").bind(id, text, label, actor.label, now),
  ]);
  return json({ ok: true, id, version: 1 }, 201);
}

/** 儲存新版本：baseVersion 不符時拒絕（樂觀鎖），避免人和 AI 同時修改互相覆蓋 */
async function saveVersion(env: Env, row: ProjectRow, project: GameProject, baseVersion: number | undefined, label: string, actor: Actor, isValid: boolean) {
  if (baseVersion !== undefined && baseVersion !== row.version) {
    throw new HttpError(409, `專案已被修改（目前第 ${row.version} 版，你的基礎是第 ${baseVersion} 版），請重新讀取後再操作`, { currentVersion: row.version });
  }
  const text = JSON.stringify({ ...project, id: row.id });
  if (text.length > 900_000) throw new HttpError(413, "專案資料超過 900 KB 上限");
  const version = row.version + 1;
  const now = nowIso();
  const res = await env.DB.batch([
    env.DB.prepare("UPDATE projects SET data = ?, title = ?, version = ?, is_valid = ?, updated_at = ? WHERE id = ? AND version = ?").bind(text, project.title, version, isValid ? 1 : 0, now, row.id, row.version),
    env.DB.prepare("INSERT INTO project_versions (project_id, version, data, label, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(row.id, version, text, label, actor.label, now),
    env.DB.prepare("DELETE FROM project_versions WHERE project_id = ? AND version <= ?").bind(row.id, version - VERSION_KEEP),
  ]);
  if (!res[0].meta.changes) throw new HttpError(409, "專案剛被其他人修改，請重新讀取後再操作");
  return { version };
}

async function publish(req: Request, env: Env, row: ProjectRow, actor: Actor) {
  const body = await readJson<{ allowQualityWarnings?: boolean; check?: { revision?: string; valid?: boolean; playtestOk?: boolean; qualityBlocking?: number; typicalMinutes?: [number, number] | null } }>(req);
  const project = JSON.parse(row.data) as GameProject;
  const check = body.check;
  // 檢查在瀏覽器／本機執行；伺服器只確認報告是針對「目前這一版內容」做的
  if (!check || check.revision !== projectRevision(project)) return error(422, "缺少檢查報告，或報告不是針對目前版本（請重新檢查後再發布）", { revision: projectRevision(project) });
  if (!check.valid || !check.playtestOk) return error(422, "專案未通過驗證或自動試玩，不能發布");
  // 品質指標（時長、規模等）未達標時，只有人在 Studio 介面明確確認才可以發布；AI（API Token）一律不行
  if ((check.qualityBlocking ?? 99) > 0 && !(body.allowQualityWarnings && actor.kind === "user")) return error(422, "品質指標未達標，不能發布");
  // 審查關卡：大綱、每一章、整體（針對目前版本）都要通過；AI 不能略過，人可以明確確認後發布
  const blockers = await reviewBlockers(env, row.id, project);
  if (blockers.length && !(body.allowQualityWarnings && actor.kind === "user")) return error(422, `審查尚未全部通過：${blockers[0]}`, { blockers });
  const catalog = {
    id: row.id,
    title: project.title,
    description: project.description,
    genre: project.genre,
    status: "approved",
    endings: project.endings.length,
    achievements: (project.achievements ?? []).length + project.endings.filter((e) => !e.nextChapterId).length,
    npcs: project.actors.length - 1,
    chapters: project.chapters.length,
    release: project.release?.status ?? "complete",
    plannedChapters: project.release?.plannedChapters,
    typicalMinutes: check.typicalMinutes ?? null,
    cover: coverDataOf(project),
    path: `/games/${row.id}/project.json`,
    revision: projectRevision(project),
  };
  await env.DB.prepare("INSERT OR REPLACE INTO published_games (id, project_id, version, data, catalog, published_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(row.id, row.id, row.version, row.data, JSON.stringify(catalog), nowIso())
    .run();
  await env.DB.prepare("UPDATE projects SET is_valid = 1 WHERE id = ?").bind(row.id).run();
  return json({ ok: true, published: row.id, version: row.version });
}

/**
 * AI 案例庫：AI 寫大綱與每一章之前讀它（npm run game -- remote lessons <id>），審查員也會拿到同一份。
 * 分成兩部分（RPG 大師審查後調整，避免單一遊戲的例句塞進每一款遊戲的審查）：
 * - 通用：所有遊戲最常被玩家選的標籤、審查最常指出的規則（依規則編號統計，附規則原文）
 * - 這款遊戲：?game=<id> 時才附上這款遊戲的玩家留言、遊玩數據與審查意見
 */
async function lessons(env: Env, actor: Actor, gameId: string | null) {
  const projects = await env.DB.prepare("SELECT id, title FROM projects WHERE owner_id = ?").bind(actor.userId).all<{ id: string; title: string }>();
  const titles = new Map(projects.results.map((p) => [p.id, p.title]));
  const ids = [...titles.keys()];
  const md = (lines: string[]) => new Response(lines.join("\n"), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
  const lines = [`# AI 案例庫（自動彙整，${nowIso().slice(0, 10)}）`, "", "製作與審查時參考：玩家實際的反應，以及審查最常指出的規則。這是提醒，不是新的規則。", ""];
  if (ids.length === 0) return md(lines);
  const q = ids.map(() => "?").join(",");
  const fb = await env.DB.prepare(`SELECT game_id, chapter_id, rating, tags, comment FROM player_feedback WHERE game_id IN (${q}) ORDER BY created_at DESC LIMIT 2000`).bind(...ids).all<{ game_id: string; chapter_id: string; rating: number; tags: string; comment: string }>();
  const rv = await env.DB.prepare(`SELECT project_id, data FROM project_reviews WHERE project_id IN (${q}) ORDER BY created_at DESC LIMIT 300`).bind(...ids).all<{ project_id: string; data: string }>();
  const issuesOf = (data: string) => ((JSON.parse(data) as { review?: { issues?: Array<{ severity: string; area: string; problem: string }> } }).review?.issues ?? []).filter((i) => i.severity !== "minor");

  // ---------- 通用 ----------
  lines.push("## 通用：玩家最常選的標籤");
  const tagCount = new Map<string, number>();
  for (const f of fb.results) for (const t of JSON.parse(f.tags) as string[]) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  lines.push(tagCount.size ? `- ${[...tagCount].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, n]) => `${t}（${n}）`).join("、")}` : "（還沒有玩家回饋）");
  // 依規則編號統計 critical／major（例如 H6、F1、X5），附上規則原文
  const ruleText = new Map(DESIGN_GUIDE.split("\n").map((l) => [l.match(/^([A-Z]\d{1,2}) /)?.[1], l] as const).filter((x): x is [string, string] => Boolean(x[0])));
  const codes = new Map<string, number>();
  for (const r of rv.results) for (const i of issuesOf(r.data)) for (const c of new Set(`${i.area} ${i.problem}`.match(/\b[A-HPX]\d{1,2}\b/g) ?? [])) if (ruleText.has(c)) codes.set(c, (codes.get(c) ?? 0) + 1);
  lines.push("", "## 通用：審查最常指出的規則（critical／major）");
  if (codes.size === 0) lines.push("（還沒有審查紀錄）");
  for (const [c, n] of [...codes].sort((a, b) => b[1] - a[1]).slice(0, 10)) lines.push(`- ${c}（${n} 次）：${ruleText.get(c)!.slice(c.length + 1, c.length + 120)}`);

  // ---------- 這款遊戲 ----------
  if (gameId && titles.has(gameId)) {
    lines.push("", `## 這款遊戲：${titles.get(gameId)}`);
    const mine = fb.results.filter((f) => f.game_id === gameId);
    const byChapter = new Map<string, { sum: number; n: number }>();
    for (const f of mine) {
      const c = byChapter.get(f.chapter_id) ?? { sum: 0, n: 0 };
      byChapter.set(f.chapter_id, { sum: c.sum + f.rating, n: c.n + 1 });
    }
    for (const [k, c] of byChapter) lines.push(`- ${k}：平均 ${(c.sum / c.n).toFixed(1)} 顆星（${c.n} 則）`);
    for (const f of mine.filter((x) => x.comment.trim()).slice(0, 12)) lines.push(`- ${"★".repeat(f.rating)}「${f.comment.trim().slice(0, 120)}」（${f.chapter_id}）`);
    const a = await playAnalytics(env, gameId);
    if (a.visitors) {
      const ch = a.chapters.map((c) => `${c.chapter_id} 完成 ${c.done}/${c.entered}${c.minutes ? `、平均 ${c.minutes.toFixed(0)} 分鐘` : ""}`).join("；");
      const quit = a.quits.slice(0, 3).map((x) => `${x.chapter_id ?? "?"}／${x.ref ?? "?"}（${x.players} 人）`).join("、");
      lines.push(`- 遊玩數據：${a.visitors} 位玩家。${ch}${quit ? `。最常放棄的地方：${quit}` : ""}`);
    }
    lines.push(...insightLines(await gameInsights(env, gameId)));
    const issues = rv.results.filter((r) => r.project_id === gameId).flatMap((r) => issuesOf(r.data));
    const seen = new Set<string>();
    for (const i of issues) {
      if (seen.has(i.area) || seen.size >= 10) continue;
      seen.add(i.area);
      lines.push(`- 審查意見（${i.area}）：${i.problem.slice(0, 140)}`);
    }
    if (!mine.length && !a.visitors && !issues.length) lines.push("（這款遊戲還沒有紀錄）");
  }
  return md(lines);
}

/** 遊玩數據統計：玩家數、每章進入與完成人數、平均花費時間、結局分布、玩家最常離開的地方、近 14 天每日玩家數 */
async function playAnalytics(env: Env, gameId: string) {
  const all = async <T>(sql: string) => (await env.DB.prepare(sql).bind(gameId).all<T>()).results;
  const [totals, chapters, endings, quits, daily] = await Promise.all([
    all<{ visitors: number; sessions: number; minutes: number | null; loads: number; starters: number; finishers: number }>(
      "SELECT COUNT(DISTINCT visitor) AS visitors, COUNT(DISTINCT session) AS sessions, (SELECT SUM(m) FROM (SELECT MAX(value) AS m FROM play_events WHERE game_id = ?1 AND type = 'leave' GROUP BY session)) AS minutes, COUNT(DISTINCT CASE WHEN type = 'load' THEN visitor END) AS loads, COUNT(DISTINCT CASE WHEN type = 'start' THEN visitor END) AS starters, COUNT(DISTINCT CASE WHEN type = 'ending' THEN visitor END) AS finishers FROM play_events WHERE game_id = ?1",
    ),
    all<{ chapter_id: string; entered: number; done: number; minutes: number | null }>(
      "SELECT chapter_id, COUNT(DISTINCT CASE WHEN type = 'chapter' THEN visitor END) AS entered, COUNT(DISTINCT CASE WHEN type = 'chapter_done' THEN visitor END) AS done, AVG(CASE WHEN type = 'chapter_done' THEN value END) AS minutes FROM play_events WHERE game_id = ?1 AND chapter_id IS NOT NULL AND type IN ('chapter', 'chapter_done') GROUP BY chapter_id",
    ),
    all<{ ref: string; players: number }>("SELECT ref, COUNT(DISTINCT visitor) AS players FROM play_events WHERE game_id = ?1 AND type = 'ending' GROUP BY ref ORDER BY players DESC"),
    // 每個 session 最後一次離開的位置，而且那個 session 之後沒有抵達結局
    all<{ chapter_id: string | null; ref: string | null; players: number }>(
      "SELECT chapter_id, ref, COUNT(DISTINCT visitor) AS players FROM play_events e WHERE game_id = ?1 AND type = 'leave' AND id = (SELECT MAX(id) FROM play_events x WHERE x.session = e.session AND x.game_id = ?1 AND x.type = 'leave') AND NOT EXISTS (SELECT 1 FROM play_events y WHERE y.visitor = e.visitor AND y.game_id = ?1 AND y.type = 'ending') GROUP BY chapter_id, ref ORDER BY players DESC LIMIT 8",
    ),
    all<{ day: string; visitors: number }>(
      "SELECT substr(created_at, 1, 10) AS day, COUNT(DISTINCT visitor) AS visitors FROM play_events WHERE game_id = ?1 AND created_at >= date('now', '-13 days') GROUP BY day ORDER BY day",
    ),
  ]);
  return { ...totals[0], chapters, endings, quits, daily };
}

/**
 * 玩家行為洞察（給 AI 的）：把遊玩紀錄整理成「哪裡要改」的線索，放進案例庫，也可以用 remote insights 讀取。
 * - 選擇比例：某個選項幾乎沒人選（或幾乎全選）時，可能是假抉擇或選項不吸引人
 * - 沒人發現的事件：有圖像、可以按確定鍵的事件從來沒被觸發
 * - 卡關：兩次進度之間隔了很久（玩家沒有離開頁面）的位置
 * - 成就解鎖率、選單使用、設定、錯誤
 */
async function gameInsights(env: Env, gameId: string) {
  const all = async <T>(sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(gameId, ...binds).all<T>()).results;
  const starters = (await all<{ n: number }>("SELECT COUNT(DISTINCT visitor) AS n FROM play_events WHERE game_id = ?1 AND type = 'start'"))[0]?.n ?? 0;

  // 選擇比例
  const choiceRows = await all<{ ref: string; value: number; detail: string | null; n: number }>(
    "SELECT ref, value, MAX(detail) AS detail, COUNT(DISTINCT visitor) AS n FROM play_events WHERE game_id = ?1 AND type = 'choice' AND ref IS NOT NULL GROUP BY ref, value",
  );
  const byRef = new Map<string, Array<{ value: number; text: string | null; n: number }>>();
  for (const r of choiceRows) byRef.set(r.ref, [...(byRef.get(r.ref) ?? []), { value: r.value, text: r.detail, n: r.n }]);
  const choices = [...byRef].map(([locator, options]) => {
    const total = options.reduce((a, o) => a + o.n, 0);
    const top = options.reduce((a, o) => (o.n > a.n ? o : a), options[0]);
    return { locator, total, options: options.sort((a, b) => a.value - b.value).map((o) => ({ ...o, pct: Math.round((o.n / total) * 100) })), lopsided: total >= 5 && top.n / total >= 0.85 };
  });

  // 沒人發現的事件（對照已發布的遊戲內容）
  const published = await env.DB.prepare("SELECT data FROM published_games WHERE id = ?").bind(gameId).first<{ data: string }>();
  const interacted = new Set((await all<{ ref: string }>("SELECT DISTINCT ref FROM play_events WHERE game_id = ?1 AND type = 'interact'")).map((r) => r.ref));
  const unseen: Array<{ ref: string; name: string; map: string }> = [];
  if (published && starters >= 3) {
    const project = JSON.parse(published.data) as GameProject;
    for (const m of project.maps)
      for (const e of m.events)
        if (e.pages.some((pg) => pg.trigger === "action" && pg.commands.length > 0) && !interacted.has(`${m.id}/${e.id}`)) unseen.push({ ref: `${m.id}/${e.id}`, name: e.name, map: m.name });
  }

  // 卡關：同一個遊玩階段裡，兩次進度之間超過 2 分鐘、中間沒有離開頁面
  const rows = await all<{ session: string; type: string; ref: string | null; chapter_id: string | null; created_at: string }>(
    "SELECT session, type, ref, chapter_id, created_at FROM play_events WHERE game_id = ?1 ORDER BY session, id LIMIT 30000",
  );
  const stuckAt = new Map<string, { sessions: Set<string>; total: number; max: number }>();
  let cur = "";
  let lastAt = 0;
  let where = "";
  for (const r of rows) {
    if (r.session !== cur) {
      cur = r.session;
      lastAt = 0;
      where = "";
    }
    const t = Date.parse(r.created_at);
    if (r.type === "leave") {
      lastAt = 0;
      continue;
    }
    if (r.type === "transfer" && r.ref) where = r.ref;
    if (["interact", "transfer", "item", "quest", "chapter", "choice", "achievement", "ending"].includes(r.type)) {
      const gap = lastAt ? (t - lastAt) / 1000 : 0;
      if (gap > 120 && gap < 3600) {
        const key = `${r.chapter_id ?? "?"}／${where || "起點"}`;
        const s = stuckAt.get(key) ?? { sessions: new Set<string>(), total: 0, max: 0 };
        s.sessions.add(r.session);
        s.total += gap;
        s.max = Math.max(s.max, gap);
        stuckAt.set(key, s);
      }
      lastAt = t;
    }
  }
  const stuck = [...stuckAt]
    .map(([place, s]) => ({ place, sessions: s.sessions.size, avgMinutes: Math.round((s.total / s.sessions.size / 60) * 10) / 10, maxMinutes: Math.round((s.max / 60) * 10) / 10 }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 8);

  const achievements = await all<{ ref: string; players: number }>("SELECT ref, COUNT(DISTINCT visitor) AS players FROM play_events WHERE game_id = ?1 AND type = 'achievement' GROUP BY ref ORDER BY players DESC");
  const menus = await all<{ ref: string; opens: number }>("SELECT ref, COUNT(*) AS opens FROM play_events WHERE game_id = ?1 AND type = 'menu' GROUP BY ref ORDER BY opens DESC");
  const settings = await all<{ ref: string; detail: string; n: number }>("SELECT ref, detail, COUNT(DISTINCT visitor) AS n FROM play_events WHERE game_id = ?1 AND type = 'setting' GROUP BY ref, detail ORDER BY n DESC LIMIT 20");
  const errors = await all<{ detail: string; n: number }>("SELECT detail, COUNT(*) AS n FROM play_events WHERE game_id = ?1 AND type = 'error' GROUP BY detail ORDER BY n DESC LIMIT 10");
  return { starters, choices, unseen, stuck, achievements, menus, settings, errors, funnel: await playAnalytics(env, gameId) };
}

/** 洞察轉成給 AI 讀的 Markdown（案例庫的「這款遊戲」段落） */
function insightLines(i: Awaited<ReturnType<typeof gameInsights>>) {
  const lines: string[] = [];
  if (!i.starters) return lines;
  lines.push(`- 玩家行為（${i.starters} 位玩家開始玩）：`);
  for (const c of i.choices.filter((x) => x.lopsided).slice(0, 6))
    lines.push(`  - 選項幾乎一面倒（${c.locator}）：${c.options.map((o) => `「${o.text ?? o.value}」${o.pct}%`).join("、")}。可能是假抉擇，或其他選項不吸引人`);
  if (i.unseen.length) lines.push(`  - 從來沒人觸發的事件（${i.unseen.length} 個）：${i.unseen.slice(0, 8).map((u) => `${u.map}／${u.name}`).join("、")}。可能太隱密、沒有引導，或玩家不知道可以調查`);
  for (const s of i.stuck.slice(0, 4)) lines.push(`  - 卡關：${s.place}，${s.sessions} 次遊玩在這裡停了超過 2 分鐘（平均 ${s.avgMinutes} 分鐘）。檢查引導與提示（G3、H17）`);
  if (i.achievements.length) lines.push(`  - 成就解鎖人數：${i.achievements.slice(0, 8).map((a) => `${a.ref} ${a.players} 人`).join("、")}`);
  const quests = i.menus.find((m) => m.ref === "quests");
  if (quests) lines.push(`  - 任務日誌被打開 ${quests.opens} 次（很多時代表玩家常不知道下一步）`);
  for (const e of i.errors.slice(0, 3)) lines.push(`  - 頁面錯誤（${e.n} 次）：${e.detail}`);
  return lines;
}

/** 後台營運總覽：玩家數、遊玩次數、裝置、地區、各遊戲玩家數、近 30 天每日玩家 */
async function adminOverview(env: Env) {
  const one = async <T>(sql: string) => (await env.DB.prepare(sql).first<T>())!;
  const all = async <T>(sql: string) => (await env.DB.prepare(sql).all<T>()).results;
  const [totals, groups, games, daily, recent] = await Promise.all([
    one<{ visitors: number; today: number; week: number; month: number; sessions: number; avgMinutes: number | null }>(
      "SELECT (SELECT COUNT(*) FROM play_visitors) AS visitors, (SELECT COUNT(*) FROM play_visitors WHERE last_seen >= date('now')) AS today, (SELECT COUNT(*) FROM play_visitors WHERE last_seen >= date('now', '-6 days')) AS week, (SELECT COUNT(*) FROM play_visitors WHERE last_seen >= date('now', '-29 days')) AS month, (SELECT COUNT(*) FROM play_sessions) AS sessions, (SELECT AVG((julianday(last_at) - julianday(started_at)) * 1440) FROM play_sessions) AS avgMinutes",
    ),
    all<{ k: string; v: string | null; n: number }>(
      "SELECT 'device' AS k, device AS v, COUNT(*) AS n FROM play_visitors GROUP BY device UNION ALL SELECT 'os', os, COUNT(*) FROM play_visitors GROUP BY os UNION ALL SELECT 'browser', browser, COUNT(*) FROM play_visitors GROUP BY browser UNION ALL SELECT 'country', country, COUNT(*) FROM play_visitors GROUP BY country",
    ),
    all<{ game_id: string; visitors: number; sessions: number; avgMinutes: number | null; starters: number; finishers: number }>(
      "SELECT s.game_id, COUNT(DISTINCT s.visitor) AS visitors, COUNT(*) AS sessions, AVG((julianday(s.last_at) - julianday(s.started_at)) * 1440) AS avgMinutes, (SELECT COUNT(DISTINCT visitor) FROM play_events e WHERE e.game_id = s.game_id AND e.type = 'start') AS starters, (SELECT COUNT(DISTINCT visitor) FROM play_events e WHERE e.game_id = s.game_id AND e.type = 'ending') AS finishers FROM play_sessions s GROUP BY s.game_id ORDER BY visitors DESC",
    ),
    all<{ day: string; visitors: number }>("SELECT substr(started_at, 1, 10) AS day, COUNT(DISTINCT visitor) AS visitors FROM play_sessions WHERE started_at >= date('now', '-29 days') GROUP BY day ORDER BY day"),
    all<{ detail: string; game_id: string; n: number }>("SELECT detail, game_id, COUNT(*) AS n FROM play_events WHERE type = 'error' AND created_at >= date('now', '-6 days') GROUP BY detail, game_id ORDER BY n DESC LIMIT 10"),
  ]);
  return { ...totals, groups, games, daily, recentErrors: recent };
}

/** 玩家列表：匿名代號、裝置、地區、第一次與最後一次來、玩過哪些遊戲、目前進度 */
async function adminPlayers(env: Env, limit: number, offset: number) {
  const { results } = await env.DB.prepare(
    `SELECT v.visitor, v.nickname, v.invite, v.device, v.os, v.browser, v.lang, v.country, v.first_seen, v.last_seen, v.sessions,
       (SELECT GROUP_CONCAT(DISTINCT game_id) FROM play_sessions s WHERE s.visitor = v.visitor) AS games,
       (SELECT COUNT(*) FROM play_events e WHERE e.visitor = v.visitor) AS events,
       (SELECT chapter_id FROM play_events e WHERE e.visitor = v.visitor AND chapter_id IS NOT NULL ORDER BY id DESC LIMIT 1) AS last_chapter,
       (SELECT COUNT(*) FROM play_events e WHERE e.visitor = v.visitor AND e.type = 'ending') AS endings
     FROM play_visitors v ORDER BY v.last_seen DESC LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all();
  const total = (await env.DB.prepare("SELECT COUNT(*) AS n FROM play_visitors").first<{ n: number }>())?.n ?? 0;
  return { total, players: results };
}

/** 單一玩家的完整時間軸（最近 1000 筆操作） */
async function adminPlayer(env: Env, visitor: string) {
  const info = await env.DB.prepare("SELECT * FROM play_visitors WHERE visitor = ?").bind(visitor).first();
  const sessions = (await env.DB.prepare("SELECT * FROM play_sessions WHERE visitor = ? ORDER BY started_at DESC LIMIT 100").bind(visitor).all()).results;
  const events = (await env.DB.prepare("SELECT session, game_id, type, chapter_id, ref, value, detail, created_at FROM play_events WHERE visitor = ? ORDER BY id DESC LIMIT 1000").bind(visitor).all()).results;
  return { info, sessions, events };
}

/** 審查關卡：每個目標最新一次審查是否通過 */
async function reviewBlockers(env: Env, projectId: string, project: GameProject) {
  const { results } = await env.DB.prepare(
    "SELECT target, passed, revision FROM project_reviews r WHERE project_id = ? AND created_at = (SELECT MAX(created_at) FROM project_reviews r2 WHERE r2.project_id = r.project_id AND r2.target = r.target)",
  )
    .bind(projectId)
    .all<{ target: string; passed: number; revision: string | null }>();
  const latest = new Map(results.map((r) => [r.target, r]));
  const out: string[] = [];
  if (!latest.get("treatment")?.passed) out.push("劇本大綱尚未通過審查");
  project.chapters.forEach((c, i) => latest.get(c.id)?.passed || out.push(`第 ${i + 1} 章「${c.title}」尚未通過章節審查`));
  // 連載中：每一章通過章節審查就可以推出；完結時才需要整體審查
  if (project.release?.status === "ongoing") return out;
  const full = latest.get("full");
  if (!full?.passed) out.push("尚未通過整體審查");
  else if (full.revision !== projectRevision(project)) out.push("整體審查之後內容又改過了，需要重新審查");
  return out;
}

const API_DOCS = `# AI RPG Studio API

所有請求都要帶 \`Authorization: Bearer <API Token>\`（在 Studio「設定 → API Token」產生）。修改類請求以 \`Content-Type: application/json\` 送出。
製作規範見 repo 中的 docs/ai-development-spec.md；操作格式見 GET /api/ops-schema。

| 方法與路徑 | 說明 |
|---|---|
| GET /api/auth/me | 確認 token 有效 |
| GET /api/auth/logins | 後台登入紀錄（最近 100 筆，含 IP；只限瀏覽器登入的使用者） |
| POST /api/auth/operator | 共用帳號時設定這次登入的操作者名稱 \`{name}\`（只限瀏覽器登入） |
| GET /api/projects | 專案列表 |
| POST /api/projects \`{title, template: "blank"\\|"demo"}\` 或 \`{project}\` | 建立或匯入專案 |
| GET /api/projects/:id | 讀取專案與目前版本號 |
| POST /api/projects/:id/ops \`{ops, baseVersion?, label?, includeProject?}\` | 套用 Studio 操作；全部成功才寫入並產生新版本 |
| PUT /api/projects/:id \`{project, baseVersion?, label?}\` | 整份儲存（建議改用 ops） |
| （檢查） | 不在伺服器執行：用 \`npm run game -- remote check <id>\` 在本機驗證＋自動試玩＋品質指標 |
| GET /api/projects/:id/versions、GET .../versions/:v、POST .../restore \`{version}\` | 版本紀錄與還原 |
| GET /api/projects/:id/docs、PUT .../docs/story\|treatment \`{content}\` | 故事原文與劇本大綱 |
| GET /api/projects/:id/reviews、POST .../reviews \`{kind,target,revision,passed,review}\` | 審查紀錄（由 \`npm run game -- remote review…\` 自動上傳） |
| GET /api/projects/:id/feedback | 玩家回饋（玩完一章時的星等、標籤、留言） |
| POST /api/projects/:id/reviews/accept \`{target, note}\` | 人工接受某個目標（treatment、章節 ID、full）的最新審查（只限瀏覽器登入的使用者） |
| GET /api/projects/:id/notes | 修改清單（人在測試遊玩時按 📌 標記的意見，含位置代碼與當下狀態） |
| POST /api/projects/:id/notes \`{body, locator?, mapId?, x?, y?, chapterId?, excerpt?, state?}\` | 新增一筆修改意見 |
| PATCH /api/projects/:id/notes/:noteId \`{status: "resolved"\|"wontfix"\|"open", resolution}\` | 標成已處理（寫明怎麼改的）或不處理 |
| GET /api/projects/:id/insights | 玩家行為洞察（選擇比例、沒人發現的事件、卡關的地方、成就解鎖率、選單、設定、錯誤） |
| GET /api/projects/:id/analytics | 遊玩數據（玩家數、每章完成率與時間、結局分布、最常離開的地方） |
| GET /api/lessons?game=<id> | AI 案例庫（Markdown）：玩家回饋與審查最常退件的問題，製作前必讀 |
| POST /api/projects/:id/publish \`{check}\` | 附上本機檢查摘要（含 revision）發布；API Token 不能略過品質指標與審查關卡。建議用 \`npm run game -- remote publish <id>\` |

資料模型是 RPG Maker 式（資料庫、地圖、多頁事件、事件指令），說明見 docs/ai-development-spec.md 第 6 節。
建議流程：remote story（讀故事）→ 寫大綱 → remote review-treatment → 一章一章 remote apply／remote check／remote review --chapter → remote review → remote publish。
回應的 report.errors 是程式實際驗證的結果，請依它修正，不要假設已完成。
`;
