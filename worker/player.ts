import { sha256hex, type Env } from "./lib";

/**
 * 前台 Worker：靜態網站之外，只處理 /games/* 與玩家回饋 POST /api/feedback。
 * - /games/index.json：內建遊戲（靜態檔）＋ Studio 已發布的遊戲（D1 published_games）
 * - /games/<id>/project.json：先查 D1 已發布的遊戲，沒有再回傳靜態檔
 * - POST /api/feedback：玩完一章時的回饋（同一位玩家同一章只保留最新一筆；不保存 IP）
 * - POST /api/events：匿名遊玩紀錄（每個操作：對話、選擇、換地圖、物品、任務、選單、設定、錯誤…；一次最多 100 筆），並更新匿名玩家與遊玩階段
 * 除了回饋與遊玩數據之外，前台不提供任何寫入或後台功能。
 */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" };

    if (url.pathname === "/api/feedback" && req.method === "POST") {
      if (!(req.headers.get("Content-Type") ?? "").includes("application/json")) return new Response(JSON.stringify({ ok: false }), { status: 415, headers });
      const body = (await req.json().catch(() => null)) as { gameId?: unknown; chapterId?: unknown; rating?: unknown; tags?: unknown; comment?: unknown } | null;
      const id = /^[\w-]{1,64}$/;
      const rating = Number(body?.rating);
      if (!body || typeof body.gameId !== "string" || !id.test(body.gameId) || typeof body.chapterId !== "string" || !id.test(body.chapterId) || !(rating >= 1 && rating <= 5)) {
        return new Response(JSON.stringify({ ok: false, error: "格式錯誤" }), { status: 400, headers });
      }
      const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string").map((t) => t.slice(0, 20)).slice(0, 12) : [];
      const comment = typeof body.comment === "string" ? body.comment.slice(0, 500) : "";
      const ip = req.headers.get("CF-Connecting-IP") ?? "local";
      const key = await sha256hex(`${ip}|${body.gameId}|${body.chapterId}`);
      await env.DB.prepare("INSERT OR REPLACE INTO player_feedback (id, game_id, chapter_id, rating, tags, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(key, body.gameId, body.chapterId, Math.round(rating), JSON.stringify(tags), comment, new Date().toISOString())
        .run();
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    if (url.pathname === "/api/events" && req.method === "POST") {
      const body = (await req.json().catch(() => null)) as { visitor?: unknown; session?: unknown; device?: Record<string, unknown>; invite?: unknown; nickname?: unknown; events?: unknown } | null;
      const id = /^[\w-]{1,64}$/;
      if (!body || typeof body.visitor !== "string" || !id.test(body.visitor) || typeof body.session !== "string" || !id.test(body.session) || !Array.isArray(body.events)) {
        return new Response(JSON.stringify({ ok: false, error: "格式錯誤" }), { status: 400, headers });
      }
      const types = new Set(["load", "start", "chapter", "chapter_done", "ending", "leave", "achievement", "interact", "choice", "transfer", "item", "quest", "menu", "save", "load_save", "setting", "error"]);
      const opt = (v: unknown) => (typeof v === "string" && id.test(v) ? v : null);
      // ref 可以是位置代碼（含 / # . :），只允許安全的字元
      const ref = (v: unknown) => (typeof v === "string" && /^[\w\-/#.:]{1,120}$/.test(v) ? v : null);
      const text = (v: unknown, n: number) => (typeof v === "string" && v ? v.replace(/[\u0000-\u001f]/g, " ").slice(0, n) : null);
      const now = new Date().toISOString();
      const events = (body.events as Array<Record<string, unknown>>).slice(0, 100).filter((e) => e && typeof e.gameId === "string" && id.test(e.gameId) && typeof e.type === "string" && types.has(e.type));
      const at = (e: Record<string, unknown>) => (typeof e.at === "string" && !Number.isNaN(Date.parse(e.at)) && Math.abs(Date.parse(e.at) - Date.now()) < 864e5 ? new Date(e.at).toISOString() : now);
      const stmts = events.map((e) =>
        env.DB.prepare("INSERT INTO play_events (game_id, visitor, session, type, chapter_id, ref, value, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(
          e.gameId,
          body.visitor,
          body.session,
          e.type,
          opt(e.chapterId),
          ref(e.ref),
          typeof e.value === "number" && Number.isFinite(e.value) ? Math.min(Math.max(e.value, -9999), 99999) : null,
          text(e.detail, 200),
          at(e),
        ),
      );
      if (stmts.length) {
        // 匿名玩家與遊玩階段：裝置只記粗略分類，地區只記 Cloudflare 判斷的國家代碼，不保存 IP
        const d = body.device ?? {};
        const country = text((req as Request & { cf?: { country?: string } }).cf?.country ?? req.headers.get("CF-IPCountry"), 8);
        const gameId = events[0].gameId as string;
        // 遊玩階段的開始與最後時間用事件本身的時間（同一批送出的事件也能算出正確的遊玩時間）
        const times = events.map(at).sort();
        const first = times[0];
        const last = times[times.length - 1];
        stmts.push(
          env.DB.prepare(
            "INSERT INTO play_visitors (visitor, first_seen, last_seen, device, os, browser, lang, country, sessions, invite, nickname) VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9) ON CONFLICT(visitor) DO UPDATE SET last_seen = ?2, device = COALESCE(?3, device), os = COALESCE(?4, os), browser = COALESCE(?5, browser), lang = COALESCE(?6, lang), country = COALESCE(?7, country), invite = COALESCE(invite, ?8), nickname = ?9",
          ).bind(body.visitor, now, text(d.device, 16), text(d.os, 16), text(d.browser, 16), text(d.lang, 10), country, text(body.invite, 20), text(body.nickname, 20)),
          env.DB.prepare(
            "INSERT INTO play_sessions (session, visitor, game_id, started_at, last_at, events, screen, touch_mode) VALUES (?1, ?2, ?3, ?4, ?8, ?5, ?6, ?7) ON CONFLICT(session) DO UPDATE SET started_at = MIN(started_at, ?4), last_at = MAX(last_at, ?8), events = events + ?5, screen = COALESCE(?6, screen), touch_mode = COALESCE(?7, touch_mode)",
          ).bind(body.session, body.visitor, gameId, first, events.length, text(d.screen, 16), text(d.touchMode, 8), last),
          env.DB.prepare("UPDATE play_visitors SET sessions = (SELECT COUNT(*) FROM play_sessions WHERE visitor = ?1) WHERE visitor = ?1").bind(body.visitor),
        );
        await env.DB.batch(stmts);
      }
      return new Response(JSON.stringify({ ok: true, saved: events.length }), { headers });
    }

    if (url.pathname === "/games/index.json") {
      const staticRes = await env.ASSETS.fetch(new Request(new URL("/games/index.json", url), req));
      const base = staticRes.ok ? ((await staticRes.json()) as { games: Array<{ id: string }> }) : { games: [] };
      const { results } = await env.DB.prepare("SELECT catalog FROM published_games ORDER BY published_at DESC").all<{ catalog: string }>();
      const published = results.map((r) => JSON.parse(r.catalog) as { id: string });
      const ids = new Set(published.map((g) => g.id));
      return new Response(JSON.stringify({ generatedAt: new Date().toISOString(), games: [...published, ...base.games.filter((g) => !ids.has(g.id))] }), { headers });
    }

    const m = url.pathname.match(/^\/games\/([\w-]+)\/project\.json$/);
    if (m) {
      const row = await env.DB.prepare("SELECT data FROM published_games WHERE id = ?").bind(m[1]).first<{ data: string }>();
      if (row) return new Response(row.data, { headers });
    }
    return env.ASSETS.fetch(req);
  },
};
