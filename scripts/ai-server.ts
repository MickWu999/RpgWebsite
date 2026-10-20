import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { generateProject, providerFromEnv, repairProject } from "@/ai/pipeline";
import { ProviderError } from "@/ai/provider";
import { validateProject, type ValidationIssue } from "@/game/validate";
import { applyOps } from "@/studio/ops";
import { loadLocalEnv } from "./env";

/**
 * 本機 AI bridge：讓 Studio 透過本機 Claude Code CLI 生成遊戲資料（SPEC §11 API 草案）。
 * - 只綁定 127.0.0.1，且只接受來自 localhost 的瀏覽器請求（CORS allowlist）。
 * - 同一時間只處理一個 AI 請求，並限制每分鐘次數與請求大小。
 * 部署到 Cloudflare 的靜態網站不會使用這支程式。
 */

loadLocalEnv();
const PORT = Number(process.env.AI_BRIDGE_PORT) || 8787;
const MAX_BODY = 1024 * 1024;
const RATE_LIMIT_PER_MIN = 10;
const extraOrigins = (process.env.AI_BRIDGE_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const provider = providerFromEnv();
let busy = false;
const recent: number[] = [];

function allowedOrigin(origin: string | undefined) {
  if (!origin) return null;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || extraOrigins.includes(origin)) return origin;
  return null;
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new ProviderError("請求內容過大", "bad_output"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        resolve(typeof data === "object" && data ? data : {});
      } catch {
        reject(new ProviderError("請求不是有效的 JSON", "bad_output"));
      }
    });
    req.on("error", reject);
  });
}

async function withAiSlot<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (busy) throw new ProviderError("已有一個 AI 生成正在進行，請稍候", "failed");
  if (recent.length >= RATE_LIMIT_PER_MIN) throw new ProviderError("請求太頻繁，請一分鐘後再試", "failed");
  recent.push(now);
  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
  }
}

const server = createServer(async (req, res) => {
  const origin = allowedOrigin(req.headers.origin);
  const cors: Record<string, string> = origin
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", Vary: "Origin" }
    : {};
  if (req.headers.origin && !origin) return send(res, 403, { error: "此來源不允許使用本機 AI bridge" });
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const log = (msg: string) => console.log(`[ai-bridge] ${msg}`);

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      const status = provider ? await provider.available() : { ok: false, detail: "AI_PROVIDER=none" };
      return send(res, 200, { ok: true, provider: provider?.name ?? null, available: status.ok, detail: status.detail, busy }, cors);
    }
    if (req.method !== "POST") return send(res, 404, { error: "Not found" }, cors);
    const body = await readBody(req);

    if (url.pathname === "/api/projects/validate") {
      const result = validateProject(body.project);
      return send(res, 200, { isValid: result.isValid, errors: result.errors, warnings: result.warnings }, cors);
    }
    // Studio 操作 API：AI 與 Studio 使用同一套操作（見 docs/ai-development-spec.md）
    if (url.pathname === "/api/studio/ops") {
      const base = validateProject(body.project);
      if (!base.project) return send(res, 400, { error: "project 未通過驗證，請先修正", errors: base.errors }, cors);
      if (!Array.isArray(body.ops)) return send(res, 400, { error: "ops 必須是陣列" }, cors);
      const result = applyOps(base.project, body.ops.slice(0, 500));
      return send(res, 200, result, cors);
    }
    if (url.pathname === "/api/projects/export") {
      const result = validateProject(body.project);
      if (!result.project) return send(res, 400, { error: "專案未通過驗證，無法匯出", errors: result.errors }, cors);
      return send(res, 200, result.project, { ...cors, "Content-Disposition": `attachment; filename="${result.project.id}.json"` });
    }
    if (url.pathname === "/api/projects/generate") {
      const projectId = typeof body.projectId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(body.projectId) ? body.projectId : `rpg-${Date.now().toString(36)}`;
      const result = await withAiSlot(() =>
        generateProject(
          provider,
          {
            story: body.story as string,
            projectId,
            title: typeof body.title === "string" ? body.title.slice(0, 200) : undefined,
            genre: typeof body.genre === "string" ? body.genre : undefined,
            style: typeof body.style === "string" ? body.style.slice(0, 50) : undefined,
          },
          log,
        ),
      );
      log(result.message);
      return send(res, 200, result, cors);
    }
    if (url.pathname === "/api/projects/repair") {
      const projectId = typeof body.projectId === "string" ? body.projectId : `rpg-${Date.now().toString(36)}`;
      const errors = Array.isArray(body.errors) ? (body.errors as ValidationIssue[]).slice(0, 30) : validateProject(body.project).errors;
      const result = await withAiSlot(() => repairProject(provider, body.project, errors, projectId, log));
      log(result.message);
      return send(res, 200, result, cors);
    }
    return send(res, 404, { error: "Not found" }, cors);
  } catch (e) {
    const err = e as Error;
    const status = e instanceof ProviderError ? (e.kind === "bad_output" ? 400 : e.kind === "timeout" ? 504 : 503) : 500;
    log(`錯誤：${err.message}`);
    return send(res, status, { error: err.message }, cors);
  }
});

server.listen(PORT, "127.0.0.1", async () => {
  const status = provider ? await provider.available() : { ok: false, detail: "AI_PROVIDER=none" };
  console.log(`[ai-bridge] 已啟動：http://127.0.0.1:${PORT}`);
  console.log(`[ai-bridge] provider：${provider?.name ?? "none"}，${status.ok ? `可用（${status.detail}）` : `不可用：${status.detail}`}`);
});
