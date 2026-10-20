import demoProject from "../public/games/demo-lantern/project.json";
import { coverDataOf } from "../src/game/cover";
import { projectRevision } from "../src/game/engine";
import { gameProjectSchema, type GameProject } from "../src/game/schema";
import { applyOps, blankProject, opSchema } from "../src/studio/ops";
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

type Actor = { userId: string; username: string; kind: "user" | "token"; tokenName?: string; label: string };
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

  if (path === "/api/auth/me" && method === "GET") return json({ ok: true, user: { id: actor.userId, username: actor.username }, via: actor.kind, tokenName: actor.tokenName });
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
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.title, p.version, p.is_valid, p.updated_at, p.created_at, p.archived_at, g.version AS published_version, g.published_at FROM projects p LEFT JOIN published_games g ON g.project_id = p.id WHERE p.owner_id = ? AND p.archived_at IS ${archived ? "NOT NULL" : "NULL"} ORDER BY ${archived ? "p.archived_at" : "p.updated_at"} DESC`,
    )
      .bind(actor.userId)
      .all();
    return json({ ok: true, projects: results });
  }
  if (path === "/api/projects" && method === "POST") return createProject(req, env, actor);

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
  const row = await env.DB.prepare("SELECT u.id, u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?")
    .bind(await sha256hex(session))
    .first<{ id: string; username: string; expires_at: string }>();
  if (!row || row.expires_at < nowIso()) return null;
  return { userId: row.id, username: row.username, kind: "user", label: row.username };
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
  const body = await readJson<{ username?: string; password?: string; remember?: boolean }>(req);
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
    return error(401, "帳號或密碼錯誤");
  }
  await env.DB.batch(lockKeys.map((k) => env.DB.prepare("DELETE FROM login_attempts WHERE key = ?").bind(k)));
  const remember = body.remember !== false;
  const maxAge = remember ? REMEMBER_DAYS * 86400 : SHORT_SESSION_HOURS * 3600;
  const token = randomToken(32);
  const expires = new Date(Date.now() + maxAge * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(nowIso()),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").bind(await sha256hex(token), user.id, expires, nowIso()),
  ]);
  return json(
    { ok: true, user: { id: user.id, username: user.username } },
    200,
    { "Set-Cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}` },
  );
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
  const body = await readJson<{ title?: string; template?: string; project?: unknown }>(req);
  const title = String(body.title ?? "").trim().slice(0, 200) || "未命名專案";
  if (body.project !== undefined) {
    const parsed = gameProjectSchema.safeParse(body.project);
    if (!parsed.success) return error(400, "匯入的 project 格式錯誤", { issues: parsed.error.issues.slice(0, 20) });
    return insertProject(env, actor, { ...parsed.data, title: body.title ? title : parsed.data.title }, "匯入專案");
  }
  const template = body.template === "demo" ? { ...(structuredClone(demoProject) as unknown as GameProject), title } : blankProject("tmp", title);
  return insertProject(env, actor, template, body.template === "demo" ? "從 demo 範本建立" : "建立空白專案");
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
  const catalog = {
    id: row.id,
    title: project.title,
    description: project.description,
    genre: project.genre,
    status: "approved",
    endings: project.endings.length,
    npcs: project.actors.length - 1,
    chapters: project.chapters.length,
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

const API_DOCS = `# AI RPG Studio API

所有請求都要帶 \`Authorization: Bearer <API Token>\`（在 Studio「設定 → API Token」產生）。修改類請求以 \`Content-Type: application/json\` 送出。
製作規範見 repo 中的 docs/ai-development-spec.md；操作格式見 GET /api/ops-schema。

| 方法與路徑 | 說明 |
|---|---|
| GET /api/auth/me | 確認 token 有效 |
| GET /api/projects | 專案列表 |
| POST /api/projects \`{title, template: "blank"\\|"demo"}\` 或 \`{project}\` | 建立或匯入專案 |
| GET /api/projects/:id | 讀取專案與目前版本號 |
| POST /api/projects/:id/ops \`{ops, baseVersion?, label?, includeProject?}\` | 套用 Studio 操作；全部成功才寫入並產生新版本 |
| PUT /api/projects/:id \`{project, baseVersion?, label?}\` | 整份儲存（建議改用 ops） |
| （檢查） | 不在伺服器執行：用 \`npm run game -- remote check <id>\` 在本機驗證＋自動試玩＋品質指標 |
| GET /api/projects/:id/versions、GET .../versions/:v、POST .../restore \`{version}\` | 版本紀錄與還原 |
| POST /api/projects/:id/publish \`{check}\` | 附上本機檢查摘要（含 revision）發布；API Token 不能略過品質指標。建議用 \`npm run game -- remote publish <id>\` |

建議流程：GET 專案 → 小批次 POST ops（帶 baseVersion）→ remote check（本機）→ 修正 → … → remote publish。
回應的 report.errors 是程式實際驗證的結果，請依它修正，不要假設已完成。
`;
