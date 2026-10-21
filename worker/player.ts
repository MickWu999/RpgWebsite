import { sha256hex, type Env } from "./lib";

/**
 * 前台 Worker：靜態網站之外，只處理 /games/* 與玩家回饋 POST /api/feedback。
 * - /games/index.json：內建遊戲（靜態檔）＋ Studio 已發布的遊戲（D1 published_games）
 * - /games/<id>/project.json：先查 D1 已發布的遊戲，沒有再回傳靜態檔
 * - POST /api/feedback：玩完一章時的回饋（同一位玩家同一章只保留最新一筆；不保存 IP）
 * - POST /api/events：匿名遊玩數據（開始、章節、結局、離開；一次最多 50 筆）
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
      const body = (await req.json().catch(() => null)) as { visitor?: unknown; session?: unknown; events?: unknown } | null;
      const id = /^[\w-]{1,64}$/;
      if (!body || typeof body.visitor !== "string" || !id.test(body.visitor) || typeof body.session !== "string" || !id.test(body.session) || !Array.isArray(body.events)) {
        return new Response(JSON.stringify({ ok: false, error: "格式錯誤" }), { status: 400, headers });
      }
      const types = new Set(["start", "chapter", "chapter_done", "ending", "leave"]);
      const opt = (v: unknown) => (typeof v === "string" && id.test(v) ? v : null);
      const now = new Date().toISOString();
      const rows = (body.events as Array<Record<string, unknown>>)
        .slice(0, 50)
        .filter((e) => e && typeof e.gameId === "string" && id.test(e.gameId) && typeof e.type === "string" && types.has(e.type))
        .map((e) =>
          env.DB.prepare("INSERT INTO play_events (game_id, visitor, session, type, chapter_id, ref, value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(
            e.gameId,
            body.visitor,
            body.session,
            e.type,
            opt(e.chapterId),
            opt(e.ref),
            typeof e.value === "number" && Number.isFinite(e.value) ? Math.min(Math.max(e.value, 0), 1440) : null,
            typeof e.at === "string" && !Number.isNaN(Date.parse(e.at)) && Math.abs(Date.parse(e.at) - Date.now()) < 864e5 ? new Date(e.at).toISOString() : now,
          ),
        );
      if (rows.length) await env.DB.batch(rows);
      return new Response(JSON.stringify({ ok: true, saved: rows.length }), { headers });
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
