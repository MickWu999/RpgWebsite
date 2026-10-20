import type { Env } from "./lib";

/**
 * 前台 Worker：靜態網站之外，只處理 /games/*。
 * - /games/index.json：內建遊戲（靜態檔）＋ Studio 已發布的遊戲（D1 published_games）
 * - /games/<id>/project.json：先查 D1 已發布的遊戲，沒有再回傳靜態檔
 * 前台不提供任何寫入或後台功能。
 */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" };

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
